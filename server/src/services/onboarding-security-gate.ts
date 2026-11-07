import { prisma } from '../db/prisma.js'
import { SECURITY_HARDENING_ENABLED_KEY, SECURITY_HARDENING_REVISION } from '../lib/security-hardening.js'
import { hardeningIdentityHash } from '../lib/hardening-identity.js'
import { recoveryHeld } from './platform-backup-core.js'
import { hostMaintenanceBlocked } from '../lib/host-maintenance-gate.js'

/** Completion consumes a current receipt under both row locks. No credentials
 * are cleared and no success is published when the original lease was lost. */
export async function finishSecureOnboarding(nodeId: string, leaseToken: string, hostId: number) {
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM hosts WHERE id = ${hostId} FOR UPDATE`
    await tx.$queryRaw`SELECT id FROM host_onboarding_nodes WHERE id = ${nodeId} FOR UPDATE`
    const node = await tx.hostOnboardingNode.findUnique({ where: { id: nodeId } })
    const host = await tx.host.findUnique({ where: { id: hostId }, include: { agent: true, onboardingNode: { include: { batch: true } } } })
    if (!node || node.deletedAt || node.hostId !== hostId || node.status !== 'running' || node.step !== 'hardening' ||
      node.leaseToken !== leaseToken || !node.leaseUntil || node.leaseUntil <= new Date()) throw new Error('WORKER_INTERRUPTED')
    if (recoveryHeld()) throw new Error('HARDENING_RECOVERY_HELD')
    await tx.$queryRaw`SELECT id FROM host_onboarding_batches WHERE id = ${node.batchId} FOR SHARE`
    const actorId = (await tx.hostOnboardingBatch.findUniqueOrThrow({ where: { id: node.batchId } })).createdById
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${actorId} FOR SHARE`
    await tx.$queryRaw`SELECT id FROM system_configs WHERE key = ${SECURITY_HARDENING_ENABLED_KEY} FOR SHARE`
    if (!['true','1'].includes((await tx.systemConfig.findUnique({ where: { key: SECURITY_HARDENING_ENABLED_KEY } }))?.value || '')) throw new Error('HARDENING_DISABLED')
    const actor = await tx.user.findUnique({ where: { id: actorId } })
    if (actor?.role !== 'admin' || actor.status !== 'active') throw new Error('HARDENING_ADMIN_REQUIRED')
    const state = host?.securityHardening as { revision?: string; status?: string; phase?: string; nextCheckAt?: string; identityHash?: string } | null
    if (!host || hostMaintenanceBlocked(host.securityHardening) || host.status !== 'online' || !host.singleTenant || !host.isInstalled ||
      host.installPending || host.poolFaulted || host.publicIpSyncBlocked || !host.serverCertificate || !host.serverFingerprint ||
      host.managementSshHost !== node.managementIp || host.managementSshPort !== node.sshPort || host.managementSshUser !== 'root' ||
      !node.nodePublicKey || !node.sshFingerprint || !host.agent?.enabled || !host.agent.lastSeenAt ||
      Date.now() - host.agent.lastSeenAt.getTime() >= 90000 || state?.revision !== SECURITY_HARDENING_REVISION ||
      state.status !== 'verified' || state.identityHash !== hardeningIdentityHash(host) || state.phase !== 'finished' ||
      !state.nextCheckAt || !(Date.parse(state.nextCheckAt) > Date.now())) {
      throw new Error('HARDENING_ONBOARDING_PENDING')
    }
    if (await tx.instance.count({ where: { hostId, OR: [{ status: { not: 'deleted' } }, { provisioningCleanupPending: true }, { deletionBillingPending: true }] } }) ||
      await tx.checkoutReservation.count({ where: { hostId } }) ||
      await tx.instanceTask.count({ where: { status: { in: ['PENDING','PROCESSING'] }, OR: [{ hostId }, { targetHostId: hostId }] } })) {
      throw new Error('HARDENING_BUSY')
    }
    await tx.hostOnboardingNode.update({ where: { id: nodeId }, data: { step: 'done', status: 'succeeded',
      credentialsEncrypted: null, completedAt: new Date(), leaseUntil: null, leaseToken: null } })
  }, { maxWait: 3000, timeout: 8000 })
}
