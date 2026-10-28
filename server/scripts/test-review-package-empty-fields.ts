import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import Fastify from 'fastify'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'), 'Use an isolated local *_pool_test database')
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { default: routes } = await import('../src/routes/packages.js')
const tag = randomUUID()
const owner = await prisma.user.create({ data: { username: `package-empty-${tag}`, passwordHash: 'unusable-fixture' } })
const other = await prisma.user.create({ data: { username: `package-other-${tag}`, passwordHash: 'unusable-fixture' } })
let actor = { id: owner.id, username: owner.username, role: 'user' }
const app = Fastify()
for (const hook of ['authenticateUser', 'authenticateAdmin', 'authenticate']) app.decorate(hook, async (request: any) => { request.user = { ...actor } })
try {
  await app.register(routes, { prefix: '/packages' })
  const pkg = await prisma.package.create({ data: { userId: owner.id, name: `Package ${tag}`, description: 'Package description', cpuMax: 100, memoryMax: 512, diskMax: 5120 } })
  const plan = await prisma.packagePlan.create({ data: { packageId: pkg.id, name: 'Fixture plan', description: 'Plan description', slaGuarantee: 99.9,
    cpu: 100, memory: 512, disk: 5120, portLimit: 3, snapshotLimit: 3, backupLimit: 0, siteLimit: 1, trafficLimit: 1073741824n, price: 1234 } })
  const updatePackage = (payload: object) => app.inject({ method: 'PATCH', url: `/packages/${pkg.id}`, payload })
  const updatePlan = (payload: object) => app.inject({ method: 'PUT', url: `/packages/${pkg.id}/plans/${plan.id}`, payload })

  for (const role of ['user', 'admin']) {
    actor = { id: owner.id, username: owner.username, role }
    await prisma.package.update({ where: { id: pkg.id }, data: { description: 'Before' } })
    await prisma.packagePlan.update({ where: { id: plan.id }, data: { description: 'Before', slaGuarantee: 99.9 } })
    let response = await updatePackage({ description: '' })
    assert.equal(response.statusCode, 200, response.body)
    assert.equal((await prisma.package.findUniqueOrThrow({ where: { id: pkg.id } })).description, '')
    response = await updatePlan({ description: '', slaGuarantee: null })
    assert.equal(response.statusCode, 200, response.body)
    let row = await prisma.packagePlan.findUniqueOrThrow({ where: { id: plan.id } })
    assert.equal(row.description, ''); assert.equal(row.slaGuarantee, null); assert.equal(Number(row.price), 1234)
    assert.equal((await updatePlan({ description: 'Restored', slaGuarantee: 99.95 })).statusCode, 200)
    assert.equal((await updatePlan({ sortOrder: 1 })).statusCode, 200)
    row = await prisma.packagePlan.findUniqueOrThrow({ where: { id: plan.id } })
    assert.equal(row.description, 'Restored'); assert.equal(Number(row.slaGuarantee), 99.95)
    for (const value of ['', 0, 101, 99.999]) {
      assert.equal((await updatePlan({ slaGuarantee: value })).statusCode, 400)
      assert.equal(Number((await prisma.packagePlan.findUniqueOrThrow({ where: { id: plan.id } })).slaGuarantee), 99.95)
    }
  }
  actor = { id: other.id, username: other.username, role: 'user' }
  assert.equal((await updatePackage({ description: '' })).statusCode, 403)
  assert.equal((await updatePlan({ description: '', slaGuarantee: null })).statusCode, 403)
  assert.equal((await prisma.packagePlan.findUniqueOrThrow({ where: { id: plan.id } })).description, 'Restored')
  assert.equal(await prisma.instance.count({ where: { packageId: pkg.id } }), 0)
  console.log('PASS actual Fastify/PostgreSQL package empty-field contract: owner/admin clearing, restoration, omitted fields preserved, invalid SLA rejected, unchanged price and foreign-owner refusal. Authentication identity is a fixture; no host/instance operations.')
} finally {
  await app.close()
  await prisma.package.deleteMany({ where: { userId: owner.id } })
  await prisma.user.deleteMany({ where: { id: { in: [owner.id, other.id] } } })
  await closePrismaDatabase()
}
process.exit(0)
