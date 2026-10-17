import type { SystemUpdateTask, SystemUpdateTaskStatus } from '@prisma/client'
import { prisma } from './prisma.js'

export interface SerializedSystemUpdateTask {
  id: number
  targetVersion: string
  fromVersion: string | null
  status: SystemUpdateTaskStatus
  startedByUserId: number
  startedByUsername: string | null
  backupPath: string | null
  logPath: string | null
  errorMessage: string | null
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
  updatedAt: string
}

type TaskWithUser = SystemUpdateTask & {
  startedBy?: { username: string } | null
}

export function serializeSystemUpdateTask(task: TaskWithUser): SerializedSystemUpdateTask {
  return {
    id: task.id,
    targetVersion: task.targetVersion,
    fromVersion: task.fromVersion,
    status: task.status,
    startedByUserId: task.startedByUserId,
    startedByUsername: task.startedBy?.username || null,
    backupPath: task.backupPath,
    logPath: task.logPath,
    errorMessage: task.errorMessage,
    startedAt: task.startedAt?.toISOString() || null,
    finishedAt: task.finishedAt?.toISOString() || null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString()
  }
}

export async function createSystemUpdateTask(input: {
  targetVersion: string
  fromVersion: string | null
  startedByUserId: number
  logPath: string
}) {
  return prisma.systemUpdateTask.create({
    data: {
      targetVersion: input.targetVersion,
      fromVersion: input.fromVersion,
      startedByUserId: input.startedByUserId,
      logPath: input.logPath,
      status: 'pending'
    },
    include: { startedBy: { select: { username: true } } }
  })
}

export async function getSystemUpdateTask(id: number) {
  return prisma.systemUpdateTask.findUnique({
    where: { id },
    include: { startedBy: { select: { username: true } } }
  })
}

export async function listSystemUpdateTasks(limit = 20) {
  return prisma.systemUpdateTask.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { startedBy: { select: { username: true } } }
  })
}

export async function hasRunningSystemUpdateTask(): Promise<boolean> {
  const count = await prisma.systemUpdateTask.count({
    where: { status: { in: ['pending', 'running'] } }
  })
  return count > 0
}

export async function markSystemUpdateTaskRunning(id: number) {
  await prisma.systemUpdateTask.update({
    where: { id },
    data: {
      status: 'running',
      startedAt: new Date(),
      errorMessage: null
    }
  })
}

export async function tryMarkSystemUpdateTaskRunning(
  id: number,
  allowedStatuses: SystemUpdateTaskStatus[],
  logPath?: string
): Promise<boolean> {
  const result = await prisma.systemUpdateTask.updateMany({
    where: {
      id,
      status: { in: allowedStatuses }
    },
    data: {
      status: 'running',
      startedAt: new Date(),
      errorMessage: null,
      ...(logPath ? { logPath } : {})
    }
  })
  return result.count === 1
}

export async function markSystemUpdateTaskFinished(id: number, input: {
  status: 'success' | 'failed' | 'rolled_back'
  errorMessage?: string | null
  backupPath?: string | null
}) {
  await prisma.systemUpdateTask.update({
    where: { id },
    data: {
      status: input.status,
      errorMessage: input.errorMessage || null,
      backupPath: input.backupPath,
      finishedAt: new Date()
    }
  })
}

// 停在 pending、且从未被 worker 认领（startedAt 为空）的任务不会再自己前进：面板用
// `systemctl start --no-block` 起 unit，helper 层失败（可信清单或 Git 元数据不符）只写 journal，
// 不会回写数据库。这类记录会被 hasRunningSystemUpdateTask() 一直算作「占用中」，挡掉之后所有
// 更新与回滚，而系统原本没有任何清理入口。因此在发起新任务前，把超时仍未被启动的 pending 记录判失败。
const STALE_PENDING_TASK_MS = 10 * 60 * 1000

export async function failStaleSystemUpdateTasks(maxAgeMs = STALE_PENDING_TASK_MS): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeMs)
  const result = await prisma.systemUpdateTask.updateMany({
    where: {
      status: 'pending',
      startedAt: null,
      createdAt: { lt: cutoff }
    },
    data: {
      status: 'failed',
      errorMessage: '更新任务长时间未启动，已自动标记失败；如仍需更新请重新发起。',
      finishedAt: new Date()
    }
  })
  return result.count
}

export async function cancelPendingSystemUpdateTask(id: number, reason: string): Promise<boolean> {
  const result = await prisma.systemUpdateTask.updateMany({
    where: { id, status: 'pending' },
    data: {
      status: 'failed',
      errorMessage: reason,
      finishedAt: new Date()
    }
  })
  return result.count === 1
}
