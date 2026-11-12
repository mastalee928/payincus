import { createHash } from 'node:crypto'
import type { Instance } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { lockAdministrativeUserMutation, type WriteActor } from '../db/user-write-authorization.js'
import { INSTANCE_OPERATION_LOCK_NAMESPACE, tryAdvisoryTransactionLock } from '../db/advisory-locks.js'
import { hasActiveTransferWorkflow } from '../db/transfers.js'
import { hasPendingSnapshotOperation } from '../db/snapshot-operation-guards.js'
import { hasPendingProxySiteOperations } from '../db/proxy-site-operation-guards.js'
import { withInstanceBillingMutation } from '../lib/instance-billing-mutation.js'
import { hostMaintenanceBlocked } from '../lib/host-maintenance-gate.js'
import { expiryRetentionEnded } from '../lib/instance-auto-renew.js'
import { recoveryHeld } from './platform-backup-core.js'

export class InstanceRenewalPriceError extends Error {
  constructor(readonly code: string, readonly statusCode = 409) { super(code) }
}
const reject = (code: string, status = 409): never => { throw new InstanceRenewalPriceError(code, status) }

// Decimal text prevents coercion, exponent notation and silent rounding of money.
export function parseRenewalPrice(value: unknown): number {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,5})(?:\.\d{1,2})?$/.test(value) || Number(value) > 100000) return reject('RENEWAL_PRICE_INVALID', 400)
  return Number(value)
}
function snapshot(instance: Instance) {
  const revision = createHash('sha256').update(JSON.stringify([
    instance.id, instance.userId, instance.hostId, instance.incusId, instance.version,
    instance.status, instance.expiresAt, instance.suspendedAt, instance.suspendedBy, instance.suspendReason,
    instance.packagePlanId, instance.billingPrice, instance.billingCycle, instance.renewalPrice
  ])).digest('hex')
  return { instanceId: instance.id, ownerId: instance.userId, hostId: instance.hostId, incusId: instance.incusId,
    price: Number(instance.renewalPrice ?? instance.billingPrice).toFixed(2),
    final: instance.renewalPrice !== null, billingCycle: instance.billingCycle || 1, revision }
}

/** Shares renewal/expiry serialization; never writes balances, paid bills or deadlines. */
export async function adminInstanceRenewalPrice(instanceId: number, actor: WriteActor, change?: { revision: string; price: number }) {
  if (recoveryHeld()) return reject('RENEWAL_PRICE_RECOVERY_HELD')
  return withInstanceBillingMutation(instanceId, () => prisma.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL lock_timeout = '3s'`
    if (!await tryAdvisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, instanceId)) return reject('RENEWAL_PRICE_BUSY')
    await tx.$queryRaw`SELECT id FROM instances WHERE id=${instanceId} FOR UPDATE`
    const instance = await tx.instance.findUnique({ where: { id: instanceId } })
    if (!instance) return reject('RENEWAL_PRICE_NOT_FOUND', 404)
    await tx.$queryRaw`SELECT id FROM hosts WHERE id=${instance.hostId} FOR SHARE`
    await lockAdministrativeUserMutation(tx, instance.userId, actor)
    const host = await tx.host.findUnique({ where: { id: instance.hostId }, select: { securityHardening: true } })
    if (recoveryHeld()) return reject('RENEWAL_PRICE_RECOVERY_HELD')
    if (!instance.packagePlanId || instance.billingPrice === null || !instance.expiresAt ||
      !Number.isSafeInteger(instance.billingCycle || 1) || (instance.billingCycle || 1) < 1 || (instance.billingCycle || 1) > 24) return reject('RENEWAL_PRICE_NOT_PAID')
    if (instance.status === 'deleted' || instance.deletionIntent !== null || instance.deletionBillingPending ||
      instance.provisioningCleanupPending || expiryRetentionEnded(instance, new Date())) return reject('RENEWAL_PRICE_DELETING')
    if (!['running', 'stopped', 'suspended'].includes(instance.status) || !host || hostMaintenanceBlocked(host.securityHardening) ||
      await hasActiveTransferWorkflow(instanceId, tx) ||
      await tx.instanceTransfer.count({ where: { instanceId, status: { in: ['pending', 'processing'] } } }) ||
      await hasPendingSnapshotOperation(instanceId, tx) || await hasPendingProxySiteOperations(instanceId, tx) ||
      await tx.instanceTask.count({ where: { instanceId, operationEntry: 'auto-renew-resume-v1', status: 'FAILED',
        OR: [{ error: null }, { error: { not: '用户取消' } }],
        replacementState: { path: ['terminal'], equals: false } } })) return reject('RENEWAL_PRICE_BUSY')
    const before = snapshot(instance)
    if (!change) return before
    if (before.revision !== change.revision) return reject('RENEWAL_PRICE_CHANGED')
    if (!Number.isFinite(change.price) || change.price < 0 || change.price > 100000 || Math.abs(change.price * 100 - Math.round(change.price * 100)) > 1e-7) return reject('RENEWAL_PRICE_INVALID', 400)
    if (instance.renewalPrice !== null && Number(instance.renewalPrice) === change.price) return { ...before, changed: false }
    if (expiryRetentionEnded(instance, new Date())) return reject('RENEWAL_PRICE_DELETING')
    if (recoveryHeld()) return reject('RENEWAL_PRICE_RECOVERY_HELD')
    const updated = await tx.instance.update({ where: { id: instanceId }, data: {
      renewalPrice: change.price, version: { increment: 1 }
    } })
    await tx.log.create({ data: { userId: actor.id, instanceId, module: 'instance', action: 'instance.renewal_price_update', result: 'success',
      content: `管理员 #${actor.id} 修改用户 #${instance.userId} 的实例 #${instanceId} 下期续费价：¥${before.price}${before.final ? '（最终价）' : '（基础价）'} → ¥${change.price.toFixed(2)}（最终价）/${before.billingCycle}个月；不叠加优惠，当前账单、余额及到期时间不变` } })
    if (recoveryHeld()) return reject('RENEWAL_PRICE_RECOVERY_HELD')
    return { ...snapshot(updated), changed: true }
  }, { maxWait: 5000, timeout: 10000 }), { onBusy: () => reject('RENEWAL_PRICE_BUSY') })
}
