import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import Fastify from 'fastify'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'))
process.env.NODE_ENV = 'test'
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { default: routes } = await import('../src/routes/batch-config.js')
const { IncusClient } = await import('../src/lib/incus/incus-client.js')
const { closeAllClients } = await import('../src/lib/incus/incus-pool.js')
const tag = 'batch-input-' + randomUUID(), app = Fastify(), users: number[] = [], hosts: number[] = [], instances: number[] = []
let failure: unknown, connects = 0
const originalConnect = IncusClient.prototype.connect
IncusClient.prototype.connect = async () => { connects++; throw Error('Unexpected Incus call for database-only batch validation') }
try {
  for (const role of ['admin', 'user'] as const) {
    const user = await prisma.user.create({ data: { username: tag + '-' + role, passwordHash: 'unusable-fixture', role } }); users.push(user.id)
  }
  let actor = { id: users[0], username: tag, role: 'admin', sid: tag, iat: Math.floor(Date.now() / 1000) + 1 }
  app.decorate('authenticate', async (request: any) => { request.user = { ...actor } })
  await app.register(routes, { prefix: '/hosts' })
  for (let n = 0; n < 2; n++) {
    const host = await prisma.host.create({ data: { userId: users[0], name: tag + '-' + n, url: 'https://127.0.0.1:1', status: 'online' } }); hosts.push(host.id)
  }
  for (const [index, status] of (['running', 'stopped', 'creating', 'deleted', 'running'] as const).entries()) {
    const instance = await prisma.instance.create({ data: {
      userId: users[1], hostId: index === 4 ? hosts[1] : hosts[0], name: tag + '-' + index, incusId: tag + '-' + index,
      image: 'fixture', status, cpu: 100, memory: 512, disk: 1024, monthlyTrafficLimit: 123n, snapshotLimit: 3
    } }); instances.push(instance.id)
  }
  const state = async () => ({
    users: await prisma.user.findMany({ where: { id: { in: users } }, orderBy: { id: 'asc' } }),
    hosts: await prisma.host.findMany({ where: { id: { in: hosts } }, orderBy: { id: 'asc' } }),
    instances: await prisma.instance.findMany({ where: { id: { in: instances } }, orderBy: { id: 'asc' } }),
    logs: await prisma.log.findMany({ where: { OR: [{ userId: { in: users } }, { instanceId: { in: instances } }] }, orderBy: { id: 'asc' } }),
    ledger: await prisma.balanceLog.findMany({ where: { userId: { in: users } }, orderBy: { id: 'asc' } })
  })
  const before = await state()
  const submit = (hostId: number | string, ids: unknown[], config: Record<string, unknown> = { snapshotLimit: 7 }) => app.inject({
    method: 'POST', url: `/hosts/${hostId}/instances/batch-config`, payload: { instanceIds: ids, config }
  })
  assert.equal(await prisma.instance.count({ where: { id: 2147483647 } }), 0)
  let rejectedTargets = 0
  for (const ids of [[instances[0], instances[2]], [instances[0], instances[3]], [instances[0], instances[4]],
    [instances[0], 2147483647], [instances[0], instances[0]], [], [instances[0], 1.5], [instances[0], -1],
    [instances[0], 2147483648], [instances[0], 4294967296], [instances[0], Number.MAX_SAFE_INTEGER]]) {
    const result = await submit(hosts[0], ids)
    if (result.statusCode !== 400) console.log('Unexpected batch target status', result.statusCode, 'targetCount', ids.length)
    assert.equal(result.statusCode, 400); assert.deepEqual(await state(), before); assert.equal(connects, 0); rejectedTargets++
  }
  for (const hostId of ['0', '-1', '1.5', '01', '1suffix', '2147483648', '4294967296', String(Number.MAX_SAFE_INTEGER)]) {
    assert.equal((await submit(hostId, [instances[0]])).statusCode, 400); assert.deepEqual(await state(), before); rejectedTargets++
  }
  actor = { ...actor, id: users[1], role: 'user' }
  assert.equal((await submit(hosts[0], [instances[0]])).statusCode, 403); assert.deepEqual(await state(), before)
  actor = { ...actor, id: users[0], role: 'admin' }
  let rejectedTraffic = 0
  for (const value of ['-1', '-0', '1.5', '1e3', '10suffix', 'NaN', 'Infinity', ' ', '+1', '0x10',
    '9223372036854775808', '-9223372036854775808', '99999999999999999999999999999999', -1, 1.5, {}, false]) {
    assert.equal((await submit(hosts[0], [instances[0]], { monthlyTrafficLimit: value })).statusCode, 400, 'traffic ' + String(value))
    assert.deepEqual(await state(), before); assert.equal(connects, 0); rejectedTraffic++
  }
  const normal = await submit(hosts[0], [instances[0], instances[1]])
  assert.equal(normal.statusCode, 200); assert.equal(normal.json().successCount, 2); assert.equal(normal.json().failedCount, 0)
  for (const id of instances.slice(0, 2)) assert.equal((await prisma.instance.findUniqueOrThrow({ where: { id } })).snapshotLimit, 7)
  const unaffected = await prisma.instance.findMany({ where: { id: { in: instances.slice(1) } }, orderBy: { id: 'asc' } })
  for (const [value, expected] of [['0', 0n], ['1', 1n], ['9007199254740993', 9007199254740993n],
    ['9223372036854775807', 9223372036854775807n], [' 123 ', 123n], ['', null], [null, null]] as const) {
    const original = await prisma.instance.findUniqueOrThrow({ where: { id: instances[0] } })
    const result = await submit(hosts[0], [instances[0]], { monthlyTrafficLimit: value })
    assert.equal(result.statusCode, 200); assert.equal(result.json().successCount, 1); assert.equal(result.json().failedCount, 0)
    const after = await prisma.instance.findUniqueOrThrow({ where: { id: instances[0] } })
    assert.deepEqual(after, { ...original, monthlyTrafficLimit: expected, version: original.version + 1, updatedAt: after.updatedAt })
  }
  assert.deepEqual(await prisma.instance.findMany({ where: { id: { in: instances.slice(1) } }, orderBy: { id: 'asc' } }), unaffected)
  const after = await state()
  assert.deepEqual(after.users, before.users); assert.deepEqual(after.hosts, before.hosts); assert.deepEqual(after.ledger, before.ledger)
  assert.equal(after.logs.length, 8); assert.equal(connects, 0)
  console.log('PASS', rejectedTargets, 'invalid or incomplete targets, foreign owner denial,', rejectedTraffic,
    'invalid traffic limits; exact 0/null/PG bigint max, normal two targets; no Incus, balance or host changes')
} catch (error) { failure = error }
finally {
  await app.close(); IncusClient.prototype.connect = originalConnect; await closeAllClients()
  await prisma.log.deleteMany({ where: { OR: [{ userId: { in: users } }, { instanceId: { in: instances } }] } })
  await prisma.instance.deleteMany({ where: { id: { in: instances } } }); await prisma.host.deleteMany({ where: { id: { in: hosts } } })
  await prisma.user.deleteMany({ where: { id: { in: users } } }); await closePrismaDatabase()
}
if (failure) { console.error(failure); process.exit(1) }
process.exit(0)
