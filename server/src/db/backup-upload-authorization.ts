import { createHash } from 'node:crypto'
import type { BackupUploadTask, Prisma, StorageConfig } from '@prisma/client'
import { authorizeUserWrite, type WriteSession } from './user-write-authorization.js'
import { hasPendingSnapshotOperation } from './snapshot-operation-guards.js'
import { hasPendingProxySiteOperations } from './proxy-site-operation-guards.js'
import { transferHostIdentity } from '../lib/transfer-host-identity.js'

export class BackupUploadAuthorizationError extends Error {
  constructor(message: string, readonly statusCode = 409, readonly code = 'BACKUP_UPLOAD_TARGET_CHANGED') { super(message) }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)]))
  return value
}

/** Hash transport settings, including encrypted credentials; never persist another credential copy. */
export function uploadStorageIdentity(config: StorageConfig): string {
  return createHash('sha256').update(JSON.stringify([config.id, config.userId, config.type, config.host,
    config.port, config.username, config.password, config.basePath, canonical(config.extra)])).digest('hex')
}

type UploadTarget = Pick<BackupUploadTask, 'userId' | 'instanceId' | 'backupId' | 'hostId' | 'storageConfigId'>

/** Caller holds INSTANCE_OPERATION; row locks serialize target changes until dispatch validation commits. */
export async function loadAuthorizedUpload(tx: Prisma.TransactionClient, target: UploadTarget, session: WriteSession) {
  await tx.$queryRaw`SELECT id FROM instances WHERE id = ${target.instanceId} FOR UPDATE`
  const instance = await tx.instance.findUnique({ where: { id: target.instanceId } })
  if (!instance || instance.userId !== target.userId || instance.hostId !== target.hostId || instance.status === 'deleted') {
    throw new BackupUploadAuthorizationError('实例已删除、归属或宿主已变化，请刷新后重新提交上传')
  }
  await tx.$queryRaw`SELECT id FROM hosts WHERE id = ${target.hostId} FOR SHARE`
  await tx.$queryRaw`SELECT id FROM backups WHERE id = ${target.backupId} FOR SHARE`
  await tx.$queryRaw`SELECT id FROM storage_configs WHERE id = ${target.storageConfigId} FOR SHARE`
  const host = await tx.host.findUnique({ where: { id: target.hostId } })
  const backup = await tx.backup.findUnique({ where: { id: target.backupId } })
  const storageConfig = await tx.storageConfig.findUnique({ where: { id: target.storageConfigId } })
  if (!backup || backup.instanceId !== instance.id || backup.status !== 'ready') {
    throw new BackupUploadAuthorizationError('原备份已不存在或尚未就绪，请刷新后重新提交上传')
  }
  if (!host || !storageConfig || storageConfig.userId !== target.userId) {
    throw new BackupUploadAuthorizationError('原宿主或存储配置已不存在或归属已变化，请刷新后重新提交上传')
  }
  if (!await authorizeUserWrite(tx, target.userId, session)) {
    throw new BackupUploadAuthorizationError('上传账户或登录授权已失效，请重新登录后提交', 403, 'FORBIDDEN')
  }
  const user = await tx.user.findUniqueOrThrow({ where: { id: target.userId }, select: { username: true } })
  const identityHash = createHash('sha256').update(JSON.stringify([instance.id, instance.userId, instance.hostId,
    instance.incusId, instance.createdAt.toISOString(), backup.id, backup.instanceId, backup.incusName,
    backup.createdAt.toISOString(), transferHostIdentity(host), uploadStorageIdentity(storageConfig)])).digest('hex')
  return { instance, backup, host, storageConfig, user, identityHash }
}

export function assertUploadBinding(task: BackupUploadTask, current: Awaited<ReturnType<typeof loadAuthorizedUpload>>) {
  if (!task.identityHash || current.identityHash !== task.identityHash) {
    throw new BackupUploadAuthorizationError('上传目标身份缺失或已变化，请刷新后重新提交上传')
  }
}

/** Transient workflow conflicts leave the queued request pending; invalid identities fail separately. */
export async function uploadWorkflowBusy(tx: Prisma.TransactionClient, instance: Awaited<ReturnType<typeof loadAuthorizedUpload>>['instance']) {
  return instance.provisioningCleanupPending || instance.deletionBillingPending ||
    await hasPendingSnapshotOperation(instance.id, tx) || await hasPendingProxySiteOperations(instance.id, tx) ||
    Boolean(await tx.instanceTransfer.count({ where: { instanceId: instance.id, status: { in: ['pending', 'processing'] } } }))
}
