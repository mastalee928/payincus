/**
 * 备份上传任务队列调度器
 * 确保同一台宿主机同一时间只有一个高 IO 任务在执行
 */

import { prisma } from '../db/prisma.js'
import { IncusClient } from '../lib/incus/incus-client.js'
import type { BackupUploadTask } from '@prisma/client'
import { assertUploadBinding, BackupUploadAuthorizationError, loadAuthorizedUpload, uploadWorkflowBusy } from '../db/backup-upload-authorization.js'
import { recoveryHeld } from '../services/platform-backup-core.js'
import { getBackupExportStream } from '../lib/incus/incus-backups.js'
import { StorageFactory } from '../storage/factory.js'
import { sendNotification } from '../lib/notifier.js'
import { createLog } from '../db/logs.js'
import { Readable } from 'stream'
import {
    HOST_TASK_CLAIM_LOCK_NAMESPACE,
    INSTANCE_OPERATION_LOCK_NAMESPACE,
    USER_BACKUP_UPLOAD_LOCK_NAMESPACE,
    tryAdvisoryTransactionLock
} from '../db/advisory-locks.js'
import { createWorkerDbBackoff } from './db-failure-backoff.js'

// Worker 轮询间隔 (5 秒)
const POLL_INTERVAL = 5000

// 上传任务超时时间 (30 分钟)
const UPLOAD_TIMEOUT = 30 * 60 * 1000

// 最大重试次数
const MAX_RETRY_COUNT = 2

// 重试延迟（毫秒）
const RETRY_DELAY = 30000

// 超时检查间隔 (1 分钟)
const TIMEOUT_CHECK_INTERVAL = 60000

let workerInterval: ReturnType<typeof setInterval> | null = null
let timeoutCheckInterval: ReturnType<typeof setInterval> | null = null
const runningUploadTaskIds = new Set<number>()
const dbBackoff = createWorkerDbBackoff('UploadWorker')

/**
 * 服务启动时清理僵尸任务
 */
export async function cleanupStaleUploadTasks(): Promise<void> {
    // 仅清理确实超时（超过 UPLOAD_TIMEOUT）的 PROCESSING 任务，避免多节点部署下误杀其他节点在跑的上传任务。
    const result = await prisma.backupUploadTask.updateMany({
        where: {
            status: 'PROCESSING',
            startedAt: { lt: new Date(Date.now() - UPLOAD_TIMEOUT) }
        },
        data: {
            status: 'FAILED',
            error: '系统重启，任务中断',
            finishedAt: new Date()
        }
    })
    if (result.count > 0) {
        console.log(`[UploadWorker] 清理了 ${result.count} 个僵尸任务`)
    }
}

/**
 * 运行时检查并清理超时的任务
 */
async function cleanupTimeoutUploadTasks(): Promise<void> {
    if (dbBackoff.shouldSkip()) return
    const timeoutThreshold = new Date(Date.now() - UPLOAD_TIMEOUT)
    
    const timedOutTasks = await prisma.backupUploadTask.findMany({
        where: {
            status: 'PROCESSING',
            startedAt: { lt: timeoutThreshold }
        },
        select: { id: true }
    })
    const timedOutTaskIds = timedOutTasks
        .map(task => task.id)
        .filter(taskId => !runningUploadTaskIds.has(taskId))

    if (timedOutTaskIds.length === 0) {
        return
    }

    const result = await prisma.backupUploadTask.updateMany({
        where: {
            id: { in: timedOutTaskIds },
            status: 'PROCESSING'
        },
        data: {
            status: 'FAILED',
            error: '任务执行超时 (30 分钟)',
            finishedAt: new Date()
        }
    })
    
    if (result.count > 0) {
        console.log(`[UploadWorker] 清理了 ${result.count} 个超时任务`)
    }
}

/**
 * 检查队列并执行任务
 */
async function processQueue(): Promise<void> {
    if (dbBackoff.shouldSkip() || recoveryHeld()) return
    try {
        // 1. 获取所有有 PENDING 任务的宿主机 ID (去重)
        const hostsWithPendingTasks = await prisma.backupUploadTask.groupBy({
            by: ['hostId'],
            where: { status: 'PENDING' }
        })

        for (const group of hostsWithPendingTasks) {
            const hostId = group.hostId

            // 使用事务原子操作：检查锁 + 获取任务 + 标记为 PROCESSING
            const claimedTask = await claimNextUploadTask(hostId)
            
            if (claimedTask) {
                // 执行任务 (不 await，让它异步跑)
                executeUploadTask(claimedTask.id).catch(err => {
                    console.error(`[UploadWorker] Task ${claimedTask.id} execution error:`, err)
                })
            }
        }
    } catch (err) {
        console.error('[UploadWorker] Queue processing error:', err)
        dbBackoff.arm(err)
    }
}

/**
 * 原子操作：获取并锁定下一个上传任务
 * 使用事务确保检查锁和获取任务是原子的，防止竞态条件
 */
export async function claimNextUploadTask(hostId: number) {
        if (recoveryHeld()) return null
        return await prisma.$transaction(async (tx) => {
            await tx.$executeRaw`SET LOCAL lock_timeout = '3s'`
            const locked = await tryAdvisoryTransactionLock(tx, HOST_TASK_CLAIM_LOCK_NAMESPACE, hostId)
            if (!locked) return null

            // 1. 检查是否有正在执行的上传任务
            const runningUploadTask = await tx.backupUploadTask.findFirst({
                where: { hostId, status: 'PROCESSING' }
            })
            if (runningUploadTask) return null

            // 2. 检查是否有正在执行的恢复任务（共享锁）
            const runningRestoreTask = await tx.restoreTask.findFirst({
                where: { hostId, status: 'PROCESSING' }
            })
            if (runningRestoreTask) return null

            // 3. 检查是否有正在执行的实例任务（共享锁）
            const runningInstanceTask = await tx.instanceTask.findFirst({
                where: { hostId, status: 'PROCESSING' }
            })
            if (runningInstanceTask) return null

            // 4. 获取最早的 PENDING 任务
            const taskToRun = await tx.backupUploadTask.findFirst({
                where: { hostId, status: 'PENDING' },
                orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
            })
            if (!taskToRun) return null

            const instanceOperationLocked = await tryAdvisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, taskToRun.instanceId)
            if (!instanceOperationLocked) return null
            if (!await tryAdvisoryTransactionLock(tx, USER_BACKUP_UPLOAD_LOCK_NAMESPACE, taskToRun.userId)) return null

            try {
                const current = await loadAuthorizedUpload(tx, taskToRun, { sid: taskToRun.actorSid ?? undefined, iat: taskToRun.actorIat ?? undefined })
                assertUploadBinding(taskToRun, current)
                if (await uploadWorkflowBusy(tx, current.instance) || recoveryHeld()) return null
            } catch (error) {
                if (!(error instanceof BackupUploadAuthorizationError)) throw error
                await tx.backupUploadTask.updateMany({ where: { id: taskToRun.id, status: 'PENDING' },
                    data: { status: 'FAILED', error: error.message, finishedAt: new Date() } })
                return null
            }

            // 5. 原子标记为 PROCESSING
            const claimedTask = await tx.backupUploadTask.updateMany({
                where: { id: taskToRun.id, status: 'PENDING' },
                data: { status: 'PROCESSING', startedAt: new Date(), error: null, finishedAt: null }
            })

            return claimedTask.count === 1 ? tx.backupUploadTask.findUnique({ where: { id: taskToRun.id } }) : null
        })
}

/**
 * 检查错误是否可重试
 * 网络超时、连接失败等临时性错误可以重试
 */
function isRetryableError(error: Error): boolean {
    const message = error.message.toLowerCase()
    return (
        message.includes('timeout') ||
        message.includes('econnreset') ||
        message.includes('econnrefused') ||
        message.includes('enotfound') ||
        message.includes('socket hang up') ||
        message.includes('network') ||
        message.includes('connection')
    )
}

/**
 * 更新上传任务进度
 */
function uploadAttempt(task: BackupUploadTask) {
    return { id: task.id, status: 'PROCESSING' as const, startedAt: task.startedAt, retryCount: task.retryCount }
}

async function updateUploadProgress(task: BackupUploadTask, progress: string): Promise<void> {
    await prisma.backupUploadTask.updateMany({
        where: uploadAttempt(task),
        data: { progress }
    })
}

/**
 * 执行单个上传任务
 * 注意：任务已在 claimNextUploadTask 中标记为 PROCESSING
 */
export async function executeUploadTask(taskId: number): Promise<void> {
    const startTime = Date.now()
    
    // 获取任务信息（已在事务中标记为 PROCESSING）
    const task = await prisma.backupUploadTask.findUnique({
        where: { id: taskId }
    })

    if (!task || task.status !== 'PROCESSING' || runningUploadTaskIds.has(taskId)) {
        return
    }
    runningUploadTaskIds.add(taskId)

    console.log(`[UploadWorker] 开始执行任务 ${taskId}`)
    
    const checkTimeout = () => {
        if (Date.now() - startTime > UPLOAD_TIMEOUT) {
            throw new Error('上传操作超时 (30 分钟)')
        }
    }

    let remoteFileName: string | null = null
    let provider: ReturnType<typeof StorageFactory.create> | null = null
    let client: IncusClient | null = null

    try {
        // Recheck after claim, immediately before dispatch. Carry this exact
        // snapshot to both transports; the shared pool must not reselect a host.
        const authorized = await prisma.$transaction(async tx => {
            await tx.$executeRaw`SET LOCAL lock_timeout = '3s'`
            if (!await tryAdvisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, task.instanceId)) return null
            if (!await tryAdvisoryTransactionLock(tx, USER_BACKUP_UPLOAD_LOCK_NAMESPACE, task.userId)) return null
            if (!await tx.backupUploadTask.findFirst({ where: uploadAttempt(task) })) return null
            const current = await loadAuthorizedUpload(tx, task, { sid: task.actorSid ?? undefined, iat: task.actorIat ?? undefined })
            assertUploadBinding(task, current)
            if (await uploadWorkflowBusy(tx, current.instance) || recoveryHeld()) return null
            return current
        })
        if (!authorized) {
            await prisma.backupUploadTask.updateMany({ where: uploadAttempt(task), data: { status: 'PENDING', startedAt: null, progress: null } })
            return
        }
        const { instance, backup, host, storageConfig, user } = authorized

        // 更新进度: 准备中
        await updateUploadProgress(task, 'preparing')

        // 3. 创建 Incus 客户端
        client = new IncusClient({
            url: host.url,
            certPath: host.certPath,
            keyPath: host.keyPath,
            serverCertificate: host.serverCertificate,
            serverFingerprint: host.serverFingerprint
        })
        await client.connect()

        // 4. 创建存储适配器
        provider = StorageFactory.create(storageConfig)

        // 5. 生成远程文件名
        const dateStr = new Date().toISOString()
            .replace(/[-:]/g, '')
            .replace('T', '-')
            .slice(0, 15)
        const userName = user?.username || 'unknown'
        // 使用实例的 incusId 作为标识（保证是 ASCII），备份名通常也是 ASCII
        // Different tasks may start within one second. A failed later upload
        // must never overwrite or compensate an earlier task's backup.
        remoteFileName = `${userName}-${instance.incusId}-${backup.incusName}-${task.id}-${dateStr}.tar.gz`
            .replace(/[^a-zA-Z0-9\-_.]/g, '_')  // 清理特殊字符

        console.log(`[UploadWorker] Task ${taskId}: 开始上传 ${remoteFileName} 到 ${storageConfig.name}`)

        // 更新进度: 上传中
        await updateUploadProgress(task, 'uploading')

        // 6. 获取备份导出流
        const { stream, contentLength } = await getBackupExportStream(
            client,
            instance.incusId,
            backup.incusName
        )

        // 7. 转换为 Node.js 流
        const nodeStream = Readable.fromWeb(stream as import('stream/web').ReadableStream)

        // 8. 流式上传到远程存储
        try {
            checkTimeout()
            await provider.uploadStream(nodeStream, remoteFileName)
            checkTimeout()
        } finally {
            // A storage refusal may leave the source unread. Cancel its mTLS
            // export immediately instead of keeping the host connection open.
            nodeStream.destroy()
        }

        // 更新进度: 完成中
        await updateUploadProgress(task, 'finalizing')

        // 9. 标记成功
        const completeResult = await prisma.backupUploadTask.updateMany({
            where: uploadAttempt(task),
            data: {
                status: 'COMPLETED',
                remoteFileName,
                fileSize: contentLength ? BigInt(contentLength) : null,
                finishedAt: new Date()
            }
        })
        if (completeResult.count === 0) {
            console.warn(`[UploadWorker] Task ${taskId}: 已不处于 PROCESSING，跳过完成状态覆盖`)
            return
        }

        console.log(`[UploadWorker] Task ${taskId}: 上传完成`)

        // 发送通知（通知与日志helper各自在内部处理投递失败）
        await sendNotification(task.userId, 'backup_uploaded', {
            instanceName: instance.name,
            backupName: backup.name,
            storageName: storageConfig.name,
            fileName: remoteFileName,
            hostName: host.name
        })

        await createLog(
            task.userId,
            'backup',
            'backup.upload',
            `Successfully uploaded backup "${backup.name}" to "${storageConfig.name}"`,
            'success',
            { instanceId: task.instanceId }
        )

    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err)
        console.error(`[UploadWorker] Task ${taskId} failed:`, errorMessage)

        // 尝试清理已上传的文件
        if (provider && remoteFileName) {
            try {
                await provider.deleteFile(remoteFileName)
                console.log(`[UploadWorker] Task ${taskId}: 已清理远程文件 ${remoteFileName}`)
            } catch (cleanupErr) {
                console.warn(`[UploadWorker] Task ${taskId}: 清理远程文件失败:`, cleanupErr)
            }
        }

        // 检查是否可以重试
        const canRetry = err instanceof Error && isRetryableError(err) && task.retryCount < MAX_RETRY_COUNT
        
        if (canRetry) {
            // 重试：增加重试计数，重置为 PENDING 等待下一轮执行
            console.log(`[UploadWorker] Task ${taskId}: 可重试错误，将在 ${RETRY_DELAY / 1000} 秒后重试 (第 ${task.retryCount + 1}/${MAX_RETRY_COUNT} 次)`)
            
            const retryResult = await prisma.backupUploadTask.updateMany({
                where: uploadAttempt(task),
                data: {
                    status: 'PENDING',
                    retryCount: task.retryCount + 1,
                    progress: null,
                    startedAt: null
                }
            })
            if (retryResult.count === 0) {
                console.warn(`[UploadWorker] Task ${taskId}: 已不处于 PROCESSING，跳过重试状态覆盖`)
                return
            }
            
            // 记录重试日志
            await createLog(
                task.userId,
                'backup',
                'backup.upload',
                `Retrying upload (attempt ${task.retryCount + 1}/${MAX_RETRY_COUNT}): ${errorMessage}`,
                'info',
                { instanceId: task.instanceId }
            )
        } else {
            // 最终失败
            const failResult = await prisma.backupUploadTask.updateMany({
                where: uploadAttempt(task),
                data: {
                    status: 'FAILED',
                    error: errorMessage,
                    finishedAt: new Date()
                }
            })
            if (failResult.count === 0) {
                console.warn(`[UploadWorker] Task ${taskId}: 已不处于 PROCESSING，跳过失败状态覆盖`)
                return
            }

            await createLog(
                task.userId,
                'backup',
                'backup.upload',
                `Failed to upload backup: ${errorMessage}`,
                'failed',
                { instanceId: task.instanceId }
            )
        }
    } finally {
        await client?.agent?.destroy().catch(() => {})
        runningUploadTaskIds.delete(taskId)
    }
}

/**
 * 启动备份上传 Worker
 */
export function startBackupUploadWorker(): void {
    if (workerInterval) {
        console.warn('[UploadWorker] Worker 已在运行')
        return
    }
    console.log('[UploadWorker] 启动备份上传调度器')
    workerInterval = setInterval(() => {
        processQueue().catch(err => {
            console.error('[UploadWorker] 队列处理错误:', err)
            dbBackoff.arm(err)
        })
    }, POLL_INTERVAL)
    
    // 启动超时检查定时器
    if (!timeoutCheckInterval) {
        timeoutCheckInterval = setInterval(() => {
            cleanupTimeoutUploadTasks().catch(err => {
                console.error('[UploadWorker] 超时检查错误:', err)
                dbBackoff.arm(err)
            })
        }, TIMEOUT_CHECK_INTERVAL)
        console.log('[UploadWorker] 启动超时任务检查器')
    }
}

/**
 * 停止备份上传 Worker
 */
export function stopBackupUploadWorker(): void {
    if (workerInterval) {
        clearInterval(workerInterval)
        workerInterval = null
        console.log('[UploadWorker] 备份上传调度器已停止')
    }
    if (timeoutCheckInterval) {
        clearInterval(timeoutCheckInterval)
        timeoutCheckInterval = null
        console.log('[UploadWorker] 超时任务检查器已停止')
    }
}
