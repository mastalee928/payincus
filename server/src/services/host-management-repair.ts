import { Prisma } from '@prisma/client'
import { OnboardingError } from '../lib/host-onboarding.js'
import { prisma } from '../db/prisma.js'
import { IncusClient } from '../lib/incus/incus-client.js'
import { panelCertificatePaths } from '../lib/incus/certificate-paths.js'
import { transferHostIdentity } from '../lib/transfer-host-identity.js'
import { decryptSensitiveData } from '../lib/security.js'
import { hashAgentSecret, isValidAgentSecret } from '../lib/agent-auth.js'
import { repairGatewayHostAgent } from './onboarding-ssh.js'
import { recoveryHeld } from './platform-backup-core.js'
import { recoveryScope } from './host-pool-recovery.js'
import { automaticOperationAudit } from '../lib/automatic-operation-audit.js'

export type ManagementRepairState = { status: 'retry' | 'waiting-heartbeat' | 'done' | 'blocked'; attempts: number; checkedAt: string; nextAttemptAt?: string; error?: string; agentId?: string }
type RepairState = ManagementRepairState
const json = (state: RepairState) => state as unknown as Prisma.InputJsonValue
const include = { onboardingNode: { include: { batch: true } }, agent: true } as const
export function managementRepairView(value: unknown) {
  const state = value as Partial<ManagementRepairState> | null
  if (!state || !['retry', 'waiting-heartbeat', 'done', 'blocked'].includes(state.status || '')) return null
  return { status: state.status!, attempts: Number.isSafeInteger(state.attempts) ? state.attempts! : 0,
    checkedAt: typeof state.checkedAt === 'string' ? state.checkedAt : null,
    nextAttemptAt: typeof state.nextAttemptAt === 'string' ? state.nextAttemptAt : null,
    error: typeof state.error === 'string' && /^[A-Z_]{1,100}$/.test(state.error) ? state.error : null }
}
export const managementRepairDependencies = {
  async verify(host: { url: string; serverCertificate: string | null; serverFingerprint: string | null }, signal: AbortSignal) {
    if (!host.serverCertificate || !host.serverFingerprint) throw new Error('HOST_TLS_IDENTITY_MISSING')
    const client = new IncusClient({ ...host, ...panelCertificatePaths() })
    try {
      client.agent = client.createTransport({ connectTimeout: 8000, headersTimeout: 8000, bodyTimeout: 8000 })
      const info = await client.request<{ auth?: string }>('GET', '/1.0', null, 8000, signal)
      if (info.auth !== 'trusted') throw new Error('HOST_TLS_NOT_TRUSTED')
    } finally { await client.close() }
  },
  repairAgent: repairGatewayHostAgent
}

/** Repair only established onboarding identities. No new trust, credentials,
 * customer operations or inventory release is granted by this worker. */
export async function repairHostManagement(hostId: number, deps = managementRepairDependencies): Promise<void> {
  if (recoveryHeld()) return
  let attempted = false
  let originalIdentity = ''
  let attempts = 0
  let originalState: Prisma.JsonValue | null = null
  let attemptedAgentId: string | undefined
  let auditActorId = 0
  let step = '核对原授权和宿主绑定'
  const scope = recoveryScope(55000)
  const signal = scope.signal
  try {
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '2s'`
      await tx.$queryRaw`SELECT id FROM hosts WHERE id = ${hostId} FOR UPDATE`
      const host = await tx.host.findUnique({ where: { id: hostId }, include })
      const node = host?.onboardingNode
      if (!host || !host.isInstalled || !host.singleTenant || !node || node.deletedAt || node.status !== 'succeeded' || !node.managementIp || !node.sshFingerprint || !node.nodePublicKey ||
          host.managementSshHost !== node.managementIp || host.managementSshPort !== node.sshPort || recoveryHeld()) return
      const current = host.managementRepair as RepairState | null
      // Even a blocked repair is rechecked after backoff. A restored authority or
      // original trust can recover without an operator resetting internal state;
      // the same gates still run before every write.
      if (current?.nextAttemptAt && Date.parse(current.nextAttemptAt) > Date.now()) return
      const missingCertificate = !host.certPath || !host.keyPath
      const agent = host.agent
      // Legacy installer issuance clears version/heartbeat and leaves its token
      // unused. Do not resurrect explicit credential revocations or disabled agents.
      const legacyAgent = !!agent?.enabled && agent.status !== 'disabled' && agent.lastSeenAt === null && agent.version === null &&
        !!agent.installTokenHash && agent.installTokenUsedAt === null && !agent.installTokenKeepsIdentity
      const awaitingHeartbeat = current?.status === 'waiting-heartbeat' || (!!current?.agentId && current.status !== 'done')
      if (!missingCertificate && !legacyAgent && !awaitingHeartbeat) return
      attempted = true; originalIdentity = transferHostIdentity(host); originalState = host.managementRepair; attempts = (current?.attempts || 0) + 1
      auditActorId = node.batch.createdById
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${node.batch.createdById} FOR SHARE`
      const actor = await tx.user.findUnique({ where: { id: node.batch.createdById }, select: { role: true, status: true } })
      if (actor?.role !== 'admin' || actor.status !== 'active') throw new Error('HOST_REPAIR_AUTHORITY_CHANGED')
      await tx.$queryRaw`SELECT id FROM host_onboarding_nodes WHERE id = ${node.id} FOR SHARE`
      const enrolled = await tx.hostOnboardingNode.findUniqueOrThrow({ where: { id: node.id } })
      if (enrolled.status !== 'succeeded' || enrolled.deletedAt || enrolled.hostId !== hostId ||
          enrolled.managementIp !== node.managementIp || enrolled.sshFingerprint !== node.sshFingerprint || enrolled.nodePublicKey !== node.nodePublicKey) throw new Error('HOST_REPAIR_ENROLLMENT_CHANGED')
      if (host.installPending) throw new Error('HOST_REPAIR_BUSY')
      if (await tx.instanceTask.count({ where: { status: { in: ['PENDING', 'PROCESSING'] }, OR: [
        { hostId }, { targetHostId: hostId }, { replacementState: { path: ['sourceHostId'], equals: hostId } }
      ] } })) throw new Error('HOST_REPAIR_BUSY')
      if (awaitingHeartbeat && (!agent?.enabled || agent.status === 'disabled')) throw new Error('AGENT_REPAIR_DISABLED')
      if (awaitingHeartbeat && current?.agentId && agent?.agentId !== current.agentId) throw new Error('AGENT_REPAIR_IDENTITY_SUPERSEDED')
      if (awaitingHeartbeat && agent?.enabled && agent.lastSeenAt && agent.lastSeenAt.getTime() > Date.now() - 90000) {
        step = '核验受信连接与 Agent 心跳'
        await scope.run(() => deps.verify(host, signal), 10000)
        await tx.host.update({ where: { id: hostId }, data: { managementRepair: json({ status: 'done', attempts,
          checkedAt: new Date().toISOString() }), ...(missingCertificate ? panelCertificatePaths() : {}) } })
        await tx.log.create({ data: { userId: node.batch.createdById, module: 'host', action: 'host.management.repaired', result: 'success',
          content: automaticOperationAudit({ hostId, hostName: host.name, stage: step, attempt: attempts, result: '恢复成功；原身份与当前心跳均已核验' }) } })
        return
      }
      if (!missingCertificate && !legacyAgent) throw new Error('AGENT_REPAIR_IDENTITY_SUPERSEDED')
      step = '核验原 TLS 管理连接'
      await scope.run(() => deps.verify(host, signal), 10000)
      if (legacyAgent && agent) {
        step = '对齐原管理通道下的 Agent 认证配置'
        attemptedAgentId = agent.agentId
        // Host row lock serializes issuance, explicit revocation and heartbeat;
        // never publish credentials for an identity superseded mid-repair.
        const secret = decryptSensitiveData(agent.secretEncrypted)
        if (!secret || !isValidAgentSecret(secret) || hashAgentSecret(secret) !== agent.secretHash) throw new Error('AGENT_REPAIR_SECRET_INVALID')
        scope.remaining(); if (recoveryHeld()) throw new Error('PLATFORM_RECOVERY_HELD')
        await scope.run(() => deps.repairAgent(node.id, { sshPort: node.sshPort, sshFingerprint: node.sshFingerprint!,
          nodePublicKey: node.nodePublicKey!, agentId: agent.agentId, agentSecret: secret,
          expiresAt: Date.now() + Math.min(25000, scope.remaining() - 8000) }, signal), Math.max(1, scope.remaining() - 4000))
      }
      scope.remaining(); if (recoveryHeld()) throw new Error('PLATFORM_RECOVERY_HELD')
      await tx.host.update({ where: { id: hostId }, data: {
        ...(missingCertificate ? panelCertificatePaths() : {}),
        managementRepair: json({ status: legacyAgent ? 'waiting-heartbeat' : 'done', attempts,
          checkedAt: new Date().toISOString(), agentId: attemptedAgentId, nextAttemptAt: new Date(Date.now() + 120000).toISOString() })
      } })
      await tx.log.create({ data: { userId: node.batch.createdById, module: 'host', action: 'host.management.repair_applied', result: 'success',
        content: automaticOperationAudit({ hostId, hostName: host.name, stage: step, attempt: attempts,
          result: `修复已执行；补齐证书引用=${missingCertificate}；对齐 Agent 配置=${legacyAgent}；${legacyAgent ? '后台继续核验心跳' : '原管理连接已核验'}；客户机器保持原状`,
          nextAttemptAt: legacyAgent ? new Date(Date.now() + 120000).toISOString() : undefined }) } })
    }, { timeout: 59000, maxWait: 2000 })
  } catch (error) {
    if (attempted) await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM hosts WHERE id = ${hostId} FOR UPDATE`
      const host = await tx.host.findUnique({ where: { id: hostId } })
      if (!host || transferHostIdentity(host) !== originalIdentity || JSON.stringify(host.managementRepair) !== JSON.stringify(originalState)) return
      const code = error instanceof OnboardingError ? error.code : error instanceof Error && /^(HOST_|AGENT_|PLATFORM_)/.test(error.message) && /^[A-Z_]{1,100}$/.test(error.message)
        ? error.message : 'HOST_MANAGEMENT_REPAIR_RETRY'
      const blocked = /IDENTITY_CHANGED|AUTHORITY_CHANGED|ENROLLMENT_CHANGED|SECRET_INVALID|NOT_TRUSTED|IDENTITY_MISSING|DISABLED|SUPERSEDED/.test(code)
      const nextAttemptAt = new Date(Date.now() + Math.min(1800000, 30000 * 2 ** Math.min(attempts, 6))).toISOString()
      await tx.host.update({ where: { id: hostId }, data: { managementRepair: json({ status: blocked ? 'blocked' : 'retry', attempts,
        checkedAt: new Date().toISOString(), nextAttemptAt,
        error: code, agentId: attemptedAgentId || (originalState as RepairState | null)?.agentId }) } })
      await tx.log.create({ data: { userId: auditActorId, module: 'host', action: 'host.management.repair_retry', result: 'warning',
        content: automaticOperationAudit({ hostId, hostName: host.name, stage: step, attempt: attempts,
          result: blocked ? '核验未通过；保留身份与客户保护，后台继续复核' : '修复暂未完成；已安排自动重连重试', error: code, nextAttemptAt }) } })
    })
  } finally { scope.close() }
}

let managementCursor = 0
export async function repairHostManagementQueue(deps = managementRepairDependencies): Promise<void> {
  const hosts = await prisma.host.findMany({ where: { singleTenant: true, isInstalled: true, onboardingNode: { is: { status: 'succeeded', deletedAt: null } },
    OR: [{ certPath: null }, { keyPath: null }, { agent: { is: { enabled: true, lastSeenAt: null, version: null, installTokenHash: { not: null }, installTokenUsedAt: null, installTokenKeepsIdentity: false } } },
      ...['waiting-heartbeat', 'retry', 'blocked'].map(status => ({ managementRepair: { path: ['status'], equals: status } }))] }, orderBy: { id: 'asc' }, select: { id: true, managementRepair: true } })
  const due = hosts.filter(host => {
    const next = (host.managementRepair as RepairState | null)?.nextAttemptAt
    return !next || Date.parse(next) <= Date.now()
  })
  const rotated = [...due.filter(host => host.id > managementCursor), ...due.filter(host => host.id <= managementCursor)]
  for (const host of rotated.slice(0, 5)) {
    if (recoveryHeld()) return
    managementCursor = host.id
    try { await repairHostManagement(host.id, deps) } catch { console.warn(`[HostRepair] Host #${host.id} retry could not be saved; next host continues`) }
  }
}
