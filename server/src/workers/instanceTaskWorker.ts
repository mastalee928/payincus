import { assertInstanceMayBoot } from '../lib/instance-expiry.js'
import { assertNoPendingSnapshotOperations, hasPendingSnapshotOperation, } from '../db/snapshot-operation-guards.js'
import { executeHostReplacement } from '../services/host-replacement.js'
import { HostMaintenanceError, assertHostNotMaintaining } from '../lib/host-maintenance-gate.js'
import { processPoolCleanupQueue } from '../services/host-pool-cleanup.js'
import { prepareDedicatedDelivery } from '../services/dedicated-delivery.js'
import { prepareDedicatedIpv6Delivery } from '../services/host-public-ipv6-sync.js'
/**
 * 实例操作任务队列调度器
 * 确保同一台宿主机同一时间只有一个实例操作任务在执行
 * 
 * 高可用优化:
 * - 批量查询所有待处理任务，减少数据库查询次数
 * - 轻量任务（start/stop/restart）每宿主机并行执行
 * - 性能监控日志
 * - 使用统一连接池管理
 */

import { prisma } from '../db/prisma.js'
import { assertNoPendingProxySiteOperations, hasPendingProxySiteOperations } from '../db/proxy-site-operation-guards.js'
import { InstanceTaskType, Prisma, type InstanceTask } from '@prisma/client'
import { getIncusClient, getInstance, updateInstance, deleteInstance, createInstance } from '../lib/incus/index.js'
import { IncusApiError } from '../lib/incus/incus-client.js'
import { readCustomerIsolation, rejectCustomerPrivilege } from '../lib/incus/customer-isolation.js'
import {
  startInstance,
  stopInstance,
  restartInstance,
  rebuildInstance,
  getInstanceState
} from '../lib/incus/incus-instances.js'
import { listSnapshots, deleteSnapshot as deleteIncusSnapshot } from '../lib/incus/incus-snapshots.js'
import { sendNotification } from '../lib/notifier.js'
import { createLog } from '../db/logs.js'
import * as db from '../db/index.js'
import { updateInstanceTaskProgress, validateDestructiveTaskExecution, assertCopyMoveAuthority, InstanceTaskAuthorizationError, InstanceTaskConflictError, type DestructiveTaskMaterials } from '../db/instance-tasks.js'
import { closeInstanceSessions } from '../lib/terminal-proxy.js'
import { generateIncusConfig, generateRandomPassword } from '../lib/incus-config-generator.js'
import { encryptSensitiveData, decryptSensitiveData } from '../lib/security.js'
import { generateVmNicMacs } from '../lib/vm-network-identifiers.js'
import { existingVmNicMacs, generateCloudInitNetworkConfig } from '../lib/network-payload-builder.js'
import { customAlphabet } from 'nanoid'
import { generateRandomIPv6 } from '../lib/ip-calculator.js'
import pLimit from 'p-limit'
import { updateClientResponseTime, recordClientError } from '../lib/incus/incus-pool.js'
import { collectTrafficForRunningInstance } from '../services/instance-traffic-collector.js'
import {
  HOST_TASK_CLAIM_LOCK_NAMESPACE,
  IP_ADDRESS_ALLOCATION_LOCK_NAMESPACE,
  INSTANCE_OPERATION_LOCK_NAMESPACE,
  advisoryTransactionLock,
  advisoryTransactionLockString,
  tryAdvisoryTransactionLock
} from '../db/advisory-locks.js'
import { createWorkerDbBackoff } from './db-failure-backoff.js'
import { executeRenewalResume, RENEWAL_RESUME_ENTRY } from '../services/renewal-resume.js'
import { recoverIpv6RouteAndStart } from '../lib/incus/ipv6-route-recovery.js'

import { resetInstanceCloudInitState } from '../lib/cloud-init-status.js'
import { resolveIncusSwapValue } from '../lib/instance-swap.js'
import { getSystemImageAvailabilityForHost } from '../db/images.js'
import { prepareInstanceTaskSiteCleanup } from '../services/instance-task-site-cleanup.js'
import { resolveInstanceTrafficLimitForHost } from '../lib/traffic-multiplier.js'
import { calculateInstanceTrafficStatus } from '../services/traffic-utils.js'
import { beginInstanceReinstall, reconcileInterruptedReinstalls } from '../services/instance-reinstall-identity.js'
import { prepareNewContainerCloudInit } from '../lib/new-container-cloud-init.js'
import { cleanupManagedInstanceRemote, managedCleanupEndpointHash } from '../lib/managed-cleanup-identity.js'
import { readRegisteredGuest, readCreatedGuest, guardCopyMoveClient } from '../lib/guest-delivery-identity.js'
import { transferHostIdentity } from '../lib/transfer-host-identity.js'
import { officialImageAvailable } from '../lib/official-image-availability.js'
import { randomUUID } from 'node:crypto'
import { isIP } from 'node:net'
import { Address6 } from 'ip-address'
import { networkModeNeedsPublicIpv4, networkModeNeedsRoutedIpv6 } from '../lib/network-modes.js'
import { recoveryHeld } from '../services/platform-backup-core.js'

// 任务超时时间：轻量任务保持短超时，重建/克隆/改节点等重任务允许更长执行窗口
const LIGHT_TASK_TIMEOUT = 5 * 60 * 1000
const HEAVY_TASK_TIMEOUT = 30 * 60 * 1000

// Worker 轮询间隔 (3 秒)
const POLL_INTERVAL = 3000

// 超时检查间隔 (1 分钟)
const TIMEOUT_CHECK_INTERVAL = 60000

// 每宿主机轻量任务并发数
const LIGHT_TASK_CONCURRENCY = 5

// 轻量任务类型（可并行执行）
const LIGHT_TASK_NAMES = new Set(['start', 'stop', 'restart'])

// 重量任务类型（需串行执行）
const HEAVY_TASK_NAMES = new Set(['rebuild', 'clone', 'recreate', 'change_host', 'replace_host'])

// 重量任务类型数组（用于 Prisma 查询）
const HEAVY_TASK_TYPES: InstanceTaskType[] = ['rebuild', 'clone', 'recreate', 'change_host' as InstanceTaskType, 'replace_host']
const ALPINE_BUSY_UPDATE_CANCEL_AFTER_MS = 10_000

let workerInterval: ReturnType<typeof setInterval> | null = null
let timeoutCheckInterval: ReturnType<typeof setInterval> | null = null
let poolCleanupInterval: ReturnType<typeof setInterval> | null = null
const runningTaskIds = new Set<number>()
const dbBackoff = createWorkerDbBackoff('InstanceTaskWorker')

type InstanceTaskFailureNotice = {
  id: number
  userId: number
  instanceId: number
  hostId: number
  taskType: InstanceTaskType
}

function isAlpineImageAlias(imageAlias?: string | null): boolean {
  return typeof imageAlias === 'string' && imageAlias.toLowerCase().includes('alpine')
}

/**
 * 从实例状态中提取 IPv4 地址
 */
function extractIPv4(state: { network?: Record<string, { addresses?: Array<{ family: string; address: string; scope?: string }> }> }, expected?: string | null): string | null {
  if (!state.network) return null
  for (const [iface, info] of Object.entries(state.network)) {
    if (iface === 'lo') continue
    const addrs = info.addresses || []
    for (const addr of addrs) {
      if (addr.family === 'inet' && addr.scope === 'global' && (!expected || addr.address === expected)) {
        return addr.address
      }
    }
  }
  return null
}

/**
 * 从实例状态中提取 IPv6 地址
 * 排除 ULA (fd00::/8, fc00::/7) 和 link-local (fe80::/10) 地址
 * 仅返回真正的全球可路由 IPv6 地址
 */
function extractIPv6(state: { network?: Record<string, { addresses?: Array<{ family: string; address: string; scope?: string }> }> }, expected?: string | null): string | null {
  if (!state.network) return null
  for (const [iface, info] of Object.entries(state.network)) {
    if (iface === 'lo') continue
    const addrs = info.addresses || []
    for (const addr of addrs) {
      if (addr.family === 'inet6' && addr.scope === 'global') {
        const ip = addr.address.toLowerCase()
        // 排除 ULA (fc00::/7 = fc/fd) 和 link-local (fe80::/10)
        if (ip.startsWith('fd') || ip.startsWith('fc') || ip.startsWith('fe80:')) {
          continue
        }
        if (expected) {
          if (isIP(addr.address) !== 6 || isIP(expected) !== 6 || new Address6(addr.address).correctForm() !== new Address6(expected).correctForm()) continue
          return expected
        }
        return addr.address
      }
    }
  }
  return null
}

async function cleanupRecreatedInstanceRecords(instanceId: number, hostId: number, transaction?: Prisma.TransactionClient): Promise<{ deletedPortMappingsCount: number }> {
  const cleanup = async (tx: Prisma.TransactionClient) => {
    await advisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, instanceId)
    await tx.$queryRaw`SELECT id FROM instances WHERE id = ${instanceId} FOR UPDATE`
    await assertNoPendingSnapshotOperations(tx, instanceId)
    await assertNoPendingProxySiteOperations(tx, instanceId)
    const deletedPortMappings = await tx.portMapping.deleteMany({ where: { instanceId } })

    if (deletedPortMappings.count > 0) {
      const updatedHost = await tx.host.updateMany({
        where: {
          id: hostId,
          natPortsUsedCount: { gte: deletedPortMappings.count }
        },
        data: {
          natPortsUsedCount: { decrement: deletedPortMappings.count }
        }
      })
      if (updatedHost.count === 0) {
        await tx.host.update({
          where: { id: hostId },
          data: { natPortsUsedCount: 0 }
        })
      }
    }

    await tx.snapshot.deleteMany({ where: { instanceId } })
    await tx.backup.deleteMany({ where: { instanceId } })
    if (await tx.proxySite.count({ where: { instanceId } })) throw Error('INSTANCE_SITE_CLEANUP_UNCONFIRMED')
    await tx.backupPolicy.deleteMany({ where: { instanceId } })
    await tx.snapshotPolicy.deleteMany({ where: { instanceId } })
    await tx.trafficSnapshot.deleteMany({ where: { instanceId } })

    return { deletedPortMappingsCount: deletedPortMappings.count }
  }
  return transaction ? cleanup(transaction) : prisma.$transaction(cleanup)
}

async function originalPublicNetwork(instanceId: number, instance: { host_id: number; network_mode: string; ipv4?: string | null }) {
  if (!networkModeNeedsPublicIpv4(instance.network_mode)) return undefined
  const address = await prisma.publicIpv4Address.findUnique({ where: { instanceId }, include: { pool: true } })
  const gateway = address?.gateway || address?.pool?.gateway
  if (!address || address.hostId !== instance.host_id || address.status !== 'assigned' || address.address !== instance.ipv4 ||
    isIP(address.address) !== 4 || !gateway || isIP(gateway) !== 4 || address.prefixLength < 1 || address.prefixLength > 32) throw Error('REINSTALL_PUBLIC_IPV4_IDENTITY_MISSING')
  const addresses = (value: unknown) => Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && isIP(v) !== 0) : []
  const dns = addresses(address.dns).length ? addresses(address.dns) : addresses(address.pool?.dns)
  return { ipv4PrefixLength: address.prefixLength, ipv4Gateway: gateway, dns: dns.length ? dns : ['1.1.1.1', '8.8.8.8'] }
}

async function notifyInstanceTaskFailure(task: InstanceTaskFailureNotice, errorMessage: string): Promise<void> {
  try {
    const instance = await db.getInstanceById(task.instanceId)
    const host = await db.getHostById(task.hostId)

    await createLog(
      task.userId,
      'instance',
      `instance.${task.taskType}`,
      `实例「${instance?.name || task.instanceId}」的 ${task.taskType} 任务失败：${errorMessage}`,
      'failed',
      { instanceId: task.instanceId }
    )

    await sendNotification(task.userId, 'instance_task_failed', {
      instanceName: instance?.name || `实例 #${task.instanceId}`,
      hostName: host?.name || '未知',
      taskType: task.taskType,
      error: errorMessage
    })
  } catch (notifyErr) {
    console.error('[InstanceTaskWorker] 发送失败通知/记录日志失败:', notifyErr)
  }
}

/**
 * 服务启动时清理僵尸任务
 */
export async function failExpiredInstanceTaskAttempt(
  task: { id: number; taskType: InstanceTaskType; startedAt: Date | null; retryCount: number },
  error: string,
  now = new Date()
): Promise<boolean> {
  if (runningTaskIds.has(task.id)) return false
  const receipt = (await prisma.instanceTask.findUnique({ where: { id: task.id }, select: { replacementState: true } }))?.replacementState as { targetPhase?: string } | null
  if (task.taskType === 'rebuild' && receipt?.targetPhase === 'rebuild_uncertain') return false
  if (['recreate', 'clone', 'change_host'].includes(task.taskType) && ['prepared', 'reserved', 'creating', 'verified', 'cleanup_pending', 'source_cleanup'].includes(receipt?.targetPhase || '')) return false
  const threshold = new Date(now.getTime() - (HEAVY_TASK_NAMES.has(task.taskType) ? HEAVY_TASK_TIMEOUT : LIGHT_TASK_TIMEOUT))
  const result = await prisma.instanceTask.updateMany({
    where: {
      id: task.id, status: 'PROCESSING', taskType: task.taskType,
      startedAt: task.startedAt, retryCount: task.retryCount,
      OR: [{ startedAt: null }, { startedAt: { lt: threshold } }]
    },
    data: { status: 'FAILED', error, finishedAt: now }
  })
  return result.count === 1
}

export async function cleanupStaleTasks(): Promise<void> {
  const lightTimeoutThreshold = new Date(Date.now() - LIGHT_TASK_TIMEOUT)
  const heavyTimeoutThreshold = new Date(Date.now() - HEAVY_TASK_TIMEOUT)

  const staleTasks = await prisma.instanceTask.findMany({
    where: {
      status: 'PROCESSING',
      OR: [
        {
          taskType: { in: HEAVY_TASK_TYPES },
          startedAt: { lt: heavyTimeoutThreshold }
        },
        {
          taskType: { notIn: HEAVY_TASK_TYPES },
          startedAt: { lt: lightTimeoutThreshold }
        },
        {
          startedAt: null
        }
      ]
    },
    select: { id: true, userId: true, instanceId: true, hostId: true, taskType: true, startedAt: true, retryCount: true }
  })

  await Promise.allSettled(staleTasks.map(async task => {
    if (await failExpiredInstanceTaskAttempt(task, '系统启动清理超时任务')) {
      await notifyInstanceTaskFailure(task, '系统启动清理超时任务')
    }
  }))
}

/**
 * 运行时检查并清理超时的任务
 */
async function cleanupTimeoutTasks(): Promise<void> {
  if (dbBackoff.shouldSkip()) return
  const lightTimeoutThreshold = new Date(Date.now() - LIGHT_TASK_TIMEOUT)
  const heavyTimeoutThreshold = new Date(Date.now() - HEAVY_TASK_TIMEOUT)

  const timedOutTasks = await prisma.instanceTask.findMany({
    where: {
      status: 'PROCESSING',
      OR: [
        {
          taskType: { in: HEAVY_TASK_TYPES },
          startedAt: { lt: heavyTimeoutThreshold }
        },
        {
          taskType: { notIn: HEAVY_TASK_TYPES },
          startedAt: { lt: lightTimeoutThreshold }
        },
        { startedAt: null }
      ]
    },
    select: { id: true, userId: true, instanceId: true, hostId: true, taskType: true, startedAt: true, retryCount: true }
  })
  const timedOutTaskIds = timedOutTasks
    .map(task => task.id)
    .filter(taskId => !runningTaskIds.has(taskId))

  if (timedOutTaskIds.length === 0) {
    return
  }

  await Promise.allSettled(timedOutTasks.filter(task => timedOutTaskIds.includes(task.id)).map(async task => {
    if (await failExpiredInstanceTaskAttempt(task, '任务执行超时')) {
      await notifyInstanceTaskFailure(task, '任务执行超时')
    }
  }))
}

/**
 * 检查队列并执行任务
 * 高可用优化：批量查询 + 轻量任务并行
 */
async function processQueue(): Promise<void> {
  if (dbBackoff.shouldSkip()) return
  const startTime = Date.now()

  try {
    // 批量获取所有待处理任务（一次查询）
    const pendingTasks = await prisma.instanceTask.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, hostId: true, taskType: true }
    })

    if (pendingTasks.length === 0) return

    // 按宿主机分组
    const tasksByHost = new Map<number, typeof pendingTasks>()
    for (const task of pendingTasks) {
      const hostTasks = tasksByHost.get(task.hostId) || []
      hostTasks.push(task)
      tasksByHost.set(task.hostId, hostTasks)
    }

    // 并行处理每个宿主机的任务
    const hostPromises = Array.from(tasksByHost.entries()).map(
      async ([hostId, tasks]) => processHostTasks(hostId, tasks)
    )

    await Promise.allSettled(hostPromises)

    const duration = Date.now() - startTime
    if (duration > 100) { // 只记录耗时超过 100ms 的轮询
      console.log(`[InstanceTaskWorker] Queue processed in ${duration}ms, pending: ${pendingTasks.length}`)
    }
  } catch (err) {
    console.error('[InstanceTaskWorker] Queue processing error:', err)
    dbBackoff.arm(err)
  }
}

/**
 * 处理单个宿主机的任务队列
 * 轻量任务可并行，重量任务串行
 */
async function processHostTasks(
  hostId: number,
  tasks: Array<{ id: number; hostId: number; taskType: string }>
): Promise<void> {
  // 分离轻量任务和重量任务
  const lightTasks = tasks.filter(t => LIGHT_TASK_NAMES.has(t.taskType))
  const heavyTasks = tasks.filter(t => HEAVY_TASK_NAMES.has(t.taskType))

  // 检查是否有正在执行的重量任务
  const runningHeavyTask = await prisma.instanceTask.findFirst({
    where: {
      hostId,
      status: 'PROCESSING',
      taskType: { in: HEAVY_TASK_TYPES }
    }
  })

  if (runningHeavyTask) {
    // 有重量任务在执行，跳过该宿主机
    return
  }

  // 优先处理轻量任务（并行）
  if (lightTasks.length > 0) {
    const limit = pLimit(LIGHT_TASK_CONCURRENCY)
    const claimedLightTasks: Array<{ id: number; startedAt: Date | null; retryCount: number }> = []

    // 尝试获取多个轻量任务
    for (const task of lightTasks.slice(0, LIGHT_TASK_CONCURRENCY)) {
      const claimed = await claimLightTask(hostId, task.id)
      if (claimed) {
        claimedLightTasks.push(claimed)
      }
    }

    // 并行执行轻量任务
    if (claimedLightTasks.length > 0) {
      await Promise.allSettled(
        claimedLightTasks.map(claimed =>
          limit(() => executeTask(claimed.id, claimed).catch(err => {
            console.error(`[InstanceTaskWorker] Light task ${claimed.id} error:`, err)
          }))
        )
      )
    }
  }

  // 处理重量任务（串行，需要独占锁）
  // 注意：如果没有待处理的轻量任务，或者轻量任务已全部被处理，则处理重量任务
  if (heavyTasks.length > 0) {
    // 检查是否有正在执行的任何任务
    const runningAnyTask = await prisma.instanceTask.findFirst({
      where: { hostId, status: 'PROCESSING' }
    })

    if (!runningAnyTask) {
      // 没有任务在执行，可以处理重量任务
      const claimedTask = await claimNextTask(hostId)
      if (claimedTask) {
        // 重量任务异步执行
        executeTask(claimedTask.id, claimedTask).catch(err => {
          console.error(`[InstanceTaskWorker] Heavy task ${claimedTask.id} error:`, err)
        })
      }
    }
  }
}

/**
 * 获取轻量任务（简化版锁检查）
 */
export async function claimLightTask(hostId: number, taskId: number) {
  return prisma.$transaction(async (tx) => {
    const locked = await tryAdvisoryTransactionLock(tx, HOST_TASK_CLAIM_LOCK_NAMESPACE, hostId)
    if (!locked) return null

    // 检查是否有正在执行的重量任务
    const runningHeavyTask = await tx.instanceTask.findFirst({
      where: {
        hostId,
        status: 'PROCESSING',
        taskType: { in: HEAVY_TASK_TYPES }
      }
    })
    if (runningHeavyTask) return null
    const runningLightCount = await tx.instanceTask.count({ where: {
      hostId, status: 'PROCESSING', taskType: { notIn: HEAVY_TASK_TYPES }
    } })
    if (runningLightCount >= LIGHT_TASK_CONCURRENCY) return null

    // 检查是否有正在执行的恢复任务（共享锁）
    const runningRestoreTask = await tx.restoreTask.findFirst({
      where: { hostId, status: 'PROCESSING' }
    })
    if (runningRestoreTask) return null

    // 检查是否有正在执行的上传任务（共享锁）
    const runningUploadTask = await tx.backupUploadTask.findFirst({
      where: { hostId, status: 'PROCESSING' }
    })
    if (runningUploadTask) return null

    // 检查任务是否仍然是 PENDING
    const task = await tx.instanceTask.findUnique({
      where: { id: taskId }
    })
    if (!task || task.status !== 'PENDING' || task.hostId !== hostId || !LIGHT_TASK_NAMES.has(task.taskType)) return null

    const instanceOperationLocked = await tryAdvisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, task.instanceId)
    if (!instanceOperationLocked) return null
    await tx.$queryRaw`SELECT id FROM instances WHERE id = ${task.instanceId} FOR UPDATE`
    if (await hasPendingSnapshotOperation(task.instanceId, tx) || await hasPendingProxySiteOperations(task.instanceId, tx)) return null
    if (await tx.instanceTask.findFirst({ where: { instanceId: task.instanceId, status: 'PROCESSING' }, select: { id: true } })) return null

    const instance = await tx.instance.findUnique({
      where: { id: task.instanceId },
      select: { status: true }
    })
    if (!instance || (instance.status === 'deleted' && task.operationEntry !== RENEWAL_RESUME_ENTRY)) return null

    // 标记为 PROCESSING
    const claimed = await tx.instanceTask.updateMany({
      where: { id: taskId, hostId, status: 'PENDING' },
      data: { status: 'PROCESSING', startedAt: new Date() }
    })
    return claimed.count === 1 ? tx.instanceTask.findUnique({ where: { id: taskId } }) : null
  })
}

/**
 * 原子操作：获取并锁定下一个任务
 */
export async function claimNextTask(hostId: number) {
  return prisma.$transaction(async (tx) => {
    const locked = await tryAdvisoryTransactionLock(tx, HOST_TASK_CLAIM_LOCK_NAMESPACE, hostId)
    if (!locked) return null

    // 检查是否有正在执行的实例任务
    const runningTask = await tx.instanceTask.findFirst({
      where: { hostId, status: 'PROCESSING' }
    })
    if (runningTask) return null

    // 检查是否有正在执行的恢复任务（共享锁）
    const runningRestoreTask = await tx.restoreTask.findFirst({
      where: { hostId, status: 'PROCESSING' }
    })
    if (runningRestoreTask) return null

    // 检查是否有正在执行的上传任务（共享锁）
    const runningUploadTask = await tx.backupUploadTask.findFirst({
      where: { hostId, status: 'PROCESSING' }
    })
    if (runningUploadTask) return null

    // 获取最早的 PENDING 任务
    const taskToRun = await tx.instanceTask.findFirst({
      where: { hostId, status: 'PENDING' },
      orderBy: { createdAt: 'asc' }
    })
    if (!taskToRun) return null

    const instanceOperationLocked = await tryAdvisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, taskToRun.instanceId)
    if (!instanceOperationLocked) return null
    await tx.$queryRaw`SELECT id FROM instances WHERE id = ${taskToRun.instanceId} FOR UPDATE`
    if (await hasPendingSnapshotOperation(taskToRun.instanceId, tx) || await hasPendingProxySiteOperations(taskToRun.instanceId, tx)) return null

    const instance = await tx.instance.findUnique({
      where: { id: taskToRun.instanceId },
      select: { status: true }
    })
    if (!instance || instance.status === 'deleted') return null

    // 原子标记为 PROCESSING
    const claimedTask = await tx.instanceTask.updateMany({
      where: { id: taskToRun.id, hostId, status: 'PENDING' },
      data: { status: 'PROCESSING', startedAt: new Date() }
    })

    return claimedTask.count === 1 ? tx.instanceTask.findUnique({ where: { id: taskToRun.id } }) : null
  })
}

/**
 * 执行单个任务（带性能监控）
 */
type InstanceTaskAttempt = { startedAt: Date | null; retryCount: number }

export async function finalizeInstanceTaskAttempt(taskId: number, attempt: InstanceTaskAttempt, status: 'COMPLETED' | 'FAILED', error?: string): Promise<boolean> {
  if (!attempt.startedAt) return false
  const result = await prisma.instanceTask.updateMany({
    where: { id: taskId, status: 'PROCESSING', startedAt: attempt.startedAt, retryCount: attempt.retryCount },
    data: { status, ...(error !== undefined ? { error } : {}), finishedAt: new Date() }
  })
  return result.count === 1
}

export async function executeTask(taskId: number, attempt: InstanceTaskAttempt): Promise<void> {
  if (runningTaskIds.has(taskId) || !attempt.startedAt) return
  const taskStartTime = Date.now()
  runningTaskIds.add(taskId)
  let task: Awaited<ReturnType<typeof prisma.instanceTask.findUnique>> = null
  let destructiveAdmissionPending = true

  try {
    task = await prisma.instanceTask.findUnique({
      where: { id: taskId }
    })

    if (!task) {
      console.error(`[InstanceTaskWorker] Task ${taskId} not found`)
      return
    }
    if (task.status !== 'PROCESSING' || task.startedAt?.getTime() !== attempt.startedAt.getTime() || task.retryCount !== attempt.retryCount) return
    if (task.operationEntry === RENEWAL_RESUME_ENTRY) {
      await executeRenewalResume(task.id, attempt)
      return
    }
    await assertHostNotMaintaining(task.hostId)
    if (task.targetHostId !== null) await assertHostNotMaintaining(task.targetHostId)

    let materials = await validateDestructiveTaskExecution(task)
    if (['clone', 'change_host'].includes(task.taskType)) await prisma.$transaction(tx => assertCopyMoveAuthority(tx, task!))

    console.log(`[InstanceTaskWorker] 开始执行任务 ${taskId} (${task.taskType})`)

    const instance = await db.getInstanceById(task.instanceId)
    if (!instance) throw new Error('实例不存在')
    if (instance.status === 'deleted') {
      throw new Error('实例已删除，任务取消')
    }
    if(task.taskType!=='stop')assertInstanceMayBoot(await prisma.instance.findUniqueOrThrow({where:{id:task.instanceId}}))

    const earliestActiveTask = await prisma.instanceTask.findFirst({
      where: {
        instanceId: task.instanceId,
        status: { in: ['PENDING', 'PROCESSING'] }
      },
      orderBy: [
        { createdAt: 'asc' },
        { id: 'asc' }
      ]
    })
    if (earliestActiveTask && earliestActiveTask.id !== task.id) {
      throw new Error(`实例已有更早的任务正在执行: ${earliestActiveTask.taskType}`)
    }

    if (task.taskType === 'replace_host') {
      await executeHostReplacement(task)
    } else {
    const host = await db.getHostById(task.hostId)
    if (!host) throw new Error('宿主机不存在')
    const taskPackage = instance.package_id ? await db.getPackageById(instance.package_id) : null
    if (['rebuild', 'recreate'].includes(task.taskType) && !task.replacementState && task.imageAlias &&
        await officialImageAvailable(task.imageAlias, host.architecture || '', taskPackage?.instance_type === 'vm' ? 'vm' : 'container') === false) {
      throw new InstanceTaskAuthorizationError('INSTANCE_IMAGE_UNAVAILABLE', '所选镜像已被官方源下架，原实例保持不变，请重新选择', 400)
    }

    const clientStartTime = Date.now()
    let client = await getIncusClient(host)
    client=client.withBillingInstance(task.instanceId)
    const clientDuration = Date.now() - clientStartTime
    if (task.taskType === 'rebuild' || task.taskType === 'recreate') {
      materials = await validateDestructiveTaskExecution(task, { prepareRebuild: true })
    }
    destructiveAdmissionPending = false
    const reinstall = task.taskType === 'rebuild' || task.taskType === 'recreate' ? await beginInstanceReinstall(task, client) : undefined
    if (reinstall) {
      await reinstall.source(task.taskType === 'recreate')
      client = reinstall.client
    }

    if (['clone', 'change_host'].includes(task.taskType)) client = guardCopyMoveClient(client, task, await prisma.host.findUniqueOrThrow({ where: { id: task.hostId } }))

    // 记录连接池响应时间
    updateClientResponseTime(host.id, clientDuration)

    switch (task.taskType) {
      case 'start':
        await executeStartTask(task, instance, host, client)
        break
      case 'stop':
        await executeStopTask(task, instance, host, client)
        break
      case 'restart':
        await executeRestartTask(task, instance, host, client)
        break
      case 'rebuild':
        if (!materials) throw new InstanceTaskAuthorizationError('INSTANCE_TASK_AUTHORIZATION_MISSING', '原任务缺少身份验证记录，请重新提交')
        await executeRebuildTask(task, instance, host, client, materials, reinstall!)
        break
      case 'clone':
        await executeCloneTask(task, instance, host, client)
        break
      case 'recreate':
        if (!materials) throw new InstanceTaskAuthorizationError('INSTANCE_TASK_AUTHORIZATION_MISSING', '原任务缺少身份验证记录，请重新提交')
        await executeRecreateTask(task, instance, host, client, materials, reinstall!)
        break
      case 'change_host':
        await executeChangeHostTask(task, instance, host, client)
        break
      default:
        throw new Error(`未知任务类型: ${task.taskType}`)
    }
    }

    // 任务完成
    const completed = await finalizeInstanceTaskAttempt(taskId, attempt, 'COMPLETED')
    if (!completed) {
      console.warn(`[InstanceTaskWorker] 任务 ${taskId} 已不处于 PROCESSING，跳过完成状态覆盖`)
    }

    const taskDuration = Date.now() - taskStartTime
    console.log(`[InstanceTaskWorker] 任务 ${taskId} (${task.taskType}) 完成，耗时 ${taskDuration}ms`)

  } catch (err) {
    if (task && destructiveAdmissionPending && err instanceof InstanceTaskConflictError && ['rebuild', 'recreate'].includes(task.taskType)) {
      // A patrol may acquire the short instance lock after the queue claim.
      // No destructive remote operation has started; keep the same consent
      // and retry admission on the next worker pass, rechecking authorization.
      await prisma.instanceTask.updateMany({ where: { id:taskId,status:'PROCESSING',startedAt:attempt.startedAt,retryCount:attempt.retryCount },
        data: { status:'PENDING',startedAt:null,progress:'waiting_for_instance',error:null } })
      return
    }
    const reinstallReceipt = (await prisma.instanceTask.findUnique({ where: { id: taskId }, select: { replacementState: true } }))?.replacementState as { targetPhase?: string } | null
    if (task?.taskType === 'rebuild' && reinstallReceipt?.targetPhase === 'rebuild_uncertain') {
      const saved = (await prisma.instanceTask.findUniqueOrThrow({ where: { id: taskId } })).replacementState as Prisma.JsonObject
      const resumable = (saved.rebuildOperation || saved.rebuildCompleted) && Number(saved.rebuildResumeAttempts || 0) < 6 && Date.now() - attempt.startedAt.getTime() < HEAVY_TASK_TIMEOUT
      await prisma.instanceTask.updateMany({ where: { id: taskId, status: 'PROCESSING', startedAt: attempt.startedAt, retryCount: attempt.retryCount },
        data: { progress: resumable ? 'rebuild_reconciling' : 'manual_intervention',
          replacementState: { ...saved, rebuildNextAt: new Date(Date.now() + 60000).toISOString() },
          error: resumable ? '重装等待原操作回执；60秒后核验并续接启动，不重复重装或重置密码' :
            '重装结果未确认或自动续接预算已用尽；保留原身份、占用及加密待用密码，需核对原操作回执，禁止直接重复重装' } })
      return
    }
    if (task && ['recreate', 'clone', 'change_host'].includes(task.taskType) && ['prepared', 'reserved', 'creating', 'verified', 'cleanup_pending', 'source_cleanup'].includes(reinstallReceipt?.targetPhase || '')) {
      const current = await prisma.instanceTask.findUniqueOrThrow({ where: { id: taskId } })
      await prisma.instanceTask.updateMany({ where: { id: taskId, status: 'PROCESSING', startedAt: attempt.startedAt, retryCount: attempt.retryCount },
        data: { error: 'REINSTALL_CLEANUP_PENDING：保留原任务等待创建残留核验', progress: 'cleanup_pending',
          replacementState: { ...(current.replacementState as Prisma.JsonObject || {}), cleanupFromPhase: (current.replacementState as Prisma.JsonObject || {}).cleanupFromPhase || reinstallReceipt?.targetPhase,
            targetPhase: reinstallReceipt?.targetPhase === 'source_cleanup' ? 'source_cleanup' : 'cleanup_pending' } } })
      return
    }
    if (err instanceof HostMaintenanceError) {
      // Keep the original authorized task and latest business intent. Security
      // maintenance must not turn a queued stop/delete into a failed intent.
      await prisma.instanceTask.updateMany({ where: { id:taskId,status:'PROCESSING',startedAt:attempt.startedAt,retryCount:attempt.retryCount },
        data: { status:'PENDING',startedAt:null,error:'HOST_SECURITY_MAINTENANCE' } })
      return
    }
    const errorMessage = reinstallReceipt?.targetPhase === 'rebuild_uncertain'
      ? '重装请求结果尚未确认，保留原实例身份、占用及加密待用密码；请核对原任务与远端操作结果，未确认前不自动重复重装'
      : err instanceof Error ? err.message : String(err)
    console.error(`[InstanceTaskWorker] 任务 ${taskId} 失败:`, errorMessage)

    const failed = await finalizeInstanceTaskAttempt(taskId, attempt, 'FAILED', errorMessage)
    if (!failed) {
      console.warn(`[InstanceTaskWorker] 任务 ${taskId} 已不处于 PROCESSING，跳过失败状态覆盖`)
      return
    }

    if (!task) {
      return
    }

    // 记录连接池错误
    if (!(err instanceof InstanceTaskAuthorizationError) && !(err instanceof InstanceTaskConflictError)) recordClientError(task.hostId)

    const taskDuration = Date.now() - taskStartTime
    console.error(`[InstanceTaskWorker] 任务 ${taskId} (${task.taskType}) 失败，耗时 ${taskDuration}ms: ${errorMessage}`)

    await notifyInstanceTaskFailure(task, errorMessage)
  } finally {
    runningTaskIds.delete(taskId)
  }
}

/**
 * 判断错误是否为 "实例已经是目标状态"
 * Incus 返回类似 "The container is already running" 或 "The instance is already stopped"
 * 也可能返回 "container is not running" 或 "instance is not running" 等变体
 */
function isAlreadyInStateError(error: Error, targetState: 'running' | 'stopped'): boolean {
  const msg = error.message.toLowerCase()
  if (targetState === 'running') {
    // 匹配: "already running", "already started", "is running"
    return msg.includes('already running') || msg.includes('already started') ||
      (msg.includes('is running') && !msg.includes('not running'))
  }
  if (targetState === 'stopped') {
    // 匹配: "already stopped", "not running", "is not running", "isn't running"
    return msg.includes('already stopped') || msg.includes('not running') ||
      msg.includes('is stopped') || msg.includes("isn't running")
  }
  return false
}

/**
 * 执行启动任务
 */
async function executeStartTask(
  task: { id: number; userId: number; instanceId: number },
  instance: { incus_id: string; name: string; network_mode: string },
  host: { name: string },
  client: Awaited<ReturnType<typeof getIncusClient>>
): Promise<void> {
  await updateInstanceTaskProgress(task.id, 'starting')

  try {
    await startInstance(client, instance.incus_id)
  } catch (err) {
    const recovered = await recoverIpv6RouteAndStart(client, instance.incus_id, err)
    if (!recovered && err instanceof Error && isAlreadyInStateError(err, 'running')) {
      console.log(`[Start] 实例 ${instance.incus_id} 已经是运行状态，自动修正数据库`)
      // 获取实际状态并更新数据库
      const state = await getInstanceState(client, instance.incus_id) as {
        network?: Record<string, { addresses?: Array<{ family: string; address: string; scope?: string }> }>
      }
      const ipv4 = extractIPv4(state)
      const ipv6 = extractIPv6(state)
      const dedicatedReady = await prepareDedicatedDelivery(client, task.instanceId)
  if (dedicatedReady) await prisma.instance.update({ where: { id: task.instanceId }, data: { dedicatedNetworkReady: true } })
  await db.updateInstanceStatus(task.instanceId, 'running', { ipv4, ipv6 })
      const { reconcileTrafficStateForInstanceIds } = await import('../services/traffic-scheduler.js')
      await reconcileTrafficStateForInstanceIds([task.instanceId])

      // 发送通知（状态已同步）
      await sendNotification(task.userId, 'instance_started', {
        instanceName: instance.name,
        hostName: host.name,
        ipv4: ipv4 || undefined,
        ipv6: ipv6 || undefined
      })

      await createLog(task.userId, 'instance', 'instance.start', `Instance "${instance.name}" already running, synced status [host: ${host.name}]`, 'success', { instanceId: task.instanceId })
      return // 任务成功完成
    }
    if (!recovered) throw err // 其他错误继续抛出
  }

  // 等待网络初始化
  let ipv4: string | null = null
  let ipv6: string | null = null
  // 根据实例类型动态调整等待窗口：VM 启动慢，需要更长的等待时间
  const incusInst = await getInstance(client, instance.incus_id) as { type?: string }
  const isVM = incusInst.type === 'virtual-machine'
  const maxAttempts = isVM ? 60 : 30    // VM: 60×3s=180s, 容器: 30×2s=60s
  const pollInterval = isVM ? 3000 : 2000
  // 根据网络模式判断是否需要等待 IPv6
  const needsIPv6 = ['nat_ipv6', 'ipv6_only'].includes(instance.network_mode)

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise(resolve => setTimeout(resolve, pollInterval))

    try {
      const state = await getInstanceState(client, instance.incus_id) as {
        network?: Record<string, { addresses?: Array<{ family: string; address: string; scope?: string }> }>
      }
      ipv4 = extractIPv4(state)
      ipv6 = extractIPv6(state)

      // NAT 模式只需要 IPv4，nat_ipv6 模式需要 IPv4 和 IPv6
      if (needsIPv6) {
        if (ipv4 && ipv6) {
          console.log(`[Start] IP 获取成功: IPv4=${ipv4}, IPv6=${ipv6}`)
          break
        }
      } else {
        if (ipv4) {
          console.log(`[Start] IP 获取成功: IPv4=${ipv4} (NAT 模式，无 IPv6)`)
          break
        }
      }
      console.log(`[Start] 等待网络初始化 (attempt ${attempt + 1}): IPv4=${ipv4}, IPv6=${ipv6}`)
    } catch (_err) {
      // 继续重试
    }
  }

  const dedicatedReady = await prepareDedicatedDelivery(client, task.instanceId)
  if (dedicatedReady) await prisma.instance.update({ where: { id: task.instanceId }, data: { dedicatedNetworkReady: true } })
  await db.updateInstanceStatus(task.instanceId, 'running', { ipv4, ipv6 })
  const { reconcileTrafficStateForInstanceIds } = await import('../services/traffic-scheduler.js')
  await reconcileTrafficStateForInstanceIds([task.instanceId])

  await sendNotification(task.userId, 'instance_started', {
    instanceName: instance.name,
    hostName: host.name,
    ipv4: ipv4 || undefined,
    ipv6: ipv6 || undefined
  })

  await createLog(task.userId, 'instance', 'instance.start', `Started instance "${instance.name}" [host: ${host.name}]`, 'success', { instanceId: task.instanceId })
}

/**
 * 执行停止任务
 */
async function executeStopTask(
  task: { id: number; userId: number; instanceId: number },
  instance: { incus_id: string; name: string; image?: string | null },
  host: { name: string },
  client: Awaited<ReturnType<typeof getIncusClient>>
): Promise<void> {
  await updateInstanceTaskProgress(task.id, 'stopping')

  const collectResult = await collectTrafficForRunningInstance(task.instanceId)
  if (!collectResult.success) {
    console.warn(`[Stop] 实例 ${task.instanceId} 关机前即时采集流量失败: ${collectResult.error}`)
  }

  // 关闭该实例的所有终端连接
  const closedSessions = closeInstanceSessions(task.instanceId, 'Instance is stopping')
  if (closedSessions > 0) {
    console.log(`[Stop] Closed ${closedSessions} terminal session(s) for instance ${task.instanceId}`)
  }

  try {
    const allowCancelBusyUpdate = isAlpineImageAlias(instance.image)
    await stopInstance(client, instance.incus_id, true, {
      allowCancelBusyUpdate,
      busyUpdateCancelAfterMs: allowCancelBusyUpdate ? ALPINE_BUSY_UPDATE_CANCEL_AFTER_MS : undefined
    })
  } catch (err) {
    // 如果 Incus 返回 "已经是停止状态"，自动修正数据库状态
    if (err instanceof Error && isAlreadyInStateError(err, 'stopped')) {
      console.log(`[Stop] 实例 ${instance.incus_id} 已经是停止状态，自动修正数据库`)
      await db.updateInstanceStatus(task.instanceId, 'stopped')

      // 发送通知（状态已同步）
      await sendNotification(task.userId, 'instance_stopped', {
        instanceName: instance.name,
        hostName: host.name
      })

      await createLog(task.userId, 'instance', 'instance.stop', `Instance "${instance.name}" already stopped, synced status [host: ${host.name}]`, 'success', { instanceId: task.instanceId })
      return // 任务成功完成
    }
    throw err // 其他错误继续抛出
  }
  await db.updateInstanceStatus(task.instanceId, 'stopped')

  await sendNotification(task.userId, 'instance_stopped', {
    instanceName: instance.name,
    hostName: host.name
  })

  await createLog(task.userId, 'instance', 'instance.stop', `Stopped instance "${instance.name}" [host: ${host.name}]`, 'success', { instanceId: task.instanceId })
}

/**
 * 执行重启任务
 */
async function executeRestartTask(
  task: { id: number; userId: number; instanceId: number },
  instance: { incus_id: string; name: string; network_mode: string },
  host: { name: string },
  client: Awaited<ReturnType<typeof getIncusClient>>
): Promise<void> {
  await updateInstanceTaskProgress(task.id, 'restarting')

  const collectResult = await collectTrafficForRunningInstance(task.instanceId)
  if (!collectResult.success) {
    console.warn(`[Restart] 实例 ${task.instanceId} 重启前即时采集流量失败: ${collectResult.error}`)
  }

  // 关闭该实例的所有终端连接
  const closedSessions = closeInstanceSessions(task.instanceId, 'Instance is restarting')
  if (closedSessions > 0) {
    console.log(`[Restart] Closed ${closedSessions} terminal session(s) for instance ${task.instanceId}`)
  }

  try {
    await restartInstance(client, instance.incus_id, true)
  } catch (err) {
    // 重启失败时，检查当前状态
    // 如果实例是停止状态，则执行启动；如果是运行状态，继续重启流程
    if (err instanceof Error) {
      // 如果实例是停止状态无法重启，尝试启动它
      if (isAlreadyInStateError(err, 'stopped')) {
        console.log(`[Restart] 实例 ${instance.incus_id} 处于停止状态，尝试启动`)
        try {
          await startInstance(client, instance.incus_id)
          // 继续等待网络初始化的流程
        } catch (startErr) {
          const recovered = await recoverIpv6RouteAndStart(client, instance.incus_id, startErr)
          // 如果启动时发现已经是运行状态（极端边界情况），也视为成功
          if (recovered || (startErr instanceof Error && isAlreadyInStateError(startErr, 'running'))) {
            console.log(`[Restart] 实例 ${instance.incus_id} 已经是运行状态`)
            // 继续等待网络初始化的流程
          } else {
            throw startErr
          }
        }
      } else {
        throw err // 其他错误继续抛出
      }
    } else {
      throw err
    }
  }

  // 等待网络初始化
  let ipv4: string | null = null
  let ipv6: string | null = null
  // 根据实例类型动态调整等待窗口
  const incusInstRestart = await getInstance(client, instance.incus_id) as { type?: string }
  const isVMRestart = incusInstRestart.type === 'virtual-machine'
  const maxAttemptsRestart = isVMRestart ? 60 : 30
  const pollIntervalRestart = isVMRestart ? 3000 : 2000
  // 根据网络模式判断是否需要等待 IPv6
  const needsIPv6 = ['nat_ipv6', 'ipv6_only'].includes(instance.network_mode)

  for (let attempt = 0; attempt < maxAttemptsRestart; attempt++) {
    await new Promise(resolve => setTimeout(resolve, pollIntervalRestart))

    try {
      const state = await getInstanceState(client, instance.incus_id) as {
        network?: Record<string, { addresses?: Array<{ family: string; address: string; scope?: string }> }>
      }
      ipv4 = extractIPv4(state)
      ipv6 = extractIPv6(state)

      // NAT 模式只需要 IPv4，nat_ipv6 模式需要 IPv4 和 IPv6
      if (needsIPv6) {
        if (ipv4 && ipv6) {
          console.log(`[Restart] IP 获取成功: IPv4=${ipv4}, IPv6=${ipv6}`)
          break
        }
      } else {
        if (ipv4) {
          console.log(`[Restart] IP 获取成功: IPv4=${ipv4} (NAT 模式，无 IPv6)`)
          break
        }
      }
      console.log(`[Restart] 等待网络初始化 (attempt ${attempt + 1}): IPv4=${ipv4}, IPv6=${ipv6}`)
    } catch (_err) {
      // 继续重试
    }
  }

  const dedicatedReady = await prepareDedicatedDelivery(client, task.instanceId)
  if (dedicatedReady) await prisma.instance.update({ where: { id: task.instanceId }, data: { dedicatedNetworkReady: true } })
  await db.updateInstanceStatus(task.instanceId, 'running', { ipv4, ipv6 })

  await sendNotification(task.userId, 'instance_restarted', {
    instanceName: instance.name,
    hostName: host.name,
    ipv4: ipv4 || undefined,
    ipv6: ipv6 || undefined
  })

  await createLog(task.userId, 'instance', 'instance.restart', `Restarted instance "${instance.name}" [host: ${host.name}]`, 'success', { instanceId: task.instanceId })
}

/**
 * 执行重装任务
 */
async function clearRebuildSnapshots(client: Awaited<ReturnType<typeof getIncusClient>>, name: string, instanceId: number, operation = '重装'): Promise<void> {
  const snapshots: unknown = await listSnapshots(client, name)
  if (!Array.isArray(snapshots)) throw new Error(`快照列表无法识别，${operation}未开始`)
  const names = snapshots.map(snapshot => {
    const snapshotName = typeof snapshot === 'string' ? snapshot.split('/').pop()
      : snapshot && typeof snapshot === 'object' && 'name' in snapshot ? snapshot.name : undefined
    if (typeof snapshotName !== 'string' || !snapshotName || snapshotName === '.' || snapshotName === '..' || /[\r\n/\\]/.test(snapshotName)) {
      throw new Error(`快照名称无法识别，${operation}未开始`)
    }
    return snapshotName
  })
  for (const snapshotName of names) await deleteIncusSnapshot(client, name, snapshotName)
  const confirmed: unknown = await listSnapshots(client, name)
  if (!Array.isArray(confirmed) || confirmed.length !== 0) throw new Error(`快照尚未确认清理，${operation}未开始，请检查宿主后重试`)
  await prisma.snapshot.deleteMany({ where: { instanceId } })
}

async function executeRebuildTask(
  task: { id: number; userId: number; instanceId: number; imageAlias: string | null; sshKeyId: number | null; customInitCommandIds?: string | null },
  instance: { incus_id: string; name: string; user_id: number; image: string; network_mode: string; ipv4?: string | null; ipv6?: string | null; host_id: number; swap_enabled?: boolean; swap_size?: number | null },
  host: { name: string },
  client: Awaited<ReturnType<typeof getIncusClient>>,
  materials: DestructiveTaskMaterials,
  reinstall: Awaited<ReturnType<typeof beginInstanceReinstall>>
): Promise<void> {
  const imageAlias = task.imageAlias
  if (!imageAlias) throw new Error('未指定重装镜像')
  const publicNetwork = await originalPublicNetwork(task.instanceId, instance)
  const resumed = await reinstall.resumeRebuild()
  if (resumed) {
    await finishRebuildTask(task, instance, host, client, reinstall, resumed.config, resumed.encryptedPassword)
    return
  }
  // Only inject a key explicitly selected for this rebuild. Omitting it means password login.
  const { sshKey, extraShellCommands } = materials
  const allowCancelBusyUpdate = isAlpineImageAlias(instance.image) || isAlpineImageAlias(imageAlias)

  // 关闭该实例的所有终端连接
  const closedSessions = closeInstanceSessions(task.instanceId, 'Instance is being rebuilt')
  if (closedSessions > 0) {
    console.log(`[Rebuild] Closed ${closedSessions} terminal session(s) for instance ${task.instanceId}`)
  }

  const collectResult = await collectTrafficForRunningInstance(task.instanceId)
  if (!collectResult.success) {
    console.warn(`[Rebuild] 实例 ${task.instanceId} 重装前即时采集流量失败: ${collectResult.error}`)
  }

  // 确保实例已停止
  await updateInstanceTaskProgress(task.id, 'stopping')
  await stopInstance(client, instance.incus_id, true, {
    allowCancelBusyUpdate,
    busyUpdateCancelAfterMs: allowCancelBusyUpdate ? ALPINE_BUSY_UPDATE_CANCEL_AFTER_MS : undefined
  })
  const confirmedStop = await getInstanceState(client, instance.incus_id) as { status?: string }
  if (confirmedStop.status?.toLowerCase() !== 'stopped') {
    throw new Error('实例尚未确认停止，重装未开始，请检查宿主状态后重试')
  }

  // 删除所有快照
  await updateInstanceTaskProgress(task.id, 'deleting_snapshots')
  await clearRebuildSnapshots(client, instance.incus_id, task.instanceId)

  // Reset cloud-init only after the original remote state and snapshot cleanup are confirmed.
  await resetInstanceCloudInitState(task.instanceId)

  // 执行重装
  await updateInstanceTaskProgress(task.id, 'rebuilding')

  // SSH key is optional; password login still remains available when no key is present.
  if (!sshKey) {
    console.warn(`[Rebuild] Instance ${task.instanceId} has no SSH key; continuing without injecting authorized_keys`)
  }

  const newPassword = generateRandomPassword(16)

  // 获取实例类型 (container 或 virtual-machine)
  const incusInstance = await getInstance(client, instance.incus_id)
  const instanceType = incusInstance.type // 'container' | 'virtual-machine'

  // 生成 cloud-init 配置（用于注入 SSH 密钥和密码）
  // 容器类型也传入 network 参数以正确配置 eth0/eth1 静态 IP
  let { configPayload } = generateIncusConfig({
    instanceName: instance.name,
    imageAlias,
    rootPassword: newPassword,
    sshKey,
    networkMode: instance.network_mode as 'nat' | 'nat_ipv6' | 'nat_ipv6_nat' | 'ipv6_only' | 'ipv6_nat',
    type: instanceType,
    network: instanceType !== 'virtual-machine' && instance.ipv4 ? {
      ipAddress: `${instance.ipv4}/${publicNetwork?.ipv4PrefixLength ?? 22}`,
      gateway: publicNetwork?.ipv4Gateway || '10.10.0.1',
      dns: publicNetwork?.dns || ['10.10.0.1'],
      ipv6Address: instance.ipv6 ? `${instance.ipv6}/128` : undefined,
      ipv6Gateway: instance.ipv6 ? 'fe80::1' : undefined
    } : undefined,
    extraShellCommands
  })

  // VM 需要在 cloud-init 的 network-config 中配置网络
  // 使用实例现有的 IP 地址重新生成 network-config
  if (instanceType === 'virtual-machine') {
    const { generateVmConfig } = await import('../lib/incus-config-vm.js')
    // 获取 IPv6 网关（从宿主机配置）
    const hostInfo = await db.getHostById(instance.host_id)
    const vmResult = generateVmConfig({
      instanceName: instance.name,
      instanceIdSeed: instance.incus_id,
      imageAlias,
      rootPassword: newPassword,
      sshKey,
      network: instance.ipv4 ? {
        ipAddress: `${instance.ipv4}/${publicNetwork?.ipv4PrefixLength ?? 22}`,
        gateway: publicNetwork?.ipv4Gateway || '10.10.0.1',
        dns: publicNetwork?.dns || ['10.10.0.1'],
        ipv6Address: instance.ipv6 ? `${instance.ipv6}` : undefined,
        ipv6Gateway: instance.ipv6 ? (hostInfo?.ipv6_gateway || undefined) : undefined
      } : undefined,
      extraShellCommands
    })
    configPayload = vmResult.configPayload
    if (instance.ipv4) configPayload['user.network-config'] = generateCloudInitNetworkConfig({
      ipv4Address: instance.ipv4, ipv6List: instance.ipv6 ? [instance.ipv6] : undefined, ...publicNetwork,
      nicMacs: existingVmNicMacs(incusInstance, Boolean(instance.ipv6))
    })
    console.log(`[Rebuild] VM network-config 已更新: IPv4=${instance.ipv4 || 'dhcp'}, IPv6=${instance.ipv6 || 'none'}`)
  } else {
    console.log(`[Rebuild] Container network-config 已更新: IPv4=${instance.ipv4 || 'dhcp'}, IPv6=${instance.ipv6 || 'none'}`)
  }

  // 关键修复：如果在首次创建时网络模式使用了双栈/纯IPv6新架构（需要 eth1），
  // 在重装时必须同样注入标准的双网卡 user.network-config 配置。
  // 注意：此处强制覆盖仅对容器 (container) 生效，因为 KVM (virtual-machine) 的配置已经在前面精确包含了 match MAC 和正确拓扑，强制覆写会导致丢网络！
  if (instanceType === 'container' && instance.ipv4) {
    const { hasIpv6Support, generateCloudInitNetworkConfig } = await import('../lib/network-payload-builder.js')
    if (hasIpv6Support(instance.network_mode as any) && instance.ipv6) {
      console.log(`[Rebuild] (Container) 检测到 IPv6 Routed 网络模式，强制覆盖应用标准双栈 user.network-config...`)
      configPayload['user.network-config'] = generateCloudInitNetworkConfig({
        ipv4Address: instance.ipv4, ...publicNetwork,
        ipv6List: [instance.ipv6]
      })
    }
  }

  // 关键修复：在 rebuild 之前先更新实例的 cloud-init 配置
  // Incus rebuild API 不会覆盖现有 config，只会使用新镜像替换 rootfs
  // 所以必须先更新 config，让 rebuild 后的新系统能读取到正确的 cloud-init 配置
  // VM 关闭 UEFI 安全启动（允许用户 DD 系统等操作）
  const rebuildConfig: Record<string, string> = { ...configPayload }

  // 关键修复：清除旧的云初始化缓存键和残留系统属性（防止 Alpine <-> Debian 等跨发行版重装时 vendor-data 不兼容导致 cloud-init 崩溃）
  // Clearing the previous OS is mandatory even when optional image metadata is unavailable.
  const currentConfig = incusInstance.config || {}
  for (const key of Object.keys(currentConfig)) {
    if (key.startsWith('image.') || key === 'user.vendor-data' || key.startsWith('volatile.cloud-init.')) {
      rebuildConfig[key] = ''
    }
  }
  try {
    const { getImageAlias, getImage } = await import('../lib/incus/incus-images.js')
    const aliasInfo = await getImageAlias(client, imageAlias)
    const newImage = await getImage(client, aliasInfo.target)

    // 重新注入新镜像自带的属性
    if (newImage.properties) {
      for (const [key, value] of Object.entries(newImage.properties)) {
        if (typeof value === 'string') {
          rebuildConfig[`image.${key}`] = value
        }
      }
    }
  } catch (err) {
    console.warn('[Rebuild] 同步新镜像属性失败，将仅通过清理确保兼容性:', err)
  }

  // 必须重新涵盖刚才我们自己生成的合法 cloud-init 配置，防意外把自己的核心产出冲掉
  for (const [k, v] of Object.entries(configPayload)) {
    rebuildConfig[k] = v as string
  }

  let rebuildDevices: Record<string, Record<string, string>> | undefined
  if (instanceType === 'virtual-machine') {
    rebuildConfig['security.secureboot'] = 'false'
    const vmNicMacs = existingVmNicMacs(incusInstance, Boolean(instance.ipv6))
    const currentDevices = ((incusInstance as unknown as { devices?: Record<string, Record<string, string>> }).devices) || {}
    rebuildDevices = { ...currentDevices }

    if (rebuildDevices.eth0) {
      rebuildDevices.eth0 = {
        ...rebuildDevices.eth0,
        hwaddr: rebuildDevices.eth0.hwaddr || vmNicMacs.eth0
      }
    }

    if (rebuildDevices.eth1) {
      if (!vmNicMacs.eth1) throw Error('VM_NETWORK_IDENTITY_MISSING')
      rebuildDevices.eth1 = {
        ...rebuildDevices.eth1,
        hwaddr: rebuildDevices.eth1.hwaddr || vmNicMacs.eth1
      }
    }
  }

  console.log(`[Rebuild] 更新实例 ${instance.incus_id} 的 cloud-init 配置...`)
  const rebuildUpdates: { config: Record<string, string>; devices?: Record<string, Record<string, string>> } = {
    config: rebuildConfig
  }
  if (rebuildDevices) {
    rebuildUpdates.devices = rebuildDevices
  }
  await reinstall.preparingConfig()
  await updateInstance(client, instance.incus_id, rebuildUpdates)

  // 执行重装（不再传递 config，因为已经在上面更新了）
  console.log(`[Rebuild] 开始重装实例 ${instance.incus_id}，镜像: ${imageAlias}`)
  // The remote may replace rootfs then lose its response. Retain the encrypted
  // pending credential without advertising it as the active password yet.
  await reinstall.prepareRebuildPassword(encryptSensitiveData(newPassword), (await getInstance(client, instance.incus_id)).config || {})
  await rebuildInstance(client, instance.incus_id, { alias: imageAlias }, undefined, {
    allowCancelBusyUpdate,
    busyUpdateCancelAfterMs: allowCancelBusyUpdate ? ALPINE_BUSY_UPDATE_CANCEL_AFTER_MS : undefined
  })

  await reinstall.rebuilt()
  await finishRebuildTask(task, instance, host, client, reinstall, configPayload, encryptSensitiveData(newPassword))
}

async function finishRebuildTask(
  task: Parameters<typeof executeRebuildTask>[0],
  instance: Parameters<typeof executeRebuildTask>[1],
  host: Parameters<typeof executeRebuildTask>[2],
  client: Parameters<typeof executeRebuildTask>[3],
  reinstall: Parameters<typeof executeRebuildTask>[5],
  configPayload: Record<string, string>,
  encryptedPassword: string
) {
  const imageAlias = task.imageAlias!
  const instanceType = (await getInstance(client, instance.incus_id)).type
  const rebuiltSpecs = await reinstall.proof(false)

  // A lost start response may already have booted the rebuilt rootfs. Observe
  // first; do not rerun boot preparation on an already-running guest.
  if ((await getInstanceState(client, instance.incus_id) as { status?: string }).status !== 'Running') {
    await prepareNewContainerCloudInit(client, instance.incus_id, configPayload, instanceType === 'virtual-machine' ? 'vm' : 'container')
    await updateInstanceTaskProgress(task.id, 'starting')
    try {
      await startInstance(client, instance.incus_id)
    } catch (startErr) {
      if (!await recoverIpv6RouteAndStart(client, instance.incus_id, startErr)) throw startErr
    }
  }

  // 等待网络初始化
  let ipv4: string | null = null
  let ipv6: string | null = null
  // VM 启动慢，需要更长的等待时间
  const isVMRebuild = instanceType === 'virtual-machine'
  const maxAttempts = isVMRebuild ? 60 : 30    // VM: 60×3s=180s, 容器: 30×2s=60s
  const pollIntervalRebuild = isVMRebuild ? 3000 : 2000
  let running = false
  // 根据网络模式判断是否需要等待 IPv6
  const needsIPv6 = networkModeNeedsRoutedIpv6(instance.network_mode)

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise(resolve => setTimeout(resolve, pollIntervalRebuild))
    try {
      const state = await getInstanceState(client, instance.incus_id) as {
        status?: string
        network?: Record<string, { addresses?: Array<{ family: string; address: string; scope?: string }> }>
      }
      running = state.status === 'Running'
      if (!running) continue
      ipv4 = extractIPv4(state, instance.ipv4)
      ipv6 = extractIPv6(state, instance.ipv6)
      // NAT 模式只需要 IPv4，nat_ipv6 模式需要 IPv4 和 IPv6
      if (needsIPv6) {
        if (ipv4 && ipv6) {
          console.log(`[Rebuild] IP 获取成功: IPv4=${ipv4}, IPv6=${ipv6}`)
          break
        }
      } else {
        if (ipv4) {
          console.log(`[Rebuild] IP 获取成功: IPv4=${ipv4} (NAT 模式，无 IPv6)`)
          break
        }
      }
      console.log(`[Rebuild] 等待网络初始化 (attempt ${attempt + 1}): IPv4=${ipv4}, IPv6=${ipv6}`)
    } catch (_err) {
      // 继续重试
    }
  }

  if (!running) throw new Error('重装后未确认实例运行，保留原占用等待检查')
  if (!ipv4 || instance.ipv4 && ipv4 !== instance.ipv4 || needsIPv6 && (!ipv6 || instance.ipv6 && ipv6 !== instance.ipv6)) {
    throw Error('REBUILD_NETWORK_UNCONFIRMED')
  }
  await reinstall.source()
  const password = decryptSensitiveData(encryptedPassword)
  if (!password) throw Error('REBUILD_PASSWORD_UNAVAILABLE')
  const dedicatedReady = await prepareDedicatedDelivery(client, task.instanceId, {
    hostId: instance.host_id, name: instance.incus_id, ipv4: ipv4 || instance.ipv4 || '', password
  })
  const dedicatedIpv6 = dedicatedReady ? await prepareDedicatedIpv6Delivery(client, task.instanceId, instance.host_id, instance.incus_id) : null
  await reinstall.complete({ status: 'running', ipv4, ipv6, image: imageAlias, rootPassword: encryptedPassword,
    dedicatedNetworkReady: dedicatedReady, snapshottedSpecs: rebuiltSpecs,
    ...(dedicatedIpv6 ? { dedicatedIpv6: dedicatedIpv6 as unknown as Prisma.InputJsonValue } : {}) })
  const { reconcileTrafficStateForInstanceIds } = await import('../services/traffic-scheduler.js')
  await reconcileTrafficStateForInstanceIds([task.instanceId])

  await sendNotification(task.userId, 'instance_rebuilt', {
    instanceName: instance.name,
    hostName: host.name,
    newImage: imageAlias
  })

  await createLog(task.userId, 'instance', 'instance.rebuild', `Rebuilt instance "${instance.name}" with image ${imageAlias}`, 'success', { instanceId: task.instanceId })
}

/**
 * 执行重建任务
 * 重建会创建新的 Incus 实例替换旧实例，保留所有计费字段
 * 与重装的区别：不限制实例状态，且会删除旧实例并创建新实例
 */
async function executeRecreateTask(
  task: { id: number; userId: number; instanceId: number; imageAlias: string | null; sshKeyId: number | null; customInitCommandIds: string | null },
  instance: {
    id: number; incus_id: string; name: string; user_id: number; image: string; ipv4: string | null; ipv6: string | null;
    cpu: number; memory: number; disk: number; network_mode: string; ssh_port: number | null;
    root_password: string | null; package_id: number | null; host_id: number;
    port_limit: number | null; snapshot_limit: number | null; backup_limit: number | null; site_limit: number | null;
    swap_enabled?: boolean; swap_size?: number | null;
    limits_read?: string | null; limits_write?: string | null; limits_read_iops?: number | null; limits_write_iops?: number | null;
    limits_ingress?: string | null; limits_egress?: string | null; limits_processes?: number | null; limits_cpu_priority?: number | null;
    boot_autostart?: boolean | null; boot_autostart_priority?: number | null; boot_autostart_delay?: number | null;
    boot_host_shutdown_timeout?: number | null;
  },
  host: { id: number; name: string; nat_public_ip?: string | null; ip_address?: string | null; ipv6_gateway?: string | null; ipv6_parent_interface?: string | null },
  client: Awaited<ReturnType<typeof getIncusClient>>,
  materials: DestructiveTaskMaterials,
  reinstall: Awaited<ReturnType<typeof beginInstanceReinstall>>
): Promise<void> {
  const imageAlias = task.imageAlias || instance.image
  const publicNetwork = await originalPublicNetwork(task.instanceId, instance)
  const oldIncusId = instance.incus_id
  if (instance.package_id) rejectCustomerPrivilege((await db.getPackageById(instance.package_id))?.privileged)
  const { sshKey, extraShellCommands } = materials
  const allowCancelBusyUpdate = isAlpineImageAlias(instance.image) || isAlpineImageAlias(imageAlias)

  await prepareInstanceTaskSiteCleanup(task.id, instance)
  await prisma.instance.updateMany({ where: { id: instance.id, dedicatedIpv4: true }, data: { dedicatedNetworkReady: false } })

  const collectResult = await collectTrafficForRunningInstance(task.instanceId)
  if (!collectResult.success) {
    console.warn(`[Recreate] 实例 ${task.instanceId} 重建前即时采集流量失败: ${collectResult.error}`)
  }

  // 1. 强制停止旧实例（如果正在运行）
  await updateInstanceTaskProgress(task.id, 'stopping')
  console.log(`[Recreate] 停止旧实例 ${oldIncusId}...`)
  const originalStatePath = `/1.0/instances/${oldIncusId}/state`
  let originalExists = true
  try {
    await getInstanceState(client, oldIncusId)
  } catch (error) {
    if (error instanceof IncusApiError && error.statusCode === 404 && error.path === originalStatePath) originalExists = false
    else throw error
  }
  if (originalExists) {
    await stopInstance(client, oldIncusId, false, {
      allowCancelBusyUpdate,
      busyUpdateCancelAfterMs: allowCancelBusyUpdate ? ALPINE_BUSY_UPDATE_CANCEL_AFTER_MS : undefined
    })
    const confirmedState = await getInstanceState(client, oldIncusId) as { status?: string }
    if (confirmedState.status?.toLowerCase() !== 'stopped') {
      throw new Error('原实例尚未确认停止，重建未开始，请检查宿主状态后重试')
    }
  }

  // 2. 删除旧实例的快照
  await updateInstanceTaskProgress(task.id, 'cleaning_snapshots')
  if (originalExists) {
    await clearRebuildSnapshots(client, oldIncusId, task.instanceId, '重建')
  } else {
    // A missing state endpoint alone does not prove that the instance and its snapshots are absent.
    let confirmedMissing = false
    try { await getInstance(client, oldIncusId) } catch (error) {
      if (error instanceof IncusApiError && error.statusCode === 404 && error.path === `/1.0/instances/${oldIncusId}`) confirmedMissing = true
      else throw error
    }
    if (!confirmedMissing) throw new Error('原实例尚未确认不存在，重建未开始，请检查宿主状态后重试')
    await prisma.snapshot.deleteMany({ where: { instanceId: task.instanceId } })
  }

  // Reset initialization only after confirmed snapshot cleanup or the original instance's confirmed absence.
  await resetInstanceCloudInitState(task.instanceId)

  // 3. 获取实例类型
  let instanceType: 'container' | 'virtual-machine' = 'container'
  let pkg: Awaited<ReturnType<typeof db.getPackageById>> | null = null
  if (instance.package_id) {
    pkg = await db.getPackageById(instance.package_id)
    if (pkg?.instance_type === 'vm') {
      instanceType = 'virtual-machine'
    }
  }

  if (!sshKey) {
    console.warn(`[Recreate] Instance ${task.instanceId} has no SSH key; continuing without injecting authorized_keys`)
  }

  // 7. 分配新的随机内网 IPv4 地址（避免 IP 冲突）
  await updateInstanceTaskProgress(task.id, 'creating')
  let newIPv4: string | null = null
  try {
    // Keep the original displayed/routed address until the identity switch.
    newIPv4 = publicNetwork ? instance.ipv4 : await db.allocateAndReserveNatIpv4(host.id)
    if (newIPv4) {
      console.log(`[Recreate] 分配并预留新的内网 IPv4: ${newIPv4}`)
    }
    if (!newIPv4) {
      throw new Error('IPv4 地址池已耗尽，无法分配新地址')
    }
  } catch (err) {
    console.error('[Recreate] IPv4 分配失败:', err)
    throw new Error(`IPv4 分配失败: ${err instanceof Error ? err.message : String(err)}`)
  }

  // 8. 生成新密码和 cloud-init 配置
  // 容器类型也传入 network 参数以正确配置 eth0/eth1 静态 IP
  const newPassword = generateRandomPassword(16)
  let { configPayload } = generateIncusConfig({
    instanceName: instance.name,
    imageAlias,
    rootPassword: newPassword,
    sshKey,
    networkMode: instance.network_mode as 'nat' | 'nat_ipv6' | 'nat_ipv6_nat' | 'ipv6_only' | 'ipv6_nat',
    type: instanceType,
    network: instanceType !== 'virtual-machine' ? {
      ipAddress: `${newIPv4}/${publicNetwork?.ipv4PrefixLength ?? 22}`,
      gateway: publicNetwork?.ipv4Gateway || '10.10.0.1',
      dns: publicNetwork?.dns || ['10.10.0.1'],
      ipv6Address: instance.ipv6 ? `${instance.ipv6}/128` : undefined,
      ipv6Gateway: instance.ipv6 ? 'fe80::1' : undefined
    } : undefined,
    extraShellCommands
  })

  // 9. 生成新 Incus ID
  const shortId = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 8)()
  const newIncusId = `u${task.userId}-${shortId}`
  console.log(`[Recreate] 新实例 ID: ${newIncusId}`)
  let oldInstanceDeleted = false
  let newInstanceCreated = false
  let databaseSwitched = false
  let creationAttempt: string | undefined
  let creationStarted = false
  let replacementCleaned = true

  try {
    // VM 需要 network-config（使用新分配的 IP）
    if (instanceType === 'virtual-machine') {
      const { generateVmConfig } = await import('../lib/incus-config-vm.js')
      const vmResult = generateVmConfig({
        instanceName: instance.name,
        instanceIdSeed: newIncusId,
        imageAlias,
        rootPassword: newPassword,
        sshKey,
        network: {
          ipAddress: `${newIPv4}/${publicNetwork?.ipv4PrefixLength ?? 22}`,
          gateway: publicNetwork?.ipv4Gateway || '10.10.0.1',
          dns: publicNetwork?.dns || ['10.10.0.1'],
          ipv6Address: instance.ipv6 ? `${instance.ipv6}` : undefined,
          ipv6Gateway: instance.ipv6 ? (host.ipv6_gateway || undefined) : undefined
        },
        extraShellCommands
      })
      configPayload = vmResult.configPayload
      console.log(`[Recreate] VM network-config 已更新: IPv4=${newIPv4}, IPv6=${instance.ipv6 || 'none'}`)
    } else {
      console.log(`[Recreate] Container network-config 已更新: IPv4=${newIPv4}, IPv6=${instance.ipv6 || 'none'}`)
    }

  // 10. 选择存储池
  let storagePool = await db.resolveStoragePoolForExistingInstance(task.instanceId, host.id, { packageId: instance.package_id })
  if (!storagePool) {
    throw new Error('当前节点未配置可用于实例系统盘的存储池')
  }

  // 11. 构建实例配置（使用新分配的 IPv4）
  const { buildInstanceConfig } = await import('../lib/incus/incus-instances.js')
  const ipv6Config = instance.ipv6 ? { primaryIp: instance.ipv6 } : null

  // 根据 ioLimitMode 选择性传入 IO 限制参数
  const ioMode = (pkg as any)?.io_limit_mode || (pkg as any)?.ioLimitMode || 'throughput'

  const incusConfig = buildInstanceConfig({
    name: newIncusId,
    image: imageAlias,
    cpu: instance.cpu,
    memory: instance.memory,
    disk: instance.disk,
    sshKey: '',
    password: '',
    cloudInitConfig: configPayload as { 'user.user-data': string; 'user.network-config'?: string } | undefined,
    networkMode: (instance.network_mode || 'nat') as 'nat' | 'nat_ipv6' | 'nat_ipv6_nat' | 'ipv6_only' | 'ipv6_nat',
    nested: pkg?.nested ? true : false,
    privileged: pkg?.privileged ? true : false,
    instanceType: instanceType === 'virtual-machine' ? 'vm' : 'container',
    storagePool,
    ipv4Address: newIPv4,
    ipv6Config,
    hostInterface: host.ipv6_parent_interface || 'eth0',
    ipv6Address: instance.ipv6,
    ipv6Gateway: host.ipv6_gateway,
    limitsRead: ioMode === 'throughput' ? instance.limits_read : null,
    limitsWrite: ioMode === 'throughput' ? instance.limits_write : null,
    limitsReadIops: ioMode === 'iops' ? instance.limits_read_iops : null,
    limitsWriteIops: ioMode === 'iops' ? instance.limits_write_iops : null,
    limitsIngress: instance.limits_ingress,
    limitsEgress: instance.limits_egress,
    limitsProcesses: instance.limits_processes,
    limitsCpuPriority: instance.limits_cpu_priority,
    bootAutostart: instance.boot_autostart,
    bootAutostartPriority: instance.boot_autostart_priority,
    bootAutostartDelay: instance.boot_autostart_delay,
    bootHostShutdownTimeout: instance.boot_host_shutdown_timeout
  })

  creationAttempt = await reinstall.prepareTarget(newIncusId, instanceType)
  if (publicNetwork) (incusConfig.config as Record<string, string>)['user.network-config'] = generateCloudInitNetworkConfig({
    ipv4Address: newIPv4, ipv6List: instance.ipv6 ? [instance.ipv6] : undefined, ...publicNetwork,
    nicMacs: instanceType === 'virtual-machine' ? generateVmNicMacs(newIncusId) : undefined
  })
  await reinstall.targetAddress(newIPv4)
  ;(incusConfig.config as Record<string, string>)['user.payincus.provisioning-attempt'] = creationAttempt

  // 12. 删除旧 Incus 实例（如果还存在）
  await updateInstanceTaskProgress(task.id, 'deleting_old')
  console.log(`[Recreate] 删除旧实例 ${oldIncusId}（如果存在）...`)
  try {
    await deleteInstance(client, oldIncusId)
    console.log(`[Recreate] 旧实例 ${oldIncusId} 删除成功`)
    oldInstanceDeleted = true
    reinstall.originalDeleted()
  } catch (err) {
    // deleteInstance already handles an exact 404 and verifies guest, storage
    // and forwards are absent. Any remaining error is an unconfirmed deletion.
    const errMsg = err instanceof Error ? err.message : String(err)
    console.error(`[Recreate] 删除旧实例失败:`, err)
    throw new Error(`删除旧实例失败: ${errMsg}`)
  }

  // 12. 创建新实例
  console.log(`[Recreate] 创建新实例 ${newIncusId}...`)
  await reinstall.phase('creating')
  creationStarted = true
  replacementCleaned = false
  await createInstance(client, incusConfig)
  newInstanceCreated = true
  await reinstall.targetIdentity()
  await prepareNewContainerCloudInit(client, newIncusId, configPayload, instanceType === 'virtual-machine' ? 'vm' : 'container')

  if (instanceType === 'container') {
    await updateInstance(client, newIncusId, {
      config: {
        'limits.memory.swap': resolveIncusSwapValue(instance.swap_enabled === true, instance.swap_size)
      }
    })
  }

  // 13. 启动新实例
  await updateInstanceTaskProgress(task.id, 'starting')
  console.log(`[Recreate] 启动新实例 ${newIncusId}...`)
  await startInstance(client, newIncusId)

  // 14. 等待网络初始化
  let actualIpv6: string | null = null
  let observedIpv4: string | null = null
  let running = false
  const needsIPv6 = networkModeNeedsRoutedIpv6(instance.network_mode)
  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 2000))
    try {
      const state = await getInstanceState(client, newIncusId) as {
        status?: string
        network?: Record<string, { addresses?: Array<{ family: string; address: string; scope?: string }> }>
      }
      running = state.status === 'Running'
      if (!running) continue
      const stateIpv4 = extractIPv4(state, newIPv4)
      observedIpv4 = stateIpv4
      actualIpv6 = extractIPv6(state, instance.ipv6)
      if (needsIPv6) {
        if (stateIpv4 && actualIpv6) {
          console.log(`[Recreate] IP 确认成功: IPv4=${stateIpv4}, IPv6=${actualIpv6}`)
          break
        }
      } else {
        if (stateIpv4) {
          console.log(`[Recreate] IP 确认成功: IPv4=${stateIpv4}`)
          break
        }
      }
    } catch { /* ignore */ }
  }

  if (!running) throw new Error('重建后未确认实例运行，保留占用并清理本次创建')
  if (observedIpv4 !== newIPv4 || needsIPv6 && (!actualIpv6 || instance.ipv6 && actualIpv6 !== instance.ipv6)) throw Error('RECREATE_NETWORK_UNCONFIRMED')
  const recreatedSpecs = await reinstall.proof(true)
  const dedicatedReady = await prepareDedicatedDelivery(client, task.instanceId, {
    hostId: instance.host_id, name: newIncusId, ipv4: newIPv4, password: newPassword
  })
  const dedicatedIpv6 = dedicatedReady ? await prepareDedicatedIpv6Delivery(client, task.instanceId, instance.host_id, newIncusId) : null

  // 15. 更新数据库（使用新分配的 IP）
  await updateInstanceTaskProgress(task.id, 'updating_database')

  // Associations, credentials, identity and task result switch in one commit.
  await reinstall.complete({
      incusId: newIncusId,
      snapshottedSpecs: recreatedSpecs,
      image: imageAlias,
      rootPassword: encryptSensitiveData(newPassword),
      status: 'running',
      dedicatedNetworkReady: dedicatedReady,
      dedicatedIpv6: dedicatedIpv6 ? dedicatedIpv6 as unknown as Prisma.InputJsonValue : Prisma.JsonNull,
      ipv4: newIPv4,  // 使用新分配的 IP
      ipv6: actualIpv6 || instance.ipv6,  // IPv6 可能从网络获取或保留旧值
      storagePoolName: storagePool
      // 保留计费字段：packagePlanId, billingPrice, billingCycle, expiresAt, autoRenew 等
  }, async tx => {
    await cleanupRecreatedInstanceRecords(task.instanceId, instance.host_id, tx)
    await tx.ipAddress.deleteMany({ where: { instanceId: task.instanceId, type: 'inet4' } })
    await tx.ipAddress.create({ data: { address: newIPv4!, type: 'inet4', isPrimary: true, device: 'eth0', hostId: instance.host_id, instanceId: task.instanceId } })
  })
  databaseSwitched = true

  // 同步流量限速状态
  const { reconcileTrafficStateForInstanceIds } = await import('../services/traffic-scheduler.js')
  await reconcileTrafficStateForInstanceIds([task.instanceId])

  console.log(`[Recreate] 重建完成: ${oldIncusId} -> ${newIncusId}, 新 IP: ${newIPv4}`)

  await sendNotification(task.userId, 'instance_rebuilt', {
    instanceName: instance.name,
    hostName: host.name,
    newImage: imageAlias
  })

  await createLog(task.userId, 'instance', 'instance.recreate', `Recreated instance "${instance.name}" with image ${imageAlias} (${oldIncusId} -> ${newIncusId})`, 'success', { instanceId: task.instanceId })
  } catch (err) {
    if (!databaseSwitched && (newInstanceCreated || creationStarted)) {
      try {
        await cleanupManagedInstanceRemote(client, newIncusId, creationAttempt!)
        replacementCleaned = true
        await reinstall.phase('cleaned')
        console.log(`[Recreate] 已清理失败的新实例 ${newIncusId}`)
      } catch (cleanupErr) {
        console.warn(`[Recreate] 清理失败的新实例 ${newIncusId} 失败:`, cleanupErr)
      }
    }

    if (!databaseSwitched && oldInstanceDeleted && replacementCleaned) {
      try {
        await cleanupRecreatedInstanceRecords(task.instanceId, instance.host_id)
        await prisma.ipAddress.deleteMany({ where: { instanceId: task.instanceId } })
        await prisma.ipv6Subnet.deleteMany({ where: { instanceId: task.instanceId } })
        await prisma.instance.update({
          where: { id: task.instanceId },
          data: {
            status: 'error',
            ipv4: null,
            ipv6: null
          }
        })
        console.warn(`[Recreate] 旧实例 ${oldIncusId} 已删除但新实例未成功交付，数据库实例已标记为 error`)
      } catch (dbErr) {
        console.warn(`[Recreate] 标记重建失败实例为 error 失败:`, dbErr)
      }
    }

    if (!databaseSwitched && creationStarted && !replacementCleaned) {
      await reinstall.phase('cleanup_pending')
      throw new Error('REINSTALL_CLEANUP_PENDING：新实例清理未确认，保留身份、地址和宿主占用')
    }

    throw err
  }
}

/**
 * 执行改节点任务
 * 在目标节点创建新 Incus 实例，成功切换数据库后再清理源节点旧实例。
 */
async function executeChangeHostTask(
  task: InstanceTask,
  instance: {
    id: number; incus_id: string; name: string; user_id: number; image: string; ipv4: string | null; ipv6: string | null;
    cpu: number; memory: number; disk: number; network_mode: string; root_password: string | null; package_id: number | null; host_id: number; status: string;
    swap_enabled?: boolean; swap_size?: number | null; storage_pool_name?: string | null;
    package_plan_id?: number | null;
    limits_read?: string | null; limits_write?: string | null; limits_read_iops?: number | null; limits_write_iops?: number | null;
    limits_ingress?: string | null; limits_egress?: string | null; limits_processes?: number | null; limits_cpu_priority?: number | null;
    boot_autostart?: boolean | null; boot_autostart_priority?: number | null; boot_autostart_delay?: number | null;
    boot_host_shutdown_timeout?: number | null;
  },
  targetHost: NonNullable<Awaited<ReturnType<typeof db.getHostById>>>,
  targetClient: Awaited<ReturnType<typeof getIncusClient>>
): Promise<void> {
  const targetHostId = task.targetHostId || targetHost.id
  const sourceHostId = instance.host_id
  const oldIncusId = instance.incus_id
  const imageAlias = instance.image
  let targetResourcesReserved = false
  let dbSwitched = false
  let newIncusId = ''
  const targetAttempt = randomUUID()
  let targetUuid: string | undefined

  if (!task.sshKeyId) {
    throw new Error('改节点失败：请选择 SSH 密钥')
  }
  if (targetHostId !== targetHost.id) {
    throw new Error('任务目标节点与队列节点不一致')
  }
  if (targetHostId === sourceHostId) {
    throw new Error('目标节点不能与当前节点相同')
  }

  const sourceHost = await db.getHostById(sourceHostId)
  if (!sourceHost) {
    throw new Error('源节点不存在')
  }
  const originalRecord = await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })
  const originalHost = await prisma.host.findUniqueOrThrow({ where: { id: sourceHostId } })
  const originalClient = await getIncusClient(sourceHost)
  const sourceProof = await readRegisteredGuest(prisma, originalClient, originalRecord, originalHost)

  if (!instance.package_id) {
    throw new Error('该实例没有绑定套餐，无法改节点')
  }

  const pkg = await db.getPackageById(instance.package_id)
  if (!pkg) {
    throw new Error('实例套餐不存在，无法改节点')
  }
  rejectCustomerPrivilege(pkg.privileged)

  const packageHostIds = (pkg as { host_ids?: number[] }).host_ids || []
  if (!packageHostIds.includes(targetHostId)) {
    throw new Error('目标节点不在该套餐绑定节点中')
  }

  const packageInstanceType = ((pkg as { instance_type?: 'container' | 'vm' }).instance_type || 'container')
  const hostInstanceType = targetHost.instance_type || 'container'
  if (packageInstanceType === 'vm' && hostInstanceType === 'container') {
    throw new Error('目标节点不支持 KVM 实例')
  }
  if (packageInstanceType === 'container' && hostInstanceType === 'vm') {
    throw new Error('目标节点不支持 LXC 实例')
  }

  const imageAvailability = await getSystemImageAvailabilityForHost(imageAlias, targetHostId, {
    instanceType: packageInstanceType,
    memory: instance.memory
  })
  if (!imageAvailability.ok) {
    throw new Error(`目标节点不可用该镜像: ${imageAvailability.reason}`)
  }

  const keyRecord = await db.getSSHKeyById(task.sshKeyId)
  if (!keyRecord || keyRecord.user_id !== instance.user_id) {
    throw new Error('SSH 密钥不存在或不属于实例所有者')
  }

  let rootPassword = generateRandomPassword(16)
  if (instance.root_password) {
    try {
      const decrypted = decryptSensitiveData(instance.root_password)
      if (decrypted) {
        rootPassword = decrypted
      }
    } catch (err) {
      console.warn(`[ChangeHost] 解密原实例密码失败，将生成新密码:`, err)
    }
  }

  try {
    await prepareInstanceTaskSiteCleanup(task.id, instance)
    await updateInstanceTaskProgress(task.id, 'checking_capacity')
    const reservedHost = await prisma.$transaction(async (tx) => {
      await assertCopyMoveAuthority(tx, task)
      const reserved = await db.selectAndReserveHostWithLock(tx, {
        packageHostIds,
        cpu: instance.cpu,
        memory: instance.memory,
        disk: instance.disk,
        hostId: targetHostId,
        ownerId: pkg.user_id || targetHost.user_id,
        portCount: 0,
        packageId: instance.package_id
      })
      if (reserved) {
        const receipt = await tx.instanceTask.findUniqueOrThrow({ where: { id: task.id } })
        await tx.instanceTask.update({ where: { id: task.id }, data: { replacementState: {
          ...(receipt.replacementState as Prisma.JsonObject || {}), targetPhase: 'reserved', targetAttempt,
          sourceHostId, sourceIncusId: oldIncusId, sourceOwnerId: instance.user_id,
          sourceUuid: sourceProof.config!['volatile.uuid'], sourceCreatedAt: sourceProof.created_at,
          sourceHostIdentity: transferHostIdentity(originalHost), sourceType: sourceProof.type,
          sourceAttempt: sourceProof.config!['user.payincus.provisioning-attempt'],
          targetHostIdentity: transferHostIdentity(await tx.host.findUniqueOrThrow({ where: { id: targetHostId } })),
          targetEndpointHash: managedCleanupEndpointHash(targetClient), targetType: packageInstanceType === 'vm' ? 'virtual-machine' : 'container'
        } } })
      }
      return reserved
    }, {
      isolationLevel: 'Serializable',
      timeout: 15000
    })

    if (!reservedHost) {
      throw new Error('目标节点 CPU 或内存容量不足')
    }
    targetResourcesReserved = true

    const collectResult = await collectTrafficForRunningInstance(task.instanceId)
    if (!collectResult.success) {
      console.warn(`[ChangeHost] 实例 ${task.instanceId} 改节点前即时采集流量失败: ${collectResult.error}`)
    }

    const closedSessions = closeInstanceSessions(task.instanceId, 'Instance is changing host')
    if (closedSessions > 0) {
      console.log(`[ChangeHost] Closed ${closedSessions} terminal session(s) for instance ${task.instanceId}`)
    }

    await updateInstanceTaskProgress(task.id, 'allocating_network')
    // 换节点：实例此刻仍挂在旧宿主机下，预留必须落在目标宿主机的 ip_addresses 行上。
    const staticIPv4: string | null = await db.allocateAndReserveNatIpv4(targetHostId, task.instanceId)
    if (!staticIPv4) {
      throw new Error('IPv4 地址池已耗尽，无法分配新地址')
    }
    const addressReceipt = await prisma.instanceTask.findUniqueOrThrow({ where: { id: task.id } })
    await prisma.instanceTask.update({ where: { id: task.id }, data: { replacementState: {
      ...(addressReceipt.replacementState as Prisma.JsonObject), targetIpv4: staticIPv4
    } } })

    let staticIPv6: string | null = null
    const needsRoutedIPv6 = ['nat_ipv6', 'ipv6_only'].includes(instance.network_mode)
    if (needsRoutedIPv6 && targetHost.ipv6_subnet) {
      for (let attempts = 0; attempts < 50; attempts++) {
        staticIPv6 = generateRandomIPv6(targetHost.ipv6_subnet)
        if (await db.reserveInstanceTaskIpv6(task.id, staticIPv6)) break
        staticIPv6 = null
      }
      if (!staticIPv6) {
        throw new Error('IPv6 地址池已耗尽，无法分配新地址')
      }
    }

    const instanceType = packageInstanceType === 'vm' ? 'virtual-machine' : 'container'
    const shortId = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 8)()
    newIncusId = `u${instance.user_id}-${shortId}`

    let { configPayload } = generateIncusConfig({
      instanceName: instance.name,
      imageAlias,
      rootPassword,
      sshKey: keyRecord.public_key,
      networkMode: instance.network_mode as 'nat' | 'nat_ipv6' | 'nat_ipv6_nat' | 'ipv6_only' | 'ipv6_nat',
      type: instanceType,
      network: {
        ipAddress: `${staticIPv4}/22`,
        gateway: '10.10.0.1',
        dns: ['10.10.0.1'],
        ipv6Address: staticIPv6 ? `${staticIPv6}/128` : undefined,
        ipv6Gateway: staticIPv6 ? 'fe80::1' : undefined
      }
    })

    if (instanceType === 'virtual-machine') {
      const { generateVmConfig } = await import('../lib/incus-config-vm.js')
      const vmResult = generateVmConfig({
        instanceName: instance.name,
        instanceIdSeed: newIncusId,
        imageAlias,
        rootPassword,
        sshKey: keyRecord.public_key,
        network: {
          ipAddress: `${staticIPv4}/22`,
          gateway: '10.10.0.1',
          dns: ['10.10.0.1'],
          ipv6Address: staticIPv6 ? `${staticIPv6}` : undefined,
          ipv6Gateway: staticIPv6 ? (targetHost.ipv6_gateway || undefined) : undefined
        }
      })
      configPayload = vmResult.configPayload
    }

    const storagePool = await db.resolveStoragePoolForNewInstance(targetHostId, { packageId: instance.package_id })
    if (!storagePool) {
      throw new Error('目标节点未配置可用于实例系统盘的存储池')
    }

    const { buildInstanceConfig } = await import('../lib/incus/incus-instances.js')
    const ioMode = (pkg as any)?.io_limit_mode || (pkg as any)?.ioLimitMode || 'throughput'
    const ipv6Config = staticIPv6 ? { primaryIp: staticIPv6 } : null

    const incusConfig = buildInstanceConfig({
      name: newIncusId,
      image: imageAlias,
      cpu: instance.cpu,
      memory: instance.memory,
      disk: instance.disk,
      swapEnabled: instance.swap_enabled === true,
      swapSize: instance.swap_size ?? null,
      sshKey: '',
      password: '',
      cloudInitConfig: configPayload as { 'user.user-data': string; 'user.network-config'?: string } | undefined,
      networkMode: (instance.network_mode || 'nat') as 'nat' | 'nat_ipv6' | 'nat_ipv6_nat' | 'ipv6_only' | 'ipv6_nat',
      nested: Boolean((pkg as any)?.nested),
      privileged: Boolean((pkg as any)?.privileged),
      instanceType: packageInstanceType,
      storagePool,
      ipv4Address: staticIPv4,
      ipv6Config,
      hostInterface: targetHost.ipv6_parent_interface || 'eth0',
      ipv6Address: staticIPv6,
      ipv6Gateway: targetHost.ipv6_gateway,
      limitsRead: ioMode === 'throughput' ? instance.limits_read : null,
      limitsWrite: ioMode === 'throughput' ? instance.limits_write : null,
      limitsReadIops: ioMode === 'iops' ? instance.limits_read_iops : null,
      limitsWriteIops: ioMode === 'iops' ? instance.limits_write_iops : null,
      limitsIngress: instance.limits_ingress,
      limitsEgress: instance.limits_egress,
      limitsProcesses: instance.limits_processes,
      limitsCpuPriority: instance.limits_cpu_priority,
      bootAutostart: instance.boot_autostart,
      bootAutostartPriority: instance.boot_autostart_priority,
      bootAutostartDelay: instance.boot_autostart_delay,
      bootHostShutdownTimeout: instance.boot_host_shutdown_timeout
    })

    await updateInstanceTaskProgress(task.id, 'creating_on_target')
    console.log(`[ChangeHost] 在目标节点 ${targetHost.name} 创建实例 ${newIncusId}...`)
    ;(incusConfig.config as Record<string, string>)['user.payincus.provisioning-attempt'] = targetAttempt
    const moveRecord = await prisma.instanceTask.findUniqueOrThrow({ where: { id: task.id } })
    const targetRecord = await prisma.host.findUniqueOrThrow({ where: { id: targetHostId } })
    await prisma.instanceTask.update({ where: { id: task.id }, data: { replacementState: {
      ...(moveRecord.replacementState as Prisma.JsonObject || {}), targetAttempt, targetIncusId: newIncusId,
      targetHostIdentity: transferHostIdentity(targetRecord), targetPhase: 'creating'
    } } })
    await createInstance(targetClient, incusConfig)
    let targetProof = await readCreatedGuest(targetClient, newIncusId, targetAttempt, instanceType)
    targetUuid = targetProof.managedCleanup.uuid
    const createdReceipt = await prisma.instanceTask.findUniqueOrThrow({ where: { id: task.id } })
    await prisma.instanceTask.update({ where: { id: task.id }, data: { replacementState: {
      ...(createdReceipt.replacementState as Prisma.JsonObject), targetUuid, targetCreatedAt: targetProof.recoveryIdentity.createdAt
    } } })
    await prepareNewContainerCloudInit(targetClient, newIncusId, configPayload, instanceType === 'virtual-machine' ? 'vm' : 'container')

    await updateInstanceTaskProgress(task.id, 'starting_target')
    await startInstance(targetClient, newIncusId)

    let actualIpv4: string | null = null
    let actualIpv6: string | null = null
    const maxAttempts = instanceType === 'virtual-machine' ? 60 : 30
    const pollInterval = instanceType === 'virtual-machine' ? 3000 : 2000
    let targetRunning = false
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise(resolve => setTimeout(resolve, pollInterval))
      try {
        const state = await getInstanceState(targetClient, newIncusId) as {
          status?: string
          network?: Record<string, { addresses?: Array<{ family: string; address: string; scope?: string }> }>
        }
        targetRunning = state.status === 'Running'
        if (!targetRunning) continue
        actualIpv4 = extractIPv4(state, staticIPv4)
        if (needsRoutedIPv6) {
          actualIpv6 = extractIPv6(state, staticIPv6)
        }
        if (needsRoutedIPv6) {
          if (actualIpv4 && actualIpv6) break
        } else if (actualIpv4) {
          break
        }
      } catch {
        // keep waiting
      }
    }

    if (!targetRunning) throw Error('目标实例尚未确认运行，保留原实例')
    if (actualIpv4 !== staticIPv4 || needsRoutedIPv6 && (!actualIpv6 || actualIpv6 !== staticIPv6)) throw Error('CHANGE_HOST_NETWORK_UNCONFIRMED')
    targetProof = await readCreatedGuest(targetClient, newIncusId, targetAttempt, instanceType, targetUuid)

    await updateInstanceTaskProgress(task.id, 'switching_database')

    let baseTrafficLimit = pkg.monthly_traffic_limit ? BigInt(pkg.monthly_traffic_limit) : null
    if (instance.package_plan_id) {
      const plan = await db.getPlanById(instance.package_plan_id)
      if (plan && plan.packageId === instance.package_id) {
        baseTrafficLimit = plan.trafficLimit
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM instances WHERE id = ${task.instanceId} FOR UPDATE`
      await tx.$queryRaw`SELECT id FROM instance_tasks WHERE id = ${task.id} FOR UPDATE`
      await tx.$queryRaw`SELECT id FROM hosts WHERE id IN (${sourceHostId}, ${targetHostId}) ORDER BY id FOR SHARE`
      await assertCopyMoveAuthority(tx, task)
      await assertHostNotMaintaining(targetHostId, tx)
      await assertHostNotMaintaining(sourceHostId, tx)
      const monthlyTrafficLimit = await resolveInstanceTrafficLimitForHost(tx as any, {
        packageId: instance.package_id,
        hostId: targetHostId,
        baseTrafficLimit
      })
      const currentTraffic = await tx.instance.findUniqueOrThrow({
        where: { id: task.instanceId },
        select: { monthlyTrafficUsed: true }
      })

      await tx.portMapping.deleteMany({ where: { instanceId: task.instanceId } })
      await tx.snapshot.deleteMany({ where: { instanceId: task.instanceId } })
      await tx.backup.deleteMany({ where: { instanceId: task.instanceId } })
      await tx.restoreTask.deleteMany({
        where: {
          instanceId: task.instanceId,
          status: { in: ['COMPLETED', 'FAILED'] }
        }
      })
      await tx.backupUploadTask.deleteMany({
        where: {
          instanceId: task.instanceId,
          status: { in: ['COMPLETED', 'FAILED'] }
        }
      })
      if (await tx.proxySite.count({ where: { instanceId: task.instanceId } })) throw Error('INSTANCE_SITE_CLEANUP_UNCONFIRMED')
      await tx.backupPolicy.deleteMany({ where: { instanceId: task.instanceId } })
      await tx.snapshotPolicy.deleteMany({ where: { instanceId: task.instanceId } })
      await tx.trafficSnapshot.deleteMany({ where: { instanceId: task.instanceId } })
      await tx.ipAddress.deleteMany({ where: { instanceId: task.instanceId } })
      await tx.ipv6Subnet.deleteMany({ where: { instanceId: task.instanceId } })

      if (actualIpv6) {
        await advisoryTransactionLockString(tx, IP_ADDRESS_ALLOCATION_LOCK_NAMESPACE, actualIpv6)
        const existingIpv6 = await tx.instance.findFirst({
          where: {
            id: { not: task.instanceId },
            status: { not: 'deleted' },
            OR: [
              { ipv6: actualIpv6 },
              {
                ipAddresses: {
                  some: {
                    address: actualIpv6,
                    type: 'inet6'
                  }
                }
              }
            ]
          },
          select: { id: true }
        })
        if (existingIpv6) {
          throw new Error(`IP address ${actualIpv6} is already assigned to instance ${existingIpv6.id}`)
        }
      }

      await tx.instance.update({
        where: { id: task.instanceId },
        data: {
          hostId: targetHostId,
          incusId: newIncusId,
          snapshottedSpecs: { ...(originalRecord.snapshottedSpecs as Prisma.JsonObject || {}), ...targetProof },
          rootPassword: encryptSensitiveData(rootPassword),
          status: 'running',
          ipv4: actualIpv4,
          ipv6: actualIpv6,
          storagePoolName: storagePool,
          monthlyTrafficLimit,
          trafficStatus: calculateInstanceTrafficStatus(currentTraffic.monthlyTrafficUsed, monthlyTrafficLimit),
          cloudInitState: null,
          cloudInitSource: null,
          cloudInitLastCheckedAt: null,
          cloudInitCompletedAt: null,
          cloudInitManualCompletedAt: null,
          cloudInitManualCompletedBy: null
        }
      })

      const identityTask = await tx.instanceTask.findUniqueOrThrow({ where: { id: task.id } })
      await tx.instanceTask.update({ where: { id: task.id }, data: { replacementState: {
        ...(identityTask.replacementState as Prisma.JsonObject || {}), targetUuid, targetCreatedAt: targetProof.recoveryIdentity.createdAt,
        targetPhase: 'source_cleanup'
      } as Prisma.InputJsonValue } })

      if (actualIpv4) {
        await tx.ipAddress.create({
          data: {
            address: actualIpv4,
            type: 'inet4',
            isPrimary: true,
            isCustom: false,
            device: 'eth0',
            hostId: targetHostId,
            instanceId: task.instanceId
          }
        })
      }

      if (actualIpv6) {
        await tx.ipAddress.create({
          data: {
            address: actualIpv6,
            type: 'inet6',
            isPrimary: true,
            isCustom: false,
            device: 'eth1',
            hostId: targetHostId,
            instanceId: task.instanceId
          }
        })
      }
    })
    dbSwitched = true


    // The original UUID is recorded before switching. Reconcile its deletion
    // after the switch and keep both hosts reserved until absence is verified.
    await reconcileInterruptedReinstalls(id => id !== task.id && runningTaskIds.has(id))
    const cleanupReceipt = await prisma.instanceTask.findUniqueOrThrow({ where: { id: task.id } })
    if (cleanupReceipt.status !== 'COMPLETED') throw Error('COPY_MOVE_SOURCE_CLEANUP_PENDING')

    try {
      const { reconcileTrafficStateForInstanceIds } = await import('../services/traffic-scheduler.js')
      await reconcileTrafficStateForInstanceIds([task.instanceId])
    } catch (err) {
      console.warn(`[ChangeHost] 重算流量调度状态失败:`, err)
    }

    await sendNotification(instance.user_id, 'instance_host_changed', {
      instanceName: instance.name,
      oldHostName: sourceHost.name,
      newHostName: targetHost.name,
      ipv4: actualIpv4 || undefined,
      ipv6: actualIpv6 || undefined
    })

    await createLog(
      task.userId,
      'instance',
      'instance.change_host',
      `Changed instance "${instance.name}" host from "${sourceHost.name}" to "${targetHost.name}" (${oldIncusId} -> ${newIncusId})`,
      'success',
      { instanceId: task.instanceId }
    )
  } catch (err) {
    // Resource reservation and identity receipts were persisted before dispatch.
    // The bounded reconciler confirms cleanup before releasing that reservation.
    if (targetResourcesReserved && !dbSwitched) {
      const current = await prisma.instanceTask.findUniqueOrThrow({ where: { id: task.id } })
      await prisma.instanceTask.update({ where: { id: task.id }, data: { replacementState: {
        ...(current.replacementState as Prisma.JsonObject || {}), cleanupFromPhase: (current.replacementState as Prisma.JsonObject || {}).targetPhase,
        targetPhase: 'cleanup_pending'
      } } })
    }
    throw err
  }
}

async function setCopyPhase(taskId: number, phase: string) {
  const current = await prisma.instanceTask.findUniqueOrThrow({ where: { id: taskId } })
  await prisma.instanceTask.updateMany({ where: { id: taskId, status: 'PROCESSING', replacementState: { equals: current.replacementState! } },
    data: { replacementState: { ...(current.replacementState as Prisma.JsonObject || {}), targetPhase: phase } } })
}

/** Resume only the recorded rebuild operation, never issue another rebuild. */
let reconcilingRebuilds = false
export async function reconcileInterruptedRebuilds() {
  if (recoveryHeld() || reconcilingRebuilds) return
  reconcilingRebuilds = true
  try {
  const expired = new Date(Date.now() - HEAVY_TASK_TIMEOUT)
  const expiredTasks = await prisma.instanceTask.findMany({ where: { taskType: 'rebuild', status: 'PROCESSING',
    startedAt: { lte: expired }, replacementState: { path: ['targetPhase'], equals: 'rebuild_uncertain' },
    OR: [{ replacementState: { path: ['rebuildFailureCheckAt'], equals: Prisma.AnyNull } },
      { replacementState: { path: ['rebuildFailureCheckAt'], lte: new Date().toISOString() } }] },
    orderBy: { id: 'asc' }, take: 10 })
  for (const task of expiredTasks) {
    if (runningTaskIds.has(task.id)) continue
    try { await (await import('../services/instance-reinstall-identity.js')).reconcileExpiredRebuild(task) }
    catch (error) { console.warn(`[Rebuild] 原任务 ${task.id} 收尾核验暂未通过:`, error instanceof Error ? error.message : 'verification failed') }
    await prisma.instanceTask.updateMany({ where: { id: task.id, status: 'PROCESSING', replacementState: { equals: task.replacementState! } },
      data: { replacementState: { ...(task.replacementState as Prisma.JsonObject), rebuildFailureCheckAt: new Date(Date.now() + 60000).toISOString() } } })
  }
  await prisma.instanceTask.updateMany({ where: { taskType: 'rebuild', status: 'PROCESSING', startedAt: { lte: expired },
    progress: { not: 'manual_intervention' }, replacementState: { path: ['targetPhase'], equals: 'rebuild_uncertain' } },
    data: { progress: 'manual_intervention', error: '原重装自动续接期限已届满；保留原操作回执和资源，需核对原操作结果' } })
  const tasks = await prisma.instanceTask.findMany({ where: { taskType: 'rebuild', status: 'PROCESSING',
    startedAt: { gt: expired }, replacementState: { path: ['targetPhase'], equals: 'rebuild_uncertain' },
    AND: [
      { OR: [{ replacementState: { path: ['rebuildCompleted'], equals: true } }, { replacementState: { path: ['rebuildOperation'], string_starts_with: '/1.0/operations/' } }] },
      { OR: [{ replacementState: { path: ['rebuildResumeAttempts'], equals: Prisma.AnyNull } }, { replacementState: { path: ['rebuildResumeAttempts'], lt: 6 } }] },
      { OR: [{ replacementState: { path: ['rebuildNextAt'], equals: Prisma.AnyNull } }, { replacementState: { path: ['rebuildNextAt'], lte: new Date().toISOString() } }] }
    ] }, orderBy: { id: 'asc' }, take: 10 })
  for (const task of tasks) {
    if (runningTaskIds.has(task.id)) continue
    const state = task.replacementState as Prisma.JsonObject
    if (!task.startedAt || Date.now() - task.startedAt.getTime() >= HEAVY_TASK_TIMEOUT) {
      await prisma.instanceTask.updateMany({ where: { id: task.id, status: 'PROCESSING', replacementState: { equals: state } },
        data: { progress: 'manual_intervention', error: '原重装自动续接期限已届满；保留原操作回执和资源，需核对原操作结果' } })
      continue
    }
    if ((!state.rebuildOperation && state.rebuildCompleted !== true) || Number(state.rebuildResumeAttempts || 0) >= 6 ||
      typeof state.rebuildNextAt === 'string' && Date.parse(state.rebuildNextAt) > Date.now()) continue
    const claim = await prisma.$transaction(async tx => {
      if (!await tryAdvisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, task.instanceId)) return false
      try { await assertHostNotMaintaining(task.hostId, tx) }
      catch (error) { if (error instanceof HostMaintenanceError) return false; throw error }
      if (recoveryHeld() || await hasPendingSnapshotOperation(task.instanceId, tx) || await hasPendingProxySiteOperations(task.instanceId, tx) ||
        await tx.instanceTask.count({ where: { instanceId: task.instanceId, id: { not: task.id }, status: 'PROCESSING' } }) ||
        await tx.restoreTask.count({ where: { hostId: task.hostId, status: 'PROCESSING' } }) ||
        await tx.backupUploadTask.count({ where: { hostId: task.hostId, status: 'PROCESSING' } })) return false
      return (await tx.instanceTask.updateMany({ where: { id: task.id, status: 'PROCESSING', replacementState: { equals: state } },
        data: { replacementState: { ...state, rebuildResumeAttempts: Number(state.rebuildResumeAttempts || 0) + 1,
          rebuildNextAt: new Date(Date.now() + 60000).toISOString() } } })).count === 1
    })
    if (claim) await executeTask(task.id, task)
  }
  } finally { reconcilingRebuilds = false }
}

/**
 * 执行克隆任务
 * 注意：克隆任务比较复杂，需要处理新实例的创建
 */
async function executeCloneTask(
  task: InstanceTask,
  sourceInstance: { incus_id: string; name: string; user_id: number; image: string; cpu: number; memory: number; disk: number; network_mode: string; ssh_port: number | null; root_password: string | null; package_id: number | null; package_plan_id?: number | null; host_id: number; port_limit: number | null; snapshot_limit: number | null; backup_limit: number | null; site_limit: number | null; swap_enabled?: boolean; swap_size?: number | null; storage_pool_name?: string | null },
  host: { id: number; name: string; nat_public_ip?: string | null; ip_address?: string | null; caddy_enabled?: boolean; caddy_username?: string | null; caddy_password?: string | null; caddy_port?: number | null; nat_port_start: number | null; nat_port_end: number | null; nat_ports_used_count?: number; ipv6_subnet?: string | null; ipv6_gateway?: string | null; ipv6_parent_interface?: string | null; cpu_allowance_max?: number; memory_max?: number; instance_type?: 'container' | 'vm' | 'both' },
  client: Awaited<ReturnType<typeof getIncusClient>>
): Promise<void> {
  await updateInstanceTaskProgress(task.id, 'cloning')

  // 生成新实例名称（原名称 + -clone）
  const newInstanceName = `${sourceInstance.name}-clone`
  const shortId = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 8)()
  const newIncusId = `u${task.userId}-${shortId}`
  const cloneAttempt = randomUUID()
  let cloneUuid: string | undefined
  const cloneSource = await prisma.instance.findUniqueOrThrow({ where: { id: task.instanceId } })
  const cloneHost = await prisma.host.findUniqueOrThrow({ where: { id: sourceInstance.host_id } })
  const originalGuest = await readRegisteredGuest(prisma, client, cloneSource, cloneHost)

  // 获取源实例的端口映射
  const sourcePortMappings = await db.getPortMappings(task.instanceId)

  // 跟踪资源是否已预占（用于失败时回滚）
  let resourcesReserved = false

  try {
    await prisma.$transaction(async tx => {
      await assertCopyMoveAuthority(tx, task)
      const reserved = await db.selectAndReserveHostWithLock(tx, {
        hostId: host.id, ownerId: cloneHost.userId, packageId: sourceInstance.package_id,
        cpu: sourceInstance.cpu, memory: sourceInstance.memory, disk: sourceInstance.disk,
        networkMode: sourceInstance.network_mode
      })
      if (!reserved) throw Error('CLONE_RESOURCES_UNAVAILABLE')
      await tx.instanceTask.update({ where: { id: task.id }, data: { targetHostId: host.id, replacementState: {
        targetAttempt: cloneAttempt, targetIncusId: newIncusId, targetHostIdentity: transferHostIdentity(cloneHost),
        targetEndpointHash: managedCleanupEndpointHash(client), targetType: originalGuest.type, targetPhase: 'reserved',
        sourceHostId: host.id, sourceIncusId: sourceInstance.incus_id, sourceOwnerId: sourceInstance.user_id
      } } })
    })
    resourcesReserved = true
    // 1. 复制实例（使用 Incus copy API）
    const copyPayload = {
      name: newIncusId,
      config: { 'user.payincus.provisioning-attempt': cloneAttempt },
      source: {
        type: 'copy',
        instance_only: true,
        source: sourceInstance.incus_id
      }
    }

    await readCustomerIsolation(client, sourceInstance.incus_id)
    await setCopyPhase(task.id, 'creating')
    // Copy only the instance; historical snapshots may contain unsafe host settings.
    await client.request('POST', '/1.0/instances', copyPayload, 300000)
    await readCustomerIsolation(client, newIncusId)
    const cloneProof = await readCreatedGuest(client, newIncusId, cloneAttempt, originalGuest.type)
    cloneUuid = cloneProof.managedCleanup.uuid
    const identityReceipt = await prisma.instanceTask.findUniqueOrThrow({ where: { id: task.id } })
    await prisma.instanceTask.update({ where: { id: task.id }, data: { replacementState: {
      ...(identityReceipt.replacementState as Prisma.JsonObject), targetUuid: cloneUuid, targetCreatedAt: cloneProof.recoveryIdentity.createdAt
    } } })

    // 2. 获取新实例的设备信息，更新端口映射
    const newInstanceInfo = await getInstance(client, newIncusId)
    // Materialize inherited NIC/proxy overrides too; retaining an old profile
    // address underneath the clone would duplicate the source network.
    const devices = { ...newInstanceInfo.expanded_devices, ...newInstanceInfo.devices } as Record<string, Record<string, string>>

    // Two devices in a dual-stack mapping share one public-port reservation.
    // The clone stays on this host: keep each proven bind/connect address and
    // NAT mode instead of guessing the address family from the instance mode.
    const updatedDevices: Record<string, any> = {}
    const newPortMappings: Array<{ protocol: 'tcp' | 'udp'; publicPort: number; privatePort: number; remark: string | null; systemManaged: boolean }> = []
    await prisma.$transaction(async tx => {
    await advisoryTransactionLockString(tx, IP_ADDRESS_ALLOCATION_LOCK_NAMESPACE, `ports:host:${host.id}`)
    await assertCopyMoveAuthority(tx, task)
    const mapped = new Map<string, (typeof newPortMappings)[number]>()
    for (const [deviceName, device] of Object.entries(devices)) {
      if (device.type !== 'proxy') { updatedDevices[deviceName] = { ...device }; continue }
      const listen = device.listen?.match(/^(tcp|udp):(.+):(\d+)$/)
      const connect = device.connect?.match(/^(tcp|udp):(.+):(\d+)$/)
      if (!listen || !connect || listen[1] !== connect[1]) throw Error('CLONE_PROXY_LAYOUT_UNSUPPORTED')
      const protocol = listen[1] as 'tcp' | 'udp'
      const sourceMapping = sourcePortMappings.find(m => m.protocol === protocol && m.public_port === Number(listen[3]))
      if (!sourceMapping || sourceMapping.private_port !== Number(connect[3])) throw Error('CLONE_PROXY_MAPPING_UNCONFIRMED')
      const key = protocol + ':' + listen[3]
      let mapping = mapped.get(key)
      if (!mapping) {
        const publicPort = await db.allocatePort(host.id, protocol, newPortMappings.filter(m => m.protocol === protocol).map(m => m.publicPort), tx)
        if (!publicPort) throw Error('CLONE_PORTS_UNAVAILABLE')
        mapping = { protocol, publicPort, privatePort: sourceMapping.private_port, remark: sourceMapping.remark, systemManaged: sourceMapping.system_managed === true }
        mapped.set(key, mapping); newPortMappings.push(mapping)
      }
      updatedDevices[deviceName] = { ...device, listen: protocol + ':' + listen[2] + ':' + mapping.publicPort }
    }
    if (mapped.size !== sourcePortMappings.length) throw Error('CLONE_PROXY_MAPPING_UNCONFIRMED')
    const portsReceipt = await tx.instanceTask.findUniqueOrThrow({ where: { id: task.id } })
    await tx.instanceTask.update({ where: { id: task.id }, data: { replacementState: {
      ...(portsReceipt.replacementState as Prisma.JsonObject), targetPorts: newPortMappings
    } } })
    })

    // 3. 分配新的 IPv4 地址（克隆实例必须使用新的 IPv4，避免 IP 冲突）
    let newIPv4: string | null = null
    try {
      // 克隆此刻还没有新实例行（incus 设备配置要先定 IP），因此只做预留，不写 instance.ipv4。
      newIPv4 = await db.allocateAndReserveNatIpv4(host.id)
      if (newIPv4) {
        const currentReceipt = await prisma.instanceTask.findUniqueOrThrow({ where: { id: task.id } })
        await prisma.instanceTask.update({ where: { id: task.id }, data: { replacementState: {
          ...(currentReceipt.replacementState as Prisma.JsonObject), targetIpv4: newIPv4
        } } })
        console.log(`[Clone] 为新实例分配并预留内网 IPv4: ${newIPv4}`)
      }

      if (!newIPv4) {
        throw new Error('Failed to allocate IPv4 address, pool may be exhausted')
      }

      // 更新 eth0 设备的 ipv4.address
      if (updatedDevices['eth0']) {
        (updatedDevices['eth0'] as Record<string, string>)['ipv4.address'] = newIPv4
      } else {
        // 从原设备复制并修改
        const eth0Device = devices['eth0'] as Record<string, string> | undefined
        if (eth0Device) {
          updatedDevices['eth0'] = {
            ...eth0Device,
            'ipv4.address': newIPv4
          }
        }
      }

      // NAT 模式使用 connect 0.0.0.0，无需替换为实际 IP
    } catch (err) {
      console.error('[Clone] IPv4 分配失败:', err)
      throw err
    }

    // 4. 处理 IPv6 地址冲突（dual/ipv6 模式需要分配新 IP）
    // 新架构: IPv6 在 eth1 (routed 模式)
    let newIPv6: string | null = null

    // 先计算 IPv6 地址（不创建数据库记录）
    const cloneNeedsRoutedIpv6 = ['nat_ipv6', 'ipv6_only'].includes(sourceInstance.network_mode)
    if (cloneNeedsRoutedIpv6 && host.ipv6_subnet) {
      try {
        // 随机生成 IPv6 地址，如果地址已存在则重新生成
        let attempts = 0
        const maxAttempts = 50

        while (attempts < maxAttempts) {
          newIPv6 = generateRandomIPv6(host.ipv6_subnet)
          if (await db.reserveInstanceTaskIpv6(task.id, newIPv6)) {
            console.log(`[Clone] 为新实例随机分配 IPv6: ${newIPv6} (尝试次数: ${attempts + 1})`)
            break
          }

          attempts++
          newIPv6 = null
        }

        if (!newIPv6) {
          throw new Error(`无法为新实例找到可用的 IPv6 地址，已尝试 ${maxAttempts} 次随机生成`)
        }

        // 新架构: 更新 eth1 设备的 IPv6 地址 (routed 模式)
        if (updatedDevices['eth1']) {
          (updatedDevices['eth1'] as Record<string, string>)['ipv6.address'] = newIPv6
        } else {
          // 如果 eth1 不在 updatedDevices 中，从原设备复制并修改
          const eth1Device = devices['eth1'] as Record<string, string> | undefined
          if (eth1Device) {
            updatedDevices['eth1'] = {
              ...eth1Device,
              'ipv6.address': newIPv6
            }
          } else {
            // 创建新的 eth1 设备配置 (routed 模式)
            updatedDevices['eth1'] = {
              type: 'nic',
              nictype: 'routed',
              parent: host.ipv6_parent_interface || 'eth0',
              name: 'eth1',
              'ipv6.address': newIPv6
            }
          }
        }

        // 生成 cloud-init network-config
        // 使用新分配的 IPv4 地址和新分配的 IPv6 地址
        if (newIPv4 && newIPv6) {
          const { generateCloudInitNetworkConfig } = await import('../lib/network-payload-builder.js')
          const { generateVmNicMacs } = await import('../lib/vm-network-identifiers.js')
          const networkConfig = generateCloudInitNetworkConfig({
            ipv4Address: newIPv4,
            ipv6List: [newIPv6],
            nicMacs: originalGuest.type === 'virtual-machine' ? generateVmNicMacs(newIncusId) : undefined
          })

          // 更新实例的 cloud-init 配置
          await updateInstance(client, newIncusId, {
            config: {
              'user.network-config': networkConfig
            }
          })
          console.log(`[Clone] 生成 network-config: IPv4=${newIPv4}, IPv6=${newIPv6}`)
        }
      } catch (err) {
        console.warn(`[Clone] IPv6 计算失败:`, err)
        throw new Error('CLONE_IPV6_PREPARATION_FAILED')
      }
    }

    if (cloneNeedsRoutedIpv6 && !newIPv6) throw Error('CLONE_IPV6_UNAVAILABLE')
    // VM cloud-init must match the MACs actually assigned to its new NICs.
    if (originalGuest.type === 'virtual-machine') {
      const macs = generateVmNicMacs(newIncusId)
      for (const nic of ['eth0', 'eth1'] as const) if (updatedDevices[nic]) updatedDevices[nic].hwaddr = macs[nic]
    }
    // 4. 更新新实例的设备配置（端口映射 + IPv4 + IPv6）
    if (Object.keys(updatedDevices).length > 0) {
      await updateInstance(client, newIncusId, { devices: updatedDevices })
    }

    // 4.5. 如果只有 IPv4 没有 IPv6（NAT 模式），生成仅 IPv4 的 network-config
    if (newIPv4 && !newIPv6) {
      const { generateCloudInitNetworkConfig } = await import('../lib/network-payload-builder.js')
      const { generateVmNicMacs } = await import('../lib/vm-network-identifiers.js')
      const networkConfig = generateCloudInitNetworkConfig({
        ipv4Address: newIPv4,
        nicMacs: originalGuest.type === 'virtual-machine' ? generateVmNicMacs(newIncusId) : undefined
      })
      await updateInstance(client, newIncusId, {
        config: {
          'user.network-config': networkConfig
        }
      })
      console.log(`[Clone] 生成 network-config (NAT 模式): IPv4=${newIPv4}`)
    }

    // 5. 获取套餐信息
    const pkg = sourceInstance.package_id ? await db.getPackageById(sourceInstance.package_id) : null
    if (!pkg) {
      throw new Error('Package not found for source instance')
    }

    // 6. 创建数据库记录
    const snapshotSpecs = {
      ...cloneProof,
      packageId: pkg.id,
      packageName: pkg.name,
      cpuMax: pkg.cpu_max,
      memoryMax: pkg.memory_max,
      diskMax: pkg.disk_max,
      networkMode: sourceInstance.network_mode,
      portLimit: sourceInstance.port_limit || 20,
      nested: Boolean(pkg.nested),
      privileged: Boolean(pkg.privileged),
      nodeSelectors: JSON.parse((pkg as any).node_selectors || '[]'),
      createdAt: new Date().toISOString()
    }

    let baseTrafficLimit = pkg.monthly_traffic_limit ? BigInt(pkg.monthly_traffic_limit) : null
    if (sourceInstance.package_plan_id) {
      const plan = await db.getPlanById(sourceInstance.package_plan_id)
      if (plan && plan.packageId === sourceInstance.package_id) {
        baseTrafficLimit = plan.trafficLimit
      }
    }
    const monthlyTrafficLimit = await resolveInstanceTrafficLimitForHost(prisma as any, {
      packageId: sourceInstance.package_id,
      hostId: sourceInstance.host_id,
      baseTrafficLimit
    })

    await readCreatedGuest(client, newIncusId, cloneAttempt, originalGuest.type, cloneUuid)
    const newInstanceId = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM instances WHERE id = ${task.instanceId} FOR UPDATE`
      await tx.$queryRaw`SELECT id FROM instance_tasks WHERE id = ${task.id} FOR UPDATE`
      await tx.$queryRaw`SELECT id FROM hosts WHERE id = ${host.id} FOR UPDATE`
      await assertCopyMoveAuthority(tx, task)
      await assertHostNotMaintaining(host.id, tx)
      const row = await tx.instance.create({ data: {
        incusId: newIncusId, name: newInstanceName, userId: task.userId, hostId: host.id,
        packageId: sourceInstance.package_id, storagePoolName: sourceInstance.storage_pool_name ?? null,
        image: sourceInstance.image, cpu: sourceInstance.cpu, memory: sourceInstance.memory, disk: sourceInstance.disk,
        networkMode: sourceInstance.network_mode as any, snapshottedSpecs: snapshotSpecs,
        sshPort: 22, rootPassword: sourceInstance.root_password, monthlyTrafficLimit,
        portLimit: sourceInstance.port_limit, snapshotLimit: sourceInstance.snapshot_limit,
        backupLimit: sourceInstance.backup_limit, siteLimit: sourceInstance.site_limit,
        swapEnabled: sourceInstance.swap_enabled === true, swapSize: sourceInstance.swap_size ?? null,
        status: 'stopped', ipv4: newIPv4, ipv6: newIPv6
      } })
      for (const mapping of newPortMappings) await tx.portMapping.create({ data: {
        instanceId: row.id, hostId: host.id, ...mapping
      } })
      for (const [address, type, device] of [[newIPv4, 'inet4', 'eth0'], [newIPv6, 'inet6', 'eth1']] as const) {
        if (!address) continue
        await advisoryTransactionLockString(tx, IP_ADDRESS_ALLOCATION_LOCK_NAMESPACE, address)
        const existing = await tx.ipAddress.findFirst({ where: { address, hostId: host.id } })
        if (existing && (existing.instanceId !== null || type !== 'inet4')) throw Error('CLONE_IP_CONFLICT')
        if (existing) await tx.ipAddress.update({ where: { id: existing.id }, data: { instanceId: row.id, isPrimary: true, device } })
        else await tx.ipAddress.create({ data: { instanceId: row.id, hostId: host.id, address, type, device, isPrimary: true } })
      }
      await tx.host.update({ where: { id: host.id }, data: { natPortsUsedCount: { increment: newPortMappings.length } } })
      const current = await tx.instanceTask.findUniqueOrThrow({ where: { id: task.id } })
      await tx.instanceTask.update({ where: { id: task.id }, data: { newInstanceId: row.id, status: 'COMPLETED',
        progress: 'completed', finishedAt: new Date(), replacementState: { ...(current.replacementState as Prisma.JsonObject), targetPhase: 'verified' } } })
      return row.id
    })

    await sendNotification(task.userId, 'instance_cloned', {
      instanceName: sourceInstance.name,
      newInstanceName: newInstanceName,
      hostName: host.name
    })

    await createLog(
      task.userId,
      'instance',
      'instance.clone',
      `Cloned instance "${sourceInstance.name}" to "${newInstanceName}" [new instance ID: ${newInstanceId}]`,
      'success',
      { instanceId: newInstanceId }
    )
  } catch (error) {
    const current = await prisma.instanceTask.findUniqueOrThrow({ where: { id: task.id } })
    if (current.status === 'COMPLETED') return // Notification failure cannot delete a delivered clone.
    if (resourcesReserved) await setCopyPhase(task.id, 'cleanup_pending')
    throw error
  }
}

/**
 * 启动 Worker
 */
export function startInstanceTaskWorker(): void {
  if (workerInterval) {
    console.warn('[InstanceTaskWorker] Worker already running')
    return
  }

  console.log('[InstanceTaskWorker] 启动 Worker...')
  const cleanupPool = () => {
    if (!dbBackoff.shouldSkip()) void reconcileInterruptedRebuilds().then(() => reconcileInterruptedReinstalls(id => runningTaskIds.has(id))).then(() => processPoolCleanupQueue()).catch(err => {
      console.error('[InstanceTaskWorker] 机器池回收失败:', err)
      dbBackoff.arm(err)
    })
  }
  cleanupPool()
  poolCleanupInterval = setInterval(cleanupPool, 30000)

  // 立即清理僵尸任务
  cleanupStaleTasks().catch(err => {
    console.error('[InstanceTaskWorker] 清理僵尸任务失败:', err)
    dbBackoff.arm(err)
  })

  // 定时处理队列
  workerInterval = setInterval(() => {
    processQueue().catch(err => {
      console.error('[InstanceTaskWorker] 队列处理错误:', err)
      dbBackoff.arm(err)
    })
  }, POLL_INTERVAL)

  // 定时检查超时任务
  timeoutCheckInterval = setInterval(() => {
    cleanupTimeoutTasks().catch(err => {
      console.error('[InstanceTaskWorker] 超时检查错误:', err)
      dbBackoff.arm(err)
    })
  }, TIMEOUT_CHECK_INTERVAL)

  console.log('[InstanceTaskWorker] Worker 已启动')
}

/**
 * 停止 Worker
 */
export function stopInstanceTaskWorker(): void {
  if (poolCleanupInterval) { clearInterval(poolCleanupInterval); poolCleanupInterval = null }
  if (workerInterval) {
    clearInterval(workerInterval)
    workerInterval = null
  }
  if (timeoutCheckInterval) {
    clearInterval(timeoutCheckInterval)
    timeoutCheckInterval = null
  }
  console.log('[InstanceTaskWorker] Worker 已停止')
}
