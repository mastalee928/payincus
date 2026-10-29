import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import Fastify from 'fastify'
const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['postgres:', 'postgresql:'].includes(database.protocol) &&
  ['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) &&
  /^\/[a-zA-Z0-9_]+_pool_test$/.test(database.pathname) && !database.search && !database.hash)
process.env.JWT_SECRET ||= 'host-list-fixture-only'
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { default: routes } = await import('../src/routes/hosts.js')
const { getHostsPaginated } = await import('../src/db/pagination.js')
const prefix = `host-list-${randomUUID().slice(0, 8)}`
const owner = await prisma.user.create({ data: { username: prefix, passwordHash: 'unusable-fixture', role: 'admin' } })
const userIds = [owner.id]
const actor = { id: owner.id, role: 'admin', username: prefix }
const app = Fastify()
app.decorate('authenticate', async (request: any) => { request.user = { ...actor } })
app.decorate('authenticateUser', app.authenticate); app.decorate('authenticateAdmin', app.authenticate); app.decorate('requireAdmin', async () => {})
await app.register(routes, { prefix: '/hosts' }); await app.ready()
let failure: unknown
try {
  const host = await prisma.host.create({ data: { userId: owner.id, name: prefix, url: 'https://127.0.0.1:1', status: 'online',
    architecture: 'aarch64', natPublicIp: '192.0.2.10', natPublicIpv6: '2001:db8::10', natBindIp: '10.0.0.1', natBindIpv6: 'fd00::1', publicIpv6Sync: { version: 1, addresses: [], primary: null, status: 'failed', error: 'fixture sync failure' } } })
  const response = await app.inject({ method: 'GET', url: `/hosts/?scope=mine&search=${prefix}` })
  assert.equal(response.statusCode, 200)
  const actual = response.json().hosts.find((row: any) => row.id === host.id)
  assert.equal(actual.architecture, 'aarch64', 'host pagination cannot silently label ARM as x86')
  assert.equal(actual.natConfig.publicIpv6, '2001:db8::10')
  assert.equal(actual.natConfig.bindIp, '10.0.0.1'); assert.equal(actual.natConfig.bindIpv6, 'fd00::1')
  assert.equal(actual.natConfig.publicIpv6Sync.status, 'failed')
  assert.equal(actual.natConfig.publicIpv6Sync.error, 'fixture sync failure')
  for (const key of ['certPath', 'keyPath', 'cert_path', 'key_path']) assert.equal(Object.hasOwn(actual, key), false)
  // Names are unique per owner; the administrator's cross-owner list can still have ties.
  const otherOwners = await prisma.user.createManyAndReturn({ data: Array.from({ length: 104 }, (_, i) => ({
    username: `${prefix}-${i}`, passwordHash: 'unusable-fixture', role: 'user'
  })), select: { id: true } })
  userIds.push(...otherOwners.map(user => user.id))
  await prisma.host.createMany({ data: otherOwners.map((user, i) => ({ userId: user.id,
    name: `${prefix}-same`, url: `https://127.0.0.1:${10000 + i}` })) })
  const expected = await prisma.host.findMany({ where: { userId: { in: userIds } }, orderBy: [{ name: 'asc' }, { id: 'asc' }], select: { id: true } })
  for (const includeOwner of [false, true]) {
    const seen: number[] = []
    for (let page = 1; page <= 2; page++) {
      const result = await getHostsPaginated({ search: prefix, page, pageSize: 100, includeOwner })
      assert.equal(result.total, 105); assert.equal(result.totalPages, 2)
      seen.push(...result.items.map(item => item.id))
      if (page === 1) {
        assert.equal(result.items[0].architecture, 'aarch64')
        assert.equal((result.items[0] as any).nat_public_ipv6, '2001:db8::10')
        assert.equal(!!(result.items[0] as any).owner, includeOwner)
      }
    }
    assert.deepEqual(seen, expected.map(item => item.id), 'same-name multi-page hosts use a unique ordering')
  }
  const hostedIds: number[] = []
  for (const page of [1, 2]) {
    const response = await app.inject({ method: 'GET', url: `/hosts/?scope=hosted&search=${prefix}&page=${page}&pageSize=100` })
    assert.equal(response.statusCode, 200)
    const result = response.json()
    assert.equal(result.total, 104); assert.equal(result.totalPages, 2)
    for (const row of result.hosts) {
      hostedIds.push(row.id)
      assert.ok(userIds.includes(row.owner.id) && row.owner.id !== owner.id)
      assert.equal(row.architecture, 'x86_64')
      for (const key of ['publicIpv6', 'bindIp', 'bindIpv6', 'publicIpv6Sync']) assert.equal(row.natConfig[key], null)
      for (const key of ['certPath', 'keyPath', 'cert_path', 'key_path']) assert.equal(Object.hasOwn(row, key), false)
    }
  }
  assert.deepEqual(hostedIds, expected.filter(item => item.id !== host.id).map(item => item.id))
  const selectedOwner = await app.inject({ method: 'GET', url: `/hosts/?scope=hosted&search=${prefix}&userId=${otherOwners[0].id}` })
  assert.equal(selectedOwner.statusCode, 200); assert.equal(selectedOwner.json().total, 1)
  assert.equal(selectedOwner.json().hosts[0].owner.id, otherOwners[0].id)
  actor.role = 'user'; await prisma.user.update({ where: { id: owner.id }, data: { role: 'user' } })
  assert.equal((await app.inject({ method: 'GET', url: `/hosts/?search=${prefix}` })).statusCode, 403)
  const owned = await app.inject({ method: 'GET', url: `/hosts/?mine=true&search=${prefix}` })
  assert.equal(owned.statusCode, 200); assert.equal(owned.json().hosts[0].architecture, 'aarch64'); assert.equal(owned.json().total, 1)
  assert.equal(Object.hasOwn(owned.json().hosts[0], 'owner'), false)
  const forgedScope = await app.inject({ method: 'GET', url: `/hosts/?mine=true&scope=hosted&userId=${otherOwners[0].id}&search=${prefix}` })
  assert.equal(forgedScope.statusCode, 200)
  assert.deepEqual(forgedScope.json().hosts.map((row: any) => row.id), [host.id])
  console.log('PASS actual host architecture/network/state, same-name pagination, owner projection and user access')
} catch (error) { failure = error } finally {
  await app.close()
  await prisma.host.deleteMany({ where: { userId: { in: userIds } } }); await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  await closePrismaDatabase()
}
if (failure) { console.error(failure); process.exit(1) }
process.exit(0)
