import { Prisma } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { changeBalanceInTransaction } from '../db/balance.js'
import { tryAdvisoryTransactionLock, USER_BALANCE_LOCK_NAMESPACE } from '../db/advisory-locks.js'
import { withInstanceBillingMutation } from '../lib/instance-billing-mutation.js'
import { gatewayTaskHash, GatewayTaskError } from '../lib/gateway-task-plan.js'
import { authorizeGatewayAdministration } from './gateway-admin-authorization.js'
import { BackupError, ensure, validateId } from './platform-backup-core.js'
import { readRecoveryHold } from './platform-recovery-review.js'

export interface RecoveryCorrection {
  id: string; holdTaskId: string; userId: number; reference: string; observedAt: string
  expectedBalance: string; targetBalance: string; expectedLatestLogId: number | null
  instances: Array<{ id: number; expectedVersion: number; expectedExpiresAt: string; targetExpiresAt: string }>
  recharges: Array<{ id: number; orderNo: string; expectedStatus: 'pending' | 'paid' | 'cancelled'; expectedAmount: string }>
}
function object(value: unknown, keys: string[]) {
  ensure(value && typeof value === 'object' && !Array.isArray(value), 'OSS_RECONCILIATION_INVALID')
  const row = value as Record<string, unknown>
  ensure(Object.keys(row).length === keys.length && keys.every(key => Object.hasOwn(row, key)), 'OSS_RECONCILIATION_INVALID')
  return row
}
function positiveId(value: unknown): number {
  ensure(Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= 2147483647, 'OSS_RECONCILIATION_INVALID')
  return Number(value)
}
function money(value: unknown): string {
  ensure(typeof value === 'string' && /^(?:0|[1-9][0-9]{0,7})\.[0-9]{2}$/.test(value), 'OSS_RECONCILIATION_INVALID')
  return value
}
function timestamp(value: unknown): string {
  ensure(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value, 'OSS_RECONCILIATION_INVALID')
  return value
}
export function normalizeRecoveryCorrection(value: unknown): RecoveryCorrection {
  const row = object(value, ['id', 'holdTaskId', 'userId', 'reference', 'observedAt', 'expectedBalance', 'targetBalance', 'expectedLatestLogId', 'instances', 'recharges'])
  validateId(row.id); validateId(row.holdTaskId)
  ensure(typeof row.reference === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:/-]{5,119}$/.test(row.reference), 'OSS_RECONCILIATION_INVALID')
  if (row.expectedLatestLogId !== null) positiveId(row.expectedLatestLogId)
  ensure(Array.isArray(row.instances) && Array.isArray(row.recharges) && row.instances.length <= 20 && row.recharges.length <= 20, 'OSS_RECONCILIATION_INVALID')
  const instances = row.instances.map(value => {
    const item = object(value, ['id', 'expectedVersion', 'expectedExpiresAt', 'targetExpiresAt'])
    ensure(Number.isSafeInteger(item.expectedVersion) && Number(item.expectedVersion) >= 0 && Number(item.expectedVersion) < 2147483647, 'OSS_RECONCILIATION_INVALID')
    const expectedExpiresAt = timestamp(item.expectedExpiresAt), targetExpiresAt = timestamp(item.targetExpiresAt)
    // This first correction flow restores a proven extension; shortening or making a paid instance free is not accepted.
    ensure(Date.parse(targetExpiresAt) > Date.parse(expectedExpiresAt), 'OSS_RECONCILIATION_INVALID')
    return { id: positiveId(item.id), expectedVersion: Number(item.expectedVersion), expectedExpiresAt, targetExpiresAt }
  }).sort((a, b) => a.id - b.id)
  const recharges = row.recharges.map(value => {
    const item = object(value, ['id', 'orderNo', 'expectedStatus', 'expectedAmount'])
    ensure(typeof item.orderNo === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(item.orderNo) &&
      ['pending', 'paid', 'cancelled'].includes(String(item.expectedStatus)), 'OSS_RECONCILIATION_INVALID')
    const expectedAmount = money(item.expectedAmount)
    ensure(new Prisma.Decimal(expectedAmount).greaterThan(0), 'OSS_RECONCILIATION_INVALID')
    return { id: positiveId(item.id), orderNo: item.orderNo, expectedStatus: item.expectedStatus as 'pending' | 'paid' | 'cancelled', expectedAmount }
  }).sort((a, b) => a.id - b.id)
  ensure(new Set(instances.map(item => item.id)).size === instances.length && new Set(recharges.map(item => item.id)).size === recharges.length, 'OSS_RECONCILIATION_INVALID')
  const expectedBalance = money(row.expectedBalance), targetBalance = money(row.targetBalance)
  ensure(instances.length || recharges.length || expectedBalance !== targetBalance, 'OSS_RECONCILIATION_EMPTY')
  return { id: row.id as string, holdTaskId: row.holdTaskId as string, userId: positiveId(row.userId), reference: row.reference,
    observedAt: timestamp(row.observedAt), expectedBalance, targetBalance, expectedLatestLogId: row.expectedLatestLogId as number | null, instances, recharges }
}

async function reauthenticate(tx: Prisma.TransactionClient, actorId: number, credentials: { password: string; totpCode?: string }) {
  // Serialize MFA use and prevent credentials/role/status changing during this commit.
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${actorId} FOR UPDATE`
  try { await authorizeGatewayAdministration(tx, actorId, credentials) }
  catch (error) {
    if (!(error instanceof GatewayTaskError)) throw error
    const code = error.code.replace(/^GATEWAY_TASK_/, 'OSS_RECONCILIATION_')
    throw new BackupError(code, error.code.endsWith('LOCKED') ? 429 : 403)
  }
}
async function instanceLanes<T>(ids: number[], action: () => Promise<T>): Promise<T> {
  return ids.length ? withInstanceBillingMutation(ids[0], () => instanceLanes(ids.slice(1), action)) : action()
}

// Call only inside serializeBackupMutation after the restricted Web-session checks.
// All changes and their evidence journal commit together. No remote operations,
// worker activation, host quarantine release, or external payment calls happen here.
export async function reconcileRecovery(input: RecoveryCorrection, actorId: number, credentials: { password: string; totpCode?: string }) {
  const correction = normalizeRecoveryCorrection(input), hold = await readRecoveryHold()
  ensure(hold.taskId === correction.holdTaskId && hold.mode === 'restore' && hold.snapshot, 'OSS_RECONCILIATION_CONTEXT_CHANGED', 409)
  ensure(Date.parse(correction.observedAt) > Date.parse(hold.snapshot.createdAt) && Date.parse(correction.observedAt) <= Date.now(), 'OSS_RECONCILIATION_EVIDENCE_TIME')
  for (const item of correction.instances) ensure(Date.parse(item.targetExpiresAt) <= Date.now() + 10 * 366 * 86400000, 'OSS_RECONCILIATION_INVALID')
  const hash = gatewayTaskHash(correction)
  return instanceLanes(correction.instances.map(item => item.id), () => prisma.$transaction(async tx => {
    await reauthenticate(tx, actorId, credentials)
    ensure(await tryAdvisoryTransactionLock(tx, USER_BALANCE_LOCK_NAMESPACE, correction.userId), 'OSS_RECONCILIATION_BUSY', 409)
    ensure((await readRecoveryHold()).taskId === hold.taskId, 'OSS_RECONCILIATION_CONTEXT_CHANGED', 409)
    const prior = await tx.platformRecoveryReconciliation.findFirst({ where: { OR: [{ id: correction.id },
      { holdTaskId: hold.taskId, userId: correction.userId, reference: correction.reference }] } })
    if (prior) {
      ensure(prior.holdTaskId === hold.taskId && prior.userId === correction.userId && prior.payloadHash === hash, 'OSS_RECONCILIATION_CONFLICT', 409)
      return { id: prior.id, createdAt: prior.createdAt.toISOString(), replayed: true, result: prior.result }
    }
    const user = await tx.user.findUnique({ where: { id: correction.userId }, select: { balance: true } })
    const latest = await tx.balanceLog.findFirst({ where: { userId: correction.userId }, orderBy: { id: 'desc' }, select: { id: true } })
    ensure(user && user.balance.toFixed(2) === correction.expectedBalance && (latest?.id || null) === correction.expectedLatestLogId, 'OSS_RECONCILIATION_STALE', 409)
    for (const item of correction.instances) {
      const instance = await tx.instance.findUnique({ where: { id: item.id }, select: { userId: true, version: true, expiresAt: true,
        status: true, packagePlanId: true, deletionBillingPending: true, provisioningCleanupPending: true,
        instanceTasks: { where: { status: { in: ['PENDING', 'PROCESSING'] } }, select: { id: true }, take: 1 } } })
      ensure(instance && instance.userId === correction.userId && instance.version === item.expectedVersion &&
        instance.expiresAt?.toISOString() === item.expectedExpiresAt && instance.packagePlanId !== null &&
        ['running', 'stopped', 'suspended'].includes(instance.status) && !instance.deletionBillingPending && !instance.provisioningCleanupPending &&
        !instance.instanceTasks.length, 'OSS_RECONCILIATION_STALE', 409)
    }
    const rechargeRows = []
    for (const item of correction.recharges) {
      const recharge = await tx.rechargeRecord.findUnique({ where: { id: item.id }, select: { id: true, userId: true, orderNo: true, amount: true, status: true } })
      ensure(recharge && recharge.userId === correction.userId && recharge.orderNo === item.orderNo && recharge.status === item.expectedStatus &&
        recharge.amount.toFixed(2) === item.expectedAmount && !await tx.balanceLog.count({ where: { orderId: item.orderNo, type: 'recharge' } }), 'OSS_RECONCILIATION_STALE', 409)
      rechargeRows.push(recharge)
    }
    const rechargeTotal = rechargeRows.reduce((sum, row) => sum.plus(row.amount), new Prisma.Decimal(0))
    const remainingAdjustment = new Prisma.Decimal(correction.targetBalance).minus(user.balance).minus(rechargeTotal)
    ensure(rechargeTotal.lessThanOrEqualTo('99999999.99') && remainingAdjustment.abs().lessThanOrEqualTo('99999999.99'), 'OSS_RECONCILIATION_AMOUNT_LIMIT')
    ensure(!remainingAdjustment.isNegative() || user.balance.plus(remainingAdjustment).greaterThanOrEqualTo(0) ||
      user.balance.plus(rechargeTotal).lessThanOrEqualTo('99999999.99'), 'OSS_RECONCILIATION_AMOUNT_LIMIT')
    // Balance corrections use the existing money lock and normal ledger writer.
    // Apply a negative remainder first to avoid temporary overflow on a net correction.
    const remark = `OSS recovery ${hold.taskId}; evidence ${correction.reference}`
    const logs: number[] = []
    async function adjustment() {
      if (remainingAdjustment.isZero()) return
      const value = await changeBalanceInTransaction(tx, { userId: correction.userId, type: 'admin_adjust', amount: remainingAdjustment.toNumber(), remark })
      logs.push(value.balanceLog.id)
    }
    if (remainingAdjustment.isNegative() && user.balance.plus(remainingAdjustment).greaterThanOrEqualTo(0)) await adjustment()
    for (const recharge of rechargeRows) {
      const claimed = await tx.rechargeRecord.updateMany({ where: { id: recharge.id, status: recharge.status }, data: { status: 'completed', completedAt: new Date(correction.observedAt) } })
      ensure(claimed.count === 1, 'OSS_RECONCILIATION_STALE', 409)
      const value = await changeBalanceInTransaction(tx, { userId: correction.userId, type: 'recharge', amount: recharge.amount.toNumber(), orderId: recharge.orderNo, remark })
      logs.push(value.balanceLog.id)
    }
    if (!remainingAdjustment.isNegative() || user.balance.plus(remainingAdjustment).lessThan(0)) await adjustment()
    const updatedInstances = []
    for (const item of correction.instances) {
      const changed = await tx.instance.updateMany({ where: { id: item.id, userId: correction.userId, version: item.expectedVersion, expiresAt: new Date(item.expectedExpiresAt) },
        data: { expiresAt: new Date(item.targetExpiresAt), version: { increment: 1 }, expiryNotifiedAt: null, autoRenewAttempts: 0, lastAutoRenewAttemptAt: null } })
      ensure(changed.count === 1, 'OSS_RECONCILIATION_STALE', 409)
      updatedInstances.push({ id: item.id, expiresAt: item.targetExpiresAt, version: item.expectedVersion + 1 })
    }
    const final = await tx.user.findUniqueOrThrow({ where: { id: correction.userId }, select: { balance: true } })
    ensure(final.balance.toFixed(2) === correction.targetBalance, 'OSS_RECONCILIATION_BALANCE_MISMATCH', 409)
    ensure((await readRecoveryHold()).taskId === hold.taskId, 'OSS_RECONCILIATION_CONTEXT_CHANGED', 409)
    const result = { userId: correction.userId, balanceBefore: correction.expectedBalance, balanceAfter: correction.targetBalance,
      balanceLogIds: logs, instances: updatedInstances, completedRecharges: rechargeRows.map(row => row.id), recoveryHeld: true }
    const entry = await tx.platformRecoveryReconciliation.create({ data: { id: correction.id, holdTaskId: hold.taskId, actorId, userId: correction.userId,
      reference: correction.reference, observedAt: new Date(correction.observedAt), payloadHash: hash, payload: correction as unknown as Prisma.InputJsonObject, result } })
    await tx.log.create({ data: { userId: actorId, module: 'system', action: 'oss.recovery.reconcile', content: `${remark}; account ${correction.userId}; journal ${entry.id}`, result: 'success' } })
    return { id: entry.id, createdAt: entry.createdAt.toISOString(), replayed: false, result }
  }, { maxWait: 5000, timeout: 15000 }))
}

export async function recoveryReconciliations(page = 1) {
  ensure(Number.isSafeInteger(page) && page >= 1 && page <= 1000000, 'OSS_REVIEW_QUERY_INVALID')
  const hold = await readRecoveryHold()
  const result = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`
    const where = { holdTaskId: hold.taskId }
    const [rows, total] = await Promise.all([
      tx.platformRecoveryReconciliation.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 20, skip: (page - 1) * 20,
        select: { id: true, actorId: true, userId: true, reference: true, observedAt: true, result: true, createdAt: true } }),
      tx.platformRecoveryReconciliation.count({ where })
    ])
    return { rows, total, page, pageSize: 20 }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
  ensure((await readRecoveryHold()).taskId === hold.taskId, 'OSS_RECONCILIATION_CONTEXT_CHANGED', 409)
  return { holdTaskId: hold.taskId, ...result }
}

export async function recoveryCorrectionAccount(userId: number, actorId: number) {
  positiveId(userId)
  const hold = await readRecoveryHold()
  const result = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`
    const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, username: true, balance: true,
      balanceLogs: { orderBy: { id: 'desc' }, take: 1, select: { id: true } } } })
    ensure(user, 'OSS_REVIEW_ACCOUNT_NOT_FOUND', 404)
    const actor = await tx.user.findUnique({ where: { id: actorId }, select: { twoFactorEnabled: true } })
    const instanceWhere = { userId, status: { not: 'deleted' as const } }, rechargeWhere = { userId, status: { in: ['pending', 'paid', 'cancelled'] as Array<'pending' | 'paid' | 'cancelled'> } }
    const [instances, recharges, instanceCount, rechargeCount] = await Promise.all([
      tx.instance.findMany({ where: instanceWhere, orderBy: { id: 'asc' }, take: 50, select: { id: true, name: true, status: true,
        expiresAt: true, version: true, billingPrice: true, packagePlanId: true, deletionBillingPending: true, provisioningCleanupPending: true,
        instanceTasks: { where: { status: { in: ['PENDING', 'PROCESSING'] } }, select: { id: true }, take: 1 } } }),
      tx.rechargeRecord.findMany({ where: rechargeWhere, orderBy: { id: 'desc' }, take: 50, select: { id: true, orderNo: true, amount: true, status: true } }),
      tx.instance.count({ where: instanceWhere }), tx.rechargeRecord.count({ where: rechargeWhere })
    ])
    return { account: { id: user.id, username: user.username, balance: user.balance.toFixed(2), latestBalanceLogId: user.balanceLogs[0]?.id || null },
      requiresMfa: actor?.twoFactorEnabled || false,
      instances: instances.map(({ instanceTasks, packagePlanId, deletionBillingPending, provisioningCleanupPending, ...row }) => ({ ...row,
        expiresAt: row.expiresAt?.toISOString() || null, billingPrice: row.billingPrice?.toFixed(2) || null,
        eligible: !!row.expiresAt && packagePlanId !== null && ['running', 'stopped', 'suspended'].includes(row.status) &&
          !deletionBillingPending && !provisioningCleanupPending && !instanceTasks.length })),
      recharges: recharges.map(row => ({ ...row, amount: row.amount.toFixed(2) })),
      instancesTruncated: instanceCount > instances.length, rechargesTruncated: rechargeCount > recharges.length }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
  ensure((await readRecoveryHold()).taskId === hold.taskId, 'OSS_RECONCILIATION_CONTEXT_CHANGED', 409)
  return { hold, checkedAt: new Date().toISOString(), ...result }
}
