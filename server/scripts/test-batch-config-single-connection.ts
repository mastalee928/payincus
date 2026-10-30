import assert from 'node:assert/strict'
import { randomUUID, X509Certificate } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import Fastify from 'fastify'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'),
  'Use isolated local *_pool_test PostgreSQL')
assert.equal(process.env.DB_POOL_MAX, '1', 'Exercise the actual route with one business connection')
const { prisma, closePrismaDatabase, getDbPoolStats } = await import('../src/db/prisma.js')
const { default: routes } = await import('../src/routes/batch-config.js')
const { closeAllClients } = await import('../src/lib/incus/incus-pool.js')
const tag = `batch-pool-${randomUUID()}`
const folder = await mkdtemp(join(tmpdir(), tag))
const keyPath = join(folder, 'key.pem'), certPath = join(folder, 'cert.pem')
execFileSync(process.env.REVIEW_OPENSSL || 'openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
  '-subj', '/CN=batch-pool-fixture', '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', keyPath, '-out', certPath],
  { stdio: 'pipe', windowsHide: true })
const certificate = await readFile(certPath, 'utf8')
const state = { name: tag, config: {} as Record<string, string>, devices: {
  root: { type: 'disk', path: '/', pool: 'fixture', size: '1024MB' },
  eth0: { type: 'nic', name: 'eth0', network: 'fixture' },
  eth1: { type: 'nic', nictype: 'routed', name: 'eth1', 'ipv6.address': '2001:db8::2' },
  'proxy-tcp-22': { type: 'proxy', listen: 'tcp:192.0.2.1:22', connect: 'tcp:10.0.0.2:22' }
} as Record<string, Record<string, string>> }
const writes: string[] = []
let failConnect = false
const remote = createServer({ key: await readFile(keyPath), cert: certificate, ca: certificate,
  requestCert: true, rejectUnauthorized: true }, async (request, reply) => {
  assert.ok((request.socket as any).authorized, 'Authenticated local TLS fixture')
  reply.setHeader('content-type', 'application/json')
  if (request.url === '/1.0') {
    if (failConnect) { reply.statusCode = 500; return reply.end(JSON.stringify({ type: 'error', error: 'controlled connect failure', error_code: 500 })) }
    return reply.end(JSON.stringify({ type: 'sync', metadata: { api_version: '1.0' } }))
  }
  assert.equal(request.url, `/1.0/instances/${tag}`, 'Only the isolated fixture instance is touched')
  if (request.method === 'GET') return reply.end(JSON.stringify({ type: 'sync', metadata: state }))
  assert.ok(['PATCH', 'PUT'].includes(request.method!))
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  const body = JSON.parse(Buffer.concat(chunks).toString())
  writes.push(request.method!)
  Object.assign(state.config, body.config)
  if (body.devices) state.devices = request.method === 'PUT' ? body.devices : { ...state.devices, ...body.devices }
  return reply.end(JSON.stringify({ type: 'sync', metadata: {} }))
})
await new Promise<void>(resolve => remote.listen(0, '127.0.0.1', resolve))
const app = Fastify()
let actorId: number | undefined, hostId: number | undefined, instanceId: number | undefined
try {
const actor = await prisma.user.create({ data: { username: tag, role: 'admin', passwordHash: 'unusable-fixture' } })
actorId = actor.id
const host = await prisma.host.create({ data: { userId: actor.id, name: tag, status: 'online', singleTenant: true,
  url: `https://127.0.0.1:${(remote.address() as { port: number }).port}`, certPath, keyPath,
  serverCertificate: certificate, serverFingerprint: new X509Certificate(certificate).fingerprint256,
  cpuAllowanceMax: 1000, memoryMax: 4096, customerDiskGiB: 8,
  cpuUsed: 100, memoryUsed: 512, diskUsed: 1024 } })
hostId = host.id
const instance = await prisma.instance.create({ data: { userId: actor.id, hostId: host.id, name: tag, incusId: tag,
  image: 'fixture/debian', status: 'running', cpu: 100, memory: 512, disk: 1024,
  dedicatedIpv4: true, dedicatedNetworkReady: true, ipv4: '10.0.0.2', ipv6: '2001:db8::2' } })
instanceId = instance.id
app.decorate('authenticate', async (request: any) => {
  request.user = { id: actor.id, username: actor.username, role: actor.role, sid: tag, iat: Math.floor(Date.now() / 1000) + 10 }
})
await app.register(routes, { prefix: '/hosts' })
const submit = (config: Record<string, unknown>) => app.inject({ method: 'POST',
  url: `/hosts/${host.id}/instances/batch-config`, payload: { instanceIds: [instance.id], config } })
async function reclaimed() {
  const deadline = Date.now() + 2000
  while (getDbPoolStats().idleCount !== 1 && Date.now() < deadline) await delay(10)
  assert.deepEqual(getDbPoolStats(), { totalCount: 1, idleCount: 1, waitingCount: 0 })
  const sessions = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND state LIKE 'idle in transaction%'
  `
  assert.equal(Number(sessions[0].count), 0, 'No abandoned PG transaction')
}
  const devicesBefore = structuredClone(state.devices)
  const result = await submit({ cpu: 200, memory: 768, disk: 2048, limitsProcesses: 800, snapshotLimit: 7 })
  assert.equal(result.statusCode, 200, result.body)
  assert.equal(result.json().successCount, 1, result.body)
  assert.deepEqual(writes, ['PATCH', 'PUT'], 'Cold host connect, resource update and advanced update complete once')
  const updated = await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })
  assert.deepEqual([updated.cpu, updated.memory, updated.disk, updated.snapshotLimit], [200, 768, 2048, 7])
  const currentHost = await prisma.host.findUniqueOrThrow({ where: { id: host.id } })
  assert.deepEqual([currentHost.cpuUsed, currentHost.memoryUsed, currentHost.diskUsed], [200, 768, 2048])
  for (const key of ['hostId', 'userId', 'incusId', 'ipv4', 'ipv6', 'dedicatedIpv4', 'dedicatedNetworkReady', 'billingPrice', 'expiresAt'] as const) {
    assert.deepEqual(updated[key], instance[key])
  }
  for (const key of ['eth0', 'eth1', 'proxy-tcp-22']) assert.deepEqual(state.devices[key], devicesBefore[key])
  await reclaimed()
  await closeAllClients()
  failConnect = true
  const rejected = await submit({ cpu: 300 })
  assert.equal(rejected.json().failedCount, 1, rejected.body)
  assert.equal(rejected.json().failedItems[0].requiresReview, false)
  assert.match(rejected.json().failedItems[0].error, /controlled connect failure/)
  assert.deepEqual(writes, ['PATCH', 'PUT'], 'Failed connect cannot dispatch resource writes')
  assert.deepEqual(await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } }), updated)
  await reclaimed()
  failConnect = false
  assert.equal((await submit({ cpu: 300 })).json().successCount, 1)
  assert.equal((await prisma.host.findUniqueOrThrow({ where: { id: host.id } })).cpuUsed, 300)
  await reclaimed()
  console.log('PASS batch config: one PostgreSQL connection, cold mTLS host, resource/advanced updates, failure rollback/retry, current accounting and dedicated network preservation')
} finally {
  await app.close(); await closeAllClients()
  if (actorId !== undefined) await prisma.log.deleteMany({ where: { userId: actorId } })
  if (instanceId !== undefined) await prisma.instance.delete({ where: { id: instanceId } })
  if (hostId !== undefined) await prisma.host.delete({ where: { id: hostId } })
  if (actorId !== undefined) await prisma.user.delete({ where: { id: actorId } })
  await closePrismaDatabase()
  await new Promise<void>(resolve => remote.close(() => resolve()))
  await rm(folder, { recursive: true, force: true })
}
process.exit(0)
