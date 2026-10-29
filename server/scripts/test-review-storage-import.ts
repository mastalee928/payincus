import assert from 'node:assert/strict'
import { randomUUID, X509Certificate } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:https'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import Fastify from 'fastify'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['postgres:', 'postgresql:'].includes(database.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) &&
  /^\/[a-zA-Z0-9_]+_pool_test$/.test(database.pathname) && !database.search && !database.hash)
process.env.JWT_SECRET ||= 'storage-import-fixture-only'
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { default: routes } = await import('../src/routes/hosts.js')
const { closeAllClients } = await import('../src/lib/incus/incus-pool.js')
const prefix = `storage-import-${randomUUID().slice(0, 8)}`
const directory = await mkdtemp(join(tmpdir(), prefix))
const keyPath = join(directory, 'key.pem'), certPath = join(directory, 'cert.pem')
execFileSync(process.env.REVIEW_OPENSSL || 'openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=storage-import-fixture',
  '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', keyPath, '-out', certPath], { stdio: 'pipe', windowsHide: true })
const certificate = await readFile(certPath, 'utf8')
let mode = 'forbidden', posts = 0, reads = 0
const remotePools = new Map<string, any>()
const remote = createServer({ key: await readFile(keyPath), cert: certificate, ca: certificate, requestCert: true, rejectUnauthorized: true }, async (request, response) => {
  try {
    assert.ok((request.socket as any).authorized)
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(chunk)
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined
    const send = (status: number, metadata: unknown, error?: string) => {
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ type: error ? 'error' : 'sync', metadata, error }))
    }
    if (request.url === '/1.0') { send(200, { api_version: '1.0' }); return }
    if (request.method === 'POST') {
      posts++
      if (mode === 'create-error') { send(500, {}, 'fixture import failed'); return }
      remotePools.set(body.name, { name: body.name, driver: body.driver, description: body.description ?? '', config: body.config })
      send(200, {}); return
    }
    reads++
    const name = decodeURIComponent(request.url!.split('/').at(-1)!)
    if (mode === 'disconnect') { request.socket.destroy(); return }
    if (mode === 'forbidden') { send(403, {}, 'fixture storage forbidden'); return }
    if (mode === 'server-error') { send(500, {}, 'fixture storage failed'); return }
    if (mode === 'wrong-name') { send(200, { name: 'different-pool', driver: 'lvm', config: {} }); return }
    if (mode === 'bad-config') { send(200, { name, driver: 'lvm', config: [] }); return }
    if (mode === 'missing-driver') { send(200, { name, config: {} }); return }
    if (mode === 'verify-error' && remotePools.has(name)) { send(500, {}, 'fixture verification failed'); return }
    const pool = remotePools.get(name)
    if (!pool) { send(404, {}, 'fixture pool absent'); return }
    send(200, pool)
  } catch { response.writeHead(500); response.end('{}') }
})
await new Promise<void>(done => remote.listen(0, '127.0.0.1', done))
const owner = await prisma.user.create({ data: { username: prefix, passwordHash: 'unusable-fixture', role: 'admin' } })
const host = await prisma.host.create({ data: { userId: owner.id, name: prefix, url: `https://127.0.0.1:${(remote.address() as { port: number }).port}`, status: 'online',
  certPath, keyPath, serverCertificate: certificate, serverFingerprint: new X509Certificate(certificate).fingerprint256 } })
const app = Fastify()
app.decorate('authenticate', async (request: any) => { request.user = { id: owner.id, role: 'admin', username: prefix } })
app.decorate('authenticateUser', app.authenticate); app.decorate('authenticateAdmin', app.authenticate); app.decorate('requireAdmin', async () => {})
await app.register(routes, { prefix: '/hosts' }); await app.ready()
const submit = (name: string) => app.inject({ method: 'POST', url: `/hosts/${host.id}/storage-pools`,
  payload: { name, driver: 'lvm', useExisting: true, existingSource: 'fixture-vg', purpose: 'instance_storage' } })
let failure: unknown
try {
  for (const state of ['forbidden', 'server-error', 'disconnect', 'wrong-name', 'bad-config', 'missing-driver']) {
    mode = state
    const before = posts
    const response = await submit(`fixture-${state}`)
    assert.equal(posts, before, `${state} cannot trigger storage import`)
    assert.equal(response.statusCode, 500, response.body)
    assert.equal(await prisma.storagePool.count({ where: { hostId: host.id } }), 0)
    assert.equal(await prisma.log.count({ where: { userId: owner.id } }), 0)
  }
  mode = 'normal'
  remotePools.set('existing-pool', { name: 'existing-pool', driver: 'zfs', description: 'existing description', config: { source: 'existing-source' } })
  const beforeExisting = posts
  assert.equal((await submit('existing-pool')).statusCode, 201)
  assert.equal(posts, beforeExisting)
  const linked = await prisma.storagePool.findUniqueOrThrow({ where: { hostId_name: { hostId: host.id, name: 'existing-pool' } } })
  assert.equal(linked.driver, 'zfs'); assert.deepEqual(linked.config, { source: 'existing-source' }); assert.equal(linked.purpose, 'instance_storage')
  const beforeDuplicate = reads
  assert.equal((await submit('existing-pool')).statusCode, 400); assert.equal(reads, beforeDuplicate)
  assert.equal((await submit('new-import')).statusCode, 201)
  assert.equal(posts, beforeExisting + 1)
  assert.deepEqual((await prisma.storagePool.findUniqueOrThrow({ where: { hostId_name: { hostId: host.id, name: 'new-import' } } })).config,
    { source: 'fixture-vg', 'lvm.use_thinpool': 'false' })
  for (const state of ['create-error', 'verify-error']) {
    mode = state
    const logsBefore = await prisma.log.count({ where: { userId: owner.id } })
    assert.equal((await submit(`fixture-${state}`)).statusCode, 500)
    assert.equal(await prisma.storagePool.count({ where: { hostId: host.id, name: `fixture-${state}` } }), 0)
    assert.equal(await prisma.log.count({ where: { userId: owner.id } }), logsBefore)
  }
  console.log('PASS only exact storage 404 enters import; transport/auth/server/malformed metadata rejected without mutation; existing link, import verification, duplicate and failure persistence over real PG/Fastify/mTLS')
} catch (error) { failure = error } finally {
  await app.close(); await closeAllClients(); remote.closeAllConnections()
  await new Promise<void>(done => remote.close(() => done()))
  const target = resolve(directory)
  assert.ok(target.startsWith(resolve(tmpdir()) + sep) && target.includes(prefix))
  await rm(target, { recursive: true, force: true })
  await prisma.log.deleteMany({ where: { userId: owner.id } })
  await prisma.storagePool.deleteMany({ where: { hostId: host.id } })
  await prisma.host.delete({ where: { id: host.id } }); await prisma.user.delete({ where: { id: owner.id } })
  await closePrismaDatabase()
}
if (failure) { console.error(failure); process.exit(1) }
process.exit(0)
