import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import Fastify from 'fastify'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'))
process.env.JWT_SECRET ||= 'host-type-fixture-only'
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { default: routes } = await import('../src/routes/hosts.js')
const prefix = 'host-type-' + randomUUID().slice(0, 8)
const owner = await prisma.user.create({ data: { username: prefix, passwordHash: 'unusable-fixture', role: 'admin' } })
const other = await prisma.user.create({ data: { username: prefix + '-other', passwordHash: 'unusable-fixture' } })
const host = await prisma.host.create({ data: { userId: owner.id, name: prefix, url: 'https://node.example.test:8443',
  ipv6Mode: 2, instanceType: 'both', location: 'retained', transferEnabled: true } })
const pkg = await prisma.package.create({ data: { userId: owner.id, name: prefix, cpuMax: 1, memoryMax: 512, diskMax: 5, instanceType: 'container' } })
await prisma.packageHost.create({ data: { packageId: pkg.id, hostId: host.id } })
const app = Fastify()
app.decorate('authenticate', async (request: any) => {
  const user = request.headers['x-fixture-other'] ? other : owner
  request.user = { id: user.id, role: user.role, username: user.username, sid: prefix, iat: Math.floor(Date.now() / 1000) + 1 }
})
app.decorate('requireAdmin', async () => {})
app.decorate('authenticateAdmin', app.authenticate)
await app.register(routes, { prefix: '/hosts' })
const patch = (payload: object, otherActor = false) => app.inject({ method: 'PATCH', url: `/hosts/${host.id}`, payload,
  headers: otherActor ? { 'x-fixture-other': '1' } : {} })
try {
  for (const [packageType, refusedType] of [['container', 'vm'], ['vm', 'container']] as const) {
    await prisma.host.update({ where: { id: host.id }, data: { instanceType: 'both', location: 'retained', transferEnabled: true } })
    await prisma.package.update({ where: { id: pkg.id }, data: { instanceType: packageType } })
    const before = await prisma.host.findUniqueOrThrow({ where: { id: host.id } })
    const logsBefore = await prisma.log.count({ where: { userId: owner.id } })
    const response = await patch({ instanceType: refusedType, location: 'must not persist', transferEnabled: false })
    assert.equal(response.statusCode, 400)
    assert.equal(response.json().code, 'HOST_INSTANCE_TYPE_MISMATCH')
    assert.deepEqual(response.json().packages, [{ id: pkg.id, name: pkg.name, instanceType: packageType }])
    assert.equal(response.json().warnings, undefined)
    assert.deepEqual(await prisma.host.findUniqueOrThrow({ where: { id: host.id } }), before, 'refused changes write no host fields')
    assert.equal(await prisma.log.count({ where: { userId: owner.id } }), logsBefore, 'refusal creates no success audit')
    assert.equal((await patch({ instanceType: packageType }, true)).statusCode, 403)
    const success = await patch({ instanceType: packageType })
    assert.equal(success.statusCode, 200)
    assert.deepEqual(success.json(), { message: 'Host config updated' })
    assert.equal((await prisma.host.findUniqueOrThrow({ where: { id: host.id } })).instanceType, packageType)
    const both = await patch({ instanceType: 'both' })
    assert.equal(both.statusCode, 200)
    assert.deepEqual(both.json(), { message: 'Host config updated' })
  }
  console.log('PASS real Fastify/PG container and VM type refusals before all writes/audits, foreign owner denial and compatible/both message receipts; no Incus calls')
} finally {
  await app.close()
  await prisma.log.deleteMany({ where: { userId: { in: [owner.id, other.id] } } })
  await prisma.package.delete({ where: { id: pkg.id } })
  await prisma.host.delete({ where: { id: host.id } })
  await prisma.user.deleteMany({ where: { id: { in: [owner.id, other.id] } } })
  await closePrismaDatabase()
}
// The route module owns maintenance timers; fixture cleanup is complete.
process.exit(0)
