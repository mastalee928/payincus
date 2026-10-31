import { prepareNewContainerCloudInit } from './new-container-cloud-init.js'
import { randomUUID } from 'node:crypto'
import { prisma } from '../db/prisma.js'
import * as db from '../db/index.js'
import { buildInstanceConfig, createInstance, getIncusClient, getInstanceState, startInstance } from '../lib/incus/index.js'
import type { IncusClient } from './incus/incus-client.js'
import { cleanupManagedInstanceRemote, managedCleanupEndpointHash } from './managed-cleanup-identity.js'
import type { Host } from '../types/database.js'
import { networkModeAllowsPortMapping, networkModeNeedsPublicIpv4 } from './network-modes.js'
import { provisionAutoRemotePort } from './instance-port-mapping.js'

export interface ManagedInstanceProvisionConfig {
  name: string
  image: string
  cpu: number
  memory: number
  disk: number
  cloudInitConfig?: Record<string, string>
  networkMode: 'nat' | 'nat_ipv6' | 'nat_ipv6_nat' | 'ipv6_only' | 'ipv6_nat' | 'public_ipv4' | 'public_ipv4_ipv6'
  nested?: boolean
  privileged?: boolean
  portLimit?: number
  instanceType?: 'container' | 'vm'
  sshPort?: number | null
  storagePool?: string | null
  ipv4Address?: string | null
  ipv6Address?: string | null
  ipv6Gateway?: string | null
  hostInterface?: string | null
  limitsRead?: string | null
  limitsWrite?: string | null
  limitsReadIops?: number | null
  limitsWriteIops?: number | null
  limitsIngress?: string | null
  limitsEgress?: string | null
  limitsProcesses?: number | null
  limitsCpuPriority?: number | null
  bootAutostart?: boolean | null
  bootAutostartPriority?: number | null
  bootAutostartDelay?: number | null
  bootHostShutdownTimeout?: number | null
  // 创建实例时是否自动下发远程端口映射（Linux=22 / Windows=3389）。用户在创建页可取消勾选；
  // 未传时按全局开关 instance_auto_remote_port 走。
  autoRemotePort?: boolean
}

export async function provisionManagedInstanceAsync(
  instanceId: number,
  host: Host,
  config: ManagedInstanceProvisionConfig
): Promise<void> {
  const instance = await prisma.instance.findUnique({ where: { id: instanceId } })
  if (!instance || instance.status !== 'creating' || instance.hostId !== host.id || instance.incusId !== config.name || instance.provisioningCleanupPending) {
    throw new Error('Managed instance creation no longer owns the target')
  }
  const target = { id: instanceId, userId: instance.userId, hostId: host.id, incusId: config.name }
  const attempt = randomUUID()
  let client: IncusClient | undefined

  try {
    console.log(`\n[Managed Provisioning] ===== start =====`)
    console.log(`[Managed Provisioning] instanceId=${instanceId}, name=${config.name}, host=${host.name}`)

    client = await getIncusClient(host)
    const ipv6Config = config.ipv6Address ? { primaryIp: config.ipv6Address } : null

    const incusConfig = buildInstanceConfig({
      name: config.name,
      image: config.image,
      cpu: config.cpu,
      memory: config.memory,
      disk: config.disk,
      sshKey: '',
      password: '',
      cloudInitConfig: config.cloudInitConfig as { 'user.user-data': string } | undefined,
      networkMode: config.networkMode,
      nested: config.nested || false,
      privileged: config.privileged || false,
      instanceType: config.instanceType || 'container',
      storagePool: config.storagePool || 'default',
      ipv4Address: config.ipv4Address,
      ipv6Config,
      hostInterface: config.hostInterface || 'eth0',
      ipv6Address: config.ipv6Address,
      ipv6Gateway: config.ipv6Gateway,
      limitsRead: config.limitsRead,
      limitsWrite: config.limitsWrite,
      limitsReadIops: config.limitsReadIops,
      limitsWriteIops: config.limitsWriteIops,
      limitsIngress: config.limitsIngress,
      limitsEgress: config.limitsEgress,
      limitsProcesses: config.limitsProcesses,
      limitsCpuPriority: config.limitsCpuPriority,
      bootAutostart: config.bootAutostart,
      bootAutostartPriority: config.bootAutostartPriority,
      bootAutostartDelay: config.bootAutostartDelay,
      bootHostShutdownTimeout: config.bootHostShutdownTimeout
    })

    ;(incusConfig.config as Record<string, string>)['user.payincus.provisioning-attempt'] = attempt
    await createInstance(client, incusConfig)
    await prepareNewContainerCloudInit(client, config.name, config.cloudInitConfig, config.instanceType)

    let ready = false
    for (let i = 0; i < 60; i++) {
      await new Promise(resolve => setTimeout(resolve, 2000))
      try {
        const stateResp = await getInstanceState(client, config.name) as { status?: string }
        if (stateResp?.status) {
          ready = true
          break
        }
      } catch {
        // keep waiting
      }
    }

    if (!ready) {
      throw new Error('Instance creation timed out')
    }

    await startInstance(client, config.name)

    for (let i = 0; i < 30; i++) {
      await new Promise(resolve => setTimeout(resolve, 2000))
      try {
        const stateResp = await getInstanceState(client, config.name) as { status?: string }
        if (stateResp?.status === 'Running') {
          break
        }
      } catch {
        // keep waiting
      }
    }

    let ipv4: string | null = config.ipv4Address || null
    let ipv6: string | null = config.ipv6Address || null

    try {
      const stateResp = await getInstanceState(client, config.name) as {
        network?: Record<string, { addresses?: Array<{ family: string; scope: string; address: string }> }>
      }
      const network = stateResp?.network
      if (network?.eth0?.addresses) {
        for (const addr of network.eth0.addresses) {
          if (addr.family === 'inet' && addr.scope === 'global') {
            ipv4 = addr.address
          } else if (addr.family === 'inet6' && addr.scope === 'global') {
            ipv6 = addr.address
          }
        }
      }
    } catch {
      // keep pre-allocated addresses
    }

    const updateResult = await prisma.instance.updateMany({
      where: { ...target, status: 'creating', provisioningCleanupPending: false },
      data: {
        status: 'running',
        ipv4,
        ipv6,
        storagePoolName: config.storagePool || 'default'
      }
    })

    if (updateResult.count === 0) {
      throw new Error('Managed instance creation was finalized by another operation; cleanup deferred to its owner')
    }

    if (ipv4) {
      try {
        await db.createIpAddress({
          address: ipv4,
          type: 'inet4',
          isPrimary: true,
          device: 'eth0',
          instanceId
        })
      } catch (error) {
        console.warn(`[Managed Provisioning] failed to create IPv4 record for instance ${instanceId}:`, error)
      }
    }

    if (ipv6) {
      try {
        await db.createIpAddress({
          address: ipv6,
          type: 'inet6',
          isPrimary: true,
          device: 'eth1',
          instanceId
        })
      } catch (error) {
        console.warn(`[Managed Provisioning] failed to create IPv6 record for instance ${instanceId}:`, error)
      }
    }

    // 自动下发远程端口映射（Linux=22/SSH，Windows=3389/RDP）。
    // 只对新建实例生效，不回填存量；这条映射不计入用户端口配额（systemManaged=true）。
    // 失败只记日志、不影响实例创建结果 —— 实例已经跑起来了，用户随时可以自己手动加一条。
    await provisionAutoRemotePort({
      instanceId,
      image: config.image,
      networkMode: config.networkMode,
      autoRemotePort: config.autoRemotePort
    })

    const instance = await db.getInstanceById(instanceId).catch((error) => {
      console.warn(`[Managed Provisioning] failed to load notification context for instance ${instanceId}:`, error)
      return null
    })
    if (instance) {
      try {
        const { sendNotification } = await import('./notifier.js')
        await sendNotification(instance.user_id, 'instance_created', {
          instanceName: instance.name,
          status: 'running',
          hostName: host.name,
          hostLocation: host.location || undefined,
          image: config.image,
          cpu: config.cpu,
          memory: config.memory,
          disk: config.disk,
          networkMode: config.networkMode,
          ipv4: ipv4 || undefined,
          ipv6: ipv6 || undefined
        })
      } catch (error) {
        console.warn(`[Managed Provisioning] failed to notify user for instance ${instanceId}:`, error)
      }

      try {
        const { sendInstanceCreatedEmail } = await import('./mailer.js')
        const user = await db.findUserById(instance.user_id)
        if (user?.email) {
          const instanceWithBilling = await prisma.instance.findUnique({
            where: { id: instanceId },
            select: {
              packagePlanId: true,
              billingPrice: true,
              expiresAt: true,
              packagePlan: { select: { name: true } }
            }
          })
          const isPaid = instanceWithBilling?.packagePlanId !== null

          await sendInstanceCreatedEmail(user.email, {
            username: user.username,
            instanceName: instance.name,
            hostName: host.name,
            image: config.image,
            cpu: config.cpu,
            memory: config.memory,
            disk: config.disk,
            ipv4: ipv4 || undefined,
            ipv6: ipv6 || undefined,
            isPaid,
            planName: instanceWithBilling?.packagePlan?.name,
            amount: isPaid ? Number(instanceWithBilling?.billingPrice) : undefined,
            expiresAt: instanceWithBilling?.expiresAt ?? undefined
          })
        }
      } catch (error) {
        console.warn(`[Managed Provisioning] failed to email user for instance ${instanceId}:`, error)
      }
    }
  } catch (error) {
    console.error(`[Managed Provisioning] instance ${instanceId} failed:`, error)

    const updateResult = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM instances WHERE id = ${instanceId} FOR UPDATE`
      const current = await tx.instance.findFirst({ where: { ...target, status: 'creating', provisioningCleanupPending: false } })
      if (!current) return { count: 0 }
      const specs = current.snapshottedSpecs && typeof current.snapshottedSpecs === 'object' && !Array.isArray(current.snapshottedSpecs)
        ? current.snapshottedSpecs : {}
      return tx.instance.updateMany({
        where: { ...target, status: 'creating', provisioningCleanupPending: false },
        data: { status: 'error', provisioningCleanupPending: true,
          snapshottedSpecs: { ...specs, managedCleanup: { attempt, endpointHash: client ? managedCleanupEndpointHash(client) : null } } }
      })
    })
    if (updateResult.count === 0) throw error

    // Customer failure refunds do not depend on host reachability. The resource
    // claim and IPv4 remain occupied independently until cleanup is confirmed.
    let billingSettled = false
    try {
      const compensation = await db.compensateFailedInstancePurchase(instanceId, instance.userId, instance.hostId)
      billingSettled = compensation.refunded || compensation.reason === 'already_refunded' || compensation.reason === 'not_paid_purchase'
    } catch (compensationError) {
      console.error(`[Managed Provisioning] failed to compensate billing for instance ${instanceId}:`, compensationError)
    }

    // Include pool admission and row-lock waiting in the remote cleanup budget;
    // starting it only after the lock can let destructive I/O outlive this transaction.
    const cleanupDeadline = Date.now() + 30000
    try {
      await prisma.$transaction(async tx => {
        // Destroy/transfer must not take this instance between the cleanup
        // ownership check and the remote mutations/resource settlement.
        await tx.$queryRaw`SELECT id FROM instances WHERE id = ${instanceId} FOR UPDATE`
        const current = await tx.instance.findFirst({ where: { ...target, status: 'error', provisioningCleanupPending: true } })
        if (!current) return
        if (current.cpu !== instance.cpu || current.memory !== instance.memory || current.disk !== instance.disk ||
          current.networkMode !== instance.networkMode || current.portLimit !== instance.portLimit) {
          throw new Error('Instance allocation changed before cleanup')
        }
        if (!client) throw new Error('Original Incus connection unavailable; cleanup not confirmed')
        await cleanupManagedInstanceRemote(client, config.name, attempt, cleanupDeadline)
        // Do not hide a failed purchase from compensation while its billing is
        // unresolved. Confirmed absence alone is insufficient to release stock.
        if (!billingSettled || current.deletionBillingPending) throw new Error('远端清理已确认，但创建失败账务尚未结清；记录、库存和地址继续保留')
        const released = await tx.instance.updateMany({
          where: { ...target, status: 'error', provisioningCleanupPending: true },
          data: { status: 'deleted', provisioningCleanupPending: false }
        })
        if (released.count === 0) return
        const portCount = networkModeAllowsPortMapping(instance.networkMode) ? (instance.portLimit || 0) : 0
        await tx.$executeRaw`
          UPDATE hosts SET cpu_used = GREATEST(cpu_used - ${instance.cpu}, 0),
            memory_used = GREATEST(memory_used - ${instance.memory}, 0),
            disk_used = GREATEST(disk_used - ${instance.disk}, 0),
            nat_ports_used_count = GREATEST(nat_ports_used_count - ${portCount}, 0)
          WHERE id = ${instance.hostId}
        `
        if (networkModeNeedsPublicIpv4(instance.networkMode)) await db.releasePublicIpv4ForInstance(tx, instanceId)
      }, { timeout: 45000 })
    } catch (cleanupError) {
      console.error(`[Managed Provisioning] cleanup pending for instance ${instanceId}; resources retained:`, cleanupError)
      await db.createLog(instance.userId, 'instance', 'instance.create',
        `宿主机 ${host.id} 实例 ${instanceId} 创建失败，清理尚未完成，资源和地址继续保留。请核查远端清理和账务结果后重试。${cleanupError instanceof Error ? cleanupError.message : 'Unknown cleanup error'}`,
        'failed', { instanceId }).catch(logError => console.error('[Managed Provisioning] failed to record pending cleanup:', logError))
    }

    throw error
  }
}
