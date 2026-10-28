import { prisma } from './prisma.js'
import { INSTANCE_OPERATION_LOCK_NAMESPACE, tryAdvisoryTransactionLock } from './advisory-locks.js'
import { authorizeUserWrite, type WriteActor } from './user-write-authorization.js'
import { hasActiveTransferWorkflow } from './transfers.js'
import { hasPendingSnapshotOperation } from './snapshot-operation-guards.js'
import { hasPendingProxySiteOperations } from './proxy-site-operation-guards.js'
import { ErrorCode, type ErrorCodeType } from '../lib/errors.js'

export class InstanceQuotaMutationError extends Error {
  constructor(readonly statusCode: number, readonly code: ErrorCodeType, message?: string) { super(message || code) }
}

export type InstanceQuotaPatch = {
  portLimit?: number | null
  snapshotLimit?: number | null
  backupLimit?: number | null
  siteLimit?: number | null
}

/** Use the same instance fence as snapshot, backup and site creation. */
export async function updateInstanceQuotaAuthorized(
  expected: { id: number; user_id: number; host_id: number; incus_id: string },
  hostOwnerId: number | undefined, actor: WriteActor, patch: InstanceQuotaPatch
): Promise<void> {
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`
    if (!await tryAdvisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, expected.id)) {
      throw new InstanceQuotaMutationError(409, ErrorCode.INVALID_PARAMS, '实例正在执行其他操作，请稍后重试')
    }
    await tx.$queryRaw`SELECT id FROM instances WHERE id = ${expected.id} FOR UPDATE`
    const instance = await tx.instance.findUnique({ where: { id: expected.id } })
    if (!instance || instance.status === 'deleted') throw new InstanceQuotaMutationError(404, ErrorCode.INSTANCE_NOT_FOUND)
    if (instance.hostId !== expected.host_id || instance.userId !== expected.user_id || instance.incusId !== expected.incus_id) {
      throw new InstanceQuotaMutationError(409, ErrorCode.INVALID_PARAMS, '实例归属或位置已变化，请刷新后重试')
    }
    await tx.$queryRaw`SELECT id FROM hosts WHERE id = ${instance.hostId} FOR SHARE`
    const host = await tx.host.findUnique({ where: { id: instance.hostId } })
    if (!host) throw new InstanceQuotaMutationError(404, ErrorCode.HOST_NOT_FOUND)
    if (!await authorizeUserWrite(tx, actor.id, actor) ||
      ((await tx.user.findUnique({ where: { id: actor.id }, select: { role: true } }))?.role !== 'admin' && host.userId !== actor.id)) {
      throw new InstanceQuotaMutationError(403, ErrorCode.FORBIDDEN)
    }
    if (host.userId !== hostOwnerId) throw new InstanceQuotaMutationError(409, ErrorCode.INVALID_PARAMS, '宿主机归属已变化，请刷新后重试')
    if (instance.status === 'creating' || instance.provisioningCleanupPending || instance.deletionBillingPending ||
      await hasActiveTransferWorkflow(instance.id, tx) || await hasPendingSnapshotOperation(instance.id, tx) ||
      await hasPendingProxySiteOperations(instance.id, tx) ||
      await tx.instanceTransfer.count({ where: { instanceId: instance.id, status: { in: ['pending', 'processing'] } } })) {
      throw new InstanceQuotaMutationError(409, ErrorCode.INVALID_PARAMS, '实例正在创建、清理、转移或执行其他任务，请处理完成后重试')
    }
    // Only submitted fields change. Null means no quota for ports/snapshots/backups;
    // sites inherit the package (or 10), and siteLimit=0 means unlimited.
    for (const [field, minimum] of [['portLimit', 1], ['snapshotLimit', 0], ['backupLimit', 0], ['siteLimit', 0]] as const) {
      const value = patch[field]
      if (value !== undefined && value !== null && (!Number.isInteger(value) || value < minimum || value > 1000)) {
        throw new InstanceQuotaMutationError(400, ErrorCode.CONFIG_INVALID_VALUE, `${field} must be between ${minimum} and 1000`)
      }
    }
    const instanceId = instance.id
    if (patch.portLimit !== undefined) {
      const used = await tx.portMapping.count({ where: { instanceId, systemManaged: false } })
      if ((patch.portLimit ?? 0) < used) throw new InstanceQuotaMutationError(400, ErrorCode.QUOTA_PORT_BELOW_USED, `used: ${used}, set: ${patch.portLimit ?? 0}`)
    }
    if (patch.snapshotLimit !== undefined) {
      const used = await tx.snapshot.count({ where: { instanceId } })
      if ((patch.snapshotLimit ?? 0) < used) throw new InstanceQuotaMutationError(400, ErrorCode.QUOTA_SNAPSHOT_BELOW_USED, `used: ${used}, set: ${patch.snapshotLimit ?? 0}`)
    }
    if (patch.backupLimit !== undefined) {
      const used = await tx.backup.count({ where: { instanceId, status: { in: ['creating', 'ready'] } } })
      if ((patch.backupLimit ?? 0) < used) throw new InstanceQuotaMutationError(400, ErrorCode.QUOTA_BACKUP_BELOW_USED, `used: ${used}, set: ${patch.backupLimit ?? 0}`)
    }
    if (patch.siteLimit !== undefined) {
      let limit = patch.siteLimit
      if (limit === null && instance.packageId) {
        await tx.$queryRaw`SELECT id FROM packages WHERE id = ${instance.packageId} FOR SHARE`
        limit = (await tx.package.findUnique({ where: { id: instance.packageId } }))?.siteLimit ?? null
      }
      limit ??= 10
      const used = await tx.proxySite.count({ where: { instanceId } })
      if (limit !== 0 && limit < used) throw new InstanceQuotaMutationError(400, ErrorCode.INVALID_PARAMS, `站点配额不能低于已使用数量 (${used}/${limit})`)
    }
    await tx.instance.update({ where: { id: instanceId }, data: patch })
  }, { maxWait: 5000, timeout: 15000 })
}
