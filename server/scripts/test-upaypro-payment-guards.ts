import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { mock } from 'node:test'
import {
  buildUpayProConfig, formatUpayProNumber, signUpayProOrder, UpayProClient,
  UPAY_PRO_PAYMENT_TYPES, upayProMoneyToCents, verifyUpayProNotification
} from '../src/lib/upaypro.js'
import { buildUpayProPaymentDetails, extractRechargePaymentDisplayInfo } from '../src/lib/recharge-payment-details.js'

const secret = randomBytes(32).toString('hex')
const built = buildUpayProConfig({ apiurl: 'https://8.8.8.8/', secret_key: secret, payment_type: 'USDT-TRC20' })
assert.equal(built.valid, true)
assert.equal(built.config.apiurl, 'https://8.8.8.8')
for (const payment_type of UPAY_PRO_PAYMENT_TYPES) {
  assert.equal(buildUpayProConfig({ ...built.config, payment_type }).valid, true)
}
for (const patch of [
  { payment_type: 'BTC' }, { payment_type: 'usdt-trc20' }, { secret_key: '' },
  { apiurl: 'http://8.8.8.8' }, { apiurl: 'https://8.8.8.8/api/create_order' },
  { apiurl: 'https://user:password@8.8.8.8' }, { apiurl: 'https://8.8.8.8/?a=b' },
  { apiurl: 'https://8.8.8.8/#fragment' }, { apiurl: 'javascript:alert(1)' }
]) assert.equal(buildUpayProConfig({ ...built.config, ...patch }).valid, false)

// Go fmt %g uses scientific notation at 1e6 and pads the exponent to two digits.
for (const [value, text] of [
  [0, '0'], [1.23, '1.23'], [100.50, '100.5'], [100000, '100000'],
  [1000000, '1e+06'], [1000000.25, '1.00000025e+06'], [99999999.99, '9.999999999e+07'],
  [0.0001, '0.0001'], [0.00001, '1e-05'], [1.0001, '1.0001'], [1e-7, '1e-07']
] as const) assert.equal(formatUpayProNumber(value), text)
assert.throws(() => formatUpayProNumber(Infinity))
assert.equal(upayProMoneyToCents(70.01), 7001)
assert.equal(upayProMoneyToCents(99_999_999.99), 9_999_999_999)
for (const value of ['70', null, undefined, NaN, Infinity, 0, -1, 0.001, 70.001, 100_000_000]) {
  assert.equal(upayProMoneyToCents(value), null)
}

const input = {
  order_id: 'R_UPAY_GUARD', amount: 70,
  notify_url: 'https://pay.example.com/api/recharge/callback/1',
  redirect_url: 'https://pay.example.com/wallet?recharge=success&out_trade_no=R_UPAY_GUARD'
}
const requestContent = 'amount=70&notify_url=https://pay.example.com/api/recharge/callback/1&order_id=R_UPAY_GUARD&redirect_url=https://pay.example.com/wallet?recharge=success&out_trade_no=R_UPAY_GUARD&type=USDT-TRC20'
assert.equal(signUpayProOrder(input, built.config), createHash('md5').update(requestContent + secret).digest('hex'))

const notification = {
  trade_id: '202610160000000001', order_id: input.order_id, amount: 70,
  actual_amount: 10.0001, token: 'TGuardWalletAddress', block_transaction_id: 'abcdef0123456789', status: 2
}
const callbackContent = 'actual_amount=10.0001&amount=70&block_transaction_id=abcdef0123456789&order_id=R_UPAY_GUARD&status=2&token=TGuardWalletAddress&trade_id=202610160000000001'
const signature = createHash('md5').update(callbackContent + secret).digest('hex')
const signed = { ...notification, signature }
assert.ok(verifyUpayProNotification(signed, secret))
assert.equal(verifyUpayProNotification(signed, randomBytes(32).toString('hex')), null)
for (const patch of [
  { amount: 71 }, { actual_amount: 11 }, { order_id: 'R_OTHER' }, { trade_id: 'other-trade' },
  { token: 'TOtherWallet' }, { block_transaction_id: 'other-hash' }, { status: 1 },
  { amount: '70' }, { amount: 70.001 }, { actual_amount: Infinity }, { status: '2' },
  { status: 4 }, { signature: '' }, { signature: 'g'.repeat(32) }, { signature: 'a'.repeat(64) },
  { block_transaction_id: null }, { token: '' }, { order_id: ['R_UPAY_GUARD'] }
]) assert.equal(verifyUpayProNotification({ ...signed, ...patch }, secret), null)
const scientificContent = callbackContent.replace('amount=70&', 'amount=1e+06&')
assert.ok(verifyUpayProNotification({
  ...signed, amount: 1_000_000,
  signature: createHash('md5').update(scientificContent + secret).digest('hex')
}, secret))
// Never accept the extra '&' before the secret found in the upstream prose example.
assert.equal(verifyUpayProNotification({
  ...signed, signature: createHash('md5').update(callbackContent + '&' + secret).digest('hex')
}, secret), null)

const data = {
  trade_id: notification.trade_id, order_id: input.order_id, amount: input.amount,
  actual_amount: 10.0001, token: notification.token, expiration_time: Date.now() + 3_600_000,
  payment_url: `${built.config.apiurl}/pay/checkout-counter/${notification.trade_id}`
}
let responseBody: unknown = { status_code: 200, data }
let httpStatus = 200
let requests = 0
const fetchMock = mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
  requests++
  assert.equal(url, `${built.config.apiurl}/api/create_order`)
  assert.equal(init?.method, 'POST')
  assert.equal(init?.redirect, 'manual')
  assert.ok(init?.signal instanceof AbortSignal)
  assert.ok((init as any).dispatcher, 'UPAY outbound traffic must retain the validated DNS dispatcher')
  assert.deepEqual(JSON.parse(String(init?.body)), { ...input, type: 'USDT-TRC20', signature: signUpayProOrder(input, built.config) })
  return new Response(JSON.stringify(responseBody), { status: httpStatus, headers: { 'Content-Type': 'application/json' } })
})
try {
  const client = new UpayProClient(built.config)
  const order = await client.createOrder(input)
  assert.equal(order.expiresAt, data.expiration_time)
  assert.equal(order.amount, 70)
  assert.equal(order.actualAmount, 10.0001)
  const details = buildUpayProPaymentDetails(order, built.config)
  assert.equal(details.upaypro?.invoiceAmount, 70)
  assert.equal(details.upaypro?.paymentAmount, 10.0001)
  assert.deepEqual(extractRechargePaymentDisplayInfo(details), {
    invoiceCurrency: 'CNY', paymentCurrency: 'USDT', paymentNetwork: 'TRC20',
    actualPaymentMethod: 'USDT-TRC20', paymentUuid: data.trade_id, paymentTxid: null,
    gatewayStatus: 'pending', gatewayStatusDescription: '待支付'
  })
  assert.equal(extractRechargePaymentDisplayInfo(buildUpayProPaymentDetails(order, { ...built.config, payment_type: 'TRX' })).paymentNetwork, 'TRON')

  responseBody = { status_code: 200, data: { ...data, expiration_time: Math.floor(data.expiration_time / 1000) } }
  assert.equal((await client.createOrder(input)).expiresAt, Math.floor(data.expiration_time / 1000) * 1000)
  for (const patch of [
    { order_id: 'R_OTHER' }, { trade_id: '' }, { amount: 70.01 }, { amount: '70' }, { amount: 70.001 },
    { actual_amount: 0 }, { actual_amount: '10.0001' }, { token: '' },
    { expiration_time: 1 }, { expiration_time: null }, { expiration_time: 9e18 },
    { payment_url: `https://example.com/pay/checkout-counter/${data.trade_id}` },
    { payment_url: `http://8.8.8.8/pay/checkout-counter/${data.trade_id}` },
    { payment_url: `${data.payment_url}?redirect=https://example.com` },
    { payment_url: 'https://8.8.8.8/another-order' }, { payment_url: 'javascript:alert(1)' }
  ]) {
    responseBody = { status_code: 200, data: { ...data, ...patch } }
    await assert.rejects(() => client.createOrder(input))
  }
  for (const invalidBody of [null, [], {}, { status_code: 200, data: [] }, { code: 1, message: 'error' }]) {
    responseBody = invalidBody
    await assert.rejects(() => client.createOrder(input))
  }
  responseBody = { status_code: 200, data }
  for (const status of [302, 400, 500]) {
    httpStatus = status
    await assert.rejects(() => client.createOrder(input))
  }
  httpStatus = 200
  const beforeUnsafeRequests = requests
  for (const apiurl of ['https://127.0.0.1', 'https://10.0.0.1', 'https://169.254.169.254']) {
    await assert.rejects(() => new UpayProClient({ ...built.config, apiurl }).createOrder(input))
  }
  assert.equal(requests, beforeUnsafeRequests, 'private destinations must be rejected before fetch')
} finally {
  fetchMock.mock.restore()
}

const root = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')
const route = read('server/src/routes/recharge.ts')
assert.ok(route.includes('case \'upaypro\':'), 'UPAY callbacks must resolve config snapshots by order_id')
assert.ok(route.includes('actualAmount = upayNotification.amount'), 'CNY callback amount must drive fiat validation')
assert.ok(route.includes('invoice.paymentAmount !== upayNotification.actual_amount'), 'callback coin amount must match the created invoice')
assert.ok(route.includes('invoice.tradeId !== upayNotification.trade_id'), 'callback trade must match the created invoice')
assert.ok(route.includes('invoice.address !== upayNotification.token'), 'callback wallet must match the created invoice')
assert.ok(route.includes("if (upayNotification.status !== 2) return 'ok'"), 'only success notifications may credit balances')
assert.ok(route.includes("if (provider.type === 'upaypro') return 'ok'"), 'UPAY callback acknowledgements must be plain text')
assert.ok(route.includes('expectedPaymentDetails: record.paymentDetails'), 'UPAY retries and callbacks must bind the current payment attempt atomically')
assert.ok(route.includes("provider.type !== 'yipay' && provider.type !== 'heleket' && provider.type !== 'antom'"), 'status-only UPAY lookups must not enter the active-credit path')
assert.ok(read('server/prisma/migrations/202610160001_add_upaypro_payment_provider/migration.sql').includes("ADD VALUE IF NOT EXISTS 'upaypro'"))
const readiness = read('server/src/scripts/verify-production-db-readiness.ts')
assert.ok(readiness.includes("provider.type !== 'upaypro'"), 'readiness must recognize UPAY Pro as an implemented provider')
assert.ok(readiness.includes('const upay = buildUpayProConfig(config)'), 'readiness must validate UPAY Pro configuration')
const view = read('client/src/views/admin/PaymentProvidersView.vue')
assert.ok(view.includes("value: 'upaypro'"))
assert.ok(view.includes('v-model="formData.config.payment_type"'))
assert.ok(view.includes('id="upay-secret"') && view.includes('type="password"'))
for (const type of UPAY_PRO_PAYMENT_TYPES) assert.ok(view.includes(`'${type}'`), `missing UPAY payment type ${type}`)
for (const locale of ['zh-CN', 'zh-TW', 'en']) {
  const source = read(`client/src/locales/${locale}.ts`)
  for (const key of ['upaypro:', 'upayPaymentName:', 'upaySecretKey:', 'upayApiUrl:']) assert.ok(source.includes(key))
}

console.log('UPAY Pro payment guard tests passed')
