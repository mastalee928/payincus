import { Prisma, type InstanceTask } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import * as db from '../db/index.js'
import { advisoryTransactionLock, INSTANCE_OPERATION_LOCK_NAMESPACE } from '../db/advisory-locks.js'
import { lockHostGroups } from './host-groups.js'
import { dedicatedHostReadyWhere, HOST_OCCUPIED_INSTANCE_WHERE, hostPendingMoveWhere } from '../lib/host-resource-usage.js'
import { getIncusClient } from '../lib/incus/index.js'
import { buildInstanceConfig, createInstance, deleteInstance, execWithOutput, restartInstance, startInstance, stopInstance, updateInstance } from '../lib/incus/incus-instances.js'
import { generateIncusConfig } from '../lib/incus-config-generator.js'
import { decryptSensitiveData, encryptSensitiveData } from '../lib/security.js'
import { generateRandomIPv6 } from '../lib/ip-calculator.js'
import { DEDICATED_BANDWIDTH, prepareDedicatedDelivery } from './dedicated-delivery.js'
import { prepareDedicatedIpv6Delivery } from './host-public-ipv6-sync.js'
import { StorageFactory } from '../storage/factory.js'
import { restoreFromStream } from '../lib/incus/incus-restore.js'
import { createLog } from '../db/logs.js'

type ReplacementState = {
  sourceHostId: number; sourceIncusId: string; backupUploadId: number | null
  targetIncusId?: string; ipv4?: string; ipv6?: string | null; storagePool?: string
  stage: 'reserved' | 'creating' | 'delivered' | 'cleaned' | 'cleanup_pending'
}

function replacementConfigurationWhere(instance: { cpu: number; memory: number; disk: number; host: { machineGroupId: number | null; regionGroupId: number | null; resourcePreset: string | null; architecture: string } }, allRegions: boolean): Prisma.HostWhereInput {
  return {
    machineGroupId: instance.host.machineGroupId,
    ...(allRegions ? {} : { regionGroupId: instance.host.regionGroupId }),
    resourcePreset: instance.host.resourcePreset, architecture: instance.host.architecture,
    cpuAllowanceMax: instance.cpu, memoryMax: instance.memory,
    customerDiskGiB: Math.ceil(instance.disk / 1024)
  }
}

export async function replacementCandidates(instanceId: number, allRegions = false) {
  const instance = await prisma.instance.findUniqueOrThrow({ where: { id: instanceId }, include: { host: true } })
  if (!instance.dedicatedIpv4) throw new Error('仅独占实例支持故障换机')
  const hosts = await prisma.host.findMany({ where: {
    ...dedicatedHostReadyWhere(), id: { not: instance.hostId }, singleTenant: true,
    ...replacementConfigurationWhere(instance, allRegions),
    instances: { none: HOST_OCCUPIED_INSTANCE_WHERE }
  }, select: { id: true, name: true, natPublicIp: true, countryCode: true, resourcePreset: true,
    regionGroupId: true, regionGroupEntry: { select: { name: true } },
    cpuAllowanceMax: true, memoryMax: true, storageSize: true, customerDiskGiB: true, cpuUsed: true, memoryUsed: true, diskUsed: true } })
  const reserved = await prisma.instanceTask.findMany({ where: { taskType: { in: ['change_host', 'replace_host'] }, status: { in: ['PENDING', 'PROCESSING'] } }, select: { targetHostId: true } })
  return hosts.filter(host => !reserved.some(task => task.targetHostId === host.id) &&
    host.cpuAllowanceMax - host.cpuUsed >= instance.cpu && host.memoryMax - host.memoryUsed >= instance.memory &&
    host.storageSize * 1024 - host.diskUsed >= instance.disk)
}

export async function requestHostReplacement(instanceId: number, targetHostId: number, adminId: number, backupUploadId?: number | null, allRegions = false) {
  return prisma.$transaction(async tx => {
    await advisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, instanceId)
    await lockHostGroups(tx)
    const instance = await tx.instance.findUniqueOrThrow({ where: { id: instanceId }, include: { host: true } })
    if (!instance.dedicatedIpv4 || !['running', 'stopped', 'error'].includes(instance.status)) throw new Error('实例当前状态不允许换机')
    if (targetHostId === instance.hostId) throw new Error('请选择其他备用机器')
    await tx.$queryRaw`SELECT id FROM hosts WHERE id IN (${instance.hostId}, ${targetHostId}) ORDER BY id FOR UPDATE`
    if (await tx.instanceTask.count({ where: { instanceId, status: { in: ['PENDING', 'PROCESSING'] } } }) ||
        await tx.restoreTask.count({ where: { instanceId, status: { in: ['PENDING', 'PROCESSING'] } } }) ||
        await tx.backupUploadTask.count({ where: { instanceId, status: { in: ['PENDING', 'PROCESSING'] } } })) throw new Error('实例有其他任务正在执行')
    const target = await tx.host.findFirst({ where: { ...dedicatedHostReadyWhere(), id: targetHostId, singleTenant: true,
      ...replacementConfigurationWhere(instance, allRegions),
      instances: { none: HOST_OCCUPIED_INSTANCE_WHERE } } })
    if (!target || await tx.instanceTask.count({ where: hostPendingMoveWhere(targetHostId) }) ||
        target.cpuAllowanceMax - target.cpuUsed < instance.cpu || target.memoryMax - target.memoryUsed < instance.memory ||
        target.storageSize * 1024 - target.diskUsed < instance.disk || (target.customerDiskGiB ?? 0) * 1024 < instance.disk) {
      throw new Error('备用机器已被占用、未就绪或规格不兼容')
    }
    if (backupUploadId) {
      const backup = await tx.backupUploadTask.findFirst({ where: { id: backupUploadId, instanceId, userId: instance.userId,
        status: 'COMPLETED', remoteFileName: { not: null }, storageConfig: { userId: instance.userId } } })
      if (!backup) throw new Error('没有可用于该实例的异地备份')
    }
    if (!instance.rootPassword) throw new Error('实例没有可用的 SSH 密码')
    const state: ReplacementState = { sourceHostId: instance.hostId, sourceIncusId: instance.incusId, backupUploadId: backupUploadId || null, stage: 'reserved' }
    const task = await tx.instanceTask.create({ data: { instanceId, hostId: targetHostId, targetHostId, userId: adminId,
      taskType: 'replace_host', replacementState: state as Prisma.InputJsonValue } })
    // This persistent quarantine survives task timeouts and backend restarts.
    // Only verified cleanup or completed delivery may release the target again.
    await tx.host.update({ where: { id: instance.hostId }, data: { poolFaulted: true } })
    await tx.host.update({ where: { id: targetHostId }, data: { poolFaulted: true,
      cpuUsed: { increment: instance.cpu }, memoryUsed: { increment: instance.memory }, diskUsed: { increment: instance.disk } } })
    await tx.instance.update({ where: { id: instanceId }, data: { dedicatedNetworkReady: false } })
    return { taskId: task.id }
  }, { timeout: 20000 })
}

export async function executeHostReplacement(task: InstanceTask): Promise<void> {
  const state = task.replacementState as unknown as ReplacementState
  if (!state || !task.targetHostId) throw new Error('换机任务数据不完整')
  const targetId = task.targetHostId
  const instance = await prisma.instance.findUniqueOrThrow({ where: { id: task.instanceId } })
  if (instance.hostId === targetId && state.stage === 'delivered') return
  if (instance.hostId !== state.sourceHostId || instance.incusId !== state.sourceIncusId) throw new Error('实例归属已经改变')
  const target = await db.getHostById(targetId)
  if (!target) throw new Error('备用机器不存在')
  let client: Awaited<ReturnType<typeof getIncusClient>> | undefined
  let switched = false
  const assertActive = async () => {
    const current = await prisma.instanceTask.findUnique({ where: { id: task.id }, select: { status: true } })
    if (current?.status !== 'PROCESSING') throw new Error('换机任务已取消或超时')
  }
  const save = async (progress: string) => {
    const updated = await prisma.instanceTask.updateMany({ where: { id: task.id, status: 'PROCESSING' },
      data: { progress, replacementState: state as Prisma.InputJsonValue } })
    if (updated.count !== 1) throw new Error('换机任务已取消或超时')
  }
  try {
    await assertActive()
    client = await getIncusClient(target)
    state.targetIncusId ||= `u${instance.userId}-replace${task.id}`
    state.storagePool ||= (await db.resolveStoragePoolForNewInstance(targetId)) || undefined
    if (!state.storagePool) throw new Error('备用机器没有系统盘存储池')
    // Dedicated bridges have separate address spaces. Reusing the guest IPv4
    // lets a restored backup retain its internal network configuration.
    state.ipv4 ||= instance.ipv4 || (await db.allocateAndReserveNatIpv4(targetId, instance.id)) || undefined
    if (!state.ipv4) throw new Error('IPv4 分配失败')
    if (target.ipv6_subnet && !state.ipv6) state.ipv6 = generateRandomIPv6(target.ipv6_subnet)
    const networkMode = state.ipv6 ? 'nat_ipv6' as const : 'nat' as const
    const password = decryptSensitiveData(instance.rootPassword!)
    if (!password) throw new Error("实例 SSH 密码不可用")
    const snapshot = instance.snapshottedSpecs as Record<string, unknown> | null
    const { configPayload } = generateIncusConfig({ instanceName: instance.name, imageAlias: instance.image, rootPassword: password,
      sshKey: typeof snapshot?.sshPublicKey === 'string' ? snapshot.sshPublicKey : '', type: 'container', networkMode,
      network: { ipAddress: `${state.ipv4}/22`, gateway: '10.10.0.1', dns: ['10.10.0.1'],
        ipv6Address: state.ipv6 ? `${state.ipv6}/128` : undefined, ipv6Gateway: state.ipv6 ? 'fe80::1' : undefined } })
    const config = buildInstanceConfig({ name: state.targetIncusId, image: instance.image, cpu: instance.cpu,
      memory: instance.memory, disk: instance.disk, sshKey: '', password: '',
      cloudInitConfig: configPayload as { 'user.user-data': string }, networkMode, instanceType: 'container',
      storagePool: state.storagePool, ipv4Address: state.ipv4, ipv6Address: state.ipv6,
      ipv6Config: state.ipv6 ? { primaryIp: state.ipv6 } : null, hostInterface: target.ipv6_parent_interface || 'eth0',
      limitsIngress: DEDICATED_BANDWIDTH, limitsEgress: DEDICATED_BANDWIDTH, swapEnabled: false })
    state.stage = 'creating'
    await save(state.backupUploadId ? 'restoring_backup' : 'creating_on_target')
    if (state.backupUploadId) {
      const backup = await prisma.backupUploadTask.findFirstOrThrow({ where: { id: state.backupUploadId, instanceId: instance.id,
        userId: instance.userId, status: 'COMPLETED', storageConfig: { userId: instance.userId } }, include: { storageConfig: true } })
      if (!backup.remoteFileName) throw new Error('备份文件不可用')
      const stream = await StorageFactory.create(backup.storageConfig).downloadStream(backup.remoteFileName)
      try { await restoreFromStream({ client, backupStream: stream, targetName: state.targetIncusId, poolName: state.storagePool }) }
      finally { stream.destroy() }
      await updateInstance(client, state.targetIncusId, { config: config.config as Record<string, string>, devices: config.devices as Record<string, Record<string, string>> })
      await startInstance(client, state.targetIncusId)
      // Re-run the generated configuration on a restored system. Customer data
      // remains on the restored root disk; network and login match this delivery.
      const reset = await execWithOutput(client, state.targetIncusId, ['sh', '-c', 'cloud-init clean --logs'])
      if ((reset.metadata as { return?: number } | null)?.return !== 0) throw new Error('备份系统的初始化配置无法重置')
      await restartInstance(client, state.targetIncusId, true)
    } else {
      await createInstance(client, config)
      await startInstance(client, state.targetIncusId)
    }
    await assertActive()
    await save('verifying_public_ssh')
    await prepareDedicatedDelivery(client, instance.id, { hostId: targetId, name: state.targetIncusId, ipv4: state.ipv4, password })
    const dedicatedIpv6 = await prepareDedicatedIpv6Delivery(client, instance.id, targetId, state.targetIncusId)
    await prisma.$transaction(async tx => {
      await advisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, instance.id)
      await tx.$queryRaw`SELECT id FROM instance_tasks WHERE id = ${task.id} FOR UPDATE`
      const current = await tx.instanceTask.findUniqueOrThrow({ where: { id: task.id } })
      const currentInstance = await tx.instance.findUniqueOrThrow({ where: { id: instance.id } })
      if (current.status !== 'PROCESSING' || currentInstance.hostId !== state.sourceHostId || currentInstance.status === 'deleted') throw new Error('换机任务状态已改变')
      await tx.ipAddress.deleteMany({ where: { instanceId: instance.id } })
      await tx.portMapping.deleteMany({ where: { instanceId: instance.id } })
      await tx.snapshot.deleteMany({ where: { instanceId: instance.id } })
      await tx.backup.deleteMany({ where: { instanceId: instance.id } })
      await tx.trafficSnapshot.deleteMany({ where: { instanceId: instance.id } })
      // Price, billing records, owner, name, expiry and renew settings stay intact.
      await tx.instance.update({ where: { id: instance.id }, data: { hostId: targetId, incusId: state.targetIncusId,
        ipv4: state.ipv4, ipv6: state.ipv6 || null, storagePoolName: state.storagePool, networkMode, status: 'running',
        dedicatedNetworkReady: true, dedicatedIpv6: dedicatedIpv6 ? dedicatedIpv6 as unknown as Prisma.InputJsonValue : Prisma.JsonNull,
        rootPassword: encryptSensitiveData(password), monthlyTrafficLimit: null,
        trafficStatus: 'NORMAL', portLimit: 0, limitsIngress: DEDICATED_BANDWIDTH, limitsEgress: DEDICATED_BANDWIDTH } })
      await tx.ipAddress.create({ data: { address: state.ipv4!, type: 'inet4', device: 'eth0', isPrimary: true, hostId: targetId, instanceId: instance.id } })
      if (state.ipv6) await tx.ipAddress.create({ data: { address: state.ipv6, type: 'inet6', device: 'eth1', isPrimary: true, hostId: targetId, instanceId: instance.id } })
      await tx.host.update({ where: { id: targetId }, data: { poolFaulted: false } })
      state.stage = 'delivered'
      await tx.instanceTask.update({ where: { id: task.id }, data: { status: 'COMPLETED', progress: 'delivered', finishedAt: new Date(), replacementState: state as Prisma.InputJsonValue } })
    }, { timeout: 20000 })
    switched = true
    await createLog(instance.userId, 'instance', 'instance.replace_host', `实例「${instance.name}」更换机器已完成，公网 IP 已更新，原价格和到期时间保留`, 'success', { instanceId: instance.id })
  } catch (error) {
    if (!switched) {
      let cleaned = !state.targetIncusId
      if (client && state.targetIncusId) {
        try {
          await stopInstance(client, state.targetIncusId, true).catch(() => {})
          await deleteInstance(client, state.targetIncusId)
          cleaned = true
        } catch { /* Keep persistent quarantine until cleanup is verified. */ }
      }
      state.stage = cleaned ? 'cleaned' : 'cleanup_pending'
      await prisma.$transaction(async tx => {
        if (cleaned) {
          await tx.host.update({ where: { id: targetId }, data: { poolFaulted: false,
            cpuUsed: { decrement: instance.cpu }, memoryUsed: { decrement: instance.memory }, diskUsed: { decrement: instance.disk } } })
          await tx.ipAddress.deleteMany({ where: { hostId: targetId, instanceId: instance.id } })
        }
        await tx.instanceTask.update({ where: { id: task.id }, data: { replacementState: state as Prisma.InputJsonValue } })
      })
    }
    throw error
  }
}
