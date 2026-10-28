/**
 * Incus 备份恢复服务
 * 实现从备份流恢复实例、重命名实例等功能
 */

import { type Agent, request } from 'undici'
import type { Readable } from 'stream'
import { IncusApiError, type IncusClient } from './incus-client.js'
import type { IncusApiResponse } from '../../types/incus.js'
import { waitForOperation } from './incus-utils.js'

/**
 * 生成临时实例名称
 * 格式: {originalName}-restore-{timestamp}
 */
export function generateTempInstanceName(originalName: string): string {
    const timestamp = Date.now()
    return `${originalName}-restore-${timestamp}`
}

interface RestoreFromStreamParams {
    client: IncusClient
    backupStream: Readable
    targetName: string
    poolName?: string
    signal?: AbortSignal
    timeoutMs?: number
}

/**
 * 从备份流恢复实例
 * 使用二进制流直接 POST 到 Incus API
 */
export async function restoreFromStream({
    client,
    backupStream,
    targetName,
    poolName,
    signal: callerSignal,
    timeoutMs = 300000
}: RestoreFromStreamParams): Promise<void> {
    let restoreAgent: Agent | undefined
    try {
        if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2147483647) throw new Error('Invalid restore timeout')
        if (!client.agent) throw new Error('Incus client is not connected')
        if (!targetName || targetName === '.' || targetName === '..' || /[\r\n/\\]/.test(targetName)) throw new Error('Invalid restore target')
        const started = Date.now()
        const signal = callerSignal ? AbortSignal.any([callerSignal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs)
        signal.throwIfAborted()
        restoreAgent = client.createTransport({ connectTimeout: Math.min(timeoutMs, 60000), headersTimeout: timeoutMs, bodyTimeout: 0 })
        const url = `${client.baseUrl}/1.0/instances`

        // 构建 headers
        // Incus 使用 X-Incus-* headers，但也兼容 X-LXD-* (向后兼容)
        const headers: Record<string, string> = {
            'Content-Type': 'application/octet-stream',
            'X-Incus-name': targetName
        }
        if (poolName) {
            headers['X-Incus-pool'] = poolName
        }

        const response = await request(url, {
            method: 'POST',
            dispatcher: restoreAgent,
            signal,
            headers,
            body: backupStream
        })

        const chunks: Buffer[] = []
        let bytes = 0
        for await (const chunk of response.body) {
            bytes += chunk.length
            if (bytes > 65536) throw new Error('Restore response exceeds 64 KiB')
            chunks.push(Buffer.from(chunk))
        }
        const text = Buffer.concat(chunks).toString('utf8')
        
        let data: IncusApiResponse
        try {
            data = JSON.parse(text) as IncusApiResponse
        } catch {
            console.error(`[Incus Restore] 解析响应失败: ${text.substring(0, 200)}`)
            throw new Error(`无效的响应: ${text.substring(0, 200)}`)
        }

        if (data.type === 'error' || response.statusCode >= 400) {
            console.error(`[Incus Restore] 恢复失败: ${data.error}`)
            throw new Error(data.error || '恢复失败')
        }

        // 异步操作，等待完成
        if (data.type === 'async') {
            if (!data.operation || !/^\/1\.0\/operations\/[a-f0-9-]{36}$/i.test(data.operation)) throw new Error('Invalid restore operation path')
            const remaining = timeoutMs - (Date.now() - started)
            if (remaining <= 0) throw new Error('Restore operation timeout')
            await waitForOperation(client, data.operation, remaining, signal)
        } else if (data.type !== 'sync') {
            throw new Error('Invalid restore response type')
        }
    } finally {
        backupStream.destroy()
        // Only this restore transport is owned here; the shared API client stays usable.
        await restoreAgent?.destroy().catch(() => {})
    }
}

/**
 * 重命名实例
 */
export async function renameInstance(
    client: IncusClient,
    oldName: string,
    newName: string
): Promise<void> {
    await client.request('POST', `/1.0/instances/${encodeURIComponent(oldName)}`, {
        name: newName
    })
}

/**
 * 检查实例是否存在
 */
export async function instanceExists(
    client: IncusClient,
    instanceName: string
): Promise<boolean> {
    if (!instanceName || instanceName === '.' || instanceName === '..') throw new Error('Invalid instance name')
    const path = `/1.0/instances/${encodeURIComponent(instanceName)}`
    try {
        await client.request('GET', path)
        return true
    } catch (error) {
        if (error instanceof IncusApiError && error.statusCode === 404 && error.path === path) return false
        throw error
    }
}
