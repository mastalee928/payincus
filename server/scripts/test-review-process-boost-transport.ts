import assert from 'node:assert/strict'
import { randomUUID, X509Certificate } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:https'
import { resolve, sep } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import Fastify from 'fastify'
const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'))
assert.equal(process.env.DB_POOL_MAX, '1', 'Use one business connection')
process.env.NODE_ENV = 'test'
const { prisma, closePrismaDatabase, getDbPoolStats } = await import('../src/db/prisma.js')
const { default: routes } = await import('../src/routes/instances.js')
const { closeAllClients } = await import('../src/lib/incus/incus-pool.js')
const { stopSessionCleanup } = await import('../src/lib/terminal-proxy.js')
const tag = 'boost-wire-' + randomUUID()
const root = resolve(process.cwd(), 'logs')
await mkdir(root, { recursive: true })
const folder = await mkdtemp(resolve(root, tag))
assert.ok(resolve(folder).startsWith(root + sep))
const keyPath = resolve(folder, 'key.pem'), certPath = resolve(folder, 'cert.pem')
execFileSync(process.env.REVIEW_OPENSSL || 'openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
  '-subj', '/CN=boost-wire-fixture', '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', keyPath, '-out', certPath],
  { stdio: 'pipe', windowsHide: true })
const certificate = await readFile(certPath, 'utf8')
const fingerprint = new X509Certificate(certificate).fingerprint256
const config: Record<string, string> = { 'limits.processes': '500', 'user.marker': tag }
const devices = { eth0: { type: 'nic', name: 'eth0' }, root: { type: 'disk', path: '/', pool: 'fixture' } }
const sockets = new Set<import('node:stream').Duplex>()
let mode = 'success', writes = 0, reads = 0, connects = 0, applied = 0
const remote = createServer({ key: await readFile(keyPath), cert: certificate, ca: certificate,
  requestCert: true, rejectUnauthorized: true }, async (request, reply) => {
  assert.ok((request.socket as any).authorized, 'mTLS client must authenticate')
  reply.setHeader('content-type', 'application/json')
  const sync = (metadata: unknown) => reply.end(JSON.stringify({ type: 'sync', metadata }))
  const error = (message: string) => { reply.statusCode = 500; reply.end(JSON.stringify({ type: 'error', error: message, error_code: 500 })) }
  if (request.url === '/1.0') {
    connects++
    if (mode === 'connect-stall') return
    return sync({ api_version: '1.0' })
  }
  if (request.url === '/1.0/operations?recursion=1') return sync([])
  assert.equal(request.url, `/1.0/instances/${tag}`)
  if (request.method === 'GET') { reads++; return sync({ name: tag, config, devices }) }
  assert.equal(request.method, 'PUT'); writes++
  const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk))
  const body = JSON.parse(Buffer.concat(chunks).toString()); assert.deepEqual(body.devices, devices)
  if (mode === 'reject') return error('controlled PUT rejection')
  if (mode === 'busy-stall') return error('Instance is busy running a "update" operation')
  Object.assign(config, body.config); applied++
  if (mode === 'body-stall') { reply.writeHead(200); reply.write('{"type":"sync","metadata":'); return }
  return sync({})
})
remote.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
await new Promise<void>(done => remote.listen(0, '127.0.0.1', done))
const admin = await prisma.user.create({ data: { username: tag, passwordHash: 'unusable-fixture', role: 'admin' } })
const host = await prisma.host.create({ data: { userId: admin.id, name: tag,
  url: `https://127.0.0.1:${(remote.address() as { port: number }).port}`, certPath, keyPath,
  serverCertificate: certificate, serverFingerprint: fingerprint } })
const instance = await prisma.instance.create({ data: { userId: admin.id, hostId: host.id, name: tag, incusId: tag,
  image: 'fixture/debian', status: 'running', cpu: 100, memory: 512, disk: 1024, limitsProcesses: null } })
const app = Fastify()
app.decorate('authenticate', async (request: any) => {
  request.user = { id: admin.id, username: admin.username, role: 'admin', sid: tag, iat: Math.floor(Date.now() / 1000) + 10 }
})
app.decorate('authenticateAdmin', app.authenticate); app.decorate('authenticateUser', app.authenticate)
const submit = () => app.inject({ method: 'POST', url: `/instances/${instance.id}/boost-processes`, payload: {} })
async function reclaimed() {
  for (const until = Date.now() + 3000; Date.now() < until && (sockets.size || getDbPoolStats().idleCount !== 1);) await delay(10)
  assert.equal(sockets.size, 0, 'all owned mTLS sockets close before the result settles')
  assert.deepEqual(getDbPoolStats(), { totalCount: 1, idleCount: 1, waitingCount: 0 })
  const [row] = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND state LIKE 'idle in transaction%'`
  assert.equal(Number(row.count), 0)
}
let failure: unknown
try {
  await app.register(routes, { prefix: '/instances' })
  assert.equal((await submit()).statusCode, 200)
  assert.equal(config['limits.processes'], '1000'); assert.equal(config['user.marker'], tag)
  assert.deepEqual([connects, writes, applied], [1, 1, 1]); await reclaimed()
  await prisma.instance.update({ where: { id: instance.id }, data: { limitsProcesses: 650 } })
  mode = 'reject'
  const rejected = await submit(); assert.equal(rejected.statusCode, 500)
  assert.equal(rejected.json().details.databaseLimit, 650); await reclaimed()
  mode = 'success'; assert.equal((await submit()).statusCode, 200); await reclaimed()
  await prisma.instance.update({ where: { id: instance.id }, data: { limitsProcesses: null } })
  await prisma.host.update({ where: { id: host.id }, data: { serverFingerprint: 'invalid-fixture-pin' } })
  const beforePin = connects
  assert.equal((await submit()).statusCode, 500); assert.equal(connects, beforePin)
  await reclaimed(); await prisma.host.update({ where: { id: host.id }, data: { serverFingerprint: fingerprint } })
  console.log('PASS one PostgreSQL connection, cold mTLS success/rejection/retry, unchanged devices and pin mismatch rejection')
  for (const stalled of ['connect-stall', 'body-stall', 'busy-stall']) {
    mode = stalled
    await prisma.instance.update({ where: { id: instance.id }, data: { limitsProcesses: null } })
    const beforeWrites = writes, beforeApplied = applied, started = Date.now()
    const response = await submit(), elapsed = Date.now() - started
    assert.equal(response.statusCode, 500, response.body)
    assert.ok(elapsed >= 88000 && elapsed < 96000, stalled + ' shares the actual 90 second total deadline: ' + elapsed)
    assert.equal((await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })).limitsProcesses, null)
    if (stalled === 'connect-stall') assert.equal(writes, beforeWrites)
    else assert.equal(response.json().code, 'PROCESS_LIMIT_BOOST_PARTIAL_FAILURE')
    if (stalled === 'body-stall') assert.equal(applied, beforeApplied + 1)
    if (stalled === 'busy-stall') assert.equal(applied, beforeApplied)
    await reclaimed()
    const settledCounts = [connects, reads, writes, applied]
    await delay(2200); assert.deepEqual([connects, reads, writes, applied], settledCounts, 'zero late requests after deadline')
    console.log(`PASS ${stalled}: ${elapsed}ms, no abandoned transaction, all sockets closed, no late writes`)
  }
  mode = 'success'; assert.equal((await submit()).statusCode, 200); await reclaimed()
  console.log('PASS normal process update reuses the only DB connection after all timeout scenarios')
} catch (error) { failure = error }
finally {
  await app.close(); await closeAllClients(); stopSessionCleanup()
  for (const socket of sockets) socket.destroy()
  await new Promise<void>(done => remote.close(() => done()))
  await prisma.log.deleteMany({ where: { OR: [{ userId: admin.id }, { action: 'instance.boost_processes', content: { contains: `instance #${instance.id}:` } }] } })
  await prisma.instance.delete({ where: { id: instance.id } }); await prisma.host.delete({ where: { id: host.id } })
  await prisma.user.delete({ where: { id: admin.id } }); await closePrismaDatabase()
  assert.ok(resolve(folder).startsWith(root + sep)); await rm(folder, { recursive: true, force: true })
}
if (failure) { console.error(failure); process.exit(1) }; process.exit(0)
