import { randomUUID, createHash } from 'node:crypto'
import { Prisma, type CheckoutOrder } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import * as db from '../db/index.js'
import { advisoryTransactionLock, advisoryTransactionLockString, USER_BALANCE_LOCK_NAMESPACE, PAYMENT_SETTLEMENT_LOCK_NAMESPACE } from '../db/advisory-locks.js'
import { authorizeUserWrite, type WriteSession } from '../db/user-write-authorization.js'
import { encryptSensitiveData, decryptSensitiveData } from '../lib/security.js'
import { sanitizeObject } from '../lib/log-sanitizer.js'
import { ErrorCode } from '../lib/errors.js'
import { lockHostGroups } from './host-groups.js'
import { recoveryHeld } from './platform-backup-core.js'
import { calculateCreateBilling } from '../db/billing-operations.js'
import { prepareOrder, validatePreparedOrder, materializePoolInstance, startProvisioning, getPoolOrderResult,
  poolOrderHash, PoolOrderError, type PoolOrderInput, type ResolvedItem, type CreatedInstance } from './pool-orders.js'
import { failPoolProvision } from './pool-provisioning.js'

export type CheckoutInput = PoolOrderInput & { source: 'direct' | 'cart' }
type Snapshot = { input: CheckoutInput; sshKey: string; items: ResolvedItem[] }
export class CheckoutError extends Error {
  code: string
  constructor(message: string, public status = 409) {
    super(message)
    this.code = message.includes('余额不足') ? 'CHECKOUT_BALANCE_LOW'
      : status === 404 ? 'CHECKOUT_NOT_FOUND'
      : message.includes('登录') ? 'CHECKOUT_SESSION_CHANGED'
      : message.includes('恢复') ? 'CHECKOUT_RECOVERY'
      : message.includes('重新下单') || message.includes('关闭') || message.includes('已付款') ? 'CHECKOUT_CLOSED'
      : message.includes('支付方式') || message.includes('渠道') || message.includes('链接') ? 'CHECKOUT_METHOD_UNAVAILABLE'
      : 'CHECKOUT_RETRY'
  }
}
export function checkoutOpen(order: CheckoutOrder) { return order.status === 'pending' && order.expiresAt.getTime() > Date.now() }
export async function lockCheckout(tx: Prisma.TransactionClient, id: string, userId: number, session?: WriteSession) {
  await advisoryTransactionLock(tx, USER_BALANCE_LOCK_NAMESPACE, userId)
  await tx.$queryRaw`SELECT id FROM users WHERE id=${userId} FOR UPDATE`
  if (session && !await authorizeUserWrite(tx, userId, session)) throw new CheckoutError('当前登录状态或账号权限已变更，请重新登录', 403)
  await tx.$queryRaw`SELECT id FROM checkout_orders WHERE id=${id} FOR UPDATE`
  const order = await tx.checkoutOrder.findFirst({ where: { id, userId } })
  if (!order) throw new CheckoutError('订单不存在', 404)
  return order
}
export async function createCheckout(userId: number, input: CheckoutInput, session: WriteSession) {
  if (recoveryHeld()) throw new CheckoutError('系统正在恢复，请稍后重试', 503)
  const hash = createHash('sha256').update(`${input.source}:${poolOrderHash(input)}`).digest('hex')
  const previous = await prisma.checkoutOrder.findUnique({ where: { id: input.requestId } })
  if (previous) {
    await prisma.$transaction(async tx => {
      const owned = await lockCheckout(tx, input.requestId, userId, session)
      if (owned.requestHash !== hash) throw new CheckoutError('此订单已确认，请重新下单')
    })
    return getCheckout(userId, input.requestId)
  }
  let sshKey = ''
  if (input.sshKeyId != null) {
    const key = await db.getSSHKeyById(input.sshKeyId)
    if (!key || key.user_id !== userId) throw new PoolOrderError(ErrorCode.SSH_KEY_NOT_OWNED, 'SSH密钥不可用')
    sshKey = key.public_key
  }
  const prepared = await prepareOrder(userId, input, sshKey)
  await prisma.$transaction(async tx => {
    await advisoryTransactionLock(tx, USER_BALANCE_LOCK_NAMESPACE, userId)
    await lockHostGroups(tx)
    if (!await authorizeUserWrite(tx, userId, session)) throw new CheckoutError('登录状态已变更', 403)
    const existing = await tx.checkoutOrder.findUnique({ where: { id: input.requestId } })
    if (existing) {
      if (existing.userId !== userId || existing.requestHash !== hash) throw new CheckoutError('结算请求冲突')
      return
    }
    // A new intentional purchase replaces abandoned unpaid checkouts from the
    // same entry point. Their old links can only produce an original-method
    // refund; they cannot hold the last machine hostage to the replacement.
    const abandoned = await tx.checkoutOrder.findMany({ where: { userId, source: input.source, status: 'pending' }, orderBy: { id: 'asc' } })
    for (const old of abandoned) {
      await tx.$queryRaw`SELECT id FROM checkout_orders WHERE id=${old.id} FOR UPDATE`
      await tx.checkoutOrder.update({ where: { id: old.id }, data: { status: 'cancelled' } })
      await releaseCheckoutReservations(tx, old.id)
    }
    // Bound unpaid holds per account; adding to the cart never reserves stock.
    if (await tx.checkoutOrder.count({ where: { userId, status: 'pending' } }) >= 3) throw new CheckoutError('请先在订单页取消不再需要的待付款订单')
    if (await tx.poolOrder.count({ where: { id: input.requestId } })) throw new CheckoutError('结算请求冲突')
    await validatePreparedOrder(tx, userId, input, sshKey, prepared.items)
    const regions = await tx.hostRegionGroup.findMany({ where: { id: { in: prepared.items.map(item => item.product.price.regionGroupId) } }, select: { id: true, name: true, countryCode: true } })
    await tx.checkoutOrder.create({ data: { id: input.requestId, userId, requestHash: hash, source: input.source,
      totalCents: input.expectedTotal, expiresAt: new Date(Date.now() + 15 * 60000),
      snapshot: encryptSensitiveData(JSON.stringify({ input: { ...input, turnstileToken: undefined }, sshKey, items: prepared.items },
        (_key, value) => typeof value === 'bigint' ? value.toString() : value)),
      display: prepared.items.map(item => ({ ...item.input, monthlyPrice: Number(item.product.price.monthlyPrice),
        setupFee: Number(item.product.price.setupFee), resourcePreset: item.product.price.resourcePreset,
        diskGiB: item.product.price.diskGiB, memoryMiB: item.plan.memory, cpu: item.plan.cpu,
        regionName: regions.find(region => region.id === item.product.price.regionGroupId)?.name ?? '',
        countryCode: regions.find(region => region.id === item.product.price.regionGroupId)?.countryCode ?? '' })) as Prisma.InputJsonValue } })
    let ordinal = 0
    for (const item of prepared.items) for (const _planned of item.planned) {
      const price = item.product.price
      const host = await db.selectAndReserveHostWithLock(tx, { reservationOnly: true, cpu: item.plan.cpu, memory: item.plan.memory,
        disk: item.plan.disk, packageId: item.pkg.id, networkMode: item.networkMode, poolImageId: item.imageId,
        poolMachineGroupId: price.machineGroupId, poolRegionGroupId: price.regionGroupId,
        poolResourcePreset: price.resourcePreset, poolDiskGiB: price.diskGiB })
      if (!host) throw new PoolOrderError(ErrorCode.POOL_STOCK_SHORT, '库存不足，请调整数量')
      await tx.checkoutReservation.create({ data: { orderId: input.requestId, hostId: host.id, ordinal: ordinal++ } })
    }
  }, { timeout: 60000 })
  return getCheckout(userId, input.requestId)
}

export async function getCheckout(userId: number, id: string) {
  const order = await prisma.checkoutOrder.findFirst({ where: { id, userId }, include: {
    payments: { orderBy: { createdAt: 'asc' }, select: { id: true, providerId: true, providerName: true, method: true,
      payableCents: true, feeCents: true, payUrl: true, status: true } },
    refunds: { select: { id: true, amountCents: true, status: true, reason: true, instanceId: true, resolution: true } }
  } })
  if (!order) throw new CheckoutError('订单不存在', 404)
  const result = await getPoolOrderResult(userId, id)
  const walletLogs = await prisma.balanceLog.findMany({ where: { userId, orderId: id, type: 'refund',
    id: { in: order.refunds.flatMap(refund => {
      const value = /^balance-log:([1-9]\d*)$/.exec(refund.resolution || '')?.[1]
      return value && Number.isSafeInteger(Number(value)) && Number(value) <= 2147483647 ? [Number(value)] : []
    }) }
  }, select: { id: true, instanceId: true, amount: true, balanceBefore: true, balanceAfter: true } })
  return { id, source: order.source, status: order.status, totalCents: order.totalCents, items: order.display,
    expiresAt: order.expiresAt.toISOString(), paidAt: order.paidAt?.toISOString() ?? null,
    paymentId: order.paymentId, error: order.error, payments: order.payments,
    refunds: order.refunds.map(({ resolution, ...refund }) => ({ ...refund,
      refundedToBalance: refund.status === 'refunded' && ['provisioning_failed','fulfillment_failed'].includes(refund.reason) &&
        walletLogs.some(log => resolution === `balance-log:${log.id}` && log.instanceId === refund.instanceId &&
          Math.round(Number(log.amount)*100) === refund.amountCents && log.balanceAfter.minus(log.balanceBefore).equals(log.amount)) })), result }
}

export async function cancelCheckout(userId: number, id: string, session?: WriteSession) {
  await prisma.$transaction(async tx => {
    const order = await lockCheckout(tx, id, userId, session)
    if (order.status !== 'pending') {
      if (['cancelled', 'expired'].includes(order.status)) return
      throw new CheckoutError('订单已付款，无法取消')
    }
    if (!session && order.expiresAt.getTime() > Date.now()) return
    await tx.checkoutOrder.update({ where: { id }, data: { status: session ? 'cancelled' : 'expired' } })
    await releaseCheckoutReservations(tx, id)
  })
  return getCheckout(userId, id)
}

async function releaseCheckoutReservations(tx: Prisma.TransactionClient, id: string) {
  const reservations = await tx.checkoutReservation.findMany({ where: { orderId: id }, orderBy: { hostId: 'asc' } })
  for (const reservation of reservations) await tx.$queryRaw`SELECT id FROM hosts WHERE id=${reservation.hostId} FOR UPDATE`
  await tx.checkoutReservation.deleteMany({ where: { orderId: id } })
}

export async function payCheckoutBalance(userId: number, id: string, session: WriteSession) {
  if (recoveryHeld()) throw new CheckoutError('系统正在恢复，请稍后重试', 503)
  await prisma.$transaction(async tx => {
    const order = await lockCheckout(tx, id, userId, session)
    if (order.paidAt) return
    if (!checkoutOpen(order)) throw new CheckoutError('订单已关闭，请重新下单')
    const amount = order.totalCents / 100
    const debited = await tx.user.updateMany({ where: { id: userId, balance: { gte: amount } }, data: { balance: { decrement: amount } } })
    if (!debited.count) throw new PoolOrderError(ErrorCode.BALANCE_INSUFFICIENT, '余额不足，请选择其他支付方式')
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { balance: true } })
    await tx.balanceLog.create({ data: { userId, type: 'consume', amount: -amount, balanceBefore: Number(user.balance) + amount,
      balanceAfter: user.balance, orderId: id, remark: `购买实例订单 ${id}` } })
    // The paid state is the durable work item, committed with the debit.
    await tx.checkoutOrder.update({ where: { id }, data: { status: 'paid', paidAt: new Date(), paymentId: 'balance', nextAttemptAt: new Date() } })
  })
  return getCheckout(userId, id)
}

/** Only the channel verifier calls this with a verified merchant, order and amount. */
export async function settleCheckoutPayment(paymentId: string, tradeNo: string, amountCents: number, currency: string, proof: Record<string, unknown>, reviewReason?: string) {
  if (!tradeNo.trim() || tradeNo.length > 128 || !Number.isSafeInteger(amountCents) || amountCents <= 0) throw new CheckoutError('付款凭据无效', 400)
  const payment = await prisma.checkoutPayment.findUniqueOrThrow({ where: { id: paymentId }, include: { order: true } })
  if (amountCents !== payment.payableCents) throw new CheckoutError('支付金额与订单不符', 400)
  await prisma.$transaction(async tx => {
    await advisoryTransactionLockString(tx, PAYMENT_SETTLEMENT_LOCK_NAMESPACE, `${payment.providerId}:${tradeNo.trim()}`)
    const order = await lockCheckout(tx, payment.orderId, payment.order.userId)
    const old = await tx.checkoutReceipt.findUnique({ where: { providerId_tradeNo: { providerId: payment.providerId, tradeNo: tradeNo.trim() } } })
    if (old) {
      if (old.paymentId !== paymentId) throw new CheckoutError('付款流水已关联其他订单', 400)
      return
    }
    if (await tx.rechargeRecord.findFirst({ where: { providerId: payment.providerId, tradeNo: tradeNo.trim(), status: { in: ['completed', 'refunded'] } } })) {
      throw new CheckoutError('付款流水已关联其他订单', 400)
    }
    const receipt = await tx.checkoutReceipt.create({ data: { id: randomUUID(), paymentId, providerId: payment.providerId,
      tradeNo: tradeNo.trim(), amountCents, currency, proof: sanitizeObject(proof) as Prisma.InputJsonValue } })
    await tx.checkoutPayment.update({ where: { id: paymentId }, data: { status: 'paid' } })
    if (checkoutOpen(order) && !reviewReason) {
      await tx.checkoutOrder.update({ where: { id: order.id }, data: { status: 'paid', paidAt: new Date(), paymentId, nextAttemptAt: new Date() } })
    } else {
      await tx.checkoutRefund.create({ data: { id: `receipt:${receipt.id}`, orderId: order.id, paymentId, receiptId: receipt.id,
        amountCents, principalCents: order.totalCents, reason: reviewReason || (order.paidAt ? 'duplicate_payment' : 'closed_order') } })
      if (order.status === 'pending') {
        await tx.checkoutOrder.update({ where: { id: order.id }, data: { status: reviewReason ? 'refund_pending' : 'expired' } })
        await releaseCheckoutReservations(tx, order.id)
      }
    }
  })
}

export async function requestCheckoutRefund(tx: Prisma.TransactionClient, order: CheckoutOrder, instanceId: number | null, principalCents: number, reason: string, refundId?: string) {
  if (!order.paymentId || order.paymentId === 'balance') return false
  await tx.$queryRaw`SELECT id FROM checkout_orders WHERE id=${order.id} FOR UPDATE`
  const payment = await tx.checkoutPayment.findUniqueOrThrow({ where: { id: order.paymentId } })
  const receipt = await tx.checkoutReceipt.findFirstOrThrow({ where: { paymentId: payment.id }, orderBy: { createdAt: 'asc' } })
  const id = refundId ?? (instanceId ? `instance:${instanceId}` : `order:${order.id}`)
  if (await tx.checkoutRefund.findUnique({ where: { id } })) return id
  const existing = await tx.checkoutRefund.aggregate({ where: { receiptId: receipt.id }, _sum: { amountCents: true, principalCents: true } })
  // Round the cumulative entitlement, so the last failed line receives the
  // remaining fee cents instead of leaving an unrefundable rounding remainder.
  const prior = existing._sum.amountCents ?? 0
  const principalBefore = existing._sum.principalCents ?? 0
  const entitlement = order.totalCents > 0
    ? Math.round(Math.min(order.totalCents, principalBefore + principalCents) * payment.payableCents / order.totalCents)
    : payment.payableCents
  const amountCents = Math.max(0, Math.min(payment.payableCents - prior, entitlement - prior))
  if (amountCents > 0) await tx.checkoutRefund.create({ data: { id, orderId: order.id, paymentId: payment.id,
    receiptId: receipt.id, instanceId, amountCents, principalCents, reason } })
  return amountCents > 0 ? id : false
}

/** Failed delivery returns the verified original payment to its payer's wallet.
 * The refund receipt, wallet ledger and completion marker commit together;
 * manual, duplicate and late-payment refunds retain their original route. */
export async function creditFailedCheckoutRefundToBalance(tx: Prisma.TransactionClient, order: CheckoutOrder,
  instanceId: number | null, principalCents: number, reason: 'provisioning_failed' | 'fulfillment_failed') {
  const current = await lockCheckout(tx, order.id, order.userId)
  if (!current.paidAt || current.paymentId !== order.paymentId || !Number.isSafeInteger(principalCents) ||
      principalCents <= 0 || principalCents > current.totalCents) throw new CheckoutError('原付款状态或退款金额已变更，退款暂未完成')
  const refundId = await requestCheckoutRefund(tx, current, instanceId, principalCents, reason)
  if (!refundId) throw new CheckoutError('开通失败退款凭据未能创建')
  const refund = await tx.checkoutRefund.findUniqueOrThrow({ where: { id: refundId }, include: { receipt: true } })
  if (refund.orderId !== current.id || refund.instanceId !== instanceId || refund.reason !== reason ||
      refund.paymentId !== current.paymentId || refund.principalCents !== principalCents ||
      refund.receipt.paymentId !== current.paymentId || refund.receipt.currency !== 'CNY') throw new CheckoutError('开通失败退款来源不符')
  if (refund.status === 'refunded') {
    const id = /^balance-log:([1-9]\d*)$/.exec(refund.resolution || '')?.[1]
    const ledger = id && Number(id) <= 2147483647 ? await tx.balanceLog.findFirst({ where: { id: Number(id), userId: current.userId,
      orderId: current.id, instanceId, type: 'refund', amount: refund.amountCents / 100 } }) : null
    if (refund.resolution?.startsWith('balance-log:') && (!ledger || !ledger.balanceAfter.minus(ledger.balanceBefore).equals(ledger.amount))) {
      throw new CheckoutError('账户余额退款入账凭据不完整')
    }
    // An already completed original refund cannot be credited a second time.
    return { refundId, balanceLogId: ledger?.id ?? null, amountCents: refund.amountCents, credited: false }
  }
  if (refund.status !== 'pending' || refund.amountCents <= 0 || refund.amountCents > refund.receipt.amountCents) {
    throw new CheckoutError('开通失败退款金额或状态无效')
  }
  const amount = refund.amountCents / 100
  const payer = await tx.user.update({ where: { id: current.userId }, data: { balance: { increment: amount } } })
  const ledger = await tx.balanceLog.create({ data: { userId: current.userId, orderId: current.id, instanceId,
    type: 'refund', amount, balanceBefore: Number(payer.balance) - amount, balanceAfter: payer.balance,
    remark: '实例开通失败，第三方付款自动退至账户余额' } })
  await tx.checkoutRefund.update({ where: { id: refundId }, data: { status: 'refunded',
    resolution: `balance-log:${ledger.id}`, handledAt: new Date(), handledById: null } })
  return { refundId, balanceLogId: ledger.id, amountCents: refund.amountCents, credited: true }
}

function snapshotOf(order: CheckoutOrder): Snapshot {
  const decrypted = decryptSensitiveData(order.snapshot)
  if (!decrypted) throw new CheckoutError('订单内容暂时无法读取', 503)
  const value = JSON.parse(decrypted) as Snapshot
  for (const item of value.items) item.billing.expiresAt = new Date(item.billing.expiresAt)
  return value
}

export async function materializeCheckout(id: string) {
  if (recoveryHeld()) return
  const initial = await prisma.checkoutOrder.findUniqueOrThrow({ where: { id } })
  if (!initial.paidAt || !['paid','fulfilling'].includes(initial.status)) return
  const snapshot = snapshotOf(initial)
  const entries = await prisma.$transaction(async tx => {
    await advisoryTransactionLock(tx, USER_BALANCE_LOCK_NAMESPACE, initial.userId)
    await lockHostGroups(tx)
    const order = await lockCheckout(tx, id, initial.userId)
    if (!['paid','fulfilling'].includes(order.status)) return []
    await tx.$queryRaw`SELECT id FROM users WHERE id=${order.userId} FOR UPDATE`
    const user = await tx.user.findUniqueOrThrow({ where: { id: order.userId } })
    if (user.status !== 'active') throw new CheckoutError('账户已停用，无法开通')
    if (await tx.poolOrder.count({ where: { id } })) return []
    // The accepted snapshot fixes price; identity and image/command ownership remain checked.
    await validatePreparedOrder(tx, order.userId, snapshot.input, snapshot.sshKey, snapshot.items, true)
    const holds = await tx.checkoutReservation.findMany({ where: { orderId: id }, orderBy: { ordinal: 'asc' } })
    if (holds.length !== snapshot.items.reduce((sum, item) => sum + item.planned.length, 0)) throw new CheckoutError('订单库存预留不完整')
    for (const hostId of holds.map(row => row.hostId).sort((a,b) => a-b)) await tx.$queryRaw`SELECT id FROM hosts WHERE id=${hostId} FOR UPDATE`
    await tx.poolOrder.create({ data: { id, userId: order.userId, requestHash: order.requestHash, totalCents: order.totalCents } })
    const balanceLog = order.paymentId === 'balance' ? await tx.balanceLog.findFirst({ where: { userId: order.userId, orderId: id, type: 'consume' } }) : null
    let ordinal = 0
    const created: CreatedInstance[] = []
    for (const item of snapshot.items) for (const planned of item.planned) {
      const hold = holds[ordinal++]!, price = item.product.price
      await tx.checkoutReservation.delete({ where: { hostId: hold.hostId } })
      const host = await db.selectAndReserveHostWithLock(tx, { hostId: hold.hostId, cpu: item.plan.cpu, memory: item.plan.memory, disk: item.plan.disk,
        packageId: item.pkg.id, networkMode: item.networkMode, poolImageId: item.imageId, poolMachineGroupId: price.machineGroupId,
        poolRegionGroupId: price.regionGroupId, poolResourcePreset: price.resourcePreset, poolDiskGiB: price.diskGiB })
      if (!host) throw new CheckoutError('已预留的机器暂时无法开通')
      // Billing starts at fulfillment, not when the customer opened checkout.
      item.billing.expiresAt = calculateCreateBilling(item.plan).expiresAt
      const instance = await materializePoolInstance(tx, { userId: order.userId, batchId: id, sshKey: snapshot.sshKey,
        item, planned, lockedHost: host, waiveCharge: false, balanceLogId: balanceLog?.id ?? null, now: new Date() })
      created.push({ instanceId: instance.id, host, item, planned })
    }
    await tx.checkoutOrder.update({ where: { id }, data: { status: 'fulfilling', error: null } })
    return created
  }, { timeout: 60000 })
  return { entries, userId: initial.userId, sshKey: snapshot.sshKey }
}

export async function fulfillCheckout(id: string) {
  const accepted = await materializeCheckout(id)
  if (!accepted) return
  for (const entry of accepted.entries) {
    if (recoveryHeld()) return
    try { await startProvisioning(accepted.userId, accepted.sshKey, entry) }
    catch { await failPoolProvision(entry.instanceId, entry.host, '实例开通准备失败') }
  }
}

export async function processCheckoutQueue() {
  if (recoveryHeld()) return
  const expired = await prisma.checkoutOrder.findMany({ where: { status: 'pending', expiresAt: { lte: new Date() } }, take: 50 })
  for (const order of expired) {
    try { await cancelCheckout(order.userId, order.id) }
    catch { /* A concurrent receipt may have paid it; continue the other orders. */ }
  }
  const orders = await prisma.checkoutOrder.findMany({ where: { status: { in: ['paid','fulfilling','refund_pending'] }, nextAttemptAt: { lte: new Date() } }, take: 10, orderBy: { nextAttemptAt: 'asc' } })
  for (const order of orders) {
    if (recoveryHeld()) return
    await prisma.checkoutOrder.update({ where: { id: order.id }, data: { nextAttemptAt: new Date(Date.now() + 15000) } })
    try {
      await fulfillCheckout(order.id)
      const result = await getPoolOrderResult(order.userId, order.id)
      if (result?.instances.length) {
        const pending = result.instances.some(row => row.status === 'creating')
        if (!pending) await prisma.$transaction(async tx => {
          await lockCheckout(tx, order.id, order.userId)
          // Read after the same lock used by refund completion. A concurrent
          // completed refund must not be overwritten by a stale queue snapshot.
          const latest = await getPoolOrderResult(order.userId, order.id, tx)
          if (!latest?.instances.length) return
          const delivering = latest.instances.some(row => row.status === 'creating')
          const delivered = latest.instances.filter(row => ['running','stopped'].includes(row.status)).length
          const refundPending = latest.instances.some(row => row.refundPending) ||
            await tx.checkoutRefund.count({ where: { orderId: order.id, status: 'pending' } }) > 0
          if (!delivering) await tx.checkoutOrder.update({ where: { id: order.id }, data: {
            status: delivered === latest.instances.length ? 'completed' : delivered ? 'partial' : refundPending ? 'refund_pending' : 'refunded'
          } })
        })
        else {
          // A crash between committing instances and starting remote work is recoverable.
          const snapshot = snapshotOf(order)
          const instances = await prisma.instance.findMany({ where: { purchaseBatchId: order.id, status: 'creating', provisioningCleanupPending: false, updatedAt: { lt: new Date(Date.now() - 60000) },
            snapshottedSpecs: { path: ['poolProvision','phase'], equals: 'prepared' } } })
          for (const instance of instances) {
            const item = snapshot.items.find(row => row.planned.some(plan => plan.incusId === instance.incusId))
            const host = await db.getHostById(instance.hostId)
            const planned = item?.planned.find(row => row.incusId === instance.incusId)
            if (item && host && planned) try { await startProvisioning(order.userId, snapshot.sshKey, { instanceId: instance.id, host, item, planned }) }
            catch { await failPoolProvision(instance.id, host, '恢复开通任务失败') }
          }
        }
      }
    } catch (error) {
      const attempts = order.attempts + 1
      await prisma.$transaction(async tx => {
        const current = await lockCheckout(tx, order.id, order.userId)
        if (current.status !== 'paid') return
        if (attempts >= 5 || error instanceof PoolOrderError) {
          if (current.paymentId === 'balance') {
            const amount = current.totalCents / 100
            const user = await tx.user.update({ where: { id: current.userId }, data: { balance: { increment: amount } } })
            await tx.balanceLog.create({ data: { userId: current.userId, type: 'refund', amount, balanceBefore: Number(user.balance) - amount,
              balanceAfter: user.balance, orderId: current.id, remark: `订单未能开通，退回余额 ${current.id}` } })
          } else await creditFailedCheckoutRefundToBalance(tx, current, null, current.totalCents, 'fulfillment_failed')
          await releaseCheckoutReservations(tx, current.id)
          await tx.checkoutOrder.update({ where: { id: current.id }, data: { status: 'refunded', error: current.paymentId === 'balance'
            ? '本台主机未能开通，费用已按原支付方式退回。' : '本台主机未能开通，款项已自动退至账户余额。' } })
        } else await tx.checkoutOrder.update({ where: { id: current.id }, data: { attempts, nextAttemptAt: new Date(Date.now() + Math.min(300000, 15000 * 2 ** attempts)), error: '正在重新尝试开通' } })
      }).catch(async () => {
        // A failed wallet/ledger transaction leaves the original payment and
        // all money unchanged. Persist the retry and continue other orders.
        await prisma.checkoutOrder.updateMany({ where: { id: order.id, status: 'paid' }, data: {
          attempts, nextAttemptAt: new Date(Date.now() + 15000), error: '开通失败退款尚未完成，系统正在自动重试'
        } }).catch(() => undefined)
      })
    }
  }
}
