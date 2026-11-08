import { Prisma, type Host, type Instance } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { INSTANCE_OPERATION_LOCK_NAMESPACE, tryAdvisoryTransactionLock } from '../db/advisory-locks.js'
import { transferHostIdentity } from '../lib/transfer-host-identity.js'
import { registeredGuestIdentity } from '../lib/registered-guest-identity.js'
import { withInstanceBillingMutation } from '../lib/instance-billing-mutation.js'
import { hostMaintenanceBlocked } from '../lib/host-maintenance-gate.js'
import { hasPendingSnapshotOperation } from '../db/snapshot-operation-guards.js'
import { hasPendingProxySiteOperations } from '../db/proxy-site-operation-guards.js'
import { getIncusClient } from '../lib/incus/incus-pool.js'
import type { IncusClient } from '../lib/incus/incus-client.js'
import { readCustomerIsolation } from '../lib/incus/customer-isolation.js'
import { restoreConfigurationHash } from '../lib/incus/restore-identity.js'
import { recoveryHeld } from './platform-backup-core.js'
import { recoveryScope } from './host-pool-recovery.js'
import type { IncusInstance } from '../types/incus.js'

export const RENEWAL_RESUME_ENTRY = 'auto-renew-resume-v1'
const MAX_ATTEMPTS = 6
const record = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}
type Resume = { version: 1; ownerId: number; hostIdentity: string; incusId: string; uuid: string | null;
  createdAt: string | null; paidUntil: string; billId: number; attempts: number; nextAttemptAt?: string;
  terminal?: boolean; configurationHash?: string; confirmationAttempted?: boolean }
const asJson = (value: Resume) => value as unknown as Prisma.InputJsonValue
class ResumeBlocked extends Error {}
class ResumeDeferred extends Error {}

/** Called inside the same transaction as the one successful automatic debit. */
export async function queueRenewalResume(tx: Prisma.TransactionClient, instance: Instance, host: Host, paidUntil: Date, billId: number): Promise<void> {
  const identity = await registeredGuestIdentity(tx, instance, host)
  const state: Resume = { version: 1, ownerId: instance.userId, hostIdentity: transferHostIdentity(host), incusId: instance.incusId,
    uuid: typeof identity.uuid === 'string' ? identity.uuid : null,
    createdAt: typeof identity.createdAt === 'string' ? identity.createdAt : null,
    paidUntil: paidUntil.toISOString(), billId, attempts: 0, terminal: false }
  await tx.instanceTask.create({ data: { instanceId: instance.id, hostId: host.id, userId: instance.userId,
    taskType: 'start', status: 'PENDING', operationEntry: RENEWAL_RESUME_ENTRY, operationOwnerId: instance.userId,
    operationIdentity: state.hostIdentity, replacementState: asJson(state), progress: '续费已到账，等待自动开机' } })
}

function readResume(value: unknown): Resume {
  const state = record(value) as Resume
  if (state.version !== 1 || !Number.isSafeInteger(state.ownerId) || !Number.isSafeInteger(state.billId) ||
    !Number.isSafeInteger(state.attempts) || state.attempts < 0 || typeof state.hostIdentity !== 'string' ||
    !/^[a-f0-9]{64}$/.test(state.hostIdentity) || !Number.isFinite(Date.parse(state.paidUntil)) ||
    typeof state.incusId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(state.incusId)) {
    throw new ResumeBlocked('自动开机记录不完整，请核验原实例；续费账单保留')
  }
  return state
}

async function readOriginalGuest(client: IncusClient, expected: Resume) {
  if (!expected.uuid || !/^[a-f0-9-]{36}$/i.test(expected.uuid) || !expected.createdAt || !Number.isFinite(Date.parse(expected.createdAt))) throw new ResumeBlocked('原客机UUID或创建时间缺失，自动开机未执行，请核验实例身份')
  const remote = await readCustomerIsolation(client, expected.incusId) as unknown as IncusInstance & { created_at?: string; project?: string; ephemeral?: boolean }
  if (remote.name !== expected.incusId || (remote.project || 'default') !== 'default' ||
    remote.config?.['volatile.uuid'] !== expected.uuid || remote.created_at !== expected.createdAt || remote.ephemeral !== false) throw new ResumeBlocked('原客机身份或持久属性不匹配，自动开机未执行')
  const hash = restoreConfigurationHash(remote)
  if (expected.configurationHash && hash !== expected.configurationHash) throw new ResumeBlocked('原客机配置已变化，自动开机已停止')
  return { remote, hash }
}

async function assertRemoteIdle(client: IncusClient, name: string) {
  const groups = await client.request<Record<string, unknown>>('GET', '/1.0/operations?recursion=1')
  const touches = (value: unknown): boolean => {
    if (typeof value === 'string') {
      try { const path = new URL(value, 'https://incus.invalid').pathname; return path === `/1.0/instances/${name}` || path.startsWith(`/1.0/instances/${name}/`) } catch { return true }
    }
    if (Array.isArray(value)) return value.some(touches)
    if (value && typeof value === 'object') return Object.values(value).some(touches)
    return true
  }
  if (!groups || typeof groups !== 'object' || Array.isArray(groups) || Object.values(groups).some(group =>
    !Array.isArray(group) || group.some(item => {
      const operation = record(item)
      return !['Success', 'Failure', 'Cancelled', 'Canceled'].includes(operation.status) &&
        (!Object.keys(record(operation.resources)).length || touches(operation.resources))
    }))) throw new ResumeDeferred('客机仍有远端操作或操作状态未确认，等待下次开机核验')
}

/** Worker restart/failed attempts are picked up by the existing five-minute patrol. */
export async function retryRenewalResumes(): Promise<void> {
  if (recoveryHeld()) return
  const tasks = await prisma.instanceTask.findMany({ where: { operationEntry: RENEWAL_RESUME_ENTRY, taskType: 'start', status: 'FAILED',
    OR: [{ error: null }, { error: { not: '用户取消' } }],
    AND: [{ replacementState: { path: ['terminal'], equals: false } }, { replacementState: { path: ['attempts'], lte: MAX_ATTEMPTS } },
      { OR: [{ replacementState: { path: ['nextAttemptAt'], equals: Prisma.AnyNull } },
        { replacementState: { path: ['nextAttemptAt'], lte: new Date().toISOString() } }] }] }, orderBy: [{ finishedAt: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }], take: 100 })
  for (const task of tasks) {
    let state: Resume
    const claim = { id: task.id, status: 'FAILED' as const, retryCount: task.retryCount, error: task.error,
      replacementState: { equals: task.replacementState as Prisma.InputJsonValue } }
    try { state = readResume(task.replacementState) } catch {
      await prisma.instanceTask.updateMany({ where: claim, data: {
        replacementState: { ...record(task.replacementState), terminal: true }, finishedAt: new Date(),
        error: '自动开机记录不完整，请核验原实例；续费账单保留', progress: '自动开机已停止，续费账单保留'
      } })
      continue
    }
    if (task.error === '用户取消' || state.terminal || (state.nextAttemptAt && Date.parse(state.nextAttemptAt) > Date.now())) continue
    await prisma.instanceTask.updateMany({ where: claim,
      data: { status: 'PENDING', startedAt: null, finishedAt: null, retryCount: { increment: 1 }, progress: '续费已完成，重试开机核验' } })
  }
}

/** This path performs only a guarded start; it never calls renewal, rebuild or network repair. */
export async function executeRenewalResume(taskId: number, attempt: { startedAt: Date | null; retryCount: number }): Promise<void> {
  await withInstanceBillingMutation((await prisma.instanceTask.findUniqueOrThrow({ where: { id: taskId } })).instanceId, async () => {
    const task = await prisma.instanceTask.findUniqueOrThrow({ where: { id: taskId } })
    if (task.operationEntry !== RENEWAL_RESUME_ENTRY || task.taskType !== 'start' || task.status !== 'PROCESSING' ||
      task.startedAt?.getTime() !== attempt.startedAt?.getTime() || task.retryCount !== attempt.retryCount) return
    let state: Resume | undefined
    let confirmationOnly = false
    let startIssued = false
    const scope = recoveryScope(55000)
    const attemptWhere = { id: task.id, status: 'PROCESSING' as const, startedAt: task.startedAt, retryCount: task.retryCount }
    try {
      state = readResume(task.replacementState)
      if (state.terminal || state.attempts > MAX_ATTEMPTS || (state.attempts === MAX_ATTEMPTS && state.confirmationAttempted)) throw new ResumeBlocked('自动开机重试预算已耗尽，请检查实例任务；不会再次扣款')
      confirmationOnly = state.attempts === MAX_ATTEMPTS
      // Persist attempt before remote I/O; a lost process cannot reset its budget.
      // One final read-only attempt can confirm a lost sixth start receipt.
      state = { ...state, attempts: state.attempts + (confirmationOnly ? 0 : 1), confirmationAttempted: confirmationOnly, terminal: false }
      if (!(await prisma.instanceTask.updateMany({ where: attemptWhere, data: { replacementState: asJson(state), progress: '核验已续费实例与原身份' } })).count) return
      const expected = state
      // First persist a read-only baseline without retaining a transaction
      // connection. The write transaction below rechecks every binding and the
      // baseline, and never borrows a second connection while holding row locks.
      if (!expected.configurationHash) {
        if (recoveryHeld()) throw new ResumeDeferred('平台处于恢复保护，等待解除后核验开机')
        const host = await prisma.host.findUnique({ where: { id: task.hostId } })
        if (!host || transferHostIdentity(host) !== expected.hostIdentity || !host.serverCertificate || !host.serverFingerprint) throw new ResumeBlocked('原宿主TLS身份缺失或已变化，自动开机未执行')
        if (hostMaintenanceBlocked(host.securityHardening) || host.poolFaulted || host.publicIpSyncBlocked || host.status !== 'online') throw new ResumeDeferred('宿主离线、隔离或维护中，等待下次开机检查')
        const client = scope.client(await scope.run(() => getIncusClient(host, prisma, Math.min(8000, scope.remaining())))) as IncusClient
        expected.configurationHash = (await readOriginalGuest(client, expected)).hash
        if (!(await prisma.instanceTask.updateMany({ where: attemptWhere, data: { replacementState: asJson(expected) } })).count) return
      }
      await prisma.$transaction(async tx => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '2s'`
        if (!await tryAdvisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, task.instanceId)) throw new ResumeDeferred('实例正在处理，等待下次开机检查')
        await tx.$queryRaw`SELECT id FROM instances WHERE id=${task.instanceId} FOR UPDATE`
        await tx.$queryRaw`SELECT id FROM hosts WHERE id=${task.hostId} FOR SHARE`
        await tx.$queryRaw`SELECT id FROM users WHERE id=${task.userId} FOR SHARE`
        const current = await tx.instance.findUnique({ where: { id: task.instanceId } })
        const host = await tx.host.findUnique({ where: { id: task.hostId } })
        const valid = async () => {
          if (recoveryHeld()) throw new ResumeDeferred('平台处于恢复保护，等待解除后核验开机')
          if (!current || !host || current.userId !== task.userId || current.userId !== expected.ownerId || current.hostId !== host.id ||
            current.incusId !== expected.incusId || transferHostIdentity(host) !== expected.hostIdentity || task.operationIdentity !== expected.hostIdentity ||
            current.deletionIntent || current.deletionBillingPending || current.provisioningCleanupPending ||
            !['stopped', 'running'].includes(current.status) || current.suspendedBy !== null || current.suspendReason !== null ||
            !current.expiresAt || current.expiresAt <= new Date() || current.expiresAt.toISOString() !== expected.paidUntil) {
            throw new ResumeBlocked('实例归属、身份、到期或暂停/删除状态已变化，自动开机已停止')
          }
          if (!host.serverCertificate || !host.serverFingerprint) throw new ResumeBlocked('原宿主TLS身份未登记，自动开机未执行，请核验宿主身份')
          if (await tx.instanceTask.count({ where: { instanceId: current.id, id: { gt: task.id } } })) throw new ResumeBlocked('存在更新的实例操作，旧自动开机意图已停止')
          if (await tx.instanceTransfer.count({ where: { instanceId: current.id, status: { in: ['pending', 'processing', 'accepted'] }, createdAt: { gte: task.createdAt } } })) throw new ResumeBlocked('续费后发生转移，旧自动开机意图已停止')
          if ((await tx.user.findUnique({ where: { id: current.userId }, select: { status: true } }))?.status !== 'active') throw new ResumeBlocked('账户已停用，自动开机已停止')
          const bill = await tx.balanceLog.findUnique({ where: { id: expected.billId } })
          if (!bill || bill.userId !== current.userId || bill.instanceId !== current.id || bill.type !== 'consume' ||
            !await tx.instanceBillingRecord.count({ where: { instanceId: current.id, userId: current.userId, type: 'renew',
              balanceLogId: bill.id, periodEnd: new Date(expected.paidUntil) } })) throw new ResumeBlocked('原续费扣款记录无法核验，自动开机已停止')
          if (hostMaintenanceBlocked(host.securityHardening) || host.poolFaulted || host.publicIpSyncBlocked || host.status !== 'online') throw new ResumeDeferred('宿主离线、隔离或维护中，等待下次开机检查')
          const active = { instanceId: current.id, status: { in: ['PENDING', 'PROCESSING'] as Array<'PENDING' | 'PROCESSING'> } }
          if (await tx.instanceTask.count({ where: { ...active, id: { not: task.id } } }) || await tx.restoreTask.count({ where: active }) ||
            await tx.backupUploadTask.count({ where: active }) || await hasPendingSnapshotOperation(current.id, tx) || await hasPendingProxySiteOperations(current.id, tx)) throw new ResumeDeferred('实例存在未完成任务，等待下次开机检查')
        }
        await valid()
        if (!current || !host) return
        const client = scope.client(await scope.run(() => getIncusClient(host, tx, Math.min(8000, scope.remaining())))) as Awaited<ReturnType<typeof getIncusClient>>
        const path = `/1.0/instances/${encodeURIComponent(expected.incusId)}`
        const read = () => readOriginalGuest(client, expected)
        const before = await read()
        if (!['Stopped', 'Running'].includes(before.remote.status)) throw new ResumeDeferred('客机状态尚未稳定，等待下次开机核验')
        await valid()
        await assertRemoteIdle(client, expected.incusId)
        const fresh = await read()
        if (!['Stopped', 'Running'].includes(fresh.remote.status)) throw new ResumeDeferred('客机状态尚未稳定，等待下次开机核验')
        if (fresh.remote.status === 'Stopped') {
          if (confirmationOnly) throw new ResumeBlocked('自动开机六次尝试后仍未运行，已停止下发；续费账单保留，请检查宿主与实例任务')
          if (recoveryHeld()) throw new ResumeDeferred('平台处于恢复保护，暂缓开机')
          startIssued = true
          await client.request('PUT', `${path}/state`, { action: 'start', timeout: 30 })
        }
        const after = await read()
        if (after.remote.status !== 'Running') throw new Error('开机状态未确认')
        await valid()
        await tx.instance.update({ where: { id: current.id }, data: { status: 'running' } })
        await tx.instanceTask.updateMany({ where: attemptWhere, data: { status: 'COMPLETED', finishedAt: new Date(), error: null,
          progress: '补续后自动开机已核验', replacementState: asJson({ ...expected, terminal: true }) } })
        await tx.log.create({ data: { userId: current.userId, instanceId: current.id, module: 'instance', action: 'instance.auto_renew_started',
          content: `实例 #${current.id} 补续后已核验运行及原身份、设备与安全配置，未再次扣款`, result: 'success' } })
      }, { timeout: scope.remaining(), maxWait: 3000 })
    } catch (error) {
      const failure = error as { code?: string; cause?: { originalCode?: string }; meta?: {
        code?: string; driverAdapterError?: { cause?: { originalCode?: string } }
      } }
      const sqlState = failure?.meta?.code ?? failure?.meta?.driverAdapterError?.cause?.originalCode ?? failure?.cause?.originalCode
      const lockBusy = sqlState === '55P03'
      const deferred = error instanceof ResumeDeferred || lockBusy
      const unsafe = ['CUSTOMER_ISOLATION_UNSAFE', 'CUSTOMER_PRIVILEGE_FORBIDDEN'].includes(String((error as { code?: string })?.code))
      const terminal = error instanceof ResumeBlocked || unsafe || (!deferred && confirmationOnly)
      const message = lockBusy ? '实例或账户正在处理，等待下次开机检查' : error instanceof ResumeBlocked || error instanceof ResumeDeferred ? error.message : unsafe ? '客机隔离检查未通过，自动开机已停止；请检查实例安全配置' :
        terminal ? '自动开机重试预算已耗尽，续费账单保留；请检查宿主连接与实例任务' : '开机连接或执行未确认；保留续费账单，稍后核验重试'
      if (state) state = { ...state, attempts: deferred && !confirmationOnly && !startIssued ? Math.max(0, state.attempts - 1) : state.attempts, terminal,
        confirmationAttempted: deferred ? false : state.confirmationAttempted,
        nextAttemptAt: new Date(Date.now() + Math.min(3600000, 300000 * 2 ** Math.max(0, state.attempts - 1))).toISOString() }
      await prisma.instanceTask.updateMany({ where: attemptWhere, data: { status: 'FAILED', finishedAt: new Date(),
        error: message, progress: terminal ? '自动开机已停止，续费账单保留' : '续费已完成，等待自动重试开机',
        ...(state ? { replacementState: asJson(state) } : {}) } })
      // The task already durably records this result. A diagnostic FK insert
      // must not wait on the very user/instance lock that deferred execution.
      if (!lockBusy) await prisma.log.create({ data: { userId: task.userId, instanceId: task.instanceId, module: 'instance', action: 'instance.auto_renew_start_pending',
        content: `实例 #${task.instanceId}：${message}；不会重复扣款`, result: 'failed' } })
    } finally { scope.close() }
  })
}
