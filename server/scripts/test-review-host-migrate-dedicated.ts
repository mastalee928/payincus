import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import Fastify from 'fastify'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'))
process.env.JWT_SECRET ||= 'migrate-boundary-fixture-only'
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { default: routes } = await import('../src/routes/hosts.js')
const prefix = `migrate-boundary-${randomUUID().slice(0, 8)}`
const owner = await prisma.user.create({ data: { username: prefix, passwordHash: 'unusable-fixture', role: 'admin', balance: 100 } })
const buyer = await prisma.user.create({ data: { username: `${prefix}-buyer`, passwordHash: 'unusable-fixture', balance: 50 } })
const source = await prisma.host.create({ data: { userId: owner.id, name: prefix, url: 'https://127.0.0.1:1', status: 'online',
  cpuAllowanceMax: 100, memoryMax: 512, customerDiskGiB: 2, storageSize: 10 } })
const target = await prisma.host.create({ data: { userId: owner.id, name: `${prefix}-target`, url: 'https://127.0.0.1:2', status: 'online',
  cpuAllowanceMax: 100, memoryMax: 512, customerDiskGiB: 2, storageSize: 10 } })
const systemImage = await prisma.systemImage.create({ data: { name: prefix, remoteAlias: `${prefix}/debian`, architecture: 'x86_64', instanceType: 'container', icon: 'debian' } })
const customer = await prisma.instance.create({ data: { userId: buyer.id, hostId: source.id, name: prefix, incusId: prefix,
  image: systemImage.remoteAlias, cpu: 100, memory: 512, disk: 2048, status: 'running', dedicatedIpv4: true,
  portLimit: 0, ipv4: '10.0.0.2', ipv6: '2001:db8::2', billingPrice: 10, expiresAt: new Date(Date.now() + 86400000) } })
const shared = await prisma.instance.create({ data: { userId: buyer.id, hostId: source.id, name: `${prefix}-shared`, incusId: `${prefix}-shared`,
  image: systemImage.remoteAlias, cpu: 50, memory: 256, disk: 1024, status: 'stopped' } })
const hostIds = [source.id, target.id], userIds = [owner.id, buyer.id]
let actor = { id: owner.id, role: 'admin', username: owner.username, sid: prefix, iat: Math.floor(Date.now() / 1000) + 1 }
const app = Fastify()
app.decorate('authenticate', async (request: any) => { request.user = { ...actor } })
app.decorate('authenticateUser', app.authenticate); app.decorate('authenticateAdmin', app.authenticate); app.decorate('requireAdmin', async () => {})
await app.register(routes, { prefix: '/hosts' }); await app.ready()
const migrate = (instanceIds = [customer.id]) => app.inject({ method: 'POST', url: `/hosts/${source.id}/instances/migrate`,
  payload: { instanceIds, targetHostId: target.id, targetImage: systemImage.remoteAlias } })
const snapshot = async () => ({
  instances: await prisma.instance.findMany({ where: { hostId: { in: hostIds } }, orderBy: { id: 'asc' } }),
  hosts: await prisma.host.findMany({ where: { id: { in: hostIds } }, orderBy: { id: 'asc' } }),
  users: await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, balance: true }, orderBy: { id: 'asc' } }),
  bills: await prisma.instanceBillingRecord.count({ where: { userId: { in: userIds } } }),
  balances: await prisma.balanceLog.count({ where: { userId: { in: userIds } } }),
})
let failure: unknown
try {
  for (const role of ['admin', 'user']) {
    actor = { ...actor, role }
    await prisma.user.update({ where: { id: owner.id }, data: { role } })
    for (const kind of ['dedicated-instance', 'source-host', 'target-host', 'mixed-selection']) {
      await prisma.host.update({ where: { id: source.id }, data: { singleTenant: false } })
      await prisma.instance.update({ where: { id: shared.id }, data: { status: kind === 'source-host' ? 'deleted' : 'stopped' } })
      await prisma.host.update({ where: { id: source.id }, data: { singleTenant: kind === 'source-host' } })
      await prisma.host.update({ where: { id: target.id }, data: { singleTenant: kind === 'target-host' } })
      await prisma.instance.update({ where: { id: customer.id }, data: { dedicatedIpv4: kind === 'dedicated-instance' || kind === 'mixed-selection' } })
      const before = await snapshot()
      const response = await migrate(kind === 'mixed-selection' ? [shared.id, customer.id] : [customer.id])
      assert.equal(response.statusCode, 409, `${role}/${kind}: ${response.body}`)
      assert.equal(response.json().code, 'DEDICATED_HOST_CHANGE_MANAGED')
      assert.deepEqual(await snapshot(), before, `${role}/${kind}: no instance, inventory, address, expiry or money changes`)
    }
  }
  await prisma.host.updateMany({ where: { id: { in: hostIds } }, data: { singleTenant: false } })
  await prisma.instance.update({ where: { id: customer.id }, data: { dedicatedIpv4: false } })
  // An ordinary owner still reaches the old connection stage. The closed loopback
  // endpoint prevents any remote mutation while distinguishing this from a blanket ban.
  const before = await snapshot()
  const ordinary = await migrate()
  assert.equal(ordinary.statusCode, 500)
  assert.match(ordinary.json().error, /无法连接源节点/)
  assert.deepEqual(await snapshot(), before)
  await prisma.instance.update({ where: { id: customer.id }, data: { dedicatedIpv4: true } })
  actor = { ...actor, id: buyer.id, role: 'user', username: buyer.username }
  assert.equal((await migrate()).statusCode, 403, 'non-host owner still rejected before dedicated details')
  console.log('PASS admin/owner dedicated instance, source/target dedicated host, mixed batch and existing permission/legacy boundaries')
} catch (error) { failure = error } finally {
  await app.close()
  await prisma.instance.deleteMany({ where: { id: { in: [customer.id, shared.id] } } })
  await prisma.host.deleteMany({ where: { id: { in: hostIds } } })
  await prisma.systemImage.delete({ where: { id: systemImage.id } })
  await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  await closePrismaDatabase()
}
if (failure) { console.error(failure); process.exit(1) }
process.exit(0)
