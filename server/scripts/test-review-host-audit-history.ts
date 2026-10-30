import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mock } from 'node:test'
import Fastify from 'fastify'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'))
process.env.NODE_ENV = 'test'
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { default: routes } = await import('../src/routes/hosts.js')
const { IncusClient } = await import('../src/lib/incus/incus-client.js')
const { closeAllClients } = await import('../src/lib/incus/incus-pool.js')
const { stopSessionCleanup } = await import('../src/lib/terminal-proxy.js')
const tag = 'audit-history-' + randomUUID()
const users = await Promise.all(['owner', 'other', 'admin'].map(role => prisma.user.create({ data: {
  username: `${tag}-${role}`, passwordHash: 'unusable-fixture', role: role === 'admin' ? 'admin' : 'user'
} })))
const hosts = await Promise.all(users.slice(0, 2).map(user => prisma.host.create({ data: {
  userId: user.id, name: user.username, url: 'https://127.0.0.1:1'
} })))
const instances = await Promise.all([0, 0, 1].map((hostIndex, index) => prisma.instance.create({ data: {
  userId: hosts[hostIndex].userId, hostId: hosts[hostIndex].id, name: `${tag}-${index}`, incusId: `${tag}-${index}`,
  image: 'fixture/debian', status: 'running', cpu: 100, memory: 512, disk: 1024
} })))
const hostIds = hosts.map(host => host.id), instanceIds = instances.map(instance => instance.id), userIds = users.map(user => user.id)
const app = Fastify()
let actor = users[0], remoteCalls = 0
app.decorate('authenticate', async (request: any) => {
  request.user = { id: actor.id, username: actor.username, role: actor.role, sid: tag, iat: Math.floor(Date.now() / 1000) + 1 }
})
app.decorate('authenticateAdmin', app.authenticate)
app.decorate('authenticateUser', app.authenticate)
mock.method(IncusClient.prototype, 'connect', async () => { remoteCalls++; throw Error('History must not connect to a host') })
const history = (query = '', hostId = String(hosts[0].id)) => app.inject({ method: 'GET', url: `/hosts/${hostId}/ops/audit/history${query ? '?' + query : ''}` })
const capture = async () => ({
  hosts: await prisma.host.findMany({ where: { id: { in: hostIds } }, orderBy: { id: 'asc' } }),
  instances: await prisma.instance.findMany({ where: { id: { in: instanceIds } }, orderBy: { id: 'asc' } }),
  scans: await prisma.instanceAuditScan.findMany({ where: { hostId: { in: hostIds } }, orderBy: { id: 'asc' } }),
  actions: await prisma.instanceAuditAction.findMany({ where: { hostId: { in: hostIds } }, orderBy: { id: 'asc' } }),
  logs: await prisma.log.findMany({ where: { userId: { in: userIds } }, orderBy: { id: 'asc' } })
})
let failure: unknown
try {
  await app.register(routes, { prefix: '/hosts' })
  const records = instances.flatMap((instance, instanceIndex) => Array.from({ length: instanceIndex === 0 ? 55 : 3 }, (_, index) => ({
    hostId: instance.hostId, instanceId: instance.id, userId: instance.userId,
    createdAt: new Date(Date.UTC(2026, 0, 1) + (instanceIndex * 100 + index) * 1000)
  })))
  await prisma.instanceAuditScan.createMany({ data: records.map(record => ({ ...record, riskLevel: 'low' })) })
  await prisma.instanceAuditAction.createMany({ data: records.map(record => ({ ...record, actionType: 'fixture', reason: tag, result: 'success' })) })
  const before = await capture()
  for (const [query, count] of [['', 20], ['pageSize=', 20], ['pageSize=1', 1], ['pageSize=50', 50],
    ['pageSize=51', 50], ['pageSize=2147483648', 50], ['pageSize=9007199254740991', 50]] as const) {
    const response = await history(query)
    assert.equal(response.statusCode, 200, query + ': ' + response.body)
    for (const key of ['scans', 'actions'] as const) {
      const expected = before[key].filter(row => row.hostId === hosts[0].id).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, count)
      const actual = response.json()[key]
      assert.equal(actual.length, count)
      assert.deepEqual(actual.map((row: any) => row.id), expected.map(row => row.id))
      assert.ok(actual.every((row: any) => row.user.id === users[0].id && row.user.username === users[0].username))
    }
  }
  const invalid = ['0', '-1', '1.5', '1e3', '1suffix', '01', '%2B1', '%201', '9007199254740992', 'NaN', 'Infinity', '0x10', '1&pageSize=2']
  for (const value of invalid) {
    const response = await history('pageSize=' + value)
    assert.equal(response.statusCode, 400, value + ': ' + response.body)
    assert.equal(response.json().code, 'INVALID_ID')
  }
  for (const instance of instances) {
    const response = await history(`instanceId=${instance.id}&pageSize=50`)
    assert.equal(response.statusCode, 200)
    for (const key of ['scans', 'actions'] as const) {
      const expected = before[key].filter(row => row.hostId === hosts[0].id && row.instanceId === instance.id)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 50)
      assert.deepEqual(response.json()[key].map((row: any) => row.id), expected.map(row => row.id))
    }
  }
  assert.equal((await history('instanceId=')).json().scans.length, 20)
  actor = users[1]; assert.equal((await history()).statusCode, 403)
  actor = users[2]; assert.equal((await history()).statusCode, 200)
  actor = users[0]; assert.equal((await history('', '2147483647')).statusCode, 404)
  const absent = await history('instanceId=2147483647')
  assert.equal(absent.statusCode, 200); assert.deepEqual(absent.json(), { scans: [], actions: [] })
  assert.deepEqual(await capture(), before); assert.equal(remoteCalls, 0)
  console.log('PASS strict pagination, default 20/max 50, huge safe page sizes, newest-first ordering, actor/host/instance isolation and unchanged persistent state')
  for (const value of ['2147483648', '9007199254740991', ...invalid.slice(0, -1)]) {
    for (const response of [await history('', value), await history('instanceId=' + value)]) {
      assert.equal(response.statusCode, 400, value + ': ' + response.body)
      assert.equal(response.json().code, 'INVALID_ID')
    }
  }
  assert.equal((await history('instanceId=1&instanceId=2')).statusCode, 400)
  assert.deepEqual(await capture(), before); assert.equal(remoteCalls, 0)
  console.log('PASS history host/instance PostgreSQL Int boundaries reject before querying; valid bounds and read-only state remain intact')
} catch (error) { failure = error }
finally {
  mock.restoreAll(); await app.close(); stopSessionCleanup(); await closeAllClients()
  await prisma.instanceAuditAction.deleteMany({ where: { hostId: { in: hostIds } } })
  await prisma.instanceAuditScan.deleteMany({ where: { hostId: { in: hostIds } } })
  await prisma.log.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.instance.deleteMany({ where: { id: { in: instanceIds } } })
  await prisma.host.deleteMany({ where: { id: { in: hostIds } } })
  await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  await closePrismaDatabase()
}
if (failure) { console.error(failure); process.exit(1) }
process.exit(0)
