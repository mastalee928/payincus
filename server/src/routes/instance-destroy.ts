import { hasPendingSnapshotOperation, SnapshotOperationPendingError } from '../db/snapshot-operation-guards.js'
/**
 * 实例销毁相关路由
 * 处理用户端实例销毁功能（不退款）
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { Prisma } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { requestInstanceDeletion, processInstanceDeletion, instanceDeletionResult, DeletionAdmissionError } from '../services/instance-deletion.js'
import type { WriteActor } from '../db/user-write-authorization.js'
import { hasPendingProxySiteOperations, ProxySiteOperationPendingError } from '../db/proxy-site-operation-guards.js'
import { createLog } from '../db/logs.js'
import { apiError, ErrorCode } from '../lib/errors.js'
import { collectTrafficForRunningInstance } from '../services/instance-traffic-collector.js'
import { claimDestroyEmailVerification, normalizeDestroyVerificationIds, requestDestroyEmailVerification } from '../lib/instance-destroy-verification.js'
import {
  USER_AFF_BALANCE_LOCK_NAMESPACE,
  advisoryTransactionLock
} from '../db/advisory-locks.js'

// 销毁业务规则常量
const DESTROY_RULES = {
  MAX_PAID_DESTROY_MONTHLY_TRAFFIC: 5n * 1024n * 1024n * 1024n // 5 GiB
}

const DESTROY_TRAFFIC_LIMIT_REASON = '当前月流量周期无法销毁，已用流量达到或超过 5G'

interface BatchDestroyPreviewItem {
  id: number
  name: string
  canDestroy: boolean
  cannotDestroyReason: string
  isFreeInstance: boolean
  isFirstTime: boolean
  feeWaiverEligible: boolean
  refund: {
    remainingDays: number
    remainingValue: number
    feeRate: number
    feeAmount: number
    refundAmount: number
    destroyCount: number
    maxRefundable: number
  }
  instance: {
    id: number
    name: string
    hostName: string
    planName: string | null
  }
}

interface BatchDestroyResultItem {
  id: number
  name: string
  success: boolean
  pending?: boolean
  skipped?: boolean
  reason?: string
  refundAmount?: number
  feeAmount?: number
  isFirstTime?: boolean
  isFreeInstance?: boolean
}

const BATCH_HIDDEN_REASON = '实例不存在或无权操作'

function isExpiredAt(expiresAt: Date | null | undefined): boolean {
  return !!expiresAt && expiresAt.getTime() <= Date.now()
}

function canUserDestroyExpiredSuspendedPaidInstance(instance: {
  status: string
  suspendReason?: string | null
  packagePlanId?: number | null
  expiresAt?: Date | null
}): boolean {
  return instance.status === 'suspended'
    && instance.suspendReason === 'expired'
    && !!instance.packagePlanId
    && isExpiredAt(instance.expiresAt)
}

function exceedsPaidDestroyTrafficLimit(monthlyTrafficUsed: bigint): boolean {
  return monthlyTrafficUsed >= DESTROY_RULES.MAX_PAID_DESTROY_MONTHLY_TRAFFIC
}

async function getDestroyBlockingTask(instanceId: number, client: any = prisma): Promise<{
  code: 'RESTORE_IN_PROGRESS' | 'UPLOAD_IN_PROGRESS' | 'TASK_IN_PROGRESS' | 'PROXY_SITE_OPERATION_PENDING' | 'SNAPSHOT_OPERATION_PENDING'
  reason: string
} | null> {
  if (await hasPendingSnapshotOperation(instanceId, client)) return { code: 'SNAPSHOT_OPERATION_PENDING', reason: new SnapshotOperationPendingError().message }
  if (await hasPendingProxySiteOperations(instanceId, client)) {
    return { code: 'PROXY_SITE_OPERATION_PENDING', reason: new ProxySiteOperationPendingError().message }
  }
  const [activeRestoreTask, activeUploadTask, activeInstanceTask] = await Promise.all([
    client.restoreTask.findFirst({
      where: {
        instanceId,
        status: { in: ['PENDING', 'PROCESSING'] }
      },
      select: { id: true }
    }),
    client.backupUploadTask.findFirst({
      where: {
        instanceId,
        status: { in: ['PENDING', 'PROCESSING'] }
      },
      select: { id: true }
    }),
    client.instanceTask.findFirst({
      where: {
        instanceId,
        status: { in: ['PENDING', 'PROCESSING'] }
      },
      select: { id: true }
    })
  ])

  if (activeRestoreTask) {
    return { code: 'RESTORE_IN_PROGRESS', reason: '该实例有正在进行的恢复任务，请等待完成或取消' }
  }
  if (activeUploadTask) {
    return { code: 'UPLOAD_IN_PROGRESS', reason: '该实例有正在进行的备份上传任务，请等待完成或取消' }
  }
  if (activeInstanceTask) {
    return { code: 'TASK_IN_PROGRESS', reason: '该实例有正在进行的操作任务，请等待完成' }
  }
  return null
}

function roundMoney(value: number): number {
  return Number(value.toFixed(2))
}

export async function reverseInstanceAffCommissionForRefund(params: {
  tx: Prisma.TransactionClient
  instanceId: number
  refundAmount: number
  remark: string
}): Promise<void> {
  const { tx, instanceId, refundAmount, remark } = params
  if (!Number.isFinite(refundAmount) || refundAmount <= 0) return

  const [affBinding, paidAmountResult] = await Promise.all([
    tx.affBinding.findUnique({
      where: { instanceId },
      select: { affCode: { select: { id: true, userId: true } } }
    }),
    tx.instanceBillingRecord.aggregate({
      where: {
        instanceId,
        type: { in: ['newPurchase', 'renew', 'upgrade', 'downgrade'] },
        amount: { gt: 0 }
      },
      _sum: { amount: true }
    })
  ])

  if (!affBinding) return
  const originalPaidAmount = Number(paidAmountResult._sum.amount || 0)
  if (!Number.isFinite(originalPaidAmount) || originalPaidAmount <= 0) return

  const refundRatio = Math.min(1, refundAmount / originalPaidAmount)
  const affLogs = await tx.affLog.findMany({
    where: {
      instanceId,
      affCodeId: affBinding.affCode.id,
      userId: affBinding.affCode.userId,
      type: { in: ['new_purchase', 'renew'] }
    },
    select: { type: true, amount: true, originalAmount: true }
  })

  for (const type of ['new_purchase', 'renew'] as const) {
    const typeLogs = affLogs.filter(log => log.type === type)
    const issuedCommission = roundMoney(typeLogs.reduce(
      (sum, log) => sum + Math.max(0, Number(log.amount)),
      0
    ))
    const alreadyReversed = roundMoney(typeLogs.reduce(
      (sum, log) => sum + Math.max(0, -Number(log.amount)),
      0
    ))
    const remainingCommission = roundMoney(Math.max(0, issuedCommission - alreadyReversed))
    const commissionAmount = Math.min(
      remainingCommission,
      roundMoney(issuedCommission * refundRatio)
    )
    if (commissionAmount <= 0) continue

    await advisoryTransactionLock(tx, USER_AFF_BALANCE_LOCK_NAMESPACE, affBinding.affCode.userId)
    const affUser = await tx.user.findUniqueOrThrow({
      where: { id: affBinding.affCode.userId },
      select: { affBalance: true }
    })
    const affBalanceBefore = Number(affUser.affBalance)
    const updatedAffUser = await tx.user.update({
      where: { id: affBinding.affCode.userId },
      data: { affBalance: { decrement: commissionAmount } },
      select: { affBalance: true }
    })

    await tx.affLog.create({
      data: {
        userId: affBinding.affCode.userId,
        type,
        amount: -commissionAmount,
        affCodeId: affBinding.affCode.id,
        instanceId,
        originalAmount: roundMoney(typeLogs.reduce(
          (sum, log) => Number(log.amount) > 0
            ? sum + Math.max(0, Number(log.originalAmount || 0))
            : sum,
          0
        )),
        balanceBefore: affBalanceBefore,
        balanceAfter: Number(updatedAffUser.affBalance),
        remark
      }
    })

    await tx.affCode.update({
      where: { id: affBinding.affCode.id },
      data: { totalEarnings: { decrement: commissionAmount } }
    })

    if (type === 'new_purchase' && commissionAmount >= remainingCommission) {
      await tx.affCode.updateMany({
        where: { id: affBinding.affCode.id, usedCount: { gt: 0 } },
        data: { usedCount: { decrement: 1 } }
      })
    }
  }
}

async function buildBatchDestroyPreviewItem(userId: number, instanceId: number): Promise<BatchDestroyPreviewItem> {
  const instance = await prisma.instance.findUnique({
    where: { id: instanceId },
    include: {
      host: { select: { id: true, name: true, userId: true } },
      packagePlan: { select: { id: true, name: true } }
    }
  })

  if (!instance) {
    return {
      id: instanceId,
      name: `#${instanceId}`,
      canDestroy: false,
      cannotDestroyReason: BATCH_HIDDEN_REASON,
      isFreeInstance: true,
      isFirstTime: false,
      feeWaiverEligible: false,
      refund: {
        remainingDays: 0,
        remainingValue: 0,
        feeRate: 0,
        feeAmount: 0,
        refundAmount: 0,
        destroyCount: 0,
        maxRefundable: 0
      },
      instance: {
        id: instanceId,
        name: `#${instanceId}`,
        hostName: '-',
        planName: null
      }
    }
  }

  if (instance.userId !== userId) {
    return {
      id: instanceId,
      name: `#${instanceId}`,
      canDestroy: false,
      cannotDestroyReason: BATCH_HIDDEN_REASON,
      isFreeInstance: true,
      isFirstTime: false,
      feeWaiverEligible: false,
      refund: {
        remainingDays: 0,
        remainingValue: 0,
        feeRate: 0,
        feeAmount: 0,
        refundAmount: 0,
        destroyCount: 0,
        maxRefundable: 0
      },
      instance: {
        id: instanceId,
        name: `#${instanceId}`,
        hostName: '-',
        planName: null
      }
    }
  }

  if (instance.status === 'deleted') {
    return {
      id: instance.id,
      name: instance.name,
      canDestroy: false,
      cannotDestroyReason: '实例已删除',
      isFreeInstance: !instance.packagePlanId,
      isFirstTime: false,
      feeWaiverEligible: false,
      refund: {
        remainingDays: 0,
        remainingValue: 0,
        feeRate: 0,
        feeAmount: 0,
        refundAmount: 0,
        destroyCount: 0,
        maxRefundable: 0
      },
      instance: {
        id: instance.id,
        name: instance.name,
        hostName: instance.host.name,
        planName: instance.packagePlan?.name || null
      }
    }
  }

  if (instance.status === 'creating') {
    return {
      id: instance.id,
      name: instance.name,
      canDestroy: false,
      cannotDestroyReason: '实例正在创建中，无法销毁',
      isFreeInstance: !instance.packagePlanId,
      isFirstTime: false,
      feeWaiverEligible: false,
      refund: {
        remainingDays: 0,
        remainingValue: 0,
        feeRate: 0,
        feeAmount: 0,
        refundAmount: 0,
        destroyCount: 0,
        maxRefundable: 0
      },
      instance: {
        id: instance.id,
        name: instance.name,
        hostName: instance.host.name,
        planName: instance.packagePlan?.name || null
      }
    }
  }

  if (instance.status === 'suspended' && !canUserDestroyExpiredSuspendedPaidInstance(instance)) {
    return {
      id: instance.id,
      name: instance.name,
      canDestroy: false,
      cannotDestroyReason: '实例已被封停，无法销毁，请先联系管理员解封',
      isFreeInstance: !instance.packagePlanId,
      isFirstTime: false,
      feeWaiverEligible: false,
      refund: {
        remainingDays: 0,
        remainingValue: 0,
        feeRate: 0,
        feeAmount: 0,
        refundAmount: 0,
        destroyCount: 0,
        maxRefundable: 0
      },
      instance: {
        id: instance.id,
        name: instance.name,
        hostName: instance.host.name,
        planName: instance.packagePlan?.name || null
      }
    }
  }

  const isErrorState = instance.status === 'error'
  const isFreeInstance = !instance.packagePlanId
  const destroyRecords = await prisma.userDestroyRecord.findMany({
    where: { userId },
    orderBy: { destroyedAt: 'desc' }
  })
  const isFirstTime = destroyRecords.length === 0
  let canDestroy = true
  let cannotDestroyReason = ''

  if (!isFreeInstance) {
    if (
      !canUserDestroyExpiredSuspendedPaidInstance(instance)
      && exceedsPaidDestroyTrafficLimit(instance.monthlyTrafficUsed)
    ) {
      canDestroy = false
      cannotDestroyReason = DESTROY_TRAFFIC_LIMIT_REASON
    }
  }

  return {
    id: instance.id,
    name: instance.name,
    canDestroy,
    cannotDestroyReason,
    isFreeInstance,
    isFirstTime,
    feeWaiverEligible: isErrorState,
    refund: {
      remainingDays: 0,
      remainingValue: 0,
      feeRate: 0,
      feeAmount: 0,
      refundAmount: 0,
      destroyCount: destroyRecords.length,
      maxRefundable: 0
    },
    instance: {
      id: instance.id,
      name: instance.name,
      hostName: instance.host.name,
      planName: instance.packagePlan?.name || null
    }
  }
}

async function executeDestroyForUser(
  user: WriteActor & { username: string },
  instanceId: number,
  logger: { warn: (...args: any[]) => void; error: (...args: any[]) => void }
): Promise<BatchDestroyResultItem> {
  const instance = await prisma.instance.findUnique({
    where: { id: instanceId },
    include: {
      user: { select: { id: true, username: true, balance: true, email: true } },
      host: { select: { id: true, name: true, userId: true } }
    }
  })

  if (!instance) {
    return { id: instanceId, name: `#${instanceId}`, success: false, reason: BATCH_HIDDEN_REASON }
  }

  if (instance.userId !== user.id) {
    return { id: instanceId, name: `#${instanceId}`, success: false, reason: BATCH_HIDDEN_REASON }
  }

  if (instance.status === 'deleted') {
    return { id: instance.id, name: instance.name, success: false, skipped: true, reason: '实例已删除' }
  }

  if (instance.status === 'creating') {
    return { id: instance.id, name: instance.name, success: false, skipped: true, reason: '实例正在创建中，无法销毁' }
  }

  if (instance.status === 'suspended' && !canUserDestroyExpiredSuspendedPaidInstance(instance)) {
    return { id: instance.id, name: instance.name, success: false, skipped: true, reason: '实例已被封停，无法销毁，请先联系管理员解封' }
  }

  const blockingTask = await getDestroyBlockingTask(instanceId)
  if (blockingTask) {
    return { id: instance.id, name: instance.name, success: false, skipped: true, reason: blockingTask.reason }
  }

  const isFreeInstance = !instance.packagePlanId


  let currentMonthlyTrafficUsed = instance.monthlyTrafficUsed
  if (!isFreeInstance && instance.status === 'running') {
    const collectResult = await collectTrafficForRunningInstance(instanceId)
    if (!collectResult.success) {
      logger.warn({ instanceId, error: collectResult.error }, '销毁前即时采集流量失败')
    } else {
      currentMonthlyTrafficUsed = collectResult.currentUsage
    }
  }

  if (
    !isFreeInstance
    && !canUserDestroyExpiredSuspendedPaidInstance(instance)
    && exceedsPaidDestroyTrafficLimit(currentMonthlyTrafficUsed)
  ) {
    return { id: instance.id, name: instance.name, success: false, skipped: true, reason: DESTROY_TRAFFIC_LIMIT_REASON }
  }

  const result = await requestInstanceDeletion(instance, user, { mode: 'user_destroy', deferRemote: true })
  return { id: instance.id, name: instance.name, ...result, isFreeInstance }

}

export default async function instanceDestroyRoutes(fastify: FastifyInstance) {
  fastify.post<{ Body: { instanceIds: number[] } }>('/destroy-verification', {
    onRequest: [fastify.authenticateUser],
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    schema: { body: { type: 'object', required: ['instanceIds'], additionalProperties: false,
      properties: { instanceIds: { type: 'array', minItems: 1, maxItems: 100, uniqueItems: true,
        items: { type: 'integer', minimum: 1, maximum: 2147483647 } } } } }
  }, async (request, reply) => {
    const result = await requestDestroyEmailVerification(request.user, request.body.instanceIds)
    if (!result.success) return reply.code(result.code === 'AUTHENTICATION_STATE_CHANGED' ? 401 : 400).send(result)
    return result
  })

  fastify.post<{
    Body: { instanceIds: number[] }
  }>('/batch/destroy-info', {
    onRequest: [fastify.authenticateUser],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        required: ['instanceIds'],
        properties: {
          instanceIds: {
            type: 'array',
            items: { type: 'integer' },
            minItems: 1,
            maxItems: 100
          }
        },
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    const uniqueIds = Array.from(new Set(request.body.instanceIds)).filter(id => Number.isInteger(id))
    if (uniqueIds.length === 0) {
      return reply.code(400).send({ error: '请选择至少一个实例' })
    }

    const items = await Promise.all(uniqueIds.map(id => buildBatchDestroyPreviewItem(request.user.id, id)))
    return { items }
  })

  fastify.post<{
    Body: { instanceIds: number[]; emailCode: string }
  }>('/batch/destroy', {
    onRequest: [fastify.authenticateUser],
    config: { rateLimit: { max: 3, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        required: ['instanceIds', 'emailCode'],
        properties: {
          emailCode: { type: 'string', pattern: '^\\d{6}$' },
          instanceIds: {
            type: 'array',
            items: { type: 'integer', minimum: 1, maximum: 2147483647 },
            uniqueItems: true,
            minItems: 1,
            maxItems: 100
          }
        },
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    const uniqueIds = normalizeDestroyVerificationIds(request.body.instanceIds)
    if (!uniqueIds) {
      return reply.code(400).send({ error: '请选择至少一个实例' })
    }

    const verification = await claimDestroyEmailVerification(request.user, uniqueIds, request.body.emailCode)
    if (!verification.success) return reply.code(403).send(verification)

    const userMeta = {
      ...request.user,
      username: request.user.username
    }

    const results: BatchDestroyResultItem[] = []
    for (const instanceId of uniqueIds) {
      try {
        results.push(await executeDestroyForUser(userMeta, instanceId, request.log))
      } catch (error) {
        const reasons: Record<string, string> = {
          DELETE_WORKFLOW_BUSY: '实例正在执行其他任务，本项销毁未受理',
          DELETE_TARGET_CHANGED: '实例状态已变化，本项销毁未受理',
          PLATFORM_RECOVERY_HELD: '平台处于恢复保护，本项销毁未受理',
          INSTANCE_DESTROY_NOT_ALLOWED: '实例当前状态或流量不符合销毁条件，本项销毁未受理'
        }
        const reason = error instanceof DeletionAdmissionError ? reasons[error.code] || '本项销毁未通过授权检查'
          : error instanceof SnapshotOperationPendingError || error instanceof ProxySiteOperationPendingError
            ? '实例仍有未完成的快照或站点操作，本项销毁未受理'
            : '本项处理结果暂未确认；已受理的任务仍由系统继续执行'
        request.log.warn({ instanceId }, '批量销毁单项处理未完成，继续处理其他实例')
        results.push({ id: instanceId, name: `#${instanceId}`, success: false, reason })
      }
    }

    // Admission for the entire batch precedes remote work, so closing the page
    // cannot lose a later accepted deletion behind an unreachable first machine.
    for (const result of results.filter(item => item.pending)) {
      try {
        await processInstanceDeletion(result.id)
        Object.assign(result, await instanceDeletionResult(result.id))
      } catch {
        // Admission is already committed; a failed status read cannot revoke it.
        request.log.warn({ instanceId: result.id }, '销毁已受理，后台继续清理并核验结果')
      }
    }
    const successCount = results.filter(item => item.success).length
    const skippedCount = results.filter(item => item.skipped).length
    const pendingCount = results.filter(item => item.pending).length
    const failedCount = results.length - successCount - skippedCount - pendingCount

    await createLog(
      request.user.id,
      'billing',
      'instance.batch_destroy',
      `批量销毁共 ${results.length} 台：已完成 ${successCount} 台，自动处理中 ${pendingCount} 台，已跳过 ${skippedCount} 台，未完成 ${failedCount} 台`,
      failedCount > 0 ? 'warning' : pendingCount > 0 ? 'pending' : 'success'
    )

    return {
      message: pendingCount ? '销毁已受理，系统正在自动清理并核验资源释放' : successCount > 0 ? '批量销毁已处理' : '没有实例完成销毁',
      successCount,
      skippedCount,
      pendingCount,
      failedCount,
      results
    }
  })

  // ==================== 获取销毁预览信息 ====================
  // GET /api/instances/:id/destroy-info
  fastify.get<{ Params: { id: string }; Querystring: { feeWaiver?: string } }>('/:id/destroy-info', {
    onRequest: [fastify.authenticate],
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } }
  }, async (request: FastifyRequest<{ Params: { id: string }; Querystring: { feeWaiver?: string } }>, reply: FastifyReply) => {
    const { user } = request
    const instanceId = Number(request.params.id)

    if (isNaN(instanceId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const instance = await prisma.instance.findUnique({
      where: { id: instanceId },
      include: {
        host: { select: { id: true, name: true, userId: true } },
        packagePlan: { select: { id: true, name: true } }
      }
    })

    if (!instance) {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    // 只有实例所有者可以销毁
    if (instance.userId !== user.id) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 检查实例状态
    if (instance.status === 'deleted') {
      return reply.code(400).send({ error: '实例已删除', canDestroy: false })
    }

    if (instance.status === 'creating') {
      return reply.code(400).send({ error: '实例正在创建中，无法销毁', canDestroy: false })
    }

    if (instance.status === 'suspended' && !canUserDestroyExpiredSuspendedPaidInstance(instance)) {
      return reply.code(400).send({ error: '实例已被封停，无法销毁，请先联系管理员解封', canDestroy: false })
    }

    const isErrorState = instance.status === 'error'

    // 免费实例检查
    const isFreeInstance = !instance.packagePlanId

    // 查询用户销毁记录（仅付费实例销毁计入）
    const destroyRecords = await prisma.userDestroyRecord.findMany({
      where: { userId: user.id },
      orderBy: { destroyedAt: 'desc' }
    })

    // 检查是否首次销毁
    const isFirstTime = destroyRecords.length === 0

    // 判断是否可以销毁（已移除冷却期限制，付费实例随时可销毁）
    let canDestroy = true
    let cannotDestroyReason = ''

    if (
      !isFreeInstance
      && !canUserDestroyExpiredSuspendedPaidInstance(instance)
      && exceedsPaidDestroyTrafficLimit(instance.monthlyTrafficUsed)
    ) {
      canDestroy = false
      cannotDestroyReason = DESTROY_TRAFFIC_LIMIT_REASON
    }

    return {
      canDestroy,
      cannotDestroyReason,
      isFreeInstance,
      isFirstTime,
      isErrorState,
      feeWaiverEligible: isErrorState,
      // 销毁规则
      rules: {
        feeRate: 0
      },
      // 退款预览
      refund: {
        remainingDays: 0,
        remainingValue: 0,
        feeRate: 0,
        feeAmount: 0,
        refundAmount: 0,
        destroyCount: destroyRecords.length,  // 已销毁次数
        maxRefundable: 0
      },
      // 实例信息
      instance: {
        id: instance.id,
        name: instance.name,
        hostName: instance.host.name,
        planName: instance.packagePlan?.name || null
      }
    }
  })

  // ==================== 执行销毁 ====================
  // POST /api/instances/:id/destroy
  fastify.post<{ Params: { id: string }; Querystring: { feeWaiver?: string }; Body: { emailCode: string } }>('/:id/destroy', {
    onRequest: [fastify.authenticate],
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    schema: { body: { type: 'object', required: ['emailCode'], additionalProperties: false,
      properties: { emailCode: { type: 'string', pattern: '^\\d{6}$' } } } }
  }, async (request, reply) => {
    const { user } = request
    const instanceId = Number(request.params.id)

    if (!/^[1-9]\d*$/.test(request.params.id) || !Number.isSafeInteger(instanceId) || instanceId > 2147483647) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    // 获取实例信息
    const instance = await prisma.instance.findUnique({
      where: { id: instanceId },
      include: {
        user: { select: { id: true, username: true, balance: true, email: true } },
        host: { select: { id: true, name: true, userId: true } }
      }
    })

    if (!instance) {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    // 只有实例所有者可以销毁
    if (instance.userId !== user.id) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 检查实例状态
    if (instance.status === 'deleted') {
      return reply.code(400).send({ error: '实例已删除' })
    }

    if (instance.status === 'creating') {
      return reply.code(400).send({ error: '实例正在创建中，无法销毁' })
    }

    if (instance.status === 'suspended' && !canUserDestroyExpiredSuspendedPaidInstance(instance)) {
      return reply.code(400).send({ error: '实例已被封停，无法销毁，请先联系管理员解封' })
    }

    const blockingTask = await getDestroyBlockingTask(instanceId)
    if (blockingTask) {
      return reply.code(409).send({
        error: blockingTask.reason,
        code: blockingTask.code
      })
    }

    // 免费实例检查
    const isFreeInstance = !instance.packagePlanId

    // 查询用户销毁记录


      // 已移除冷却期限制，付费实例可随时销毁

    let currentMonthlyTrafficUsed = instance.monthlyTrafficUsed

    if (!isFreeInstance && instance.status === 'running') {
      const collectResult = await collectTrafficForRunningInstance(instanceId)
      if (!collectResult.success) {
        request.log.warn({ instanceId, error: collectResult.error }, '销毁前即时采集流量失败')
      } else {
        currentMonthlyTrafficUsed = collectResult.currentUsage
      }
    }

    if (
      !isFreeInstance
      && !canUserDestroyExpiredSuspendedPaidInstance(instance)
      && exceedsPaidDestroyTrafficLimit(currentMonthlyTrafficUsed)
    ) {
      return reply.code(400).send(apiError(
        ErrorCode.INSTANCE_DESTROY_TRAFFIC_LIMIT_EXCEEDED,
        DESTROY_TRAFFIC_LIMIT_REASON
      ))
    }

    const verification = await claimDestroyEmailVerification(user, [instanceId], request.body.emailCode)
    if (!verification.success) return reply.code(403).send(verification)

    const result = await requestInstanceDeletion(instance, user, { mode: 'user_destroy' })
    return reply.code(result.pending ? 202 : 200).send({ ...result, isFreeInstance })
  })
}
