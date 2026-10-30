import type { OperationType } from '@prisma/client'
import { prisma } from './prisma.js'
import { authorizeUserWrite, type WriteActor } from './user-write-authorization.js'

/** Match the existing operation permissions before describing or issuing a verification. */
export async function authorizeOperationVerificationResource(actor: WriteActor, operationType: OperationType, resourceId: number):
Promise<'allowed' | 'forbidden' | 'authentication_changed'> {
  if (!Number.isSafeInteger(resourceId) || resourceId <= 0 || resourceId > 2147483647) return 'forbidden'
  return prisma.$transaction(async tx => {
    const child = operationType === 'delete_snapshot'
      ? await tx.snapshot.findUnique({ where: { id: resourceId }, select: { instanceId: true } })
      : operationType === 'delete_backup'
        ? await tx.backup.findUnique({ where: { id: resourceId }, select: { instanceId: true } }) : null
    if (['delete_snapshot', 'delete_backup'].includes(operationType) && !child) return 'forbidden'
    const instanceId = child?.instanceId ?? resourceId
    await tx.$queryRaw`SELECT id FROM instances WHERE id = ${instanceId} FOR SHARE`
    const instance = await tx.instance.findUnique({ where: { id: instanceId }, select: { userId: true, hostId: true, status: true } })
    if (!instance || instance.status === 'deleted') return 'forbidden'
    await tx.$queryRaw`SELECT id FROM hosts WHERE id = ${instance.hostId} FOR SHARE`
    const host = await tx.host.findUnique({ where: { id: instance.hostId }, select: { userId: true } })
    if (!host) return 'forbidden'
    if (operationType === 'delete_snapshot') {
      await tx.$queryRaw`SELECT id FROM snapshots WHERE id = ${resourceId} FOR SHARE`
      if ((await tx.snapshot.findUnique({ where: { id: resourceId }, select: { instanceId: true } }))?.instanceId !== instanceId) return 'forbidden'
    } else if (operationType === 'delete_backup') {
      await tx.$queryRaw`SELECT id FROM backups WHERE id = ${resourceId} FOR SHARE`
      const backup = await tx.backup.findUnique({ where: { id: resourceId }, select: { instanceId: true, status: true } })
      if (backup?.instanceId !== instanceId || backup.status === 'deleted') return 'forbidden'
    }
    if (!await authorizeUserWrite(tx, actor.id, actor)) return 'authentication_changed'
    const owner = instance.userId === actor.id
    if (operationType === 'reinstall_instance' || operationType === 'recreate_instance') return owner ? 'allowed' : 'forbidden'
    const admin = (await tx.user.findUniqueOrThrow({ where: { id: actor.id }, select: { role: true } })).role === 'admin'
    if (operationType === 'transfer_instance') return owner || admin ? 'allowed' : 'forbidden'
    return owner || admin || host.userId === actor.id ? 'allowed' : 'forbidden'
  })
}
