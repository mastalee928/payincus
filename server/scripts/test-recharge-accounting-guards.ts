import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const routeSource = readFileSync(resolve(__dirname, '../src/routes/recharge.ts'), 'utf8')
const providerDbSource = readFileSync(resolve(__dirname, '../src/db/payment-providers.ts'), 'utf8')
const rechargeDbSource = readFileSync(resolve(__dirname, '../src/db/recharge-records.ts'), 'utf8')
const vipSource = readFileSync(resolve(__dirname, '../src/services/vip-levels.ts'), 'utf8')
const adminStatisticsSource = readFileSync(resolve(__dirname, '../src/routes/admin-statistics.ts'), 'utf8')
const adminBillingSource = readFileSync(resolve(__dirname, '../src/routes/admin-billing.ts'), 'utf8')

function sectionBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`)
  return source.slice(start, end)
}

const createOrderRoute = sectionBetween(
  routeSource,
  "app.post('/api/recharge/orders'",
  "// 获取用户充值记录列表"
)

assert.ok(
  createOrderRoute.includes('const actualAmount = db.calculateActualAmount(provider, normalizedAmount)'),
  'recharge order creation must compute the real credited amount before persistence'
)
assert.ok(
  routeSource.includes('function parsePositiveJsonMoney(value: unknown): number | null') &&
    routeSource.includes("typeof value !== 'number' || !Number.isFinite(value) || value <= 0"),
  'recharge routes must define a strict JSON number guard for money inputs'
)
assert.ok(
  routeSource.includes('function normalizeOptionalTrimmedString(value: unknown, maxLength: number): string | null | undefined') &&
    routeSource.includes("if (typeof value !== 'string')") &&
    routeSource.includes('return trimmed.length <= maxLength ? trimmed : null'),
  'recharge routes must define a strict runtime guard for optional admin string inputs'
)
assert.ok(
  createOrderRoute.includes('const rechargeAmount = parsePositiveJsonMoney(amount)') &&
    createOrderRoute.includes('if (rechargeAmount === null)') &&
    createOrderRoute.includes('let normalizedAmount = Math.round(rechargeAmount * 100) / 100'),
  'recharge order creation must reject string, non-finite, and non-positive amounts before normalization'
)
assert.ok(
  createOrderRoute.includes('!Number.isFinite(actualAmount) || actualAmount <= 0'),
  'recharge order creation must reject non-finite or non-positive credited amounts'
)
assert.ok(
  createOrderRoute.includes('await createRechargeOnce') &&
  createOrderRoute.indexOf('!Number.isFinite(actualAmount) || actualAmount <= 0') <
    createOrderRoute.indexOf('await createRechargeOnce'),
  'credited amount guard must run before creating the recharge order'
)

const manualCompleteRoute = sectionBetween(
  routeSource,
  "app.post('/api/admin/recharge/orders/:orderNo/complete'",
  "// 标记充值订单失败（管理员）"
)
assert.ok(
  manualCompleteRoute.includes('actualAmount = parsePositiveJsonMoney(rawActualAmount) ?? undefined') &&
    manualCompleteRoute.includes('if (actualAmount === undefined)'),
  'admin manual recharge completion must reject non-number actualAmount values instead of coercing them'
)
assert.ok(
  manualCompleteRoute.includes('const tradeNo = normalizeOptionalTrimmedString(rawTradeNo, MAX_RECHARGE_TRADE_NO_LENGTH)') &&
    manualCompleteRoute.includes("if (tradeNo === null)") &&
    manualCompleteRoute.includes("return reply.status(400).send({ error: '交易号格式无效或过长' })"),
  'admin manual recharge completion must reject malformed or oversized tradeNo values before persistence'
)
assert.ok(
  manualCompleteRoute.indexOf("if (tradeNo === null)") < manualCompleteRoute.indexOf('db.completeRecharge'),
  'admin manual recharge completion must validate tradeNo before calling completeRecharge'
)
assert.ok(
  !manualCompleteRoute.includes('actualAmount = Number(rawActualAmount)'),
  'admin manual recharge completion must not coerce actualAmount with Number()'
)

const manualFailRoute = sectionBetween(
  routeSource,
  "app.post('/api/admin/recharge/orders/:orderNo/fail'",
  '// ==================== 第三方支付回调 ===================='
)
assert.ok(
  manualFailRoute.includes('const reason = normalizeOptionalTrimmedString(rawReason, MAX_RECHARGE_ADMIN_REASON_LENGTH)') &&
    manualFailRoute.includes("if (reason === null)") &&
    manualFailRoute.includes("const failReason = reason || '管理员标记失败'"),
  'admin manual recharge failure must normalize and bound the reason before persistence/logging'
)
assert.ok(
  manualFailRoute.indexOf("if (reason === null)") < manualFailRoute.indexOf('db.failRecharge'),
  'admin manual recharge failure must validate reason before calling failRecharge'
)
assert.ok(
  manualFailRoute.includes('db.failRecharge(orderNo, failReason') &&
    manualFailRoute.includes('as failed: ${failReason}'),
  'admin manual recharge failure must persist and log only the normalized reason'
)

const repayRoute = sectionBetween(
  routeSource,
  "app.post('/api/recharge/orders/:orderNo/repay'",
  '// 获取用户充值统计'
)
assert.ok(
  repayRoute.includes('const paymentMethodChanged = selectedPaymentMethod !== (record.paymentMethod || undefined)'),
  'recharge repay must detect payment method changes explicitly'
)
assert.ok(
  repayRoute.includes('db.getPaymentFeeConfig(pricingProvider, selectedPaymentMethod)') &&
    repayRoute.includes('db.calculatePaymentFee(pricingProvider, rechargeAmount, selectedPaymentMethod)') &&
    repayRoute.includes('db.calculatePayableAmount(pricingProvider, rechargeAmount, selectedPaymentMethod)') &&
    repayRoute.includes('db.calculateActualAmount(pricingProvider, rechargeAmount)'),
  'recharge repay must recalculate fee, payable amount, and actual credited amount for the selected method'
)
assert.ok(
  repayRoute.includes('const existingPaymentDetails = readRechargePaymentDetails') &&
    repayRoute.includes('feeRate: existingPaymentDetails.recharge?.feeRate ?? provider.feeRate') &&
    repayRoute.includes('feeFixed: existingPaymentDetails.recharge?.feeFixed ?? provider.feeFixed'),
  'recharge repay pricing must keep the order-created base fee snapshot when no method-specific fee applies'
)
assert.ok(
  repayRoute.includes('mergeRechargeAmountDetails(providerPaymentDetails') &&
    repayRoute.includes('payableAmount') &&
    repayRoute.includes('feeRate: feeConfig.feeRate') &&
    repayRoute.includes('paymentMethod: selectedPaymentMethod || null'),
  'recharge repay must persist refreshed payment amount metadata when the method changes'
)
assert.ok(
  repayRoute.includes('await db.updatePendingRechargePaymentSelection(orderNo') &&
    !repayRoute.includes('updateRechargePaymentMethod'),
  'recharge repay must update payment method and amount metadata together through a pending-only helper'
)
assert.ok(
  repayRoute.indexOf('await db.updatePendingRechargePaymentSelection(orderNo') <
    repayRoute.indexOf('return {'),
  'recharge repay must persist refreshed payment metadata before returning the new pay URL to the client'
)

assert.ok(
  rechargeDbSource.includes('export async function updatePendingRechargePaymentSelection(') &&
    rechargeDbSource.includes("status: 'pending'") &&
    rechargeDbSource.includes('paymentDetails: data.paymentDetails as any') &&
    rechargeDbSource.includes('actualAmount: data.actualAmount') &&
    rechargeDbSource.includes('fee: data.fee'),
  'recharge DB layer must conditionally update pending payment selection with refreshed accounting fields'
)
assert.ok(
  !rechargeDbSource.includes('export async function updateRechargePaymentMethod('),
  'recharge DB layer must not expose the old unconditional payment-method-only update helper'
)

const actualAmountHelper = sectionBetween(
  providerDbSource,
  'export function calculateActualAmount(',
  '/**\n * 验证充值金额是否在渠道允许范围内'
)
assert.ok(
  actualAmountHelper.includes('return Number((amount - fee).toFixed(2))'),
  'deduct-fee providers can produce non-positive credited amounts that must be guarded at order creation'
)

for (const [label, source] of [
  ['user/system recharge stats', rechargeDbSource],
  ['VIP totalRecharge stats', vipSource],
  ['admin statistics recharge stats', adminStatisticsSource],
  ['admin billing recharge stats', adminBillingSource]
] as const) {
  assert.ok(
    source.includes('COALESCE(actual_amount, amount)'),
    `${label}: completed recharge sums must use actual credited amount with legacy amount fallback`
  )
  assert.ok(
    !source.includes("_sum: { amount: true }\n    })\n  ])\n\n  return {\n    totalConsume"),
    `${label}: must not keep the old completed-recharge amount aggregate pattern`
  )
}

const creditTargetHelper = sectionBetween(
  providerDbSource,
  'export function calculateRechargeAmountForCredit(',
  'export function validateRechargeAmount('
)
assert.ok(
  creditTargetHelper.includes('isSurchargeFeeProvider(provider)') &&
    creditTargetHelper.includes('feeRate >= 1') &&
    creditTargetHelper.includes('while (calculateActualAmount(provider, amount) < target)'),
  'credit-target recharge helper must short-circuit surcharge channels, reject impossible fee rates, and verify the credited amount cent by cent'
)
assert.ok(
  createOrderRoute.includes('const creditTarget = creditTargetInput === undefined ? null : parsePositiveJsonMoney(creditTargetInput)') &&
    createOrderRoute.includes('db.calculateRechargeAmountForCredit(provider, creditTarget)') &&
    createOrderRoute.indexOf('calculateRechargeAmountForCredit') < createOrderRoute.indexOf('db.validateRechargeAmount(provider, normalizedAmount)'),
  'checkout credit-target recharge must gross up channel fees before the amount-range validation'
)

const checkoutViewSource = readFileSync(resolve(__dirname, '../../client/src/views/CheckoutView.vue'), 'utf8')
const userApiSource = readFileSync(resolve(__dirname, '../../client/src/api/index.ts'), 'utf8')
assert.ok(
  userApiSource.includes("http.post('/recharge/orders', { providerId, amount, paymentMethod, ...(creditTarget !== undefined ? { creditTarget } : {}), ...(requestId ? { requestId } : {}) })"),
  'customer API client must forward the checkout credit target to the recharge order endpoint'
)
assert.ok(
  checkoutViewSource.includes('gatewayIntent(account, providerId, targetYuan)') &&
  checkoutViewSource.includes('api.billing.createRechargeOrder(intent.providerId, intent.amount, undefined, intent.amount, intent.requestId)') &&
    checkoutViewSource.includes("if (status === 'completed')") &&
    checkoutViewSource.includes("payChoice.value = 'balance'") &&
    checkoutViewSource.includes('gatewayCredited.value = true'),
  'pool checkout must create a credit-target recharge, wait for completion, then settle through balance'
)

const callbackHandlerSource = sectionBetween(
  routeSource,
  'async function handlePaymentCallback(',
  '// POST 回调接口'
)
assert.ok(
  callbackHandlerSource.includes('if (!isIpInWhitelist(clientIp, provider.type))') &&
    callbackHandlerSource.includes('validateActiveRechargeProvider({ type: provider.type, config })') &&
    callbackHandlerSource.includes('epay.verifyWithStatus(callbackData as CallbackData)') &&
    callbackHandlerSource.includes('heleket.verifyWebhookSignature(callbackData)') &&
    callbackHandlerSource.includes('verifyUpayProNotification(callbackData, buildUpayProConfig(config).config.secret_key)') &&
    callbackHandlerSource.includes('verifyAntomWebhook({') &&
    callbackHandlerSource.includes('verifyCallbackSignature({ type: provider.type, config }, callbackData, signature)'),
  'recharge callbacks must reject calls outside the source IP whitelist and verify the per-channel signature before settling'
)
assert.ok(
  callbackHandlerSource.indexOf('isIpInWhitelist(clientIp, provider.type)') < callbackHandlerSource.indexOf('await db.completeRecharge(') &&
    callbackHandlerSource.indexOf('epay.verifyWithStatus(callbackData as CallbackData)') < callbackHandlerSource.indexOf('await db.completeRecharge(') &&
    callbackHandlerSource.includes('if (record.providerId !== providerIdNum)') &&
    callbackHandlerSource.includes('!isCurrentRechargePaymentAttempt(') &&
    callbackHandlerSource.includes('if (await isCallbackProcessed(providerIdNum, orderNo, tradeNoForIndex) && preliminaryRecord?.status === \'completed\'') &&
    callbackHandlerSource.includes('preliminaryRecord.tradeNo === tradeNo'),
  'source IP, signature, channel consistency, current-attempt and replay checks must all run before a recharge callback can credit a balance'
)
assert.ok(
  checkoutViewSource.includes("if (status === 'completed')") &&
    !checkoutViewSource.includes('creditBalance') &&
    !checkoutViewSource.includes('/recharge/callback'),
  'pool checkout must never credit a balance itself; it only unlocks settlement on the server-reported completed status'
)

console.log('recharge accounting guard tests passed')
