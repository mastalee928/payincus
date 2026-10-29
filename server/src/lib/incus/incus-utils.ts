/**
 * Incus 客户端工具函数
 */


import type { IncusClient } from './incus-client.js'
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
    const op = await client.request<IncusOperation>('GET', `${operationUrl}/wait?timeout=${waitSeconds}`, null, remaining, signal)

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

