import { prisma } from './prisma.js'
import { INSTANCE_OPERATION_LOCK_NAMESPACE, tryAdvisoryTransactionLock } from './advisory-locks.js'
import { authorizeUserWrite, type WriteActor } from './user-write-authorization.js'
import { hasActiveTransferWorkflow } from './transfers.js'
import type { Host, Instance } from '../types/database.js'

/** Keep the original target and current authorization fixed through initial dispatch. */
export async function withTerminalOpeningAuthorization<T>(
  expected: Instance, originalHost: Host, actor: WriteActor & { role: string },
  instanceType: 'container' | 'vm', open: () => Promise<T>
): Promise<T> {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`
    if (!await tryAdvisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, expected.id)) {
      throw new Error('TERMINAL_INSTANCE_BUSY')
    }
    await tx.$queryRaw`SELECT id FROM instances WHERE id = ${expected.id} FOR UPDATE`
    const instance = await tx.instance.findUnique({ where: { id: expected.id } })
    if (!instance || instance.userId !== expected.user_id || instance.hostId !== expected.host_id ||
      instance.incusId !== expected.incus_id || instance.createdAt.toISOString() !== expected.created_at ||
      instance.packageId !== expected.package_id || instance.status !== 'running' ||
      instance.provisioningCleanupPending || instance.deletionBillingPending) {
      throw new Error('TERMINAL_INSTANCE_CHANGED')
    }
    await tx.$queryRaw`SELECT id FROM hosts WHERE id = ${instance.hostId} FOR SHARE`
    const host = await tx.host.findUnique({ where: { id: instance.hostId } })
    if (!host || host.id !== originalHost.id || host.userId !== originalHost.user_id || host.url !== originalHost.url ||
      host.certPath !== originalHost.cert_path || host.keyPath !== originalHost.key_path ||
      host.createdAt.toISOString() !== originalHost.created_at) {
      throw new Error('TERMINAL_HOST_CHANGED')
    }
    if (!await authorizeUserWrite(tx, actor.id, actor)) throw new Error('TERMINAL_SESSION_INVALIDATED')
    const user = await tx.user.findUniqueOrThrow({ where: { id: actor.id }, select: { role: true } })
    if (user.role !== actor.role || user.role !== 'admin' && instance.userId !== actor.id && host.userId !== actor.id) {
      throw new Error('TERMINAL_FORBIDDEN')
    }
    if (await hasActiveTransferWorkflow(instance.id, tx) ||
      await tx.instanceTransfer.count({ where: { instanceId: instance.id, status: { in: ['pending', 'processing'] } } })) {
      throw new Error('TERMINAL_INSTANCE_BUSY')
    }
    if (instance.packageId) await tx.$queryRaw`SELECT id FROM packages WHERE id = ${instance.packageId} FOR SHARE`
    const pkg = instance.packageId ? await tx.package.findUnique({ where: { id: instance.packageId } }) : null
    if ((pkg?.instanceType === 'vm' ? 'vm' : 'container') !== instanceType) throw new Error('TERMINAL_INSTANCE_CHANGED')
    return open()
  }, { maxWait: 5000, timeout: 25000 })
}
