import { Prisma } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { advisoryTransactionLock, INSTANCE_OPERATION_LOCK_NAMESPACE } from '../db/advisory-locks.js'
import { getIncusClient } from '../lib/incus/incus-pool.js'
import { transferHostIdentity } from '../lib/transfer-host-identity.js'
import { dedicatedIpv6State, normalizeIpv6 } from '../lib/host-public-ipv6.js'
import { recoveryHeld } from './platform-backup-core.js'
import { inspectPoolRecovery, recoveryScope } from './host-pool-recovery.js'
import { automaticOperationAudit } from '../lib/automatic-operation-audit.js'

/** Restore historical source flags only before target creation or after its
 * durable cleanup verified absence. Current requests preserve the source. */
export async function recoverFailedReplacement(taskId: number, connect = getIncusClient): Promise<void> {
  if (recoveryHeld()) return
  const initial = await prisma.instanceTask.findUnique({ where: { id: taskId } })
  if (!initial) return
  const scope = recoveryScope()
  try {
    await prisma.$transaction(async tx => {
      await advisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, initial.instanceId)
      await tx.$queryRaw`SELECT id FROM instances WHERE id = ${initial.instanceId} FOR UPDATE`
      const instance = await tx.instance.findUnique({ where: { id: initial.instanceId } })
      if (!instance || instance.dedicatedNetworkReady || !instance.dedicatedIpv4 || instance.status !== 'running') return
      await tx.$queryRaw`SELECT id FROM hosts WHERE id = ${instance.hostId} FOR UPDATE`
      await tx.$queryRaw`SELECT id FROM instance_tasks WHERE id = ${taskId} FOR UPDATE`
      const task = await tx.instanceTask.findUniqueOrThrow({ where: { id: taskId } })
      const host = await tx.host.findUniqueOrThrow({ where: { id: instance.hostId } })
      const state = task.replacementState as Record<string, unknown> | null
      const previous = state?.sourceRecovery as { nextAttemptAt?: string; status?: string; attempts?: number } | undefined
      if (previous?.status === 'done' || (previous?.nextAttemptAt && Date.parse(previous.nextAttemptAt) > Date.now())) return
      if (!state || task.status !== 'FAILED' || state.stage !== 'cleaned' || (state.targetIncusId && state.targetCleanupVerified !== true) ||
          state.sourceHostId !== host.id || state.sourceIncusId !== instance.incusId || !host.poolFaulted ||
          host.poolCleanup !== null || recoveryHeld()) return
      if (state.sourceHostIdentity) {
        if (state.sourceHostIdentity !== transferHostIdentity(host)) throw new Error('SOURCE_HOST_IDENTITY_CHANGED')
      } else if (!host.serverCertificate || !host.serverFingerprint || !host.certPath || !host.keyPath) {
        // v1.7.9 did not save sourceHostIdentity. Historical adoption uses the
        // already pinned TLS host plus the successful delivery below; no new
        // certificate or key is trusted or generated here.
        throw new Error('SOURCE_ORIGINAL_TRUST_MISSING')
      }
      const later = await tx.instanceTask.count({ where: { instanceId: instance.id, id: { gt: task.id } } })
      if (later) throw new Error('SOURCE_NEWER_TASK_EXISTS')
      // Historical states have no source-ready snapshot. Require the actual
      // completed delivery that created this exact name before the failed move.
      const delivered = await tx.instanceTask.findFirst({ where: { instanceId: instance.id, taskType: 'replace_host',
        status: 'COMPLETED', targetHostId: host.id, id: { lt: task.id },
        replacementState: { path: ['targetIncusId'], equals: instance.incusId } }, orderBy: { id: 'desc' } })
      if (!delivered?.finishedAt || (delivered.replacementState as Record<string, unknown>)?.stage !== 'delivered') throw new Error('SOURCE_DELIVERY_EVIDENCE_MISSING')
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${task.userId} FOR SHARE`
      const actor = await tx.user.findUnique({ where: { id: task.userId }, select: { role: true, status: true } })
      if (actor?.role !== 'admin' || actor.status !== 'active') throw new Error('SOURCE_AUTHORITY_CHANGED')
      const inspected = await inspectPoolRecovery(tx, host.id, connect, scope, undefined, instance.id)
      if (!inspected.report.canRecover || inspected.report.mode !== 'preserve' || !inspected.client) {
        throw new Error(inspected.report.blockers.join(',') || 'SOURCE_NOT_VERIFIED')
      }
      const remote = inspected.instances[0]
      const created = Date.parse(remote?.created_at || '')
      if (!/^[a-f0-9-]{36}$/i.test(remote?.config?.['volatile.uuid'] || '') || !Number.isFinite(created) ||
          created < delivered.createdAt.getTime() || created > delivered.finishedAt.getTime()) throw new Error('SOURCE_IDENTITY_NOT_VERIFIED')
      const network = await inspected.client.request<{ network?: Record<string, { addresses?: Array<{ address: string }> }> }>(
        'GET', `/1.0/instances/${encodeURIComponent(instance.incusId)}/state`)
      const addresses = Object.values(network.network || {}).flatMap(value => value.addresses || []).map(value => normalizeIpv6(value.address) || value.address)
      const ipv6 = dedicatedIpv6State(instance.dedicatedIpv6)
      if (!instance.ipv4 || !addresses.includes(instance.ipv4) || ipv6?.mappings.some(mapping =>
        !addresses.includes(mapping.privateIp) || (mapping.fallbackIp && !addresses.includes(mapping.fallbackIp)))) throw new Error('SOURCE_NETWORK_NOT_VERIFIED')
      const confirmed = await inspected.client.request<typeof remote>('GET', `/1.0/instances/${encodeURIComponent(instance.incusId)}`)
      if (confirmed.name !== remote.name || confirmed.created_at !== remote.created_at || confirmed.status !== 'Running' ||
          confirmed.config?.['volatile.uuid'] !== remote.config?.['volatile.uuid'] || (confirmed.project || 'default') !== 'default') throw new Error('SOURCE_IDENTITY_NOT_VERIFIED')
      scope.remaining()
      if (recoveryHeld()) throw new Error('PLATFORM_RECOVERY_HELD')
      await tx.instance.update({ where: { id: instance.id }, data: { dedicatedNetworkReady: true } })
      await tx.host.update({ where: { id: host.id }, data: { poolFaulted: false } })
      await tx.instanceTask.update({ where: { id: task.id }, data: { replacementState: { ...state, sourceHostIdentity: transferHostIdentity(host),
        sourceRecovery: { status: 'done', checkedAt: new Date().toISOString(), uuid: remote.config!['volatile.uuid'] } } as Prisma.InputJsonValue } })
      await tx.log.create({ data: { userId: task.userId, instanceId: instance.id, module: 'host', action: 'host.replacement.source_recovered', result: 'success',
        content: automaticOperationAudit({ hostId: host.id, hostName: host.name, instanceId: instance.id, stage: '核验失败换机的原客户机器',
          attempt: (previous?.attempts || 0) + 1, result: `恢复成功；换机任务 #${task.id}；原实例、磁盘、网络和已售库存保持原状` }) } })
    }, { timeout: scope.remaining(), maxWait: 5000 })
  } catch (error) {
    const state = initial.replacementState as Record<string, unknown> | null
    const attempts = ((state?.sourceRecovery as { attempts?: number } | undefined)?.attempts || 0) + 1
    if (state) await prisma.$transaction(async tx => {
      const nextAttemptAt = new Date(Date.now() + Math.min(1800000, 30000 * 2 ** Math.min(attempts, 6))).toISOString()
      const code = error instanceof Error && /^[a-zA-Z0-9_, -]{1,160}$/.test(error.message) ? error.message : 'SOURCE_CHECK_RETRY'
      const updated = await tx.instanceTask.updateMany({ where: { id: taskId, status: 'FAILED', replacementState: { equals: initial.replacementState! } },
        data: { replacementState: { ...state, sourceRecovery: { status: 'retry', checkedAt: new Date().toISOString(), attempts, nextAttemptAt, error: code } } as Prisma.InputJsonValue } })
      if (updated.count && typeof state.sourceHostId === 'number') {
        const host = await tx.host.findUnique({ where: { id: state.sourceHostId } })
        if (host) await tx.log.create({ data: { userId: initial.userId, instanceId: initial.instanceId, module: 'host', action: 'host.replacement.source_retry', result: 'warning',
          content: automaticOperationAudit({ hostId: host.id, hostName: host.name, instanceId: initial.instanceId, stage: '核验失败换机的原客户机器',
            attempt: attempts, result: '核验未完成；保留客户机器和已售库存，后台继续复核', error: code, nextAttemptAt }) } })
      }
    })
  } finally { scope.close() }
}

let sourceCursor = 0
export async function recoverFailedReplacementSources(connect = getIncusClient): Promise<void> {
  const tasks = await prisma.instanceTask.findMany({ where: { taskType: 'replace_host', status: 'FAILED',
    instance: { dedicatedNetworkReady: false, dedicatedIpv4: true, host: { poolFaulted: true } },
    replacementState: { path: ['stage'], equals: 'cleaned' } }, orderBy: { id: 'asc' }, select: { id: true, replacementState: true } })
  const due = tasks.filter(task => {
    const recovery = (task.replacementState as { sourceRecovery?: { status?: string; nextAttemptAt?: string } } | null)?.sourceRecovery
    return recovery?.status !== 'done' && (!recovery?.nextAttemptAt || Date.parse(recovery.nextAttemptAt) <= Date.now())
  })
  const rotated = [...due.filter(task => task.id > sourceCursor), ...due.filter(task => task.id <= sourceCursor)]
  for (const task of rotated.slice(0, 5)) {
    if (recoveryHeld()) return
    sourceCursor = task.id
    try { await recoverFailedReplacement(task.id, connect) } catch { console.warn(`[HostRepair] Source task #${task.id} retry could not be saved; next task continues`) }
  }
}
