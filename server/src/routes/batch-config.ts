/**
 * 批量配置修改路由
 * 支持宿主机所有者批量修改实例配置
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { prisma } from '../db/prisma.js'
import * as db from '../db/index.js'
import { withBatchInstanceMutation, type BatchInstanceTarget } from '../db/batch-config-mutations.js'
import type { WriteActor } from '../db/user-write-authorization.js'
import { apiError, ErrorCode } from '../lib/errors.js'
import { getIncusClient } from '../lib/incus/incus-pool.js'
import { patchInstanceResources, getInstance, updateInstance } from '../lib/incus/incus-instances.js'
import { resolveEffectiveSwapSize, resolveIncusSwapValue } from '../lib/instance-swap.js'
import { parseNullablePostgresBigIntInput } from '../lib/bigint-input.js'
import { redactAuditText } from '../lib/risk-audit.js'
import pLimit from 'p-limit'

// 每宿主机并发限制
const BATCH_CONFIG_CONCURRENCY = 10
const POSITIVE_ROUTE_ID_PATTERN = /^[1-9]\d*$/
const MAX_POSTGRES_INT_ID = 2147483647
const ADMIN_ONLY_BATCH_FIELDS = [
  'swapEnabled', 'swapSize', 'limitsRead', 'limitsWrite', 'limitsReadIops', 'limitsWriteIops',
  'limitsIngress', 'limitsEgress', 'limitsProcesses', 'limitsCpuPriority',
  'bootAutostart', 'bootAutostartPriority', 'bootAutostartDelay', 'bootHostShutdownTimeout'
]

// 可重试的错误类型
const RETRYABLE_ERRORS = [
  'ETIMEDOUT',
  'ECONNREFUSED',
  'ECONNRESET',
  'context deadline exceeded',
  'timeout'
]

function isRetryableError(error: string): boolean {
  return RETRYABLE_ERRORS.some(e => error.toLowerCase().includes(e.toLowerCase()))
}

function parsePositiveRouteId(value: string): number | null {
  if (!POSITIVE_ROUTE_ID_PATTERN.test(value)) {
    return null
  }

  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed <= MAX_POSTGRES_INT_ID ? parsed : null
}

function normalizeBatchInstanceIds(instanceIds: number[]): number[] | null {
  if (!Array.isArray(instanceIds) || instanceIds.length === 0) {
    return null
  }

  const uniqueIds = new Set<number>()
  for (const instanceId of instanceIds) {
    if (!Number.isSafeInteger(instanceId) || instanceId <= 0 || uniqueIds.has(instanceId)) {
      return null
    }
    if (instanceId > MAX_POSTGRES_INT_ID) return null
    uniqueIds.add(instanceId)
  }

  return [...uniqueIds]
}

// 批量配置修改请求体类型
interface BatchConfigBody {
  instanceIds: number[]
  config: {
    // 资源配置（需要同步到 Incus）
    cpu?: number
    memory?: number
    disk?: number
    monthlyTrafficLimit?: string | null
    swapEnabled?: boolean
    swapSize?: number | null
    // 配额限制（仅数据库）
    portLimit?: number | null
    snapshotLimit?: number | null
    backupLimit?: number | null
    siteLimit?: number | null
    // 容器权限（需要同步到 Incus）
    nested?: boolean
    privileged?: boolean
    // 高级配置（需要同步到 Incus）
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
  }
}

interface ResolvedStorageOverrides {
  limitsRead?: string | null
  limitsWrite?: string | null
  limitsReadIops?: number | null
  limitsWriteIops?: number | null
}

// 结果项类型
interface ResultItem {
  instanceId: number
  incusId: string
  name: string
  success: boolean
  error?: string
  requiresReview?: boolean
}

async function persistBatchConfigAudit(actorId: number, instanceId: number | null, action: string, content: string, result: string): Promise<void> {
  const data = { userId: actorId, instanceId, module: 'instance', action,
    content: redactAuditText(`Actor #${actorId}: ${content}`), result }
  try {
    // A competing operation can hold the target/account row. Its foreign-key
    // lock must not turn an immediate busy result into a long audit wait.
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '250ms'`
      await tx.log.create({ data })
    }, { maxWait: 1000, timeout: 1500 })
  } catch {
    // Keep the numeric identities in content even if rows are locked or gone.
    await prisma.log.create({ data: { ...data, userId: null, instanceId: null } })
  }
}

export default async function batchConfigRoutes(fastify: FastifyInstance) {
  /**
   * 批量修改实例配置
   * POST /api/hosts/:id/instances/batch-config
   */
  fastify.post<{
    Params: { id: string }
    Body: BatchConfigBody
  }>('/:id/instances/batch-config', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['instanceIds', 'config'],
        properties: {
          instanceIds: {
            type: 'array',
            items: { type: 'integer', minimum: 1 },
            minItems: 1,
            maxItems: 1000,
            uniqueItems: true
          },
          config: {
            type: 'object',
            properties: {
              // 资源配置
              cpu: { type: 'integer', minimum: 1 },
              memory: { type: 'integer', minimum: 1 },
              disk: { type: 'number', minimum: 1 },
              monthlyTrafficLimit: { type: ['string', 'null'] },
              swapEnabled: { type: 'boolean' },
              swapSize: { type: ['integer', 'null'], minimum: 0, maximum: 1048576 },
              // 配额限制
              portLimit: { type: ['integer', 'null'], minimum: 1, maximum: 1000 },
              snapshotLimit: { type: ['integer', 'null'], minimum: 0, maximum: 1000 },
              backupLimit: { type: ['integer', 'null'], minimum: 0, maximum: 1000 },
              siteLimit: { type: ['integer', 'null'], minimum: 0, maximum: 1000 },
              // 容器权限
              nested: { type: 'boolean' },
              privileged: { type: 'boolean' },
              // 高级配置
              limitsRead: { type: ['string', 'null'] },
              limitsWrite: { type: ['string', 'null'] },
              limitsReadIops: { type: ['integer', 'null'], minimum: 0 },
              limitsWriteIops: { type: ['integer', 'null'], minimum: 0 },
              limitsIngress: { type: ['string', 'null'] },
              limitsEgress: { type: ['string', 'null'] },
              limitsProcesses: { type: ['integer', 'null'], minimum: 0 },
              limitsCpuPriority: { type: ['integer', 'null'], minimum: 0, maximum: 10 },
              bootAutostart: { type: ['boolean', 'null'] },
              bootAutostartPriority: { type: ['integer', 'null'], minimum: 0, maximum: 100 },
              bootAutostartDelay: { type: ['integer', 'null'], minimum: 5, maximum: 600 },
              bootHostShutdownTimeout: { type: ['integer', 'null'], minimum: 30, maximum: 600 }
            }
          }
        }
      }
    }
  }, async (request: FastifyRequest<{
    Params: { id: string }
    Body: BatchConfigBody
  }>, reply: FastifyReply) => {
    const { user } = request
    const { id } = request.params
    const { instanceIds, config } = request.body

    // The batch endpoint must not bypass the admin-only advanced configuration APIs.
    const requiresAdmin = ADMIN_ONLY_BATCH_FIELDS.some(key => Object.prototype.hasOwnProperty.call(config, key))
    if (user.role !== 'admin' && requiresAdmin) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    const hostId = parsePositiveRouteId(id)

    if (!hostId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const normalizedInstanceIds = normalizeBatchInstanceIds(instanceIds)
    if (!normalizedInstanceIds) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid instance IDs'))
    }

    // 验证宿主机存在且属于当前用户
    const host = await db.getHostById(hostId)
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }

    // 权限检查：管理员或宿主机所有者可以批量修改配置
    if (user.role !== 'admin' && host.user_id !== user.id) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 检查是否有任何配置要修改
    if (Object.keys(config).length === 0) {
      return reply.code(400).send(apiError(ErrorCode.CONFIG_NO_CHANGES))
    }

    let parsedMonthlyTrafficLimit: bigint | null | undefined
    if (config.monthlyTrafficLimit !== undefined) {
      parsedMonthlyTrafficLimit = parseNullablePostgresBigIntInput(config.monthlyTrafficLimit)
      if (parsedMonthlyTrafficLimit === undefined) {
        return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid monthly traffic limit'))
      }
    }

    // 获取所有目标实例并验证它们属于该宿主机
    const instances = await prisma.instance.findMany({
      where: {
        id: { in: normalizedInstanceIds },
        hostId: hostId,
        status: { notIn: ['deleted', 'creating'] }
      },
      select: { id: true, userId: true, hostId: true, incusId: true, name: true }
    })

    if (instances.length !== normalizedInstanceIds.length) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Some instances are not available on this host'))
    }

    // 使用并发控制处理实例
    const limit = pLimit(BATCH_CONFIG_CONCURRENCY)
    const results: ResultItem[] = []
    
    await Promise.all(
      instances.map(instance =>
        limit(async () => {
          const result = await updateSingleInstance(
            instance,
            config,
            parsedMonthlyTrafficLimit,
            user,
            requiresAdmin
          )
          results.push(result)
          
          // 如果是可重试错误，自动重试一次
          if (!result.success && !result.requiresReview && result.error && isRetryableError(result.error)) {
            console.log(`[BatchConfig] Retrying instance ${instance.name} due to: ${result.error}`)
            const retryResult = await updateSingleInstance(
              instance,
              config,
              parsedMonthlyTrafficLimit,
              user,
              requiresAdmin
            )
            // 更新结果
            const idx = results.findIndex(r => r.instanceId === instance.id)
            if (idx >= 0) {
              results[idx] = retryResult
            }
          }
        })
      )
    )
    
    const successCount = results.filter(r => r.success).length
    const failedCount = results.filter(r => !r.success).length
    const failedItems = results.filter(r => !r.success)

    // 记录操作日志
    await persistBatchConfigAudit(
      user.id,
      null,
      'instance.batch_config',
      `Batch updated ${successCount} instances config on host #${hostId} "${host.name}", failed: ${failedCount}`,
      failedCount > 0 ? 'partial' : 'success'
    ).catch(error => console.error('[BatchConfig] Failed to persist batch summary:', redactAuditText(error instanceof Error ? error.message : String(error))))

    return {
      success: failedCount === 0,
      totalCount: instances.length,
      successCount,
      failedCount,
      failedItems,
      // 用于重试
      retryPayload: failedItems.some(i => !i.requiresReview) ? {
        instanceIds: failedItems.filter(i => !i.requiresReview).map(i => i.instanceId),
        config
      } : undefined
    }
  })
}

/**
 * 判断配置是否需要同步到 Incus
 */
function hasIncusConfig(config: BatchConfigBody['config']): boolean {
  const incusFields = [
    'cpu', 'memory', 'disk',
    'swapEnabled', 'swapSize',
    'nested', 'privileged',
    'limitsRead', 'limitsWrite', 'limitsReadIops', 'limitsWriteIops',
    'limitsIngress', 'limitsEgress', 'limitsProcesses', 'limitsCpuPriority',
    'bootAutostart', 'bootAutostartPriority', 'bootAutostartDelay', 'bootHostShutdownTimeout'
  ]
  return incusFields.some(field => config[field as keyof typeof config] !== undefined)
}

/**
 * 更新单个实例配置
 */
async function updateSingleInstance(
  target: BatchInstanceTarget & { name: string },
  config: BatchConfigBody['config'],
  parsedMonthlyTrafficLimit: bigint | null | undefined,
  actor: WriteActor,
  requiresAdmin: boolean
): Promise<ResultItem> {
  let progress = 'authorization'
  let remoteMayHaveChanged = false
  try {
    return await withBatchInstanceMutation(target, actor, requiresAdmin, async ({ tx, instance, host, deadline }) => {
      progress = 'validation'
      const hasSwapConfig = config.swapEnabled !== undefined || config.swapSize !== undefined
      const instanceKind = instance.package?.instanceType === 'vm' ? 'vm' : 'container'
      const currentSwapSize = resolveEffectiveSwapSize(instance.swapSize, instance.packagePlan?.swapSize)
      const nextSwapEnabled = config.swapEnabled ?? instance.swapEnabled
      const nextSwapSize = config.swapSize !== undefined
        ? Math.max(0, config.swapSize ?? 0)
        : currentSwapSize
      const storageOverrides = resolveStorageOverrides(config)

      if (hasSwapConfig && instanceKind === 'vm') {
        throw new Error('虚拟机不支持批量 SWAP 配置')
      }

      if (nextSwapEnabled && nextSwapSize <= 0) {
        throw new Error('启用 SWAP 前需要设置大于 0 的 SWAP 大小')
      }

      progress = 'connect'
      let client: Awaited<ReturnType<typeof getIncusClient>> | null = null
      if (hasIncusConfig(config)) {
        const pooledClient = await getIncusClient(host, tx)
        // A request-local facade bounds all requests before the DB transaction
        // deadline, without changing the shared connection's methods or identity.
        client = Object.create(pooledClient) as typeof pooledClient
        client.request = ((method: string, path: string, body: unknown = null, timeout = 120000, signal?: AbortSignal) => {
          const remaining = deadline - Date.now()
          if (remaining <= 0) throw new Error('BATCH_CONFIG_TIMEOUT: 批量配置操作已超时')
          if (!['GET', 'HEAD'].includes(method.toUpperCase())) remoteMayHaveChanged = true
          return pooledClient.request(method, path, body, Math.min(timeout, remaining), signal)
        }) as typeof pooledClient.request
      }

      // 1. 更新资源配置（CPU、内存、磁盘）到 Incus
      progress = 'remote_resources'
      if (client && (config.cpu !== undefined || config.memory !== undefined || config.disk !== undefined)) {
        await patchInstanceResources(client, instance.incusId, {
          cpu: config.cpu,
          memory: config.memory,
          disk: config.disk !== undefined ? Math.round(config.disk) : undefined
        })
      }

      // 2. 更新高级配置到 Incus
      progress = 'remote_advanced'
      if (client && (hasAdvancedIncusConfig(config) || hasSwapConfig)) {
        const incusConfig: Record<string, string | null> = {}
        const needsDeviceConfig =
          config.limitsRead !== undefined || config.limitsReadIops !== undefined ||
          config.limitsWrite !== undefined || config.limitsWriteIops !== undefined ||
          config.limitsIngress !== undefined || config.limitsEgress !== undefined
        let incusDevices: Record<string, Record<string, string>> | null = null

        if (hasSwapConfig) {
          incusConfig['limits.memory.swap'] = resolveIncusSwapValue(nextSwapEnabled, nextSwapSize)
        }

        // 容器权限
        if (config.nested !== undefined) {
          incusConfig['security.nesting'] = config.nested ? 'true' : 'false'
        }
        if (config.privileged !== undefined) {
          incusConfig['security.privileged'] = config.privileged ? 'true' : 'false'
        }

        // 进程限制
        if (config.limitsProcesses !== undefined && config.limitsProcesses !== null) {
          incusConfig['limits.processes'] = String(config.limitsProcesses)
        } else if (config.limitsProcesses !== undefined) {
          incusConfig['limits.processes'] = null
        }

        // CPU 优先级直接使用 Incus 原生 0-10 语义
        if (config.limitsCpuPriority !== undefined && config.limitsCpuPriority !== null) {
          incusConfig['limits.cpu.priority'] = String(config.limitsCpuPriority)
        } else if (config.limitsCpuPriority !== undefined) {
          incusConfig['limits.cpu.priority'] = null
        }

        // 启动设置
        if (config.bootAutostart !== undefined && config.bootAutostart !== null) {
          incusConfig['boot.autostart'] = config.bootAutostart ? 'true' : 'false'
        } else if (config.bootAutostart !== undefined) {
          incusConfig['boot.autostart'] = null
        }
        if (config.bootAutostartPriority !== undefined && config.bootAutostartPriority !== null) {
          incusConfig['boot.autostart.priority'] = String(config.bootAutostartPriority)
        } else if (config.bootAutostartPriority !== undefined) {
          incusConfig['boot.autostart.priority'] = null
        }
        if (config.bootAutostartDelay !== undefined && config.bootAutostartDelay !== null) {
          incusConfig['boot.autostart.delay'] = String(config.bootAutostartDelay)
        } else if (config.bootAutostartDelay !== undefined) {
          incusConfig['boot.autostart.delay'] = null
        }
        if (config.bootHostShutdownTimeout !== undefined && config.bootHostShutdownTimeout !== null) {
          incusConfig['boot.host_shutdown_timeout'] = String(config.bootHostShutdownTimeout)
        } else if (config.bootHostShutdownTimeout !== undefined) {
          incusConfig['boot.host_shutdown_timeout'] = null
        }

        if (needsDeviceConfig) {
          // 复制完整的设备列表，然后修改需要修改的设备
          const currentInstance = await getInstance(client, instance.incusId) as {
            devices?: Record<string, Record<string, string>>
          }
          incusDevices = currentInstance.devices ? JSON.parse(JSON.stringify(currentInstance.devices)) : {}
        }

        // 存储 I/O 限制 (应用到 root 设备)
        if (config.limitsRead !== undefined || config.limitsReadIops !== undefined ||
          config.limitsWrite !== undefined || config.limitsWriteIops !== undefined) {
          if (!incusDevices) {
            incusDevices = {}
          }
          if (!incusDevices['root']) {
            incusDevices['root'] = { path: '/', pool: 'default', type: 'disk' }
          }

          if (config.limitsRead !== undefined) {
            if (config.limitsRead !== null) {
              incusDevices['root']['limits.read'] = config.limitsRead
            } else {
              delete incusDevices['root']['limits.read']
            }
          } else if (config.limitsReadIops !== undefined) {
            if (config.limitsReadIops !== null) {
              incusDevices['root']['limits.read'] = `${config.limitsReadIops}iops`
            } else {
              delete incusDevices['root']['limits.read']
            }
          }

          if (config.limitsWrite !== undefined) {
            if (config.limitsWrite !== null) {
              incusDevices['root']['limits.write'] = config.limitsWrite
            } else {
              delete incusDevices['root']['limits.write']
            }
          } else if (config.limitsWriteIops !== undefined) {
            if (config.limitsWriteIops !== null) {
              incusDevices['root']['limits.write'] = `${config.limitsWriteIops}iops`
            } else {
              delete incusDevices['root']['limits.write']
            }
          }
        }

        // 网络限制 (应用到 eth0 设备)
        if (config.limitsIngress !== undefined || config.limitsEgress !== undefined) {
          // 确保 eth0 设备存在
          if (!incusDevices) {
            incusDevices = {}
          }
          if (!incusDevices['eth0']) {
            incusDevices['eth0'] = {
              type: 'nic',
              name: 'eth0',
              network: 'incusbr0'
            }
          }

          if (config.limitsIngress !== undefined) {
            if (config.limitsIngress !== null) {
              incusDevices['eth0']['limits.ingress'] = config.limitsIngress
            } else {
              delete incusDevices['eth0']['limits.ingress']
            }
          }

          if (config.limitsEgress !== undefined) {
            if (config.limitsEgress !== null) {
              incusDevices['eth0']['limits.egress'] = config.limitsEgress
            } else {
              delete incusDevices['eth0']['limits.egress']
            }
          }
        }

        // 应用更新到 Incus
        const updates: Record<string, unknown> = {}
        if (Object.keys(incusConfig).length > 0) {
          updates.config = incusConfig
        }
        if (incusDevices && Object.keys(incusDevices).length > 0) {
          updates.devices = incusDevices
        }

        if (Object.keys(updates).length > 0) {
          await updateInstance(client, instance.incusId, updates)
        }
      }

      // Every requested DB field and the current resource deltas commit together.
      progress = 'database_commit'
      await tx.instance.update({ where: { id: instance.id }, data: {
          cpu: config.cpu,
          memory: config.memory,
          disk: config.disk !== undefined ? Math.round(config.disk) : undefined,
          monthlyTrafficLimit: parsedMonthlyTrafficLimit,
          portLimit: config.portLimit,
          snapshotLimit: config.snapshotLimit,
          backupLimit: config.backupLimit,
          siteLimit: config.siteLimit,
          swapEnabled: config.swapEnabled,
          swapSize: config.swapSize !== undefined ? config.swapSize : config.swapEnabled === true ? nextSwapSize : undefined,
          limitsRead: storageOverrides.limitsRead,
          limitsWrite: storageOverrides.limitsWrite,
          limitsReadIops: storageOverrides.limitsReadIops,
          limitsWriteIops: storageOverrides.limitsWriteIops,
          limitsIngress: config.limitsIngress,
          limitsEgress: config.limitsEgress,
          limitsProcesses: config.limitsProcesses,
          limitsCpuPriority: config.limitsCpuPriority,
          bootAutostart: config.bootAutostart,
          bootAutostartPriority: config.bootAutostartPriority,
          bootAutostartDelay: config.bootAutostartDelay,
          bootHostShutdownTimeout: config.bootHostShutdownTimeout,
          version: { increment: 1 }
        } })
      const cpuDelta = config.cpu === undefined ? 0 : config.cpu - instance.cpu
      const memoryDelta = config.memory === undefined ? 0 : config.memory - instance.memory
      const diskDelta = config.disk === undefined ? 0 : Math.round(config.disk) - instance.disk
      if (cpuDelta !== 0 || memoryDelta !== 0 || diskDelta !== 0) {
        await tx.host.update({ where: { id: host.id }, data: {
          cpuUsed: { increment: cpuDelta },
          memoryUsed: { increment: memoryDelta },
          diskUsed: { increment: diskDelta }
        } })
      }

      return {
        instanceId: instance.id,
        incusId: instance.incusId,
        name: instance.name,
        success: true
      }
    })
  } catch (err) {
    let errorMessage = redactAuditText(err instanceof Error ? err.message : String(err))
    if (remoteMayHaveChanged) errorMessage = `远端配置可能已变更，数据库提交未确认；请核对后处理，未自动重试。步骤 ${progress}: ${errorMessage}`
    else errorMessage = `步骤 ${progress}: ${errorMessage}`
    try {
      await persistBatchConfigAudit(actor.id, target.id, 'instance.batch_config_failed',
        `Host #${target.hostId}, instance #${target.id} (${target.incusId}): ${errorMessage}`, 'failed')
    } catch (logError) {
      console.error('[BatchConfig] Failed to persist operation error:', redactAuditText(logError instanceof Error ? logError.message : String(logError)))
      errorMessage += '；错误记录未能持久化，请保留本次错误并检查数据库'
    }
    console.error(`[BatchConfig] Failed to update instance ${target.id}:`, errorMessage)
    return {
      instanceId: target.id,
      incusId: target.incusId,
      name: target.name,
      success: false,
      error: errorMessage,
      requiresReview: remoteMayHaveChanged
    }
  }
}

/**
 * 判断是否有需要同步到 Incus 的高级配置
 */
function hasAdvancedIncusConfig(config: BatchConfigBody['config']): boolean {
  const advancedFields = [
    'nested', 'privileged',
    'limitsRead', 'limitsWrite', 'limitsReadIops', 'limitsWriteIops',
    'limitsIngress', 'limitsEgress', 'limitsProcesses', 'limitsCpuPriority',
    'bootAutostart', 'bootAutostartPriority', 'bootAutostartDelay', 'bootHostShutdownTimeout'
  ]
  return advancedFields.some(field => config[field as keyof typeof config] !== undefined)
}

function resolveStorageOverrides(config: BatchConfigBody['config']): ResolvedStorageOverrides {
  const overrides: ResolvedStorageOverrides = {}

  if (config.limitsRead !== undefined) {
    overrides.limitsRead = config.limitsRead
    overrides.limitsReadIops = null
  } else if (config.limitsReadIops !== undefined) {
    overrides.limitsRead = null
    overrides.limitsReadIops = config.limitsReadIops
  }

  if (config.limitsWrite !== undefined) {
    overrides.limitsWrite = config.limitsWrite
    overrides.limitsWriteIops = null
  } else if (config.limitsWriteIops !== undefined) {
    overrides.limitsWrite = null
    overrides.limitsWriteIops = config.limitsWriteIops
  }

  return overrides
}
