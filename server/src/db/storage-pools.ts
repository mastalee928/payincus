/**
 * 存储池数据库操作
 */

import { prisma } from './prisma.js'
import { Prisma, type StoragePurpose } from '@prisma/client'
import { authorizeUserWrite, type WriteActor } from './user-write-authorization.js'
import { normalizeLogContentForStorage } from '../lib/log-localization.js'

const DEFAULT_STORAGE_POOL_NAME = 'default'
type StoragePoolQueryClient = typeof prisma | Prisma.TransactionClient

export interface CreateStoragePoolData {
  hostId: number
  name: string
  driver: string
  purpose: string
  description?: string | null
  config?: Record<string, string>
}

/**
 * 创建存储池记录
 */
export async function createStoragePool(data: CreateStoragePoolData) {
  return prisma.storagePool.create({
    data: {
      hostId: data.hostId,
      name: data.name,
      driver: data.driver,
      purpose: data.purpose as StoragePurpose,
      description: data.description || null,
      config: data.config || {}
    }
  })
}

/**
 * 删除存储池记录
 */
export async function deleteStoragePool(hostId: number, name: string) {
  return prisma.storagePool.deleteMany({
    where: {
      hostId,
      name
    }
  })
}

/**
 * 获取宿主机的存储池列表
 */
export async function getStoragePoolsByHostId(hostId: number) {
  return prisma.storagePool.findMany({
    where: { hostId },
    orderBy: { createdAt: 'asc' }
  })
}

/**
 * 获取宿主机的系统盘存储池列表 (purpose = 'instance_data')
 * 用于创建实例时随机选择存储池
 */
export async function getSystemDiskPoolsByHostId(
  hostId: number,
  client: StoragePoolQueryClient = prisma
) {
  return client.storagePool.findMany({
    where: {
      hostId,
      purpose: 'instance_data'
    },
    orderBy: { createdAt: 'asc' }
  })
}

/**
 * 随机选择一个系统盘存储池
 * 返回存储池名称，如果没有配置系统盘存储池则返回 null
 */
export async function getRandomSystemDiskPool(
  hostId: number,
  client: StoragePoolQueryClient = prisma
): Promise<string | null> {
  const pools = await getSystemDiskPoolsByHostId(hostId, client)
  if (pools.length === 0) {
    return null
  }
  const randomIndex = Math.floor(Math.random() * pools.length)
  return pools[randomIndex].name
}

/**
 * 检查宿主机上是否存在指定存储池。
 * 对已落库实例，允许继续使用 "default" 回退池，避免因未登记到 storage_pools 表而丢失选择。
 */
export async function hasStoragePool(hostId: number, poolName: string): Promise<boolean> {
  if (!poolName) return false
  if (poolName === DEFAULT_STORAGE_POOL_NAME) return true

  const pool = await prisma.storagePool.findUnique({
    where: {
      hostId_name: {
        hostId,
        name: poolName
      }
    },
    select: { id: true }
  })

  return !!pool
}

/**
 * 检查指定存储池是否可作为系统盘池使用。
 */
export async function isSystemDiskPool(hostId: number, poolName: string): Promise<boolean> {
  if (!poolName) return false
  if (poolName === DEFAULT_STORAGE_POOL_NAME) {
    const pool = await prisma.storagePool.findFirst({
      where: {
        hostId,
        name: poolName,
        purpose: 'instance_data'
      },
      select: { id: true }
    })
    return !!pool
  }

  const pool = await prisma.storagePool.findFirst({
    where: {
      hostId,
      name: poolName,
      purpose: 'instance_data'
    },
    select: { id: true }
  })

  return !!pool
}

/**
 * 获取套餐在指定宿主机上配置的默认系统盘池。
 */
export async function getPackageHostStoragePool(
  packageId: number,
  hostId: number,
  client: StoragePoolQueryClient = prisma
): Promise<string | null> {
  const packageHost = await client.packageHost.findUnique({
    where: {
      packageId_hostId: {
        packageId,
        hostId
      }
    },
    select: {
      storagePoolName: true
    }
  })

  return packageHost?.storagePoolName ?? null
}

/**
 * 解析新实例应使用的存储池。
 * 优先使用套餐在当前宿主机上的显式配置，其次回退到随机系统盘池。
 */
export async function resolveStoragePoolForNewInstance(
  hostId: number,
  options: {
    packageId?: number | null
    client?: StoragePoolQueryClient
  } = {}
): Promise<string | null> {
  const { packageId, client = prisma } = options

  if (packageId) {
    const configuredPool = await getPackageHostStoragePool(packageId, hostId, client)
    if (configuredPool && await isSystemDiskPoolForClient(hostId, configuredPool, client)) {
      return configuredPool
    }
  }

  return getRandomSystemDiskPool(hostId, client)
}

export async function isSystemDiskPoolForClient(
  hostId: number,
  poolName: string,
  client: StoragePoolQueryClient = prisma
): Promise<boolean> {
  if (!poolName) return false

  const pool = await client.storagePool.findFirst({
    where: {
      hostId,
      name: poolName,
      purpose: 'instance_data'
    },
    select: { id: true }
  })

  return !!pool
}

export async function hostHasSystemDiskPool(
  hostId: number,
  options: {
    packageId?: number | null
    client?: StoragePoolQueryClient
  } = {}
): Promise<boolean> {
  return (await resolveStoragePoolForNewInstance(hostId, options)) !== null
}

/**
 * 解析已有实例后续操作应使用的存储池。
 * 优先复用实例已记录的实际池名，避免重建/恢复时因套餐配置变更而迁移到其他盘。
 */
export async function resolveStoragePoolForExistingInstance(
  instanceId: number,
  hostId: number,
  options: {
    packageId?: number | null
  } = {}
): Promise<string | null> {
  const instance = await prisma.instance.findUnique({
    where: { id: instanceId },
    select: {
      storagePoolName: true
    }
  })

  if (instance?.storagePoolName && await hasStoragePool(hostId, instance.storagePoolName)) {
    return instance.storagePoolName
  }

  return resolveStoragePoolForNewInstance(hostId, options)
}

/**
 * 获取存储池详情
 */
export async function getStoragePool(hostId: number, name: string) {
  return prisma.storagePool.findUnique({
    where: {
      hostId_name: {
        hostId,
        name
      }
    }
  })
}

/**
 * 更新存储池记录
 */
export interface UpdateStoragePoolData {
  description?: string
  purpose?: StoragePurpose
  config?: Record<string, string>
}

export async function updateStoragePool(hostId: number, name: string, data: UpdateStoragePoolData) {
  const updateData: Record<string, unknown> = {}
  
  if (data.description !== undefined) {
    updateData.description = data.description
  }
  if (data.purpose !== undefined) {
    updateData.purpose = data.purpose
  }
  if (data.config !== undefined) {
    updateData.config = data.config
  }

  return prisma.storagePool.updateMany({
    where: {
      hostId,
      name
    },
    data: updateData
  })
}

export class StoragePoolPurposeError extends Error {
  constructor(message: string, readonly statusCode: number, readonly code: string) { super(message) }
}

/** Platform purpose has no Incus side effect; authorize and audit its change atomically. */
export async function updateStoragePoolPurpose(
  expectedHost: { id: number; user_id?: number | null }, name: string, purpose: StoragePurpose, actor: WriteActor
) {
  const expected = await getStoragePool(expectedHost.id, name)
  if (!expected) throw new StoragePoolPurposeError('存储池未登记或已移除，请刷新列表', 404, 'STORAGE_POOL_NOT_FOUND')
  try {
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`
      await tx.$queryRaw`SELECT id FROM hosts WHERE id = ${expectedHost.id} FOR SHARE`
      const host = await tx.host.findUnique({ where: { id: expectedHost.id }, select: { userId: true, name: true } })
      if (!host) throw new StoragePoolPurposeError('宿主机已移除，请刷新列表', 404, 'HOST_NOT_FOUND')
      if (host.userId !== expectedHost.user_id) throw new StoragePoolPurposeError('宿主机归属已变化，请刷新后重新确认', 409, 'STORAGE_POOL_CONFIG_CHANGED')
      await tx.$queryRaw`SELECT id FROM storage_pools WHERE id = ${expected.id} FOR UPDATE`
      const current = await tx.storagePool.findUnique({ where: { id: expected.id } })
      if (!current || current.hostId !== expectedHost.id || current.name !== name || current.updatedAt.getTime() !== expected.updatedAt.getTime() ||
        current.purpose !== expected.purpose || current.description !== expected.description || current.driver !== expected.driver ||
        JSON.stringify(current.config) !== JSON.stringify(expected.config)) {
        throw new StoragePoolPurposeError('存储池配置已变化，请刷新后重新确认', 409, 'STORAGE_POOL_CONFIG_CHANGED')
      }
      if (!await authorizeUserWrite(tx, actor.id, actor) ||
        host.userId !== actor.id && (await tx.user.findUnique({ where: { id: actor.id }, select: { role: true } }))?.role !== 'admin') {
        throw new StoragePoolPurposeError('当前账号或会话已失效，或不再有此宿主机权限', 403, 'STORAGE_POOL_FORBIDDEN')
      }
      await tx.storagePool.update({ where: { id: current.id }, data: { purpose } })
      await tx.log.create({ data: { userId: actor.id, module: 'host', action: 'storage.update', result: 'success',
        content: normalizeLogContentForStorage(`Updated storage pool "${name}" on host "${host.name}"`) } })
    }, { maxWait: 5000, timeout: 15000 })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === 'P2034' || error.code === 'P2028' || error.code === 'P2010' && ['55P03', '40P01'].includes(String(error.meta?.code)))) {
      throw new StoragePoolPurposeError('存储池配置正在被其他操作修改，请刷新后重试', 409, 'STORAGE_POOL_CONFIG_CHANGED')
    }
    throw error
  }
}
