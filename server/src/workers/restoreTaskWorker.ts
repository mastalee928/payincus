/**
 * 恢复任务队列调度器
 * 确保同一台宿主机同一时间只有一个恢复任务在执行
 */

import { prisma } from '../db/prisma.js'
import { randomUUID } from 'node:crypto'
import { RestoreAuthorizationError, loadAuthorizedRestore, assertRestoreBinding, restoreWorkflowBusy, restoreAttempt } from '../db/restore-task-authorization.js'
import { restoreStep, saveRestoreState, assertRestoreManifest, type RestoreRecoveryState } from '../db/restore-task-steps.js'
import { readRestoreIdentity, verifyRestoredCopy, requireRestoreTargetAbsent, deleteOriginalForRestore, restoreInstancePath } from '../lib/incus/restore-identity.js'
import { recoveryHeld } from '../services/platform-backup-core.js'
import { IncusClient } from '../lib/incus/incus-client.js'
import { getBackupExportStream } from '../lib/incus/incus-backups.js'
import {
    restoreFromStream,
    stopInstanceForRestore,
    renameInstance
} from '../lib/incus/incus-restore.js'
import { startInstance } from '../lib/incus/incus-instances.js'
import { sendNotification } from '../lib/notifier.js'
import { createLog } from '../db/logs.js'
import { collectTrafficForInstanceWithClient } from '../services/instance-traffic-collector.js'
import { Readable } from 'stream'
import {
    HOST_TASK_CLAIM_LOCK_NAMESPACE,
    INSTANCE_OPERATION_LOCK_NAMESPACE,
    tryAdvisoryTransactionLock
} from '../db/advisory-locks.js'
import { createWorkerDbBackoff } from './db-failure-backoff.js'

// 恢复任务超时时间 (10 分钟)
const RESTORE_TIMEOUT = 10 * 60 * 1000

// Worker 轮询间隔 (5 秒)
const POLL_INTERVAL = 5000

// 超时检查间隔 (1 分钟)
const TIMEOUT_CHECK_INTERVAL = 60000

let workerInterval: ReturnType<typeof setInterval> | null = null
let timeoutCheckInterval: ReturnType<typeof setInterval> | null = null
const runningRestoreTaskIds = new Set<number>()
const dbBackoff = createWorkerDbBackoff('RestoreWorker')

/**
 * 服务启动时清理僵尸任务
 * 保留未决任务的 PROCESSING 门禁，等待核对远端状态
 */
export async function cleanupStaleTasks(): Promise<void> {
    // Single backend: a restart loses execution, not the pending remote intent.
    // Keep PROCESSING so every existing lifecycle fence continues to block.
    const result = await prisma.restoreTask.updateMany({
        where: {
            status: 'PROCESSING',
            id: { notIn: [...runningRestoreTaskIds] }
        },
        data: {
            progress: 'manual_intervention',
            error: '系统重启，远端恢复状态待核对；已保留原实例、临时副本及操作门禁',
            finishedAt: null
        }
    })
    if (result.count > 0) {
        console.log(`[RestoreWorker] 清理了 ${result.count} 个僵尸任务`)
    }
}

/**
 * 运行时检查并清理超时的任务
 * 每分钟检查一次，将中断的超时任务标记为需核对，保留 PROCESSING 门禁
 */
export async function cleanupTimeoutTasks(): Promise<void> {
    if (dbBackoff.shouldSkip()) return
    const timeoutThreshold = new Date(Date.now() - RESTORE_TIMEOUT)

    const timedOutTasks = await prisma.restoreTask.findMany({
        where: {
            status: 'PROCESSING',
            OR: [{ startedAt: { lt: timeoutThreshold } }, { startedAt: null }]
        },
        select: { id: true }
    })
    const timedOutTaskIds = timedOutTasks
        .map(task => task.id)
        .filter(taskId => !runningRestoreTaskIds.has(taskId))

    if (timedOutTaskIds.length === 0) {
        return
    }

    const result = await prisma.restoreTask.updateMany({
        where: {
            id: { in: timedOutTaskIds },
            status: 'PROCESSING'
        },
        data: {
            progress: 'manual_intervention',
            error: '任务执行中断，远端状态待核对；已保留副本及操作门禁',
            finishedAt: null
        }
    })

    if (result.count > 0) {
        console.log(`[RestoreWorker] 清理了 ${result.count} 个超时任务`)
    }
}

/**
 * 检查队列并执行任务
 */
async function processQueue(): Promise<void> {
    if (dbBackoff.shouldSkip()) return
    try {
        // 1. 获取所有有 PENDING 任务的宿主机 ID (去重)
        const hostsWithPendingTasks = await prisma.restoreTask.groupBy({
            by: ['hostId'],
            where: { status: 'PENDING' }
        })

        for (const group of hostsWithPendingTasks) {
            const hostId = group.hostId

            // 使用事务原子操作：检查锁 + 获取任务 + 标记为 PROCESSING
            const claimedTask = await claimNextTask(hostId)

            if (claimedTask) {
                // 执行任务 (不 await，让它异步跑)
                executeRestoreTask(claimedTask.id).catch(err => {
                    console.error(`[RestoreWorker] Task ${claimedTask.id} execution error:`, err)
                })
            }
        }
    } catch (err) {
        console.error('[RestoreWorker] Queue processing error:', err)
        dbBackoff.arm(err)
    }
}

/**
 * 原子操作：获取并锁定下一个任务
 * 使用事务确保检查锁和获取任务是原子的，防止竞态条件
 */
export async function claimNextTask(hostId: number) {
        return await prisma.$transaction(async (tx) => {
            await tx.$executeRaw`SET LOCAL lock_timeout = '3s'`
            if (recoveryHeld()) return null
            const locked = await tryAdvisoryTransactionLock(tx, HOST_TASK_CLAIM_LOCK_NAMESPACE, hostId)
            if (!locked) return null

            // 1. 检查是否有正在执行的恢复任务
            const runningRestoreTask = await tx.restoreTask.findFirst({
                where: { hostId, status: 'PROCESSING' }
            })
            if (runningRestoreTask) return null

            // 2. 检查是否有正在执行的上传任务（共享锁）
            const runningUploadTask = await tx.backupUploadTask.findFirst({
                where: { hostId, status: 'PROCESSING' }
            })
            if (runningUploadTask) return null

            // 3. 检查是否有正在执行的实例任务（共享锁）
            const runningInstanceTask = await tx.instanceTask.findFirst({
                where: { hostId, status: 'PROCESSING' }
            })
            if (runningInstanceTask) return null

            // 4. 获取最早的 PENDING 任务
            const taskToRun = await tx.restoreTask.findFirst({
                where: { hostId, status: 'PENDING' },
                orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
            })
            if (!taskToRun) return null

            const instanceOperationLocked = await tryAdvisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, taskToRun.instanceId)
            if (!instanceOperationLocked) return null
            try {
                const current = await loadAuthorizedRestore(tx, taskToRun, { sid: taskToRun.actorSid ?? undefined, iat: taskToRun.actorIat ?? undefined })
                assertRestoreBinding(taskToRun, current)
                if (await restoreWorkflowBusy(tx, current.instance, taskToRun.id) || recoveryHeld()) return null
            } catch (error) {
                if (!(error instanceof RestoreAuthorizationError)) throw error
                await tx.restoreTask.updateMany({ where: { id: taskToRun.id, status: 'PENDING' },
                    data: { status: 'FAILED', progress: 'authorization_failed', error: error.message, finishedAt: new Date() } })
                return null
            }

            // 5. 原子标记为 PROCESSING
            const claimedTask = await tx.restoreTask.updateMany({
                where: { id: taskToRun.id, status: 'PENDING' },
                data: { status: 'PROCESSING', startedAt: new Date(), attemptId: randomUUID(),
                    progress: 'preparing', error: null, finishedAt: null }
            })

            return claimedTask.count === 1 ? tx.restoreTask.findUnique({ where: { id: taskToRun.id } }) : null
        })
}


/**
 * 执行单个恢复任务
 * 工作流: 停止原实例 -> 恢复到临时实例 -> 删除原实例 -> 重命名 -> 启动
 * 注意：任务已在 claimNextTask 中标记为 PROCESSING
 */
export async function executeRestoreTask(taskId: number): Promise<void> {
    const startTime = Date.now()

    // 获取任务信息（已在事务中标记为 PROCESSING）
    const task = await prisma.restoreTask.findUnique({
        where: { id: taskId }
    })

    if (!task || task.status !== 'PROCESSING' || runningRestoreTaskIds.has(taskId)) return
    if (task.recoveryState || task.progress === 'manual_intervention') return
    runningRestoreTaskIds.add(taskId)

    console.log(`[RestoreWorker] 开始执行任务 ${taskId}`)

    let client: IncusClient | null = null
    let state: RestoreRecoveryState | undefined
    try {
        if (!task.attemptId || !task.startedAt) throw new RestoreAuthorizationError('恢复执行身份缺失，请重新提交')
        const authorized = await prisma.$transaction(async tx => {
            await tx.$executeRaw`SET LOCAL lock_timeout = '3s'`
            if (!await tryAdvisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, task.instanceId)) return null
            if (!await tx.restoreTask.findFirst({ where: restoreAttempt(task) })) return null
            const current = await loadAuthorizedRestore(tx, task, { sid: task.actorSid ?? undefined, iat: task.actorIat ?? undefined })
            assertRestoreBinding(task, current)
            if (await restoreWorkflowBusy(tx, current.instance, task.id) || recoveryHeld()) return null
            return current
        })
        if (!authorized) {
            await prisma.restoreTask.updateMany({ where: restoreAttempt(task),
                data: { status: 'PENDING', startedAt: null, progress: null } })
            return
        }
        const { host, instance, backup } = authorized
        // Carry the validated TLS snapshot; the shared pool must not reselect a changed host.
        client = new IncusClient(host)
        await client.connect()

        const checkTimeout = () => {
            if (Date.now() - startTime > RESTORE_TIMEOUT) {
                throw new Error('恢复操作超时 (10 分钟)')
            }
        }

        const original = await readRestoreIdentity(client, task.originalIncusId)
        await requireRestoreTargetAbsent(client, task.tempInstanceName!)
        const resources = await restoreStep(task, async tx => ({
            backups: await tx.backup.findMany({ where: { instanceId: task.instanceId, status: { not: 'deleted' } }, select: { id: true, incusName: true } }),
            snapshots: await tx.snapshot.findMany({ where: { instanceId: task.instanceId }, select: { id: true, incusName: true } })
        }))
        state = { version: 1, stage: 'stopping', original, ...resources }
        await saveRestoreState(task, state)
        // 3. 停止原实例。原UUID/设备清单已持久保存；补采复用同一固定连接。
        console.log(`[RestoreWorker] Task ${taskId}: 停止原实例 ${task.originalIncusId}`)
        if (instance.status === 'running') {
            const collectResult = await collectTrafficForInstanceWithClient({ instanceId: instance.id, userId: instance.userId,
                incusId: task.originalIncusId, client, currentUsage: instance.monthlyTrafficUsed })
            if (!collectResult.success) throw new Error(`恢复前流量采集失败: ${collectResult.error}`)
        }
        await readRestoreIdentity(client, task.originalIncusId, original)
        await saveRestoreState(task, state)
        await restoreStep(task, async () => {
            await readRestoreIdentity(client!, task.originalIncusId, original)
            await stopInstanceForRestore(client!, task.originalIncusId)
        }, 150000)
        checkTimeout()
        await readRestoreIdentity(client, task.originalIncusId, original, true)
        // Restore on the original remote root pool, never today's package default.
        const storagePool = original.pool
        console.log(`[RestoreWorker] Task ${taskId}: 使用存储池 ${storagePool}`)

        // 5. 获取备份流并恢复到临时实例
        state.stage = 'importing'
        await requireRestoreTargetAbsent(client, task.tempInstanceName!)
        await saveRestoreState(task, state)
        console.log(`[RestoreWorker] Task ${taskId}: 恢复到临时实例 ${task.tempInstanceName}`)
        const { stream } = await getBackupExportStream(
            client,
            task.originalIncusId,
            backup.incusName,
            { timeoutMs: Math.max(1, RESTORE_TIMEOUT - (Date.now() - startTime)) }
        )
        const nodeStream = Readable.fromWeb(stream as import('stream/web').ReadableStream)

        await restoreFromStream({
            client,
            backupStream: nodeStream,
            targetName: task.tempInstanceName!,
            poolName: storagePool,
            timeoutMs: Math.max(1, RESTORE_TIMEOUT - (Date.now() - startTime)),
            onOperation: async operation => {
                state!.operation = operation
                await saveRestoreState(task, state!)
            }
        })
        checkTimeout()

        // Keep original backups until the stopped replacement passes identity/device checks.
        state.restored = await verifyRestoredCopy(client, task.tempInstanceName!, original)
        state.stage = 'replacing'
        await saveRestoreState(task, state)
        // 7. 删除原实例本体，保留按原名称绑定的独占IPv4/IPv6转发。
        console.log(`[RestoreWorker] Task ${taskId}: 删除原实例 ${task.originalIncusId}`)
        await restoreStep(task, async tx => {
            await assertRestoreManifest(tx, task, state!)
            await deleteOriginalForRestore(client!, task.originalIncusId, original, task.tempInstanceName!, state!.restored!)
        }, 270000)
        checkTimeout()

        // 8. 重命名临时实例为原名
        state.stage = 'renaming'
        await saveRestoreState(task, state)
        console.log(`[RestoreWorker] Task ${taskId}: 重命名 ${task.tempInstanceName} -> ${task.originalIncusId}`)
        await restoreStep(task, async () => {
            await requireRestoreTargetAbsent(client!, task.originalIncusId)
            await readRestoreIdentity(client!, task.tempInstanceName!, state!.restored!, true)
            await renameInstance(client!, task.tempInstanceName!, task.originalIncusId)
            await readRestoreIdentity(client!, task.originalIncusId, state!.restored!, true)
            await requireRestoreTargetAbsent(client!, task.tempInstanceName!)
        }, 270000)

        // 9. 启动恢复后的实例
        state.stage = 'starting'
        await saveRestoreState(task, state)
        console.log(`[RestoreWorker] Task ${taskId}: 启动实例`)
        await restoreStep(task, async () => {
            await readRestoreIdentity(client!, task.originalIncusId, state!.restored!, true)
            await startInstance(client!, task.originalIncusId)
            await readRestoreIdentity(client!, task.originalIncusId, state!.restored!)
            const started = await client!.request<{ status?: string }>('GET', `${restoreInstancePath(task.originalIncusId)}/state`, null, 30000)
            if (started.status !== 'Running') throw new Error('恢复后实例未确认运行，已保留副本及操作门禁')
        }, 240000)

        // 10. 删除数据库中原实例的备份和快照记录
        // Incus 原实例及其所有备份已被删除，恢复后的新实例没有这些旧备份。
        console.log(`[RestoreWorker] Task ${taskId}: 清理数据库中的备份和快照记录`)
        // 11. 更新实例名称和恢复来源信息（在标记成功之前，确保原子性）
        // 名称格式: 原名 | restored:备份名
        const newInstanceName = `${task.originalInstanceName} | restored:${backup?.name || 'unknown'}`
        await restoreStep(task, async tx => {
            await assertRestoreManifest(tx, task, state!)
            await tx.trafficSnapshot.deleteMany({ where: { instanceId: task.instanceId } })
            await tx.backup.updateMany({ where: { instanceId: task.instanceId, OR: state!.backups }, data: { status: 'deleted' } })
            await tx.snapshot.deleteMany({ where: { instanceId: task.instanceId, OR: state!.snapshots } })
            const instanceUpdateResult = await tx.instance.updateMany({
                where: {
                    id: task.instanceId,
                    status: { not: 'deleted' }
                },
                data: {
                    name: newInstanceName,
                    storagePoolName: storagePool,
                    restoredFrom: {
                        backupId: task.backupId,
                        backupName: backup?.name,
                        restoredAt: new Date().toISOString()
                    }
                }
            })
            if (instanceUpdateResult.count === 0) {
                throw new Error('实例已删除，恢复结果不再写入')
            }

            // 12. 标记成功
            const completeResult = await tx.restoreTask.updateMany({
                where: restoreAttempt(task),
                data: { status: 'COMPLETED', progress: 'completed', finishedAt: new Date() }
            })
            if (completeResult.count === 0) {
                throw new RestoreAuthorizationError('恢复批次已变化，结果事务回滚')
            }
            })

        console.log(`[RestoreWorker] Task ${taskId}: 恢复完成`)

        // 发送通知
        await sendNotification(task.userId, 'backup_restored', {
            instanceName: task.originalInstanceName,
            backupName: backup?.name || '未知',
            hostName: host.name
        })

        await createLog(
            task.userId,
            'backup',
            'backup.restore',
            `Successfully restored instance "${task.originalInstanceName}" from backup "${backup?.name}"`,
            'success',
            { instanceId: task.instanceId }
        )

    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err)
        console.error(`[RestoreWorker] Task ${taskId} failed:`, errorMessage)
        // Unknown or incomplete operations never delete a copy by name. Preserve
        // PROCESSING so deletion/transfer/rebuild/automatic policies stay fenced.
        const saved = await prisma.restoreTask.findFirst({ where: restoreAttempt(task) })
        const manualInterventionReason = saved?.recoveryState
            ? `已保留临时实例 ${task.tempInstanceName} 及现有副本，需要人工介入核对恢复步骤；操作门禁保持` : null

        const failResult = await prisma.restoreTask.updateMany({
            where: restoreAttempt(task),
            data: {
                status: manualInterventionReason ? 'PROCESSING' : 'FAILED',
                ...(manualInterventionReason
                    ? {
                        progress: 'manual_intervention',
                        error: `${errorMessage}; ${manualInterventionReason}`
                    }
                    : { error: errorMessage, progress: 'preparation_failed' }),
                finishedAt: manualInterventionReason ? null : new Date()
            }
        })
        if (failResult.count === 0) {
            console.warn(`[RestoreWorker] Task ${taskId}: 已不处于 PROCESSING，跳过失败状态覆盖`)
            return
        }

        await createLog(
            task.userId,
            'backup',
            'backup.restore',
            `Failed to restore instance "${task.originalInstanceName}": ${errorMessage}`,
            'failed',
            { instanceId: task.instanceId }
        )
    } finally {
        try { await client?.close() } finally { runningRestoreTaskIds.delete(taskId) }
    }
}

/**
 * 启动恢复任务 Worker
 */
export function startRestoreWorker(): void {
    if (workerInterval) {
        console.warn('[RestoreWorker] Worker 已在运行')
        return
    }
    console.log('[RestoreWorker] 启动恢复任务调度器')
    workerInterval = setInterval(() => {
        processQueue().catch(err => {
            console.error('[RestoreWorker] 队列处理错误:', err)
            dbBackoff.arm(err)
        })
    }, POLL_INTERVAL)

    // 启动超时检查定时器
    if (!timeoutCheckInterval) {
        timeoutCheckInterval = setInterval(() => {
            cleanupTimeoutTasks().catch(err => {
                console.error('[RestoreWorker] 超时检查错误:', err)
                dbBackoff.arm(err)
            })
        }, TIMEOUT_CHECK_INTERVAL)
        console.log('[RestoreWorker] 启动超时任务检查器')
    }
}

/**
 * 停止恢复任务 Worker
 */
export function stopRestoreWorker(): void {
    if (workerInterval) {
        clearInterval(workerInterval)
        workerInterval = null
        console.log('[RestoreWorker] 恢复任务调度器已停止')
    }
    if (timeoutCheckInterval) {
        clearInterval(timeoutCheckInterval)
        timeoutCheckInterval = null
        console.log('[RestoreWorker] 超时任务检查器已停止')
    }
}

/**
 * 检查实例是否有正在进行的恢复任务
 */
export async function hasActiveRestoreTask(instanceId: number): Promise<{ id: number } | null> {
    return prisma.restoreTask.findFirst({
        where: {
            instanceId,
            status: { in: ['PENDING', 'PROCESSING'] }
        },
        select: { id: true }
    })
}

/**
 * 获取任务在队列中的位置
 * 考虑共享锁：上传任务和恢复任务互斥
 */
export async function getQueuePosition(taskId: number): Promise<number> {
    const task = await prisma.restoreTask.findUnique({
        where: { id: taskId },
        select: { hostId: true, createdAt: true, status: true }
    })

    if (!task || task.status !== 'PENDING') return 0

    // 检查是否有正在执行的恢复任务
    const processingRestoreTask = await prisma.restoreTask.findFirst({
        where: {
            hostId: task.hostId,
            status: 'PROCESSING'
        },
        orderBy: { createdAt: 'asc' }
    })

    // 检查是否有正在执行的上传任务（共享锁）
    const processingUploadTask = await prisma.backupUploadTask.findFirst({
        where: {
            hostId: task.hostId,
            status: 'PROCESSING'
        },
        orderBy: { createdAt: 'asc' }
    })

    // 如果有 PROCESSING 任务（恢复或上传），且创建时间早于当前任务，则位置+1
    const hasProcessingTask =
        (processingRestoreTask && processingRestoreTask.createdAt < task.createdAt) ||
        (processingUploadTask && processingUploadTask.createdAt < task.createdAt)
    const processingCount = hasProcessingTask ? 1 : 0

    // 统计创建时间更早的 PENDING 恢复任务数量
    const pendingCount = await prisma.restoreTask.count({
        where: {
            hostId: task.hostId,
            status: 'PENDING',
            createdAt: { lt: task.createdAt }
        }
    })

    return processingCount + pendingCount + 1
}
