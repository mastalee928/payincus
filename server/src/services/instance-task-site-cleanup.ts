import { Prisma } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { INSTANCE_OPERATION_LOCK_NAMESPACE, tryAdvisoryTransactionLock } from '../db/advisory-locks.js'
import { cleanupProxySitesForLifecycle, proxySiteHostIdentity } from '../db/proxy-site-operations.js'

export type InstanceTaskSiteCleanupState = {
  kind: 'instance_task_sites_v1'
  instanceId: number; ownerId: number; hostId: number; incusId: string; hostIdentity: string
  sites: Array<{ id: number; siteKey: string; revision: number }>
  phase: 'pending' | 'cleared'
}

/** Before any old-instance mutation or target reservation, save the source list
 * and require durable, identity-checked Caddy delete receipts for every site. */
export async function prepareInstanceTaskSiteCleanup(taskId: number,
  expected: { id: number; user_id: number; host_id: number; incus_id: string }): Promise<void> {
  const state = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`
    if (!await tryAdvisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, expected.id)) throw Error('INSTANCE_SITE_CLEANUP_BUSY')
    await tx.$queryRaw`SELECT id FROM instances WHERE id = ${expected.id} FOR UPDATE`
    const instance = await tx.instance.findUnique({ where: { id: expected.id } })
    if (!instance || instance.userId !== expected.user_id || instance.hostId !== expected.host_id || instance.incusId !== expected.incus_id ||
      instance.status === 'deleted' || instance.provisioningCleanupPending || instance.deletionBillingPending) throw Error('INSTANCE_SITE_CLEANUP_TARGET_CHANGED')
    await tx.$queryRaw`SELECT id FROM hosts WHERE id = ${expected.host_id} FOR SHARE`
    const host = await tx.host.findUniqueOrThrow({ where: { id: expected.host_id } })
    const task = await tx.instanceTask.findUnique({ where: { id: taskId } })
    if (!task || task.status !== 'PROCESSING' || task.instanceId !== expected.id || !['recreate', 'change_host'].includes(task.taskType)) {
      throw Error('INSTANCE_SITE_CLEANUP_CLAIM_CHANGED')
    }
    const saved = task.replacementState as unknown as InstanceTaskSiteCleanupState | null
    if (saved && (saved.kind !== 'instance_task_sites_v1' || saved.instanceId !== instance.id || saved.ownerId !== instance.userId ||
      saved.hostId !== host.id || saved.incusId !== instance.incusId || saved.hostIdentity !== proxySiteHostIdentity(host))) {
      throw Error('INSTANCE_SITE_CLEANUP_IDENTITY_CHANGED')
    }
    const sites = await tx.proxySite.findMany({ where: { instanceId: instance.id },
      select: { id: true, siteKey: true, revision: true, hostId: true }, orderBy: { id: 'asc' } })
    if (sites.some(site => site.hostId !== host.id)) throw Error('INSTANCE_SITE_CLEANUP_SITE_HOST_CHANGED')
    if (sites.length && (!host.caddyEnabled || !host.caddyUsername || !host.caddyPassword || !(host.natPublicIp || host.ipAddress))) {
      throw Error(`源宿主 ${host.id} 的 Caddy 未启用或地址/凭据缺失；反代站点记录和原实例保持。请先恢复源 Caddy 配置，再重新提交任务`)
    }
    if (saved?.phase === 'cleared') {
      if (sites.length) throw Error('INSTANCE_SITE_CLEANUP_NEW_SITES')
      return saved
    }
    const result: InstanceTaskSiteCleanupState = saved || { kind: 'instance_task_sites_v1', instanceId: instance.id,
      ownerId: instance.userId, hostId: host.id, incusId: instance.incusId, hostIdentity: proxySiteHostIdentity(host),
      sites: sites.map(({ id, siteKey, revision }) => ({ id, siteKey, revision })), phase: 'pending' }
    await tx.instanceTask.update({ where: { id: taskId }, data: { progress: 'cleaning_proxy_sites', replacementState: result as Prisma.InputJsonValue } })
    return result
  }, { maxWait: 5000, timeout: 15000 })
  if (state.phase === 'cleared') return
  const result = await cleanupProxySitesForLifecycle(expected.id, { kind: 'instance_task', id: taskId }, state.sites)
  if (result.pending) throw Error(`源宿主 ${state.hostId} 的反代站点尚未清理；原实例与目标资源未改动。${result.errors.join('; ')}。请先恢复源 Caddy 配置/连接，清理完成后重新提交任务`)
  await prisma.$transaction(async tx => {
    if (!await tryAdvisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, expected.id)) throw Error('INSTANCE_SITE_CLEANUP_BUSY')
    await tx.$queryRaw`SELECT id FROM instances WHERE id = ${expected.id} FOR UPDATE`
    const current = await tx.instance.findUnique({ where: { id: expected.id } })
    if (!current || current.hostId !== state.hostId || current.userId !== state.ownerId || current.incusId !== state.incusId ||
      await tx.proxySite.count({ where: { instanceId: expected.id } })) throw Error('INSTANCE_SITE_CLEANUP_TARGET_CHANGED')
    const updated = await tx.instanceTask.updateMany({ where: { id: taskId, instanceId: expected.id, status: 'PROCESSING', progress: 'cleaning_proxy_sites' },
      data: { progress: 'proxy_sites_cleared', replacementState: { ...state, phase: 'cleared' } as Prisma.InputJsonValue } })
    if (updated.count !== 1) throw Error('INSTANCE_SITE_CLEANUP_CLAIM_CHANGED')
  })
}
