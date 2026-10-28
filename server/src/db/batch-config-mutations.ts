import { Prisma } from '@prisma/client'
import { prisma } from './prisma.js'
import { INSTANCE_OPERATION_LOCK_NAMESPACE, tryAdvisoryTransactionLock } from './advisory-locks.js'
import { authorizeUserWrite, type WriteActor } from './user-write-authorization.js'
import { hasActiveTransferWorkflow } from './transfers.js'

const currentInstanceInclude = {
  package: { select: { instanceType: true } },
  packagePlan: { select: { swapSize: true } }
} as const

export type BatchInstanceTarget = { id: number; hostId: number; userId: number; incusId: string }

export async function withBatchInstanceMutation<T>(
  target: BatchInstanceTarget,
  actor: WriteActor,
  requiresAdmin: boolean,
  mutation: (context: {
    tx: Prisma.TransactionClient
    instance: Prisma.InstanceGetPayload<{ include: typeof currentInstanceInclude }>
    host: NonNullable<Awaited<ReturnType<Prisma.TransactionClient['host']['findUnique']>>>
    deadline: number
  }) => Promise<T>
): Promise<T> {
  return prisma.$transaction(async tx => {
    const deadline = Date.now() + 90000
    await tx.$executeRaw`SET LOCAL lock_timeout = '1s'`
    if (!await tryAdvisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, target.id)) {
      throw new Error('BATCH_CONFIG_BUSY: 实例正在执行其他操作，请稍后重试')
    }
    await tx.$queryRaw`SELECT id FROM instances WHERE id = ${target.id} FOR UPDATE`
    const instance = await tx.instance.findUnique({ where: { id: target.id }, include: currentInstanceInclude })
    if (!instance || instance.hostId !== target.hostId || instance.userId !== target.userId || instance.incusId !== target.incusId) {
      throw new Error('BATCH_CONFIG_TARGET_CHANGED: 实例归属或所在宿主已变化，请刷新后重新选择')
    }
    // Hold host identity and accounting stable across the remote operation.
    await tx.$queryRaw`SELECT id FROM hosts WHERE id = ${target.hostId} FOR UPDATE`
    const host = await tx.host.findUnique({ where: { id: target.hostId } })
    if (!host) throw new Error('HOST_NOT_FOUND: 宿主机不存在')
    if (!await authorizeUserWrite(tx, actor.id, actor)) throw new Error('FORBIDDEN: 账号或登录会话已失效')
    const currentActor = await tx.user.findUnique({ where: { id: actor.id }, select: { role: true } })
    if (!currentActor || (currentActor.role !== 'admin' && (requiresAdmin || host.userId !== actor.id))) {
      throw new Error('FORBIDDEN: 当前账号无权修改所选宿主机或高级配置')
    }
    if (!['running', 'stopped'].includes(instance.status) || instance.provisioningCleanupPending || instance.deletionBillingPending ||
      (instance.expiresAt && instance.expiresAt <= new Date()) ||
      (instance.dedicatedIpv4 && (!instance.dedicatedNetworkReady || host.poolFaulted || host.publicIpSyncBlocked))) {
      throw new Error('INSTANCE_NOT_READY: 实例未就绪、已到期或正在清理，不能批量修改配置')
    }
    if (await hasActiveTransferWorkflow(instance.id, tx) ||
      await tx.instanceTransfer.count({ where: { instanceId: instance.id, status: { in: ['pending', 'processing'] } } })) {
      throw new Error('INSTANCE_BUSY: 实例有正在执行的任务或转移')
    }
    return mutation({ tx, instance, host, deadline })
  }, { maxWait: 5000, timeout: 120000 })
}
