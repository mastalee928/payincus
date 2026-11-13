import assert from 'node:assert/strict'
import { createHash, randomUUID, X509Certificate } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:https'
import { OWNER_DEBIAN11_IMAGES, ownerSelectedContainerImage } from '../src/lib/owner-selected-images.js'

process.env.DATABASE_URL ||= 'postgresql://fixture:fixture@127.0.0.1:1/unused_review_fixture'
const { IncusClient } = await import('../src/lib/incus/incus-client.js')
const { resolveOwnerSelectedImage } = await import('../src/services/owner-selected-image-import.js')
const { closePrismaDatabase } = await import('../src/db/prisma.js')
const manifest = JSON.parse(await readFile('images/manifest.json', 'utf8'))
const originalFetch = globalThis.fetch
globalThis.fetch = (async () => { throw Error('runtime must never fetch a bundled image from GitHub') }) as typeof fetch
const directory = await mkdtemp(join(tmpdir(), 'bundled-image-test-'))
const keyPath = join(directory, 'key.pem'), certPath = join(directory, 'cert.pem')
execFileSync(process.env.REVIEW_OPENSSL || 'openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=fixture',
  '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', keyPath, '-out', certPath], { stdio: 'pipe', windowsHide: true })
const certificate = await readFile(certPath), fingerprint = new X509Certificate(certificate).fingerprint256
const imported = new Set<string>()
let arch = 'x86_64', uploads = 0
const calls: string[] = []
const server = createServer({ key: await readFile(keyPath), cert: certificate, ca: certificate, requestCert: true, rejectUnauthorized: true }, async (request, reply) => {
  calls.push(`${request.method} ${request.url}`)
  assert.equal((request.socket as any).authorized, true)
  reply.setHeader('Content-Type', 'application/json')
  const ok = (metadata: unknown) => reply.end(JSON.stringify({ type: 'sync', metadata }))
  if (request.url === '/1.0') return ok({ environment: { server_architecture: arch } })
  if (request.method === 'POST' && request.url === '/1.0/images') {
    uploads++
    const hash = createHash('sha256'); let size = 0
    for await (const chunk of request) { hash.update(chunk); size += chunk.length }
    const expected = manifest.images[arch === 'x86_64' ? 'amd64' : 'arm64']
    assert.equal(size, expected.size); assert.equal(hash.digest('hex'), expected.sha256)
    assert.equal(request.headers['x-incus-fingerprint'], expected.sha256)
    assert.equal(request.headers['x-incus-public'], 'false')
    imported.add(expected.sha256); return ok({ fingerprint: expected.sha256 })
  }
  const image = request.url?.slice('/1.0/images/'.length)
  if (request.url?.startsWith('/1.0/images/') && imported.has(image!)) return ok({ fingerprint: image, architecture: arch, type: 'container' })
  reply.statusCode = 404; reply.end(JSON.stringify({ type: 'error', error: 'Image not found' }))
})
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
const client = new IncusClient({ url: `https://127.0.0.1:${(server.address() as any).port}`, certPath, keyPath, serverCertificate: certificate.toString(), serverFingerprint: fingerprint })
try {
  await client.connect()
  assert.equal(await resolveOwnerSelectedImage(client, 'images:debian/12/cloud', 'container'), null)
  assert.equal(uploads, 0)
  for (const [key, source] of Object.entries(OWNER_DEBIAN11_IMAGES)) {
    arch = key
    const artifact = manifest.images[source.archiveArchitecture]
    const hash = createHash('sha256')
    for await (const bytes of createReadStream(`images/debian11-cloud-${source.archiveArchitecture}.tar.gz`)) hash.update(bytes)
    assert.equal(artifact.sha256, hash.digest('hex')); assert.equal(artifact.sourceSha256, source.sha256)
    assert.equal(ownerSelectedContainerImage('images:debian/11/cloud/' + source.archiveArchitecture, key)?.sha256, source.sha256)
    await assert.rejects(resolveOwnerSelectedImage(client, 'images:debian/11/cloud', 'vm'), /CONTAINER_REQUIRED/)
    const values = await Promise.all(Array.from({ length: 3 }, () => resolveOwnerSelectedImage(client, 'images:debian/11/cloud', 'container')))
    assert.ok(values.every(value => value === artifact.sha256))
    const previous = uploads
    await resolveOwnerSelectedImage(client, 'images:debian/11/cloud', 'container')
    assert.equal(uploads, previous, 'the registered cached image is reused')
  }
  assert.equal(uploads, 2, 'exactly one authenticated import for each architecture')
  assert.ok(calls.every(call => !call.includes('/instances')), 'image import cannot mutate a customer')
  console.log('PASS bundled images: both real tar hashes, fixed source pins, architecture, mTLS binary import, concurrent deduplication and cached reuse without any fetch')
} finally {
  globalThis.fetch = originalFetch
  await client.close(); await new Promise<void>(resolve => server.close(() => resolve()))
  await rm(directory, { recursive: true, force: true }); await closePrismaDatabase()
}
process.exit(0)
