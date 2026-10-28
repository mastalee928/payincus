/**
 * 恢复任务数据库操作
 */

import { prisma } from './prisma.js'
import { randomUUID } from 'node:crypto'
import { HOST_TASK_CLAIM_LOCK_NAMESPACE, INSTANCE_OPERATION_LOCK_NAMESPACE, tryAdvisoryTransactionLock } from './advisory-locks.js'
import { RestoreAuthorizationError, loadAuthorizedRestore, loadRestoreInstance, restoreWorkflowBusy } from './restore-task-authorization.js'
import type { WriteActor, WriteSession } from './user-write-authorization.js'
import { recoveryHeld } from '../services/platform-backup-core.js'
import { transferHostIdentity } from '../lib/transfer-host-identity.js'

export interface CreateRestoreTaskData {
    instanceId: number
    backupId: number | null
    hostId: number
    userId: number
    ownerId: number
    session: WriteSession
    expectedBackupName: string
    expectedBackupCreatedAt: string
    expectedHostIdentity: string
    originalInstanceName: string
    originalIncusId: string
}

/**
 * 创建恢复任务
 */
export async function createRestoreTask(data: CreateRestoreTaskData): Promise<number | null> {
    const task = await prisma.$transaction(async tx => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '3s'`
        if (recoveryHeld()) throw new RestoreAuthorizationError('平台恢复保护中，暂不能创建恢复任务')
        if (!await tryAdvisoryTransactionLock(tx, HOST_TASK_CLAIM_LOCK_NAMESPACE, data.hostId)) return null
        const locked = await tryAdvisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, data.instanceId)
        if (!locked) {
            return null
        }

        const current = await loadAuthorizedRestore(tx, data, data.session)
        if (current.instance.incusId !== data.originalIncusId || current.backup.incusName !== data.expectedBackupName ||
            current.backup.createdAt.toISOString() !== data.expectedBackupCreatedAt || transferHostIdentity(current.host) !== data.expectedHostIdentity) {
            throw new RestoreAuthorizationError('恢复目标在提交期间已变化，请刷新后重试')
        }
        const activeTask = await tx.restoreTask.findFirst({
            where: {
                instanceId: data.instanceId,
                status: { in: ['PENDING', 'PROCESSING'] }
            },
            select: { id: true }
        })
        if (activeTask) {
            return null
        }
        if (await restoreWorkflowBusy(tx, current.instance)) throw new RestoreAuthorizationError('实例正在执行其他操作，请等待完成后重试', 409, 'INSTANCE_BUSY')
        if (await tx.restoreTask.count({ where: { hostId: data.hostId, status: 'PENDING' } }) >= 10) {
            throw new RestoreAuthorizationError('该宿主恢复队列已满，请稍后再试', 429, 'QUEUE_TOO_LONG')
        }

        return tx.restoreTask.create({
            data: {
                instanceId: data.instanceId,
                backupId: data.backupId,
                hostId: data.hostId,
                userId: data.userId,
                tempInstanceName: `restore-${randomUUID().replace(/-/g, '')}`,
                originalInstanceName: current.instance.name,
                originalIncusId: data.originalIncusId,
                ownerId: current.instance.userId,
                actorSid: data.session.sid,
                actorIat: data.session.iat,
                identityHash: current.identityHash,
                status: 'PENDING'
            }
        })
    })
    return task?.id ?? null
}

/**
 * 获取恢复任务
 */
export async function getRestoreTaskById(id: number) {
    return prisma.restoreTask.findUnique({ where: { id } })
}

/**
 * 获取实例的恢复任务列表
 */
export async function getRestoreTasksByInstanceId(instanceId: number) {
    return prisma.restoreTask.findMany({
        where: { instanceId },
        orderBy: { createdAt: 'desc' },
        take: 20
    })
}

/**
 * 更新恢复任务状态
 */
export async function updateRestoreTaskStatus(
    id: number,
    status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED',
    error?: string
) {
    return prisma.restoreTask.update({
        where: { id },
        data: {
            status,
            error: error ?? null,
            finishedAt: ['COMPLETED', 'FAILED'].includes(status) ? new Date() : undefined
        }
    })
}

/**
 * 取消恢复任务（仅 PENDING 状态）
 */
export async function cancelRestoreTask(id: number, instanceId: number, actor: WriteActor) {
    const task = await prisma.restoreTask.findUnique({
        where: { id }
    })

    if (!task || task.instanceId !== instanceId || task.status !== 'PENDING') {
        return null
    }

    return prisma.$transaction(async tx => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '3s'`
        const locked = await tryAdvisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, task.instanceId)
        if (!locked) {
            return null
        }

        await loadRestoreInstance(tx, instanceId, actor)

        const updateResult = await tx.restoreTask.updateMany({
            where: {
                id,
                instanceId,
                status: 'PENDING'
            },
            data: {
                status: 'FAILED',
                error: '用户取消',
                finishedAt: new Date()
            }
        })

        if (updateResult.count !== 1) {
            return null
        }

        return tx.restoreTask.findUnique({
            where: { id }
        })
    })
}

// hasActiveRestoreTask 和 getQueuePosition 在 workers/restoreTaskWorker.ts 中定义
