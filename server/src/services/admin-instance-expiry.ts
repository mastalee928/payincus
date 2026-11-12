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
import { recoveryHeld } from './platform-backup-core.js'
import { wakeExpiryDeadlines } from '../lib/instance-expiry.js'

export class InstanceExpiryError extends Error {
  constructor(readonly code: string, readonly statusCode = 409) { super(code) }
}
const reject = (code: string, status = 409): never => { throw new InstanceExpiryError(code, status) }

/** Accept only an explicit UTC instant, including real calendar dates. */
export function parseInstanceExpiry(value: unknown): Date {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return reject('EXPIRY_INVALID_DATE', 400)
  const date = new Date(value)
  const normalized = value.includes('.') ? value : value.replace('Z', '.000Z')
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== normalized || date.getUTCFullYear() < 2000) return reject('EXPIRY_INVALID_DATE', 400)
  return date
}

// Exclude sampled resource stats: polling must not make a valid edit stale.
function snapshot(instance: Instance) {
  const revision = createHash('sha256').update(JSON.stringify([
    instance.id, instance.userId, instance.hostId, instance.incusId, instance.version, instance.expiresAt,
    instance.status, instance.suspendedAt, instance.suspendedBy, instance.suspendReason,
    instance.autoRenew, instance.packagePlanId, instance.billingPrice, instance.billingCycle
  ])).digest('hex')
  return { instanceId: instance.id, ownerId: instance.userId, hostId: instance.hostId, incusId: instance.incusId,
    expiresAt: instance.expiresAt!.toISOString(), revision }
}

/** No remote effects and no financial records. Share renewal/expiry fences. */
export async function adminInstanceExpiry(instanceId: number, actor: WriteActor, change?: { revision: string; expiresAt: Date }) {
  if (recoveryHeld()) return reject('EXPIRY_RECOVERY_HELD')
  const result=await withInstanceBillingMutation(instanceId, () => prisma.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL lock_timeout = '3s'`
    if (!await tryAdvisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, instanceId)) return reject('EXPIRY_BUSY')
    await tx.$queryRaw`SELECT id FROM instances WHERE id=${instanceId} FOR UPDATE`
    const instance = await tx.instance.findUnique({ where: { id: instanceId } })
    if (!instance) return reject('EXPIRY_NOT_FOUND', 404)
    await tx.$queryRaw`SELECT id FROM hosts WHERE id=${instance.hostId} FOR SHARE`
    await lockAdministrativeUserMutation(tx, instance.userId, actor)
    const host = await tx.host.findUnique({ where: { id: instance.hostId }, select: { securityHardening: true } })
    if (recoveryHeld()) return reject('EXPIRY_RECOVERY_HELD')
    if (!instance.expiresAt) return reject('EXPIRY_NO_DEADLINE')
    if (instance.status === 'deleted' || instance.deletionIntent !== null || instance.deletionBillingPending || instance.provisioningCleanupPending) return reject('EXPIRY_DELETING')
    if (!['running', 'stopped', 'suspended'].includes(instance.status) || !host || hostMaintenanceBlocked(host.securityHardening) ||
      await hasActiveTransferWorkflow(instanceId, tx) ||
      await tx.instanceTransfer.count({ where: { instanceId, status: { in: ['pending', 'processing'] } } }) ||
      await hasPendingSnapshotOperation(instanceId, tx) || await hasPendingProxySiteOperations(instanceId, tx) ||
      await tx.instanceTask.count({ where: { instanceId, operationEntry: 'auto-renew-resume-v1', status: 'FAILED',
        OR: [{ error: null }, { error: { not: '用户取消' } }],
        replacementState: { path: ['terminal'], equals: false } } })) return reject('EXPIRY_BUSY')
    const before = snapshot(instance)
    if (!change) return before
    if (before.revision !== change.revision) return reject('EXPIRY_CHANGED')
    if (instance.expiresAt.getTime() === change.expiresAt.getTime()) return { ...before, changed: false }
    const clearExpired = change.expiresAt > new Date() && instance.status === 'suspended' &&
      instance.suspendReason === 'expired' && instance.suspendedBy === null
    const updated = await tx.instance.update({ where: { id: instanceId }, data: {
      expiresAt: change.expiresAt, version: { increment: 1 }, expiryNotifiedAt: null,
      autoRenewAttempts: 0, lastAutoRenewAttemptAt: null,
      ...(clearExpired ? { status: 'stopped', suspendedAt: null, suspendedBy: null, suspendReason: null } : {})
    } })
    await tx.log.create({ data: { userId: actor.id, instanceId, module: 'instance', action: 'instance.expiry_update', result: 'success',
      content: `管理员 #${actor.id} 修改用户 #${instance.userId} 的实例 #${instanceId} 到期时间：${before.expiresAt} → ${change.expiresAt.toISOString()}（UTC）；未扣费或退款${clearExpired ? '；已解除系统到期暂停，保持关机' : ''}` } })
    if (recoveryHeld()) return reject('EXPIRY_RECOVERY_HELD')
    return { ...snapshot(updated), changed: true }
  }, { maxWait: 5000, timeout: 10000 }), { onBusy: () => reject('EXPIRY_BUSY') })
  if(change)wakeExpiryDeadlines()
  return result
}
