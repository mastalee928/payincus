import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import Fastify from 'fastify'
import pg from 'pg'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'))
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
// Import-only housekeeping intervals must not keep this isolated test alive.
const scheduleInterval = globalThis.setInterval
globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => {
  const timer = scheduleInterval(...args); timer.unref(); return timer
}) as typeof setInterval
try { await import('../src/lib/security.js') } finally { globalThis.setInterval = scheduleInterval }
const { default: routes } = await import('../src/routes/host-port-protocol.js')
const tag = `protocol-${randomUUID().slice(0, 8)}`
const admin = await prisma.user.create({ data: { username: tag, passwordHash: 'unusable-fixture', role: 'admin' } })
const hosts = await Promise.all([true, true, false].map((supported, i) => prisma.host.create({ data: {
  userId: admin.id, name: `${tag}-${i}`, url: 'https://127.0.0.1:1', portProtocol: 'tcp', portProtocolApplied: 'tcp',
  portProtocolRevision: 1, portProtocolAppliedRevision: 1, agent: { create: { agentId: `${tag}-${i}`, secretHash: 'unused', secretEncrypted: 'unused',
    capabilities: supported ? ['ingress-port-protocol-v1'] : [], enabled: true } }
} })))
const actor = { id: admin.id, role: 'admin', username: admin.username, sid: tag, iat: Math.floor(Date.now() / 1000) + 1 }
const app = Fastify()
app.decorate('authenticateAdmin', async (request: any) => { request.user = { ...actor } })
await app.register(routes, { prefix: '/hosts' })
const batch = (hostIds: number[], protocol = 'tcp_udp') => app.inject({ method: 'PATCH', url: '/hosts/port-protocol/batch', payload: { hostIds, protocol } })
const read = (index: number) => prisma.host.findUniqueOrThrow({ where: { id: hosts[index].id } })
const trigger = `protocol_audit_${randomUUID().replaceAll('-', '')}`
let triggerInstalled = false
try {
  for (const ids of [[], [hosts[0].id, hosts[0].id], [hosts[0].id, 0], [2147483648], Array.from({ length: 101 }, (_, i) => i + 1)]) {
    assert.equal((await batch(ids)).statusCode, 400)
  }
  assert.equal((await batch([hosts[0].id], 'udp')).statusCode, 400)
  assert.equal((await read(0)).portProtocolRevision, 1, 'invalid input changes no host')
  const response = await batch(hosts.map(host => host.id))
  assert.equal(response.statusCode, 200, response.body)
  assert.deepEqual(response.json().results.map((result: any) => [result.id, result.success]), hosts.map((host, index) => [host.id, index < 2]))
  assert.equal(response.json().results[2].code, 'HOST_AGENT_UPGRADE_REQUIRED')
  assert.deepEqual(response.json().results[0].protocol, { requested: 'tcp_udp', applied: 'tcp', status: 'pending' })
  assert.equal((await read(2)).portProtocolRevision, 1)
  assert.equal(await prisma.log.count({ where: { userId: admin.id, action: 'host.port_protocol.update' } }), 2)
  // Switching to TCP is an explicit write, not an automatic default on existing hosts.
  const single = await app.inject({ method: 'PATCH', url: `/hosts/${hosts[0].id}/port-protocol`, payload: { protocol: 'tcp' } })
  assert.equal(single.statusCode, 200, single.body)
  assert.equal((await read(0)).portProtocolRevision, 3)
  assert.equal((await read(1)).portProtocol, 'tcp_udp', 'unselected host keeps its choice')
  await prisma.$executeRawUnsafe(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.user_id = ${admin.id} AND NEW.action = 'host.port_protocol.update' THEN RAISE EXCEPTION 'fixture-protocol-audit-failure'; END IF; RETURN NEW; END $$`)
  await prisma.$executeRawUnsafe(`CREATE TRIGGER ${trigger} BEFORE INSERT ON logs FOR EACH ROW EXECUTE FUNCTION ${trigger}()`)
  triggerInstalled = true
  const failed = await batch([hosts[0].id])
  assert.equal(failed.json().results[0].success, false)
  assert.equal((await read(0)).portProtocol, 'tcp')
  assert.equal((await read(0)).portProtocolRevision, 3, 'audit failure rolls the desired revision back')
  await prisma.$executeRawUnsafe(`DROP TRIGGER ${trigger} ON logs`)
  await prisma.$executeRawUnsafe(`DROP FUNCTION ${trigger}()`)
  triggerInstalled = false
  // Revoke while a real host row lock holds the requested update in flight.
  const blocker = new pg.Client({ connectionString: database.href })
  await blocker.connect(); await blocker.query('BEGIN')
  const { rows: [pid] } = await blocker.query('SELECT pg_backend_pid() AS id')
  await blocker.query('SELECT id FROM hosts WHERE id = $1 FOR UPDATE', [hosts[0].id])
  const inflight = batch([hosts[0].id]).then(value => value)
  try {
    let waiting = false
    const deadline = Date.now() + 1500
    while (Date.now() < deadline) {
      const [row] = await prisma.$queryRaw<Array<{ waiting: boolean }>>`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE ${pid.id}::int = ANY(pg_blocking_pids(pid))) AS waiting`
      if (row.waiting) { waiting = true; break }
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    assert.ok(waiting, 'update must wait on the actual host lock')
    await prisma.tokenInvalidation.create({ data: { userId: admin.id, sessionId: tag, invalidatedAt: actor.iat } })
  } finally { await blocker.query('ROLLBACK'); await blocker.end() }
  assert.equal((await inflight).json().results[0].code, 'FORBIDDEN')
  assert.equal((await read(0)).portProtocolRevision, 3)
  await prisma.tokenInvalidation.deleteMany({ where: { userId: admin.id } })
  await prisma.user.update({ where: { id: admin.id }, data: { role: 'user' } })
  assert.equal((await batch([hosts[0].id])).json().results[0].code, 'FORBIDDEN')
  console.log('PASS host protocol validation, partial batch, explicit TCP choice, pending receipts, audit rollback and in-flight revocation; no live host writes')
} finally {
  if (triggerInstalled) { await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${trigger} ON logs`); await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${trigger}()`) }
  await app.close()
  await prisma.log.deleteMany({ where: { userId: admin.id } })
  await prisma.host.deleteMany({ where: { id: { in: hosts.map(host => host.id) } } })
  await prisma.tokenInvalidation.deleteMany({ where: { userId: admin.id } })
  await prisma.user.delete({ where: { id: admin.id } })
  await closePrismaDatabase()
}
