import { assertNoPendingSnapshotOperations, } from './snapshot-operation-guards.js'
/**
 * 实例操作任务数据库操作
 */

import { prisma } from './prisma.js'
import type { InstanceTaskType, InstanceTaskStatus, InstanceTask, Host, Instance, Prisma } from '@prisma/client'
import { createHash } from 'node:crypto'
import { INSTANCE_OPERATION_LOCK_NAMESPACE, tryAdvisoryTransactionLock } from './advisory-locks.js'
import { assertNoPendingProxySiteOperations } from './proxy-site-operation-guards.js'
import { authorizeUserWrite, type WriteActor } from './user-write-authorization.js'
import { transferHostIdentity } from '../lib/transfer-host-identity.js'
import { claimOperationVerificationRequirement } from '../lib/operation-verification.js'

export interface CreateInstanceTaskData {
  instanceId: number
  hostId: number
  userId: number
  taskType: InstanceTaskType
  imageAlias?: string       // 重装使用的镜像别名
  sshKeyId?: number         // 重装使用的 SSH 密钥 ID
  customInitCommandIds?: number[]  // 重装使用的自定义初始化命令 ID 列表
  targetName?: string       // 克隆的目标名称
  targetHostId?: number     // 克隆的目标宿主机
  snapshotName?: string     // 克隆时的快照名称
  sensitiveAuthorization?: {
    actor: WriteActor
    entry: 'user' | 'host'
    expectedOwnerId: number
    expectedIncusId: string
    expectedHostIdentity: string
  }
}

export class InstanceTaskAuthorizationError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 403) { super(message) }
}

function destructiveTaskIdentity(task: Pick<InstanceTask, 'taskType' | 'imageAlias' | 'sshKeyId' | 'customInitCommandIds' | 'actorSid' | 'actorIat'>, instance: Instance, host: Host, role: string) {
  return createHash('sha256').update(JSON.stringify([task.taskType, instance.id, instance.userId, instance.hostId,
    instance.incusId, instance.createdAt.toISOString(), transferHostIdentity(host), role,
    task.imageAlias, task.sshKeyId, task.customInitCommandIds, task.actorSid, task.actorIat])).digest('hex')
}

async function authorizeSensitiveTaskAdmission(tx: Prisma.TransactionClient, data: CreateInstanceTaskData) {
  const authorization = data.sensitiveAuthorization
  if (!authorization || authorization.actor.id !== data.userId) {
    throw new InstanceTaskAuthorizationError('AUTHENTICATION_STATE_CHANGED', '请重新登录后重试')
  }
  const instance = await tx.instance.findUnique({ where: { id: data.instanceId } })
  if (!instance || instance.userId !== authorization.expectedOwnerId || instance.hostId !== data.hostId ||
    instance.incusId !== authorization.expectedIncusId) throw new InstanceTaskAuthorizationError('INSTANCE_STATE_CHANGED', '实例归属或位置已变化，请刷新后重试', 409)
  await tx.$queryRaw`SELECT id FROM hosts WHERE id = ${instance.hostId} FOR SHARE`
  const host = await tx.host.findUniqueOrThrow({ where: { id: instance.hostId } })
  if (transferHostIdentity(host) !== authorization.expectedHostIdentity) {
    throw new InstanceTaskAuthorizationError('INSTANCE_STATE_CHANGED', '宿主身份已变化，请刷新后重试', 409)
  }
  if (!await authorizeUserWrite(tx, data.userId, authorization.actor)) {
    throw new InstanceTaskAuthorizationError('AUTHENTICATION_STATE_CHANGED', '请重新登录后重试')
  }
  const admin = (await tx.user.findUniqueOrThrow({ where: { id: data.userId }, select: { role: true } })).role === 'admin'
  if (authorization.entry === 'user' ? instance.userId !== data.userId : host.userId !== data.userId && !admin) {
    throw new InstanceTaskAuthorizationError('FORBIDDEN', '无权操作此实例')
  }
  if (instance.status === 'deleted' || instance.status === 'suspended' || instance.provisioningCleanupPending || instance.deletionBillingPending ||
    data.taskType === 'rebuild' && instance.status !== 'stopped') {
    throw new InstanceTaskAuthorizationError('INSTANCE_STATE_CHANGED', '实例状态已变化，请刷新后重试', 409)
  }
  const active = { instanceId: instance.id, status: { in: ['PENDING', 'PROCESSING'] as ('PENDING' | 'PROCESSING')[] } }
  if (await tx.restoreTask.count({ where: active }) || await tx.backupUploadTask.count({ where: active }) ||
    await tx.instanceTransfer.count({ where: { instanceId: instance.id, status: { in: ['pending', 'processing'] } } })) {
    throw new InstanceTaskConflictError()
  }
  if (authorization.entry === 'user') {
    const operation = data.taskType === 'rebuild' ? 'reinstall_instance' : 'recreate_instance'
    const verification = await claimOperationVerificationRequirement(data.userId, operation, instance.id, authorization.actor, tx)
    if (!verification.verified) throw new InstanceTaskAuthorizationError('VERIFICATION_REQUIRED', '请先完成身份验证')
  }
  const role = (await tx.user.findUniqueOrThrow({ where: { id: data.userId }, select: { role: true } })).role
  return { operationOwnerId: instance.userId, actorSid: authorization.actor.sid, actorIat: authorization.actor.iat,
    operationEntry: authorization.entry, operationIdentity: destructiveTaskIdentity({ taskType: data.taskType,
      actorSid: authorization.actor.sid ?? null, actorIat: authorization.actor.iat ?? null,
      imageAlias: data.imageAlias || null, sshKeyId: data.sshKeyId || null,
      customInitCommandIds: data.customInitCommandIds ? JSON.stringify(data.customInitCommandIds) : null }, instance, host, role) }
}

/** Recheck persisted consent before a queued destructive task reaches its host. */
export async function validateDestructiveTaskExecution(task: InstanceTask): Promise<void> {
  if (!['rebuild', 'recreate'].includes(task.taskType)) return
  await prisma.$transaction(async tx => {
    if (!await tryAdvisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, task.instanceId)) throw new InstanceTaskConflictError()
    await tx.$queryRaw`SELECT id FROM instances WHERE id = ${task.instanceId} FOR UPDATE`
    await tx.$queryRaw`SELECT id FROM instance_tasks WHERE id = ${task.id} FOR SHARE`
    const currentTask = await tx.instanceTask.findUnique({ where: { id: task.id } })
    if (!currentTask || currentTask.status !== 'PROCESSING' || currentTask.startedAt?.getTime() !== task.startedAt?.getTime() ||
      !currentTask.startedAt || currentTask.retryCount !== task.retryCount || currentTask.instanceId !== task.instanceId ||
      currentTask.hostId !== task.hostId || currentTask.userId !== task.userId || currentTask.taskType !== task.taskType ||
      currentTask.imageAlias !== task.imageAlias || currentTask.sshKeyId !== task.sshKeyId ||
      currentTask.customInitCommandIds !== task.customInitCommandIds || currentTask.actorSid !== task.actorSid ||
      currentTask.actorIat !== task.actorIat || currentTask.operationOwnerId !== task.operationOwnerId ||
      currentTask.operationEntry !== task.operationEntry || currentTask.operationIdentity !== task.operationIdentity) {
      throw new InstanceTaskAuthorizationError('INSTANCE_TASK_CHANGED', '任务执行授权已变化', 409)
    }
    if (!currentTask.actorSid || !currentTask.actorIat || !currentTask.operationIdentity || !currentTask.operationOwnerId ||
      !['user', 'host'].includes(currentTask.operationEntry ?? '')) {
      throw new InstanceTaskAuthorizationError('INSTANCE_TASK_AUTHORIZATION_MISSING', '原任务缺少身份验证记录，请重新提交')
    }
    const instance = await tx.instance.findUnique({ where: { id: task.instanceId } })
    if (!instance || instance.hostId !== currentTask.hostId || instance.userId !== currentTask.operationOwnerId ||
      instance.status === 'deleted' || instance.status === 'suspended' || instance.provisioningCleanupPending || instance.deletionBillingPending ||
      currentTask.taskType === 'rebuild' && instance.status !== 'stopped') {
      throw new InstanceTaskAuthorizationError('INSTANCE_STATE_CHANGED', '原实例状态或归属已变化，请重新提交', 409)
    }
    await tx.$queryRaw`SELECT id FROM hosts WHERE id = ${instance.hostId} FOR SHARE`
    const host = await tx.host.findUniqueOrThrow({ where: { id: instance.hostId } })
    const actor = { id: currentTask.userId, sid: currentTask.actorSid, iat: currentTask.actorIat }
    if (!await authorizeUserWrite(tx, actor.id, actor)) throw new InstanceTaskAuthorizationError('AUTHENTICATION_STATE_CHANGED', '原登录授权已失效，请重新提交')
    const role = (await tx.user.findUniqueOrThrow({ where: { id: actor.id }, select: { role: true } })).role
    if (currentTask.operationEntry === 'user' ? actor.id !== instance.userId : actor.id !== host.userId && role !== 'admin') {
      throw new InstanceTaskAuthorizationError('FORBIDDEN', '原操作权限已失效，请重新提交')
    }
    if (destructiveTaskIdentity(currentTask, instance, host, role) !== currentTask.operationIdentity) {
      throw new InstanceTaskAuthorizationError('INSTANCE_STATE_CHANGED', '原实例或宿主身份已变化，请重新提交', 409)
    }
    await assertNoPendingSnapshotOperations(tx, instance.id)
    await assertNoPendingProxySiteOperations(tx, instance.id)
    const active = { instanceId: instance.id, status: { in: ['PENDING', 'PROCESSING'] as ('PENDING' | 'PROCESSING')[] } }
    if (await tx.restoreTask.count({ where: active }) || await tx.backupUploadTask.count({ where: active }) ||
      await tx.instanceTransfer.count({ where: { instanceId: instance.id, status: { in: ['pending', 'processing'] } } })) {
      throw new InstanceTaskConflictError()
    }
  })
}

// These getters also feed API responses. Persisted worker authorization stays internal.
const PUBLIC_INSTANCE_TASK_SELECT = {
  id: true, instanceId: true, hostId: true, userId: true, taskType: true, status: true,
  progress: true, retryCount: true, imageAlias: true, sshKeyId: true, customInitCommandIds: true,
  targetName: true, targetHostId: true, replacementState: true, snapshotName: true,
  newInstanceId: true, error: true, createdAt: true, startedAt: true, finishedAt: true
} satisfies Prisma.InstanceTaskSelect

export interface InstanceTaskWithDetails {
  id: number
  instanceId: number
  hostId: number
  userId: number
  taskType: InstanceTaskType
  status: InstanceTaskStatus
  progress: string | null
  retryCount: number
  imageAlias: string | null
  sshKeyId: number | null
  customInitCommandIds: string | null  // JSON 字符串，解析后为 number[]
  targetName: string | null
  targetHostId: number | null
  snapshotName: string | null
  newInstanceId: number | null
  error: string | null
  createdAt: Date
  startedAt: Date | null
  finishedAt: Date | null
}

export class InstanceTaskConflictError extends Error {
  activeTask: InstanceTaskWithDetails | null

  constructor(activeTask: InstanceTaskWithDetails | null = null) {
    super('Instance has an active task')
    this.name = 'InstanceTaskConflictError'
    this.activeTask = activeTask
  }
}

const INSTANCE_TASK_STATUSES = new Set<InstanceTaskStatus>([
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED'
])

function clampInstanceTaskPagination(
  page: number | undefined,
  pageSize: number | undefined
): { page: number; pageSize: number } {
  return {
    page: Number.isInteger(page) && page !== undefined && page > 0 ? page : 1,
    pageSize: Number.isInteger(pageSize) && pageSize !== undefined
      ? Math.min(Math.max(pageSize, 1), 100)
      : 20
  }
}

function normalizeInstanceTaskStatuses(status?: InstanceTaskStatus[]): InstanceTaskStatus[] | undefined {
  if (!Array.isArray(status)) {
    return undefined
  }

  const normalized = status.filter((value): value is InstanceTaskStatus => INSTANCE_TASK_STATUSES.has(value))
  return normalized.length > 0 ? normalized : undefined
}

/**
 * 创建实例操作任务
 */
export async function createInstanceTask(data: CreateInstanceTaskData): Promise<InstanceTaskWithDetails> {
  const result = await prisma.$transaction(async tx => {
    const locked = await tryAdvisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, data.instanceId)
    if (!locked) {
      throw new InstanceTaskConflictError()
    }
    await tx.$queryRaw`SELECT id FROM instances WHERE id = ${data.instanceId} FOR UPDATE`
    await assertNoPendingSnapshotOperations(tx, data.instanceId)
    await assertNoPendingProxySiteOperations(tx, data.instanceId)

    const activeTask = await tx.instanceTask.findFirst({
      where: {
        instanceId: data.instanceId,
        status: { in: ['PENDING', 'PROCESSING'] }
      },
      select: PUBLIC_INSTANCE_TASK_SELECT,
      orderBy: [
        { createdAt: 'asc' },
        { id: 'asc' }
      ]
    })
    if (activeTask) {
      throw new InstanceTaskConflictError(activeTask as unknown as InstanceTaskWithDetails)
    }
    const operationAuthorization = data.taskType === 'rebuild' || data.taskType === 'recreate'
      ? await authorizeSensitiveTaskAdmission(tx, data) : {}

    return tx.instanceTask.create({
      select: PUBLIC_INSTANCE_TASK_SELECT,
      data: {
        instanceId: data.instanceId,
        hostId: data.hostId,
        userId: data.userId,
        taskType: data.taskType,
        imageAlias: data.imageAlias || null,
        sshKeyId: data.sshKeyId || null,
        customInitCommandIds: data.customInitCommandIds ? JSON.stringify(data.customInitCommandIds) : null,
        targetName: data.targetName || null,
        targetHostId: data.targetHostId || null,
        snapshotName: data.snapshotName || null,
        status: 'PENDING',
        ...operationAuthorization
      }
    })
  })
  return result as unknown as InstanceTaskWithDetails
}

/**
 * 获取任务详情
 */
export async function getInstanceTaskById(taskId: number): Promise<InstanceTaskWithDetails | null> {
  const result = await prisma.instanceTask.findUnique({
    where: { id: taskId }, select: PUBLIC_INSTANCE_TASK_SELECT
  })
  return result as unknown as InstanceTaskWithDetails | null
}

/**
 * 获取实例的活跃任务（PENDING 或 PROCESSING）
 */
export async function getActiveTaskForInstance(instanceId: number): Promise<InstanceTaskWithDetails | null> {
  const result = await prisma.instanceTask.findFirst({
    select: PUBLIC_INSTANCE_TASK_SELECT,
    where: {
      instanceId,
      status: { in: ['PENDING', 'PROCESSING'] }
    },
    orderBy: { createdAt: 'desc' }
  })
  return result as unknown as InstanceTaskWithDetails | null
}

/**
 * 获取用户的任务列表
 */
export async function getUserInstanceTasks(
  userId: number,
  options: { page?: number; pageSize?: number; status?: InstanceTaskStatus[] } = {}
): Promise<{ items: InstanceTaskWithDetails[]; total: number }> {
  const { page, pageSize } = clampInstanceTaskPagination(options.page, options.pageSize)
  const status = normalizeInstanceTaskStatuses(options.status)

  const where: Prisma.InstanceTaskWhereInput = { userId }
  if (status && status.length > 0) {
    where.status = { in: status }
  }

  const [items, total] = await Promise.all([
    prisma.instanceTask.findMany({
      select: PUBLIC_INSTANCE_TASK_SELECT,
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize
    }),
    prisma.instanceTask.count({ where })
  ])

  return { items: items as unknown as InstanceTaskWithDetails[], total }
}

/**
 * 更新任务状态
 */
export async function updateInstanceTaskStatus(
  taskId: number,
  status: InstanceTaskStatus,
  updates?: {
    progress?: string
    error?: string
    startedAt?: Date
    finishedAt?: Date
    newInstanceId?: number
  }
): Promise<InstanceTaskWithDetails> {
  const result = await prisma.instanceTask.update({
    select: PUBLIC_INSTANCE_TASK_SELECT,
    where: { id: taskId },
    data: {
      status,
      ...updates
    }
  })
  return result as unknown as InstanceTaskWithDetails
}

/**
 * 更新任务进度
 */
export async function updateInstanceTaskProgress(taskId: number, progress: string): Promise<void> {
  await prisma.instanceTask.update({
    where: { id: taskId },
    data: { progress }
  })
}

/**
 * 获取队列位置
 */
export async function getTaskQueuePosition(taskId: number, hostId: number): Promise<number> {
  const task = await prisma.instanceTask.findUnique({
    where: { id: taskId },
    select: { createdAt: true }
  })

  if (!task) return 0

  const position = await prisma.instanceTask.count({
    where: {
      hostId,
      status: 'PENDING',
      createdAt: { lte: task.createdAt }
    }
  })

  return position
}

/**
 * 清理过期的已完成任务（保疙7天）
 */
export async function cleanupOldTasks(): Promise<number> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  const result = await prisma.instanceTask.deleteMany({
    where: {
      status: { in: ['COMPLETED', 'FAILED'] },
      finishedAt: { lt: sevenDaysAgo }
    }
  })

  return result.count
}

/**
 * 取消 PENDING 状态的任务
 */
export async function cancelInstanceTask(taskId: number): Promise<InstanceTaskWithDetails | null> {
  const task = await prisma.instanceTask.findUnique({
    where: { id: taskId }
  })

  if (!task || task.status !== 'PENDING') {
    return null
  }

  const result = await prisma.$transaction(async tx => {
    const locked = await tryAdvisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, task.instanceId)
    if (!locked) {
      return null
    }

    const updateResult = await tx.instanceTask.updateMany({
      where: {
        id: taskId,
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

    return tx.instanceTask.findUnique({
      where: { id: taskId }, select: PUBLIC_INSTANCE_TASK_SELECT
    })
  })
  return result as unknown as InstanceTaskWithDetails
}
