import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import Fastify from 'fastify'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'), 'Use an isolated local *_pool_test database')
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const aff = await import('../src/db/aff.js')
const { advisoryTransactionLock, USER_AFF_BALANCE_LOCK_NAMESPACE } = await import('../src/db/advisory-locks.js')
const { performRenewal } = await import('../src/db/billing-operations.js')
const { processMailAutoRenew } = await import('../src/services/mail-autorenew-scheduler.js')
const { processAutoRenew } = await import('../src/services/billing-scheduler.js')
const { reverseInstanceAffCommissionForRefund } = await import('../src/routes/instance-destroy.js')
const { default: mailRoutes } = await import('../src/routes/mail.js')
const { default: adminRoutes } = await import('../src/routes/admin-billing.js')
const { default: billingRoutes } = await import('../src/routes/instance-billing.js')
const { closeAllClients } = await import('../src/lib/incus/incus-pool.js')
const tag = `aff-${randomUUID()}`
const buyer = await prisma.user.create({ data: { username: tag, passwordHash: 'unusable-fixture', balance: 500 } })
const newBuyer = await prisma.user.create({ data: { username: `${tag}-new`, passwordHash: 'unusable-fixture', balance: 500 } })
const referrer = await prisma.user.create({ data: { username: `${tag}-ref`, passwordHash: 'unusable-fixture' } })
const admin = await prisma.user.create({ data: { username: `${tag}-admin`, passwordHash: 'unusable-fixture', role: 'admin' } })
const host = await prisma.host.create({ data: { userId: admin.id, name: tag, url: 'https://127.0.0.1:1', status: 'online' } })
const pkg = await prisma.package.create({ data: { userId: admin.id, name: tag, cpuMax: 100, memoryMax: 1024, diskMax: 2048 } })
const plan = await prisma.packagePlan.create({ data: { packageId: pkg.id, name: 'Fixture', cpu: 100, memory: 1024, disk: 2048,
  portLimit: 1, snapshotLimit: 0, backupLimit: 0, siteLimit: 0, trafficLimit: 0, price: 10, billingCycle: 1 } })
const source = await prisma.mailSource.create({ data: { name: tag, code: tag, apiUrl: 'https://127.0.0.1:1', apiKey: 'unusable-fixture', smarterMailUrl: 'https://127.0.0.1:1' } })
const mailPlan = await prisma.mailPlan.create({ data: { sourceId: source.id, name: tag, domainLimit: 1, diskLimitGb: 1, billingCycle: 'monthly', price: 10 } })
const code = await prisma.affCode.create({ data: { code: `AFF-${randomUUID()}`.toUpperCase(), userId: referrer.id, discountRate: 0.1, commissionRate: 0.2, enabled: false } })
const secondCode = await prisma.affCode.create({ data: { code: `AFF-${randomUUID()}`.toUpperCase(), userId: referrer.id, discountRate: 0.2, commissionRate: 0.2 } })
const session = { sid: tag, iat: Math.floor(Date.now() / 1000) + 1 }
let actor = { ...session, id: buyer.id, username: buyer.username, role: 'user' }
let afterAuthentication: (() => Promise<unknown>) | undefined
let beforeTransaction: (() => Promise<unknown>) | undefined
const originalTransaction = prisma.$transaction
const transaction = originalTransaction.bind(prisma)
prisma.$transaction = (async (...args: Parameters<typeof prisma.$transaction>) => {
  const pending = beforeTransaction
  beforeTransaction = undefined
  await pending?.()
  return (transaction as (...params: unknown[]) => Promise<unknown>)(...args)
}) as typeof prisma.$transaction
const app = Fastify()
app.decorate('authenticate', async (request: any) => { request.user = { ...actor }; await afterAuthentication?.() })
app.decorate('authenticateAdmin', async (request: any) => { request.user = { ...actor }; await afterAuthentication?.() })
app.decorate('authenticateUser', async (request: any) => { request.user = { ...actor }; await afterAuthentication?.() })
app.decorate('requireAdmin', async () => {})
let sequence = 0
const makeInstance = () => prisma.instance.create({ data: { userId: buyer.id, hostId: host.id, packageId: pkg.id, packagePlanId: plan.id,
  name: `${tag}-${++sequence}`, incusId: `${tag}-${sequence}`, image: 'fixture/debian', cpu: 100, memory: 1024, disk: 2048,
  billingPrice: 10, billingCycle: 1, expiresAt: new Date(Date.now() + 86400000), status: 'stopped' } })
const subscription = await prisma.mailSubscription.create({ data: { userId: buyer.id, sourceId: source.id, planId: mailPlan.id,
  domainLimit: 1, diskLimitGb: 1, expiresAt: new Date(Date.now() + 86400000), autoRenew: true } })
const setEnabled = (enabled: boolean) => prisma.affCode.update({ where: { id: code.id }, data: { enabled } })
const commissionState = async () => ({
  balance: Number((await prisma.user.findUniqueOrThrow({ where: { id: referrer.id } })).affBalance),
  logs: await prisma.affLog.count({ where: { userId: referrer.id } }),
  code: await prisma.affCode.findUniqueOrThrow({ where: { id: code.id }, select: { usedCount: true, totalEarnings: true } })
})
const mailState = async () => ({
  balance: Number((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance),
  logs: await prisma.balanceLog.count({ where: { userId: buyer.id } }),
  expiry: (await prisma.mailSubscription.findUniqueOrThrow({ where: { id: subscription.id } })).expiresAt.toISOString(),
  commission: await commissionState()
})
const trigger = `review_aff_${randomUUID().replaceAll('-', '')}`
let triggerCreated = false
try {
  await app.register(mailRoutes, { prefix: '/mail' })
  await app.register(adminRoutes)
  await app.register(billingRoutes, { prefix: '/instances' })
  const target = await makeInstance()
  assert.equal((await aff.validateAffCode(code.code, plan.id, buyer.id)).valid, false)
  assert.equal((await aff.validateMailAffCode(code.code, buyer.id)).valid, false)
  await assert.rejects(aff.createAffBinding(target.id, code.id), /优惠码已禁用/)
  await assert.rejects(aff.createMailAffBinding(subscription.id, code.id), /优惠码已禁用/)
  const initialCommission = await commissionState()
  await aff.processAffCommission(code.id, target.id, 10, 'new_purchase')
  await aff.processMailAffCommission(code.id, subscription.id, 10, 'renew')
  assert.deepEqual(await commissionState(), initialCommission, 'disabled codes cannot write any commission ledger or statistics')

  // Existing permanent bindings are fixture history, not newly eligible discounts.
  await prisma.mailSubscriptionAffBinding.create({ data: { mailSubscriptionId: subscription.id, affCodeId: code.id } })
  let before = await mailState()
  const disabledRenewal = await app.inject({ method: 'POST', url: '/mail/subscription/renew', payload: { months: 1 } })
  assert.equal(disabledRenewal.statusCode, 200, disabledRenewal.body)
  assert.equal(disabledRenewal.json().finalPrice, 10)
  assert.equal((await mailState()).balance, before.balance - 10)
  assert.deepEqual(await commissionState(), initialCommission)

  await prisma.mailSubscription.update({ where: { id: subscription.id }, data: { expiresAt: new Date(Date.now() + 86400000) } })
  const candidate = await prisma.mailSubscription.findUniqueOrThrow({ where: { id: subscription.id } })
  const auto = await processMailAutoRenew(candidate, new Date(), new Date(Date.now() + 3 * 86400000))
  assert.equal(auto.status, 'renewed')
  if (auto.status === 'renewed') assert.equal(auto.amount, 10)
  assert.deepEqual(await commissionState(), initialCommission, 'automatic renewal also skips disabled commissions')

  actor = { ...session, id: admin.id, username: admin.username, role: 'admin' }
  const applyUrl = `/api/admin/instances/${target.id}/apply-aff`
  assert.equal((await app.inject({ method: 'POST', url: applyUrl, payload: { affCode: code.code } })).statusCode, 400)
  assert.equal((await app.inject({ method: 'POST', url: applyUrl, payload: { affCode: { invalid: true } } })).statusCode, 400)
  await setEnabled(true)
  const selfCode = await prisma.affCode.create({ data: { code: `AFF-${randomUUID()}`.toUpperCase(), userId: buyer.id } })
  const scopedCode = await prisma.affCode.create({ data: { code: `AFF-${randomUUID()}`.toUpperCase(), userId: referrer.id, packagePlanId: plan.id } })
  await assert.rejects(aff.createAffBinding(target.id, selfCode.id), /自己的优惠码/)
  await assert.rejects(aff.createMailAffBinding(subscription.id, scopedCode.id), /不适用于此方案/)
  await assert.rejects(prisma.$transaction(tx => aff.requireAffCodeForPurchase(tx, code.id, buyer.id, plan.id, 0.2)), /折扣已变更/)
  afterAuthentication = () => prisma.user.update({ where: { id: admin.id }, data: { role: 'user' } })
  assert.equal((await app.inject({ method: 'POST', url: applyUrl, payload: { affCode: code.code } })).statusCode, 403)
  afterAuthentication = undefined
  await prisma.user.update({ where: { id: admin.id }, data: { role: 'admin' } })
  await prisma.tokenInvalidation.create({ data: { userId: admin.id, sessionId: session.sid, invalidatedAt: session.iat } })
  assert.equal((await app.inject({ method: 'POST', url: applyUrl, payload: { affCode: code.code } })).statusCode, 403)
  await prisma.tokenInvalidation.deleteMany({ where: { userId: admin.id, sessionId: session.sid } })
  const accepted = await app.inject({ method: 'POST', url: applyUrl, payload: { affCode: code.code } })
  assert.equal(accepted.statusCode, 200, accepted.body)
  assert.equal((await app.inject({ method: 'POST', url: applyUrl, payload: { affCode: code.code } })).statusCode, 400)

  const instanceRenewal = await performRenewal(buyer.id, target, 1, undefined, session)
  assert.equal(instanceRenewal.amount, 9)
  assert.equal((await commissionState()).balance, 2)
  await setEnabled(false)
  const targetNow = await prisma.instance.findUniqueOrThrow({ where: { id: target.id } })
  assert.equal((await performRenewal(buyer.id, targetNow, 1, undefined, session)).amount, 10)
  assert.equal((await commissionState()).balance, 2)
  const migrated = await makeInstance()
  await prisma.$transaction(tx => aff.copyInstanceAffBinding(target.id, migrated.id, code.id, tx))
  assert.equal((await prisma.affBinding.findUniqueOrThrow({ where: { instanceId: migrated.id } })).affCodeId, code.id)
  await prisma.$transaction(tx => reverseInstanceAffCommissionForRefund({ tx, instanceId: target.id, refundAmount: 19, remark: tag }))
  assert.equal((await commissionState()).balance, 0, 'disabled historical code still permits legitimate refund commission reversal')
  assert.equal((await aff.deleteAffCode(referrer.id, code.id)).success, false, 'history cannot be removed by the unused-code delete path')

  actor = { ...session, id: buyer.id, username: buyer.username, role: 'user' }
  await setEnabled(true)
  before = await mailState()
  beforeTransaction = () => setEnabled(false)
  const changedRenewal = await app.inject({ method: 'POST', url: '/mail/subscription/renew', payload: { months: 1 } })
  assert.equal(changedRenewal.statusCode, 400, changedRenewal.body)
  assert.match(changedRenewal.body, /已变更/)
  assert.deepEqual(await mailState(), before, 'quote changed before settlement does not charge or extend')

  actor = { ...session, id: newBuyer.id, username: newBuyer.username, role: 'user' }
  await setEnabled(true)
  beforeTransaction = () => setEnabled(false)
  const changedPurchase = await app.inject({ method: 'POST', url: '/mail/subscription', payload: { planId: mailPlan.id, affCode: code.code } })
  assert.equal(changedPurchase.statusCode, 400, changedPurchase.body)
  assert.equal(await prisma.mailSubscription.count({ where: { userId: newBuyer.id } }), 0)
  assert.equal(await prisma.balanceLog.count({ where: { userId: newBuyer.id } }), 0)
  assert.equal(Number((await prisma.user.findUniqueOrThrow({ where: { id: newBuyer.id } })).balance), 500)
  await setEnabled(true)
  const goodPurchase = await app.inject({ method: 'POST', url: '/mail/subscription', payload: { planId: mailPlan.id, affCode: code.code } })
  assert.equal(goodPurchase.statusCode, 200, goodPurchase.body)
  assert.equal(goodPurchase.json().finalPrice, 9)
  assert.equal((await commissionState()).balance, 2)

  // A renewed disabled permanent binding cannot silently pay a different supplied code.
  await setEnabled(false)
  actor = { ...session, id: buyer.id, username: buyer.username, role: 'user' }
  await prisma.mailSubscription.update({ where: { id: subscription.id }, data: { status: 'expired', expiresAt: new Date(Date.now() - 86400000) } })
  const revived = await app.inject({ method: 'POST', url: '/mail/subscription', payload: { planId: mailPlan.id, affCode: secondCode.code } })
  assert.equal(revived.statusCode, 200, revived.body)
  assert.equal(revived.json().finalPrice, 10)
  assert.equal((await prisma.mailSubscriptionAffBinding.findUniqueOrThrow({ where: { mailSubscriptionId: subscription.id } })).affCodeId, code.id)
  assert.equal(await prisma.affLog.count({ where: { affCodeId: secondCode.id } }), 0)

  // Scope failure injection to this fixture's code; other suites share this local DB.
  await setEnabled(true)
  await prisma.$executeRawUnsafe(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.aff_code_id = ${code.id} THEN RAISE EXCEPTION 'fixture-aff-ledger-failure'; END IF; RETURN NEW; END $$`)
  await prisma.$executeRawUnsafe(`CREATE TRIGGER ${trigger} BEFORE INSERT ON aff_logs FOR EACH ROW EXECUTE FUNCTION ${trigger}()`)
  triggerCreated = true
  before = await mailState()
  const failedRenewal = await app.inject({ method: 'POST', url: '/mail/subscription/renew', payload: { months: 1 } })
  assert.equal(failedRenewal.statusCode, 500)
  assert.deepEqual(await mailState(), before, 'buyer debit, expiry, referrer credit, logs and statistics roll back together')
  await assert.rejects(aff.processAffCommission(code.id, target.id, 10, 'renew'), /fixture-aff-ledger-failure/)
  assert.deepEqual(await mailState(), before, 'standalone commission entry point is atomic too')
  await prisma.$executeRawUnsafe(`DROP TRIGGER ${trigger} ON aff_logs`)
  await prisma.$executeRawUnsafe(`DROP FUNCTION ${trigger}()`)
  triggerCreated = false

  // Refund/conversion may need host-owner and buyer rows after the AFF lock.
  // Actual mutation entry points must return busy and release their earlier rows.
  const busyAdminTarget = await makeInstance()
  const busyAutoTarget = await makeInstance()
  await aff.createAffBinding(busyAutoTarget.id, code.id)
  const autoTarget = await prisma.instance.update({ where: { id: busyAutoTarget.id }, data: {
    autoRenew: true, expiresAt: new Date(Date.now() + 12 * 3600000), autoRenewAttempts: 0, lastAutoRenewAttemptAt: null
  } })
  const busyMailCandidate = await prisma.mailSubscription.update({ where: { id: subscription.id }, data: { expiresAt: new Date(Date.now() + 86400000) } })
  let balanceLocked!: () => void
  const balanceLockedGate = new Promise<void>(resolve => { balanceLocked = resolve })
  let inspectCode!: () => void
  const inspectCodeGate = new Promise<void>(resolve => { inspectCode = resolve })
  const reverseOrderProbe = prisma.$transaction(async tx => {
    await advisoryTransactionLock(tx, USER_AFF_BALANCE_LOCK_NAMESPACE, referrer.id)
    balanceLocked()
    await inspectCodeGate
    await tx.$queryRaw`SELECT id FROM aff_codes WHERE id = ${code.id} FOR UPDATE NOWAIT`
    await tx.$queryRaw`SELECT id FROM hosts WHERE id = ${host.id} FOR UPDATE NOWAIT`
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${admin.id} OR id = ${buyer.id} FOR UPDATE NOWAIT`
  }, { timeout: 10000 })
  await balanceLockedGate
  try {
    const beforeBusy = await mailState()
    const hostUsage = await prisma.host.findUniqueOrThrow({ where: { id: host.id }, select: { cpuUsed: true } })
    // This is the creation transaction's reservation/account/AFF boundary, without Incus delivery.
    await assert.rejects(prisma.$transaction(async tx => {
      await tx.host.update({ where: { id: host.id }, data: { cpuUsed: { increment: 100 } } })
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${buyer.id} FOR UPDATE`
      await aff.requireAffCodeForPurchase(tx, code.id, buyer.id, plan.id)
    }), aff.AffCodeBusyError)
    assert.deepEqual(await prisma.host.findUniqueOrThrow({ where: { id: host.id }, select: { cpuUsed: true } }), hostUsage, 'busy purchase eligibility rolls back host reservation')
    const busyRenewal = await app.inject({ method: 'POST', url: `/instances/${target.id}/renew`, payload: { months: 1 } })
    assert.equal(busyRenewal.statusCode, 409, busyRenewal.body)
    const busyMail = await app.inject({ method: 'POST', url: '/mail/subscription/renew', payload: { months: 1 } })
    assert.equal(busyMail.statusCode, 409, busyMail.body)
    assert.equal((await processMailAutoRenew(busyMailCandidate, new Date(), new Date(Date.now() + 3 * 86400000))).status, 'busy')
    await processAutoRenew(autoTarget)
    const deferred = await prisma.instance.findUniqueOrThrow({ where: { id: autoTarget.id } })
    assert.equal(deferred.autoRenew, true)
    assert.equal(deferred.autoRenewAttempts, 0)
    assert.equal(deferred.lastAutoRenewAttemptAt, null)
    assert.equal(deferred.expiresAt!.toISOString(), autoTarget.expiresAt!.toISOString())
    assert.equal(await prisma.log.count({ where: { instanceId: autoTarget.id, action: 'instance.auto_renew_deferred' } }), 1)
    actor = { ...session, id: admin.id, username: admin.username, role: 'admin' }
    const busyApplication = await app.inject({ method: 'POST', url: `/api/admin/instances/${busyAdminTarget.id}/apply-aff`, payload: { affCode: code.code } })
    assert.equal(busyApplication.statusCode, 409, busyApplication.body)
    assert.equal(await prisma.affBinding.count({ where: { instanceId: busyAdminTarget.id } }), 0)
    assert.deepEqual(await mailState(), beforeBusy, 'busy mutation paths write no debit, expiry or commission ledger')
  } finally {
    inspectCode()
    await reverseOrderProbe
  }
  const retryApplication = await app.inject({ method: 'POST', url: `/api/admin/instances/${busyAdminTarget.id}/apply-aff`, payload: { affCode: code.code } })
  assert.equal(retryApplication.statusCode, 200, retryApplication.body)
  await processAutoRenew(autoTarget)
  assert.ok((await prisma.instance.findUniqueOrThrow({ where: { id: autoTarget.id } })).expiresAt! > autoTarget.expiresAt!, 'the next natural inspection remains eligible and can renew')
  assert.equal((await processMailAutoRenew(busyMailCandidate, new Date(), new Date(Date.now() + 3 * 86400000))).status, 'renewed')
  actor = { ...session, id: buyer.id, username: buyer.username, role: 'user' }

  // A disabling transaction must wait for a previously accepted settlement.
  let release!: () => void
  const releaseGate = new Promise<void>(resolve => { release = resolve })
  let locked!: () => void
  const lockedGate = new Promise<void>(resolve => { locked = resolve })
  const settling = prisma.$transaction(async tx => {
    await aff.requireAffCodeForPurchase(tx, code.id, buyer.id, plan.id, 0.1)
    locked()
    await releaseGate
    await aff.processAffCommission(code.id, target.id, 10, 'renew', tx)
  }, { timeout: 10000 })
  await lockedGate
  let disablerPid!: number
  let starting!: () => void
  const startingGate = new Promise<void>(resolve => { starting = resolve })
  const disabling = prisma.$transaction(async tx => {
    disablerPid = (await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`)[0].pid
    starting()
    await tx.affCode.update({ where: { id: code.id }, data: { enabled: false } })
  }, { timeout: 10000 })
  await startingGate
  let observedWait = false
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      const rows = await prisma.$queryRaw<Array<{ waiting: boolean }>>`SELECT wait_event_type = 'Lock' AS waiting FROM pg_stat_activity WHERE pid = ${disablerPid}`
      if (rows[0]?.waiting) { observedWait = true; break }
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    assert.equal(observedWait, true, 'the real PostgreSQL code row lock serializes disable with settlement')
  } finally {
    release()
    await Promise.all([settling, disabling])
  }
  const settled = await commissionState()
  await aff.processAffCommission(code.id, target.id, 10, 'renew')
  assert.deepEqual(await commissionState(), settled)
  await assert.rejects(prisma.$transaction(tx => aff.requireAffCodeForPurchase(tx, code.id, buyer.id, plan.id, 0.1)), /优惠码已禁用/)
  console.log('PASS real PostgreSQL/Fastify AFF: disabled validation/new bindings/commissions, admin current session and role, mail manual/automatic renewals, stale purchase/renewal quotes, disabled permanent migration/revival/refund reversal, atomic ledger failure, and observed disable/settlement row-lock ordering')
} finally {
  beforeTransaction = undefined
  afterAuthentication = undefined
  if (triggerCreated) {
    await prisma.$executeRawUnsafe(`DROP TRIGGER ${trigger} ON aff_logs`)
    await prisma.$executeRawUnsafe(`DROP FUNCTION ${trigger}()`)
  }
  await app.close()
  prisma.$transaction = originalTransaction
  await prisma.balanceLog.deleteMany({ where: { userId: { in: [buyer.id, newBuyer.id] } } })
  await prisma.instance.deleteMany({ where: { hostId: host.id } })
  await prisma.mailSource.delete({ where: { id: source.id } })
  await prisma.package.delete({ where: { id: pkg.id } })
  await prisma.host.delete({ where: { id: host.id } })
  await prisma.user.deleteMany({ where: { id: { in: [buyer.id, newBuyer.id, referrer.id, admin.id] } } })
  await closeAllClients()
  await closePrismaDatabase()
}
process.exit(0)
