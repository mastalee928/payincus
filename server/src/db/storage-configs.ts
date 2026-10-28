/**
 * 远程存储配置数据库操作
 */

import { prisma } from './prisma.js'
import type { Prisma, StorageConfig, StorageType } from '@prisma/client'
import { authorizeUserWrite, type WriteActor } from './user-write-authorization.js'
import { USER_BACKUP_UPLOAD_LOCK_NAMESPACE, tryAdvisoryTransactionLock } from './advisory-locks.js'

export class StorageConfigMutationError extends Error {
    constructor(message: string, readonly statusCode = 409, readonly code = 'STORAGE_CONFIG_CHANGED') { super(message) }
}

async function lockStorageMutation(tx: Prisma.TransactionClient, id: number, actor: WriteActor) {
    await tx.$executeRaw`SET LOCAL lock_timeout = '3s'`
    if (!await tryAdvisoryTransactionLock(tx, USER_BACKUP_UPLOAD_LOCK_NAMESPACE, actor.id)) {
        throw new StorageConfigMutationError('存储配置正在使用，请稍后重试')
    }
    // Same storage -> user order as upload creation. FOR UPDATE also blocks
    // a concurrent upload's FOR SHARE until the active-task check commits.
    await tx.$queryRaw`SELECT id FROM storage_configs WHERE id = ${id} FOR UPDATE`
    const config = await tx.storageConfig.findUnique({ where: { id } })
    if (!config || config.userId !== actor.id || !await authorizeUserWrite(tx, actor.id, actor)) {
        throw new StorageConfigMutationError('无权修改此存储配置', 403, 'FORBIDDEN')
    }
    if (await tx.backupUploadTask.count({ where: { storageConfigId: id, status: { in: ['PENDING', 'PROCESSING'] } } })) {
        throw new StorageConfigMutationError('该存储配置仍有上传任务，请等待完成或取消后重试', 409, 'STORAGE_HAS_ACTIVE_TASKS')
    }
    return config
}

/**
 * 获取用户的存储配置列表
 */
export async function getStorageConfigsByUserId(userId: number): Promise<StorageConfig[]> {
    return prisma.storageConfig.findMany({
        where: { userId },
        orderBy: [
            { isDefault: 'desc' },
            { createdAt: 'desc' }
        ]
    })
}

/**
 * 根据 ID 获取存储配置
 */
export async function getStorageConfigById(id: number): Promise<StorageConfig | null> {
    return prisma.storageConfig.findUnique({
        where: { id }
    })
}

/**
 * 获取用户的默认存储配置
 */
export async function getDefaultStorageConfig(userId: number): Promise<StorageConfig | null> {
    return prisma.storageConfig.findFirst({
        where: { userId, isDefault: true }
    })
}

/**
 * 创建存储配置
 */
export async function createStorageConfig(data: {
    userId: number
    name: string
    type: StorageType
    host: string
    port?: number | null
    username?: string | null
    password?: string | null
    basePath?: string | null
    extra?: Record<string, unknown> | null
    isDefault?: boolean
}): Promise<StorageConfig> {
    // 如果设为默认，先取消其他默认
    if (data.isDefault) {
        await prisma.storageConfig.updateMany({
            where: { userId: data.userId, isDefault: true },
            data: { isDefault: false }
        })
    }

    return prisma.storageConfig.create({
        data: {
            userId: data.userId,
            name: data.name,
            type: data.type,
            host: data.host,
            port: data.port ?? null,
            username: data.username ?? null,
            password: data.password ?? null,
            basePath: data.basePath ?? null,
            extra: data.extra as object | undefined,
            isDefault: data.isDefault ?? false
        }
    })
}

/**
 * 更新存储配置
 */
export async function updateStorageConfig(
    id: number,
    data: {
        name?: string
        type?: StorageType
        host?: string
        port?: number | null
        username?: string | null
        password?: string | null
        basePath?: string | null
        extra?: Record<string, unknown> | null
        isDefault?: boolean
    },
    actor: WriteActor,
    expectedUpdatedAt: Date
): Promise<StorageConfig> {
    return prisma.$transaction(async tx => {
        const config = await lockStorageMutation(tx, id, actor)
        if (config.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new StorageConfigMutationError('存储配置已变化，请刷新后重试')

        // 如果设为默认，先取消其他默认
        if (data.isDefault) {
            await tx.storageConfig.updateMany({
                where: { userId: config.userId, isDefault: true, id: { not: id } },
                data: { isDefault: false }
            })
        }

        // 处理 extra 字段的 null 值
        const updateData = { ...data }
        if (updateData.extra === null) {
            updateData.extra = undefined
        }

        return tx.storageConfig.update({
            where: { id },
            data: updateData as Parameters<typeof prisma.storageConfig.update>[0]['data']
        })
    })
}

/**
 * 删除存储配置
 */
export async function deleteStorageConfig(id: number, actor: WriteActor): Promise<void> {
    await prisma.$transaction(async tx => {
        await lockStorageMutation(tx, id, actor)
        await tx.storageConfig.delete({
            where: { id }
        })
    })
}

/**
 * 设置默认存储配置
 */
export async function setDefaultStorageConfig(userId: number, id: number): Promise<void> {
    // 先取消所有默认
    await prisma.storageConfig.updateMany({
        where: { userId, isDefault: true },
        data: { isDefault: false }
    })

    // 设置新的默认
    await prisma.storageConfig.update({
        where: { id },
        data: { isDefault: true }
    })
}
