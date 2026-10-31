import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { randomUUID } from 'node:crypto'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'), 'Use an isolated local *_pool_test database')
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const billing = await import('../src/db/billing-operations.js')
const { default: routes } = await import('../src/routes/instance-billing.js')
const tag = `renew-${randomUUID()}`
const buyer = await prisma.user.create({ data: { username: tag, passwordHash: 'unusable-fixture', balance: 100 } })
const seller = await prisma.user.create({ data: { username: `${tag}-seller`, passwordHash: 'unusable-fixture', role: 'admin' } })
const other = await prisma.user.create({ data: { username: `${tag}-other`, passwordHash: 'unusable-fixture' } })
const host = await prisma.host.create({ data: { userId: seller.id, name: tag, url: 'https://127.0.0.1:1', status: 'online' } })
const pkg = await prisma.package.create({ data: { userId: seller.id, name: tag, cpuMax: 100, memoryMax: 1024, diskMax: 2048 } })
const plan = await prisma.packagePlan.create({ data: { packageId: pkg.id, name: 'Fixture', cpu: 100, memory: 1024, disk: 2048,
  portLimit: 1, snapshotLimit: 0, backupLimit: 0, siteLimit: 0, trafficLimit: 0, price: 1000, billingCycle: 1 } })
const session = { id: buyer.id, role: 'user', username: buyer.username, sid: 'fixture-renew-session', iat: Math.floor(Date.now() / 1000) + 1 }
const app = Fastify()
app.decorate('authenticateUser', async (request: any) => { request.user = { ...session } })
app.decorate('authenticate', async (request: any) => { request.user = { ...session } })
let seq = 0
const make = (expiresAt: Date) => prisma.instance.create({ data: { userId: buyer.id, hostId: host.id, packageId: pkg.id, packagePlanId: plan.id,
  name: `${tag}-${++seq}`, incusId: `${tag}-${seq}`, image: 'fixture/debian', cpu: 100, memory: 1024, disk: 2048,
  billingPrice: 10, billingCycle: 1, expiresAt, status: 'stopped' } })
try {
  await app.register(routes, { prefix: '/instances' })
  const mixedTarget = await make(new Date(Date.now() + 86400000))
  const mixed = await app.inject({ method: 'POST', url: '/instances/batch/renew', payload: { instanceIds: [mixedTarget.id, 2147483648], months: 1 } })
  const mixedBalance = Number((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance)
  console.log('Mixed batch validation:', mixed.statusCode, 'balance:', mixedBalance,
    'bills:', await prisma.instanceBillingRecord.count({ where: { instanceId: mixedTarget.id } }))
  assert.equal(mixed.statusCode, 400, 'invalid batch IDs must be rejected before processing any target')
  assert.equal(mixedBalance, 100, 'invalid batch must not charge its valid first target')
  assert.equal(await prisma.instanceBillingRecord.count({ where: { instanceId: mixedTarget.id } }), 0)
  assert.equal((await prisma.instance.findUniqueOrThrow({ where: { id: mixedTarget.id } })).expiresAt!.toISOString(), mixedTarget.expiresAt!.toISOString())
  for (const invalid of [0, -1, 1.5, 2147483648, Number.MAX_SAFE_INTEGER]) {
    for (const [method, url, extra] of [
      ['POST', '/instances/batch/renew', { months: 1 }],
      ['POST', '/instances/batch/renew-preview', {}],
      ['PATCH', '/instances/batch/auto-renew', { autoRenew: true }]
    ] as const) {
      const response = await app.inject({ method, url, payload: { instanceIds: [mixedTarget.id, invalid], ...extra } })
      assert.equal(response.statusCode, 400, `${url}: invalid ${invalid}`)
    }
  }
  assert.equal(Number((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance), 100)
  assert.equal(await prisma.balanceLog.count({ where: { instanceId: mixedTarget.id } }), 0)
  assert.deepEqual(await prisma.instance.findUniqueOrThrow({ where: { id: mixedTarget.id } }), mixedTarget)
  for (const id of ['2147483648', '9007199254740991']) {
    assert.equal((await app.inject({ method: 'POST', url: `/instances/${id}/renew`, payload: { months: 1 } })).statusCode, 400)
    assert.equal((await app.inject({ method: 'PATCH', url: `/instances/${id}/auto-renew`, payload: { autoRenew: true } })).statusCode, 400)
  }
  assert.equal((await app.inject({ method: 'POST', url: '/instances/2147483647/renew', payload: { months: 1 } })).statusCode, 404)
  const duplicateSwitch = await app.inject({ method: 'PATCH', url: '/instances/batch/auto-renew', payload: { instanceIds: [mixedTarget.id, mixedTarget.id], autoRenew: true } })
  assert.equal(duplicateSwitch.statusCode, 200)
  assert.equal(duplicateSwitch.json().results.length, 1, 'duplicate valid IDs still run once')
  assert.equal(duplicateSwitch.json().results[0].success, true)
  console.log('PASS invalid mixed renewal/preview/auto-renew batches leave every target and all money untouched; valid duplicate switch remains supported')
  const expired = await make(new Date(Date.now() - 90 * 86400000))
  const started = Date.now()
  const result = await billing.performRenewal(buyer.id, expired, 1, undefined, session)
  const record = await prisma.instanceBillingRecord.findFirstOrThrow({ where: { instanceId: expired.id, type: 'renew' } })
  assert.ok(record.periodStart.getTime() >= started && record.periodStart.getTime() <= Date.now(), 'expired renewal starts now instead of the old expiry')
  assert.equal(record.periodEnd.toISOString(), result.newExpiresAt.toISOString())
  assert.equal(result.amount, 10)
  assert.equal(Number((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance), 90)
  const quote = await billing.calculateInstanceRemainingRefundQuote(await prisma.instance.findUniqueOrThrow({ where: { id: expired.id } }))
  assert.ok(quote.refundableValue >= 9.99, 'remaining paid value is not diluted by ninety unpaid days')
  const future = await make(new Date(Date.now() + 5 * 86400000))
  const futureResult = await billing.performRenewal(buyer.id, future, 1, undefined, session)
  const futureRecord = await prisma.instanceBillingRecord.findFirstOrThrow({ where: { instanceId: future.id, type: 'renew' } })
  assert.equal(futureRecord.periodStart.toISOString(), future.expiresAt!.toISOString(), 'unexpired renewal still extends the paid end')
  assert.equal(futureRecord.periodEnd.toISOString(), futureResult.newExpiresAt.toISOString())

  const concurrency = await make(new Date(Date.now() + 86400000))
  const repeats = await Promise.allSettled(Array.from({ length: 6 }, () => billing.performRenewal(buyer.id, concurrency, 1, undefined, session)))
  assert.equal(repeats.filter(r => r.status === 'fulfilled').length, 1, 'same old snapshot cannot charge twice')
  assert.equal(await prisma.instanceBillingRecord.count({ where: { instanceId: concurrency.id } }), 1)
  const balance = Number((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance)
  const transferred = await make(new Date(Date.now() + 86400000))
  await prisma.instance.update({ where: { id: transferred.id }, data: { userId: other.id } })
  await assert.rejects(billing.performRenewal(buyer.id, transferred, 1, undefined, session), /实例状态已变更/)
  const denied = await make(new Date(Date.now() + 86400000))
  await prisma.user.update({ where: { id: buyer.id }, data: { status: 'banned' } })
  await assert.rejects(billing.performRenewal(buyer.id, denied, 1, undefined, session), /用户权限已变更/)
  await prisma.user.update({ where: { id: buyer.id }, data: { status: 'active' } })
  await prisma.tokenInvalidation.create({ data: { userId: buyer.id, sessionId: session.sid, invalidatedAt: session.iat } })
  await assert.rejects(billing.performRenewal(buyer.id, denied, 1, undefined, session), /用户权限已变更/)
  assert.equal((await app.inject({ method: 'PATCH', url: `/instances/${denied.id}/auto-renew`, payload: { autoRenew: true } })).statusCode, 400)
  const batch = await app.inject({ method: 'PATCH', url: '/instances/batch/auto-renew', payload: { instanceIds: [denied.id], autoRenew: true } })
  assert.equal(batch.statusCode, 200)
  assert.equal(batch.json().results[0].success, false)
  await prisma.tokenInvalidation.deleteMany({ where: { userId: buyer.id } })
  await prisma.user.update({ where: { id: seller.id }, data: { role: 'user' } })
  const early = await make(new Date(Date.now() + 20 * 86400000))
  await assert.rejects(billing.performRenewal(buyer.id, early, 1, undefined, session), /到期前7天/)
  await assert.rejects(billing.performRenewal(buyer.id, denied, 2, undefined, session), /仅支持按月/)
  await prisma.user.update({ where: { id: seller.id }, data: { role: 'admin' } })
  assert.equal(Number((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance), balance, 'denied requests leave balance untouched')
  assert.equal(await prisma.instanceBillingRecord.count({ where: { instanceId: { in: [denied.id, early.id, transferred.id] } } }), 0)
  for (const months of [NaN, Infinity, 1.5, 0, -1, 25]) assert.throws(() => billing.calculateRenewBilling(denied, months), /1-24/)

  const trigger = `review_renew_${randomUUID().replaceAll('-', '')}`
  await prisma.$executeRawUnsafe(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.instance_id = ${denied.id} THEN RAISE EXCEPTION 'fixture-renew-bill-failure'; END IF; RETURN NEW; END $$`)
  await prisma.$executeRawUnsafe(`CREATE TRIGGER ${trigger} BEFORE INSERT ON instance_billing_records FOR EACH ROW EXECUTE FUNCTION ${trigger}()`)
  try {
    await assert.rejects(billing.performRenewal(buyer.id, denied, 1, undefined, session), /fixture-renew-bill-failure/)
    assert.equal(Number((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance), balance)
    assert.equal((await prisma.instance.findUniqueOrThrow({ where: { id: denied.id } })).expiresAt!.toISOString(), denied.expiresAt!.toISOString())
    assert.equal(await prisma.balanceLog.count({ where: { instanceId: denied.id } }), 0, 'ledger/expiry/debit rollback together')
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER ${trigger} ON instance_billing_records`)
    await prisma.$executeRawUnsafe(`DROP FUNCTION ${trigger}()`)
  }
  assert.equal((await app.inject({ method: 'PATCH', url: `/instances/${denied.id}/auto-renew`, payload: { autoRenew: true } })).statusCode, 200)
  await prisma.instance.update({ where: { id: denied.id }, data: { userId: other.id } })
  await assert.rejects(billing.updateAutoRenew(denied.id, false, buyer.id, session), /实例状态已变更/)
  assert.equal((await prisma.instance.findUniqueOrThrow({ where: { id: denied.id } })).autoRenew, true, 'old owner cannot change auto-renew after transfer')
  console.log('PASS real PostgreSQL renewal/auto-renew: expired paid period, future extension, stale concurrent snapshot, transfer/status/revocation/current hosting restrictions, debit-ledger-expiry rollback and actual single/batch switch routes')
} finally {
  await app.close()
  await prisma.log.deleteMany({ where: { userId: buyer.id } })
  await prisma.balanceLog.deleteMany({ where: { userId: buyer.id } })
  await prisma.instance.deleteMany({ where: { hostId: host.id } })
  await prisma.package.delete({ where: { id: pkg.id } })
  await prisma.host.delete({ where: { id: host.id } })
  await prisma.user.deleteMany({ where: { id: { in: [buyer.id, seller.id, other.id] } } })
  await closePrismaDatabase()
}
process.exit(0)
