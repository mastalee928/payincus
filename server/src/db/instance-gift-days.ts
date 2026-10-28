import { Prisma } from '@prisma/client'
import { prisma } from './prisma.js'
import { INSTANCE_OPERATION_LOCK_NAMESPACE, tryAdvisoryTransactionLock } from './advisory-locks.js'
import { authorizeUserWrite, type WriteActor } from './user-write-authorization.js'
import { hasActiveTransferWorkflow } from './transfers.js'
import { hasPendingSnapshotOperation } from './snapshot-operation-guards.js'
import { hasPendingProxySiteOperations } from './proxy-site-operation-guards.js'
import { withInstanceBillingMutation } from '../lib/instance-billing-mutation.js'

export class InstanceGiftDaysError extends Error {}

export async function giftInstanceDays(
  expected: { id: number; hostId: number; userId: number; incusId: string; packagePlanId: number | null },
  actor: WriteActor, days: number
): Promise<Date> {
  if (!Number.isSafeInteger(days) || days < 1 || days > 365) throw new InstanceGiftDaysError('赠送天数必须为1至365的整数')
  return withInstanceBillingMutation(expected.id, async () => {
    try {
      return await prisma.$transaction(async tx => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`
        if (!await tryAdvisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, expected.id)) {
          throw new InstanceGiftDaysError('实例正在执行其他操作，请稍后重试')
        }
        await tx.$queryRaw`SELECT id FROM instances WHERE id = ${expected.id} FOR UPDATE`
        const current = await tx.instance.findUnique({ where: { id: expected.id } })
        if (!current || current.status === 'deleted' || current.hostId !== expected.hostId || current.userId !== expected.userId ||
          current.incusId !== expected.incusId || !current.packagePlanId || current.packagePlanId !== expected.packagePlanId) {
          throw new InstanceGiftDaysError('实例归属、位置或套餐已变化，请刷新后重试')
        }
        await tx.$queryRaw`SELECT id FROM hosts WHERE id = ${current.hostId} FOR SHARE`
        const host = await tx.host.findUnique({ where: { id: current.hostId }, select: { userId: true } })
        if (!await authorizeUserWrite(tx, actor.id, actor) || host?.userId !== actor.id) {
          throw new InstanceGiftDaysError('当前账号或会话已失效，或已不再拥有此宿主机')
        }
        if (current.status === 'creating' || current.provisioningCleanupPending || current.deletionBillingPending ||
          await hasActiveTransferWorkflow(current.id, tx) || await hasPendingSnapshotOperation(current.id, tx) ||
          await hasPendingProxySiteOperations(current.id, tx) ||
          await tx.instanceTransfer.count({ where: { instanceId: current.id, status: { in: ['pending', 'processing'] } } })) {
          throw new InstanceGiftDaysError('实例正在创建、清理、转移或执行其他任务，请处理完成后重试')
        }
        const baseTime = Math.max(Date.now(), current.expiresAt?.getTime() ?? 0)
        const newExpiresAt = new Date(baseTime + days * 86400000)
        if (!Number.isFinite(newExpiresAt.getTime())) throw new InstanceGiftDaysError('实例到期时间超出有效范围')
        await tx.instance.update({ where: { id: current.id }, data: {
          expiresAt: newExpiresAt,
          version: { increment: 1 },
          // Keep manual suspension and every unrelated current field unchanged.
          ...(current.status === 'suspended' && current.suspendReason === 'expired' ? {
            status: 'stopped', suspendedAt: null, suspendedBy: null, suspendReason: null
          } : {})
        } })
        await tx.log.create({ data: { userId: actor.id, instanceId: current.id, module: 'instance', action: 'instance.gift_days',
          content: `Gifted ${days} free days to instance #${current.id}: ${current.expiresAt?.toISOString() ?? 'unset'} -> ${newExpiresAt.toISOString()}`,
          result: 'success' } })
        return newExpiresAt
      }, { maxWait: 5000, timeout: 15000 })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2034' || error.code === 'P2028' || error.code === 'P2010' && ['55P03', '40P01'].includes(String(error.meta?.code)))) {
        throw new InstanceGiftDaysError('赠送时长与其他操作冲突，请刷新后重试')
      }
      throw error
    }
  })
}
