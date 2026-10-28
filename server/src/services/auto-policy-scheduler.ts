/** Automatic snapshot scheduling and durable recovery. */
import { schedule } from 'node-cron'
import pLimit from 'p-limit'
import { prisma } from '../db/prisma.js'
import { acquireLock, releaseLock } from '../lib/distributed-lock.js'
import { prepareAutoSnapshotOperation, applyAutoSnapshotOperation } from './auto-snapshot-operations.js'
import { OPEN_AUTO_SNAPSHOT_STATES } from '../db/snapshot-operation-guards.js'

const limit = pLimit(5)
const AUTO_POLICY_LOCK_EXPIRE_MS = 30 * 60 * 1000
const AUTO_POLICY_LOCK_WAIT_MS = 100
let schedulerStarted = false

function getAutoSnapshotPolicyLockKey(instanceId: number): string {
    return `auto-policy:snapshot:${instanceId}`
}

async function executeLockedAutoSnapshot(candidate: { instanceId: number }): Promise<void> {
    const lockKey = getAutoSnapshotPolicyLockKey(candidate.instanceId)
    const lockResult = await acquireLock(lockKey, {
        expireMs: AUTO_POLICY_LOCK_EXPIRE_MS,
        waitTimeoutMs: AUTO_POLICY_LOCK_WAIT_MS,
        retryIntervalMs: 50
    })
    if (!lockResult.success || !lockResult.ownerId) return
    try {
        // Preparation re-reads due policy, identity and workflow under the instance lock.
        const operation = await prepareAutoSnapshotOperation(candidate.instanceId)
        if (operation) await applyAutoSnapshotOperation(operation.id)
    } finally {
        await releaseLock(lockKey, lockResult.ownerId)
    }
}

/**
 * 运行自动快照任务
 */
export async function runAutoSnapshotJob(): Promise<void> {
    try {
        const now = new Date()
        // Recovery uses the durable fence, including when the policy was disabled.
        // Do not reacquire a 30-minute lease left behind by a killed scheduler.
        const open = await prisma.autoSnapshotOperation.findMany({
            where: { state: { in: OPEN_AUTO_SNAPSHOT_STATES } },
            select: { id: true, instanceId: true }
        })
        const recoveringInstances = new Set(open.map(row => row.instanceId))
        const recoveries = await Promise.allSettled(open.map(row => limit(() => applyAutoSnapshotOperation(row.id))))
        for (const result of recoveries) if (result.status === 'rejected') console.error('[AutoPolicy] Snapshot recovery failed:', result.reason)
        const policies = await prisma.snapshotPolicy.findMany({ where: {
            enabled: true, OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }]
        }, select: { instanceId: true } })
        // A failed recovery cannot create a second operation in the same scan.
        const results = await Promise.allSettled(policies.filter(row => !recoveringInstances.has(row.instanceId))
            .map(policy => limit(() => executeLockedAutoSnapshot(policy))))
        for (const result of results) if (result.status === 'rejected') console.error('[AutoPolicy] Snapshot preparation failed:', result.reason)
    } catch (error) { console.error('[AutoPolicy] Auto snapshot job failed:', error) }
}
/**
 * 启动自动策略调度器
 */
export function startAutoPolicyScheduler(): void {
    if (schedulerStarted) {
        return
    }

    schedulerStarted = true

    // 每 5 分钟检查一次快照策略（支持10分钟频率）
    schedule('*/5 * * * *', () => {
        runAutoSnapshotJob().catch(console.error)
    })

    console.log('[AutoPolicy] Scheduler started')
    console.log('[AutoPolicy] - Auto snapshot: every 5 minutes')
}
