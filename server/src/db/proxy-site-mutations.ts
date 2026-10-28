import { Prisma } from '@prisma/client'
import { prisma } from './prisma.js'
import { INSTANCE_OPERATION_LOCK_NAMESPACE, tryAdvisoryTransactionLock } from './advisory-locks.js'
import { authorizeUserWrite, type WriteActor } from './user-write-authorization.js'

export class ProxySiteMutationError extends Error {
  constructor(readonly statusCode: number, message: string, readonly code?: string) {
    super(message)
  }
}

/** Keep ownership, credentials and authorization stable through the remote write.
 * Transfer finalization and other instance operations use this same advisory lock.
 */
export async function withProxySiteMutation<T>(
  instanceId: number,
  siteId: number | undefined,
  actor: WriteActor,
  mutation: (context: {
    tx: Prisma.TransactionClient
    instance: NonNullable<Awaited<ReturnType<Prisma.TransactionClient['instance']['findUnique']>>>
    host: NonNullable<Awaited<ReturnType<Prisma.TransactionClient['host']['findUnique']>>>
    site: Awaited<ReturnType<Prisma.TransactionClient['proxySite']['findUnique']>>
  }) => Promise<T>
): Promise<T> {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`
    if (!await tryAdvisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, instanceId)) {
      throw new ProxySiteMutationError(409, '实例正在执行其他操作，请稍后重试', 'INSTANCE_BUSY')
    }
    await tx.$queryRaw`SELECT id FROM instances WHERE id = ${instanceId} FOR UPDATE`
    const instance = await tx.instance.findUnique({ where: { id: instanceId } })
    if (!instance) throw new ProxySiteMutationError(404, '实例不存在')
    await tx.$queryRaw`SELECT id FROM hosts WHERE id = ${instance.hostId} FOR SHARE`
    const host = await tx.host.findUnique({ where: { id: instance.hostId } })
    if (!host) throw new ProxySiteMutationError(404, '宿主机不存在')
    if (!await authorizeUserWrite(tx, actor.id, actor, true) || instance.userId !== actor.id) {
      throw new ProxySiteMutationError(403, '无权操作此实例', 'FORBIDDEN')
    }
    if (!['running', 'stopped'].includes(instance.status) || instance.provisioningCleanupPending ||
      instance.deletionBillingPending || (instance.expiresAt && instance.expiresAt <= new Date())) {
      throw new ProxySiteMutationError(403, '实例未就绪、已到期或正在清理，不能修改反代站点', 'INSTANCE_NOT_READY')
    }
    const workflow = { instanceId, status: { in: ['PENDING', 'PROCESSING'] as Array<'PENDING' | 'PROCESSING'> } }
    if (await tx.instanceTask.count({ where: workflow }) || await tx.restoreTask.count({ where: workflow }) ||
      await tx.backupUploadTask.count({ where: workflow }) ||
      await tx.instanceTransfer.count({ where: { instanceId, status: { in: ['pending', 'processing'] } } })) {
      throw new ProxySiteMutationError(409, '实例正在执行其他操作，请稍后重试', 'INSTANCE_BUSY')
    }
    if (siteId !== undefined) await tx.$queryRaw`SELECT id FROM proxy_sites WHERE id = ${siteId} FOR UPDATE`
    const site = siteId === undefined ? null : await tx.proxySite.findUnique({ where: { id: siteId } })
    if (siteId !== undefined && (!site || site.instanceId !== instanceId || site.hostId !== host.id)) {
      throw new ProxySiteMutationError(404, '站点不存在')
    }
    return mutation({ tx, instance, host, site })
  }, { maxWait: 5000, timeout: 120000 })
}
