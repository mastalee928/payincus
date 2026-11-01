import { Prisma, type Host } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { prisma } from '../db/prisma.js'
import { getIncusClient } from '../lib/incus/incus-pool.js'
import { removeDedicatedForward } from '../lib/incus/dedicated-network.js'
import { verifyInstanceAbsent, verifyInstanceDeleted } from '../lib/incus/verify-instance-deleted.js'
import { HOST_OCCUPIED_INSTANCE_WHERE } from '../lib/host-resource-usage.js'
import { transferHostIdentity } from '../lib/transfer-host-identity.js'
import { recoveryHeld } from './platform-backup-core.js'
import { inspectPoolRecovery, recoveryScope, type RecoveryInstance } from './host-pool-recovery.js'
import { redactAuditText } from '../lib/risk-audit.js'
import { automaticOperationAudit } from '../lib/automatic-operation-audit.js'

export type PoolCleanup = {
  version: 1; kind: 'replacement' | 'failed_target' | 'verify_empty'; name: string; actorId: number; hostIdentity: string; revision: string
  createdBefore: string; createdAfter?: string; taskId?: number; uuid?: string; createdAt?: string; marker?: string
  status: 'pending' | 'retry' | 'blocked' | 'done'; attempts: number; nextAttemptAt?: string
  error?: string; finishedAt?: string
}
export function poolCleanupRecord(host: Host, name: string, actorId: number, createdBefore: Date, taskId?: number): PoolCleanup {
  return { version: 1, kind: taskId ? 'replacement' : 'verify_empty', name, actorId,
    hostIdentity: transferHostIdentity(host), revision: randomUUID(), createdBefore: createdBefore.toISOString(), taskId, status: 'pending', attempts: 0 }
}
export function readPoolCleanup(value: unknown): PoolCleanup | null {
  const state = value as PoolCleanup | null
  return state?.version === 1 && ['replacement', 'failed_target', 'verify_empty'].includes(state.kind) && typeof state.name === 'string' &&
    typeof state.hostIdentity === 'string' && typeof state.revision === 'string' && Number.isSafeInteger(state.actorId) && Number.isFinite(Date.parse(state.createdBefore)) &&
    (!state.createdAfter || Number.isFinite(Date.parse(state.createdAfter))) &&
    ['pending', 'retry', 'blocked', 'done'].includes(state.status) && Number.isSafeInteger(state.attempts) ? state : null
}
const json = (state: PoolCleanup) => state as unknown as Prisma.InputJsonValue
const retryable = new Set(['offline', 'agent-offline', 'busy', 'unreachable', 'protocol-pending'])
class CleanupBlocked extends Error {}
class CleanupWaiting extends Error {}
let running = false

/** A verified deletion can release a healthy pool host after read-only empty-host checks.
 * Persist this before the final DB bookkeeping, but never repeat customer deletion here. */
export async function queueDeletedPoolHost(instanceId: number): Promise<void> {
  await prisma.$transaction(async tx => {
    const instance = await tx.instance.findUniqueOrThrow({ where: { id: instanceId } })
    await tx.$queryRaw`SELECT id FROM hosts WHERE id = ${instance.hostId} FOR UPDATE`
    const host = await tx.host.findUniqueOrThrow({ where: { id: instance.hostId } })
    if (!host.singleTenant || instance.status !== 'deleted') return
    const existing = readPoolCleanup(host.poolCleanup)
    if (existing && existing.status !== 'done') return
    await tx.host.update({ where: { id: host.id }, data: { poolFaulted: true,
      poolCleanup: json(poolCleanupRecord(host, instance.incusId, host.userId, new Date())) } })
  })
}

export async function retryPoolCleanup(hostId: number, actorId: number): Promise<void> {
  if (recoveryHeld()) throw new Error('PLATFORM_RECOVERY_HELD')
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM hosts WHERE id = ${hostId} FOR UPDATE`
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${actorId} FOR SHARE`
    const actor = await tx.user.findUnique({ where: { id: actorId }, select: { role: true, status: true } })
    if (actor?.role !== 'admin' || actor.status !== 'active') throw new Error('CLEANUP_ADMIN_AUTHORIZATION_CHANGED')
    const host = await tx.host.findUniqueOrThrow({ where: { id: hostId } })
    const state = readPoolCleanup(host.poolCleanup)
    if (!host.poolFaulted || !state || state.status === 'done') return
    // A retry grants a new attempt, never a new host/guest identity.
    await tx.host.update({ where: { id: hostId }, data: { poolCleanup: json({ ...state, actorId, revision: randomUUID(),
      status: 'pending', attempts: 0, error: undefined, nextAttemptAt: undefined }) } })
  })
}

/** Both phases hold the host row; persist the exact remote identity before issuing a stop/delete. */
export async function processPoolCleanup(hostId: number, connect = getIncusClient): Promise<void> {
  if (recoveryHeld()) return
  let attempt: PoolCleanup | undefined
  let step = '核对原身份、授权及占用'
  const scope = recoveryScope()
  try {
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM hosts WHERE id = ${hostId} FOR UPDATE`
      scope.remaining()
      if (recoveryHeld()) return
      const host = await tx.host.findUnique({ where: { id: hostId } })
      const state = readPoolCleanup(host?.poolCleanup)
      if (!host || !state || !['pending', 'retry', 'blocked'].includes(state.status) ||
          (state.nextAttemptAt && Date.parse(state.nextAttemptAt) > Date.now())) return
      attempt = { ...state, attempts: state.attempts + 1, status: 'retry', nextAttemptAt: new Date(Date.now() + 60000).toISOString() }
      if (!host.poolFaulted || transferHostIdentity(host) !== state.hostIdentity) throw new CleanupBlocked('HOST_IDENTITY_OR_QUARANTINE_CHANGED')
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${state.actorId} FOR SHARE`
      const actor = await tx.user.findUnique({ where: { id: state.actorId }, select: { role: true, status: true } })
      if (state.kind !== 'verify_empty' && (actor?.role !== 'admin' || actor.status !== 'active')) throw new CleanupBlocked('CLEANUP_ADMIN_AUTHORIZATION_CHANGED')
      const before = await inspectPoolRecovery(tx, hostId, connect, scope, state.kind !== 'verify_empty' ? state : undefined)
      if (before.report.mode !== 'empty' && !(state.kind === 'verify_empty' && before.report.canRecover)) {
        if (state.kind === 'verify_empty') throw new CleanupWaiting('DELETION_BOOKKEEPING_PENDING')
        throw new CleanupBlocked('HOST_ASSIGNED')
      }
      if (!before.report.canRecover) {
        const reason = before.report.blockers.join(',')
        if (before.report.blockers.some(blocker => !retryable.has(blocker))) throw new CleanupBlocked(reason)
        throw new CleanupWaiting(reason)
      }
      if (state.kind === 'verify_empty' && before.report.needsCleanup) throw new CleanupBlocked('UNEXPECTED_RESIDUE')
      const remote = before.instances[0]
      if (remote && state.kind !== 'verify_empty') {
        attempt.uuid = remote.config!['volatile.uuid']
        attempt.createdAt = remote.created_at
      }
      await tx.host.update({ where: { id: hostId }, data: { poolCleanup: json(attempt) } })
      await tx.log.create({ data: { userId: state.actorId, module: 'host', action: 'host.pool.cleanup_start', result: 'pending',
        content: automaticOperationAudit({ hostId, hostName: host.name, stage: step, attempt: attempt.attempts, result: `开始回收核验；目标 ${state.name || '当前宿主'}` }) } })
    }, { timeout: scope.remaining(), maxWait: Math.min(5000, scope.remaining()) })
    if (!attempt) return
    const claimed = attempt
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM hosts WHERE id = ${hostId} FOR UPDATE`
      scope.remaining()
      if (recoveryHeld()) throw new Error('PLATFORM_RECOVERY_HELD')
      const host = await tx.host.findUniqueOrThrow({ where: { id: hostId } })
      const state = readPoolCleanup(host.poolCleanup)
      if (!state || state.status !== 'retry' || state.attempts !== claimed.attempts || state.name !== claimed.name ||
          state.revision !== claimed.revision || state.hostIdentity !== claimed.hostIdentity || state.uuid !== claimed.uuid || state.createdAt !== claimed.createdAt) return
      if (!host.poolFaulted || transferHostIdentity(host) !== state.hostIdentity) throw new CleanupBlocked('HOST_IDENTITY_OR_QUARANTINE_CHANGED')
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${state.actorId} FOR SHARE`
      const actor = await tx.user.findUnique({ where: { id: state.actorId }, select: { role: true, status: true } })
      if (state.kind !== 'verify_empty' && (actor?.role !== 'admin' || actor.status !== 'active')) throw new CleanupBlocked('CLEANUP_ADMIN_AUTHORIZATION_CHANGED')
      const before = await inspectPoolRecovery(tx, hostId, connect, scope, state.kind !== 'verify_empty' ? state : undefined)
      if (before.report.mode !== 'empty' && !(state.kind === 'verify_empty' && before.report.canRecover)) {
        if (state.kind === 'verify_empty') throw new CleanupWaiting('DELETION_BOOKKEEPING_PENDING')
        throw new CleanupBlocked('HOST_ASSIGNED')
      }
      if (!before.report.canRecover || !before.client) {
        const reason = before.report.blockers.join(',')
        if (before.report.blockers.some(blocker => !retryable.has(blocker))) throw new CleanupBlocked(reason)
        throw new CleanupWaiting(reason || 'REMOTE_UNREACHABLE')
      }
      if (state.kind === 'verify_empty' && before.report.needsCleanup) throw new CleanupBlocked('UNEXPECTED_RESIDUE')
      const client = before.client
      for (const remote of state.kind === 'verify_empty' ? [] : before.instances) {
        const path = `/1.0/instances/${encodeURIComponent(remote.name)}`
        const assertIdentity = (current: RecoveryInstance) => {
          if (current.name !== state.name || current.config?.['volatile.uuid'] !== state.uuid || current.created_at !== state.createdAt ||
              (current.project || 'default') !== 'default') throw new CleanupBlocked('OLD_INSTANCE_IDENTITY_CHANGED')
          if (recoveryHeld()) throw new Error('PLATFORM_RECOVERY_HELD')
        }
        const current = await client.request<RecoveryInstance>('GET', path)
        assertIdentity(current)
        if (recoveryHeld()) throw new Error('PLATFORM_RECOVERY_HELD')
        step = '停止原遗留实例'
        if (current.status !== 'Stopped') await client.request('PUT', `${path}/state`, { action: 'stop', force: true, timeout: 5 })
        const stopped = await client.request<RecoveryInstance>('GET', path)
        assertIdentity(stopped)
        if (stopped.status !== 'Stopped') throw new Error('OLD_INSTANCE_STOP_NOT_VERIFIED')
        step = '删除原遗留实例'
        await client.request('DELETE', path)
      }
      if (state.kind !== 'verify_empty') {
        if (recoveryHeld()) throw new Error('PLATFORM_RECOVERY_HELD')
        await verifyInstanceAbsent(client, state.name)
        step = '清理原公网转发并核验磁盘和快照释放'
        await removeDedicatedForward(client, state.name)
        await verifyInstanceDeleted(client, state.name)
      }
      step = '核验宿主与库存恢复条件'
      const after = await inspectPoolRecovery(tx, hostId, connect, scope, state.kind !== 'verify_empty' ? state : undefined)
      if (after.report.mode !== before.report.mode || !after.report.canRecover || after.report.needsCleanup) throw new Error('HOST_EMPTY_STATE_NOT_VERIFIED')
      scope.remaining()
      if (recoveryHeld()) throw new Error('PLATFORM_RECOVERY_HELD')
      if (state.taskId && (state.kind === 'failed_target' || (state.kind === 'verify_empty' && after.report.mode === 'empty'))) {
        const task = await tx.instanceTask.findUnique({ where: { id: state.taskId }, include: { instance: { select: { hostId: true } } } })
        if (task && task.targetHostId === hostId && task.instance.hostId !== hostId && ['FAILED', 'CANCELLED'].includes(task.status)) {
          await tx.ipAddress.deleteMany({ where: { hostId, instanceId: task.instanceId } })
          await tx.instanceTask.update({ where: { id: task.id }, data: { replacementState: {
            ...(task.replacementState as Record<string, unknown>), stage: 'cleaned', targetCleanupVerified: true
          } as Prisma.InputJsonValue } })
        }
      }
      await tx.host.update({ where: { id: hostId }, data: { poolFaulted: false,
        ...(after.report.mode === 'empty' ? { cpuUsed: 0, memoryUsed: 0, diskUsed: 0, natPortsUsedCount: 0 } : {}),
        poolCleanup: json({ ...state, status: 'done', nextAttemptAt: undefined, error: undefined, finishedAt: new Date().toISOString() }) } })
      await tx.log.create({ data: { userId: state.actorId, module: 'host', action: 'host.pool.cleanup_complete', result: 'success',
        content: automaticOperationAudit({ hostId, hostName: host.name, stage: step, attempt: state.attempts,
          result: after.report.mode === 'empty' ? '回收成功；实例、磁盘、快照与转发均已释放，隔离已解除' : '恢复成功；客户实例、磁盘与已售库存保持原状，隔离已解除' }) } })
    }, { timeout: scope.remaining(), maxWait: Math.min(5000, scope.remaining()) })
  } catch (error) {
    if (attempt) {
      const state = attempt
      await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM hosts WHERE id = ${hostId} FOR UPDATE`
        const host = await tx.host.findUnique({ where: { id: hostId } })
        const latest = readPoolCleanup(host?.poolCleanup)
        if (!latest || latest.status === 'done' || latest.revision !== state.revision || latest.hostIdentity !== state.hostIdentity || latest.name !== state.name || latest.attempts > state.attempts) return
        const message = redactAuditText(error instanceof Error ? error.message : 'REMOTE_CLEANUP_RETRY').slice(0, 400)
        const blocked = error instanceof CleanupBlocked || (!(error instanceof CleanupWaiting) && state.attempts >= 12)
        const nextAttemptAt = new Date(Date.now() + (blocked ? 30 * 60000 : Math.min(30 * 60000, 30000 * 2 ** Math.min(state.attempts, 6)))).toISOString()
        await tx.host.update({ where: { id: hostId }, data: { poolCleanup: json({ ...state, attempts: error instanceof CleanupWaiting ? latest.attempts : state.attempts, status: blocked ? 'blocked' : 'retry',
          error: message, nextAttemptAt }) } })
        await tx.log.create({ data: { userId: state.actorId, module: 'host', action: 'host.pool.cleanup_retry', result: 'warning',
          content: automaticOperationAudit({ hostId, hostName: host!.name, stage: step, attempt: state.attempts,
            result: '回收未完成；保留库存占用，后台继续核验和重试', error: message, nextAttemptAt }) } })
      })
    } else throw error
  } finally { scope.close() }
}

/** Bounded, rotating scan: each failed item retains its own backoff. */
let cleanupCursor = 0
export async function processPoolCleanupQueue(connect = getIncusClient): Promise<void> {
  if (running || recoveryHeld()) return
  running = true
  try {
    const hosts = await prisma.host.findMany({ where: { singleTenant: true, poolFaulted: true }, orderBy: { id: 'asc' } })
    const rotated = [...hosts.filter(host => host.id > cleanupCursor), ...hosts.filter(host => host.id <= cleanupCursor)]
    let processed = 0
    for (const host of rotated) {
      if (recoveryHeld()) return
      const current = readPoolCleanup(host.poolCleanup)
      if (current?.nextAttemptAt && Date.parse(current.nextAttemptAt) > Date.now()) continue
      if (host.poolCleanup !== null && !current) continue // records-only keeps its explicit retained-data policy
      if (current?.status === 'done') continue
      cleanupCursor = host.id
      try {
        let state = current
        if (!state && host.poolCleanup === null) {
          const task = await prisma.instanceTask.findFirst({ where: { taskType: 'replace_host',
            status: { in: ['COMPLETED', 'FAILED'] }, instance: { hostId: { not: host.id } }, OR: [
              { replacementState: { path: ['sourceHostId'], equals: host.id }, status: 'COMPLETED' },
              { targetHostId: host.id, status: 'FAILED' }
            ] }, orderBy: { id: 'desc' } })
          const old = task?.replacementState as { stage?: string; sourceIncusId?: string; sourceHostIdentity?: string;
            targetIncusId?: string; targetHostIdentity?: string; targetUuid?: string; targetCreatedAt?: string;
            targetMarker?: string; backupUploadId?: number | null; targetCleanupReadOnly?: boolean } | null
          if (task && old?.stage === 'delivered' && old.sourceIncusId) {
            state = poolCleanupRecord(host, old.sourceIncusId, task.userId, task.createdAt, task.id)
            if (old.sourceHostIdentity) state.hostIdentity = old.sourceHostIdentity
            else if (!host.serverCertificate || !host.serverFingerprint || !host.certPath || !host.keyPath) continue
          } else if (task && task.finishedAt && old?.targetIncusId && ['creating', 'cleanup_pending', 'cleaned'].includes(old.stage || '')) {
            if (!old.targetHostIdentity && (!host.serverCertificate || !host.serverFingerprint || !host.certPath || !host.keyPath)) continue
            state = { ...poolCleanupRecord(host, old.targetIncusId, task.userId, task.finishedAt, task.id),
              kind: old.targetCleanupReadOnly ? 'verify_empty' : 'failed_target',
              hostIdentity: old.targetHostIdentity || transferHostIdentity(host), createdAfter: task.createdAt.toISOString(),
              uuid: old.targetUuid, createdAt: old.targetCreatedAt, marker: old.backupUploadId ? undefined : old.targetMarker }
          } else {
            // No delete authorization: automatic recovery may only verify an
            // empty host or an already delivered customer and preserve all data.
            // Historical source repair owns its stronger delivery proof.
            if (await prisma.instance.count({ where: { hostId: host.id, dedicatedIpv4: true, dedicatedNetworkReady: false,
              ...HOST_OCCUPIED_INSTANCE_WHERE } })) continue
            state = poolCleanupRecord(host, '', host.userId, new Date())
          }
          await prisma.host.updateMany({ where: { id: host.id, poolFaulted: true, poolCleanup: { equals: Prisma.DbNull } }, data: { poolCleanup: json(state) } })
        }
        if (state && ['pending', 'retry', 'blocked'].includes(state.status)) await processPoolCleanup(host.id, connect)
      } catch { console.warn(`[HostRepair] Cleanup host #${host.id} will retry; other hosts continue`) }
      if (++processed >= 5) break
    }
  } finally { running = false }
}
