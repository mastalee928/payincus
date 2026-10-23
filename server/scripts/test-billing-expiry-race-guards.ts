import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const suspendSource = readFileSync(resolve(__dirname, '../src/db/instance-suspend.ts'), 'utf8')
const schedulerSource = readFileSync(resolve(__dirname, '../src/services/billing-scheduler.ts'), 'utf8')
const autoRenewSource = readFileSync(resolve(__dirname, '../src/lib/instance-auto-renew.ts'), 'utf8')
const billingSource = readFileSync(resolve(__dirname, '../src/db/billing-operations.ts'), 'utf8')

function sectionBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`)
  return source.slice(start, end)
}

const suspendFunction = sectionBetween(
  suspendSource,
  'export async function suspendInstanceByExpiry(',
  '/**\n * 封停实例（管理员或宿主机所有者手动封停）'
)

assert.ok(suspendFunction.includes('prisma.instance.updateMany'), 'expiry suspend must use conditional updateMany')
assert.ok(suspendFunction.includes('packagePlanId: { not: null }'), 'expiry suspend must only process paid instances')
assert.ok(suspendFunction.includes('expiresAt:') && suspendFunction.includes('lt: new Date()'), 'expiry suspend must recheck expiresAt at update time')
assert.ok(suspendFunction.includes("status: { notIn: ['suspended', 'deleted'] }"), 'expiry suspend must not overwrite suspended or deleted instances')
assert.ok(suspendFunction.includes('version: { increment: 1 }'), 'expiry suspend must increment instance version')
assert.ok(suspendFunction.includes('if (result.count === 0) return null'), 'expiry suspend must report stale ineligible rows')

const autoRenewAttemptFunction = sectionBetween(
  suspendSource,
  'export async function updateAutoRenewAttempt(',
  '/**\n * 重置自动续费尝试记录'
)

assert.ok(autoRenewAttemptFunction.includes('prisma.instance.updateMany'), 'auto-renew attempt updates must be conditional')
assert.ok(autoRenewAttemptFunction.includes('...autoRenewEligibility(guard.now, guard.expiryThreshold)'), 'failed attempts must use the same catchup eligibility as selection and charging')
assert.ok(autoRenewSource.includes('autoRenew: true, packagePlanId: { not: null }') && autoRenewSource.includes('expiresAt: { not: null, lte: expiryThreshold }'), 'catchup must include expired paid instances without charging beyond the renewal window')
assert.ok(autoRenewSource.includes("{ status: 'suspended', suspendReason: 'expired', suspendedBy: null }") && autoRenewSource.includes("status: { notIn: ['suspended', 'deleted'] }"), 'only system expiry suspensions may be renewed')
assert.ok(autoRenewSource.includes('lastAutoRenewAttemptAt: { lte:') && autoRenewSource.includes('60 * 60 * 1000'), 'five-minute scans must preserve hourly retry spacing')
assert.ok(autoRenewAttemptFunction.includes('version: guard.version'), 'auto-renew attempt updates must use the locked instance version')
assert.ok(autoRenewAttemptFunction.includes('autoRenewAttempts: guard.currentAttempts'), 'auto-renew attempt updates must claim the expected attempt counter')
assert.ok(autoRenewAttemptFunction.includes('return result.count > 0'), 'auto-renew attempt updates must report stale rows to the scheduler')

const expiryNotificationClaimFunction = sectionBetween(
  suspendSource,
  'export async function updateExpiryNotifiedAt(',
  '/**\n * 获取需要自动续费的实例'
)

assert.ok(expiryNotificationClaimFunction.includes('prisma.instance.updateMany'), 'expiry notification timestamp updates must be conditional claims')
assert.ok(expiryNotificationClaimFunction.includes('gte: guard.minExpiresAt'), 'expiry notification claims must keep the lower expiry window guard')
assert.ok(expiryNotificationClaimFunction.includes('lt: guard.maxExpiresAt'), 'expiry notification claims must keep the upper expiry window guard')
assert.ok(expiryNotificationClaimFunction.includes('autoRenew: false'), 'expiry notification claims must skip instances that enabled auto-renew')
assert.ok(expiryNotificationClaimFunction.includes("status: { notIn: ['suspended', 'deleted'] }"), 'expiry notification claims must skip suspended/deleted instances')
assert.ok(expiryNotificationClaimFunction.includes('{ expiryNotifiedAt: null }'), 'expiry notification claims must allow never-notified rows')
assert.ok(expiryNotificationClaimFunction.includes('{ expiryNotifiedAt: { lt: guard.recentNotificationCutoff } }'), 'expiry notification claims must skip recently notified rows')
assert.ok(expiryNotificationClaimFunction.includes('return result.count > 0'), 'expiry notification claims must report stale rows to the scheduler')

const processSuspend = sectionBetween(
  schedulerSource,
  'async function processExpirySuspend(instance: any): Promise<{ userId: number; instanceName: string; expiresAt: Date | null } | null> {',
  '// ==================== 到期删除任务 ===================='
)

assert.ok(processSuspend.includes('const suspendedInstance = await suspendInstanceByExpiry'), 'scheduler must use the conditional suspend result')
assert.ok(processSuspend.includes('if (!suspendedInstance)'), 'scheduler must skip stale expiry suspend rows')
assert.ok(processSuspend.includes('return'), 'scheduler stale suspend branch must stop side effects')

const processAutoRenew = sectionBetween(
  schedulerSource,
  'async function processAutoRenew(instance: any): Promise<void> {',
  '// ==================== 到期封停任务 ===================='
)

const latestReadIndex = processAutoRenew.indexOf('const latestInstance = await prisma.instance.findUnique')
const performRenewalIndex = processAutoRenew.indexOf('const result = await performRenewal')
assert.notEqual(latestReadIndex, -1, 'auto-renew must re-read the instance inside the per-instance scheduler lock')
assert.notEqual(performRenewalIndex, -1, 'auto-renew renewal call not found')
assert.ok(latestReadIndex < performRenewalIndex, 'auto-renew eligibility must be rechecked before renewal side effects')
assert.ok(processAutoRenew.includes('!isAutoRenewEligible(latestInstance, now, expiryThreshold)') && processAutoRenew.includes('recoveryHeld()'), 'catchup must recheck current identity eligibility and recovery protection')
assert.ok(billingSource.includes('AND: [autoRenewEligibility(new Date(), automatic.expiryThreshold)') && billingSource.includes('expiresAt: instance.expiresAt') && billingSource.includes('autoRenewAttempts: { lt: 3 }'), 'automatic charge transaction must recheck exact expiry, renewal window, retry ceiling, manual suspension and opt-in')
const enforcement = sectionBetween(schedulerSource, 'export async function executeExpiryEnforcement()', 'function noteExpiryFailure')
assert.ok(enforcement.indexOf('await executeAutoRenew()') < enforcement.indexOf('await executeExpirySuspend()'), 'missed auto renewal must settle before expiry stop/delete')
assert.ok(schedulerSource.includes('if (autoRenewPromise) return autoRenewPromise'), 'overlapping hourly/five-minute jobs must share one complete renewal run')
assert.ok(processAutoRenew.includes('instance = latestInstance'), 'auto-renew must use the reloaded instance for attempts, pricing, and optimistic version')
assert.ok(processAutoRenew.includes('const attemptGuard = buildAutoRenewAttemptGuard(instance, now, expiryThreshold)'), 'auto-renew must build attempt guards from the locked instance snapshot')
assert.ok(processAutoRenew.includes('const attemptClaimed = await updateAutoRenewAttempt'), 'auto-renew must claim failed attempts before user-facing failure side effects')
assert.ok(processAutoRenew.includes('if (!attemptClaimed)'), 'auto-renew must skip stale failed attempts')
assert.ok(processAutoRenew.includes('Skip auto-renew failure notification'), 'auto-renew must avoid stale failure notifications after an attempt claim fails')

const processDelete = sectionBetween(
  schedulerSource,
  'async function processExpiryDelete(instance: any): Promise<void> {',
  '// ==================== 到期提醒任务 ===================='
)

const claimIndex = processDelete.indexOf('await prisma.instance.updateMany')
const incusDeleteIndex = processDelete.indexOf('await deleteIncusInstance')
const networkReleaseIndex = processDelete.indexOf('await tx.portMapping.deleteMany')
const pendingIndex = processDelete.indexOf('deletionBillingPending: true')

assert.notEqual(claimIndex, -1, 'expiry delete must conditionally claim the instance before side effects')
assert.notEqual(incusDeleteIndex, -1, 'expiry delete Incus delete not found')
assert.notEqual(networkReleaseIndex, -1, 'expiry delete network allocation release not found')
assert.notEqual(pendingIndex, -1, 'expiry delete must retain a pending allocation when the remote outcome is uncertain')
assert.ok(claimIndex < incusDeleteIndex, 'expiry delete must claim before Incus deletion')
assert.ok(claimIndex < networkReleaseIndex, 'expiry delete must claim before releasing network allocations')
assert.ok(incusDeleteIndex < networkReleaseIndex, 'expiry delete must delete Incus before releasing network allocations')
assert.ok(processDelete.includes('version: instance.version'), 'expiry delete claim must use optimistic version')
assert.ok(processDelete.includes("status: 'suspended'"), 'expiry delete claim must require suspended status')
assert.ok(processDelete.includes("suspendReason: 'expired'"), 'expiry delete claim must require expired suspension')
assert.ok(processDelete.includes("status: 'deleted'"), 'expiry delete claim must mark the row deleted')
assert.ok(processDelete.includes('version: { increment: 1 }'), 'expiry delete claim must increment version')
assert.ok(processDelete.includes('if (claimResult.count === 0)'), 'expiry delete must skip stale ineligible rows')
assert.ok(!processDelete.includes('prisma.instance.delete'), 'expiry delete must never hard-delete the instance')
assert.ok(
  processDelete.includes('if (!host)') && processDelete.includes('pending reconciliation'),
  'expiry delete must defer host failure and retain occupied allocation after uncertain deletion'
)
assert.ok(processDelete.includes('expiresAt: { lt: new Date() }') && processDelete.includes('const latest = await prisma.instance.findUnique'), 'expiry deletion must recheck latest paid expiry immediately before claiming')

const processNotify = sectionBetween(
  schedulerSource,
  'async function notifyExpiringInstances(days: number): Promise<void> {',
  '// ==================== 充值订单清理任务 ===================='
)

const notifyLatestIndex = processNotify.indexOf('const latest = await prisma.instance.findUnique')
const notifyClaimIndex = processNotify.indexOf('const notificationClaimed = await updateExpiryNotifiedAt(instance.id, {')
const notifyCollectIndex = processNotify.indexOf('claimedExpiryNotifications.push({')
const notifySendIndex = processNotify.indexOf("await sendNotification(userId, 'instance_expiring'")
assert.notEqual(notifyLatestIndex, -1, 'expiry notify must re-read the instance inside the per-instance scheduler lock')
assert.notEqual(notifyClaimIndex, -1, 'expiry notify must conditionally claim the notification before user-facing side effects')
assert.notEqual(notifyCollectIndex, -1, 'expiry notify must collect claimed entries for the per-user aggregation')
assert.notEqual(notifySendIndex, -1, 'expiry notification aggregate send call not found')
assert.ok(notifyLatestIndex < notifyClaimIndex, 'expiry notify eligibility must be rechecked before the notification claim')
assert.ok(notifyClaimIndex < notifyCollectIndex, 'expiry notify must only collect after a successful claim')
assert.ok(notifyCollectIndex < notifySendIndex, 'expiry notify must send only entries collected after claims')
assert.ok(processNotify.includes('expiryNotifiedAt: true'), 'expiry notify must recheck recent notification state')
assert.ok(processNotify.includes('expiresAt: true'), 'expiry notify must reload current expiry time')
assert.ok(processNotify.includes('autoRenew: true'), 'expiry notify must reload current auto-renew state')
assert.ok(processNotify.includes('status: true'), 'expiry notify must reload current instance status')
assert.ok(processNotify.includes('latest.autoRenew'), 'expiry notify must skip instances that enabled auto-renew after the initial scan')
assert.ok(processNotify.includes('!latest.expiresAt'), 'expiry notify must skip rows without a current expiry time')
assert.ok(processNotify.includes('latest.expiresAt < minThreshold'), 'expiry notify must skip rows renewed out of the lower notification window')
assert.ok(processNotify.includes('latest.expiresAt >= maxThreshold'), 'expiry notify must skip rows renewed out of the upper notification window')
assert.ok(
  processNotify.includes("latest.status === 'suspended'") && processNotify.includes("latest.status === 'deleted'"),
  'expiry notify must skip suspended/deleted rows after the initial scan'
)
assert.ok(processNotify.includes('if (!notificationClaimed)'), 'expiry notify must skip side effects when the notification claim fails')
assert.ok(processNotify.includes('notification already claimed or no longer eligible'), 'expiry notify must log stale notification claims')
assert.ok(processNotify.includes('expiresAt: latest.expiresAt'), 'expiry notify must carry the reloaded expiry time into the collected entry')
assert.ok(processNotify.includes('newExpiresAt: earliest.expiresAt.toISOString()'), 'expiry notify must send the reloaded expiry time')
assert.ok(processNotify.includes('expiresAt: earliest.expiresAt'), 'expiry reminder email must use the reloaded expiry time')
assert.ok(processNotify.includes('const claimedByUser = new Map'), 'expiry notify must aggregate claimed entries per user')

console.log('billing expiry race guard tests passed')
