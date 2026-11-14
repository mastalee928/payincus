import { prisma } from '../db/prisma.js'
import { getHostById } from '../db/hosts.js'
import { getIncusClient } from '../lib/incus/incus-pool.js'
import { ensureIsolatedPool, pruneIsolatedPoolImageVolumes } from '../lib/pool-disk-isolation-remote.js'
import { HOST_OCCUPIED_INSTANCE_WHERE } from '../lib/host-resource-usage.js'
import { hostMaintenanceBlocked } from '../lib/host-maintenance-gate.js'
import { transferHostIdentity } from '../lib/transfer-host-identity.js'
import { hostProvisioningToolsReady } from '../lib/host-provisioning-tools.js'
import { POOL_DISK_NAME, isolatedPoolConfiguration } from '../lib/pool-disk-isolation.js'
import { recoveryHeld } from './platform-backup-core.js'

/** Only an empty registered pool is converted. Customer deletion remains a
 * separately authorized lifecycle operation; this worker never deletes guests.
 */
export async function prepareEmptyPoolDisk(hostId: number): Promise<boolean> {
  if (recoveryHeld()) return false
  const original = await prisma.host.findUniqueOrThrow({ where: { id: hostId }, include: { agent: true, storagePools: true, onboardingNode: true } })
  if (!original.singleTenant || original.status !== 'online' || !original.isInstalled || original.installPending ||
    hostMaintenanceBlocked(original.securityHardening) || original.onboardingNode && original.onboardingNode.status !== 'succeeded') return false
  if (original.storagePools.some(p => p.name === POOL_DISK_NAME && p.purpose === 'instance_data' && isolatedPoolConfiguration({ driver: p.driver, config: p.config as Record<string,string> }))) return true
  if (!hostProvisioningToolsReady(original.agent) || (original.agent?.lastReport as { hostProvisioningStatus?: { diskTools?: boolean } } | null)?.hostProvisioningStatus?.diskTools !== true) return false
  const target = await getHostById(hostId)
  if (!target) return false
  const transport = await getIncusClient(target, prisma, 5000)
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL lock_timeout = '2s'`
    await tx.$queryRaw`SELECT id FROM instances WHERE host_id = ${hostId} ORDER BY id FOR UPDATE`
    await tx.$queryRaw`SELECT id FROM hosts WHERE id = ${hostId} FOR UPDATE`
    const host = await tx.host.findUniqueOrThrow({ where: { id: hostId }, include: { agent: true } })
    if (recoveryHeld() || host.status !== 'online' || host.installPending || !host.singleTenant ||
      !hostProvisioningToolsReady(host.agent) || (host.agent?.lastReport as {hostProvisioningStatus?:{diskTools?:boolean}} | null)?.hostProvisioningStatus?.diskTools !== true ||
      transferHostIdentity(host) !== transferHostIdentity(original) || hostMaintenanceBlocked(host.securityHardening) ||
      await tx.instance.count({ where: { hostId, ...HOST_OCCUPIED_INSTANCE_WHERE } }) ||
      await tx.checkoutReservation.count({ where: { hostId } }) ||
      await tx.instanceTask.count({ where: { status: { in: ['PENDING','PROCESSING'] }, OR: [{ hostId }, { targetHostId: hostId }] } }) ||
      await tx.restoreTask.count({ where: { hostId, status: { in: ['PENDING','PROCESSING'] } } }) ||
      await tx.backupUploadTask.count({ where: { hostId, status: { in: ['PENDING','PROCESSING'] } } })) return false
    const client = transport.withMaintenanceDatabase(tx)
    const registered = await tx.storagePool.findUnique({ where: { hostId_name: { hostId, name: POOL_DISK_NAME } } })
    const checked = await ensureIsolatedPool(client, host.storageSize, registered?.driver === 'btrfs', async () => {
      if (recoveryHeld()) throw Error('PLATFORM_RECOVERY_HELD')
      // Assert the transaction is still alive before every remote mutation.
      await tx.$queryRaw`SELECT id FROM hosts WHERE id = ${hostId} FOR UPDATE`
    })
    await tx.storagePool.upsert({ where: { hostId_name: { hostId, name: POOL_DISK_NAME } },
      create: { hostId, name: POOL_DISK_NAME, driver: checked.driver, purpose: 'instance_data', config: checked.config },
      update: { driver: checked.driver, purpose: 'instance_data', config: checked.config } })
    await tx.host.update({ where: { id: hostId }, data: { storageDriver: 'lvm' } })
    await tx.$executeRaw`UPDATE hosts SET resource_snapshot = jsonb_set(COALESCE(resource_snapshot, '{}'::jsonb), '{diskIsolation}',
      ${JSON.stringify({status:'ready',driver:'lvm',filesystem:'btrfs',checkedAt:new Date().toISOString()})}::jsonb) WHERE id=${hostId}`
    await tx.log.create({ data: { userId: host.userId, module: 'host', action: 'host.pool.disk_isolation', result: 'success',
      content: `宿主 #${hostId} 已完成独立实例磁盘准备；新建实例仅显示自身文件系统容量` } })
    return true
  }, { maxWait: 2000, timeout: 90000 })
}

/** Existing and future managed pools: cached image LVs never permanently
 * consume the customer's full-disk allowance. No customer volume is deleted. */
export async function prunePoolDiskImageCache(hostId: number): Promise<void> {
  if (recoveryHeld()) return
  const original = await prisma.host.findUniqueOrThrow({ where: { id: hostId } })
  if (!original.singleTenant || original.status !== 'online' || original.installPending || hostMaintenanceBlocked(original.securityHardening)) return
  const transport = await getIncusClient((await getHostById(hostId))!, prisma, 5000)
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM instances WHERE host_id=${hostId} ORDER BY id FOR UPDATE`
    await tx.$queryRaw`SELECT id FROM hosts WHERE id=${hostId} FOR UPDATE`
    const host = await tx.host.findUniqueOrThrow({ where: { id: hostId } })
    if (recoveryHeld() || !host.singleTenant || host.status !== 'online' || transferHostIdentity(host) !== transferHostIdentity(original) || host.installPending ||
      hostMaintenanceBlocked(host.securityHardening) || await tx.checkoutReservation.count({ where: { hostId } }) ||
      await tx.instance.count({ where: { hostId, status: 'creating' } }) || await tx.instanceTask.count({ where: {
        status: { in: ['PENDING', 'PROCESSING'] }, OR: [{ hostId }, { targetHostId: hostId }] } }) ||
      await tx.restoreTask.count({ where: { hostId, status: { in: ['PENDING', 'PROCESSING'] } } }) ||
      await tx.backupUploadTask.count({ where: { hostId, status: { in: ['PENDING', 'PROCESSING'] } } })) return
    await pruneIsolatedPoolImageVolumes(transport.withMaintenanceDatabase(tx), POOL_DISK_NAME, async () => {
      if (recoveryHeld()) throw Error('PLATFORM_RECOVERY_HELD')
      await tx.$queryRaw`SELECT id FROM hosts WHERE id=${hostId} FOR UPDATE`
    })
  }, { maxWait: 2000, timeout: 60000 })
}

let timer: ReturnType<typeof setTimeout> | undefined, active: Promise<void> | undefined, stopped = true, cursor = 0
async function scan() {
  if (recoveryHeld()) return
  const hosts = await prisma.host.findMany({ where: { id: { gt: cursor }, singleTenant: true, status: 'online', isInstalled: true,
    }, orderBy: { id: 'asc' }, take: 10, select: { id: true } })
  if (!hosts.length) { cursor = 0; return }
  for (const host of hosts) {
    if (stopped) return
    cursor = host.id
    try { await prepareEmptyPoolDisk(host.id) } catch(error) {
      const reason = error instanceof Error && /^POOL_DISK_[A-Z_]+$/.test(error.message) ? error.message : 'POOL_DISK_PREPARATION_PENDING'
      console.warn(`[PoolDisk] 宿主 #${host.id} 独立磁盘准备待自动重试: ${reason}`)
      try { await prisma.$executeRaw`UPDATE hosts SET resource_snapshot = jsonb_set(COALESCE(resource_snapshot, '{}'::jsonb), '{diskIsolation}',
        ${JSON.stringify({status:'retry',reason,nextAttemptAt:new Date(Date.now()+30000).toISOString()})}::jsonb) WHERE id=${host.id}` } catch { /* Keep processing later hosts even if diagnostic persistence fails. */ }
    }
    try { await prunePoolDiskImageCache(host.id) } catch { console.warn(`[PoolDisk] 宿主 #${host.id} 镜像缓存卷待自动释放`) }
  }
}
export function startPoolDiskPreparation() {
  if (!stopped) return
  stopped = false
  const tick = () => { active = scan().catch(() => console.warn('[PoolDisk] 扫描未完成，将自动重试')).finally(() => { active = undefined; if (!stopped) { timer = setTimeout(tick, 30000); timer.unref() } }) }
  timer = setTimeout(tick, 12000); timer.unref()
}
export async function stopPoolDiskPreparation() { stopped = true; clearTimeout(timer); await active }
