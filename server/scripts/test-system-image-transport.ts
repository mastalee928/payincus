import assert from 'node:assert/strict'
import { createHash, X509Certificate } from 'node:crypto'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:https'

process.env.DATABASE_URL ||= 'postgresql://fixture:fixture@127.0.0.1:1/unused_review_fixture'
const directory = await mkdtemp(join(tmpdir(), 'system-image-transport-'))
process.env.SYSTEM_IMAGE_CACHE_DIR = join(directory, 'images')
const { cacheSystemImage } = await import('../src/services/system-image-cache.js')
const { IncusClient } = await import('../src/lib/incus/incus-client.js')
const { resolveCachedSystemImage } = await import('../src/services/system-image-import.js')
const { closePrismaDatabase } = await import('../src/db/prisma.js')
const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex')
const archives = Object.fromEntries(['x86_64', 'aarch64'].map(arch => {
  const metadata = Buffer.from('immutable official metadata ' + arch), root = Buffer.alloc(1024 * 1024, arch === 'x86_64' ? 65 : 66)
  return [arch, { metadata, root, fingerprint: sha(Buffer.concat([metadata, root])) }]
}))
const catalog = { products: Object.fromEntries(Object.entries(archives).map(([arch, data]) => [arch, {
  arch: arch === 'x86_64' ? 'amd64' : 'arm64', aliases: 'debian/12/cloud', versions: { current: { items: {
    meta: { ftype: 'incus.tar.xz', path: `images/${arch}/meta.tar.xz`, sha256: sha(data.metadata), size: data.metadata.length, combined_rootxz_sha256: data.fingerprint },
    root: { ftype: 'root.tar.xz', path: `images/${arch}/root.tar.xz`, sha256: sha(data.root), size: data.root.length }
  } } }
}])) }
const originalFetch = globalThis.fetch
globalThis.fetch = (async (input: unknown) => {
  const url = String(input)
  if (url.endsWith('/streams/v1/images.json')) return Response.json(catalog)
  for (const [arch, data] of Object.entries(archives)) {
    if (url.endsWith(`/images/${arch}/meta.tar.xz`)) return new Response(data.metadata)
    if (url.endsWith(`/images/${arch}/root.tar.xz`)) return new Response(data.root)
  }
  throw Error('unexpected source')
}) as typeof fetch
for (const arch of Object.keys(archives)) await cacheSystemImage('images:debian/12/cloud', arch, 'container')
globalThis.fetch = (async () => { throw Error('cached import must not access upstream') }) as typeof fetch
const keyPath = join(directory, 'key.pem'), certPath = join(directory, 'cert.pem')
execFileSync(process.env.REVIEW_OPENSSL || 'openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=fixture',
  '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', keyPath, '-out', certPath], { stdio: 'pipe', windowsHide: true })
const certificate = await readFile(certPath), fingerprint = new X509Certificate(certificate).fingerprint256
const imported = new Set<string>(), calls: string[] = []
let arch = 'x86_64', uploads = 0
const server = createServer({ key: await readFile(keyPath), cert: certificate, ca: certificate, requestCert: true, rejectUnauthorized: true }, async (request, reply) => {
  calls.push(`${request.method} ${request.url}`)
  assert.equal((request.socket as any).authorized, true)
  reply.setHeader('Content-Type', 'application/json')
  const ok = (metadata: unknown) => reply.end(JSON.stringify({ type: 'sync', metadata }))
  if (request.url === '/1.0') return ok({ environment: { kernel_architecture: arch } })
  if (request.method === 'POST' && request.url === '/1.0/images') {
    uploads++
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = Buffer.concat(chunks), data = archives[arch]
    assert.ok(body.includes(data.metadata) && body.includes(data.root), 'multipart carries exact cached parts')
    assert.equal(request.headers['x-incus-fingerprint'], data.fingerprint)
    assert.equal(request.headers['x-incus-public'], 'false')
    assert.match(String(request.headers['content-type']), /^multipart\/form-data; boundary=/)
    imported.add(data.fingerprint); return ok({ fingerprint: data.fingerprint })
  }
  const image = request.url?.slice('/1.0/images/'.length)
  if (request.url?.startsWith('/1.0/images/') && imported.has(image!)) return ok({ fingerprint: image, architecture: arch, type: 'container' })
  reply.statusCode = 404; reply.end(JSON.stringify({ type: 'error', error: 'Image not found' }))
})
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
const client = new IncusClient({ url: `https://127.0.0.1:${(server.address() as any).port}`, certPath, keyPath, serverCertificate: certificate.toString(), serverFingerprint: fingerprint })
try {
  await client.connect()
  const before = calls.length
  for (const alias of ['images:debian/11/cloud', 'images:ubuntu/25.10/cloud/arm64']) await assert.rejects(resolveCachedSystemImage(client, alias, 'container'), /SYSTEM_IMAGE_RETIRED/)
  assert.equal(calls.length, before, 'retired images are rejected before connecting to a host')
  assert.equal(await resolveCachedSystemImage(client, 'custom:debian12', 'container'), null)
  for (const current of Object.keys(archives)) {
    arch = current
    const values = await Promise.all(Array.from({ length: 3 }, () => resolveCachedSystemImage(client, 'images:debian/12/cloud', 'container')))
    assert.ok(values.every(value => value === archives[arch].fingerprint))
    const previous = uploads
    await resolveCachedSystemImage(client, 'images:debian/12/cloud', 'container')
    assert.equal(uploads, previous, 'host image cache is reused')
  }
  assert.equal(uploads, 2)
  arch = 'unknown'
  await assert.rejects(resolveCachedSystemImage(client, 'images:debian/12/cloud', 'container'), /SYSTEM_IMAGE_TARGET_INVALID/)
  assert.ok(calls.every(call => !call.includes('/instances')))
  console.log('PASS official image transport: both architectures, mTLS multipart, exact cached bytes, concurrent single import, offline reuse and retired-image rejection')
} finally {
  globalThis.fetch = originalFetch
  await client.close(); await new Promise<void>(resolve => server.close(() => resolve()))
  await rm(directory, { recursive: true, force: true }); await closePrismaDatabase()
}
process.exit(0)
