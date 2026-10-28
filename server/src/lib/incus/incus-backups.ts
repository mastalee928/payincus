/**
 * Incus 备份管理
 */

import type { IncusClient } from './incus-client.js'
import type { IncusBackup, CreateBackupOptions } from '../../types/incus.js'

/**
 * 获取实例的备份列表
 */
export async function listBackups(client: IncusClient, instanceName: string): Promise<IncusBackup[]> {
  return client.request<IncusBackup[]>('GET', `/1.0/instances/${instanceName}/backups`)
}

/**
 * 获取备份详情
 */
export async function getBackup(
  client: IncusClient,
  instanceName: string,
  backupName: string
): Promise<IncusBackup> {
  return client.request<IncusBackup>(
    'GET',
    `/1.0/instances/${instanceName}/backups/${backupName}`
  )
}

/**
 * 创建备份
 */
export async function createBackup(
  client: IncusClient,
  instanceName: string,
  backupName: string,
  options: CreateBackupOptions = {}
): Promise<unknown> {
  return client.request('POST', `/1.0/instances/${instanceName}/backups`, {
    name: backupName,
    instance_only: options.instanceOnly !== false, // 默认不包含快照
    optimized_storage: options.optimizedStorage !== false, // 默认优化存储
    compression_algorithm: options.compression || 'gzip'
  })
}

/**
 * 删除备份
 */
export async function deleteBackup(
  client: IncusClient,
  instanceName: string,
  backupName: string
): Promise<unknown> {
  return client.request('DELETE', `/1.0/instances/${instanceName}/backups/${backupName}`)
}

/**
 * 导出备份（下载）
 * 返回备份文件的 URL
 */
export function getBackupExportUrl(
  client: IncusClient,
  instanceName: string,
  backupName: string
): string {
  if ([instanceName, backupName].some(name => !name || name === '.' || name === '..')) {
    throw new Error('Invalid backup export target')
  }
  return `${client.baseUrl}/1.0/instances/${encodeURIComponent(instanceName)}/backups/${encodeURIComponent(backupName)}/export`
}

/**
 * 获取备份导出流
 * 用于流式传输备份文件到客户端
 * 备份文件可能很大，需要更长的超时时间
 */
export async function getBackupExportStream(
  client: IncusClient,
  instanceName: string,
  backupName: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<{ stream: ReadableStream<Uint8Array>; contentLength?: number }> {
  if (!client.agent) throw new Error('Incus 客户端未连接')
  const timeoutMs = options.timeoutMs ?? 30 * 60 * 1000
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2147483647) throw new Error('Invalid backup export timeout')
  const { request } = await import('undici')
  const signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)])
    : AbortSignal.timeout(timeoutMs)
  const url = getBackupExportUrl(client, instanceName, backupName)
  const exportAgent = client.createTransport({ connectTimeout: 60000, headersTimeout: 60000, bodyTimeout: 0 })
  try {
    const response = await request(url, { method: 'GET', dispatcher: exportAgent, signal })
    if (response.statusCode !== 200) {
      // An error endpoint must not be allowed to stream an unbounded body.
      let detail = ''
      for await (const chunk of response.body) {
        detail += Buffer.from(chunk).subarray(0, 4096 - Buffer.byteLength(detail)).toString('utf8')
        if (Buffer.byteLength(detail) >= 4096) break
      }
      throw new Error('导出备份失败: ' + (detail || response.statusCode))
    }
    const length = response.headers['content-length']
    const parsedLength = length === undefined ? undefined : Number(length)
    const contentLength = parsedLength !== undefined && Number.isSafeInteger(parsedLength) && parsedLength >= 0
      ? parsedLength : undefined
    const iterator = response.body[Symbol.asyncIterator]()
    let closed = false
    let removeAbortListener = () => {}
    async function finish(abort: boolean) {
      if (closed) return
      closed = true
      removeAbortListener()
      if (abort) response.body.destroy()
      await (abort ? exportAgent.destroy() : exportAgent.close()).catch(() => {})
    }
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const onAbort = () => {
          if (closed) return
          controller.error(signal.reason)
          void finish(true)
        }
        signal.addEventListener('abort', onAbort, { once: true })
        removeAbortListener = () => signal.removeEventListener('abort', onAbort)
        if (signal.aborted) onAbort()
      },
      async pull(controller) {
        try {
          const result = await iterator.next()
          if (closed) return
          if (result.done) {
            controller.close()
            await finish(false)
          } else {
            controller.enqueue(result.value)
          }
        } catch (error) {
          if (!closed) controller.error(error)
          await finish(true)
        }
      },
      async cancel() { await finish(true) }
    })
    return { stream, contentLength }
  } catch (error) {
    await exportAgent.destroy().catch(() => {})
    throw error
  }
}

/**
 * 从备份恢复实例
 */
export async function restoreFromBackup(
  client: IncusClient,
  newInstanceName: string,
  backupData: Record<string, unknown>
): Promise<unknown> {
  return client.request('POST', '/1.0/instances', {
    name: newInstanceName,
    source: {
      type: 'backup',
      ...backupData
    }
  })
}

