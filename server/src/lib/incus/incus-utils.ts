/**
 * Incus 客户端工具函数
 */


import { IncusApiError, type IncusClient } from './incus-client.js'
import type { IncusOperation } from '../../types/incus.js'

/**
 * 等待异步操作完成
 * @param timeout 超时时间（毫秒），默认 120 秒
 */
export async function waitForOperation(
  client: IncusClient,
  operationUrl: string,
  timeout: number = 300000, // 从 120000 放宽到 300000 (5分钟)
  signal?: AbortSignal
): Promise<unknown> {
  const startTime = Date.now()

  while (Date.now() - startTime < timeout) {
    signal?.throwIfAborted()
    const remaining = timeout - (Date.now() - startTime)
    if (remaining <= 0) break
    const waitSeconds = Math.min(10, Math.max(1, Math.ceil(remaining / 1000)))
    let op: IncusOperation
    try { op = await client.request<IncusOperation>('GET', `${operationUrl}/wait?timeout=${waitSeconds}`, null, remaining, signal) }
    catch (error) {
      // Incus 6 returns a sync/error envelope when this bounded wait expires,
      // although the image/create operation is still running. Read that same
      // operation receipt; never repeat POST or extend the overall deadline.
      if (!(error instanceof IncusApiError) || ![200, 408, 504].includes(error.statusCode) ||
        error.path !== `${operationUrl}/wait?timeout=${waitSeconds}` || error.message !== 'context deadline exceeded' ||
        signal?.aborted || Date.now() - startTime >= timeout) throw error
      op = await client.request<IncusOperation>('GET', operationUrl, null, timeout - (Date.now() - startTime), signal)
    }

    if (op.status === 'Success') {
      return op.metadata
    }

    if (op.status === 'Failure') {
      throw new Error(op.err || op.error || '操作失败')
    }
    if (op.status?.toLowerCase() === 'cancelled' || op.status?.toLowerCase() === 'canceled') {
      throw new Error(op.err || op.error || 'Incus operation cancelled')
    }
  }

  throw new Error(`Incus operation timeout (${timeout} ms)`)
}

/**
 * 将 Incus 实例状态转换为系统状态
 * 注意：返回的状态必须与数据库 Instance.status 类型兼容
 * 有效状态: 'creating' | 'running' | 'stopped' | 'error' | 'deleted'
 */
export function mapInstanceStatus(incusStatus: string): string {
  const statusMap: Record<string, string> = {
    'Running': 'running',
    'Stopped': 'stopped',
    'Frozen': 'stopped',     // Frozen 映射为 stopped（对用户来说都是不可用状态）
    'Error': 'error',
    'Starting': 'creating',  // Starting 映射为 creating（启动中）
    'Stopping': 'running'    // Stopping 映射为 running（还未完全停止，等下次同步）
  }
  return statusMap[incusStatus] || 'unknown'
}

