import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mock } from 'node:test'
import Fastify from 'fastify'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_upaypro_test'), 'Use an isolated local *_upaypro_test database')
process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = randomBytes(32).toString('hex')
process.env.FRONTEND_URL = 'http://127.0.0.1:3000'
process.env.PAYMENT_CALLBACK_BASE_URL = 'http://127.0.0.1:3001'
process.env.PAYMENT_CALLBACK_IP_WHITELIST = '127.0.0.1'

const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const db = await import('../src/db/index.js')
const { default: rechargeRoutes } = await import('../src/routes/recharge.js')
const { readRechargePaymentDetails } = await import('../src/lib/recharge-payment-details.js')

const secret = randomBytes(32).toString('hex')
let gatewaySecret = secret
const origin = 'https://8.8.8.8'
const prefix = `upay-test-${randomUUID().slice(0, 8)}`
const userIds: number[] = []
const providerIds: number[] = []
const invoices = new Map<string, Record<string, any>>()
let tradeSequence = 0
function signature(payload: Record<string, any>, key: string) {
  // Independent reference for these test invoices (all amounts are below 1e6).
  const content = Object.keys(payload).filter(key => key !== 'signature').sort().map(key => `${key}=${payload[key]}`).join('&')
  return createHash('md5').update(content + key).digest('hex')
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}
const delayedRequests: Array<{ seen: ReturnType<typeof deferred<Record<string, any>>>; release: ReturnType<typeof deferred<void>> }> = []

// Exercise the real SDK, routes and PostgreSQL transactions; replace only the remote gateway.
const fetchMock = mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
  assert.equal(url, `${origin}/api/create_order`, 'integration test must not contact another service')
  const payload = JSON.parse(String(init?.body))
  assert.ok(payload.signature === signature(payload, gatewaySecret), 'gateway rejected the request signature')
  assert.equal(init?.redirect, 'manual')
  assert.ok(typeof payload.type === 'string')
  const tradeId = `20261016${String(++tradeSequence).padStart(10, '0')}`
  const invoice = {
    order_id: payload.order_id, trade_id: tradeId, amount: payload.amount,
    actual_amount: Number((payload.amount / 7 + tradeSequence / 100).toFixed(2)),
    token: `TTestWallet${payload.type.replace(/[^A-Za-z0-9]/g, '')}`,
    expiration_time: Date.now() + 3_600_000,
    payment_url: `${origin}/pay/checkout-counter/${tradeId}`,
    paymentType: payload.type
  }
  invoices.set(payload.order_id, invoice)
  const delay = delayedRequests.shift()
  if (delay) {
    delay.seen.resolve(invoice)
    await delay.release.promise
  }
  return Response.json({ status_code: 200, data: invoice })
})

const app = Fastify()
app.decorate('authenticate', async (request: any, reply: any) => {
  const user = await prisma.user.findUnique({ where: { id: Number(request.headers['x-test-user']) || 0 } })
  if (!user || user.status !== 'active') return reply.code(401).send({ error: 'Unauthorized' })
  request.user = { id: user.id, username: user.username, role: user.role }
})
app.decorate('requireAdmin', async (request: any, reply: any) => {
  if (request.user?.role !== 'admin') return reply.code(403).send({ error: 'Forbidden' })
})
await app.register(rechargeRoutes)
function request(userId: number, method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: any) {
  return app.inject({ method, url, headers: { 'x-test-user': String(userId) }, ...(payload !== undefined ? { payload } : {}) })
}
async function makeUser(role: 'user' | 'admin') {
  const user = await prisma.user.create({ data: { username: `${prefix}-${userIds.length}`, passwordHash: 'unusable-test-hash', role, balance: 0 } })
  userIds.push(user.id)
  return user
}
const balance = async (userId: number) => Number((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).balance)
async function callback(providerId: number, invoice: Record<string, any>, patch: Record<string, unknown> = {}, key = secret) {
  const payload = {
    trade_id: invoice.trade_id, order_id: invoice.order_id, amount: invoice.amount,
    actual_amount: invoice.actual_amount, token: invoice.token, block_transaction_id: `tx_${invoice.trade_id}`,
    status: 2, ...patch
  }
  return app.inject({
    method: 'POST', url: `/api/recharge/callback/${providerId}`,
    payload: { ...payload, signature: signature(payload, key) }
  })
}
function assertOk(response: Awaited<ReturnType<typeof callback>>) {
  assert.equal(response.statusCode, 200)
  assert.equal(response.body, 'ok', 'UPAY requires an exact plain-text acknowledgement')
}

let failure: unknown
try {
  await prisma.systemConfig.upsert({ where: { key: 'free_site_mode' }, update: { value: 'false' }, create: { key: 'free_site_mode', value: 'false', type: 'boolean' } })
  const admin = await makeUser('admin')
  const user = await makeUser('user')
  const otherUser = await makeUser('user')
  const input = {
    name: 'USDT-TRC20', type: 'upaypro', status: 'disabled',
    config: { apiurl: origin, secret_key: secret, payment_type: 'USDT-TRC20' },
    feeRate: 0.02, feeFixed: 1, minAmount: 1, maxAmount: 1000
  }
  assert.equal((await request(user.id, 'POST', '/api/admin/payment-providers', input)).statusCode, 403)
  assert.equal((await request(0, 'POST', '/api/admin/payment-providers', input)).statusCode, 401)
  for (const patch of [{ apiurl: 'https://127.0.0.1' }, { payment_type: 'BTC' }, { secret_key: '' }]) {
    assert.equal((await request(admin.id, 'POST', '/api/admin/payment-providers', { ...input, config: { ...input.config, ...patch } })).statusCode, 400)
  }
  const createdProvider = await request(admin.id, 'POST', '/api/admin/payment-providers', input)
  assert.equal(createdProvider.statusCode, 200)
  assert.ok(!createdProvider.body.includes(secret), 'provider response must redact the secret')
  const provider = createdProvider.json().provider
  providerIds.push(provider.id)
  assert.equal(provider.config.secret_key, '')
  assert.equal(provider.config.secret_keyConfigured, true)
  assert.deepEqual(provider.methods, ['USDT-TRC20'])
  const storedProvider = await prisma.paymentProvider.findUniqueOrThrow({ where: { id: provider.id } })
  assert.equal(typeof storedProvider.config, 'string')
  assert.ok(!String(storedProvider.config).includes(secret), 'provider configuration must be encrypted at rest')
  assert.equal((await request(user.id, 'POST', '/api/recharge/orders', { providerId: provider.id, amount: 70 })).statusCode, 400)
  assert.equal((await request(admin.id, 'PATCH', `/api/admin/payment-providers/${provider.id}/status`, { status: 'active' })).statusCode, 200)
  const visibleProviders = await request(user.id, 'GET', '/api/recharge/providers')
  assert.ok(!visibleProviders.body.includes(secret))
  assert.ok(visibleProviders.json().providers.some((p: any) => p.id === provider.id && !('config' in p)))

  async function create(amount = 70) {
    const response = await request(user.id, 'POST', '/api/recharge/orders', { providerId: provider.id, amount, paymentMethod: 'USDT-BSC' })
    assert.equal(response.statusCode, 200, 'creating a UPAY recharge should succeed')
    const order = response.json().order
    const invoice = invoices.get(order.orderNo)!
    assert.ok(invoice)
    assert.equal(invoice.paymentType, 'USDT-TRC20', 'the client must not override the configured currency/network')
    assert.equal(response.json().payUrl, invoice.payment_url)
    assert.equal(order.expiredAt, new Date(invoice.expiration_time).toISOString())
    const record = await prisma.rechargeRecord.findUniqueOrThrow({ where: { orderNo: order.orderNo } })
    assert.equal(record.paymentMethod, 'USDT-TRC20')
    assert.ok(record.providerConfigSnapshot && !record.providerConfigSnapshot.includes(secret))
    assert.equal(readRechargePaymentDetails(record.paymentDetails).upaypro?.tradeId, invoice.trade_id)
    return { order, invoice, record }
  }

  const first = await create()
  assert.equal(first.order.actualAmount, 67.6, 'CNY 70 minus CNY 2.4 fees must credit CNY 67.6')
  assert.equal((await request(otherUser.id, 'POST', `/api/recharge/orders/${first.order.orderNo}/verify`, {})).statusCode, 403)
  const pending = await request(user.id, 'POST', `/api/recharge/orders/${first.order.orderNo}/verify`, {})
  assert.equal(pending.json().verified, false, 'a status-only query or return-page visit must not credit funds')
  assert.equal(await balance(user.id), 0)

  for (const patch of [
    { amount: 69.99 }, { amount: 70.01 }, { actual_amount: first.invoice.actual_amount + 1 },
    { token: 'TDifferentWallet' }, { trade_id: 'different-trade' }, { amount: '70' }, { status: '2' }
  ]) assert.equal((await callback(provider.id, first.invoice, patch)).statusCode, 400)
  assert.equal((await callback(provider.id, first.invoice, {}, randomBytes(32).toString('hex'))).statusCode, 400)
  assertOk(await callback(provider.id, first.invoice, { status: 1 }))
  assertOk(await callback(provider.id, first.invoice, { status: 3 }))
  assert.equal(await balance(user.id), 0)
  assert.equal(await prisma.paymentCallback.count({ where: { providerId: provider.id } }), 0)

  const duplicates = await Promise.all(Array.from({ length: 8 }, () => callback(provider.id, first.invoice)))
  duplicates.forEach(assertOk)
  assert.equal(await balance(user.id), 67.6)
  assert.equal(await prisma.balanceLog.count({ where: { orderId: first.order.orderNo } }), 1)
  assert.equal(await prisma.inboxMessage.count({ where: { userId: user.id, eventType: 'recharge_success' } }), 1)
  assert.equal(await prisma.paymentCallback.count({ where: { orderNo: first.order.orderNo } }), 1)
  assertOk(await callback(provider.id, first.invoice))
  const verified = await request(user.id, 'POST', `/api/recharge/orders/${first.order.orderNo}/verify`, {})
  assert.equal(verified.json().verified, true)
  assert.equal(verified.json().order.paymentCurrency, 'USDT')
  assert.equal(verified.json().order.paymentTxid, `tx_${first.invoice.trade_id}`)

  const retry = await create(14)
  assert.equal((await request(otherUser.id, 'POST', `/api/recharge/orders/${retry.order.orderNo}/repay`, {})).statusCode, 403)
  const repaid = await request(user.id, 'POST', `/api/recharge/orders/${retry.order.orderNo}/repay`, {})
  assert.equal(repaid.statusCode, 200)
  assert.equal(repaid.json().previousPaymentLinkInvalidated, true)
  const retriedRecord = await prisma.rechargeRecord.findUniqueOrThrow({ where: { orderNo: retry.order.orderNo } })
  const latestInvoice = invoices.get(readRechargePaymentDetails(retriedRecord.paymentDetails).upaypro!.orderId)!
  assert.notEqual(latestInvoice.order_id, retry.invoice.order_id)
  assertOk(await callback(provider.id, retry.invoice))
  assert.equal(await balance(user.id), 67.6, 'superseded payment attempts must not credit')
  assertOk(await callback(provider.id, latestInvoice))
  assert.equal(await balance(user.id), 80.32)

  // A notification may race ahead of create_order's response and metadata persistence.
  const earlyGate = { seen: deferred<Record<string, any>>(), release: deferred<void>() }
  delayedRequests.push(earlyGate)
  const earlyCreate = request(user.id, 'POST', '/api/recharge/orders', { providerId: provider.id, amount: 21 })
  const earlyInvoice = await earlyGate.seen.promise
  assert.equal((await callback(provider.id, earlyInvoice)).statusCode, 400)
  assert.equal(await prisma.paymentCallback.count({ where: { orderNo: earlyInvoice.order_id } }), 0)
  earlyGate.release.resolve()
  assert.equal((await earlyCreate).statusCode, 200)
  assertOk(await callback(provider.id, earlyInvoice))
  assert.equal(await balance(user.id), 99.9)

  // Only one concurrent retry may replace the same active invoice.
  const raced = await create(28)
  const gates = [
    { seen: deferred<Record<string, any>>(), release: deferred<void>() },
    { seen: deferred<Record<string, any>>(), release: deferred<void>() }
  ]
  delayedRequests.push(...gates)
  const attempts = [0, 1].map(() => request(user.id, 'POST', `/api/recharge/orders/${raced.order.orderNo}/repay`, {}))
  await Promise.all(gates.map(gate => gate.seen.promise))
  gates[0].release.resolve()
  // Wait for a response before releasing the second gateway request; request ordering is not assumed.
  const winner = await Promise.race(attempts)
  assert.equal(winner.statusCode, 200)
  gates[1].release.resolve()
  const outcomes = await Promise.all(attempts)
  assert.deepEqual(outcomes.map(result => result.statusCode).sort(), [200, 409])
  const racedRecord = await prisma.rechargeRecord.findUniqueOrThrow({ where: { orderNo: raced.order.orderNo } })
  const activeInvoice = invoices.get(readRechargePaymentDetails(racedRecord.paymentDetails).upaypro!.orderId)!
  const staleCompletion = db.completeRecharge(raced.order.orderNo, {
    tradeNo: raced.invoice.trade_id, actualAmount: 1, expectedPaymentDetails: raced.record.paymentDetails as Record<string, unknown>
  })
  await assert.rejects(() => staleCompletion, /订单状态已变更/)
  assert.equal(await balance(user.id), 99.9, 'stale callback state must not bypass the transactional attempt check')
  assertOk(await callback(provider.id, activeInvoice))
  assert.equal(await balance(user.id), 126.34)

  const cancelled = await create(7)
  assert.equal((await request(user.id, 'POST', `/api/recharge/orders/${cancelled.order.orderNo}/cancel`, {})).statusCode, 200)
  assert.equal((await callback(provider.id, cancelled.invoice)).statusCode, 400)
  assert.equal(await balance(user.id), 126.34)
  const late = await create(7)
  await prisma.rechargeRecord.update({ where: { orderNo: late.order.orderNo }, data: { expiredAt: new Date(Date.now() - 1000) } })
  assertOk(await callback(provider.id, late.invoice))
  assert.equal(await balance(user.id), 132.2, 'valid late notifications must retain the existing crediting policy')

  const beforeRotation = await create(7)
  const rotatedSecret = randomBytes(32).toString('hex')
  const rotated = await request(admin.id, 'PUT', `/api/admin/payment-providers/${provider.id}`, {
    config: { ...input.config, secret_key: rotatedSecret, payment_type: 'USDT-Polygon' }
  })
  assert.equal(rotated.statusCode, 200)
  assert.ok(!rotated.body.includes(rotatedSecret))
  assert.equal(rotated.json().provider.name, 'USDT-Polygon')
  gatewaySecret = rotatedSecret
  const kept = await request(admin.id, 'PUT', `/api/admin/payment-providers/${provider.id}`, {
    config: { ...input.config, secret_key: '', secret_keyConfigured: true, payment_type: 'USDT-Polygon' }
  })
  assert.equal(kept.statusCode, 200)
  assert.ok((await db.getPaymentProviderById(provider.id))?.config && (await db.getPaymentProviderById(provider.id))!.config !== null)
  const decryptedConfig = (await db.getPaymentProviderById(provider.id))!.config as Record<string, unknown>
  assert.ok(decryptedConfig.secret_key === rotatedSecret, 'blank edit must retain the configured secret')
  assert.equal((await request(admin.id, 'PATCH', `/api/admin/payment-providers/${provider.id}/status`, { status: 'disabled' })).statusCode, 200)
  assertOk(await callback(provider.id, beforeRotation.invoice))
  assert.equal(await balance(user.id), 138.06, 'in-flight orders must use their original key and network snapshot')

  // Preserve the existing payment URL contract for built-in providers.
  for (const type of ['yipay', 'manual'] as const) {
    const legacy = await db.createPaymentProvider({
      name: `${prefix}-${type}`, type, status: 'active',
      config: type === 'yipay' ? { apiurl: origin, version: 'v1', pid: 'test', key: secret } : { instructions: 'Local test payment instructions' },
      methods: type === 'yipay' ? ['alipay'] : []
    })
    providerIds.push(legacy.id)
    const response = await request(user.id, 'POST', '/api/recharge/orders', { providerId: legacy.id, amount: 10 })
    assert.equal(response.statusCode, 200)
    if (type === 'yipay') assert.ok(response.json().payUrl.startsWith(`${origin}/submit.php?`))
    else {
      assert.equal(response.json().payUrl, null)
      assert.ok(response.json().manualPayment.instructions)
    }
  }
  console.log('UPAY Pro PostgreSQL integration tests passed: create, callback, money, replay, retry races, snapshots and legacy providers')
} catch (error) {
  failure = error
} finally {
  delayedRequests.splice(0).forEach(gate => gate.release.resolve())
  fetchMock.mock.restore()
  await app.close()
  await prisma.paymentCallback.deleteMany({ where: { providerId: { in: providerIds } } })
  await prisma.rechargeRecord.deleteMany({ where: { providerId: { in: providerIds } } })
  await prisma.paymentProvider.deleteMany({ where: { id: { in: providerIds } } })
  await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  await closePrismaDatabase()
}
if (failure) console.error(failure)
// Imported services own background timers; cleanup is complete before exiting.
process.exit(failure ? 1 : 0)
