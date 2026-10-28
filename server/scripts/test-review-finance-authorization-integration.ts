import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { randomUUID } from 'node:crypto'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'), 'Use an isolated local *_pool_test database')
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const aff = await import('../src/db/aff.js')
const recharge = await import('../src/db/recharge-records.js')
const cards = await import('../src/db/gift-cards.js')
const { invalidateAllConfigCache } = await import('../src/lib/config-cache.js')
const { default: affRoutes } = await import('../src/routes/aff.js')
const { default: rechargeRoutes } = await import('../src/routes/recharge.js')
const { default: adminRoutes } = await import('../src/routes/admin-billing.js')
const { default: cardRoutes } = await import('../src/routes/gift-cards.js')
const tag = randomUUID()
const user = await prisma.user.create({ data: { username: `finance-${tag}`, passwordHash: 'unusable-fixture', balance: 200, affBalance: 20 } })
const admin = await prisma.user.create({ data: { username: `finance-admin-${tag}`, passwordHash: 'unusable-fixture', role: 'admin' } })
const session = { sid: `fixture-${tag}`, iat: Math.floor(Date.now() / 1000) + 1 }
const userActor = { ...session, id: user.id, username: user.username, role: 'user' }
const adminActor = { ...session, id: admin.id, username: admin.username, role: 'admin' }
let currentActor = userActor
let afterAuthentication: (() => Promise<unknown>) | undefined
const app = Fastify()
app.decorate('authenticate', async (request: any) => {
  request.user = { ...currentActor }
  await afterAuthentication?.()
})
app.decorate('requireAdmin', async () => {})
app.decorate('authenticateAdmin', async (request: any) => { request.user = { ...currentActor }; await afterAuthentication?.() })
const provider = await prisma.paymentProvider.create({ data: { name: tag, type: 'yipay', status: 'active',
  config: { version: 'v1', apiurl: 'https://8.8.8.8/', pid: 'fixture', key: 'fixture-unusable-key' } } })
const order = () => prisma.rechargeRecord.create({ data: { userId: user.id, providerId: provider.id, amount: 10, orderNo: `fixture-${randomUUID()}` } })
const pendingWithdrawal = () => prisma.affWithdrawal.create({ data: { userId: user.id, amount: 1 } })
const originalFetch = globalThis.fetch
const configKeys = ['payincus_gift_card_admin_ids', 'turnstile_enabled']
const originalConfigs = await prisma.systemConfig.findMany({ where: { key: { in: configKeys } } })
const setConfig = async (key: string, value: string) => {
  await prisma.systemConfig.upsert({ where: { key }, create: { key, value }, update: { value } })
  invalidateAllConfigCache()
}
const financeState = async () => ({
  user: await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { balance: true, affBalance: true } }),
  balanceLogs: await prisma.balanceLog.count({ where: { userId: user.id } }),
  affLogs: await prisma.affLog.count({ where: { userId: user.id } })
})
const trigger = `review_finance_${tag.replaceAll('-', '')}`
try {
  await setConfig('turnstile_enabled', 'false')
  await setConfig('payincus_gift_card_admin_ids', String(admin.id))
  await app.register(affRoutes, { prefix: '/aff' })
  await app.register(rechargeRoutes)
  await app.register(adminRoutes)
  await app.register(cardRoutes, { prefix: '/cards' })

  afterAuthentication = () => prisma.user.update({ where: { id: user.id }, data: { status: 'banned' } })
  let before = await financeState()
  const deniedConvert = await app.inject({ method: 'POST', url: '/aff/me/convert', payload: { amount: 2 } })
  assert.equal(deniedConvert.statusCode, 403, deniedConvert.body)
  assert.deepEqual(await financeState(), before)
  afterAuthentication = undefined
  await prisma.user.update({ where: { id: user.id }, data: { status: 'active' } })
  const conversions = await Promise.all(Array.from({ length: 6 }, () => aff.createAffWithdrawal(user.id, 4, session)))
  assert.equal(conversions.filter(r => r.success).length, 5)
  assert.equal(Number((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).affBalance), 0)
  await prisma.tokenInvalidation.create({ data: { userId: user.id, sessionId: session.sid, invalidatedAt: session.iat } })
  assert.equal((await aff.createAffWithdrawal(user.id, 1, session)).error, 'AFF_ACTOR_FORBIDDEN')
  await prisma.tokenInvalidation.deleteMany({ where: { userId: user.id } })
  await prisma.user.update({ where: { id: user.id }, data: { affBalance: 10 } })

  currentActor = adminActor
  afterAuthentication = () => prisma.user.update({ where: { id: admin.id }, data: { role: 'user' } })
  const pending = await pendingWithdrawal()
  for (const action of ['approve', 'reject']) {
    const response = await app.inject({ method: 'POST', url: `/aff/admin/withdrawals/${pending.id}/${action}`, ...(action === 'reject' ? { payload: { reason: 'Fixture reason' } } : {}) })
    assert.equal(response.statusCode, 403, response.body)
    assert.equal((await prisma.affWithdrawal.findUniqueOrThrow({ where: { id: pending.id } })).status, 'pending')
  }
  afterAuthentication = undefined
  await prisma.user.update({ where: { id: admin.id }, data: { role: 'admin' } })
  const approvals = await Promise.all(Array.from({ length: 5 }, () => aff.approveAffWithdrawal(pending.id, adminActor)))
  assert.equal(approvals.filter(r => r.success).length, 1)
  const rejected = await pendingWithdrawal()
  assert.equal((await aff.rejectAffWithdrawal(rejected.id, adminActor, 'Fixture reason')).success, true)

  const rechargeOrder = await order()
  before = await financeState()
  afterAuthentication = () => prisma.user.update({ where: { id: admin.id }, data: { role: 'user' } })
  for (const action of ['complete', 'fail']) {
    const response = await app.inject({ method: 'POST', url: `/api/admin/recharge/orders/${rechargeOrder.orderNo}/${action}`, payload: action === 'complete' ? { actualAmount: 10 } : { reason: 'Fixture' } })
    assert.equal(response.statusCode, 403, response.body)
    assert.equal((await prisma.rechargeRecord.findUniqueOrThrow({ where: { id: rechargeOrder.id } })).status, 'pending')
    assert.deepEqual(await financeState(), before)
  }
  afterAuthentication = undefined
  await prisma.user.update({ where: { id: admin.id }, data: { role: 'admin' } })
  let paidMoney: unknown = '10.00'
  let revokeDuringQuery = true
  globalThis.fetch = async () => {
    if (revokeDuringQuery) await prisma.tokenInvalidation.upsert({
      where: { userId_sessionId: { userId: admin.id, sessionId: session.sid } },
      create: { userId: admin.id, sessionId: session.sid, invalidatedAt: session.iat }, update: { invalidatedAt: session.iat }
    })
    return new Response(JSON.stringify({ code: 1, status: 1, money: paidMoney, trade_no: `fixture-trade-${tag}`, out_trade_no: rechargeOrder.orderNo }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const sync = await app.inject({ method: 'POST', url: `/api/admin/billing/recharge-records/${rechargeOrder.id}/sync` })
  assert.equal(sync.statusCode, 403, sync.body)
  assert.deepEqual(await financeState(), before, 'logout while provider query is pending prevents settlement')
  await prisma.tokenInvalidation.deleteMany({ where: { userId: admin.id } })
  revokeDuringQuery = false
  for (const malformed of [undefined, '0', '10junk', '-10', 'NaN']) {
    paidMoney = malformed
    const response = await app.inject({ method: 'POST', url: `/api/admin/billing/recharge-records/${rechargeOrder.id}/sync` })
    assert.equal(response.statusCode, 400, response.body)
    assert.deepEqual(await financeState(), before)
  }
  paidMoney = '10.00'
  assert.equal((await app.inject({ method: 'POST', url: `/api/admin/billing/recharge-records/${rechargeOrder.id}/sync` })).statusCode, 200)
  assert.equal(await prisma.balanceLog.count({ where: { userId: user.id, orderId: rechargeOrder.orderNo } }), 1)
  const automatic = await order()
  await prisma.user.update({ where: { id: user.id }, data: { status: 'banned' } })
  const automaticResults = await Promise.all(Array.from({ length: 5 }, () => recharge.completeRecharge(automatic.orderNo, { actualAmount: 10 })))
  assert.equal(automaticResults.filter(r => r.completedNow).length, 1, 'provider settlement remains independent from Web session and credits once')
  await prisma.user.update({ where: { id: user.id }, data: { status: 'active' } })

  // A persistent ledger failure must roll back both status and money.
  const rollbackOrder = await order()
  await prisma.$executeRawUnsafe(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.user_id = ${user.id} THEN RAISE EXCEPTION 'fixture-finance-ledger-failure'; END IF; RETURN NEW; END $$`)
  await prisma.$executeRawUnsafe(`CREATE TRIGGER ${trigger} BEFORE INSERT ON balance_logs FOR EACH ROW EXECUTE FUNCTION ${trigger}()`)
  before = await financeState()
  try {
    await assert.rejects(recharge.completeRecharge(rollbackOrder.orderNo, { actualAmount: 10, actor: adminActor }), /fixture-finance-ledger-failure/)
    assert.equal((await prisma.rechargeRecord.findUniqueOrThrow({ where: { id: rollbackOrder.id } })).status, 'pending')
    assert.equal((await aff.createAffWithdrawal(user.id, 1, session)).success, false)
    await assert.rejects(cards.generateGiftCardFromBalance({ userId: user.id, faceValue: 2, session }), /fixture-finance-ledger-failure/)
    assert.deepEqual(await financeState(), before)
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER ${trigger} ON balance_logs`)
    await prisma.$executeRawUnsafe(`DROP FUNCTION ${trigger}()`)
  }

  afterAuthentication = () => prisma.user.update({ where: { id: admin.id }, data: { role: 'user' } })
  const managed = await cards.createGiftCard({ faceValue: 2, balanceValue: 2, createdById: admin.id })
  const disabled = await cards.createGiftCard({ faceValue: 2, balanceValue: 2, createdById: admin.id })
  await cards.disableGiftCard(disabled.id)
  for (const [method, path, payload] of [
    ['POST', '/admin/generate', { faceValue: 2 }], ['POST', '/admin/batch', { count: 2, faceValue: 2 }],
    ['PATCH', `/admin/${managed.id}/disable`, undefined], ['DELETE', `/admin/${managed.id}`, undefined],
    ['PATCH', `/admin/${disabled.id}/enable`, undefined], ['POST', '/admin/batch-disable', { ids: [managed.id] }],
    ['POST', '/admin/batch-delete', { ids: [managed.id] }]
  ] as const) {
    await prisma.user.update({ where: { id: admin.id }, data: { role: 'admin' } })
    const response = await app.inject({ method, url: `/cards${path}`, ...(payload ? { payload } : {}) })
    assert.equal(response.statusCode, 403, response.body)
  }
  afterAuthentication = undefined
  await prisma.user.update({ where: { id: admin.id }, data: { role: 'admin' } })
  afterAuthentication = () => prisma.systemConfig.update({ where: { key: 'payincus_gift_card_admin_ids' }, data: { value: '999999999' } })
  assert.equal((await app.inject({ method: 'POST', url: '/cards/admin/generate', payload: { faceValue: 2 } })).statusCode, 403, 'write sees allowlist removed after cached request gate')
  afterAuthentication = undefined
  await setConfig('payincus_gift_card_admin_ids', String(admin.id))
  assert.equal((await app.inject({ method: 'POST', url: '/cards/admin/generate', payload: { faceValue: 2 } })).statusCode, 201)

  currentActor = userActor
  const funded = await cards.generateGiftCardFromBalance({ userId: user.id, faceValue: 2, session })
  before = await financeState()
  afterAuthentication = () => prisma.user.update({ where: { id: user.id }, data: { status: 'banned' } })
  for (const [path, payload] of [['/user/generate', { faceValue: 2 }], ['/user/redeem', { code: managed.code }], [`/user/${funded.giftCard.id}/revoke`, undefined]] as const) {
    const response = await app.inject({ method: 'POST', url: `/cards${path}`, ...(payload ? { payload } : {}) })
    assert.equal(response.statusCode, 403, response.body)
    assert.deepEqual(await financeState(), before)
  }
  afterAuthentication = undefined
  await prisma.user.update({ where: { id: user.id }, data: { status: 'active' } })
  assert.equal((await app.inject({ method: 'POST', url: `/cards/user/${funded.giftCard.id}/revoke` })).statusCode, 200)
  assert.equal((await app.inject({ method: 'POST', url: `/cards/user/${funded.giftCard.id}/revoke` })).statusCode, 200)
  assert.equal(await prisma.balanceLog.count({ where: { userId: user.id, remark: { contains: `gift-card-refund:${funded.giftCard.id}` } } }), 1)
  const redemptions = await Promise.all(Array.from({ length: 5 }, () => cards.redeemGiftCard(managed.code, user.id, session).then(() => true, () => false)))
  assert.equal(redemptions.filter(Boolean).length, 1)
  await prisma.tokenInvalidation.create({ data: { userId: user.id, sessionId: session.sid, invalidatedAt: session.iat } })
  await assert.rejects(cards.redeemGiftCard(disabled.code, user.id, session), /GIFT_CARD_ACTOR_FORBIDDEN/)
  console.log('PASS real PostgreSQL/Fastify finance: in-flight ban/demotion/logout/allowlist rejection, AFF and recharge single settlement, automatic provider credit, gift-card issuer/refund/redeem and ledger fault atomic rollback; provider HTTPS is a fetch fixture')
} finally {
  globalThis.fetch = originalFetch
  await app.close()
  await prisma.paymentCallback.deleteMany({ where: { providerId: provider.id } })
  await prisma.giftCard.deleteMany({ where: { createdById: { in: [user.id, admin.id] } } })
  await prisma.user.deleteMany({ where: { id: { in: [user.id, admin.id] } } })
  await prisma.paymentProvider.delete({ where: { id: provider.id } })
  await prisma.systemConfig.deleteMany({ where: { key: { in: configKeys } } })
  for (const row of originalConfigs) await prisma.systemConfig.create({ data: row })
  invalidateAllConfigCache()
  await closePrismaDatabase()
}
process.exit(0)
