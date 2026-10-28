import { hasPendingSnapshotOperation } from '../db/snapshot-operation-guards.js'
import { INSTANCE_OPERATION_LOCK_NAMESPACE, tryAdvisoryTransactionLock } from '../db/advisory-locks.js'
/**
 * 计费调度器
 * 负责定时执行自动续费、到期封停、到期删除、到期提醒等任务
 */

import { schedule } from 'node-cron'
import pLimit from 'p-limit'
import { randomUUID } from 'node:crypto'
import { prisma } from '../db/prisma.js'
import * as db from '../db/index.js'
import { sendHostManagedInstanceNotification, sendNotification } from '../lib/notifier.js'
import { notifyAdminAutoRenewSummary } from '../lib/admin-alerts.js'
import { 
  sendExpiryReminderEmail, 
  sendAutoRenewSuccessEmail, 
  sendAutoRenewFailedEmail 
} from '../lib/mailer.js'
import { createLog } from '../db/logs.js'
import {
  performRenewal,
  calculateRenewBilling
} from '../db/billing-operations.js'
import { AffCodeBusyError, getInstanceAffBinding } from '../db/aff.js'
import { arbitrateVipPrice, getUserContinuousVipBenefit } from './vip-benefits.js'
import {
  getAutoRenewInstances,
  getExpiredUnsuspendedInstances,
  getSuspendedInstancesOlderThan,
  suspendInstanceByExpiry,
  updateAutoRenewAttempt,
  updateExpiryNotifiedAt
} from '../db/instance-suspend.js'
import { deleteInstance as deleteIncusInstance, getIncusClient } from '../lib/incus/index.js'
import { sendReleaseNotification } from '../lib/release-notifier.js'
import { acquireLock, releaseLock } from '../lib/distributed-lock.js'
import { withInstanceBillingMutation } from '../lib/instance-billing-mutation.js'
import { enforceExpiredStop } from './billing-expiry-enforcement.js'
import { recoveryHeld } from './platform-backup-core.js'
import { isAutoRenewEligible } from '../lib/instance-auto-renew.js'
import { latestExpiryRunRecord, writeExpiryRunRecord } from './expiry-enforcement-history.js'
import { EXPIRY_LOG_RETENTION_DAYS } from '../lib/expiry-enforcement-history.js'

// 并发限制
const limit = pLimit(5)

// 配置常量
const AUTO_RENEW_HOURS_BEFORE = 24 // 到期前24小时尝试自动续费
const AUTO_RENEW_MAX_ATTEMPTS = 3 // 最大自动续费尝试次数
const SUSPEND_AFTER_DELETE_DAYS = 3 // 封停后3天自动删除
const EXPIRY_NOTIFY_DAYS = [3, 2, 1] // 到期前 3/2/1 天各提醒一次
const INSTANCE_BILLING_JOB_LOCK_EXPIRE_MS = 30 * 60 * 1000
const INSTANCE_BILLING_JOB_LOCK_WAIT_MS = 100
let schedulerStarted = false
let autoRenewPromise: Promise<void> | null = null
let expiryEnforcementRunning = false
let expiryEnforcementTask: ReturnType<typeof schedule> | null = null
let expiryStartPromise: Promise<void> | null = null
let expiryLastStartedAt: string | null = null, expiryLastFinishedAt: string | null = null
let expiryFailureCount = 0, expiryLastError: string | null = null
let expiryHistoryError: string | null = null

// 管理员告警：本轮自动续费汇总（每次整点任务开始时清空，结束后按需推送一条）
const autoRenewAlertSummary: {
  successes: Array<{ username: string; instanceName: string; amount: number }>
  failures: Array<{ username: string; instanceName: string; reason: string }>
} = { successes: [], failures: [] }

// 用户侧自动续费结果（每次整点任务开始时清空，结束后按用户聚合推送：成功/失败各至多一条）
const autoRenewUserSuccesses: Array<{
  userId: number
  username: string
  email: string | null
  instanceName: string
  renewMonths: number
  amount: number
  newExpiresAt: Date
}> = []
const autoRenewUserFailures: Array<{
  userId: number
  username: string
  email: string | null
  instanceName: string
  failReason: string
  renewAmount: number | null
  expiresAt: Date
  currentAttempt: number
}> = []

/**
 * 延迟函数
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function withInstanceBillingJobLock(
  purpose: 'auto-renew' | 'expiry-suspend' | 'expiry-delete' | 'expiry-notify',
  instanceId: number,
  fn: () => Promise<void>
): Promise<void> {
  const lockKey = `billing:${purpose}:instance:${instanceId}`
  const lock = await acquireLock(lockKey, {
    expireMs: INSTANCE_BILLING_JOB_LOCK_EXPIRE_MS,
    waitTimeoutMs: INSTANCE_BILLING_JOB_LOCK_WAIT_MS,
    retryIntervalMs: 50
  })

  if (!lock.success || !lock.ownerId) {
    console.log(`[Billing] Skip ${purpose} for instance ${instanceId}: lock not acquired`)
    return
  }

  try {
    if (purpose === 'expiry-suspend' || purpose === 'expiry-delete') await withInstanceBillingMutation(instanceId, async () => { if (!recoveryHeld()) await fn() })
    else await fn()
  } finally {
    await releaseLock(lockKey, lock.ownerId)
  }
}

function buildAutoRenewAttemptGuard(instance: any, now: Date, expiryThreshold: Date) {
  return {
    now,
    expiryThreshold,
    version: instance.version,
    currentAttempts: instance.autoRenewAttempts || 0
  }
}

// ==================== 自动续费任务 ====================

/**
 * 执行自动续费
 */
async function executeAutoRenew(): Promise<void> {
  if (recoveryHeld()) return
  if (autoRenewPromise) return autoRenewPromise
  const running = runAutoRenew()
  autoRenewPromise = running
  try { await running } finally { if (autoRenewPromise === running) autoRenewPromise = null }
}
async function runAutoRenew(): Promise<void> {
  console.log('[Billing] Starting auto-renew job...')
  const startTime = Date.now()
  autoRenewAlertSummary.successes.length = 0
  autoRenewAlertSummary.failures.length = 0
  autoRenewUserSuccesses.length = 0
  autoRenewUserFailures.length = 0

  try {
    // 获取24小时内到期且开启了自动续费的实例
    const instances = await getAutoRenewInstances(AUTO_RENEW_HOURS_BEFORE)

    console.log(`[Billing] Found ${instances.length} instances for auto-renew`)

    // Different instances of one buyer share the same balance advisory lock.
    // Serialize that buyer's renewals instead of spending retries on ourselves.
    const byUser = new Map<number, typeof instances>()
    for (const instance of instances) {
      const group = byUser.get(instance.userId) || []
      group.push(instance); byUser.set(instance.userId, group)
    }
    await Promise.all(
      [...byUser.values()].map(group => limit(async () => {
        for (const instance of group) await withInstanceBillingJobLock('auto-renew', instance.id, () => processAutoRenew(instance))
      }))
    )

    if (autoRenewAlertSummary.successes.length > 0 || autoRenewAlertSummary.failures.length > 0) {
      void notifyAdminAutoRenewSummary({
        successes: [...autoRenewAlertSummary.successes],
        failures: [...autoRenewAlertSummary.failures]
      }).catch(err => console.warn('[Billing] 管理员自动续费告警发送失败:', err))
    }

    await flushAutoRenewUserNotifications()

    const duration = Date.now() - startTime
    console.log(`[Billing] Auto-renew job completed in ${duration}ms`)
  } catch (error) {
    console.error('[Billing] Auto-renew job failed:', error)
    throw error
  }
}

/**
 * 把本轮自动续费的用户通知按用户聚合后发送（站内信/TG/邮件各至多一条）。
 */
async function flushAutoRenewUserNotifications(): Promise<void> {
  const failuresByUser = new Map<number, typeof autoRenewUserFailures>()
  for (const item of autoRenewUserFailures) {
    const list = failuresByUser.get(item.userId)
    if (list) list.push(item)
    else failuresByUser.set(item.userId, [item])
  }
  for (const [userId, items] of failuresByUser) {
    try {
      const first = items[0]
      const failReason = [...new Set(items.map(item => item.failReason))].join('；')
      const knownAmounts = items.map(item => item.renewAmount).filter((value): value is number => value !== null)
      if (items.length === 1) {
        await sendNotification(userId, 'auto_renew_failed', {
          instanceName: first.instanceName,
          failReason: first.failReason,
          ...(first.renewAmount !== null ? { renewAmount: first.renewAmount } : {})
        })
      } else {
        await sendNotification(userId, 'auto_renew_failed', {
          instanceNames: items.map(item => item.instanceName),
          failReason,
          ...(knownAmounts.length > 0 ? { renewAmount: knownAmounts.reduce((sum, value) => sum + value, 0) } : {})
        })
      }
      if (first.email) {
        try {
          await sendAutoRenewFailedEmail(first.email, {
            username: first.username,
            instanceName: first.instanceName,
            failReason,
            currentAttempt: first.currentAttempt,
            maxAttempts: AUTO_RENEW_MAX_ATTEMPTS,
            expiresAt: first.expiresAt,
            aggregateNames: items.length > 1 ? items.map(item => item.instanceName) : undefined
          })
        } catch (emailErr) {
          console.warn('[Billing] Failed to send auto-renew failed email:', emailErr)
        }
      }
      console.log(`[Billing] Sent auto-renew failure notification(s) for user ${userId}: ${items.length} instance(s)`)
    } catch (error) {
      console.error(`[Billing] Failed to send auto-renew failure notifications for user ${userId}:`, error)
    }
  }

  const successesByUser = new Map<number, typeof autoRenewUserSuccesses>()
  for (const item of autoRenewUserSuccesses) {
    const list = successesByUser.get(item.userId)
    if (list) list.push(item)
    else successesByUser.set(item.userId, [item])
  }
  for (const [userId, items] of successesByUser) {
    try {
      const first = items[0]
      const totalAmount = items.reduce((sum, item) => sum + item.amount, 0)
      if (items.length === 1) {
        await sendNotification(userId, 'instance_renewed', {
          instanceName: first.instanceName,
          renewAmount: first.amount,
          renewMonths: first.renewMonths,
          newExpiresAt: first.newExpiresAt.toISOString()
        })
      } else {
        await sendNotification(userId, 'instance_renewed', {
          instanceNames: items.map(item => item.instanceName),
          renewAmount: totalAmount
        })
      }
      if (first.email) {
        try {
          const userAfter = await prisma.user.findUnique({
            where: { id: userId },
            select: { balance: true }
          })
          await sendAutoRenewSuccessEmail(first.email, {
            username: first.username,
            instanceName: first.instanceName,
            amount: totalAmount,
            months: first.renewMonths,
            newExpiresAt: first.newExpiresAt,
            newBalance: Number(userAfter?.balance ?? 0),
            aggregateNames: items.length > 1 ? items.map(item => item.instanceName) : undefined
          })
        } catch (emailErr) {
          console.warn('[Billing] Failed to send auto-renew success email:', emailErr)
        }
      }
      console.log(`[Billing] Sent auto-renew success notification(s) for user ${userId}: ${items.length} instance(s)`)
    } catch (error) {
      console.error(`[Billing] Failed to send auto-renew success notifications for user ${userId}:`, error)
    }
  }
}

/**
 * 处理单个实例的自动续费
 */
export async function processAutoRenew(instance: any): Promise<void> {
  const now = new Date()
  const expiryThreshold = new Date(now.getTime() + AUTO_RENEW_HOURS_BEFORE * 60 * 60 * 1000)
  const latestInstance = await prisma.instance.findUnique({
    where: { id: instance.id }
  })
  if (
    !latestInstance ||
    recoveryHeld() || !isAutoRenewEligible(latestInstance, now, expiryThreshold)
  ) {
    console.log(`[Billing] Skip auto-renew for instance ${instance.id}: no longer eligible`)
    return
  }

  instance = latestInstance
  const pending = { instanceId: instance.id, status: { in: ['PENDING', 'PROCESSING'] as Array<'PENDING' | 'PROCESSING'> } }
  if (await prisma.instanceTask.count({ where: pending }) || await prisma.restoreTask.count({ where: pending }) ||
    await prisma.backupUploadTask.count({ where: pending })) return
  const attempts = (instance.autoRenewAttempts || 0) + 1
  const attemptGuard = buildAutoRenewAttemptGuard(instance, now, expiryThreshold)

  // 检查是否超过最大尝试次数
  if (attempts > AUTO_RENEW_MAX_ATTEMPTS) {
    console.log(`[Billing] Instance ${instance.id} exceeded max auto-renew attempts, disabling`)
    const attemptClaimed = await updateAutoRenewAttempt(instance.id, attempts, true, attemptGuard)
    if (!attemptClaimed) {
      console.log(`[Billing] Skip max-attempt update for instance ${instance.id}: no longer eligible`)
    }
    return
  }

  try {
    // 按原计费周期续费（如季付续3个月）
    const renewMonths = instance.billingCycle || 1
    const renewInfo = calculateRenewBilling(instance, renewMonths)

    // 获取用户信息（包括邮箱）
    const user = await prisma.user.findUnique({
      where: { id: instance.userId },
      select: { balance: true, email: true, username: true }
    })

    if (!user) {
      console.log(`[Billing] User ${instance.userId} not found for instance ${instance.id}`)
      const attemptClaimed = await updateAutoRenewAttempt(instance.id, attempts, false, attemptGuard)
      if (!attemptClaimed) {
        console.log(`[Billing] Skip auto-renew attempt update for instance ${instance.id}: no longer eligible`)
      }
      return
    }

    const balance = Number(user.balance)
    const affBinding = await getInstanceAffBinding(instance.id)
    const vip = await getUserContinuousVipBenefit(instance.userId)
    const renewAmount = arbitrateVipPrice({
      basePrice: renewInfo.amount,
      affDiscountRate: affBinding?.affCode.enabled ? Number(affBinding.affCode.discountRate) : 0,
      vipDiscountPercent: vip.benefit.orderDiscountPercent
    }).finalPrice

    // 余额不足
    if (balance < renewAmount) {
      console.log(`[Billing] Insufficient balance for instance ${instance.id}: need ${renewAmount}, have ${balance}`)
      const attemptClaimed = await updateAutoRenewAttempt(instance.id, attempts, false, attemptGuard)
      if (!attemptClaimed) {
        console.log(`[Billing] Skip auto-renew failure notification for instance ${instance.id}: no longer eligible`)
        return
      }

      // 用户通知（站内信/TG/邮件）延后到本轮结束时按用户聚合发送
      autoRenewUserFailures.push({
        userId: instance.userId,
        username: user.username,
        email: user.email,
        instanceName: instance.name,
        failReason: `余额不足（需要 ¥${renewAmount.toFixed(2)}，当前 ¥${balance.toFixed(2)}）`,
        renewAmount,
        expiresAt: instance.expiresAt,
        currentAttempt: attempts
      })

      if (expiryEnforcementRunning) noteExpiryFailure('EXPIRY_AUTO_RENEW_FAILED')

      await createLog(
        instance.userId,
        'instance',
        'instance.auto_renew_failed',
        `Auto-renew failed for instance "${instance.name}": insufficient balance`,
        'failed',
        { instanceId: instance.id }
      )

      autoRenewAlertSummary.failures.push({
        username: user.username,
        instanceName: instance.name,
        reason: '余额不足'
      })
      return
    }

    // 执行续费
    const result = await performRenewal(instance.userId, instance, renewMonths, { expiryThreshold })

    // 用户通知（站内信/TG/邮件）延后到本轮结束时按用户聚合发送
    autoRenewUserSuccesses.push({
      userId: instance.userId,
      username: user.username,
      email: user.email,
      instanceName: instance.name,
      renewMonths,
      amount: result.amount, // 元（performRenewal 返回的是元）
      newExpiresAt: result.newExpiresAt
    })

    if (result.hostingIncomeResult) {
      sendHostManagedInstanceNotification(
        instance.hostId,
        'renew',
        {
          username: user.username,
          instanceName: instance.name,
          amount: result.amount
        }
      ).catch(err => {
        console.warn('[Billing] Failed to send host renew notification:', err)
      })
    }

    await createLog(
      instance.userId,
      'instance',
      'instance.auto_renew',
      `Auto-renewed instance "${instance.name}" for ${renewMonths} month(s), amount: ${result.amount}`,
      'success',
      { instanceId: instance.id }
    )

    console.log(`[Billing] Auto-renewed instance ${instance.id}`)

    autoRenewAlertSummary.successes.push({
      username: user.username,
      instanceName: instance.name,
      amount: result.amount
    })

  } catch (error) {
    if (recoveryHeld()) return
    if (error instanceof AffCodeBusyError) {
      await createLog(instance.userId, 'instance', 'instance.auto_renew_deferred',
        `Auto-renew deferred for instance "${instance.name}": ${error.message}; retry on the next inspection`,
        'failed', { instanceId: instance.id })
      return
    }
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error(`[Billing] Auto-renew failed for instance ${instance.id}:`, errorMessage)
    const attemptClaimed = await updateAutoRenewAttempt(instance.id, attempts, false, attemptGuard)
    if (!attemptClaimed) {
      console.log(`[Billing] Skip auto-renew failure notification for instance ${instance.id}: no longer eligible`)
      return
    }

    const userForEmail = await prisma.user.findUnique({
      where: { id: instance.userId },
      select: { email: true, username: true }
    })

    // 用户通知（站内信/TG/邮件）延后到本轮结束时按用户聚合发送
    autoRenewUserFailures.push({
      userId: instance.userId,
      username: userForEmail?.username || `用户#${instance.userId}`,
      email: userForEmail?.email || null,
      instanceName: instance.name,
      failReason: errorMessage,
      renewAmount: null,
      expiresAt: instance.expiresAt,
      currentAttempt: attempts
    })

    await createLog(
      instance.userId,
      'instance',
      'instance.auto_renew_failed',
      `Auto-renew failed for instance "${instance.name}": ${errorMessage}`,
      'failed',
      { instanceId: instance.id }
    )
    if (expiryEnforcementRunning) noteExpiryFailure('EXPIRY_AUTO_RENEW_FAILED')

    autoRenewAlertSummary.failures.push({
      username: `用户#${instance.userId}`,
      instanceName: instance.name,
      reason: errorMessage
    })
  }
}

// ==================== 到期封停任务 ====================

/**
 * 执行到期封停
 */
async function executeExpirySuspend(): Promise<void> {
  console.log('[Billing] Starting expiry suspend job...')
  const startTime = Date.now()

  try {
    const renewedSuspensions = await prisma.instance.findMany({ where: { packagePlanId: { not: null },
      status: 'suspended', suspendReason: 'expired', suspendedBy: null, expiresAt: { gt: new Date() } }, select: { id: true } })
    for (const instance of renewedSuspensions) await withInstanceBillingJobLock('expiry-suspend', instance.id, async () => {
      await prisma.instance.updateMany({ where: { id: instance.id, status: 'suspended', suspendReason: 'expired', suspendedBy: null,
        expiresAt: { gt: new Date() } }, data: { status: 'stopped', suspendedAt: null, suspendReason: null, suspendedBy: null, version: { increment: 1 } } })
    })
    // 获取已到期但未封停的实例
    const fresh = await getExpiredUnsuspendedInstances()
    const retry = await prisma.instance.findMany({ where: { packagePlanId: { not: null }, status: 'suspended', suspendReason: 'expired', suspendedBy: null, expiresAt: { lt: new Date() } } })
    const instances = [...new Map([...fresh, ...retry].map(instance => [instance.id, instance])).values()]

    console.log(`[Billing] Found ${instances.length} expired instances to suspend`)

    // 并发处理（先完成封停与停机，通知在本轮末尾按用户聚合发送）
    const suspendedNotifications: Array<{ userId: number; instanceName: string; expiresAt: Date | null }> = []
    await Promise.all(
      instances.map(instance =>
        limit(() => withInstanceBillingJobLock('expiry-suspend', instance.id, async () => {
          const suspended = await processExpirySuspend(instance)
          if (suspended) suspendedNotifications.push(suspended)
        }))
      )
    )

    const suspendedByUser = new Map<number, Array<{ instanceName: string; expiresAt: Date | null }>>()
    for (const item of suspendedNotifications) {
      const list = suspendedByUser.get(item.userId)
      if (list) list.push(item)
      else suspendedByUser.set(item.userId, [item])
    }
    for (const [userId, items] of suspendedByUser) {
      try {
        items.sort((a, b) => (a.expiresAt?.getTime() ?? 0) - (b.expiresAt?.getTime() ?? 0))
        const earliest = items[0]
        if (items.length === 1) {
          await sendNotification(userId, 'instance_expired', {
            instanceName: earliest.instanceName,
            expiredAt: earliest.expiresAt ? earliest.expiresAt.toISOString() : undefined,
            deleteAfterDays: SUSPEND_AFTER_DELETE_DAYS
          })
        } else {
          await sendNotification(userId, 'instance_expired', {
            instanceNames: items.map(item => item.instanceName),
            expiredAt: earliest.expiresAt ? earliest.expiresAt.toISOString() : undefined,
            deleteAfterDays: SUSPEND_AFTER_DELETE_DAYS
          })
        }
        console.log(`[Billing] Sent expiry suspension notification(s) for user ${userId}: ${items.length} instance(s)`)
      } catch (error) {
        console.error(`[Billing] Failed to send expiry suspension notifications for user ${userId}:`, error)
      }
    }

    const duration = Date.now() - startTime
    console.log(`[Billing] Expiry suspension job completed in ${duration}ms`)
  } catch (error) {
    noteExpiryFailure('EXPIRY_SUSPEND_SCAN_FAILED')
    console.error('[Billing] Expiry suspend job failed:', error)
  }
}

/**
 * 处理单个实例的到期封停
 */
async function processExpirySuspend(instance: any): Promise<{ userId: number; instanceName: string; expiresAt: Date | null } | null> {
  try {
    // 封停实例
    const suspendedInstance = await suspendInstanceByExpiry(instance.id)
    if (!suspendedInstance) {
      await stopCurrentExpiredInstance(instance.id)
      console.log(`[Billing] Skip expiry suspend for instance ${instance.id}: no longer expired or already processed`)
      return null
    }

    // 尝试停止 Incus 实例
    let stopPending = false
    try {
      await stopCurrentExpiredInstance(suspendedInstance.id)
    } catch (stopError) {
      stopPending = true
      noteExpiryFailure('EXPIRY_REMOTE_STOP_PENDING')
      // 停止失败不影响封停逻辑
      console.log(`[Billing] Failed to stop Incus instance ${suspendedInstance.incusId}:`, stopError)
    }

    await createLog(
      suspendedInstance.userId,
      'instance',
      'instance.suspended_expired',
      stopPending ? `Instance "${suspendedInstance.name}" suspended due to expiry; host stop pending verification` : `Instance "${suspendedInstance.name}" suspended due to expiry`,
      stopPending ? 'warning' : 'success',
      { instanceId: suspendedInstance.id }
    )

    console.log(`[Billing] Suspended expired instance ${suspendedInstance.id}`)

    // 用户通知延后到本轮结束时按用户聚合发送
    return {
      userId: suspendedInstance.userId,
      instanceName: suspendedInstance.name,
      expiresAt: suspendedInstance.expiresAt
    }

  } catch (error) {
    noteExpiryFailure('EXPIRY_REMOTE_STOP_PENDING')
    console.error(`[Billing] Failed to suspend instance ${instance.id}:`, error)
    return null
  }
}

async function stopCurrentExpiredInstance(instanceId: number) {
  if (await hasPendingSnapshotOperation(instanceId)) return
  const pending = { instanceId, status: { in: ['PENDING', 'PROCESSING'] as Array<'PENDING' | 'PROCESSING'> } }
  if (await prisma.instanceTask.count({ where: pending }) || await prisma.restoreTask.count({ where: pending }) ||
    await prisma.backupUploadTask.count({ where: pending })) return
  const { getInstanceState, stopInstance } = await import('../lib/incus/index.js')
  const result = await enforceExpiredStop({
    load: () => prisma.instance.findUnique({ where: { id: instanceId } }),
    state: async instance => {
      const host = await db.getHostById(instance.hostId)
      if (!host) throw new Error('EXPIRY_HOST_UNAVAILABLE')
      return await getInstanceState(await getIncusClient(host), instance.incusId) as { status?: string }
    },
    stop: async instance => {
      const host = await db.getHostById(instance.hostId)
      if (!host) throw new Error('EXPIRY_HOST_UNAVAILABLE')
      await stopInstance(await getIncusClient(host), instance.incusId, true)
    }
  })
  if (result === 'stopped') {
    const instance = await prisma.instance.findUnique({ where: { id: instanceId }, select: { userId: true } })
    if (instance) await createLog(instance.userId, 'instance', 'instance.expiry_stop_reconciled',
      'Expired instance stop verified after retry', 'success', { instanceId })
  }
}

// ==================== 到期删除任务 ====================

/**
 * 执行到期删除（封停超过3天的实例）
 */
async function executeExpiryDelete(): Promise<void> {
  console.log('[Billing] Starting expiry delete job...')
  const startTime = Date.now()

  try {
    // 获取封停超过3天的实例（仅限到期封停的）
    const instances = await getSuspendedInstancesOlderThan(SUSPEND_AFTER_DELETE_DAYS)

    // 过滤出到期封停的（非手动封停）
    const expiredInstances = instances.filter(i => i.suspendReason === 'expired')
    const cleanup = await prisma.instance.findMany({ where: {
      status: 'deleted', suspendReason: 'expired', suspendedBy: null, deletionBillingPending: true,
      instanceTasks: { none: { status: { in: ['PENDING', 'PROCESSING'] } } }
    } })

    console.log(`[Billing] Found ${expiredInstances.length} expired instances to delete`)

    // 串行处理删除（避免并发问题）
    for (const instance of [...expiredInstances, ...cleanup]) {
      await withInstanceBillingJobLock('expiry-delete', instance.id, () => processExpiryDelete(instance))
      await delay(1000) // 间隔1秒
    }

    const duration = Date.now() - startTime
    console.log(`[Billing] Expiry delete job completed in ${duration}ms`)
  } catch (error) {
    noteExpiryFailure('EXPIRY_DELETE_SCAN_FAILED')
    console.error('[Billing] Expiry delete job failed:', error)
  }
}

/**
 * 处理单个实例的到期删除
 */
async function processExpiryDelete(instance: any): Promise<void> {
  try {
    const latest = await prisma.instance.findUnique({ where: { id: instance.id } })
    if (!latest || latest.suspendReason !== 'expired' || latest.suspendedBy !== null || !latest.packagePlanId || !latest.expiresAt || latest.expiresAt >= new Date()) return
    const resumingCleanup = latest.status === 'deleted' && latest.deletionBillingPending && latest.suspendedBy === null
    if (latest.status !== 'suspended' && !resumingCleanup) return
    // A missed renewal may still be waiting for its next bounded retry. Stop
    // enforcement remains active, but preserve the disk until retries finish.
    if (!resumingCleanup && latest.autoRenew && latest.autoRenewAttempts < AUTO_RENEW_MAX_ATTEMPTS) return
    instance = latest
    const deleteThreshold = new Date()
    deleteThreshold.setDate(deleteThreshold.getDate() - SUSPEND_AFTER_DELETE_DAYS)
    if (!instance.suspendedAt || instance.suspendedAt >= deleteThreshold) return
    const pending = { instanceId: instance.id, status: { in: ['PENDING', 'PROCESSING'] as Array<'PENDING' | 'PROCESSING'> } }
    if (await prisma.instanceTask.count({ where: pending }) || await prisma.restoreTask.count({ where: pending }) ||
      await prisma.backupUploadTask.count({ where: pending })) return

    const host = await db.getHostById(instance.hostId)
    if (!host) { noteExpiryFailure('EXPIRY_HOST_UNAVAILABLE'); return }
    const client = await getIncusClient(host)
    // Establish contact before claiming deletion, so temporary DNS outages do
    // not block a user from renewing an intact instance.
    if (!resumingCleanup) {
      const present = await client.request<unknown>('GET', '/1.0/instances')
      if (!Array.isArray(present) || present.some(name => typeof name !== 'string' || !name.startsWith('/1.0/instances/'))) throw new Error('EXPIRY_REMOTE_STATE_UNKNOWN')
      if (present.includes('/1.0/instances/' + instance.incusId)) await stopCurrentExpiredInstance(instance.id)
    }

    const claimResult = await prisma.$transaction(async tx => {
      if (!await tryAdvisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, instance.id)) return { count: 0 }
      await tx.$queryRaw`SELECT id FROM instances WHERE id = ${instance.id} FOR UPDATE`
      if (await hasPendingSnapshotOperation(instance.id, tx)) return { count: 0 }
      return resumingCleanup ? { count: 1 } : await tx.instance.updateMany({
      where: {
        id: instance.id,
        version: instance.version,
        status: 'suspended',
        suspendReason: 'expired',
        packagePlanId: { not: null }, expiresAt: { lt: new Date() },
        suspendedBy: null,
        suspendedAt: {
          not: null,
          lt: deleteThreshold
        }
      },
      data: {
        status: 'deleted',
        deletionBillingPending: true,
        version: { increment: 1 }
      }
    })

    })

    if (claimResult.count === 0) {
      console.log(`[Billing] Skip expiry delete for instance ${instance.id}: no longer eligible or already processed`)
      return
    }

    try {
      await deleteIncusInstance(client, instance.incusId)
      const names = await client.request<unknown>('GET', '/1.0/instances')
      if (!Array.isArray(names) || names.some(name => typeof name !== 'string' || !name.startsWith('/1.0/instances/')) ||
        names.includes('/1.0/instances/' + instance.incusId)) throw new Error('EXPIRY_DELETE_NOT_VERIFIED')
    } catch (incusError) {
      // DELETE may already have been accepted remotely. Keep occupied pending
      // cleanup instead of resurrecting a possibly destroyed instance.
      noteExpiryFailure('EXPIRY_REMOTE_DELETE_PENDING')
      console.log(`[Billing] Failed to delete Incus instance ${instance.incusId}, pending reconciliation:`, incusError)
      return
    }

    const portMappingsCount = await prisma.portMapping.count({
      where: { instanceId: instance.id }
    })

    // Finalize allocations, counters and occupied-host marker in one transaction.
    // Recomputing rather than decrementing makes cleanup retries idempotent.
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM hosts WHERE id=${instance.hostId} FOR UPDATE`
      const current = await tx.instance.findUnique({ where: { id: instance.id } })
      if (!current || current.status !== 'deleted' || !current.deletionBillingPending || current.version !== instance.version + (resumingCleanup ? 0 : 1)) throw new Error('EXPIRY_DELETE_STATE_CHANGED')
      await tx.portMapping.deleteMany({ where: { instanceId: instance.id } })
      await tx.ipAddress.deleteMany({ where: { instanceId: instance.id } })
      await tx.ipv6Subnet.deleteMany({ where: { instanceId: instance.id } })
      await db.releasePublicIpv4ForInstance(tx, instance.id)
      const allocated = { hostId: instance.hostId, id: { not: instance.id }, OR: [
        { status: { not: 'deleted' as const } }, { deletionBillingPending: true }, { provisioningCleanupPending: true }
      ] }
      const usedResources = await tx.instance.aggregate({ where: allocated, _sum: { cpu: true, memory: true, disk: true } })
      const actualPortsUsed = await tx.portMapping.count({ where: { instance: allocated } })
      await tx.host.update({ where: { id: instance.hostId }, data: {
        cpuUsed: usedResources._sum.cpu || 0, memoryUsed: usedResources._sum.memory || 0,
        diskUsed: usedResources._sum.disk || 0, natPortsUsedCount: actualPortsUsed
      } })
      await tx.instance.update({ where: { id: instance.id }, data: { deletionBillingPending: false } })
    }, { maxWait: 5000, timeout: 10000 })
    console.log(`[Billing] Expiry deletion finalized; released ${portMappingsCount} port mapping(s)`)

    // 发送删除通知
    await sendNotification(instance.userId, 'instance_deleted', {
      instanceName: instance.name
    })

    await createLog(
      instance.userId,
      'instance',
      'instance.deleted_expired',
      `Instance "${instance.name}" automatically deleted after ${SUSPEND_AFTER_DELETE_DAYS} days of suspension`,
      'success'
    )

    console.log(`[Billing] Deleted expired instance ${instance.id}`)

    // 向套餐绑定的通知渠道发送"资源释放"通知
    if (instance.packageId) {
      sendReleaseNotification({
        packageId: instance.packageId,
        cpu: instance.cpu,
        memory: instance.memory,
        source: '实例过期自动删除'
      }).catch(() => {})
    }

  } catch (error) {
    noteExpiryFailure('EXPIRY_DELETE_RECONCILIATION_PENDING')
    console.error(`[Billing] Failed to delete instance ${instance.id}:`, error)
  }
}

// ==================== 到期提醒任务 ====================

/**
 * 执行到期提醒（邮件）
 */
async function executeExpiryNotify(): Promise<void> {
  console.log('[Billing] Starting expiry notify job...')
  const startTime = Date.now()

  try {
    // 对每个提醒时间点检查（天数）
    for (const days of EXPIRY_NOTIFY_DAYS) {
      await notifyExpiringInstances(days)
    }

    const duration = Date.now() - startTime
    console.log(`[Billing] Expiry notify job completed in ${duration}ms`)
  } catch (error) {
    console.error('[Billing] Expiry notify job failed:', error)
  }
}

/**
 * 通知指定天数内到期的实例（发送邮件）
 */
async function notifyExpiringInstances(days: number): Promise<void> {
  const now = new Date()
  // 计算天数范围（前后12小时窗口）
  const minThreshold = new Date(now.getTime() + (days * 24 - 12) * 60 * 60 * 1000)
  const maxThreshold = new Date(now.getTime() + (days * 24 + 12) * 60 * 60 * 1000)

  // 查询在指定时间窗口内到期的实例
  const instances = await prisma.instance.findMany({
    where: {
      expiresAt: {
        gte: minThreshold,
        lt: maxThreshold
      },
      autoRenew: false,
      status: { notIn: ['suspended', 'deleted'] },
      // 在过去24小时内没有发送过通知
      OR: [
        { expiryNotifiedAt: null },
        { expiryNotifiedAt: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) } }
      ]
    },
    include: {
      user: {
        select: { email: true, username: true }
      }
    }
  })

  console.log(`[Billing] Found ${instances.length} instances expiring in ${days} days`)

  const claimedExpiryNotifications: Array<{
    userId: number
    email: string | null
    username: string
    instanceName: string
    expiresAt: Date
  }> = []

  // 并发领取本轮到期提醒（先原子领取，再在函数尾部按用户聚合发送）
  await Promise.all(
    instances.map(instance =>
      limit(() => withInstanceBillingJobLock('expiry-notify', instance.id, async () => {
        try {
          const latest = await prisma.instance.findUnique({
            where: { id: instance.id },
            select: {
              expiryNotifiedAt: true,
              expiresAt: true,
              autoRenew: true,
              status: true
            }
          })
          const recentNotificationCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)
          if (
            !latest ||
            latest.autoRenew ||
            !latest.expiresAt ||
            latest.expiresAt < minThreshold ||
            latest.expiresAt >= maxThreshold ||
            latest.status === 'suspended' ||
            latest.status === 'deleted'
          ) {
            console.log(`[Billing] Skip expiry notification for instance ${instance.id}: no longer eligible`)
            return
          }

          if (latest?.expiryNotifiedAt && latest.expiryNotifiedAt >= recentNotificationCutoff) {
            console.log(`[Billing] Skip expiry notification for instance ${instance.id}: already notified`)
            return
          }

          const notificationClaimed = await updateExpiryNotifiedAt(instance.id, {
            minExpiresAt: minThreshold,
            maxExpiresAt: maxThreshold,
            recentNotificationCutoff
          })
          if (!notificationClaimed) {
            console.log(`[Billing] Skip expiry notification for instance ${instance.id}: notification already claimed or no longer eligible`)
            return
          }

          claimedExpiryNotifications.push({
            userId: instance.userId,
            email: instance.user?.email || null,
            username: instance.user?.username || '',
            instanceName: instance.name,
            expiresAt: latest.expiresAt
          })

          console.log(`[Billing] Claimed expiry notification for instance ${instance.id}`)
        } catch (error) {
          console.error(`[Billing] Failed to notify instance ${instance.id}:`, error)
        }
      }))
    )
  )

  // 按用户聚合发送：同一用户本轮多台到期提醒合并为一条（单台保持原文案与邮件）
  const claimedByUser = new Map<number, typeof claimedExpiryNotifications>()
  for (const item of claimedExpiryNotifications) {
    const list = claimedByUser.get(item.userId)
    if (list) list.push(item)
    else claimedByUser.set(item.userId, [item])
  }

  for (const [userId, items] of claimedByUser) {
    try {
      items.sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime())
      const earliest = items[0]

      if (items.length === 1) {
        await sendNotification(userId, 'instance_expiring', {
          instanceName: earliest.instanceName,
          daysRemaining: days,
          newExpiresAt: earliest.expiresAt.toISOString()
        })
      } else {
        await sendNotification(userId, 'instance_expiring', {
          instanceNames: items.map(item => item.instanceName),
          daysRemaining: days,
          newExpiresAt: earliest.expiresAt.toISOString()
        })
      }

      if (earliest.email) {
        try {
          await sendExpiryReminderEmail(earliest.email, {
            username: earliest.username,
            instanceName: earliest.instanceName,
            daysRemaining: days,
            expiresAt: earliest.expiresAt,
            aggregateNames: items.length > 1 ? items.map(item => item.instanceName) : undefined
          })
        } catch (emailErr) {
          console.warn(`[Billing] Failed to send expiry email for user ${userId}:`, emailErr)
        }
      }

      console.log(`[Billing] Sent expiry notification(s) for user ${userId}: ${items.length} instance(s)`)
    } catch (error) {
      console.error(`[Billing] Failed to send expiry notifications for user ${userId}:`, error)
    }
  }
}

// ==================== 充值订单清理任务 ====================

/**
 * 清理过期的充值订单（pending状态且已过期）
 * 每小时执行，将过期订单标记为 cancelled
 */
async function cleanExpiredRechargeOrders(): Promise<void> {
  console.log('[Billing] Starting expired recharge orders cleanup job...')
  const startTime = Date.now()

  try {
    // 过期后再保留一段宽限期才取消，避免把“网关侧已付款、但回调迟到”的订单提前取消导致无法入账。
    // 回调侧已不再因本地过期而丢弃，只要订单仍处于可入账状态，迟到的有效回调即可完成入账。
    const CANCEL_GRACE_MS = 6 * 60 * 60 * 1000 // 6 小时
    const result = await prisma.rechargeRecord.updateMany({
      where: {
        status: 'pending',
        expiredAt: { lt: new Date(Date.now() - CANCEL_GRACE_MS) }
      },
      data: {
        status: 'cancelled'
      }
    })

    const duration = Date.now() - startTime
    if (result.count > 0) {
      console.log(`[Billing] Cancelled ${result.count} expired recharge orders in ${duration}ms`)
    }
  } catch (error) {
    console.error('[Billing] Expired recharge orders cleanup failed:', error)
  }
}

/**
 * 清理旧的支付回调防重放记录（30天前）
 * 每天执行，避免数据无限增长
 */
async function cleanOldPaymentCallbacks(): Promise<void> {
  console.log('[Billing] Starting old payment callbacks cleanup job...')
  const startTime = Date.now()

  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const result = await prisma.paymentCallback.deleteMany({
      where: {
        createdAt: { lt: thirtyDaysAgo }
      }
    })

    const duration = Date.now() - startTime
    if (result.count > 0) {
      console.log(`[Billing] Deleted ${result.count} old payment callback records in ${duration}ms`)
    }
  } catch (error) {
    console.error('[Billing] Old payment callbacks cleanup failed:', error)
  }
}

// ==================== 调度器入口 ====================

export async function executeExpiryEnforcement(): Promise<void> {
  if (expiryEnforcementRunning || recoveryHeld()) return
  expiryEnforcementRunning = true
  expiryLastStartedAt = new Date().toISOString(); expiryFailureCount = 0; expiryLastError = null
  expiryHistoryError = null
  const runId = randomUUID(), startedAt = expiryLastStartedAt
  const persist = async (finishedAt: string | null) => {
    try { await writeExpiryRunRecord({ schemaVersion: 1, runId, startedAt, finishedAt,
      failureCount: expiryFailureCount, lastError: expiryLastError }) }
    catch { expiryHistoryError = 'EXPIRY_LOG_WRITE_FAILED'; console.error('[Billing] Expiry run history write failed') }
  }
  await persist(null)
  try {
    // Catch missed renewals before stopping or deleting the restored inventory.
    try { await executeAutoRenew() } catch { noteExpiryFailure('EXPIRY_AUTO_RENEW_SCAN_FAILED'); return }
    if (recoveryHeld()) return
    await executeExpirySuspend()
    await executeExpiryDelete()
  } finally {
    expiryLastFinishedAt = new Date().toISOString()
    await persist(expiryLastFinishedAt)
    expiryEnforcementRunning = false
  }
}

function noteExpiryFailure(code: string) { expiryFailureCount++; expiryLastError = code }
export async function getExpiryEnforcementStatus() {
  const task = expiryEnforcementTask
  const state = task ? await task.getStatus() : 'stopped'
  const saved = !expiryLastStartedAt ? await latestExpiryRunRecord().catch(() => null) : null
  const interrupted = saved && !saved.finishedAt
  return { enabled: !!task && !['stopped', 'destroyed'].includes(state), running: expiryEnforcementRunning,
    intervalMinutes: 5, retentionDays: SUSPEND_AFTER_DELETE_DAYS, logRetentionDays: EXPIRY_LOG_RETENTION_DAYS,
    historyError: expiryHistoryError, lastStartedAt: expiryLastStartedAt || saved?.startedAt || null,
    lastFinishedAt: expiryLastFinishedAt || saved?.finishedAt || null, nextRunAt: task?.getNextRun()?.toISOString() || null,
    failureCount: expiryLastStartedAt ? expiryFailureCount : interrupted ? Math.max(1, saved.failureCount) : saved?.failureCount || 0,
    lastError: expiryLastStartedAt ? expiryLastError : interrupted ? 'EXPIRY_RUN_INTERRUPTED' : saved?.lastError || null, recoveryHeld: recoveryHeld() }
}
export async function startExpiryEnforcement() {
  if (recoveryHeld()) throw new Error('EXPIRY_RECOVERY_HELD')
  if (!expiryStartPromise) {
    expiryStartPromise = (async () => {
      const status = await getExpiryEnforcementStatus()
      if (status.enabled) return
      if (expiryEnforcementTask && await expiryEnforcementTask.getStatus() !== 'destroyed') await expiryEnforcementTask.start()
      else expiryEnforcementTask = schedule('*/5 * * * *', async () => { await executeExpiryEnforcement() }, { noOverlap: true, name: 'instance-expiry-enforcement' })
    })()
  }
  const starting = expiryStartPromise
  try { await starting } finally { if (expiryStartPromise === starting) expiryStartPromise = null }
  return getExpiryEnforcementStatus()
}

/**
 * 启动计费调度器
 */
export function startBillingScheduler(): void {
  if (schedulerStarted) {
    return
  }

  schedulerStarted = true

  // 每小时检查自动续费（整点）
  schedule('0 * * * *', () => {
    executeAutoRenew().catch(console.error)
  })

  // Retry expiry actions after gateway reconnect; keep the existing 3-day grace.
  void startExpiryEnforcement().catch(console.error)

  // 每小时检查到期提醒
  schedule('15 * * * *', () => {
    executeExpiryNotify().catch(console.error)
  })

  // 每小时清理过期的充值订单（在 :30 执行）
  schedule('30 * * * *', () => {
    cleanExpiredRechargeOrders().catch(console.error)
  })

  // 每天凌晨 4:30 清理旧的支付回调防重放记录（30天前）
  schedule('30 4 * * *', () => {
    cleanOldPaymentCallbacks().catch(console.error)
  })

  console.log('[Billing] Scheduler started')
  console.log('[Billing] - Auto-renew: hourly at :00 (24h before expiry, max 3 attempts)')
  console.log('[Billing] - Expiry enforcement: every 5 minutes; stop retries and deletion after 3 suspended days')
  console.log('[Billing] - Expiry reminders: hourly at :15 (T-3/T-2/T-1, aggregated per user, auto-renew instances skipped)')
  console.log('[Billing] - Expired recharge cleanup: hourly at :30')
  console.log('[Billing] - Payment callback cleanup: daily at 04:30')
}

/**
 * 手动运行所有计费任务（用于测试）
 */
export async function runAllBillingJobs(): Promise<void> {
  await executeAutoRenew()
  await executeExpirySuspend()
  await executeExpiryDelete()
  await executeExpiryNotify()
}

// 导出单独的任务函数（用于测试）
export {
  executeAutoRenew,
  executeExpirySuspend,
  executeExpiryDelete,
  executeExpiryNotify,
  cleanExpiredRechargeOrders,
  cleanOldPaymentCallbacks
}
