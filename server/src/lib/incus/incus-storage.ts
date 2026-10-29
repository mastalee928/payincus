/**
 * Incus 存储池管理
 */

import type { IncusClient } from './incus-client.js'
import type { IncusStoragePool } from '../../types/incus.js'

export interface CreateStoragePoolOptions {
  name: string
  driver: 'zfs' | 'lvm' | 'btrfs' | 'dir'
  config: Record<string, string>
  description?: string
}

export interface StoragePoolWithResources extends IncusStoragePool {
  resources?: {
    space?: {
      used: number
      total: number
    }
  }
}

/**
 * 获取存储池列表
 * Incus API 返回 URL 列表，需要分别请求每个存储池的详情
 */
export async function listStoragePools(client: IncusClient): Promise<IncusStoragePool[]> {
  // Incus 返回 URL 列表如 ["/1.0/storage-pools/default"]
  const poolUrls = await client.request<string[]>('GET', '/1.0/storage-pools')
  
  // 如果返回为空，直接返回空数组
  if (!poolUrls || poolUrls.length === 0) {
    return []
  }

  // 分别获取每个存储池的详情
  const pools = await Promise.all(
    poolUrls.map(async (url) => {
      // 从 URL 提取存储池名称: "/1.0/storage-pools/default" -> "default"
      const name = url.split('/').pop() || ''
      if (!name) return null
      
      try {
        return await getStoragePool(client, name)
      } catch {
        // 单个存储池获取失败，返回基本信息
        return { name, driver: 'unknown', config: {} }
      }
    })
  )

  return pools.filter((p): p is IncusStoragePool => p !== null)
}

/**
 * 获取存储池详情
 */
export async function getStoragePool(client: IncusClient, name: string): Promise<IncusStoragePool> {
  return client.request<IncusStoragePool>('GET', `/1.0/storage-pools/${name}`)
}

/**
 * 获取存储池资源使用情况
 */
export async function getStoragePoolResources(client: IncusClient, name: string): Promise<{ space?: { used: number; total: number } }> {
  return client.request<{ space?: { used: number; total: number } }>('GET', `/1.0/storage-pools/${name}/resources`)
}

/**
 * 创建存储池
 */
export async function createStoragePool(client: IncusClient, options: CreateStoragePoolOptions): Promise<void> {
  await client.request('POST', '/1.0/storage-pools', {
    name: options.name,
    driver: options.driver,
    config: options.config,
    description: options.description || ''
  })
}

/**
 * 删除存储池
 */
export async function deleteStoragePool(client: IncusClient, name: string): Promise<void> {
  await client.request('DELETE', `/1.0/storage-pools/${name}`)
}

/**
 * 修改存储池配置
 * 使用 PATCH 方法进行部分更新
 */
export interface UpdateStoragePoolOptions {
  config?: Record<string, string>
  description?: string
}

export class StoragePoolUpdateError extends Error {
  constructor(message: string, readonly code: string, readonly statusCode: number) { super(message) }
}

export async function updateStoragePool(client: IncusClient, name: string, options: UpdateStoragePoolOptions): Promise<void> {
  const config = options.config ? { ...options.config } : undefined
  const description = options.description
  if (!config || Object.keys(config).length === 0) {
    if (description === undefined) return
  }

  const path = `/1.0/storage-pools/${encodeURIComponent(name)}`
  const deadline = Date.now() + 120000
  let etag: string | undefined
  const current = await client.request<IncusStoragePool>('GET', path, null, deadline - Date.now(), undefined,
    { onEtag: value => { etag = value } })
  if (!etag || current?.name !== name || current.description !== undefined && typeof current.description !== 'string') {
    throw new StoragePoolUpdateError('无法核验存储池当前配置或版本，请重新读取存储池后重试', 'STORAGE_POOL_STATE_UNVERIFIED', 502)
  }
  const remaining = deadline - Date.now()
  if (remaining <= 0) throw new Error('读取存储池配置超时，请重新读取后重试')
  // Incus PATCH merges config keys, but an omitted description becomes empty.
  // If-Match binds the preserved description to the same version as the update.
  await client.request('PATCH', path, { config, description: description ?? current.description ?? '' }, remaining, undefined, { ifMatch: etag })
}
