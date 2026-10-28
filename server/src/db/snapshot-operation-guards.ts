import type { Prisma } from '@prisma/client'
import { prisma } from './prisma.js'
import { INSTANCE_OPERATION_LOCK_NAMESPACE, tryAdvisoryTransactionLock } from './advisory-locks.js'
import { authorizeUserWrite, type WriteActor } from './user-write-authorization.js'
import { hasActiveTransferWorkflow } from './transfers.js'
import { assertNoPendingProxySiteOperations } from './proxy-site-operation-guards.js'

export const OPEN_AUTO_SNAPSHOT_STATES = ['pending', 'applying', 'retry', 'blocked']

export class SnapshotOperationPendingError extends Error {
  readonly statusCode = 409
  readonly code = 'SNAPSHOT_OPERATION_PENDING'
  constructor() { super('自动快照仍有未完成操作，请在快照页面完成恢复后重试') }
}

export async function hasPendingSnapshotOperation(instanceId: number,
  tx: Pick<Prisma.TransactionClient, 'autoSnapshotOperation'> = prisma): Promise<boolean> {
  return Boolean(await tx.autoSnapshotOperation.findFirst({ where: { instanceId, state: { in: OPEN_AUTO_SNAPSHOT_STATES } }, select: { id: true } }))
}

export async function assertNoPendingSnapshotOperations(tx: Pick<Prisma.TransactionClient, 'autoSnapshotOperation'>, instanceId: number) {
  if (await hasPendingSnapshotOperation(instanceId, tx)) throw new SnapshotOperationPendingError()
}

export class SnapshotMutationError extends Error {
  constructor(message: string, readonly statusCode = 409) { super(message) }
}

/** Recheck the request target and actor after waiting, and keep the fence through the effect. */
export async function withSnapshotMutation<T>(expected: { id: number; user_id: number; host_id: number; incus_id: string },
  actor: WriteActor, policyOnly: boolean,
  work: (tx: Prisma.TransactionClient, instance: Awaited<ReturnType<typeof loadSnapshotInstance>>) => Promise<T>): Promise<T> {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`
    if (!await tryAdvisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, expected.id)) throw new SnapshotMutationError('实例正在执行其他操作')
    await tx.$queryRaw`SELECT id FROM instances WHERE id = ${expected.id} FOR UPDATE`
    const instance = await loadSnapshotInstance(tx, expected.id)
    await tx.$queryRaw`SELECT id FROM hosts WHERE id = ${instance.hostId} FOR SHARE`
    instance.host = await tx.host.findUniqueOrThrow({ where: { id: instance.hostId } })
    if (instance.userId !== expected.user_id || instance.hostId !== expected.host_id || instance.incusId !== expected.incus_id) {
      throw new SnapshotMutationError('实例归属或位置已变化，请刷新后重试')
    }
    if (!await authorizeUserWrite(tx, actor.id, actor) || actor.id !== instance.userId && actor.id !== instance.host.userId &&
      (await tx.user.findUnique({ where: { id: actor.id }, select: { role: true } }))?.role !== 'admin') throw new SnapshotMutationError('无权操作此实例', 403)
    if (instance.status === 'deleted' || instance.provisioningCleanupPending || instance.deletionBillingPending ||
      await hasActiveTransferWorkflow(instance.id, tx) || await tx.instanceTransfer.count({ where: { instanceId: instance.id, status: { in: ['pending', 'processing'] } } })) {
      throw new SnapshotMutationError('实例正在转移或执行其他任务')
    }
    if (!policyOnly) {
      await assertNoPendingSnapshotOperations(tx, instance.id)
      await assertNoPendingProxySiteOperations(tx, instance.id)
    }
    return work(tx, instance)
  }, { maxWait: 5000, timeout: 240000 })
}

async function loadSnapshotInstance(tx: Prisma.TransactionClient, instanceId: number) {
  const instance = await tx.instance.findUnique({ where: { id: instanceId }, include: { host: true } })
  if (!instance) throw new SnapshotMutationError('实例已不存在', 404)
  return instance
}
