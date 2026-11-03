import type { Prisma } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { getInstanceBillingLineageIds } from '../db/billing-records.js'
import { getMaxRefundable } from '../db/billing-operations.js'
import { requestCheckoutRefund } from './checkout-orders.js'

/** Caller holds the recipient's balance lock. Return original purchase money
 * through its receipt first; only payments made from the wallet return there. */
export async function refundInstancePayment(tx: Prisma.TransactionClient, instanceId: number, userId: number, amount: number, remark: string) {
  const instance = await tx.instance.findUniqueOrThrow({ where: { id: instanceId }, select: { userId: true } })
  const limit = await getMaxRefundable(instanceId, tx)
  if (instance.userId !== userId || !Number.isFinite(amount) || amount <= 0 || Math.round(amount * 100) > Math.round(limit.maxRefundable * 100)) {
    throw new Error('退款金额超过剩余可退金额或实例归属不符')
  }
  const lineage = await getInstanceBillingLineageIds(instanceId, tx)
  const purchases = await tx.instanceBillingRecord.findMany({ where: { instanceId: { in: lineage }, type: 'newPurchase', amount: { gt: 0 } }, orderBy: { id: 'asc' } })
  let remaining = Math.round(amount * 100), externalCents = 0
  const refundIds: string[] = []
  for (const bill of purchases) {
    if (!remaining || !bill.purchaseBatchId) continue
    const order = await tx.checkoutOrder.findUnique({ where: { id: bill.purchaseBatchId } })
    // Transfers do not turn the original third-party payment into wallet money.
    // The original receipt remains the refund destination after ownership changes.
    if (!order?.paymentId || order.paymentId === 'balance') continue
    await tx.$queryRaw`SELECT id FROM checkout_orders WHERE id=${order.id} FOR UPDATE`
    const prior = await tx.checkoutRefund.aggregate({ where: { orderId: order.id, instanceId: bill.instanceId }, _sum: { principalCents: true } })
    const cents = Math.min(remaining, Math.max(0, Math.round(Number(bill.amount) * 100) - (prior._sum.principalCents ?? 0)))
    if (cents) {
      const refundId = await requestCheckoutRefund(tx, order, bill.instanceId, cents, 'instance_refund', `adjustment:${randomUUID()}`)
      if (!refundId) throw new Error('原付款退款记录未能创建')
      refundIds.push(refundId)
      externalCents += cents; remaining -= cents
    }
  }
  let balanceLogId: number | null = null
  if (remaining) {
    const value = remaining / 100
    const user = await tx.user.update({ where: { id: userId }, data: { balance: { increment: value } } })
    const log = await tx.balanceLog.create({ data: { userId, instanceId, type: 'refund', amount: value,
      balanceBefore: Number(user.balance) - value, balanceAfter: user.balance, remark } })
    balanceLogId = log.id
  }
  return { balanceLogId, externalCents, walletAmount: remaining / 100, refundIds }
}

/** Legacy adjustment approvals only move wallet money. External purchases must
 * use the instance refund transaction, including after a move or transfer. */
export async function assertWalletRefundSource(tx: Prisma.TransactionClient, sourceId: number) {
  const bill = await tx.instanceBillingRecord.findUnique({ where: { id: sourceId } })
  if (!bill) throw new Error('实例账单不存在')
  const lineage = await getInstanceBillingLineageIds(bill.instanceId, tx)
  const purchases = await tx.instanceBillingRecord.findMany({ where: { instanceId: { in: lineage }, type: 'newPurchase', purchaseBatchId: { not: null } }, select: { purchaseBatchId: true } })
  const external = await tx.checkoutOrder.count({ where: { id: { in: purchases.map(row => row.purchaseBatchId!) }, paymentId: { not: 'balance' }, paidAt: { not: null } } })
  if (external) throw new Error('该实例包含第三方付款，请从计费中的实例退款入口按原支付方式退款')
}
