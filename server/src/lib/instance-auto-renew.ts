import type { Instance, Prisma } from '@prisma/client'

// Five-minute expiry enforcement also catches missed hourly renewals. Retain
// hourly retry spacing so a failure does not consume three attempts in minutes.
export const AUTO_RENEW_RETRY_MS = 60 * 60 * 1000
export function autoRenewEligibility(now: Date, expiryThreshold: Date): Prisma.InstanceWhereInput {
  return {
    autoRenew: true, packagePlanId: { not: null },
    expiresAt: { not: null, lte: expiryThreshold },
    deletionBillingPending: false, provisioningCleanupPending: false,
    OR: [
      { status: { notIn: ['suspended', 'deleted'] } },
      { status: 'suspended', suspendReason: 'expired', suspendedBy: null }
    ],
    AND: [{ OR: [{ lastAutoRenewAttemptAt: null }, { lastAutoRenewAttemptAt: { lte: new Date(now.getTime() - AUTO_RENEW_RETRY_MS) } }] }],
    instanceTasks: { none: { status: { in: ['PENDING', 'PROCESSING'] } } }
  }
}
export function isAutoRenewEligible(instance: Instance, now: Date, expiryThreshold: Date): boolean {
  return instance.autoRenew && instance.packagePlanId !== null && !!instance.expiresAt && instance.expiresAt <= expiryThreshold &&
    !instance.deletionBillingPending && !instance.provisioningCleanupPending && instance.status !== 'deleted' &&
    (instance.status !== 'suspended' || (instance.suspendReason === 'expired' && instance.suspendedBy === null)) &&
    (!instance.lastAutoRenewAttemptAt || instance.lastAutoRenewAttemptAt.getTime() <= now.getTime() - AUTO_RENEW_RETRY_MS)
}
