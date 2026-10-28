import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import Fastify from 'fastify'
const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'))
process.env.JWT_SECRET ||= 'quota-fixture-only'
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { default: routes } = await import('../src/routes/instances.js')
const prefix = `instance-quota-${randomUUID().slice(0, 8)}`
const admin = await prisma.user.create({ data: { username: `${prefix}-admin`, passwordHash: 'unusable-fixture', role: 'admin' } })
const owner = await prisma.user.create({ data: { username: `${prefix}-owner`, passwordHash: 'unusable-fixture' } })
const buyer = await prisma.user.create({ data: { username: `${prefix}-buyer`, passwordHash: 'unusable-fixture' } })
const host = await prisma.host.create({ data: { userId: owner.id, name: prefix, url: 'https://127.0.0.1:1' } })
const instance = await prisma.instance.create({ data: { userId: buyer.id, hostId: host.id, name: prefix, incusId: prefix, image: 'fixture/debian',
  cpu: 50, memory: 256, disk: 1024, status: 'stopped', portLimit: 5, snapshotLimit: 5, backupLimit: 5, siteLimit: 5 } })
const app = Fastify()
app.decorate('authenticate', async (request: any) => {
  const actor = request.headers['x-test-role'] === 'owner' ? owner : request.headers['x-test-role'] === 'buyer' ? buyer : admin
  request.user = { id: actor.id, role: actor.role, username: actor.username, sid: prefix, iat: Math.floor(Date.now() / 1000) + 1 }
})
app.decorate('authenticateUser', app.authenticate)
app.decorate('authenticateAdmin', app.authenticate)
app.decorate('requireAdmin', async () => {})
const fields = ['portLimit', 'snapshotLimit', 'backupLimit', 'siteLimit'] as const
const limits = async () => {
  const row = await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })
  return fields.map(field => row[field])
}
const patch = (payload: object, role = 'admin') => app.inject({ method: 'PATCH', url: `/instances/${instance.id}/quota`, headers: { 'x-test-role': role }, payload })
let failure: unknown
try {
  await app.register(routes, { prefix: '/instances' })
  for (const role of ['admin', 'owner']) {
    for (const field of fields) {
      await prisma.instance.update({ where: { id: instance.id }, data: { portLimit: 5, snapshotLimit: 5, backupLimit: 5, siteLimit: 5 } })
      assert.equal((await patch({ [field]: null }, role)).statusCode, 200)
      assert.deepEqual(await limits(), fields.map(value => value === field ? null : 5), `${role}/${field}: explicit null clears only this override`)
      assert.equal((await patch({}, role)).statusCode, 200)
      assert.deepEqual(await limits(), fields.map(value => value === field ? null : 5), 'omitted fields retain their persisted values')
    }
  }
  await prisma.instance.update({ where: { id: instance.id }, data: { portLimit: 5, snapshotLimit: 5, backupLimit: 5, siteLimit: 5 } })
  for (const field of fields) {
    for (const invalid of [-1, 1001, 1.5, {}, []]) {
      assert.equal((await patch({ [field]: invalid })).statusCode, 400)
      assert.deepEqual(await limits(), [5, 5, 5, 5])
    }
  }
  assert.equal((await patch({ portLimit: 0 })).statusCode, 400)
  assert.equal((await patch({ snapshotLimit: 0, backupLimit: 0, siteLimit: 0 })).statusCode, 200)
  assert.deepEqual(await limits(), [5, 0, 0, 0], 'explicit zero remains zero')
  assert.equal((await patch({ portLimit: 1000, snapshotLimit: 1000, backupLimit: 1000, siteLimit: 1000 })).statusCode, 200)
  assert.deepEqual(await limits(), [1000, 1000, 1000, 1000])
  assert.equal((await patch({ portLimit: null }, 'buyer')).statusCode, 403, 'instance ownership alone cannot change administrative quota')
  assert.deepEqual(await limits(), [1000, 1000, 1000, 1000])
  assert.equal(await prisma.balanceLog.count({ where: { userId: { in: [admin.id, owner.id, buyer.id] } } }), 0)
  console.log('PASS actual quota PATCH: admin/host-owner explicit null, omission, zero, limits, invalid inputs and customer denial; isolated PostgreSQL, no remote I/O')
} catch (error) { failure = error } finally {
  await app.close(); await prisma.instance.delete({ where: { id: instance.id } })
  await prisma.host.delete({ where: { id: host.id } }); await prisma.user.deleteMany({ where: { id: { in: [admin.id, owner.id, buyer.id] } } }); await closePrismaDatabase()
}
if (failure) { console.error(failure); process.exit(1) }
process.exit(0)
