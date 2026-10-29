import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { randomUUID } from 'node:crypto'
const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'), 'Use isolated local *_pool_test PostgreSQL')
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { default: snapshotRoutes } = await import('../src/routes/snapshots.js')
const tag = 'snapshot-schedule-' + randomUUID(), sid = randomUUID(), iat = Math.floor(Date.now() / 1000) + 1
const owner = await prisma.user.create({ data: { username: tag, passwordHash: 'unusable-fixture' } })
const outsider = await prisma.user.create({ data: { username: tag + '-other', passwordHash: 'unusable-fixture' } })
const host = await prisma.host.create({ data: { userId: owner.id, name: tag, url: 'https://127.0.0.1:1', status: 'online' } })
const instance = await prisma.instance.create({ data: { userId: owner.id, hostId: host.id, name: tag, incusId: tag, image: 'fixture/debian', status: 'running', cpu: 100, memory: 512, disk: 1024, snapshotLimit: 1 } })
const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } })
app.decorate('authenticateUser', async (request: any) => { const actor = request.headers['x-test-outsider'] ? outsider : owner; request.user = { id: actor.id, username: actor.username, role: actor.role, sid, iat } })
await app.register(snapshotRoutes, { prefix: '/instances' })
const update = (enabled: boolean, intervalMinutes: number, outsider = false) => app.inject({ method: 'PUT', url: `/instances/${instance.id}/snapshot-policy`, headers: outsider ? { 'x-test-outsider': '1' } : {}, payload: { enabled, intervalMinutes } })
const read = () => prisma.snapshotPolicy.findUniqueOrThrow({ where: { instanceId: instance.id } })
const oldRun = new Date(Date.now() - 3600000), oldNext = new Date(Date.now() + 600000)
try {
  const frozen = await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })
  for (const [previousInterval, interval] of [[10, 1440], [1440, 10], [60, 360]]) {
    await prisma.snapshotPolicy.upsert({ where: { instanceId: instance.id }, create: { instanceId: instance.id, enabled: true, intervalMinutes: previousInterval, lastRunAt: oldRun, nextRunAt: oldNext }, update: { enabled: true, intervalMinutes: previousInterval, lastRunAt: oldRun, nextRunAt: oldNext } })
    const before = Date.now(), result = await update(true, interval), after = Date.now()
    assert.equal(result.statusCode, 200, result.body)
    const policy = await read()
    assert.equal(policy.enabled, true); assert.equal(policy.intervalMinutes, interval); assert.equal(policy.lastRunAt?.getTime(), oldRun.getTime())
    assert.ok(policy.nextRunAt && policy.nextRunAt.getTime() >= before + interval * 60000 && policy.nextRunAt.getTime() <= after + interval * 60000, 'changed interval schedules from the successful current update')
  }
  const unchanged = await read(); assert.equal((await update(true, unchanged.intervalMinutes)).statusCode, 200)
  assert.equal((await read()).nextRunAt?.getTime(), unchanged.nextRunAt?.getTime(), 'unchanged enabled save keeps its scheduled time')
  assert.equal((await update(false, 60)).statusCode, 200); assert.equal((await read()).nextRunAt, null, 'disabled policy has no next run')
  const beforeEnable = Date.now(); assert.equal((await update(true, 60)).statusCode, 200)
  assert.ok((await read()).nextRunAt!.getTime() >= beforeEnable + 60 * 60000, 're-enabled policy gets a fresh schedule')
  const baseline = await read()
  assert.equal((await update(true, 61)).statusCode, 400); assert.deepEqual(await read(), baseline, 'invalid interval does not change the schedule')
  assert.equal((await update(true, 10, true)).statusCode, 403); assert.deepEqual(await read(), baseline, 'another account cannot update the schedule')
  await prisma.tokenInvalidation.create({ data: { userId: owner.id, sessionId: sid, invalidatedAt: iat } })
  assert.equal((await update(true, 10)).statusCode, 403); assert.deepEqual(await read(), baseline, 'revoked current actor cannot update the schedule')
  assert.deepEqual(await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } }), frozen, 'policy updates preserve all instance identity, disk, billing and inventory fields')
  assert.equal(await prisma.snapshot.count({ where: { instanceId: instance.id } }), 0)
  console.log('PASS actual Fastify/PG snapshot changed intervals, unchanged save, disable/re-enable, invalid/other/revoked account gates; no Incus or instance writes')
} finally {
  await app.close(); await prisma.snapshotPolicy.deleteMany({ where: { instanceId: instance.id } }); await prisma.instance.delete({ where: { id: instance.id } }); await prisma.host.delete({ where: { id: host.id } }); await prisma.user.deleteMany({ where: { id: { in: [owner.id, outsider.id] } } }); await closePrismaDatabase()
}
process.exit(0)
