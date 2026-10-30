import type { OperationType, Prisma } from '@prisma/client'
import { createHash } from 'node:crypto'
import { prisma } from './prisma.js'
import { authorizeUserWrite, type WriteActor } from './user-write-authorization.js'
import { transferHostIdentity } from '../lib/transfer-host-identity.js'

/** Match the existing operation permissions before describing or issuing a verification. */
export async function authorizeOperationVerificationResource(actor: WriteActor, operationType: OperationType, resourceId: number):
Promise<'allowed' | 'forbidden' | 'authentication_changed'> {
  return prisma.$transaction(async tx => (await loadAuthorizedOperationVerificationResource(tx, actor, operationType, resourceId)).kind)
}

export async function loadAuthorizedOperationVerificationResource(tx: Prisma.TransactionClient, actor: WriteActor,
  operationType: OperationType, resourceId: number): Promise<
    { kind: 'allowed'; binding: string } | { kind: 'forbidden' | 'authentication_changed' }> {
    if (!Number.isSafeInteger(resourceId) || resourceId <= 0 || resourceId > 2147483647) return { kind: 'forbidden' }
    const child = operationType === 'delete_snapshot'
      ? await tx.snapshot.findUnique({ where: { id: resourceId }, select: { instanceId: true } })
      : operationType === 'delete_backup'
        ? await tx.backup.findUnique({ where: { id: resourceId }, select: { instanceId: true } }) : null
    if (['delete_snapshot', 'delete_backup'].includes(operationType) && !child) return { kind: 'forbidden' }
    const instanceId = child?.instanceId ?? resourceId
    await tx.$queryRaw`SELECT id FROM instances WHERE id = ${instanceId} FOR SHARE`
    const instance = await tx.instance.findUnique({ where: { id: instanceId }, select: {
      userId: true, hostId: true, status: true, incusId: true, createdAt: true
    } })
    if (!instance || instance.status === 'deleted') return { kind: 'forbidden' }
    await tx.$queryRaw`SELECT id FROM hosts WHERE id = ${instance.hostId} FOR SHARE`
    const host = await tx.host.findUnique({ where: { id: instance.hostId } })
    if (!host) return { kind: 'forbidden' }
    let childIdentity: unknown = null
    if (operationType === 'delete_snapshot') {
      await tx.$queryRaw`SELECT id FROM snapshots WHERE id = ${resourceId} FOR SHARE`
      const snapshot = await tx.snapshot.findUnique({ where: { id: resourceId }, select: { instanceId: true, incusName: true, createdAt: true } })
      if (snapshot?.instanceId !== instanceId) return { kind: 'forbidden' }
      childIdentity = [snapshot.instanceId, snapshot.incusName, snapshot.createdAt.toISOString()]
    } else if (operationType === 'delete_backup') {
      await tx.$queryRaw`SELECT id FROM backups WHERE id = ${resourceId} FOR SHARE`
      const backup = await tx.backup.findUnique({ where: { id: resourceId }, select: { instanceId: true, status: true, incusName: true, createdAt: true } })
      if (backup?.instanceId !== instanceId || backup.status === 'deleted') return { kind: 'forbidden' }
      childIdentity = [backup.instanceId, backup.incusName, backup.createdAt.toISOString()]
    }
    if (!await authorizeUserWrite(tx, actor.id, actor)) return { kind: 'authentication_changed' }
    const owner = instance.userId === actor.id
    const role = (await tx.user.findUniqueOrThrow({ where: { id: actor.id }, select: { role: true } })).role
    const admin = role === 'admin'
    const allowed = operationType === 'reinstall_instance' || operationType === 'recreate_instance' ? owner
      : operationType === 'transfer_instance' ? owner || admin : owner || admin || host.userId === actor.id
    if (!allowed) return { kind: 'forbidden' }
    return { kind: 'allowed', binding: createHash('sha256').update(JSON.stringify([
      operationType, resourceId, instanceId, instance.userId, instance.hostId, instance.incusId,
      instance.createdAt.toISOString(), transferHostIdentity(host), childIdentity, role
    ])).digest('hex') }
}
