import { Prisma } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { changeBalanceInTransaction } from '../db/balance.js'
import { tryAdvisoryTransactionLock, USER_BALANCE_LOCK_NAMESPACE } from '../db/advisory-locks.js'
import { withInstanceBillingMutation } from '../lib/instance-billing-mutation.js'
import { gatewayTaskHash, GatewayTaskError } from '../lib/gateway-task-plan.js'
import { authorizeGatewayAdministration } from './gateway-admin-authorization.js'
import { BackupError, ensure, validateId } from './platform-backup-core.js'
import { readRecoveryHold } from './platform-recovery-review.js'

export interface RecoveryRenewalEvidence {
  reference: string; amount: string; months: number; periodStart: string; periodEnd: string; completedAt: string
}
export interface RecoveryCorrectionInstance {
  id: number; expectedVersion: number; expectedExpiresAt: string; targetExpiresAt: string
  expectedLatestBillingRecordId?: number | null; renewals?: RecoveryRenewalEvidence[]
}
export interface RecoveryRechargeSettlement { creditedAmount: string; completedAt: string; tradeNo?: string }
export interface RecoveryCorrection {
  id: string; holdTaskId: string; userId: number; reference: string; observedAt: string
  expectedBalance: string; targetBalance: string; expectedLatestLogId: number | null
  instances: RecoveryCorrectionInstance[]
  recharges: Array<{ id: number; orderNo: string; expectedStatus: 'pending' | 'paid' | 'cancelled'; expectedAmount: string; settlement?: RecoveryRechargeSettlement }>
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
function evidenceReference(value: unknown): string {
  ensure(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:/-]{5,119}$/.test(value), 'OSS_RECONCILIATION_INVALID')
  return value
}
export function normalizeRecoveryCorrection(value: unknown): RecoveryCorrection {
  const row = object(value, ['id', 'holdTaskId', 'userId', 'reference', 'observedAt', 'expectedBalance', 'targetBalance', 'expectedLatestLogId', 'instances', 'recharges'])
  validateId(row.id); validateId(row.holdTaskId)
  const reference = evidenceReference(row.reference), observedAt = timestamp(row.observedAt)
  if (row.expectedLatestLogId !== null) positiveId(row.expectedLatestLogId)
  ensure(Array.isArray(row.instances) && Array.isArray(row.recharges) && row.instances.length <= 20 && row.recharges.length <= 20, 'OSS_RECONCILIATION_INVALID')
  const renewalReferences: string[] = []
  const instances = row.instances.map(value => {
    const withBills = value && typeof value === 'object' && Object.hasOwn(value, 'renewals')
    const item = object(value, ['id', 'expectedVersion', 'expectedExpiresAt', 'targetExpiresAt', ...(withBills ? ['renewals', 'expectedLatestBillingRecordId'] : [])])
    ensure(Number.isSafeInteger(item.expectedVersion) && Number(item.expectedVersion) >= 0 && Number(item.expectedVersion) < 2147483647, 'OSS_RECONCILIATION_INVALID')
    const expectedExpiresAt = timestamp(item.expectedExpiresAt), targetExpiresAt = timestamp(item.targetExpiresAt)
    // This first correction flow restores a proven extension; shortening or making a paid instance free is not accepted.
    ensure(Date.parse(targetExpiresAt) > Date.parse(expectedExpiresAt), 'OSS_RECONCILIATION_INVALID')
    const result: RecoveryCorrectionInstance = { id: positiveId(item.id), expectedVersion: Number(item.expectedVersion), expectedExpiresAt, targetExpiresAt }
    if (withBills) {
      ensure(Array.isArray(item.renewals) && item.renewals.length > 0 && item.renewals.length <= 20, 'OSS_RECONCILIATION_INVALID')
      if (item.expectedLatestBillingRecordId !== null) positiveId(item.expectedLatestBillingRecordId)
      let periodStart = expectedExpiresAt, completedAt = ''
      result.renewals = item.renewals.map(value => {
        const bill = object(value, ['reference', 'amount', 'months', 'periodStart', 'periodEnd', 'completedAt'])
        const reference = evidenceReference(bill.reference), amount = money(bill.amount), start = timestamp(bill.periodStart), end = timestamp(bill.periodEnd), completed = timestamp(bill.completedAt)
        ensure(Number.isSafeInteger(bill.months) && Number(bill.months) >= 1 && Number(bill.months) <= 24 && start === periodStart &&
          Date.parse(end) > Date.parse(start) && Date.parse(completed) <= Date.parse(observedAt) &&
          (!completedAt || Date.parse(completed) >= Date.parse(completedAt)), 'OSS_RECONCILIATION_INVALID')
        periodStart = end; completedAt = completed; renewalReferences.push(reference)
        return { reference, amount, months: Number(bill.months), periodStart: start, periodEnd: end, completedAt: completed }
      })
      ensure(periodStart === targetExpiresAt, 'OSS_RECONCILIATION_INVALID')
      result.expectedLatestBillingRecordId = item.expectedLatestBillingRecordId as number | null
    }
    return result
  }).sort((a, b) => a.id - b.id)
  ensure(renewalReferences.length <= 20 && new Set(renewalReferences).size === renewalReferences.length, 'OSS_RECONCILIATION_INVALID')
  const recharges = row.recharges.map(value => {
    const withSettlement = value && typeof value === 'object' && Object.hasOwn(value, 'settlement')
    const item = object(value, ['id', 'orderNo', 'expectedStatus', 'expectedAmount', ...(withSettlement ? ['settlement'] : [])])
    ensure(typeof item.orderNo === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(item.orderNo) &&
      ['pending', 'paid', 'cancelled'].includes(String(item.expectedStatus)), 'OSS_RECONCILIATION_INVALID')
    const expectedAmount = money(item.expectedAmount)
    ensure(new Prisma.Decimal(expectedAmount).greaterThan(0), 'OSS_RECONCILIATION_INVALID')
    const result: RecoveryCorrection['recharges'][number] = { id: positiveId(item.id), orderNo: item.orderNo, expectedStatus: item.expectedStatus as 'pending' | 'paid' | 'cancelled', expectedAmount }
    if (withSettlement) {
      const withTrade = item.settlement && typeof item.settlement === 'object' && Object.hasOwn(item.settlement, 'tradeNo')
      const value = object(item.settlement, ['creditedAmount', 'completedAt', ...(withTrade ? ['tradeNo'] : [])])
      const creditedAmount = money(value.creditedAmount), completedAt = timestamp(value.completedAt)
      ensure(new Prisma.Decimal(creditedAmount).greaterThan(0) && Date.parse(completedAt) <= Date.parse(observedAt), 'OSS_RECONCILIATION_INVALID')
      if (withTrade) ensure(typeof value.tradeNo === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value.tradeNo), 'OSS_RECONCILIATION_INVALID')
      result.settlement = { creditedAmount, completedAt, ...(withTrade ? { tradeNo: value.tradeNo as string } : {}) }
    }
    return result
  }).sort((a, b) => a.id - b.id)
  ensure(new Set(instances.map(item => item.id)).size === instances.length && new Set(recharges.map(item => item.id)).size === recharges.length, 'OSS_RECONCILIATION_INVALID')
  const expectedBalance = money(row.expectedBalance), targetBalance = money(row.targetBalance)
  ensure(instances.length || recharges.length || expectedBalance !== targetBalance, 'OSS_RECONCILIATION_EMPTY')
  return { id: row.id as string, holdTaskId: row.holdTaskId as string, userId: positiveId(row.userId), reference,
    observedAt, expectedBalance, targetBalance, expectedLatestLogId: row.expectedLatestLogId as number | null, instances, recharges }
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
  for (const item of correction.instances) {
    ensure(Date.parse(item.targetExpiresAt) <= Date.now() + 10 * 366 * 86400000, 'OSS_RECONCILIATION_INVALID')
    for (const bill of item.renewals || []) ensure(Date.parse(bill.completedAt) > Date.parse(hold.snapshot.createdAt), 'OSS_RECONCILIATION_EVIDENCE_TIME')
  }
  for (const item of correction.recharges) if (item.settlement) ensure(Date.parse(item.settlement.completedAt) > Date.parse(hold.snapshot.createdAt), 'OSS_RECONCILIATION_EVIDENCE_TIME')
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
      if (item.renewals) {
        const latestBill = await tx.instanceBillingRecord.findFirst({ where: { instanceId: item.id }, orderBy: { id: 'desc' }, select: { id: true } })
        ensure((latestBill?.id || null) === item.expectedLatestBillingRecordId, 'OSS_RECONCILIATION_STALE', 409)
        for (const bill of item.renewals) {
          ensure(!await tx.instanceBillingRecord.count({ where: { instanceId: item.id, type: 'renew',
            periodStart: new Date(bill.periodStart), periodEnd: new Date(bill.periodEnd) } }), 'OSS_RECONCILIATION_CONFLICT', 409)
          // Serialized backup mutations prevent the same source receipt being
          // published for another account while this journal is committed.
          const used = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM platform_recovery_reconciliations
            WHERE hold_task_id = ${hold.taskId}
            AND jsonb_path_exists(payload, '$.instances[*].renewals[*] ? (@.reference == $reference)',
              jsonb_build_object('reference', ${bill.reference}::text)) LIMIT 1`
          ensure(!used.length, 'OSS_RECONCILIATION_CONFLICT', 409)
        }
      }
    }
    const rechargeRows = []
    for (const item of correction.recharges) {
      const recharge = await tx.rechargeRecord.findUnique({ where: { id: item.id }, select: { id: true, userId: true, orderNo: true, amount: true, status: true, tradeNo: true } })
      ensure(recharge && recharge.userId === correction.userId && recharge.orderNo === item.orderNo && recharge.status === item.expectedStatus &&
        recharge.amount.toFixed(2) === item.expectedAmount && !await tx.balanceLog.count({ where: { orderId: item.orderNo, type: 'recharge' } }), 'OSS_RECONCILIATION_STALE', 409)
      ensure(!item.settlement?.tradeNo || !recharge.tradeNo || recharge.tradeNo === item.settlement.tradeNo, 'OSS_RECONCILIATION_STALE', 409)
      rechargeRows.push({ ...recharge, credit: new Prisma.Decimal(item.settlement?.creditedAmount || recharge.amount),
        completedAt: item.settlement?.completedAt || correction.observedAt, tradeNo: item.settlement?.tradeNo || recharge.tradeNo })
    }
    const rechargeTotal = rechargeRows.reduce((sum, row) => sum.plus(row.credit), new Prisma.Decimal(0))
    const renewals = correction.instances.flatMap(item => (item.renewals || []).map(bill => ({ instanceId: item.id, ...bill })))
    const renewalTotal = renewals.reduce((sum, bill) => sum.plus(bill.amount), new Prisma.Decimal(0))
    const remainingAdjustment = new Prisma.Decimal(correction.targetBalance).minus(user.balance).minus(rechargeTotal).plus(renewalTotal)
    const maximum = new Prisma.Decimal('99999999.99')
    ensure(rechargeTotal.lessThanOrEqualTo(maximum) && renewalTotal.lessThanOrEqualTo(maximum) && remainingAdjustment.abs().lessThanOrEqualTo(maximum), 'OSS_RECONCILIATION_AMOUNT_LIMIT')
    // Reconstruct evidenced consume/recharge entries while keeping the confirmed
    // final balance. Only the unmatched remainder is an administrative adjustment.
    const remark = `OSS recovery ${hold.taskId}; evidence ${correction.reference}`
    const logs: number[] = []
    const restoredRenewals: Array<{ reference: string; instanceId: number; billingRecordId: number; balanceLogId: number }> = []
    const entries: Array<{ amount: Prisma.Decimal; apply: () => Promise<void> }> = []
    if (!remainingAdjustment.isZero()) entries.push({ amount: remainingAdjustment, apply: async () => {
      const value = await changeBalanceInTransaction(tx, { userId: correction.userId, type: 'admin_adjust', amount: remainingAdjustment.toNumber(), remark })
      logs.push(value.balanceLog.id)
    } })
    for (const recharge of rechargeRows) entries.push({ amount: recharge.credit, apply: async () => {
      const claimed = await tx.rechargeRecord.updateMany({ where: { id: recharge.id, status: recharge.status }, data: { status: 'completed', actualAmount: recharge.credit,
        tradeNo: recharge.tradeNo, completedAt: new Date(recharge.completedAt) } })
      ensure(claimed.count === 1, 'OSS_RECONCILIATION_STALE', 409)
      const value = await changeBalanceInTransaction(tx, { userId: correction.userId, type: 'recharge', amount: recharge.credit.toNumber(), orderId: recharge.orderNo, remark })
      await tx.balanceLog.update({ where: { id: value.balanceLog.id }, data: { createdAt: new Date(recharge.completedAt) } })
      logs.push(value.balanceLog.id)
    } })
    for (const bill of renewals) entries.push({ amount: new Prisma.Decimal(bill.amount).negated(), apply: async () => {
      const amount = new Prisma.Decimal(bill.amount), billRemark = `${remark}; renewal ${bill.reference}`
      const log = amount.isZero()
        ? await tx.balanceLog.create({ data: { userId: correction.userId, instanceId: bill.instanceId, type: 'consume', amount: 0,
          balanceBefore: balance, balanceAfter: balance, remark: billRemark, createdAt: new Date(bill.completedAt) } })
        : (await changeBalanceInTransaction(tx, { userId: correction.userId, instanceId: bill.instanceId, type: 'consume', amount: amount.negated().toNumber(), remark: billRemark })).balanceLog
      if (!amount.isZero()) await tx.balanceLog.update({ where: { id: log.id }, data: { createdAt: new Date(bill.completedAt) } })
      const record = await tx.instanceBillingRecord.create({ data: { userId: correction.userId, instanceId: bill.instanceId, type: 'renew',
        amount, months: bill.months, periodStart: new Date(bill.periodStart), periodEnd: new Date(bill.periodEnd),
        balanceLogId: log.id, createdAt: new Date(bill.completedAt), remark: billRemark } })
      logs.push(log.id); restoredRenewals.push({ reference: bill.reference, instanceId: bill.instanceId, billingRecordId: record.id, balanceLogId: log.id })
    } })
    // Use whole ledger entries in an order that never creates a negative or
    // overflowing intermediate balance. Impossible evidence is rejected atomically.
    let balance = user.balance
    while (entries.length) {
      const index = entries.findIndex(entry => balance.plus(entry.amount).greaterThanOrEqualTo(0) && balance.plus(entry.amount).lessThanOrEqualTo(maximum))
      ensure(index >= 0, 'OSS_RECONCILIATION_AMOUNT_LIMIT')
      const [entry] = entries.splice(index, 1)
      await entry.apply(); balance = balance.plus(entry.amount)
    }
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
      balanceLogIds: logs, instances: updatedInstances, completedRecharges: rechargeRows.map(row => row.id), recoveryHeld: true,
      ...(restoredRenewals.length ? { restoredRenewals } : {}) }
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
        billingRecords: { orderBy: { id: 'desc' }, take: 1, select: { id: true } },
        instanceTasks: { where: { status: { in: ['PENDING', 'PROCESSING'] } }, select: { id: true }, take: 1 } } }),
      tx.rechargeRecord.findMany({ where: rechargeWhere, orderBy: { id: 'desc' }, take: 50, select: { id: true, orderNo: true, amount: true, status: true } }),
      tx.instance.count({ where: instanceWhere }), tx.rechargeRecord.count({ where: rechargeWhere })
    ])
    return { account: { id: user.id, username: user.username, balance: user.balance.toFixed(2), latestBalanceLogId: user.balanceLogs[0]?.id || null },
      requiresMfa: actor?.twoFactorEnabled || false,
      instances: instances.map(({ instanceTasks, billingRecords, packagePlanId, deletionBillingPending, provisioningCleanupPending, ...row }) => ({ ...row,
        latestBillingRecordId: billingRecords[0]?.id || null,
        expiresAt: row.expiresAt?.toISOString() || null, billingPrice: row.billingPrice?.toFixed(2) || null,
        eligible: !!row.expiresAt && packagePlanId !== null && ['running', 'stopped', 'suspended'].includes(row.status) &&
          !deletionBillingPending && !provisioningCleanupPending && !instanceTasks.length })),
      recharges: recharges.map(row => ({ ...row, amount: row.amount.toFixed(2) })),
      instancesTruncated: instanceCount > instances.length, rechargesTruncated: rechargeCount > recharges.length }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
  ensure((await readRecoveryHold()).taskId === hold.taskId, 'OSS_RECONCILIATION_CONTEXT_CHANGED', 409)
  return { hold, checkedAt: new Date().toISOString(), ...result }
}
