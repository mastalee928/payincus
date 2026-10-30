import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import type { Prisma } from '@prisma/client'
import Fastify from 'fastify'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'))
process.env.JWT_SECRET ||= 'recalculate-fixture-only'
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { default: routes } = await import('../src/routes/hosts.js')
const prefix = `recalculate-${randomUUID().slice(0, 8)}`
const owner = await prisma.user.create({ data: { username: prefix, passwordHash: 'unusable-fixture' } })
const admin = await prisma.user.create({ data: { username: prefix + '-admin', passwordHash: 'unusable-fixture', role: 'admin' } })
const other = await prisma.user.create({ data: { username: prefix + '-other', passwordHash: 'unusable-fixture' } })
const ids = [owner.id, admin.id, other.id]
const initial = { cpuUsed: 1, memoryUsed: 2, diskUsed: 3, natPortsUsedCount: 4, cpuAllowanceMax: 5, memoryMax: 6 }
const expected = { cpuUsed: 100, memoryUsed: 512, diskUsed: 2048, natPortsUsedCount: 2, cpuAllowanceMax: 100, memoryMax: 512 }
const host = await prisma.host.create({ data: { userId: owner.id, name: prefix, url: 'https://127.0.0.1:1', ...initial } })
const instance = await prisma.instance.create({ data: { userId: owner.id, hostId: host.id, name: prefix, incusId: prefix,
  image: 'fixture/debian', status: 'stopped', cpu: 100, memory: 512, disk: 2048 } })
const deleted = await prisma.instance.create({ data: { userId: owner.id, hostId: host.id, name: prefix + '-deleted', incusId: prefix + '-deleted',
  image: 'fixture/debian', status: 'deleted', provisioningCleanupPending: true, cpu: 999, memory: 999, disk: 999 } })
await prisma.portMapping.createMany({ data: [
  { instanceId: instance.id, hostId: host.id, publicPort: 12001, privatePort: 22, protocol: 'tcp', systemManaged: true },
  { instanceId: instance.id, hostId: host.id, publicPort: 12001, privatePort: 22, protocol: 'udp' },
  { instanceId: deleted.id, hostId: host.id, publicPort: 12002, privatePort: 22, protocol: 'tcp' }
] })
const session = { id: owner.id, role: 'user', username: owner.username, sid: prefix, iat: Math.floor(Date.now() / 1000) + 1 }
let actor = { ...session }
const app = Fastify()
app.decorate('authenticate', async (request: any) => { request.user = { ...actor } })
app.decorate('authenticateUser', app.authenticate); app.decorate('authenticateAdmin', app.authenticate); app.decorate('requireAdmin', async () => {})
const run = (id: number | string = host.id) => app.inject({ method: 'POST', url: `/hosts/${id}/recalculate-resources` })
const read = () => prisma.host.findUniqueOrThrow({ where: { id: host.id } })
const resources = (value: Awaited<ReturnType<typeof read>>) => Object.fromEntries(Object.keys(initial).map(key => [key, value[key as keyof typeof initial]]))
const auditCount = () => prisma.log.count({ where: { userId: { in: ids }, action: 'host.recalculate_resources' } })
const reset = async () => {
  actor = { ...session }
  await prisma.tokenInvalidation.deleteMany({ where: { userId: { in: ids } } })
  await prisma.user.update({ where: { id: owner.id }, data: { status: 'active', role: 'user' } })
  await prisma.user.update({ where: { id: admin.id }, data: { status: 'active', role: 'admin' } })
  await prisma.host.update({ where: { id: host.id }, data: { userId: owner.id, name: prefix, ...initial } })
  await prisma.instance.update({ where: { id: instance.id }, data: { cpu: 100, memory: 512, disk: 2048 } })
  await prisma.log.deleteMany({ where: { userId: { in: ids } } })
}
async function race(mutate: (tx: Prisma.TransactionClient) => Promise<unknown>) {
  let release!: () => void, entered!: (pid: number) => void, rejectReady!: (error: unknown) => void
  const hold = new Promise<void>(resolve => { release = resolve })
  const ready = new Promise<number>((resolve, reject) => { entered = resolve; rejectReady = reject })
  const blocker = prisma.$transaction(async tx => {
    await mutate(tx)
    const [row] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`
    entered(row.pid); await hold
  }, { timeout: 15000 })
  void blocker.catch(rejectReady)
  const pid = await ready
  let settled = false, blocked = false
  const operation = run().then(response => { settled = true; return response })
  try {
    const end = Date.now() + 3500
    while (!settled && Date.now() < end) {
      const [row] = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))`
      if (Number(row.count)) { blocked = true; break }
      await delay(20)
    }
  } finally { release(); await blocker }
  return { response: await operation, blocked }
}
let failure: unknown
try {
  await app.register(routes, { prefix: '/hosts' })
  const trigger = `recalculate_${randomUUID().replaceAll('-', '')}`
  await prisma.$executeRawUnsafe(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.user_id = ${owner.id} AND NEW.action = 'host.recalculate_resources' THEN RAISE EXCEPTION 'fixture-recalculate-log-failure'; END IF; RETURN NEW; END $$`)
  await prisma.$executeRawUnsafe(`CREATE TRIGGER ${trigger} BEFORE INSERT ON logs FOR EACH ROW EXECUTE FUNCTION ${trigger}()`)
  try {
    const response = await run()
    assert.ok(response.statusCode >= 500, 'audit failure cannot report successful calibration: ' + response.body)
    assert.deepEqual(resources(await read()), initial, 'audit failure rolls back all six resource/quota values')
    assert.equal(await auditCount(), 0)
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER ${trigger} ON logs`)
    await prisma.$executeRawUnsafe(`DROP FUNCTION ${trigger}()`)
  }
  console.log('PASS audit failure rolls back all resource/quota updates')
  const first = await run()
  assert.equal(first.statusCode, 200, first.body)
  assert.deepEqual(first.json().before, initial)
  assert.deepEqual(first.json().after, expected)
  assert.deepEqual(first.json().diff, Object.fromEntries(Object.keys(initial).map(key => [key,
    expected[key as keyof typeof initial] - initial[key as keyof typeof initial]])))
  assert.equal(first.json().hasChanges, true)
  assert.deepEqual(resources(await read()), expected)
  assert.equal(await auditCount(), 1)
  assert.equal((await run()).json().hasChanges, false)
  console.log('PASS unchanged counting contract, all quotas, truthful before/after/diff and repeat')
  for (const mode of ['banned', 'role', 'session', 'all-sessions', 'host-owner', 'admin-role']) {
    await reset()
    if (mode === 'admin-role') actor = { ...session, id: admin.id, role: 'admin', username: admin.username }
    const result = await race(async tx => {
      if (mode === 'host-owner') await tx.host.update({ where: { id: host.id }, data: { userId: other.id } })
      else {
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${actor.id} FOR UPDATE`
        if (mode === 'banned') await tx.user.update({ where: { id: actor.id }, data: { status: 'banned' } })
        else if (mode === 'role' || mode === 'admin-role') await tx.user.update({ where: { id: actor.id }, data: { role: mode === 'role' ? 'admin' : 'user' } })
        else await tx.tokenInvalidation.create({ data: { userId: actor.id, sessionId: mode === 'session' ? prefix : '__USER_LEVEL__', invalidatedAt: session.iat } })
      }
    })
    assert.equal(result.blocked, true, mode + ': must actually wait on the changed row')
    assert.ok([403, 409].includes(result.response.statusCode), mode + ': ' + result.response.body)
    assert.deepEqual(resources(await read()), initial, mode)
    assert.equal(await auditCount(), 0, mode)
  }
  console.log('PASS queued host/account ownership, role, ban and both session revocations reject without writes')
  await reset()
  const newer = { cpuUsed: 250, memoryUsed: 768, diskUsed: 4096, natPortsUsedCount: 2, cpuAllowanceMax: 300, memoryMax: 1024 }
  const resourceRace = await race(async tx => {
    await tx.host.update({ where: { id: host.id }, data: newer })
    await tx.instance.update({ where: { id: instance.id }, data: { cpu: 250, memory: 768, disk: 4096 } })
  })
  assert.equal(resourceRace.blocked, true)
  assert.equal(resourceRace.response.statusCode, 200, resourceRace.response.body)
  assert.deepEqual(resourceRace.response.json().before, newer)
  assert.deepEqual(resources(await read()), { ...newer, cpuAllowanceMax: 250, memoryMax: 768 }, 'calibration uses the newly committed resource totals')
  assert.equal(await auditCount(), 1)
  const retry = await run()
  assert.equal(retry.statusCode, 200, retry.body)
  assert.equal(retry.json().hasChanges, false)
  assert.equal(retry.json().after.cpuUsed, 250)
  console.log('PASS real host/resource race reads committed resources and repeat has no differences')
  await reset()
  const instanceRace = await race(tx => tx.instance.update({ where: { id: instance.id }, data: { cpu: 175, memory: 640, disk: 3072 } }))
  assert.equal(instanceRace.blocked, true)
  assert.equal(instanceRace.response.statusCode, 200, instanceRace.response.body)
  assert.deepEqual(instanceRace.response.json().after, { cpuUsed: 175, memoryUsed: 640, diskUsed: 3072,
    natPortsUsedCount: 2, cpuAllowanceMax: 175, memoryMax: 640 })
  await reset()
  const port = await prisma.portMapping.findFirstOrThrow({ where: { instanceId: instance.id, protocol: 'udp' } })
  const portRace = await race(tx => tx.portMapping.delete({ where: { id: port.id } }))
  assert.equal(portRace.blocked, true)
  assert.equal(portRace.response.statusCode, 200, portRace.response.body)
  assert.equal(portRace.response.json().after.natPortsUsedCount, 1)
  await prisma.portMapping.create({ data: { instanceId: instance.id, hostId: host.id, publicPort: 12001, privatePort: 22, protocol: 'udp' } })
  console.log('PASS instance-only resource edits and mapped-port deletion are observed after actual row waits')
  await reset()
  actor = { ...session, id: other.id, username: other.username }
  assert.equal((await run()).statusCode, 403)
  actor = { ...session, id: admin.id, role: 'admin', username: admin.username }
  assert.equal((await run()).statusCode, 200, 'current administrator retains foreign-host calibration')
  await reset()
  const simultaneous = await Promise.all(Array.from({ length: 6 }, () => run()))
  assert.ok(simultaneous.every(response => [200, 409].includes(response.statusCode)), simultaneous.map(response => response.body).join(';'))
  assert.deepEqual(resources(await read()), expected)
  assert.equal(await auditCount(), simultaneous.filter(response => response.statusCode === 200).length)
  await reset()
  actor = { ...session, sid: '' }
  assert.equal((await run()).statusCode, 403)
  assert.equal((await run('0')).statusCode, 400)
  assert.equal((await run(2147483647)).statusCode, 404)
  assert.equal(await prisma.balanceLog.count({ where: { userId: { in: ids } } }), 0)
  assert.equal(await prisma.instanceBillingRecord.count({ where: { instanceId: { in: [instance.id, deleted.id] } } }), 0)
  console.log('PASS owner/admin permissions, concurrent repeat accounting, invalid identity/IDs and zero financial writes')
} catch (error) { failure = error } finally {
  await app.close()
  await prisma.portMapping.deleteMany({ where: { hostId: host.id } })
  await prisma.instance.deleteMany({ where: { id: { in: [instance.id, deleted.id] } } })
  await prisma.host.delete({ where: { id: host.id } })
  await prisma.log.deleteMany({ where: { userId: { in: ids } } })
  await prisma.user.deleteMany({ where: { id: { in: ids } } })
  await closePrismaDatabase()
}
if (failure) { console.error(failure); process.exit(1) }
process.exit(0)
