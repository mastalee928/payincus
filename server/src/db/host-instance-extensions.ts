import { Prisma } from '@prisma/client'
import { prisma } from './prisma.js'
import { authorizeUserWrite, type WriteActor } from './user-write-authorization.js'
import { INSTANCE_OPERATION_LOCK_NAMESPACE, tryAdvisoryTransactionLock } from './advisory-locks.js'
import { withInstanceBillingMutation } from '../lib/instance-billing-mutation.js'
import { hasActiveTransferWorkflow } from './transfers.js'
import { hasPendingSnapshotOperation } from './snapshot-operation-guards.js'
import { hasPendingProxySiteOperations } from './proxy-site-operation-guards.js'
import { getNotificationContent } from '../lib/notifier.js'

export class HostExtensionError extends Error {
  constructor(readonly statusCode: number, message: string) { super(message) }
}

async function billingLanes<T>(ids: number[], action: () => Promise<T>): Promise<T> {
  return ids.length ? withInstanceBillingMutation(ids[0], () => billingLanes(ids.slice(1), action)) : action()
}

/** A retry after a failed batch cannot extend an already committed subset. */
export async function extendHostPaidInstances(hostId: number, actor: WriteActor, days: number) {
  if (!Number.isSafeInteger(days) || days < 1 || days > 365) throw new HostExtensionError(400, '延期天数必须为1至365的整数')
  const targets = await prisma.instance.findMany({ where: { hostId, packagePlanId: { not: null },
    status: { not: 'deleted' }, expiresAt: { not: null } }, orderBy: { id: 'asc' },
    select: { id: true, userId: true, hostId: true, incusId: true, packagePlanId: true } })
  return billingLanes(targets.map(row => row.id), () => prisma.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`
    for (const target of targets) {
      if (!await tryAdvisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, target.id)) {
        throw new HostExtensionError(409, '所选实例正在执行其他操作，本批没有延期，请稍后重试')
      }
    }
    if (targets.length) await tx.$queryRaw(Prisma.sql`SELECT id FROM instances WHERE id IN (${Prisma.join(targets.map(row => row.id))}) ORDER BY id FOR UPDATE`)
    await tx.$queryRaw`SELECT id FROM hosts WHERE id = ${hostId} FOR SHARE`
    const host = await tx.host.findUnique({ where: { id: hostId }, select: { name: true } })
    if (!host) throw new HostExtensionError(404, '宿主机不存在')
    // Inbox foreign keys also lock recipients; acquire every account in the same
    // order as billing before holding the administrator authorization lock.
    const accountIds = [...new Set([actor.id, ...targets.map(row => row.userId)])].sort((a, b) => a - b)
    await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id IN (${Prisma.join(accountIds)}) ORDER BY id FOR UPDATE`)
    if (!await authorizeUserWrite(tx, actor.id, actor) ||
      (await tx.user.findUnique({ where: { id: actor.id }, select: { role: true } }))?.role !== 'admin') {
      throw new HostExtensionError(403, '管理员账号或登录会话已失效，本批没有延期')
    }
    const affectedUserIds = new Set<number>()
    for (const target of targets) {
      const current = await tx.instance.findUnique({ where: { id: target.id } })
      if (!current || current.hostId !== target.hostId || current.userId !== target.userId || current.incusId !== target.incusId ||
        current.packagePlanId !== target.packagePlanId || !current.expiresAt || current.status === 'deleted' ||
        current.status === 'creating' || current.provisioningCleanupPending || current.deletionBillingPending ||
        await hasActiveTransferWorkflow(current.id, tx) ||
        await hasPendingSnapshotOperation(current.id, tx) || await hasPendingProxySiteOperations(current.id, tx) ||
        await tx.instanceTransfer.count({ where: { instanceId: current.id, status: { in: ['pending', 'processing'] } } })) {
        throw new HostExtensionError(409, `实例 #${target.id} 的归属、位置、套餐或任务状态已变化，本批没有延期，请刷新后重试`)
      }
      const expiresAt = new Date(current.expiresAt.getTime() + days * 86400000)
      if (!Number.isFinite(expiresAt.getTime())) throw new HostExtensionError(400, '到期时间超出有效范围，本批没有延期')
      await tx.instance.update({ where: { id: current.id }, data: { expiresAt, version: { increment: 1 } } })
      affectedUserIds.add(current.userId)
    }
    if (targets.length) await tx.log.create({ data: { userId: actor.id, module: 'host', action: 'host.batch_extend',
      content: `Batch extended ${targets.length} paid instances on host "${host.name}" by ${days} days`, result: 'success' } })
    const data = { hostName: host.name, days }
    const content = getNotificationContent('instances_batch_extended', data)
    for (const userId of affectedUserIds) await tx.inboxMessage.create({ data: {
      userId, eventType: 'instances_batch_extended', title: content.title, content: content.message, data
    } })
    return { extendedCount: targets.length, hostName: host.name, affectedUserIds: [...affectedUserIds] }
  }, { maxWait: 5000, timeout: 60000 }))
}
