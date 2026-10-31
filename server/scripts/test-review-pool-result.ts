import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(database.hostname === '127.0.0.1' && database.pathname.endsWith('_pool_test'))
process.env.NODE_ENV = 'test'
process.env.ENCRYPTION_KEY = randomUUID()
const interval = globalThis.setInterval
globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => { const timer = interval(...args); timer.unref(); return timer }) as typeof setInterval
let encrypt: (value: string) => string
try { encrypt = (await import('../src/lib/security.js')).encryptSensitiveData } finally { globalThis.setInterval = interval }
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { getPoolOrderResult } = await import('../src/services/pool-orders.js')
const tag = 'result-' + randomUUID()
const user = await prisma.user.create({ data: { username: tag, passwordHash: 'fixture' } })
const other = await prisma.user.create({ data: { username: tag + '-other', passwordHash: 'fixture' } })
const host = await prisma.host.create({ data: { name: tag, userId: user.id, url: 'https://127.0.0.1:1', natPublicIp: '192.0.2.10' } })
const order = await prisma.poolOrder.create({ data: { id: randomUUID(), userId: user.id, requestHash: tag, totalCents: 1200 } })
let failure: unknown
try {
  const instance = await prisma.instance.create({ data: { name: tag, incusId: tag, userId: user.id, hostId: host.id, purchaseBatchId: order.id,
    status: 'creating', dedicatedIpv4: true, dedicatedNetworkReady: false, rootPassword: encrypt('isolated-result-password'),
    cpu: 200, memory: 768, disk: 30720, image: 'debian/12', networkMode: 'nat' } })
  await prisma.instanceBillingRecord.create({ data: { instanceId: instance.id, userId: user.id, type: 'newPurchase', amount: 12,
    periodStart: new Date(), periodEnd: new Date(Date.now() + 86400000) } })
  const get = async () => (await getPoolOrderResult(user.id, order.id))!.instances[0]
  assert.equal(await getPoolOrderResult(other.id, order.id), null)
  assert.equal((await get()).host, null); assert.equal((await get()).rootPassword, null)
  await prisma.instance.update({ where: { id: instance.id }, data: { status: 'running', dedicatedNetworkReady: true } })
  assert.equal((await get()).host, '192.0.2.10'); assert.equal((await get()).sshPort, 22); assert.equal((await get()).rootPassword, 'isolated-result-password')
  await prisma.host.update({ where: { id: host.id }, data: { publicIpSyncBlocked: true } })
  assert.equal((await get()).publicIpUpdating, true); assert.equal((await get()).host, null); assert.equal((await get()).rootPassword, null)
  await prisma.instance.update({ where: { id: instance.id }, data: { status: 'error', dedicatedNetworkReady: false } })
  assert.equal((await get()).refundPending, true); assert.equal((await get()).refunded, false)
  await prisma.instanceBillingRecord.create({ data: { instanceId: instance.id, userId: user.id, type: 'refund', amount: 12,
    periodStart: new Date(), periodEnd: new Date(), remark: '实例创建失败自动退款' } })
  await prisma.instance.update({ where: { id: instance.id }, data: { status: 'deleted', snapshottedSpecs: { poolProvision: { version: 1, phase: 'failed' } } } })
  assert.equal((await get()).status, 'error'); assert.equal((await get()).refunded, true); assert.equal((await get()).refundPending, false)
  assert.equal((await get()).rootPassword, null)
  await prisma.instance.update({ where: { id: instance.id }, data: { userId: other.id } })
  assert.equal((await getPoolOrderResult(user.id, order.id))!.instances.length, 0, 'transferred instances are not exposed to the former buyer')
  console.log('PASS actual pool result: owner scope, ready-only password/port22, address change, pending refund, refunded failure and transfer')
} catch (error) { failure = error } finally {
  await prisma.instance.deleteMany({ where: { hostId: host.id } })
  await prisma.poolOrder.delete({ where: { id: order.id } })
  await prisma.host.delete({ where: { id: host.id } })
  await prisma.user.deleteMany({ where: { id: { in: [user.id, other.id] } } })
  await closePrismaDatabase()
}
if (failure) { console.error(failure); process.exitCode = 1 }
