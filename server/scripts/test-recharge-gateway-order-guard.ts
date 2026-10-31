import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  getCurrentRechargeGatewayOrderNo,
  resolveRechargeOrderNoFromGatewayOrderNo,
  isRechargeGatewayOrderNoMatch,
  normalizeRechargeGatewayOrderNo
} from '../src/lib/recharge-order-guard.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

assert.equal(normalizeRechargeGatewayOrderNo(' R123 '), 'R123')
assert.equal(normalizeRechargeGatewayOrderNo('   '), null)
assert.equal(normalizeRechargeGatewayOrderNo(null), null)

assert.equal(isRechargeGatewayOrderNoMatch('R123', 'R123'), true)
assert.equal(isRechargeGatewayOrderNoMatch('R123', ' R123 '), true)
assert.equal(isRechargeGatewayOrderNoMatch('R123', 'R124'), false)
assert.equal(isRechargeGatewayOrderNoMatch('R123', undefined), false)

const routeSource = readFileSync(resolve(__dirname, '../src/routes/recharge.ts'), 'utf8')
assert.ok(
  routeSource.includes("getCurrentRechargeGatewayOrderNo, isRechargeGatewayOrderNoMatch, resolveRechargeOrderNoFromGatewayOrderNo } from '../lib/recharge-order-guard.js'"),
  'recharge route must import gateway order guard'
)
assert.ok(
  routeSource.includes('!isRechargeGatewayOrderNoMatch(gatewayOrderNo, queryResult.out_trade_no)'),
  'yipay verify path must reject mismatched gateway order numbers'
)
assert.ok(
  routeSource.includes('!isRechargeGatewayOrderNoMatch(gatewayOrderNo, queryResult.order_id)'),
  'heleket verify path must reject mismatched gateway order numbers'
)
assert.ok(
  routeSource.includes('拒绝主动完成充值'),
  'mismatched active verification must not complete recharge'
)

const adminSource = readFileSync(resolve(__dirname, '../src/routes/admin-billing.ts'), 'utf8')
const userVerify = routeSource.slice(routeSource.indexOf("app.post('/api/recharge/orders/:orderNo/verify'"),
  routeSource.indexOf('// ==================== 管理员接口 ===================='))
assert.equal((userVerify.match(/expectedPaymentDetails/g) || []).length, 8,
  'user provider verification must bind all seven metadata/status/settlement mutations to its original selection')
assert.ok(userVerify.includes('error instanceof RechargePaymentSelectionChangedError') && userVerify.includes('reply.code(409)'),
  'stale user verification must return an explicit conflict')
const callback = routeSource.slice(routeSource.indexOf('async function handlePaymentCallback('), routeSource.indexOf('// POST 回调接口'))
assert.equal((callback.match(/expectedPaymentDetails/g) || []).length, 7,
  'callbacks must bind every metadata/status/completion mutation to the original payment selection')
assert.ok(!callback.includes("provider.type === 'upaypro' ? { expectedPaymentDetails"),
  'callback selection protection must cover all providers')
const adminSync = adminSource.slice(adminSource.indexOf("app.post('/api/admin/billing/recharge-records/:id/sync'"),
  adminSource.indexOf('// ==================== 管理员创建实例 ===================='))
assert.ok(adminSync.includes('!isRechargeGatewayOrderNoMatch(gatewayOrderNo, queryResult.out_trade_no)'),
  'administrator yipay sync must reject missing or foreign order numbers')
assert.ok(adminSync.includes('!isRechargeGatewayOrderNoMatch(gatewayOrderNo, queryResult.order_id)'),
  'administrator Heleket sync must reject missing or foreign order numbers')
assert.ok(adminSync.indexOf('!isRechargeGatewayOrderNoMatch(gatewayOrderNo, queryResult.order_id)') <
  adminSync.indexOf('paymentDetails = mergeHeleketPaymentDetails('),
  'Heleket identity validation must precede all metadata and status mutations')
assert.ok(adminSync.includes('epay.queryOrder(gatewayOrderNo)') && adminSync.includes('heleket.getPaymentInfo({ order_id: gatewayOrderNo })'),
  'both administrator sync providers must query the active payment attempt')
assert.ok(adminSync.includes('const expectedPaymentDetails = record.paymentDetails') &&
  adminSync.includes('paymentDetails,\n            expectedPaymentDetails,\n            actor: admin') &&
  adminSync.includes('db.cancelRecharge(record.orderNo, callbackPayload, paymentDetails, expectedPaymentDetails, admin)') &&
  adminSync.includes('db.failRecharge(record.orderNo, statusMessage, callbackPayload, paymentDetails, admin, expectedPaymentDetails)') &&
  adminSync.includes('paymentDetails,\n        expectedPaymentDetails,\n        actor: admin'),
  'every sync mutation must retain the originally queried payment selection')
const recordSource = readFileSync(resolve(__dirname, '../src/db/recharge-records.ts'), 'utf8')
assert.ok(recordSource.includes('expected === null ? Prisma.AnyNull') &&
  (recordSource.match(/\.\.\.paymentSelectionCondition\(/g) || []).length === 4,
  'metadata, completion, cancellation and failure must compare the selection in their actual database update including null')
const active = { id: '123456789ABC', gatewayOrderNo: 'R123--PA-123456789ABC', createdAt: new Date().toISOString() }
assert.equal(getCurrentRechargeGatewayOrderNo({ paymentAttempt: { current: active } }, 'R123'), active.gatewayOrderNo)
assert.equal(resolveRechargeOrderNoFromGatewayOrderNo(active.gatewayOrderNo), 'R123')
for (const value of [null, [], {}, { paymentAttempt: [] }, { paymentAttempt: { current: [] } },
  { paymentAttempt: { current: { ...active, id: 1 } } }, { paymentAttempt: { current: { ...active, createdAt: null } } },
  { paymentAttempt: { current: { ...active, gatewayOrderNo: 'R124--PA-123456789ABC' } } },
  { paymentAttempt: { current: { ...active, gatewayOrderNo: 'R123--PA-invalid' } } }]) {
  assert.equal(getCurrentRechargeGatewayOrderNo(value, 'R123'), 'R123')
}

console.log('recharge gateway order guard tests passed')
