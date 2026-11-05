import type { Prisma } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { INSTANCE_OPERATION_LOCK_NAMESPACE, tryAdvisoryTransactionLock } from '../db/advisory-locks.js'
import { hasActiveTransferWorkflow } from '../db/transfers.js'
import { assertNoPendingSnapshotOperations } from '../db/snapshot-operation-guards.js'
import { assertNoPendingProxySiteOperations } from '../db/proxy-site-operation-guards.js'
import { getIncusClient } from '../lib/incus/incus-pool.js'
import { execWithOutput } from '../lib/incus/incus-instances.js'
import { IncusClient } from '../lib/incus/incus-client.js'
import { managedCleanupEndpointHash } from '../lib/managed-cleanup-identity.js'
import { alpineSshSecurityInspection, alpineSshSecurityScript, assertAlpineSshSecurityInspection } from '../lib/alpine-ssh-security.js'
import { checkSshLogin, holdCustomerSshSession } from '../lib/dedicated-ssh.js'
import { decryptSensitiveData } from '../lib/security.js'
import { recoveryHeld } from './platform-backup-core.js'
import { createLog } from '../db/logs.js'
import { authorizeUserWrite, type WriteSession } from '../db/user-write-authorization.js'

type Inspection = { alpine: boolean; fixed: boolean; fingerprints: string[] }
export function readAlpineSshInspection(output: string): Inspection {
  const markers = output.match(/^INCUDAL_(?:ALPINE_SSH_(?:FIXED|UNPATCHED)|SSH_NOT_ALPINE)$/gm)
  if (markers?.length !== 1) throw new Error('ALPINE_SSH_INSPECTION_FAILED')
  const alpine = /^INCUDAL_ALPINE_SSH_(FIXED|UNPATCHED)$/m.test(output)
  const fixed = /^INCUDAL_ALPINE_SSH_FIXED$/m.test(output)
  if (!alpine && !/^INCUDAL_SSH_NOT_ALPINE$/m.test(output)) throw new Error('ALPINE_SSH_INSPECTION_FAILED')
  const fingerprints = output.match(/SHA256:[A-Za-z0-9+/]+/g) || []
  if (!fingerprints.length) throw new Error('ALPINE_SSH_IDENTITY_MISSING')
  return { alpine, fixed, fingerprints }
}
const inspectionCommand = `${alpineSshSecurityInspection}
for key in /etc/ssh/ssh_host_ed25519_key.pub /etc/ssh/ssh_host_ecdsa_key.pub /etc/ssh/ssh_host_rsa_key.pub; do
  [ ! -f "$key" ] || ssh-keygen -lf "$key" -E sha256
done`

export const alpineSshMaintenanceDependencies = {
  connect: getIncusClient,
  inspect: async (client: IncusClient, name: string) => readAlpineSshInspection(
    (await execWithOutput(client, name, ['sh', '-c', inspectionCommand], {}, 10000)).stdout),
  update: async (client: IncusClient, name: string) => {
    const result = await execWithOutput(client, name, ['timeout', '-s', 'TERM', '-k', '3', '85', 'sh', '-c',
      `${alpineSshSecurityScript}\nalpine_ssh_security_update update`], {}, 90000)
    if ((result.metadata as { return?: number } | null)?.return !== 0 ||
      !/^INCUDAL_ALPINE_SSH_(PATCH_INSTALLED|ALREADY_FIXED)$/m.test(result.stdout)) throw new Error('ALPINE_SSH_UPDATE_FAILED')
  },
  hold: holdCustomerSshSession,
  login: checkSshLogin
}
export type AlpineSshMaintenanceResult = { instanceId: number; status: 'verified' | 'already-fixed' | 'not-alpine'; passwordLoginPreserved: true }

/** Explicit admin maintenance, one bounded target at a time. No startup/OTA
 * scanner changes customer systems. Every retry rechecks current authorization,
 * target identity and conflicts. A stored receipt never bypasses these gates.
 */
export async function maintainAlpineCustomerSsh(instanceId: number, actorId: number,
  deps = alpineSshMaintenanceDependencies, actorSession?: WriteSession): Promise<AlpineSshMaintenanceResult> {
  let hostId = 0
  try {
    const result = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '3s'`
      if (recoveryHeld()) throw new Error('ALPINE_SSH_RECOVERY_HELD')
      if (!await tryAdvisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, instanceId)) throw new Error('ALPINE_SSH_INSTANCE_BUSY')
      await tx.$queryRaw`SELECT id FROM instances WHERE id = ${instanceId} FOR UPDATE`
      const instance = await tx.instance.findUniqueOrThrow({ where: { id: instanceId } })
      hostId = instance.hostId
      await tx.$queryRaw`SELECT id FROM hosts WHERE id = ${hostId} FOR SHARE`
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${actorId} FOR SHARE`
      if (actorSession && !await authorizeUserWrite(tx, actorId, actorSession)) throw new Error('ALPINE_SSH_ADMIN_REQUIRED')
      const actor = await tx.user.findUnique({ where: { id: actorId }, select: { role: true, status: true } })
      if (actor?.role !== 'admin' || actor.status !== 'active') throw new Error('ALPINE_SSH_ADMIN_REQUIRED')
      const host = await tx.host.findUniqueOrThrow({ where: { id: hostId }, select: {
        id: true, url: true, singleTenant: true, isInstalled: true, poolFaulted: true, publicIpSyncBlocked: true,
        serverCertificate: true, serverFingerprint: true, natPublicIp: true,
        onboardingNode: { select: { status: true, managementIp: true } }
      } })
      if (!host.singleTenant || !host.isInstalled || host.poolFaulted || host.publicIpSyncBlocked ||
        !host.serverCertificate || !host.serverFingerprint || host.onboardingNode?.status !== 'succeeded' ||
        !host.onboardingNode.managementIp || !host.natPublicIp || !instance.dedicatedIpv4 || !instance.dedicatedNetworkReady ||
        instance.status !== 'running' || instance.provisioningCleanupPending || instance.deletionBillingPending || !instance.rootPassword) {
        throw new Error('ALPINE_SSH_TARGET_NOT_READY')
      }
      if (await hasActiveTransferWorkflow(instanceId, tx) ||
        await tx.instanceTask.count({ where: { instanceId, status: { in: ['PENDING', 'PROCESSING'] } } }) ||
        await tx.restoreTask.count({ where: { instanceId, status: { in: ['PENDING', 'PROCESSING'] } } }) ||
        await tx.backupUploadTask.count({ where: { instanceId, status: { in: ['PENDING', 'PROCESSING'] } } }) ||
        await tx.instanceTransfer.count({ where: { instanceId, status: { in: ['pending', 'processing'] } } })) throw new Error('ALPINE_SSH_INSTANCE_BUSY')
      try {
        await assertNoPendingSnapshotOperations(tx, instanceId)
        await assertNoPendingProxySiteOperations(tx, instanceId)
      } catch { throw new Error('ALPINE_SSH_INSTANCE_BUSY') }
      const client = await deps.connect(host, tx, 8000)
      const specs = (instance.snapshottedSpecs || {}) as Record<string, unknown>
      const identity = specs.managedCleanup as { attempt?: string; endpointHash?: string; uuid?: string } | undefined
      const remote = await client.request<{ name?: string; config?: Record<string, string> }>('GET', `/1.0/instances/${encodeURIComponent(instance.incusId)}`, null, 8000)
      const uuid = remote.config?.['volatile.uuid']
      if (!identity?.attempt || !/^[a-f0-9-]{36}$/i.test(identity.attempt) || identity.endpointHash !== managedCleanupEndpointHash(client) ||
        remote.name !== instance.incusId || remote.config?.['user.payincus.provisioning-attempt'] !== identity.attempt ||
        !uuid || !/^[a-f0-9-]{36}$/i.test(uuid) || identity.uuid !== uuid) throw new Error('ALPINE_SSH_INSTANCE_IDENTITY_CHANGED')
      const before = await deps.inspect(client, instance.incusId)
      if (!before.alpine) return { instanceId, status: 'not-alpine' as const, passwordLoginPreserved: true as const }
      const password = decryptSensitiveData(instance.rootPassword)
      if (!password) throw new Error('ALPINE_SSH_PASSWORD_UNAVAILABLE')
      const session = await deps.hold(host.natPublicIp, password, before.fingerprints, instance.sshPort || 22)
      try {
        if (recoveryHeld()) throw new Error('ALPINE_SSH_RECOVERY_HELD')
        // Even a previously installed package must verify the running listener;
        // a failed reload must not turn a retry into a false already-fixed result.
        await deps.update(client, instance.incusId)
        const after = await deps.inspect(client, instance.incusId)
        assertAlpineSshSecurityInspection(after.alpine && after.fixed ? 'INCUDAL_ALPINE_SSH_FIXED' : '')
        if (JSON.stringify([...before.fingerprints].sort()) !== JSON.stringify([...after.fingerprints].sort())) throw new Error('ALPINE_SSH_INSTANCE_IDENTITY_CHANGED')
        await session.verify()
        await deps.login(host.natPublicIp, password, before.fingerprints, instance.sshPort || 22)
        if (recoveryHeld()) throw new Error('ALPINE_SSH_RECOVERY_HELD')
        await tx.instance.update({ where: { id: instanceId }, data: { snapshottedSpecs: {
          ...specs, alpineSshSecurity: { status: 'verified', checkedAt: new Date().toISOString(), remoteUuid: uuid, passwordLoginPreserved: true }
        } as Prisma.InputJsonValue } })
        return { instanceId, status: before.fixed ? 'already-fixed' as const : 'verified' as const, passwordLoginPreserved: true as const }
      } finally { session.close() }
    }, { maxWait: 5000, timeout: 210000 })
    await createLog(actorId, 'instance', 'instance.ssh_security', result.status === 'not-alpine'
      ? `实例 #${instanceId}：SSH 安全检查不适用，实际系统不是 Alpine，未更新客户系统`
      : `实例 #${instanceId}：Alpine SSH 检查通过，原密码登录、原身份及验证连接保持`, 'success', { instanceId })
    return result
  } catch (error) {
    const code = error instanceof Error && /^ALPINE_SSH_[A-Z_]+$/.test(error.message) ? error.message : 'ALPINE_SSH_VERIFICATION_FAILED'
    const reasons: Record<string, string> = {
      ALPINE_SSH_ADMIN_REQUIRED: '管理员权限或会话已失效', ALPINE_SSH_RECOVERY_HELD: '平台恢复保护已开启',
      ALPINE_SSH_INSTANCE_BUSY: '实例有其他未完成操作', ALPINE_SSH_TARGET_NOT_READY: '原管理连接或实例尚未就绪',
      ALPINE_SSH_INSTANCE_IDENTITY_CHANGED: '远端实例与原登记身份不一致', ALPINE_SSH_UPDATE_FAILED: '官方补丁安装或服务重载未完成',
      ALPINE_SSH_PASSWORD_UNAVAILABLE: '原客户密码不可用', ALPINE_SSH_VERIFICATION_FAILED: '原连接或新密码登录未通过验证'
    }
    await createLog(actorId, 'instance', 'instance.ssh_security', `宿主 #${hostId} / 实例 #${instanceId}：SSH 安全维护未完成，${reasons[code] || '安全检查未通过'}。未重置密码；未完成的补丁或运行状态保留，条件恢复后可重新执行`, 'error', { instanceId }).catch(() => {})
    throw new Error(code)
  }
}
