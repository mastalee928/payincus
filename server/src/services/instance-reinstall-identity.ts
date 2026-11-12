import { assertInstanceMayBoot } from '../lib/instance-expiry.js'
import { createHash, randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { Prisma, type InstanceTask } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { registeredGuestIdentity } from '../lib/registered-guest-identity.js'
import { transferHostIdentity } from '../lib/transfer-host-identity.js'
import { managedCleanupEndpointHash, cleanupManagedInstanceRemote } from '../lib/managed-cleanup-identity.js'
import { getIncusClient, deleteInstance } from '../lib/incus/index.js'
import { stopInstance } from '../lib/incus/incus-instances.js'
import { INSTANCE_OPERATION_LOCK_NAMESPACE, tryAdvisoryTransactionLock } from '../db/advisory-locks.js'
import { IncusApiError, type IncusClient } from '../lib/incus/incus-client.js'
import type { IncusInstance as BaseIncusInstance } from '../types/incus.js'
import { recoveryHeld } from './platform-backup-core.js'
import { authorizeUserWrite } from '../db/user-write-authorization.js'
import { assertHostNotMaintaining } from '../lib/host-maintenance-gate.js'
import { sameGuestCreationTime } from '../lib/guest-identity-time.js'

const record = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}
const validUuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value)
type IncusInstance = BaseIncusInstance & { created_at: string; project?: string }
const rebuildConfigHash = (config: Record<string, string>) => createHash('sha256').update(JSON.stringify(
  Object.entries(config).filter(([key]) => !key.startsWith('volatile.') && !key.startsWith('image.')).sort(([a], [b]) => a.localeCompare(b))
)).digest('hex')

/** Bind destructive work to existing delivery proof. Never adopt a same-name guest. */
export async function beginInstanceReinstall(task: InstanceTask, original: IncusClient) {
  const instance = await prisma.instance.findUniqueOrThrow({ where: { id: task.instanceId } })
  const host = await prisma.host.findUniqueOrThrow({ where: { id: task.hostId } })
  const hostIdentity = transferHostIdentity(host)
  const saved = await registeredGuestIdentity(prisma, instance, host)
  if (!validUuid(saved.uuid) || !saved.createdAt) throw Error('REINSTALL_ORIGINAL_IDENTITY_MISSING')
  const originalPath = `/1.0/instances/${encodeURIComponent(instance.incusId)}`
  const specs = record(instance.snapshottedSpecs)
  const cleanup = record(specs.managedCleanup)
  const pkg = instance.packageId ? await prisma.package.findUniqueOrThrow({ where: { id: instance.packageId } }) : null
  const expectedType = pkg?.instanceType === 'vm' ? 'virtual-machine' : 'container'
  let target: { name: string; attempt: string; uuid?: string; createdAt?: string; type: string } | undefined
  let removed = false
  const check = async () => {
    if (recoveryHeld()) throw Error('PLATFORM_RECOVERY_HELD')
    const current = await prisma.instanceTask.findUniqueOrThrow({ where: { id: task.id } })
    const row = await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })
    assertInstanceMayBoot(row)
    const currentHost = await prisma.host.findUniqueOrThrow({ where: { id: host.id } })
    const actor = await prisma.user.findUnique({ where: { id: task.userId } })
    const revoked = await prisma.tokenInvalidation.findFirst({ where: { userId: task.userId,
      sessionId: { in: [task.actorSid || '', '__USER_LEVEL__'] }, invalidatedAt: { gte: task.actorIat || 0 } } })
    if (!actor || actor.status !== 'active' || revoked || (task.operationEntry === 'host' && actor.id !== currentHost.userId && actor.role !== 'admin')) {
      throw Error('REINSTALL_AUTHORIZATION_CHANGED')
    }
    if (current.status !== 'PROCESSING' || current.startedAt?.getTime() !== task.startedAt?.getTime() || current.retryCount !== task.retryCount ||
      current.operationIdentity !== task.operationIdentity || row.hostId !== host.id || row.userId !== instance.userId ||
      row.incusId !== instance.incusId || ['deleted', 'suspended'].includes(row.status) || row.provisioningCleanupPending || row.deletionBillingPending ||
      Date.now() - task.startedAt!.getTime() >= 30 * 60 * 1000 ||
      transferHostIdentity(currentHost) !== hostIdentity) throw Error('REINSTALL_TASK_IDENTITY_CHANGED')
  }
  const source = async (allowMissing = false) => {
    await check()
    let remote: IncusInstance
    try { remote = await original.request<IncusInstance>('GET', originalPath) }
    catch (error) {
      if (allowMissing && error instanceof IncusApiError && error.statusCode === 404 && error.path === originalPath) return null
      throw error
    }
    if ((remote.project || 'default') !== 'default' || remote.name !== instance.incusId || remote.config?.['volatile.uuid'] !== saved.uuid ||
      saved.createdAt && !sameGuestCreationTime(remote.created_at,saved.createdAt) || remote.type !== expectedType) {
      throw Error('REINSTALL_ORIGINAL_IDENTITY_CHANGED')
    }
    if (cleanup.uuid === saved.uuid && (cleanup.endpointHash !== managedCleanupEndpointHash(original) ||
      remote.config?.['user.payincus.provisioning-attempt'] !== cleanup.attempt)) throw Error('REINSTALL_ORIGINAL_IDENTITY_CHANGED')
    return remote
  }
  const persist = async (fields: Record<string, unknown>) => {
    await check()
    const current = await prisma.instanceTask.findUniqueOrThrow({ where: { id: task.id } })
    const updated = await prisma.instanceTask.updateMany({ where: { id: task.id, status: 'PROCESSING', startedAt: task.startedAt,
      retryCount: task.retryCount, replacementState: { equals: current.replacementState ?? Prisma.DbNull } },
      data: { targetHostId: host.id, replacementState: { ...record(current.replacementState), ...fields } as Prisma.InputJsonValue } })
    if (updated.count !== 1) throw Error('REINSTALL_TASK_IDENTITY_CHANGED')
  }
  const targetIdentity = async () => {
    if (!target) throw Error('REINSTALL_TARGET_NOT_PREPARED')
    await check()
    const remote = await original.request<IncusInstance>('GET', `/1.0/instances/${encodeURIComponent(target.name)}`)
    if (remote.name !== target.name || remote.type !== target.type || !validUuid(remote.config?.['volatile.uuid']) ||
      !Number.isFinite(Date.parse(remote.created_at)) || remote.config?.['user.payincus.provisioning-attempt'] !== target.attempt ||
      target.uuid && (remote.config['volatile.uuid'] !== target.uuid || remote.created_at !== target.createdAt)) throw Error('REINSTALL_TARGET_IDENTITY_CHANGED')
    target.uuid = remote.config['volatile.uuid']; target.createdAt = remote.created_at
    await persist({ targetUuid: target.uuid, targetCreatedAt: target.createdAt })
    return remote
  }
  // Guard every source/target mutation, including retries hidden inside Incus helpers.
  const client = new Proxy(original, { get(object, property) {
    if (property === 'request') return async (...args: Parameters<IncusClient['request']>) => {
      const [method, path] = args
      await check()
      if (method !== 'GET') {
        if (path === originalPath || path.startsWith(originalPath + '/')) await source(removed || task.taskType === 'recreate')
        else if (target && (path === `/1.0/instances/${target.name}` || path.startsWith(`/1.0/instances/${target.name}/`))) await targetIdentity()
      }
      await check()
      const remaining = 30 * 60000 - (Date.now() - task.startedAt!.getTime())
      args[3] = Math.min(args[3] ?? 120000, remaining)
      if (task.taskType === 'rebuild' && method === 'POST' && path === originalPath + '/rebuild') {
        args[5] = { ...args[5], onOperation: async path => { await persist({ rebuildOperation: path }) } }
      }
      return object.request(...args)
    }
    const value = Reflect.get(object, property)
    return typeof value === 'function' ? value.bind(object) : value
  } })
  return { client, source, check, targetIdentity,
    async targetAddress(address: string) { await persist({ targetIpv4: address }) },
    async prepareRebuildPassword(encryptedPassword: string, config: Record<string, string>) {
      await persist({ targetPhase: 'rebuild_uncertain', pendingRootPassword: encryptedPassword,
        rebuildConfigHash: rebuildConfigHash(config),
        targetHostIdentity: hostIdentity, targetIncusId: instance.incusId,
        rebuildSourceUuid: saved.uuid, rebuildSourceCreatedAt: saved.createdAt })
    },
    async rebuilt() { await persist({ rebuildCompleted: true }) },
    async resumeRebuild() {
      const state = record((await prisma.instanceTask.findUniqueOrThrow({ where: { id: task.id } })).replacementState)
      if (state.targetPhase !== 'rebuild_uncertain') return null
      await check()
      if (state.rebuildSourceUuid !== saved.uuid || state.rebuildSourceCreatedAt !== saved.createdAt ||
        state.targetHostIdentity !== hostIdentity || state.targetIncusId !== instance.incusId) throw Error('REBUILD_ORIGINAL_IDENTITY_CHANGED')
      if (!state.rebuildCompleted) {
        if (!/^\/1\.0\/operations\/[a-f0-9-]+$/i.test(state.rebuildOperation || '')) throw Error('REBUILD_OPERATION_RECEIPT_MISSING')
        const operation = await client.request<{ status?: string; status_code?: number }>('GET', state.rebuildOperation, null, 8000)
        if (operation.status !== 'Success' || operation.status_code !== 200) throw Error('REBUILD_OPERATION_NOT_CONFIRMED')
      }
      const remote = await source()
      const config = remote!.config || {}
      const hash = rebuildConfigHash(config)
      // Incus volatile runtime keys change after a successful operation. Bind
      // the user-supplied configuration separately from those runtime keys.
      if (hash !== state.rebuildConfigHash || typeof state.pendingRootPassword !== 'string') throw Error('REBUILD_CONFIG_CHANGED')
      await persist({ rebuildCompleted: true })
      return { config, encryptedPassword: state.pendingRootPassword as string }
    },
    originalDeleted: () => { removed = true },
    async prepareTarget(name: string, type: string) {
      await check()
      const current = await prisma.instanceTask.findUniqueOrThrow({ where: { id: task.id } })
      if (record(current.replacementState).targetAttempt) throw Error('REINSTALL_TARGET_RECONCILIATION_REQUIRED')
      target = { name, type, attempt: randomUUID() }
      await persist({ targetAttempt: target.attempt, targetIncusId: name, targetHostIdentity: hostIdentity,
        targetEndpointHash: managedCleanupEndpointHash(original), targetType: type, targetPhase: 'prepared',
        sourceIncusId: instance.incusId, sourceOwnerId: instance.userId, sourceUuid: saved.uuid,
        sourceCreatedAt: saved.createdAt, sourceType: expectedType })
      return target.attempt
    },
    async proof(recreate: boolean) {
      const remote = recreate ? await targetIdentity() : await source()
      if (!remote || !Number.isFinite(Date.parse(remote.created_at))) throw Error('REINSTALL_TARGET_IDENTITY_MISSING')
      const attempt = recreate ? target!.attempt : remote.config?.['user.payincus.provisioning-attempt']
      if (recreate && !validUuid(attempt)) throw Error('REINSTALL_PROVISIONING_IDENTITY_MISSING')
      const uuid = remote.config!['volatile.uuid']
      await persist({ targetHostIdentity: hostIdentity, targetIncusId: remote.name, targetUuid: uuid,
        targetCreatedAt: remote.created_at, targetPhase: recreate ? 'verified' : 'rebuild_uncertain' })
      return { ...specs, ...(validUuid(attempt) ? { managedCleanup: { attempt, uuid, endpointHash: managedCleanupEndpointHash(original) } } : {}),
        recoveryIdentity: { uuid, createdAt: remote.created_at, project: 'default' } } as Prisma.InputJsonValue
    },
    async complete(data: Prisma.InstanceUpdateInput, beforeComplete?: (tx: Prisma.TransactionClient) => Promise<void>) {
      await check()
      await prisma.$transaction(async tx => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '2s'`
        if (!await tryAdvisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, instance.id)) throw Error('REINSTALL_LANE_BUSY')
        await tx.$queryRaw`SELECT id FROM instances WHERE id = ${instance.id} FOR UPDATE`
        await tx.$queryRaw`SELECT id FROM instance_tasks WHERE id = ${task.id} FOR UPDATE`
        await tx.$queryRaw`SELECT id FROM hosts WHERE id = ${host.id} FOR SHARE`
        const row = await tx.instance.findUniqueOrThrow({ where: { id: instance.id } })
        assertInstanceMayBoot(row)
        const current = await tx.instanceTask.findUniqueOrThrow({ where: { id: task.id } })
        if (recoveryHeld() || current.status !== 'PROCESSING' || current.startedAt?.getTime() !== task.startedAt?.getTime() ||
          current.retryCount !== task.retryCount || current.operationIdentity !== task.operationIdentity ||
          Date.now() - task.startedAt!.getTime() >= 30 * 60000 || row.incusId !== instance.incusId || row.hostId !== host.id || row.userId !== instance.userId ||
          ['deleted', 'suspended'].includes(row.status) || row.provisioningCleanupPending || row.deletionBillingPending ||
          transferHostIdentity(await tx.host.findUniqueOrThrow({ where: { id: host.id } })) !== hostIdentity ||
          !(record(current.replacementState).targetPhase === 'verified' || task.taskType === 'rebuild' && record(current.replacementState).rebuildCompleted === true)) throw Error('REINSTALL_TASK_IDENTITY_CHANGED')
        await assertHostNotMaintaining(host.id, tx)
        if (!await authorizeUserWrite(tx, task.userId, { sid: task.actorSid ?? undefined, iat: task.actorIat ?? undefined })) throw Error('REINSTALL_AUTHORIZATION_CHANGED')
        const actor = await tx.user.findUniqueOrThrow({ where: { id: task.userId } })
        if (task.operationEntry === 'host' && actor.id !== host.userId && actor.role !== 'admin') throw Error('REINSTALL_AUTHORIZATION_CHANGED')
        if (beforeComplete) await beforeComplete(tx)
        if (task.taskType === 'rebuild') await tx.trafficSnapshot.deleteMany({ where: { instanceId: instance.id } })
        await tx.instance.update({ where: { id: instance.id }, data })
        const { pendingRootPassword: _password, ...receipt } = record(current.replacementState)
        await tx.instanceTask.update({ where: { id: task.id }, data: { status: 'COMPLETED', finishedAt: new Date(), progress: 'completed',
          replacementState: { ...receipt, targetPhase: 'verified' } as Prisma.InputJsonValue } })
      }, { maxWait: 3000, timeout: 10000 })
    },
    async phase(value: string) { await persist({ targetPhase: value }) }
  }
}

/** Reconcile only the recorded copy after interruption. Before a switch, clean
 * the failed target; after a durable switch, clean the recorded original UUID. */
export async function reconcileInterruptedReinstalls(isRunning: (id: number) => boolean = () => false) {
  if (recoveryHeld()) return
  const tasks = await prisma.instanceTask.findMany({ where: {
    taskType: { in: ['recreate', 'clone', 'change_host'] }, status: { in: ['PROCESSING', 'FAILED'] },
    AND: [{ OR: [{ replacementState: { path: ['cleanupNextAt'], equals: Prisma.AnyNull } }, { replacementState: { path: ['cleanupNextAt'], lte: new Date().toISOString() } }] }],
    OR: [{ replacementState: { path: ['targetPhase'], equals: 'cleanup_pending' } },
      { replacementState: { path: ['targetPhase'], equals: 'source_cleanup' } },
      ...['prepared', 'reserved', 'creating', 'verified'].map(phase => ({ startedAt: { lt: new Date(Date.now() - 30 * 60000) }, replacementState: { path: ['targetPhase'], equals: phase } }))]
  }, orderBy: { id: 'asc' }, take: 10 })
  for (const task of tasks) {
    if (isRunning(task.id)) continue
    let claimed: Record<string, any> | undefined
    try {
      // A busy lane does not consume the remote-write budget. Claim and persist
      // the budget in a short transaction before any network I/O.
      claimed = await prisma.$transaction(async tx => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '2s'`
        if (!await tryAdvisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, task.instanceId)) return
        await tx.$queryRaw`SELECT id FROM instances WHERE id = ${task.instanceId} FOR UPDATE`
        await tx.$queryRaw`SELECT id FROM instance_tasks WHERE id = ${task.id} FOR UPDATE`
        const current = await tx.instanceTask.findUniqueOrThrow({ where: { id: task.id } })
        const state = record(current.replacementState)
        if (recoveryHeld() || !['PROCESSING', 'FAILED'].includes(current.status) ||
          !isDeepStrictEqual(current.replacementState, task.replacementState)) return
        const next = { ...state, cleanupAttempts: Math.min(2147483647,(state.cleanupAttempts || 0) + 1),
          cleanupFromPhase: state.cleanupFromPhase || state.targetPhase,
          cleanupNextAt: new Date(Date.now() + 60000).toISOString(),
          targetPhase: state.targetPhase === 'source_cleanup' ? 'source_cleanup' : 'cleanup_pending' }
        await tx.instanceTask.update({ where: { id: task.id }, data: { status: 'PROCESSING', replacementState: next as Prisma.InputJsonValue,
          error: `清理核验第${next.cleanupAttempts}次；保留占用，等待原实例和存储核验` } })
        return next
      }, { timeout: 6000, maxWait: 2000 })
      if (!claimed) continue
      const state = claimed
      const deadline = Date.now() + 22000
      await prisma.$transaction(async tx => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '2s'`
        if (!await tryAdvisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, task.instanceId)) throw Error('CLEANUP_LANE_BUSY')
        await tx.$queryRaw`SELECT id FROM instances WHERE id = ${task.instanceId} FOR UPDATE`
        await tx.$queryRaw`SELECT id FROM instance_tasks WHERE id = ${task.id} FOR UPDATE`
        const current = await tx.instanceTask.findUniqueOrThrow({ where: { id: task.id } })
        const row = await tx.instance.findUniqueOrThrow({ where: { id: task.instanceId } })
        if (recoveryHeld() || current.status !== 'PROCESSING' || !isDeepStrictEqual(current.replacementState, state)) throw Error('CLEANUP_CLAIM_CHANGED')
        const sourceCleanup = state.targetPhase === 'source_cleanup'
        const hostId = sourceCleanup ? state.sourceHostId : task.targetHostId || task.hostId
        await tx.$queryRaw`SELECT id FROM hosts WHERE id = ${hostId} FOR UPDATE`
        const host = await tx.host.findUniqueOrThrow({ where: { id: hostId } })
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${task.userId} FOR SHARE`
        const actor = await tx.user.findUnique({ where: { id: task.userId } })
        if (!actor || actor.status !== 'active' || !await authorizeUserWrite(tx, task.userId, {
          sid: task.actorSid ?? undefined, iat: task.actorIat ?? undefined
        })) throw Error('CLEANUP_AUTHORIZATION_CHANGED')
        const sourceOwner = await tx.host.findUnique({ where: { id: state.sourceHostId || task.hostId }, select: { userId: true } })
        if (actor.id !== state.sourceOwnerId && actor.id !== sourceOwner?.userId && actor.role !== 'admin') throw Error('CLEANUP_AUTHORIZATION_CHANGED')
        if (row.userId !== state.sourceOwnerId || row.provisioningCleanupPending || row.deletionBillingPending ||
          row.status==='deleted' || transferHostIdentity(host) !== (sourceCleanup ? state.sourceHostIdentity : state.targetHostIdentity)) throw Error('CLEANUP_ORIGINAL_IDENTITY_CHANGED')
        if (sourceCleanup) {
          if (row.hostId !== task.targetHostId || row.incusId !== state.targetIncusId ||
            record(record(row.snapshottedSpecs).recoveryIdentity).uuid !== state.targetUuid) throw Error('CLEANUP_SWITCH_NOT_CONFIRMED')
        } else if (row.incusId !== state.sourceIncusId || row.hostId !== (state.sourceHostId || task.hostId)) throw Error('CLEANUP_SOURCE_CHANGED')
        const client = await getIncusClient(host, tx, 6000)
        if (!sourceCleanup && managedCleanupEndpointHash(client) !== state.targetEndpointHash) throw Error('CLEANUP_ENDPOINT_CHANGED')
        const guarded = new Proxy(client, { get(object, property) {
          if (property === 'request') return async (...args: Parameters<IncusClient['request']>) => {
            if (recoveryHeld() || Date.now() >= deadline) throw Error('CLEANUP_DEADLINE_OR_RECOVERY')
            args[3] = Math.min(args[3] ?? 8000, deadline - Date.now())
            return object.request(...args)
          }
          const value = Reflect.get(object, property)
          return typeof value === 'function' ? value.bind(object) : value
        } })
        if (sourceCleanup) {
          const path = `/1.0/instances/${encodeURIComponent(state.sourceIncusId)}`
          const sourceGuard = new Proxy(guarded, { get(object, property) {
            if (property === 'request') return async (...args: Parameters<IncusClient['request']>) => {
              if (args[0] !== 'GET') {
                try {
                  const remote = await guarded.request<IncusInstance>('GET', path)
                  if (!validUuid(state.sourceUuid) || remote.config?.['volatile.uuid'] !== state.sourceUuid ||
                    remote.name !== state.sourceIncusId || remote.type !== state.sourceType || remote.created_at !== state.sourceCreatedAt ||
                    state.sourceAttempt && remote.config?.['user.payincus.provisioning-attempt'] !== state.sourceAttempt) throw Error('CLEANUP_SOURCE_GUEST_CHANGED')
                } catch (error) {
                  if (!(error instanceof IncusApiError) || error.statusCode !== 404 || error.path !== path) throw error
                }
              }
              return guarded.request(...args)
            }
            const value = Reflect.get(object, property)
            return typeof value === 'function' ? value.bind(object) : value
          } })
          try {
            await stopInstance(sourceGuard, state.sourceIncusId, true)
          } catch (error) {
            if (!(error instanceof IncusApiError) || error.statusCode !== 404 ||
              ![path, path + '/state'].includes(error.path)) throw error
          }
          await deleteInstance(sourceGuard, state.sourceIncusId)
        } else if (state.targetIncusId) {
          if (state.targetIncusId === row.incusId || !validUuid(state.targetAttempt)) throw Error('CLEANUP_TARGET_IDENTITY_MISSING')
          await cleanupManagedInstanceRemote(guarded, state.targetIncusId, state.targetAttempt, deadline, state.targetUuid)
        } else if (state.cleanupFromPhase !== 'reserved' || task.taskType !== 'change_host') throw Error('CLEANUP_TARGET_MISSING')
        if (task.taskType === 'recreate') {
          // Preparation precedes original deletion. A failed DELETE may have
          // left the original intact; do not report it lost merely because the
          // never-delivered replacement is absent.
          const path = `/1.0/instances/${encodeURIComponent(state.sourceIncusId)}`
          try {
            const remote = await guarded.request<IncusInstance>('GET', path)
            if (remote.name !== state.sourceIncusId || remote.config?.['volatile.uuid'] !== state.sourceUuid ||
              remote.created_at !== state.sourceCreatedAt || remote.type !== state.sourceType) throw Error('CLEANUP_SOURCE_GUEST_CHANGED')
          } catch (error) {
            if (!(error instanceof IncusApiError) || error.statusCode !== 404 || error.path !== path) throw error
            await tx.instance.update({ where: { id: row.id }, data: { status: 'error' } })
          }
          if (state.targetIpv4) await tx.natIpv4Reservation.deleteMany({ where: { hostId, address: state.targetIpv4 } })
        } else {
          // The creation receipt is the resource fence even if a synchronizer
          // recalculated counters from instances during the interrupted attempt.
          const totals = await tx.instance.aggregate({ where: { hostId, status: { not: 'deleted' } }, _sum: { cpu: true, memory: true, disk: true } })
          const portCount = await tx.portMapping.count({ where: { hostId } })
          await tx.host.update({ where: { id: hostId }, data: {
            cpuUsed: Math.max(totals._sum.cpu || 0, host.cpuUsed - row.cpu),
            memoryUsed: Math.max(totals._sum.memory || 0, host.memoryUsed - row.memory),
            diskUsed: Math.max(totals._sum.disk || 0, host.diskUsed - row.disk),
            ...(sourceCleanup ? { natPortsUsedCount: portCount } : {})
          } })
          if (!sourceCleanup && state.targetIpv4) await tx.natIpv4Reservation.deleteMany({ where: { hostId, address: state.targetIpv4 } })
        }
        await tx.instanceTask.update({ where: { id: task.id }, data: { status: sourceCleanup ? 'COMPLETED' : 'FAILED',
          progress: sourceCleanup ? 'completed' : 'cleanup_completed', finishedAt: new Date(),
          error: sourceCleanup ? null : task.taskType === 'recreate' ? '本次未交付副本及存储已核验清理；已按原身份核对旧实例是否仍存在，账期和占用保留，请查看实例状态' :
            '本次未交付副本及存储已核验清理，原客户和账期保留；可重新提交任务',
          replacementState: { ...state, targetPhase: sourceCleanup ? 'verified' : 'cleaned' } as Prisma.InputJsonValue } })
      }, { maxWait: 2000, timeout: 25000 })
    } catch (error) {
      if (!claimed) continue
      const reason = error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message) ? error.message : 'REMOTE_OR_DATABASE_UNCONFIRMED'
      if (reason === 'CLEANUP_LANE_BUSY') {
        await prisma.instanceTask.updateMany({ where: { id: task.id, status: 'PROCESSING', replacementState: { equals: claimed as Prisma.InputJsonValue } },
          data: { replacementState: { ...claimed, cleanupAttempts: claimed.cleanupAttempts - 1 } as Prisma.InputJsonValue,
            error: '实例正在执行其他操作，保留占用，60秒后继续清理核验' } })
        continue
      }
      await prisma.instanceTask.updateMany({ where: { id: task.id, status: 'PROCESSING', replacementState: { equals: claimed as Prisma.InputJsonValue } },
        data: { progress: 'cleanup_pending',
          error: `宿主${task.hostId}实例${task.instanceId}清理核验未完成（${reason}）；已尝试${claimed.cleanupAttempts}次。保留原资源，60秒后自动续接` } }).catch(() => {})
    }
  }
}
