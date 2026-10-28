import { randomUUID } from 'node:crypto'
import { Prisma, type AutoSnapshotOperation, type Host } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { INSTANCE_OPERATION_LOCK_NAMESPACE, tryAdvisoryTransactionLock } from '../db/advisory-locks.js'
import { hasActiveTransferWorkflow } from '../db/transfers.js'
import { assertNoPendingProxySiteOperations } from '../db/proxy-site-operation-guards.js'
import { OPEN_AUTO_SNAPSHOT_STATES } from '../db/snapshot-operation-guards.js'
import { authorizeUserWrite, type WriteActor } from '../db/user-write-authorization.js'
import { transferHostIdentity } from '../lib/transfer-host-identity.js'
import { IncusClient } from '../lib/incus/incus-client.js'
import type { IncusInstance } from '../types/incus.js'
import { redactAuditText } from '../lib/risk-audit.js'
import { sendNotification } from '../lib/notifier.js'
import { recoveryHeld } from './platform-backup-core.js'

const active = new Set<number>()
const ATTEMPT_TIMEOUT = 150000
type Previous = { id: number; incusName: string; name: string } | null
class SnapshotBlockedError extends Error { readonly statusCode = 409 }
class SnapshotBusyError extends Error { readonly statusCode = 409 }

async function lockInstance(tx: Prisma.TransactionClient, instanceId: number) {
  await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`
  if (!await tryAdvisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, instanceId)) throw new SnapshotBusyError('实例正在执行其他操作')
  await tx.$queryRaw`SELECT id FROM instances WHERE id = ${instanceId} FOR UPDATE`
  const instance = await tx.instance.findUnique({ where: { id: instanceId } })
  if (!instance) throw new SnapshotBlockedError('原实例记录已不存在')
  await tx.$queryRaw`SELECT id FROM hosts WHERE id = ${instance.hostId} FOR SHARE`
  const host = await tx.host.findUniqueOrThrow({ where: { id: instance.hostId } })
  await tx.$queryRaw`SELECT instance_id FROM snapshot_policies WHERE instance_id = ${instanceId} FOR UPDATE`
  const policy = await tx.snapshotPolicy.findUnique({ where: { instanceId } })
  return { instance, host, policy }
}

async function checkWorkflow(tx: Prisma.TransactionClient, instanceId: number) {
  if (await hasActiveTransferWorkflow(instanceId, tx) ||
    await tx.instanceTransfer.count({ where: { instanceId, status: { in: ['pending', 'processing'] } } })) throw new SnapshotBusyError('实例正在转移或执行其他任务')
  await assertNoPendingProxySiteOperations(tx, instanceId)
}

export async function prepareAutoSnapshotOperation(instanceId: number): Promise<AutoSnapshotOperation | null> {
  try {
    return await prisma.$transaction(async tx => {
      if (recoveryHeld()) return null
      const { instance, host, policy } = await lockInstance(tx, instanceId)
      const existing = await tx.autoSnapshotOperation.findFirst({ where: { instanceId, state: { in: OPEN_AUTO_SNAPSHOT_STATES } } })
      if (existing) return existing
      const now = new Date()
      if (!policy?.enabled || policy.nextRunAt && policy.nextRunAt > now || !instance.snapshotLimit || instance.snapshotLimit <= 0 ||
        !['running', 'stopped'].includes(instance.status) || instance.provisioningCleanupPending || instance.deletionBillingPending ||
        host.status !== 'online' || instance.expiresAt && instance.expiresAt <= now) return null
      await checkWorkflow(tx, instanceId)
      const snapshots = await tx.snapshot.findMany({ where: { instanceId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
      const previous = snapshots.length >= instance.snapshotLimit ? snapshots.find(row => row.name.startsWith('auto-')) || snapshots[0] : null
      const operation = await tx.autoSnapshotOperation.create({ data: { id: randomUUID(), instanceId, ownerId: instance.userId,
        hostId: host.id, incusId: instance.incusId, identityHash: transferHostIdentity(host), snapshotName: `auto-${randomUUID()}`,
        previousSnapshot: previous ? { id: previous.id, incusName: previous.incusName, name: previous.name } : Prisma.DbNull,
        nextRetryAt: now } })
      await tx.log.create({ data: { userId: instance.userId, instanceId, module: 'snapshot', action: 'snapshot.auto_pending',
        result: 'pending', content: `自动快照 ${operation.snapshotName} 已排队，原快照在新快照确认前保留` } })
      return operation
    }, { maxWait: 5000, timeout: 15000 })
  } catch (error) { if (error instanceof SnapshotBusyError) return null; throw error }
}

async function withRemote<T>(host: Host, work: (client: IncusClient) => Promise<T>): Promise<T> {
  const deadline = Date.now() + 90000
  class SnapshotClient extends IncusClient {
    override async request<R = unknown>(method: string, path: string, body: unknown = null, timeout = 120000, signal?: AbortSignal): Promise<R> {
      const remaining = deadline - Date.now()
      if (remaining <= 0) throw new Error('自动快照远端操作超时')
      return super.request<R>(method, path, body, Math.min(timeout, remaining), signal)
    }
  }
  const client = new SnapshotClient({ url: host.url, certPath: host.certPath, keyPath: host.keyPath,
    serverCertificate: host.serverCertificate, serverFingerprint: host.serverFingerprint })
  try { await client.connect(); return await work(client) }
  finally { await client.close() }
}

async function identity(client: IncusClient, operation: AutoSnapshotOperation): Promise<string> {
  const remote = await client.request<IncusInstance>('GET', `/1.0/instances/${operation.incusId}`, null, 30000)
  const uuid = remote.config?.['volatile.uuid'] || remote.expanded_config?.['volatile.uuid']
  if (remote.name !== operation.incusId || !uuid || operation.remoteUuid && uuid !== operation.remoteUuid) {
    throw new SnapshotBlockedError('Incus 实例 UUID 已变化，请核验原实例身份')
  }
  return uuid
}

async function snapshotNames(client: IncusClient, operation: AutoSnapshotOperation): Promise<string[]> {
  const prefix = `/1.0/instances/${operation.incusId}/snapshots/`
  const names = await client.request<unknown>('GET', prefix.slice(0, -1), null, 30000)
  if (!Array.isArray(names) || names.some(item => typeof item !== 'string' || !item.startsWith(prefix))) throw new Error('无法核验 Incus 快照清单')
  return names.map(item => item.slice(prefix.length))
}

async function assertRemoteIdle(client: IncusClient, operation: AutoSnapshotOperation) {
  // A lost POST response may leave Incus still creating a snapshot. Do not infer
  // completion from a name appearing in the list while that operation is running.
  const groups = await client.request<unknown>('GET', '/1.0/operations?recursion=1', null, 30000)
  if (!groups || typeof groups !== 'object' || Array.isArray(groups)) throw new Error('无法核验 Incus 在途操作')
  const prefix = `/1.0/instances/${operation.incusId}`
  for (const [state, entries] of Object.entries(groups)) {
    if (!Array.isArray(entries)) throw new Error('Incus 在途操作清单格式无效')
    if (['success', 'failure', 'cancelled'].includes(state.toLowerCase())) continue
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object' || !entry.resources || typeof entry.resources !== 'object') throw new Error('无法确认 Incus 在途操作目标')
      const targets = Object.values(entry.resources).flat()
      if (targets.some(target => typeof target !== 'string')) throw new Error('Incus 在途操作目标格式无效')
      if (targets.some(target => target === prefix || (target as string).startsWith(prefix + '/'))) throw new SnapshotBusyError('Incus 仍在处理原实例操作，确认完成后将重试')
    }
  }
}

async function phase<T>(id: string, attemptId: string, work: (context: Awaited<ReturnType<typeof lockInstance>> &
  { tx: Prisma.TransactionClient; operation: AutoSnapshotOperation }) => Promise<T>): Promise<T> {
  return prisma.$transaction(async tx => {
    if (recoveryHeld()) throw new SnapshotBusyError('平台处于备份恢复保护，快照操作已保留')
    const initial = await tx.autoSnapshotOperation.findUniqueOrThrow({ where: { id } })
    const context = await lockInstance(tx, initial.instanceId)
    const { instance, host } = context
    const operation = await tx.autoSnapshotOperation.findUniqueOrThrow({ where: { id } })
    if (operation.state !== 'applying' || operation.attemptId !== attemptId) throw new SnapshotBlockedError('原自动快照执行代次已变化')
    if (instance.userId !== operation.ownerId || instance.hostId !== operation.hostId || instance.incusId !== operation.incusId ||
      transferHostIdentity(host) !== operation.identityHash) throw new SnapshotBlockedError('原实例归属或宿主机连接身份已变化，请恢复原身份后重试')
    if (!['running', 'stopped', 'suspended'].includes(instance.status) || instance.provisioningCleanupPending || instance.deletionBillingPending) {
      throw new SnapshotBlockedError('实例未就绪或正在清理，请恢复原实例后重试')
    }
    await checkWorkflow(tx, instance.id)
    return work({ ...context, tx, operation })
  }, { maxWait: 5000, timeout: 120000 })
}

/** Returns after a bounded attempt; the original operation remains durable on every failure. */
export async function applyAutoSnapshotOperation(id: string): Promise<AutoSnapshotOperation> {
  const initial = await prisma.autoSnapshotOperation.findUniqueOrThrow({ where: { id } })
  if (recoveryHeld()) return initial
  if (active.has(initial.instanceId) || !['pending', 'retry', 'applying'].includes(initial.state)) return initial
  active.add(initial.instanceId)
  const attemptId = randomUUID()
  let claimed = false
  try {
    const now = new Date()
    const claim = await prisma.autoSnapshotOperation.updateMany({ where: { id, OR: [
      { state: { in: ['pending', 'retry'] }, OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }] },
      { state: 'applying', OR: [{ startedAt: null }, { startedAt: { lt: new Date(now.getTime() - ATTEMPT_TIMEOUT) } }] }
    ] }, data: { state: 'applying', attemptId, startedAt: now, attempts: { increment: 1 } } })
    if (!claim.count) return prisma.autoSnapshotOperation.findUniqueOrThrow({ where: { id } })
    claimed = true
    // UUID is committed before the first remote mutation.
    await phase(id, attemptId, async ({ tx, operation, host, policy, instance }) => {
      if (!operation.remoteUuid && (!policy?.enabled || instance.status === 'suspended' || instance.expiresAt && instance.expiresAt <= now)) {
        await tx.autoSnapshotOperation.update({ where: { id }, data: { state: 'cancelled', completedAt: now, error: null, nextRetryAt: null } })
        return
      }
      const uuid = await withRemote(host, client => identity(client, operation))
      await tx.autoSnapshotOperation.update({ where: { id }, data: { remoteUuid: uuid } })
    })
    if ((await prisma.autoSnapshotOperation.findUniqueOrThrow({ where: { id } })).state === 'cancelled') return prisma.autoSnapshotOperation.findUniqueOrThrow({ where: { id } })
    await phase(id, attemptId, async ({ tx, operation, host, instance, policy }) => {
      if (operation.stage !== 'prepared') return
      await withRemote(host, async client => {
        await identity(client, operation)
        await assertRemoteIdle(client, operation)
        if (!(await snapshotNames(client, operation)).includes(operation.snapshotName)) {
          if (!policy?.enabled || !instance.snapshotLimit || instance.snapshotLimit <= 0 || instance.status === 'suspended' || instance.expiresAt && instance.expiresAt <= new Date()) {
            await tx.autoSnapshotOperation.update({ where: { id }, data: { state: 'cancelled', completedAt: new Date(), error: null, nextRetryAt: null } })
            return
          }
          await client.request('POST', `/1.0/instances/${operation.incusId}/snapshots`, { name: operation.snapshotName }, 60000)
        }
        if (!(await snapshotNames(client, operation)).includes(operation.snapshotName)) throw new Error('新快照创建尚未确认，旧快照已保留')
      })
      await tx.autoSnapshotOperation.updateMany({ where: { id, state: 'applying', attemptId }, data: { stage: 'created' } })
    })
    if ((await prisma.autoSnapshotOperation.findUniqueOrThrow({ where: { id } })).state === 'cancelled') return prisma.autoSnapshotOperation.findUniqueOrThrow({ where: { id } })
    await phase(id, attemptId, async ({ tx, operation, host }) => {
      if (operation.stage !== 'created') return
      const previous = operation.previousSnapshot as Previous
      if (previous) {
        const current = await tx.snapshot.findUnique({ where: { id: previous.id } })
        if (current && (current.instanceId !== operation.instanceId || current.incusName !== previous.incusName)) {
          throw new SnapshotBlockedError('原轮换快照记录已变化，禁止删除新目标')
        }
        await withRemote(host, async client => {
          await identity(client, operation)
          await assertRemoteIdle(client, operation)
          const names = await snapshotNames(client, operation)
          if (!names.includes(operation.snapshotName)) throw new SnapshotBlockedError('新快照已不存在，旧快照继续保留')
          if (names.includes(previous.incusName)) await client.request('DELETE', `/1.0/instances/${operation.incusId}/snapshots/${previous.incusName}`, null, 60000)
          if ((await snapshotNames(client, operation)).includes(previous.incusName)) throw new Error('旧快照删除尚未确认')
        })
      }
      await tx.autoSnapshotOperation.update({ where: { id }, data: { stage: 'deleted' } })
    })
    const completed = await phase(id, attemptId, async ({ tx, operation, instance, host, policy }) => {
      if (operation.stage !== 'deleted' && operation.stage !== 'finalize') throw new SnapshotBlockedError('自动快照尚未完成远端核验')
      const previous = operation.previousSnapshot as Previous
      await withRemote(host, async client => {
        await identity(client, operation)
        await assertRemoteIdle(client, operation)
        const names = await snapshotNames(client, operation)
        if (!names.includes(operation.snapshotName) || previous && names.includes(previous.incusName)) throw new Error('自动快照最终清单未确认')
      })
      const existing = await tx.snapshot.findFirst({ where: { instanceId: instance.id, incusName: operation.snapshotName } })
      if (!existing) await tx.snapshot.create({ data: { instanceId: instance.id, incusName: operation.snapshotName, name: operation.snapshotName, description: '自动快照', stateful: false } })
      if (previous) await tx.snapshot.deleteMany({ where: { id: previous.id, instanceId: instance.id, incusName: previous.incusName } })
      const finishedAt = new Date()
      if (policy) await tx.snapshotPolicy.update({ where: { instanceId: instance.id }, data: { lastRunAt: finishedAt,
        nextRunAt: new Date(finishedAt.getTime() + policy.intervalMinutes * 60000) } })
      await tx.autoSnapshotOperation.update({ where: { id }, data: { state: 'succeeded', stage: 'finalize', completedAt: finishedAt, error: null, nextRetryAt: null } })
      await tx.log.create({ data: { userId: instance.userId, instanceId: instance.id, module: 'snapshot', action: 'snapshot.auto_create',
        result: 'success', content: `Auto snapshot "${operation.snapshotName}" created for instance "${instance.name}"` } })
      return { instance, host, previous, snapshotName: operation.snapshotName }
    })
    try { await sendNotification(completed.instance.userId, completed.previous ? 'auto_snapshot_rotated' : 'auto_snapshot', {
      instanceName: completed.instance.name, snapshotName: completed.snapshotName, hostName: completed.host.name,
      ...(completed.previous ? { deletedName: completed.previous.name, quotaLimit: completed.instance.snapshotLimit ?? 0 } : {})
    }) } catch (error) { console.error('[AutoPolicy] Snapshot notification failed:', redactAuditText(String(error))) }
  } catch (error) {
    if (claimed) {
      const current = await prisma.autoSnapshotOperation.findUniqueOrThrow({ where: { id } })
      const blocked = error instanceof SnapshotBlockedError || current.attempts >= 5
      const message = redactAuditText(error instanceof Error ? error.message : String(error)).slice(0, 1500)
      // Preserve the recovery receipt even if an audit FK was removed externally.
      const saved = await prisma.autoSnapshotOperation.updateMany({ where: { id, state: 'applying', attemptId }, data: {
          state: blocked ? 'blocked' : 'retry', error: message, nextRetryAt: blocked ? null : new Date(Date.now() + Math.min(600000, 30000 * 2 ** (current.attempts - 1))) } })
      if (saved.count) try { await prisma.log.create({ data: { userId: current.ownerId, instanceId: current.instanceId, module: 'snapshot',
          action: 'snapshot.auto_failed', result: 'failed', content: `自动快照 ${current.snapshotName} 未完成：${message}` } })
      } catch (logError) { console.error('[AutoPolicy] Snapshot failure audit unavailable:', redactAuditText(String(logError))) }
    } else throw error
  } finally { active.delete(initial.instanceId) }
  return prisma.autoSnapshotOperation.findUniqueOrThrow({ where: { id } })
}

export async function retryAutoSnapshotOperation(instanceId: number, operationId: string, actor: WriteActor): Promise<AutoSnapshotOperation> {
  const operation = await prisma.$transaction(async tx => {
    const { instance, host } = await lockInstance(tx, instanceId)
    if (!await authorizeUserWrite(tx, actor.id, actor) || actor.id !== instance.userId && actor.id !== host.userId &&
      (await tx.user.findUnique({ where: { id: actor.id }, select: { role: true } }))?.role !== 'admin') throw new SnapshotBlockedError('无权重试此快照操作')
    const current = await tx.autoSnapshotOperation.findUniqueOrThrow({ where: { id: operationId } })
    if (current.instanceId !== instanceId || current.ownerId !== instance.userId || current.hostId !== host.id ||
      current.incusId !== instance.incusId || current.identityHash !== transferHostIdentity(host)) throw new SnapshotBlockedError('原快照身份已变化，禁止改用新目标重试')
    if (!OPEN_AUTO_SNAPSHOT_STATES.includes(current.state) || active.has(instanceId) || current.state === 'applying' &&
      current.startedAt && Date.now() - current.startedAt.getTime() < ATTEMPT_TIMEOUT) return current
    return tx.autoSnapshotOperation.update({ where: { id: operationId }, data: { state: 'pending', attempts: 0, attemptId: null, startedAt: null, nextRetryAt: new Date() } })
  })
  return applyAutoSnapshotOperation(operation.id)
}

export async function autoSnapshotOperationView(instanceId: number) {
  const operation = await prisma.autoSnapshotOperation.findFirst({ where: { instanceId, state: { in: OPEN_AUTO_SNAPSHOT_STATES } }, orderBy: { createdAt: 'desc' } })
  return operation ? { id: operation.id, state: operation.state, stage: operation.stage, error: operation.error,
    nextRetryAt: operation.nextRetryAt, snapshotName: operation.snapshotName } : null
}
