/**
 * 充值记录数据库操作
 */

import { prisma } from './prisma.js'
import { Prisma, type RechargeRecord, type RechargeStatus } from '@prisma/client'
import { nanoid } from 'nanoid'
import { getTodayRange } from '../lib/timezone.js'
import { USER_BALANCE_LOCK_NAMESPACE, PAYMENT_SETTLEMENT_LOCK_NAMESPACE, advisoryTransactionLock, advisoryTransactionLockString } from './advisory-locks.js'
import { getCurrentRechargeGatewayOrderNo } from '../lib/recharge-order-guard.js'
import { sanitizeObject } from '../lib/log-sanitizer.js'
import { lockAdministrativeUserMutation, type WriteActor } from './user-write-authorization.js'

// ==================== 类型定义 ====================

export interface CreateRechargeOrderInput {
  orderNo?: string
  userId: number
  providerId: number
  amount: number
  actualAmount?: number
  fee?: number
  paymentMethod?: string
  ip?: string
  userAgent?: string
  expiredAt?: Date
  providerConfigSnapshot?: string | null
  paymentDetails?: Record<string, unknown> | null
}

export interface UpdateRechargePaymentSelectionInput {
  paymentMethod?: string | null
  fee: number
  actualAmount: number
  paymentDetails: Record<string, unknown> | null
  expiredAt?: Date
  expectedPaymentDetails?: Record<string, unknown>
}

export interface RechargeRecordWithProvider extends RechargeRecord {
  provider: {
    id: number
    name: string
    type: string
  }
}

export type CompleteRechargeResult = RechargeRecord & {
  completedNow: boolean
  reconciliationPending?: boolean
}

export interface VerifiedRechargePayment {
  gatewayOrderNo: string
  receivedAmount?: number
  currency?: string
  proof: Record<string, unknown>
}

export function isTimeoutCancelledRecharge(record: { status: string; cancelReason?: string | null }): boolean {
  return record.status === 'cancelled' && record.cancelReason === 'timeout'
}

export async function observeUnpaidTimeout(record: RechargeRecord, terminal: boolean, proof: Record<string, unknown>, actor?: WriteActor) {
  if (!terminal) return
  await prisma.$transaction(async tx => {
    if (actor) await lockAdministrativeUserMutation(tx, record.userId, actor)
    const changed = await tx.rechargeRecord.updateMany({ where: { id: record.id, status: 'cancelled', cancelReason: 'timeout',
      ...paymentSelectionCondition(record.paymentDetails as Record<string, unknown> | null) },
      data: { cancelReason: 'provider', callbackData: sanitizeObject(proof) as Prisma.InputJsonObject, callbackAt: new Date() } })
    if (!changed.count) throw new RechargePaymentSelectionChangedError()
  })
}

export async function recordLateRechargePayment(
  record: RechargeRecord, tradeNo: string | undefined, payment: VerifiedRechargePayment,
  reason: string, eligible: boolean, tx: Prisma.TransactionClient = prisma
) {
  const trade = tradeNo?.trim() || `__NO_TRADE_NO__${payment.gatewayOrderNo}`
  return tx.rechargeLatePayment.upsert({
    where: { rechargeId_gatewayOrderNo_tradeNo: { rechargeId: record.id, gatewayOrderNo: payment.gatewayOrderNo, tradeNo: trade } },
    create: { rechargeId: record.id, providerId: record.providerId, gatewayOrderNo: payment.gatewayOrderNo, tradeNo: trade,
      receivedAmount: payment.receivedAmount === undefined ? null : String(payment.receivedAmount), currency: payment.currency,
      eligible: eligible && !!tradeNo?.trim(), reason, proof: sanitizeObject(payment.proof) as Prisma.InputJsonObject,
      expectedPaymentDetails: record.paymentDetails === null ? Prisma.JsonNull : record.paymentDetails },
    update: {}
  })
}

export class RechargePaymentSelectionChangedError extends Error {
  constructor() { super('订单状态已变更，请刷新后重试') }
}

function paymentSelectionCondition(expected: Record<string, unknown> | null | undefined): Prisma.RechargeRecordWhereInput {
  return expected === undefined ? {} : {
    paymentDetails: { equals: expected === null ? Prisma.AnyNull : expected as Prisma.InputJsonValue }
  }
}

interface MoneySumRow {
  value: unknown
}

const RECHARGE_STATUSES = new Set<RechargeStatus>([
  'pending',
  'paid',
  'completed',
  'failed',
  'cancelled',
  'refunded'
])

function toMoney(value: unknown): number {
  if (value === null || value === undefined) return 0
  return parseFloat(String(value)) || 0
}

function clampPagination(
  page: number | undefined,
  pageSize: number | undefined,
  fallbackPageSize: number = 20,
  maxPageSize: number = 50
): { page: number; pageSize: number } {
  return {
    page: Number.isInteger(page) && page !== undefined && page > 0 ? page : 1,
    pageSize: Number.isInteger(pageSize) && pageSize !== undefined
      ? Math.min(Math.max(pageSize, 1), maxPageSize)
      : fallbackPageSize
  }
}

function normalizeRechargeStatus(status: RechargeStatus | undefined): RechargeStatus | undefined {
  return status && RECHARGE_STATUSES.has(status) ? status : undefined
}

// ==================== 订单号生成 ====================

/**
 * 生成订单号（时间戳 + 随机字符）
 */
export function generateOrderNo(): string {
  const timestamp = Date.now().toString(36)
  const random = nanoid(8)
  return `R${timestamp}${random}`.toUpperCase()
}

// ==================== 查询操作 ====================

/**
 * 根据订单号获取充值记录
 */
export async function getRechargeRecordByOrderNo(orderNo: string): Promise<RechargeRecordWithProvider | null> {
  return prisma.rechargeRecord.findUnique({
    where: { orderNo },
    include: {
      provider: {
        select: { id: true, name: true, type: true }
      }
    }
  }) as Promise<RechargeRecordWithProvider | null>
}

/**
 * 根据第三方交易号获取充值记录
 */
export async function getRechargeRecordByTradeNo(tradeNo: string): Promise<RechargeRecord | null> {
  return prisma.rechargeRecord.findFirst({
    where: { tradeNo }
  })
}

/**
 * 根据 ID 获取充值记录
 */
export async function getRechargeRecordById(id: number): Promise<RechargeRecordWithProvider | null> {
  return prisma.rechargeRecord.findUnique({
    where: { id },
    include: {
      provider: {
        select: { id: true, name: true, type: true }
      }
    }
  }) as Promise<RechargeRecordWithProvider | null>
}

/**
 * 获取用户的充值记录（分页）
 */
export async function getUserRechargeRecords(
  userId: number,
  options: { page?: number; pageSize?: number; status?: RechargeStatus } = {}
): Promise<{ records: RechargeRecordWithProvider[]; total: number; page: number; pageSize: number }> {
  const { page, pageSize } = clampPagination(options.page, options.pageSize)
  const skip = (page - 1) * pageSize
  const status = normalizeRechargeStatus(options.status)

  const where: Record<string, unknown> = { userId }
  if (status) {
    where.status = status
  }

  const [records, total] = await Promise.all([
    prisma.rechargeRecord.findMany({
      where,
      include: {
        provider: {
          select: { id: true, name: true, type: true }
        }
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize
    }),
    prisma.rechargeRecord.count({ where })
  ])

  return {
    records: records as RechargeRecordWithProvider[],
    total,
    page,
    pageSize
  }
}

/**
 * 获取所有充值记录（管理员，分页）
 */
export async function getAllRechargeRecords(
  options: { page?: number; pageSize?: number; status?: RechargeStatus; userId?: number } = {}
): Promise<{ records: RechargeRecordWithProvider[]; total: number; page: number; pageSize: number }> {
  const { page, pageSize } = clampPagination(options.page, options.pageSize)
  const skip = (page - 1) * pageSize
  const status = normalizeRechargeStatus(options.status)

  const where: Record<string, unknown> = {}
  if (status) where.status = status
  if (Number.isInteger(options.userId) && options.userId !== undefined && options.userId > 0) {
    where.userId = options.userId
  }

  const [records, total] = await Promise.all([
    prisma.rechargeRecord.findMany({
      where,
      include: {
        provider: {
          select: { id: true, name: true, type: true }
        },
        user: {
          select: { id: true, username: true }
        }
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize
    }),
    prisma.rechargeRecord.count({ where })
  ])

  return {
    records: records as unknown as RechargeRecordWithProvider[],
    total,
    page,
    pageSize
  }
}

// ==================== 创建操作 ====================

/**
 * 创建充值订单
 */
export async function createRechargeOrder(input: CreateRechargeOrderInput): Promise<RechargeRecord> {
  const orderNo = input.orderNo || generateOrderNo()
  const expiredAt = input.expiredAt ?? new Date(Date.now() + 30 * 60 * 1000)

  const record = await prisma.rechargeRecord.create({
    data: {
      userId: input.userId,
      providerId: input.providerId,
      orderNo,
      amount: input.amount,
      actualAmount: input.actualAmount,
      fee: input.fee || 0,
      paymentMethod: input.paymentMethod,
      status: 'pending',
      ip: input.ip,
      userAgent: input.userAgent,
      expiredAt,
      providerConfigSnapshot: input.providerConfigSnapshot,
      paymentDetails: input.paymentDetails as any
    }
  })


  return record
}

// ==================== 更新操作 ====================

/**
 * 更新充值订单的支付元数据，不改变订单状态
 */
export async function updateRechargeOrderMetadata(
  orderNo: string,
  data: {
    tradeNo?: string | null
    callbackData?: Record<string, unknown>
    paymentDetails?: Record<string, unknown>
    expectedPaymentDetails?: Record<string, unknown> | null
    actor?: WriteActor
  }
): Promise<RechargeRecord> {
  return prisma.$transaction(async (tx) => {
    if (data.actor) await lockAdministrativeUserMutation(tx, data.actor.id, data.actor)
    const updateData: Record<string, unknown> = {}

    if (data.tradeNo !== undefined) {
      updateData.tradeNo = data.tradeNo
    }

    if (data.callbackData !== undefined) {
      updateData.callbackData = data.callbackData as any
      updateData.callbackAt = new Date()
    }

    if (data.paymentDetails !== undefined) {
      updateData.paymentDetails = data.paymentDetails as any
    }

    const updated = await tx.rechargeRecord.updateMany({
      where: {
        orderNo,
        status: { in: ['pending', 'paid'] },
        ...paymentSelectionCondition(data.expectedPaymentDetails)
      },
      data: updateData
    })
    if (updated.count === 0 && data.expectedPaymentDetails !== undefined) throw new RechargePaymentSelectionChangedError()

    const record = await tx.rechargeRecord.findUnique({
      where: { orderNo }
    })

    if (!record) {
      throw new Error('订单不存在')
    }

    return record
  })
}

/**
 * 完成充值（成功）
 * 使用状态机 + 条件更新确保幂等性和并发安全
 */
export async function completeRecharge(
  orderNo: string,
  data: {
    tradeNo?: string
    callbackData?: Record<string, unknown>
    actualAmount?: number
    paymentDetails?: Record<string, unknown>
    expectedPaymentDetails?: Record<string, unknown> | null
    actor?: WriteActor
    verifiedPayment?: VerifiedRechargePayment
    latePaymentId?: number
    reconciliationNote?: string
  }
): Promise<CompleteRechargeResult> {
  const record = await prisma.rechargeRecord.findUnique({
    where: { orderNo }
  })

  if (!record) {
    throw new Error('订单不存在')
  }

  // 幂等性处理：已完成的订单直接返回，不重复处理
  if (record.status === 'completed' && !data.actor && !data.verifiedPayment) {
    return { ...record, completedNow: false }
  }

  // 已取消或失败的订单不能再完成
  if ((record.status === 'cancelled' || record.status === 'failed') && !data.verifiedPayment && !data.latePaymentId) {
    throw new Error(`订单状态异常：${record.status}`)
  }

  const creditAmount = Number(data.actualAmount ?? record.actualAmount ?? record.amount)
  if (!Number.isFinite(creditAmount) || creditAmount <= 0) {
    throw new Error('充值入账金额无效')
  }

  // 使用事务确保原子性
  const result = await prisma.$transaction(async (tx) => {
    if (data.tradeNo) {
      await advisoryTransactionLockString(tx, PAYMENT_SETTLEMENT_LOCK_NAMESPACE, `${record.providerId}:${data.tradeNo.trim()}`)
    }
    await advisoryTransactionLock(tx, USER_BALANCE_LOCK_NAMESPACE, record.userId)
    if (data.actor) await lockAdministrativeUserMutation(tx, record.userId, data.actor)

    await tx.$queryRaw`SELECT id FROM recharge_records WHERE id = ${record.id} FOR UPDATE`
    const current = await tx.rechargeRecord.findUniqueOrThrow({ where: { id: record.id } })
    if (current.status === 'completed') {
      if (data.verifiedPayment && data.tradeNo && current.tradeNo !== data.tradeNo.trim()) {
        await recordLateRechargePayment(current, data.tradeNo, data.verifiedPayment, 'additional_payment', false, tx)
      }
      return { ...current, completedNow: false }
    }
    if (!await tx.rechargeRecord.findFirst({ where: { id: record.id, ...paymentSelectionCondition(data.expectedPaymentDetails) } })) {
      throw new RechargePaymentSelectionChangedError()
    }
    if (data.verifiedPayment && (data.expectedPaymentDetails === undefined ||
      data.verifiedPayment.gatewayOrderNo !== getCurrentRechargeGatewayOrderNo(current.paymentDetails, current.orderNo))) {
      throw new RechargePaymentSelectionChangedError()
    }
    const duplicateTrade = data.tradeNo ? await tx.rechargeRecord.findFirst({ where: {
      providerId: record.providerId, tradeNo: data.tradeNo.trim(), id: { not: record.id }, status: { in: ['completed', 'refunded'] }
    } }) : null
    let evidence: Awaited<ReturnType<typeof recordLateRechargePayment>> | null = null
    if (data.latePaymentId) {
      if (!data.actor) throw new Error('ADMIN_ACTOR_FORBIDDEN')
      evidence = await tx.rechargeLatePayment.findUnique({ where: { id: data.latePaymentId } })
      if (!evidence || evidence.rechargeId !== record.id || evidence.status !== 'pending' || !evidence.eligible ||
        evidence.tradeNo !== data.tradeNo || evidence.gatewayOrderNo !== getCurrentRechargeGatewayOrderNo(current.paymentDetails, current.orderNo) ||
        !['cancelled', 'failed'].includes(current.status) || duplicateTrade) throw new Error('LATE_PAYMENT_NOT_CREDITABLE')
    } else if (data.verifiedPayment && (duplicateTrade || !['pending', 'paid'].includes(current.status))) {
      const active = getCurrentRechargeGatewayOrderNo(current.paymentDetails, current.orderNo) === data.verifiedPayment.gatewayOrderNo
      evidence = await recordLateRechargePayment(current, data.tradeNo, data.verifiedPayment,
        duplicateTrade ? 'duplicate_trade' : current.status === 'refunded' ? 'refunded' : current.cancelReason || current.status,
        active && !duplicateTrade && current.status !== 'refunded', tx)
      if (!isTimeoutCancelledRecharge(current) || !evidence.eligible || evidence.status !== 'pending') {
        return { ...current, completedNow: false, reconciliationPending: true }
      }
    } else if (duplicateTrade) throw new Error('PAYMENT_TRADE_ALREADY_CREDITED')

    // 1. 使用条件更新确保并发安全（只有 pending 或 paid 状态可以变为 completed）
    const updateResult = await tx.rechargeRecord.updateMany({
      where: {
        orderNo,
        // Terminal recovery requires a verified, locked evidence record; ordinary calls stay pending/paid only.
        ...(evidence ? { status: current.status } : { status: { in: ['pending', 'paid'] as RechargeStatus[] } }),
        ...paymentSelectionCondition(data.expectedPaymentDetails)
      },
      data: {
        status: 'completed',
        tradeNo: data.tradeNo?.trim(),
        callbackData: data.callbackData as any,
        callbackAt: new Date(),
        completedAt: new Date(),
        actualAmount: creditAmount,
        paymentDetails: (data.paymentDetails as any) ?? record.paymentDetails
      }
    })

    // 如果更新了 0 条记录，说明状态已被其他进程改变
    if (updateResult.count === 0) {
      // 重新查询订单状态
      const currentRecord = await tx.rechargeRecord.findUnique({
        where: { orderNo }
      })
      // 如果已经是 completed，说明是并发完成，返回成功（幂等）
      if (currentRecord && currentRecord.status === 'completed') {
        return { ...currentRecord, completedNow: false }
      }
      if (data.expectedPaymentDetails !== undefined) throw new RechargePaymentSelectionChangedError()
      throw new Error('订单状态已变更，无法完成')
    }

    // 获取更新后的记录
    const updatedRecord = await tx.rechargeRecord.findUnique({
      where: { orderNo }
    })

    if (!updatedRecord) {
      throw new Error('订单更新异常')
    }

    // 2. 增加用户余额（使用 ?? 避免 0 值被误判为 falsy）
    const updatedUser = await tx.user.update({
      where: { id: record.userId },
      data: { balance: { increment: creditAmount } },
      select: { balance: true }
    })
    const balanceAfter = Number(updatedUser.balance)

    // 3. 记录余额日志
    await tx.balanceLog.create({
      data: {
        userId: record.userId,
        type: 'recharge',
        amount: creditAmount,
        balanceBefore: Number((balanceAfter - creditAmount).toFixed(2)),
        balanceAfter,
        orderId: record.orderNo,
        remark: `充值：${Number(record.amount)} 元`
      }
    })
    if (evidence) await tx.rechargeLatePayment.update({ where: { id: evidence.id }, data: {
      status: 'credited', handledAt: new Date(), handledById: data.actor?.id,
      note: data.actor ? data.reconciliationNote : '系统超时取消后收到有效付款，自动补入余额'
    } })

    // 4. 注释掉首次充值激活 AFF 推荐计划的逻辑
    // 由于需求变更，AFF 推荐计划现在无需充值即可使用
    // const userProfile = await tx.user.findUnique({
    //   where: { id: record.userId },
    //   select: { affActivatedAt: true }
    // })
    // if (!userProfile?.affActivatedAt) {
    //   await tx.user.update({
    //     where: { id: record.userId },
    //     data: { affActivatedAt: new Date() }
    //   })
    // }

    return { ...updatedRecord, completedNow: true }
  })

  if (result.completedNow) {
  }

  return result
}

/**
 * 标记充值失败
 */
export async function failRecharge(
  orderNo: string,
  failReason: string,
  callbackData?: Record<string, unknown>,
  paymentDetails?: Record<string, unknown>,
  actor?: WriteActor,
  expectedPaymentDetails?: Record<string, unknown> | null
): Promise<RechargeRecord> {
  const { updateResult, record } = await prisma.$transaction(async (tx) => {
    if (actor) await lockAdministrativeUserMutation(tx, actor.id, actor)
    const updateResult = await tx.rechargeRecord.updateMany({
      where: {
        orderNo,
        status: { in: ['pending', 'paid'] },
        ...paymentSelectionCondition(expectedPaymentDetails)
      },
      data: {
        status: 'failed',
        failReason,
        callbackData: callbackData as any,
        callbackAt: new Date(),
        paymentDetails: paymentDetails as any
      }
    })
    if (updateResult.count === 0 && expectedPaymentDetails !== undefined) throw new RechargePaymentSelectionChangedError()

    const record = await tx.rechargeRecord.findUnique({
      where: { orderNo }
    })

    if (!record) {
      throw new Error('订单不存在')
    }
    return { updateResult, record }
  })

  if (updateResult.count > 0) {
    // 用户通知：充值支付失败（fire-and-forget，不阻塞状态流转；仅在本次真正转为 failed 时推送）
    void (async () => {
      try {
        const { sendNotification } = await import('../lib/notifier.js')
        await sendNotification(record.userId, 'recharge_failed', {
          orderNo: record.orderNo,
          amount: Number(record.amount),
          reason: failReason
        })
      } catch (err) {
        console.warn('[Recharge] Failed to send recharge failure notification:', err)
      }
    })()
  }

  return record
}

/**
 * 取消充值订单
 */
export async function cancelRecharge(
  orderNo: string,
  callbackData?: Record<string, unknown>,
  paymentDetails?: Record<string, unknown>,
  expectedPaymentDetails?: Record<string, unknown> | null,
  actor?: WriteActor,
  cancelReason: 'user' | 'provider' | 'timeout' = callbackData ? 'provider' : 'user'
): Promise<RechargeRecord> {
  return prisma.$transaction(async (tx) => {
    if (actor) await lockAdministrativeUserMutation(tx, actor.id, actor)
    const updated = await tx.rechargeRecord.updateMany({
      where: {
        orderNo,
        status: { in: ['pending', 'paid'] },
        ...paymentSelectionCondition(expectedPaymentDetails)
      },
      data: {
        status: 'cancelled',
        cancelReason,
        paymentDetails: paymentDetails as any,
        ...(callbackData
          ? {
              callbackData: callbackData as any,
              callbackAt: new Date()
            }
          : {})
      }
    })
    if (updated.count === 0 && expectedPaymentDetails !== undefined) throw new RechargePaymentSelectionChangedError()

    const record = await tx.rechargeRecord.findUnique({
      where: { orderNo }
    })

    if (!record) {
      throw new Error('订单不存在')
    }

    return record
  })
}

/**
 * 更新订单支付方式
 */
export async function updatePendingRechargePaymentSelection(
  orderNo: string,
  data: UpdateRechargePaymentSelectionInput
): Promise<RechargeRecord | null> {
  const result = await prisma.rechargeRecord.updateMany({
    where: {
      orderNo,
      status: 'pending',
      ...(data.expectedPaymentDetails !== undefined
        ? { paymentDetails: { equals: data.expectedPaymentDetails as any } }
        : {})
    },
    data: {
      paymentMethod: data.paymentMethod || null,
      fee: data.fee,
      actualAmount: data.actualAmount,
      paymentDetails: data.paymentDetails as any,
      ...(data.expiredAt !== undefined ? { expiredAt: data.expiredAt } : {})
    }
  })

  if (result.count === 0) {
    return null
  }

  return prisma.rechargeRecord.findUnique({
    where: { orderNo }
  })
}

// ==================== 过期订单处理 ====================

/**
 * 获取已过期的待处理订单
 */
export async function getExpiredPendingOrders(): Promise<RechargeRecord[]> {
  return prisma.rechargeRecord.findMany({
    where: {
      status: 'pending',
      expiredAt: { lt: new Date() }
    }
  })
}

/**
 * 批量过期订单（标记为取消）
 */
export async function expireOrders(orderNos: string[]): Promise<number> {
  const result = await prisma.rechargeRecord.updateMany({
    where: {
      orderNo: { in: orderNos },
      status: 'pending',
      expiredAt: { lt: new Date() }
    },
    data: {
      status: 'cancelled',
      cancelReason: 'timeout'
    }
  })
  return result.count
}

// ==================== 统计查询 ====================

/**
 * 获取用户充值统计
 */
export async function getUserRechargeStats(userId: number): Promise<{
  totalRecharge: number
  totalCount: number
  pendingCount: number
}> {
  const [totalResult, totalCount, pendingCount] = await Promise.all([
    prisma.$queryRaw<MoneySumRow[]>`
      SELECT COALESCE(SUM(COALESCE(actual_amount, amount)), 0)::numeric AS value
      FROM recharge_records
      WHERE user_id = ${userId}
        AND status = 'completed'
    `,
    prisma.rechargeRecord.count({
      where: { userId, status: 'completed' }
    }),
    prisma.rechargeRecord.count({
      where: { userId, status: 'pending' }
    })
  ])

  return {
    totalRecharge: toMoney(totalResult[0]?.value),
    totalCount,
    pendingCount
  }
}

/**
 * 获取系统充值统计（管理员）
 */
export async function getSystemRechargeStats(dateRange?: { start: Date; end: Date }): Promise<{
  totalRecharge: number
  totalCount: number
  pendingAmount: number
  pendingCount: number
  todayRecharge: number
  todayCount: number
}> {
  // 使用业务时区（Asia/Shanghai）计算日期边界
  const { start: today, end: tomorrow } = getTodayRange()

  const whereCompleted: Record<string, unknown> = { status: 'completed' }
  if (dateRange) {
    whereCompleted.completedAt = { gte: dateRange.start, lte: dateRange.end }
  }

  const [totalResult, totalCount, pendingResult, pendingCount, todayResult, todayCount] = await Promise.all([
    dateRange
      ? prisma.$queryRaw<MoneySumRow[]>`
          SELECT COALESCE(SUM(COALESCE(actual_amount, amount)), 0)::numeric AS value
          FROM recharge_records
          WHERE status = 'completed'
            AND completed_at >= ${dateRange.start}
            AND completed_at <= ${dateRange.end}
        `
      : prisma.$queryRaw<MoneySumRow[]>`
          SELECT COALESCE(SUM(COALESCE(actual_amount, amount)), 0)::numeric AS value
          FROM recharge_records
          WHERE status = 'completed'
        `,
    prisma.rechargeRecord.count({ where: whereCompleted }),
    prisma.rechargeRecord.aggregate({
      where: { status: 'pending' },
      _sum: { amount: true }
    }),
    prisma.rechargeRecord.count({ where: { status: 'pending' } }),
    prisma.$queryRaw<MoneySumRow[]>`
      SELECT COALESCE(SUM(COALESCE(actual_amount, amount)), 0)::numeric AS value
      FROM recharge_records
      WHERE status = 'completed'
        AND completed_at >= ${today}
        AND completed_at < ${tomorrow}
    `,
    prisma.rechargeRecord.count({
      where: { status: 'completed', completedAt: { gte: today, lt: tomorrow } }
    })
  ])

  return {
    totalRecharge: toMoney(totalResult[0]?.value),
    totalCount,
    pendingAmount: pendingResult._sum?.amount !== null && pendingResult._sum?.amount !== undefined
      ? parseFloat(String(pendingResult._sum.amount))
      : 0,
    pendingCount,
    todayRecharge: toMoney(todayResult[0]?.value),
    todayCount
  }
}
