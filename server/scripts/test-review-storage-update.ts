import assert from 'node:assert/strict'
import { X509Certificate } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:https'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { IncusClient, IncusApiError } from '../src/lib/incus/incus-client.js'
import { updateStoragePool } from '../src/lib/incus/incus-storage.js'

const directory = await mkdtemp(join(tmpdir(), 'storage-update-'))
async function certificate(name: string) {
  const keyPath = join(directory, `${name}.key`), certPath = join(directory, `${name}.pem`)
  execFileSync(process.env.REVIEW_OPENSSL || 'openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=storage-update-fixture', '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', keyPath, '-out', certPath],
  { stdio: 'pipe', windowsHide: true })
  return { keyPath, certPath, key: await readFile(keyPath), cert: await readFile(certPath, 'utf8') }
}
const original = await certificate('original'), replacement = await certificate('replacement')
const name = 'fixture-pool'
let pool = { name, driver: 'lvm', description: 'Keep this description', config: { size: '10GiB', source: `/var/lib/incus/disks/${name}.img`, 'user.keep': 'unchanged' } }
let revision = 1, mode = 'normal', reads = 0, writes = 0, applied = 0
let lastPayload: any
const server = createServer({ key: original.key, cert: original.cert, ca: original.cert, requestCert: true, rejectUnauthorized: true }, async (request, response) => {
  try {
    assert.ok((request.socket as any).authorized)
    const send = (status: number, data: unknown, etag = true) => {
      response.writeHead(status, { 'content-type': 'application/json', ...(etag ? { etag: `"revision-${revision}"` } : {}) })
      response.end(JSON.stringify(data))
    }
    if (request.url === '/1.0') { send(200, { type: 'sync', metadata: { api_version: '1.0' } }); return }
    assert.equal(request.url, `/1.0/storage-pools/${name}`)
    if (request.method === 'GET') {
      reads++
      if (mode === 'read-error') { send(403, { type: 'error', error: 'fixture read denied' }); return }
      send(200, { type: 'sync', metadata: mode === 'wrong-name' ? { ...pool, name: 'other' } : pool }, mode !== 'no-etag')
      if (mode === 'conflict') { pool.description = 'Updated by another request'; revision++ }
      return
    }
    assert.equal(request.method, 'PATCH')
    writes++
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(chunk)
    lastPayload = JSON.parse(Buffer.concat(chunks).toString())
    if (request.headers['if-match'] && request.headers['if-match'] !== `"revision-${revision}"`) {
      send(412, { type: 'error', error: 'fixture ETag conflict' }); return
    }
    if (mode === 'write-error') { send(500, { type: 'error', error: 'fixture write failed' }); return }
    // Incus PATCH merges config but StoragePoolPut.Description defaults to empty.
    pool = { ...pool, description: lastPayload.description ?? '', config: { ...pool.config, ...lastPayload.config } }
    applied++; revision++
    send(200, { type: 'sync', metadata: {} })
  } catch { response.writeHead(500); response.end('{}') }
})
await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
const options = { url: `https://127.0.0.1:${(server.address() as { port: number }).port}`,
  certPath: original.certPath, keyPath: original.keyPath, serverCertificate: original.cert,
  serverFingerprint: new X509Certificate(original.cert).fingerprint256 }
const client = new IncusClient(options)
try {
  await client.connect()
  await updateStoragePool(client, name, { config: { size: '20GiB' } })
  assert.equal(pool.description, 'Keep this description', 'capacity-only update must preserve the current Incus description')
  assert.equal(pool.config.size, '20GiB'); assert.equal(pool.config['user.keep'], 'unchanged')
  assert.equal(reads, 1); assert.equal(applied, 1)
  await updateStoragePool(client, name, { description: '' })
  assert.equal(pool.description, '', 'explicit empty description is still allowed')
  assert.equal(pool.config.size, '20GiB')
  const emptyBefore = [reads, writes]
  await updateStoragePool(client, name, {})
  assert.deepEqual([reads, writes], emptyBefore, 'platform-only metadata updates must not send an empty remote PATCH')
  for (const state of ['no-etag', 'wrong-name', 'read-error']) {
    mode = state
    const before = writes
    await assert.rejects(updateStoragePool(client, name, { description: 'must not apply' }))
    assert.equal(writes, before, `${state} must not reach a remote mutation`)
  }
  mode = 'conflict'
  const beforeConflict = applied, beforeWrites = writes
  await assert.rejects(updateStoragePool(client, name, { config: { size: '30GiB' } }),
    error => error instanceof IncusApiError && error.statusCode === 412)
  assert.equal(applied, beforeConflict); assert.equal(writes, beforeWrites + 1, 'conflicts are surfaced without blind retries')
  assert.equal(pool.description, 'Updated by another request'); assert.equal(pool.config.size, '20GiB')
  mode = 'write-error'
  await assert.rejects(updateStoragePool(client, name, { description: 'must not apply' }), /fixture write failed/)
  assert.equal(applied, beforeConflict)
  mode = 'normal'
  await updateStoragePool(client, name, { description: 'intentional description', config: { size: '30GiB' } })
  assert.equal(pool.description, 'intentional description'); assert.equal(pool.config.size, '30GiB')
  await client.agent?.destroy(); client.agent = client.createTransport()
  server.setSecureContext({ key: replacement.key, cert: replacement.cert, ca: original.cert })
  const beforeIdentity = [reads, writes]
  await assert.rejects(updateStoragePool(client, name, { description: 'must not apply' }))
  assert.deepEqual([reads, writes], beforeIdentity, 'changed server certificate is rejected before HTTP')
  console.log('PASS storage updates preserve descriptions/config, honor explicit clears, skip empty writes, reject missing ETag/wrong identity/read errors and preserve concurrent edits on 412; actual pinned mTLS transport')
} finally {
  await client.agent?.destroy()
  server.closeAllConnections()
  await new Promise<void>(done => server.close(() => done()))
  const target = resolve(directory)
  assert.ok(target.startsWith(resolve(tmpdir()) + sep) && target.includes('storage-update-'))
  await rm(target, { recursive: true, force: true })
}
