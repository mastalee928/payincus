import assert from 'node:assert/strict'
import { randomUUID, X509Certificate } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:https'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import Fastify from 'fastify'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'))
process.env.JWT_SECRET ||= 'storage-size-fixture-only'
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { isSystemDiskPool } = await import('../src/db/storage-pools.js')
const { default: routes } = await import('../src/routes/hosts.js')
const { closeAllClients } = await import('../src/lib/incus/incus-pool.js')
const prefix = `storage-size-${randomUUID().slice(0, 8)}`
const directory = await mkdtemp(join(tmpdir(), prefix))
const keyPath = join(directory, 'key.pem'), certPath = join(directory, 'cert.pem')
execFileSync(process.env.REVIEW_OPENSSL || 'openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=storage-size-fixture',
  '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', keyPath, '-out', certPath], { stdio: 'pipe', windowsHide: true })
const certificate = await readFile(certPath, 'utf8')
const requests: Array<{ method: string; url: string; body?: any }> = []
const remotePools = new Map<string, { name: string; driver: string; description: string; config: Record<string, string> }>()
let remoteMode = 'normal'
const remote = createServer({ key: await readFile(keyPath), cert: certificate, ca: certificate, requestCert: true, rejectUnauthorized: true }, async (request, response) => {
  try {
    assert.ok((request.socket as any).authorized)
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(chunk)
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined
    requests.push({ method: request.method!, url: request.url!, body })
    const send = (status: number, metadata: unknown, error?: string) => {
      response.writeHead(status, { 'content-type': 'application/json', ...(remoteMode === 'no-etag' ? {} : { etag: '"fixture-version"' }) })
      response.end(JSON.stringify({ type: error ? 'error' : 'sync', metadata, error }))
    }
    if (request.url === '/1.0') { send(200, { api_version: '1.0' }); return }
    if (request.method === 'POST') {
      remotePools.set(body.name, { ...body, description: body.description ?? '' }); send(200, {}); return
    }
    const name = decodeURIComponent(request.url!.split('/').at(-1)!)
    const pool = remotePools.get(name)
    if (!pool) { send(404, {}, 'fixture pool not found'); return }
    if (request.method === 'GET') {
      if (remoteMode === 'read-error') { send(403, {}, 'fixture read denied'); return }
      send(200, pool); return
    }
    if (remoteMode === 'conflict') { send(412, {}, 'fixture config changed'); return }
    if (remoteMode === 'write-error') { send(500, {}, 'fixture update failed'); return }
    assert.equal(request.headers['if-match'], '"fixture-version"')
    remotePools.set(name, { ...pool, description: body.description ?? '', config: { ...pool.config, ...body.config } })
    send(200, {})
  } catch { response.writeHead(500); response.end('{}') }
})
await new Promise<void>(done => remote.listen(0, '127.0.0.1', done))
const owner = await prisma.user.create({ data: { username: prefix, passwordHash: 'unusable-fixture', role: 'admin' } })
const host = await prisma.host.create({ data: { userId: owner.id, name: prefix, url: `https://127.0.0.1:${(remote.address() as { port: number }).port}`, status: 'online', certPath, keyPath, serverCertificate: certificate, serverFingerprint: new X509Certificate(certificate).fingerprint256 } })
const app = Fastify()
app.decorate('authenticate', async (request: any) => { request.user = { id: owner.id, role: 'admin', username: prefix } })
app.decorate('authenticateUser', app.authenticate); app.decorate('authenticateAdmin', app.authenticate); app.decorate('requireAdmin', async () => {})
await app.register(routes, { prefix: '/hosts' }); await app.ready()
let failure: unknown
try {
  const invalid = ['', '0', '0GiB', '-1GiB', '+1GiB', '1.5GiB', '1e2GiB', '1GG', 'NaN', 'Infinity', '1giB', '999999999999999999999GiB', '8388608TiB', '1 GiB', '2GiBjunk']
  for (const method of ['POST', 'PATCH'] as const) {
    for (const size of invalid) {
      const before = requests.length
      const response = await app.inject({ method, url: `/hosts/${host.id}/storage-pools${method === 'PATCH' ? '/fixture-pool' : ''}`,
        payload: method === 'POST' ? { name: 'fixture-pool', driver: 'lvm', useLoop: true, size } : { size, description: '' } })
      assert.equal(response.statusCode, 400, `${method} invalid capacity ${size}: ${response.body}`)
      assert.equal(requests.length, before, 'invalid size cannot reach Incus')
      assert.equal(await prisma.storagePool.count({ where: { hostId: host.id } }), 0)
    }
  }
  const valid = ['1GiB', '2TiB', '1649267441664B', '10GB', '2048MiB', ' 1GiB ', '9223372036854775807B']
  for (const method of ['POST', 'PATCH'] as const) {
    for (const size of valid) {
      const name = `fixture-${method.toLowerCase()}-${valid.indexOf(size)}`
      if (method === 'PATCH') {
        const prepare = await app.inject({ method: 'POST', url: `/hosts/${host.id}/storage-pools`, payload: { name, driver: 'lvm', useLoop: true, size: '1B' } })
        assert.equal(prepare.statusCode, 201)
      }
      const response = await app.inject({ method, url: `/hosts/${host.id}/storage-pools${method === 'PATCH' ? `/${name}` : ''}`,
        payload: method === 'POST' ? { name, driver: 'lvm', useLoop: true, size } : { size } })
      assert.equal(response.statusCode, method === 'POST' ? 201 : 200, `${method} valid capacity: ${response.body}`)
      assert.equal(requests.at(-1)?.body?.config.size, size.trim())
    }
  }
  const description = await app.inject({ method: 'PATCH', url: `/hosts/${host.id}/storage-pools/fixture-post-0`, payload: { description: '' } })
  assert.equal(description.statusCode, 200); assert.equal(requests.at(-1)?.body?.description, '')
  assert.equal(requests.at(-1)?.body?.config, undefined, 'omitted size remains absent')
  const poolKey = { hostId_name: { hostId: host.id, name: 'fixture-post-0' } }
  const otherBefore = await prisma.storagePool.findMany({ where: { hostId: host.id, name: { not: 'fixture-post-0' } }, orderBy: { id: 'asc' } })
  const poolBefore = await prisma.storagePool.findUniqueOrThrow({ where: poolKey })
  for (const purpose of ['instance_storage', 'instance_data'] as const) {
    const remoteBefore = requests.length
    const response = await app.inject({ method: 'PATCH', url: `/hosts/${host.id}/storage-pools/fixture-post-0`, payload: { purpose } })
    assert.equal(response.statusCode, 200)
    const pool = await prisma.storagePool.findUniqueOrThrow({ where: poolKey })
    assert.equal(pool.purpose, purpose, 'successful update must persist the selected purpose')
    assert.equal(await isSystemDiskPool(host.id, pool.name), purpose === 'instance_data', 'new system disk selection follows the saved purpose')
    assert.deepEqual(pool.config, poolBefore.config, 'purpose does not change the existing pool configuration')
    assert.equal(pool.description, '')
    assert.equal(requests.at(-1)?.body?.purpose, undefined, 'purpose is platform metadata, not an Incus setting')
    assert.equal(requests.length, remoteBefore, 'purpose alone does not clear the remote description through an empty PATCH')
  }
  const combined = await app.inject({ method: 'PATCH', url: `/hosts/${host.id}/storage-pools/fixture-post-0`,
    payload: { purpose: 'instance_storage', description: 'storage-only fixture' } })
  assert.equal(combined.statusCode, 200)
  assert.equal((await prisma.storagePool.findUniqueOrThrow({ where: poolKey })).purpose, 'instance_storage')
  assert.equal((await prisma.storagePool.findUniqueOrThrow({ where: poolKey })).description, 'storage-only fixture')
  const omitted = await app.inject({ method: 'PATCH', url: `/hosts/${host.id}/storage-pools/fixture-post-0`, payload: { description: '' } })
  assert.equal(omitted.statusCode, 200)
  assert.equal((await prisma.storagePool.findUniqueOrThrow({ where: poolKey })).purpose, 'instance_storage', 'omission preserves the selected purpose')
  assert.deepEqual(await prisma.storagePool.findMany({ where: { hostId: host.id, name: { not: 'fixture-post-0' } }, orderBy: { id: 'asc' } }), otherBefore)
  const beforeInvalidPurpose = requests.length
  const invalidPurpose = await app.inject({ method: 'PATCH', url: `/hosts/${host.id}/storage-pools/fixture-post-0`, payload: { purpose: 'invalid' } })
  assert.equal(invalidPurpose.statusCode, 400); assert.equal(requests.length, beforeInvalidPurpose)
  for (const [mode, expectedStatus] of [['conflict', 409], ['no-etag', 502], ['read-error', 500], ['write-error', 500]] as const) {
    remoteMode = mode
    const databaseBefore = await prisma.storagePool.findUniqueOrThrow({ where: poolKey })
    const logCount = await prisma.log.count({ where: { userId: owner.id } })
    const response = await app.inject({ method: 'PATCH', url: `/hosts/${host.id}/storage-pools/fixture-post-0`,
      payload: { description: 'must not persist', purpose: 'instance_data' } })
    assert.equal(response.statusCode, expectedStatus, `${mode}: ${response.body}`)
    if (mode === 'conflict') assert.equal(response.json().code, 'STORAGE_POOL_CONFIG_CHANGED')
    assert.deepEqual(await prisma.storagePool.findUniqueOrThrow({ where: poolKey }), databaseBefore, `${mode} preserves database metadata`)
    assert.equal(await prisma.log.count({ where: { userId: owner.id } }), logCount, `${mode} does not record success`)
  }
  remoteMode = 'normal'
  console.log('PASS storage update API conflict/error responses preserve local metadata and success logs')
  console.log('PASS storage purpose persists in both directions, controls new system disk eligibility and preserves omitted fields/other pools')
  console.log('PASS storage size create/update API syntax, unit, signed-byte boundary and omission matrix over mTLS')
} catch (error) { failure = error } finally {
  await app.close()
  await closeAllClients()
  await new Promise<void>(done => remote.close(() => done()))
  const resolved = resolve(directory)
  assert.ok(resolved.startsWith(resolve(tmpdir()) + sep) && resolved.includes(prefix))
  await rm(resolved, { recursive: true, force: true })
  await prisma.log.deleteMany({ where: { userId: owner.id } })
  await prisma.storagePool.deleteMany({ where: { hostId: host.id } })
  await prisma.host.delete({ where: { id: host.id } })
  await prisma.user.delete({ where: { id: owner.id } })
  await closePrismaDatabase()
}
if (failure) { console.error(failure); process.exit(1) }
process.exit(0)
