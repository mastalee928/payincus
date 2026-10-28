import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(process.cwd(), '..')
const view = readFileSync(resolve(root, 'client/src/views/admin/AffReviewView.vue'), 'utf8')
const affDbSource = readFileSync(resolve(root, 'server/src/db/aff.ts'), 'utf8')
const billingOperationsSource = readFileSync(resolve(root, 'server/src/db/billing-operations.ts'), 'utf8')
const instanceDestroySource = readFileSync(resolve(root, 'server/src/routes/instance-destroy.ts'), 'utf8')
const adminBillingSource = readFileSync(resolve(root, 'server/src/routes/admin-billing.ts'), 'utf8')
const mailSource = readFileSync(resolve(root, 'server/src/routes/mail.ts'), 'utf8')
const mailAutoRenewSource = readFileSync(resolve(root, 'server/src/services/mail-autorenew-scheduler.ts'), 'utf8')
const instanceRoutesSource = readFileSync(resolve(root, 'server/src/routes/instances.ts'), 'utf8')
const hostsSource = readFileSync(resolve(root, 'server/src/routes/hosts.ts'), 'utf8')
const billingSchedulerSource = readFileSync(resolve(root, 'server/src/services/billing-scheduler.ts'), 'utf8')

function sectionBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`)
  return source.slice(start, end)
}

assert.ok(
  view.includes('class="space-y-3 p-4 lg:hidden"') &&
    view.includes('class="hidden overflow-hidden lg:block"') &&
    view.includes('table class="w-full table-fixed"') &&
    !view.includes('v-else class="overflow-x-auto"') &&
    !view.includes('table class="w-full min-w-[960px]"'),
  'AFF withdrawal review list must keep mobile cards and a fixed desktop table without broad horizontal overflow'
)

assert.ok(
  view.includes('@click="approveWithdrawal(w)"') &&
    view.includes('@click="openRejectModal(w)"') &&
    view.includes('@click="submitReject"') &&
    view.includes('v-model="rejectReason"') &&
    view.includes('@click="page--; loadWithdrawals()"') &&
    view.includes('@click="page++; loadWithdrawals()"'),
  'AFF withdrawal review responsive layout must preserve approve, reject, modal, and pagination actions'
)

const validateAffCodeSource = sectionBetween(
  affDbSource,
  'export async function validateAffCode(',
  'export async function createAffBinding('
)
assert.ok(
  validateAffCodeSource.includes('if (!affCode.enabled)') &&
    validateAffCodeSource.includes("return { valid: false, error: '优惠码已禁用' }"),
  'instance purchase AFF validation must reject disabled codes'
)

const performRenewalSource = sectionBetween(
  billingOperationsSource,
  'export async function performRenewal(',
  'export async function performPlanChange('
)
// v1.4.0 起续费改走 arbitrateVipPrice 价格仲裁：已禁用 AFF 码的折扣率强制为 0（不给折扣）。
assert.match(
  performRenewalSource,
  /affDiscountRate:\s*affBinding\?\.affCode\.enabled\s*\?\s*Number\(affBinding\.affCode\.discountRate\)\s*:\s*0/,
  'instance renewal must not apply discounts from disabled AFF codes'
)
// 佣金仅在 AFF 码启用且仲裁最终选中 AFF 价（pricingSource === 'aff'）时发放：禁用码既无折扣也无佣金。
assert.match(
  performRenewalSource,
  /if \(affBinding\?\.affCode\.enabled && pricingSource === 'aff'\) \{\s*await processAffCommission\(/,
  'instance renewal must not pay commission for disabled AFF codes'
)

assert.ok(affDbSource.includes('SELECT id FROM aff_codes WHERE id = ${affCodeId} FOR UPDATE') &&
  affDbSource.includes('const affCode = tx ? await lockAffCode(tx, binding.affCodeId) : binding.affCode'),
'transactional AFF quotes must hold the current code row through settlement')
for (const [start, end] of [
  ['export async function processAffCommission(', '// ==================== AFF 日志查询 ===================='],
  ['export async function processMailAffCommission(', 'export async function getMailSubscriptionAffBinding(']
]) {
  const commission = sectionBetween(affDbSource, start, end)
  assert.ok(commission.includes('if (!affCode?.enabled) return') && commission.includes('await changeAffBalanceInTransaction(tx, {') &&
    commission.includes('if (!tx) return prisma.$transaction('), 'all commission entry points must reject disabled codes and atomically propagate ledger failure')
}
assert.ok(instanceRoutesSource.includes('await db.requireAffCodeForPurchase(tx, validatedAffCode.id, user.id, selectedPlan.id, validatedAffCode.discountRate)'),
'instance purchase must revalidate its quoted code inside the billing transaction')
const purchaseTransaction = sectionBetween(instanceRoutesSource, 'let lockedBalanceBefore: number | null = null', 'instanceId = result.instanceId')
assert.ok(purchaseTransaction.indexOf('requireAffCodeForPurchase(') > purchaseTransaction.indexOf('selectAndReserveHostWithLock(') &&
  purchaseTransaction.indexOf('requireAffCodeForPurchase(') > purchaseTransaction.indexOf('SELECT id FROM users WHERE id = ${user.id} FOR UPDATE') &&
  purchaseTransaction.indexOf('requireAffCodeForPurchase(') < purchaseTransaction.indexOf('const balanceUpdateResult ='),
'purchase must acquire host/account rows before AFF and validate the code before debiting')
const affLock = sectionBetween(affDbSource, 'export async function lockAffCode(', 'export async function requireAffCodeForPurchase(')
assert.ok(affLock.includes('tryAdvisoryTransactionLock(tx, USER_AFF_BALANCE_LOCK_NAMESPACE, snapshot.userId)') &&
  affLock.includes('throw new AffCodeBusyError()'), 'AFF contention must not block while callers hold host or account rows')
assert.ok(billingSchedulerSource.includes('error instanceof AffCodeBusyError') && billingSchedulerSource.includes('instance.auto_renew_deferred') &&
  mailAutoRenewSource.includes("if (error instanceof AffCodeBusyError) return { status: 'busy' as const }"),
'automatic renewals must defer AFF contention without consuming failure attempts or committing charges')
assert.ok(mailSource.includes('await requireAffCodeForPurchase(tx, validatedAffCode.id, userId, null, validatedAffCode.discountRate)') &&
  mailSource.includes('if (currentAffBinding?.affCode.enabled)') && mailAutoRenewSource.includes('if (affCode?.enabled)'),
'mail purchase and both renewal paths must settle from a current eligible code')
assert.ok(adminBillingSource.includes('await db.applyAffCodeToInstance(instanceId, affCodeInput, admin)') &&
  affDbSource.includes('authorizeUserWrite(tx, actor.id, actor)'), 'administrator AFF application must check the current actor in its binding transaction')
assert.ok(hostsSource.includes('await copyInstanceAffBinding(instance.id, createdInstance.id, affBinding.affCode.id, tx)'),
'host migration must preserve a permanent binding through its dedicated copy path, including disabled history')

const affRefundReversalSource = sectionBetween(
  instanceDestroySource,
  'export async function reverseInstanceAffCommissionForRefund(',
  'async function claimInstanceForUserDestroy('
)
assert.ok(
  affRefundReversalSource.includes('refundAmount / originalPaidAmount') &&
    affRefundReversalSource.includes('issuedCommission * refundRatio') &&
    affRefundReversalSource.includes('remainingCommission'),
  'AFF refund reversal must be proportional to the actual refund and capped by unreversed commission'
)
assert.ok(
  affRefundReversalSource.includes('affBalance: { decrement: commissionAmount }') &&
    affRefundReversalSource.includes('amount: -commissionAmount') &&
    affRefundReversalSource.includes('totalEarnings: { decrement: commissionAmount }'),
  'AFF refund reversal must allow debt and roll back AFF balance, log, and earnings statistics'
)
assert.ok(
  affRefundReversalSource.includes("type === 'new_purchase' && commissionAmount >= remainingCommission") &&
    affRefundReversalSource.includes('usedCount: { decrement: 1 }'),
  'AFF usage count must roll back once only after the new-purchase commission is fully reversed'
)

const userDestroySettlementSource = sectionBetween(
  instanceDestroySource,
  'async function recordUserDestroyAudit(',
  'async function buildBatchDestroyPreviewItem('
)
assert.ok(
  !userDestroySettlementSource.includes('reverseInstanceAffCommissionForRefund') &&
    !userDestroySettlementSource.includes('balanceLog.create') &&
    !userDestroySettlementSource.includes('instanceBillingRecord.create'),
  'user destroy must not refund or reverse AFF commission; financial reversal remains for administrator refunds'
)

const adminRefundSource = sectionBetween(
  adminBillingSource,
  '// ==================== 管理员退款 ====================',
  '// ==================== 管理员删除并退款 ===================='
)
assert.ok(
  adminRefundSource.includes('await reverseInstanceAffCommissionForRefund({') &&
    adminRefundSource.includes('refundAmount: amount,'),
  'admin partial refund must reverse AFF commission in the refund transaction'
)
const adminDeleteRefundSource = sectionBetween(
  adminBillingSource,
  '// ==================== 管理员删除并退款 ====================',
  '// ==================== 管理员应用AFF优惠码 ===================='
)
assert.ok(
  adminDeleteRefundSource.includes('await reverseInstanceAffCommissionForRefund({') &&
    adminDeleteRefundSource.includes('refundAmount,'),
  'admin delete-and-refund must reverse AFF commission in the refund transaction'
)

console.log('AFF review UI guard tests passed')
