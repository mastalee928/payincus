import { Prisma, type Instance, type Host } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { prisma } from '../db/prisma.js'
import { advisoryTransactionLock, tryAdvisoryTransactionLock, INSTANCE_OPERATION_LOCK_NAMESPACE,
  USER_BALANCE_LOCK_NAMESPACE, USER_DESTROY_BILLING_LOCK_NAMESPACE } from '../db/advisory-locks.js'
import { authorizeUserWrite, type WriteActor } from '../db/user-write-authorization.js'
import { assertNoPendingSnapshotOperations } from '../db/snapshot-operation-guards.js'
import { assertNoPendingProxySiteOperations } from '../db/proxy-site-operation-guards.js'
import { calculateInstanceRefund, deductHostingBalance, getMaxRefundable } from '../db/billing-operations.js'
import { cleanupProxySitesForLifecycle } from '../db/proxy-site-operations.js'
import { getIncusClient } from '../lib/incus/incus-pool.js'
import { IncusApiError } from '../lib/incus/incus-client.js'
import { deleteInstance } from '../lib/incus/incus-instances.js'
import { verifyInstanceDeleted } from '../lib/incus/verify-instance-deleted.js'
import { removeDedicatedForward } from '../lib/incus/dedicated-network.js'
import { assertManagedCleanupIdentity, deletePendingManagedInstance } from '../lib/managed-cleanup-identity.js'
import { transferHostIdentity } from '../lib/transfer-host-identity.js'
import { HOST_OCCUPIED_INSTANCE_WHERE } from '../lib/host-resource-usage.js'
import { withInstanceBillingMutation } from '../lib/instance-billing-mutation.js'
import { sendNotification, sendHostManagedInstanceNotification } from '../lib/notifier.js'
import { sendReleaseNotification } from '../lib/release-notifier.js'
import { closeInstanceSessions } from '../lib/terminal-proxy.js'
import { poolCleanupRecord, readPoolCleanup } from './host-pool-cleanup.js'
import { recoveryScope, type RecoveryInstance } from './host-pool-recovery.js'
import { recoveryHeld } from './platform-backup-core.js'
import { reverseInstanceAffCommissionForRefund } from '../routes/instance-destroy.js'
import { sendInstanceDestroyRefundEmail } from '../lib/mailer.js'
import { automaticOperationAudit } from '../lib/automatic-operation-audit.js'

type Mode = 'admin' | 'host' | 'owner' | 'user_destroy'
export type DeletionIntent = {
  version: 1; revision: string; actor: WriteActor; mode: Mode; refund: boolean; reason?: string
  adminRefundType?: 'full' | 'remaining'
  ownerId: number; hostId: number; name: string; hostIdentity: string; instanceVersion: number
  requestedAt: string; status: 'pending' | 'retry' | 'blocked' | 'done'; attempts: number; nextAttemptAt?: string
  uuid?: string; createdAt?: string; absent?: boolean; error?: string; refundAmount?: number; isFirstTime?: boolean
  sites: Array<{ id: number; siteKey: string; revision: number }>
}
type Expected = { id: number; hostId: number; userId: number; incusId: string; status: string; expiresAt: Date | string | null; version?: number }
const asJson = (state: DeletionIntent) => state as unknown as Prisma.InputJsonValue
export function readDeletionIntent(value: unknown): DeletionIntent | null {
  const state = value as DeletionIntent | null
  return state?.version === 1 && typeof state.revision === 'string' && Number.isSafeInteger(state.actor?.id) &&
    ['admin', 'host', 'owner', 'user_destroy'].includes(state.mode) && typeof state.name === 'string' &&
    typeof state.hostIdentity === 'string' && Array.isArray(state.sites) && Number.isSafeInteger(state.attempts) && state.attempts >= 0 &&
    Number.isSafeInteger(state.instanceVersion) && Number.isSafeInteger(state.ownerId) && Number.isSafeInteger(state.hostId) &&
    Number.isFinite(Date.parse(state.requestedAt)) && ['pending', 'retry', 'blocked', 'done'].includes(state.status) ? state : null
}
class DeletionBlocked extends Error {}
export class DeletionAdmissionError extends Error {
  constructor(readonly code: string, readonly statusCode = 409) { super(code) }
}
const iso = (date: Date | string | null) => date ? new Date(date).toISOString() : null

/** Called under the instance/host locks, including immediately before remote writes. */
export async function assertDeletionAuthority(tx: Prisma.TransactionClient, instance: Instance, host: Host, state: DeletionIntent) {
  if (recoveryHeld()) throw new Error('PLATFORM_RECOVERY_HELD')
  if (instance.status !== 'deleted' || !instance.deletionBillingPending || instance.userId !== state.ownerId ||
      instance.hostId !== state.hostId || instance.incusId !== state.name || instance.version !== state.instanceVersion ||
      transferHostIdentity(host) !== state.hostIdentity) throw new DeletionBlocked('DELETE_TARGET_CHANGED')
  if (!await authorizeUserWrite(tx, state.actor.id, state.actor)) throw new DeletionBlocked('DELETE_AUTHORITY_REVOKED')
  const actor = await tx.user.findUniqueOrThrow({ where: { id: state.actor.id } })
  if (state.mode === 'admin' ? actor.role !== 'admin' : state.mode === 'host' ? host.userId !== actor.id : instance.userId !== actor.id) {
    throw new DeletionBlocked('DELETE_AUTHORITY_CHANGED')
  }
  await assertNoPendingSnapshotOperations(tx, instance.id)
  const pending = { instanceId: instance.id, status: { in: ['PENDING', 'PROCESSING'] as Array<'PENDING' | 'PROCESSING'> } }
  if (await tx.instanceTask.count({ where: pending }) || await tx.restoreTask.count({ where: pending }) ||
      await tx.backupUploadTask.count({ where: pending }) ||
      await tx.instanceTransfer.count({ where: { instanceId: instance.id, status: { in: ['pending', 'processing'] } } })) throw new Error('DELETE_WORKFLOW_BUSY')
}

/** Admission persists intent before any remote operation. A failed HTTP response never erases it. */
export async function requestInstanceDeletion(expected: Expected, actor: WriteActor, options: { mode: Mode; refund?: boolean; reason?: string; adminRefundType?: 'full' | 'remaining'; deferRemote?: boolean }) {
  await withInstanceBillingMutation(expected.id, () => prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM hosts WHERE id = ${expected.hostId} FOR UPDATE`
    if (!await tryAdvisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, expected.id)) throw new DeletionAdmissionError('DELETE_WORKFLOW_BUSY')
    await tx.$queryRaw`SELECT id FROM instances WHERE id = ${expected.id} FOR UPDATE`
    const instance = await tx.instance.findUnique({ where: { id: expected.id } })
    const host = await tx.host.findUnique({ where: { id: expected.hostId } })
    if (!instance || !host || instance.hostId !== expected.hostId || instance.userId !== expected.userId || instance.incusId !== expected.incusId ||
        instance.status !== expected.status || ['deleted', 'creating'].includes(instance.status) || instance.deletionBillingPending ||
        iso(instance.expiresAt) !== iso(expected.expiresAt) || (expected.version !== undefined && instance.version !== expected.version)) throw new DeletionAdmissionError('DELETE_TARGET_CHANGED')
    if (recoveryHeld()) throw new DeletionAdmissionError('PLATFORM_RECOVERY_HELD')
    await assertNoPendingProxySiteOperations(tx, instance.id)
    const state: DeletionIntent = { version: 1, revision: randomUUID(), actor, mode: options.mode, refund: options.refund === true,
      reason: options.reason?.trim().slice(0, 500), ownerId: instance.userId, hostId: host.id, name: instance.incusId,
      hostIdentity: transferHostIdentity(host), instanceVersion: instance.version + 1, requestedAt: new Date().toISOString(),
      status: 'pending', attempts: 0, sites: await tx.proxySite.findMany({ where: { instanceId: instance.id }, select: { id: true, siteKey: true, revision: true } }) }
    if (options.adminRefundType) {
      if (options.mode !== 'admin') throw new DeletionAdmissionError('FORBIDDEN', 403)
      state.adminRefundType = options.adminRefundType; state.refund = true
    }
    if (state.mode === 'user_destroy') {
      const expired = instance.status === 'suspended' && instance.suspendReason === 'expired' && instance.packagePlanId && instance.expiresAt && instance.expiresAt <= new Date()
      if (instance.status === 'suspended' && !expired || instance.packagePlanId && !expired && instance.monthlyTrafficUsed >= 5n * 1024n ** 3n) throw new DeletionAdmissionError('INSTANCE_DESTROY_NOT_ALLOWED')
      state.refund = false
    }
    if (state.mode === 'owner') {
      const pkg = instance.packageId ? await tx.package.findUnique({ where: { id: instance.packageId } }) : null
      if (instance.status === 'suspended' || instance.packagePlanId || pkg && !pkg.allowInstanceDeletion) throw new DeletionAdmissionError('INSTANCE_DELETION_NOT_ALLOWED', 403)
      state.refund = false
    }
    const claimed = await tx.instance.update({ where: { id: instance.id }, data: { status: 'deleted', deletionBillingPending: true,
      version: { increment: 1 }, deletionIntent: asJson(state) } })
    await assertDeletionAuthority(tx, claimed, host, state)
    await tx.log.create({ data: { userId: actor.id, instanceId: instance.id, module: 'instance', action: 'instance.delete_queued', result: 'pending',
      content: automaticOperationAudit({ hostId: host.id, hostName: host.name, instanceId: instance.id,
        stage: '保存已授权删除任务', attempt: 0, result: `实例「${instance.name}」删除已受理；系统自动清理，核验完成前保留资源占用` }) } })
  }))
  closeInstanceSessions(expected.id, 'Instance deletion accepted')
  if (!options.deferRemote) await processInstanceDeletion(expected.id)
  return instanceDeletionResult(expected.id)
}
export async function instanceDeletionResult(instanceId: number) {
  const row = await prisma.instance.findUniqueOrThrow({ where: { id: instanceId } })
  const state = readDeletionIntent(row.deletionIntent)!
  return { success: state.status === 'done', pending: state.status !== 'done', refundAmount: state.refundAmount || 0,
    feeAmount: 0, isFirstTime: state.isFirstTime || false,
    message: state.status === 'done' ? '实例已删除，资源已释放' : '删除已受理，系统正在自动清理并核验资源释放' }
}

async function lockedTarget(tx: Prisma.TransactionClient, instanceId: number, expected: DeletionIntent) {
  await tx.$executeRaw`SET LOCAL lock_timeout = '2s'`
  await tx.$queryRaw`SELECT id FROM hosts WHERE id = ${expected.hostId} FOR UPDATE`
  if (!await tryAdvisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, instanceId)) throw new Error('DELETE_WORKFLOW_BUSY')
  await tx.$queryRaw`SELECT id FROM instances WHERE id = ${instanceId} FOR UPDATE`
  const instance = await tx.instance.findUniqueOrThrow({ where: { id: instanceId } })
  const state = readDeletionIntent(instance.deletionIntent)
  if (!state || state.revision !== expected.revision || state.status === 'done') throw new Error('DELETE_ATTEMPT_SUPERSEDED')
  const host = await tx.host.findUniqueOrThrow({ where: { id: state.hostId } })
  await assertDeletionAuthority(tx, instance, host, state)
  return { instance, host, state }
}
async function remoteInstance(client: Pick<Awaited<ReturnType<typeof getIncusClient>>, 'request'>, name: string) {
  const path = `/1.0/instances/${encodeURIComponent(name)}`
  try { return await client.request<RecoveryInstance>('GET', path) }
  catch (error) { if (error instanceof IncusApiError && error.statusCode === 404 && error.path === path) return null; throw error }
}
function assertRemote(remote: RecoveryInstance | null, state: DeletionIntent) {
  if (!remote) return
  if (state.absent || remote.name !== state.name || (remote.project || 'default') !== 'default' ||
      !/^[a-f0-9-]{36}$/i.test(remote.config?.['volatile.uuid'] || '') || !Number.isFinite(Date.parse(remote.created_at || '')) ||
      Date.parse(remote.created_at!) > Date.parse(state.requestedAt) ||
      state.uuid && (remote.config!['volatile.uuid'] !== state.uuid || remote.created_at !== state.createdAt)) throw new DeletionBlocked('DELETE_REMOTE_IDENTITY_CHANGED')
}

const active = new Set<number>()
export async function processInstanceDeletion(instanceId: number, connect = getIncusClient): Promise<void> {
  if (active.has(instanceId) || recoveryHeld()) return
  active.add(instanceId)
  let original: DeletionIntent | null = null
  const scope = recoveryScope(55000)
  let completed: { instance: Instance; host: Host; state: DeletionIntent } | undefined
  let step = '核对原删除授权和实例身份'
  try {
    await withInstanceBillingMutation(instanceId, async () => {
      original = readDeletionIntent((await prisma.instance.findUnique({ where: { id: instanceId } }))?.deletionIntent)
      if (!original || original.status === 'done' || original.nextAttemptAt && Date.parse(original.nextAttemptAt) > Date.now()) return
      const expected = original
      // Commit exact UUID before stopping. On restart, a same-name replacement is refused.
      await prisma.$transaction(async tx => {
        const { instance, host, state } = await lockedTarget(tx, instanceId, expected)
        const transport = await scope.run(() => connect(host))
        const client = Object.assign(scope.client(transport), { baseUrl: transport.baseUrl })
        await scope.run(() => assertManagedCleanupIdentity(client as Awaited<ReturnType<typeof getIncusClient>>, instanceId))
        const remote = await remoteInstance(client, state.name)
        assertRemote(remote, state)
        await tx.instance.update({ where: { id: instance.id }, data: { deletionIntent: asJson({ ...state,
          ...(remote ? { uuid: remote.config!['volatile.uuid'], createdAt: remote.created_at } : { absent: true }),
          status: 'retry', attempts: state.attempts + 1, nextAttemptAt: new Date(Date.now() + 60000).toISOString() }) } })
      }, { timeout: scope.remaining(), maxWait: 3000 })
      step = '清理实例代理站点'
      const sites = await cleanupProxySitesForLifecycle(instanceId, { kind: 'delete' }, expected.sites, true)
      if (sites.pending || sites.errors.length) throw new Error('DELETE_PROXY_CLEANUP_PENDING')
      await prisma.$transaction(async tx => {
        const { instance, host, state } = await lockedTarget(tx, instanceId, expected)
        const transport = await scope.run(() => connect(host))
        const client = Object.assign(scope.client(transport), { baseUrl: transport.baseUrl })
        const remote = await remoteInstance(client, state.name)
        assertRemote(remote, state)
        if (recoveryHeld()) throw new Error('PLATFORM_RECOVERY_HELD')
        step = '停止原实例并复核身份'
        if (remote && remote.status !== 'Stopped') await client.request('PUT', `/1.0/instances/${encodeURIComponent(state.name)}/state`, { action: 'stop', force: true, timeout: 5 })
        const stopped = await remoteInstance(client, state.name)
        assertRemote(stopped, state)
        if (stopped && stopped.status !== 'Stopped') throw new Error('DELETE_STOP_NOT_VERIFIED')
        if (recoveryHeld()) throw new Error('PLATFORM_RECOVERY_HELD')
        const incus = client as Awaited<ReturnType<typeof getIncusClient>>
        step = '删除原实例并核验磁盘、快照和转发释放'
        if (stopped) {
          if (!await deletePendingManagedInstance(incus, instanceId)) await deleteInstance(incus, state.name)
        } else {
          // Never send another DELETE for a name already observed absent.
          await removeDedicatedForward(incus, state.name)
          await verifyInstanceDeleted(incus, state.name)
        }
        scope.remaining()
        if (recoveryHeld()) throw new Error('PLATFORM_RECOVERY_HELD')
        // Remote disk/snapshot/forward absence is established before money or inventory changes.
        step = '结算原删除请求并释放资源登记'
        let refundAmount = 0, isFirstTime = false
        if (state.refund && (state.adminRefundType || instance.userId !== host.userId)) {
          await advisoryTransactionLock(tx, USER_BALANCE_LOCK_NAMESPACE, instance.userId)
          const remark = state.adminRefundType ? `管理员删除并退款：${state.revision}` : '节点实例删除退款'
          const previous = await tx.instanceBillingRecord.findFirst({ where: { instanceId, type: 'refund', remark } })
          if (!previous) {
            refundAmount = state.adminRefundType === 'full' ? (await getMaxRefundable(instanceId, tx)).maxRefundable : (await calculateInstanceRefund(instance, tx)).refundAmount
            if (refundAmount > 0) {
              const before = await tx.user.findUniqueOrThrow({ where: { id: instance.userId } })
              const after = await tx.user.update({ where: { id: instance.userId }, data: { balance: { increment: refundAmount } } })
              const log = await tx.balanceLog.create({ data: { userId: instance.userId, type: 'refund', amount: refundAmount,
                balanceBefore: before.balance, balanceAfter: after.balance, instanceId, remark: `托管实例被删除退款：${instance.name}` } })
              await tx.instanceBillingRecord.create({ data: { instanceId, userId: instance.userId, type: 'refund', amount: state.adminRefundType ? -refundAmount : refundAmount,
                months: 0, periodStart: new Date(), periodEnd: instance.expiresAt || new Date(), balanceLogId: log.id, remark } })
              if (state.adminRefundType) await reverseInstanceAffCommissionForRefund({ tx, instanceId, refundAmount,
                remark: `管理员删除并退款返利冲正：${instance.name}` })
              await deductHostingBalance(host.id, refundAmount, instanceId, `删除托管实例退款扣除：${instance.name}`, tx)
            }
          }
        }
        if (state.mode === 'user_destroy' && instance.packagePlanId) {
          await advisoryTransactionLock(tx, USER_DESTROY_BILLING_LOCK_NAMESPACE, instance.userId)
          isFirstTime = (await tx.userDestroyRecord.count({ where: { userId: instance.userId } })) === 0
          await tx.userDestroyRecord.upsert({ where: { instanceId }, update: {}, create: { instanceId, userId: instance.userId,
            hostId: host.id, instanceName: instance.name, refundAmount: 0, feeAmount: 0, isFirstTime } })
        }
        await tx.portMapping.deleteMany({ where: { instanceId } })
        await tx.snapshot.deleteMany({ where: { instanceId } })
        await tx.backup.deleteMany({ where: { instanceId } })
        await tx.snapshotPolicy.deleteMany({ where: { instanceId } })
        await tx.backupPolicy.deleteMany({ where: { instanceId } })
        await tx.trafficSnapshot.deleteMany({ where: { instanceId } })
        await tx.dailyTraffic.deleteMany({ where: { instanceId } })
        await tx.ipAddress.deleteMany({ where: { instanceId } })
        await tx.ipv6Subnet.deleteMany({ where: { instanceId } })
        await tx.$executeRaw`UPDATE public_ipv4_addresses SET status = 'free', instance_id = NULL, released_at = NOW(), updated_at = NOW()
          WHERE instance_id = ${instanceId} AND status = 'assigned'`
        const done: DeletionIntent = { ...state, status: 'done', error: undefined, nextAttemptAt: undefined, refundAmount, isFirstTime }
        await tx.instance.update({ where: { id: instanceId }, data: { deletionBillingPending: false, provisioningCleanupPending: false, deletionIntent: asJson(done) } })
        const allocated = { hostId: host.id, ...HOST_OCCUPIED_INSTANCE_WHERE }
        const resources = await tx.instance.aggregate({ where: allocated, _sum: { cpu: true, memory: true, disk: true } })
        const ports = await tx.portMapping.count({ where: { instance: allocated } })
        const cleanup = readPoolCleanup(host.poolCleanup)
        await tx.host.update({ where: { id: host.id }, data: { cpuUsed: resources._sum.cpu || 0, memoryUsed: resources._sum.memory || 0,
          diskUsed: resources._sum.disk || 0, natPortsUsedCount: ports,
          ...(host.singleTenant && (!host.poolCleanup || cleanup?.status === 'done') ? { poolFaulted: true,
            poolCleanup: poolCleanupRecord(host, instance.incusId, host.userId, new Date()) as unknown as Prisma.InputJsonValue } : {}) } })
        await tx.log.create({ data: { userId: state.actor.id, instanceId, module: 'instance',
          action: state.mode === 'user_destroy' ? 'instance.user_destroy' : 'instance.delete', result: 'success',
          content: automaticOperationAudit({ hostId: host.id, hostName: host.name, instanceId, stage: step, attempt: state.attempts,
            result: `删除成功；实例、磁盘、快照及转发均已释放；退款 ${refundAmount.toFixed(2)}；宿主可售资格由后台继续核验` }) } })
        completed = { instance, host, state: done }
      }, { timeout: scope.remaining(), maxWait: 3000 })
    })
  } catch (error) {
    completed = undefined
    if (original) {
      const revision = (original as DeletionIntent).revision
      await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM instances WHERE id = ${instanceId} FOR UPDATE`
        const row = await tx.instance.findUnique({ where: { id: instanceId } })
        const latest = readDeletionIntent(row?.deletionIntent)
        if (!latest || latest.revision !== revision || latest.status === 'done') return
        const message = error instanceof Error && /^[A-Z_]{1,100}$/.test(error.message) ? error.message : 'DELETE_RETRY'
        const nextAttemptAt = new Date(Date.now() + Math.min(1800000, 30000 * 2 ** Math.min(latest.attempts, 6))).toISOString()
        const host = await tx.host.findUniqueOrThrow({ where: { id: latest.hostId } })
        await tx.log.create({ data: { userId: latest.actor.id, instanceId, module: 'instance',
          action: 'instance.delete_retry', result: 'warning', content: automaticOperationAudit({ hostId: host.id, hostName: host.name, instanceId,
            stage: step, attempt: latest.attempts, result: '删除未完成；保留资源占用和账目，后台自动重试', error: message, nextAttemptAt }) } })
        await tx.instance.update({ where: { id: instanceId }, data: { deletionIntent: asJson({ ...latest,
          status: error instanceof DeletionBlocked ? 'blocked' : 'retry', error: message,
          nextAttemptAt }) } })
      })
    }
  } finally { scope.close(); active.delete(instanceId) }
  // A notification transport cannot roll back or replay a completed deletion/refund.
  if (completed) {
    const { instance, host, state } = completed
    void sendNotification(instance.userId, state.adminRefundType ? 'instance_deleted_refunded' : state.reason ? 'instance_deleted_by_host_owner' : 'instance_deleted', {
      refundAmount: state.refundAmount || 0, refundType: state.adminRefundType === 'full' ? '全额退款' : '按剩余价值退款', reason: state.reason,
      instanceName: instance.name, hostName: host.name, ...(state.reason ? { deleteReason: state.reason } : {}) }).catch(() => {})
    if (state.adminRefundType) {
      const owner = await prisma.user.findUnique({ where: { id: instance.userId }, select: { email: true, username: true } })
      if (owner?.email) void sendInstanceDestroyRefundEmail(owner.email, { username: owner.username, instanceName: instance.name,
        refundAmount: state.refundAmount || 0, refundType: state.adminRefundType === 'full' ? '全额退款' : '按剩余价值退款', reason: state.reason || '', isUserDestroy: false }).catch(() => {})
    }
    if (state.mode === 'user_destroy') void sendHostManagedInstanceNotification(host.id, 'destroy', {
      instanceName: instance.name, username: String(instance.userId), refundAmount: 0, feeAmount: 0 }).catch(() => {})
    if (instance.packageId) void sendReleaseNotification({ packageId: instance.packageId, cpu: instance.cpu, memory: instance.memory,
      source: state.mode === 'user_destroy' ? '用户销毁实例' : '删除实例' }).catch(() => {})
  }
}

export async function processInstanceDeletionQueue() {
  if (recoveryHeld()) return
  const rows = await prisma.$queryRaw<Array<{ id: number }>>`SELECT id FROM instances
    WHERE status = 'deleted' AND deletion_billing_pending AND deletion_intent IS NOT NULL
      AND deletion_intent->>'status' IN ('pending', 'retry', 'blocked')
      AND (deletion_intent->>'nextAttemptAt' IS NULL OR deletion_intent->>'nextAttemptAt' <= ${new Date().toISOString()})
    ORDER BY deletion_intent->>'nextAttemptAt' NULLS FIRST, id LIMIT 5`
  for (const row of rows) {
    if (recoveryHeld()) return
    try { await processInstanceDeletion(row.id) } catch { console.warn(`[InstanceDeletion] Instance #${row.id} retry could not be saved; next task continues`) }
  }
}
