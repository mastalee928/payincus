import { Prisma, type Instance } from '@prisma/client'

// Failed notifications are hourly; sufficient funds are checked on every patrol
// and after a committed recharge. Failure counts never revoke the user's opt-in.
export const AUTO_RENEW_RETRY_MS = 60 * 60 * 1000
export const EXPIRY_RETENTION_DAYS = 3
export function expiryRetentionCutoff(now: Date): Date {
  return new Date(now.getTime() - EXPIRY_RETENTION_DAYS * 86400000)
}
export function expiryRetentionEnded(instance: Pick<Instance, 'status' | 'suspendReason' | 'suspendedBy' | 'suspendedAt' | 'expiresAt'>, now: Date): boolean {
  return instance.status === 'suspended' && instance.suspendReason === 'expired' && instance.suspendedBy === null &&
    !!instance.expiresAt && instance.expiresAt <= now && (!instance.suspendedAt || instance.suspendedAt <= expiryRetentionCutoff(now))
}
export function autoRenewEligibility(now: Date, expiryThreshold: Date): Prisma.InstanceWhereInput {
  return {
    autoRenew: true, packagePlanId: { not: null },
    expiresAt: { not: null, lte: expiryThreshold },
    deletionBillingPending: false, provisioningCleanupPending: false,
    deletionIntent: { equals: Prisma.DbNull }, user: { status: 'active' },
    OR: [
      { status: { in: ['running', 'stopped'] } },
      { status: 'suspended', suspendReason: 'expired', suspendedBy: null, suspendedAt: { gt: expiryRetentionCutoff(now) } }
    ],
    transfers: { none: { status: { in: ['pending', 'processing'] } } },
    instanceTasks: { none: { status: { in: ['PENDING', 'PROCESSING'] } } }
  }
}
export function isAutoRenewEligible(instance: Instance, now: Date, expiryThreshold: Date): boolean {
  return instance.autoRenew && instance.packagePlanId !== null && !!instance.expiresAt && instance.expiresAt <= expiryThreshold &&
    !instance.deletionBillingPending && !instance.provisioningCleanupPending && !instance.deletionIntent &&
    ['running', 'stopped', 'suspended'].includes(instance.status) &&
    (instance.status !== 'suspended' || (instance.suspendReason === 'expired' && instance.suspendedBy === null)) &&
    !expiryRetentionEnded(instance, now)
}
