import { createHash } from 'node:crypto'
import type { Prisma, RestoreTask } from '@prisma/client'
import { authorizeUserWrite, type WriteActor, type WriteSession } from './user-write-authorization.js'
import { hasPendingSnapshotOperation } from './snapshot-operation-guards.js'
import { hasPendingProxySiteOperations } from './proxy-site-operation-guards.js'
import { transferHostIdentity } from '../lib/transfer-host-identity.js'

export class RestoreAuthorizationError extends Error {
  constructor(message: string, readonly statusCode = 409, readonly code = 'RESTORE_TARGET_CHANGED') { super(message) }
}

/** Caller holds INSTANCE_OPERATION. Keep current role/session and target rows locked together. */
export async function loadRestoreInstance(tx: Prisma.TransactionClient, instanceId: number, actor: WriteActor) {
  await tx.$queryRaw`SELECT id FROM instances WHERE id = ${instanceId} FOR UPDATE`
  const instance = await tx.instance.findUnique({ where: { id: instanceId } })
  if (!instance || instance.status === 'deleted') throw new RestoreAuthorizationError('实例已删除或不存在')
  await tx.$queryRaw`SELECT id FROM hosts WHERE id = ${instance.hostId} FOR SHARE`
  const host = await tx.host.findUnique({ where: { id: instance.hostId } })
  if (!host) throw new RestoreAuthorizationError('原宿主已不存在')
  if (!await authorizeUserWrite(tx, actor.id, actor) || actor.id !== instance.userId && actor.id !== host.userId &&
    (await tx.user.findUnique({ where: { id: actor.id }, select: { role: true } }))?.role !== 'admin') {
    throw new RestoreAuthorizationError('恢复操作账户、权限或登录授权已失效，请重新登录后提交', 403, 'FORBIDDEN')
  }
  return { instance, host }
}

type RestoreTarget = Pick<RestoreTask, 'instanceId' | 'hostId' | 'userId' | 'backupId' | 'ownerId'>

export async function loadAuthorizedRestore(tx: Prisma.TransactionClient, target: RestoreTarget, session: WriteSession) {
  const { instance, host } = await loadRestoreInstance(tx, target.instanceId, { id: target.userId, sid: session.sid, iat: session.iat })
  if (instance.hostId !== target.hostId || instance.userId !== target.ownerId || !target.backupId) {
    throw new RestoreAuthorizationError('恢复实例归属、宿主或备份已变化，请刷新后重新提交')
  }
  await tx.$queryRaw`SELECT id FROM backups WHERE id = ${target.backupId} FOR SHARE`
  const backup = await tx.backup.findUnique({ where: { id: target.backupId } })
  if (!backup || backup.instanceId !== instance.id || backup.status !== 'ready') {
    throw new RestoreAuthorizationError('原备份已不存在或尚未就绪，请刷新后重新提交')
  }
  const identityHash = createHash('sha256').update(JSON.stringify([instance.id, instance.userId, instance.hostId,
    instance.incusId, instance.createdAt.toISOString(), backup.id, backup.instanceId, backup.incusName,
    backup.createdAt.toISOString(), transferHostIdentity(host)])).digest('hex')
  return { instance, host, backup, identityHash }
}

export function assertRestoreBinding(task: RestoreTask, current: Awaited<ReturnType<typeof loadAuthorizedRestore>>) {
  if (!task.identityHash || task.identityHash !== current.identityHash || task.originalIncusId !== current.instance.incusId ||
    !task.tempInstanceName || !/^restore-[0-9a-f]{32}$/.test(task.tempInstanceName)) {
    throw new RestoreAuthorizationError('恢复目标身份缺失或已变化，请刷新后重新提交')
  }
}

/** Only the caller's own restore task may be excluded. Other workflow fences remain in force. */
export async function restoreWorkflowBusy(tx: Prisma.TransactionClient,
  instance: Awaited<ReturnType<typeof loadRestoreInstance>>['instance'], taskId?: number) {
  const where = { instanceId: instance.id, status: { in: ['PENDING', 'PROCESSING'] as Array<'PENDING' | 'PROCESSING'> } }
  return instance.provisioningCleanupPending || instance.deletionBillingPending ||
    await hasPendingSnapshotOperation(instance.id, tx) || await hasPendingProxySiteOperations(instance.id, tx) ||
    Boolean(await tx.instanceTransfer.count({ where: { instanceId: instance.id, status: { in: ['pending', 'processing'] } } })) ||
    Boolean(await tx.instanceTask.count({ where })) || Boolean(await tx.backupUploadTask.count({ where })) ||
    Boolean(await tx.restoreTask.count({ where: { ...where, ...(taskId === undefined ? {} : { id: { not: taskId } }) } }))
}

export function restoreAttempt(task: RestoreTask) {
  return { id: task.id, status: 'PROCESSING' as const, attemptId: task.attemptId, startedAt: task.startedAt, identityHash: task.identityHash }
}
