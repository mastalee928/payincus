/**
 * Incus 客户端连接池管理 (高可用优化版)
 * 
 * 优化特性：
 * 1. 连接缓存复用：避免重复创建连接
 * 2. 自动重连：连接断开时自动重新连接
 * 3. 健康检查：记录连接状态和响应时间
 * 4. 过期清理：自动清理长时间未使用的连接
 */

import { prisma } from '../../db/prisma.js'
import type { IncusClient } from './incus-client.js'
import { IncusClient as Client } from './incus-client.js'
import { recordHostSuccess, recordHostError as recordHostHealthError } from './host-health.js'

interface Host {
  id: number
  url: string
  cert_path?: string | null
  key_path?: string | null
  certPath?: string | null
  keyPath?: string | null
}

interface PooledClient {
  configuration: string
  client: IncusClient
  lastUsed: number        // 最后使用时间戳
  lastResponseTime: number // 最后响应时间 (ms)
  errorCount: number       // 连续错误次数
}

const clientPool = new Map<string, PooledClient>()

// 连接过期时间 (30分钟未使用)
const CONNECTION_EXPIRE_MS = 30 * 60 * 1000

// 连接锁（防止并发重连）
const connectingLocks = new Map<string, { configuration: string; promise: Promise<IncusClient> }>()
const generations = new Map<string, number>()
const invalidations = new Map<string, number>()
const configurationLookups = new Map<string, { sequence: number; configuration: string }>()
let lookupSequence = 0
let poolGeneration = 0

// 定期清理过期连接
let cleanupInterval: ReturnType<typeof setInterval> | null = null

/**
 * 启动连接池清理定时器
 */
function ensureCleanupStarted(): void {
  if (cleanupInterval) return
  
  cleanupInterval = setInterval(async () => {
    const now = Date.now()
    const expiredKeys: string[] = []
    
    for (const [key, pooled] of clientPool) {
      if (now - pooled.lastUsed > CONNECTION_EXPIRE_MS) {
        expiredKeys.push(key)
      }
    }
    
    for (const key of expiredKeys) {
      // 先从池中移除，避免竞态条件（其他请求在 close 期间使用该连接）
      const pooled = clientPool.get(key)
      if (pooled) {
        clientPool.delete(key)
        try {
          await pooled.client.close()
        } catch {
          // 忽略关闭错误
        }
        console.log(`[IncusPool] Closed expired connection: ${key}`)
      }
    }
  }, 5 * 60 * 1000) // 每5分钟检查一次
}

/**
 * 获取或创建 Incus 客户端（带并发保护）
 */
export async function getIncusClient(host: Host): Promise<IncusClient> {
  ensureCleanupStarted()
  const key = `${host.id}`
  const invalidation = invalidations.get(key) ?? 0
  const globalGeneration = poolGeneration
  const sequence = ++lookupSequence
  const options = await prisma.host.findUnique({ where: { id: host.id }, select: {
    url: true, certPath: true, keyPath: true, serverCertificate: true, serverFingerprint: true
  } })
  if (!options) throw new Error('Incus host no longer exists')
  if (invalidation !== (invalidations.get(key) ?? 0) || globalGeneration !== poolGeneration) {
    throw new Error('Incus connection invalidated during configuration lookup')
  }
  const configuration = JSON.stringify(options)
  const latestLookup = configurationLookups.get(key)
  if (latestLookup && latestLookup.sequence > sequence && latestLookup.configuration !== configuration) {
    throw new Error('Incus connection configuration lookup superseded')
  }
  if (!latestLookup || sequence > latestLookup.sequence) configurationLookups.set(key, { sequence, configuration })
  const existingLock = connectingLocks.get(key)
  if (existingLock?.configuration === configuration) return existingLock.promise
  const pooled = clientPool.get(key)
  if (pooled?.configuration === configuration && pooled.client.connected && !existingLock) {
    pooled.lastUsed = Date.now()
    return pooled.client
  }

  // Invalidate before any await: an old connect/close cannot republish or erase
  // a connection for a newer address, certificate or removal generation.
  const nextGeneration = (generations.get(key) ?? 0) + 1
  generations.set(key, nextGeneration)
  clientPool.delete(key)
  const current = () => (generations.get(key) ?? 0) === nextGeneration && poolGeneration === globalGeneration
  let client: IncusClient | null = null
  const connectPromise = Promise.resolve().then(async () => {
    try {
      if (pooled) await pooled.client.close()
      if (!current()) throw new Error('Incus connection configuration changed')
      client = new Client(options)
      await client.connect()
      if (!current()) throw new Error('Incus connection invalidated while connecting')
      const confirmed = await prisma.host.findUnique({ where: { id: host.id }, select: {
        url: true, certPath: true, keyPath: true, serverCertificate: true, serverFingerprint: true
      } })
      if (!current() || JSON.stringify(confirmed) !== configuration) {
        throw new Error('Incus connection configuration changed while connecting')
      }
      clientPool.set(key, {
        client, configuration, lastUsed: Date.now(), lastResponseTime: 0, errorCount: 0
      })
      return client
    } catch (error) {
      if (client) await client.close().catch(() => {})
      throw error
    } finally {
      if (connectingLocks.get(key)?.promise === connectPromise) connectingLocks.delete(key)
    }
  })
  connectingLocks.set(key, { configuration, promise: connectPromise })
  return connectPromise
}

/**
 * 更新客户端响应时间（用于性能监控，并重置错误计数）
 */
export function updateClientResponseTime(hostId: number, responseTime: number): void {
  const key = `${hostId}`
  const pooled = clientPool.get(key)
  if (pooled) {
    pooled.lastResponseTime = responseTime
    pooled.lastUsed = Date.now()
    // 成功响应时重置错误计数
    pooled.errorCount = 0
  }
  // 同步到统一健康状态模块
  recordHostSuccess(hostId, responseTime)
}

/**
 * 记录客户端错误
 */
export function recordClientError(hostId: number): void {
  const key = `${hostId}`
  const pooled = clientPool.get(key)
  if (pooled) {
    pooled.errorCount++
  }
  // 同步到统一健康状态模块
  recordHostHealthError(hostId)
}

/**
 * 获取连接池状态（用于监控）
 */
export function getPoolStatus(): Map<string, {
  connected: boolean
  lastUsed: number
  lastResponseTime: number
  errorCount: number
}> {
  const result = new Map()
  for (const [key, pooled] of clientPool) {
    result.set(key, {
      connected: pooled.client.connected,
      lastUsed: pooled.lastUsed,
      lastResponseTime: pooled.lastResponseTime,
      errorCount: pooled.errorCount
    })
  }
  return result
}

/**
 * 移除客户端连接
 */
export async function removeIncusClient(hostId: number): Promise<void> {
  const key = `${hostId}`
  generations.set(key, (generations.get(key) ?? 0) + 1)
  invalidations.set(key, (invalidations.get(key) ?? 0) + 1)
  connectingLocks.delete(key)
  configurationLookups.delete(key)
  const pooled = clientPool.get(key)
  clientPool.delete(key)
  if (pooled) await pooled.client.close()
}

/**
 * 获取 Incus 客户端（别名，用于流量调度器等服务）
 */
export const getIncusClientFromPool = getIncusClient

/**
 * 关闭所有连接
 */
export async function closeAllClients(): Promise<void> {
  if (cleanupInterval) {
    clearInterval(cleanupInterval)
    cleanupInterval = null
  }
  
  poolGeneration++
  connectingLocks.clear()
  configurationLookups.clear()
  const clients = [...clientPool.values()]
  clientPool.clear()
  for (const pooled of clients) {
    try {
      await pooled.client.close()
    } catch {
      // 忽略关闭错误
    }
  }
}
