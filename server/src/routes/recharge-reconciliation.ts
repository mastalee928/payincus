import type { FastifyInstance } from 'fastify'
import { prisma } from '../db/prisma.js'
import { completeRecharge, RechargePaymentSelectionChangedError } from '../db/recharge-records.js'
import { lockAdministrativeUserMutation } from '../db/user-write-authorization.js'
import { sendNotification } from '../lib/notifier.js'
import { advisoryTransactionLock, advisoryTransactionLockString, PAYMENT_SETTLEMENT_LOCK_NAMESPACE, USER_BALANCE_LOCK_NAMESPACE } from '../db/advisory-locks.js'

export default async function rechargeReconciliationRoutes(app: FastifyInstance) {
  app.get('/api/admin/billing/late-payments', { onRequest: [app.authenticate, app.requireAdmin] }, async (request, reply) => {
    if (request.user!.role !== 'admin') return reply.code(403).send({ error: '无权查看付款对账' })
    const { page: rawPage, status = 'pending' } = request.query as { page?: string; status?: string }
    if (!['pending', 'credited', 'resolved'].includes(status)) return reply.code(400).send({ error: '无效的处理状态' })
    const page = Math.max(1, Math.min(100000, Number(rawPage) || 1))
    if (!Number.isInteger(page)) return reply.code(400).send({ error: '无效的页码' })
    const [rows, total] = await Promise.all([
      prisma.rechargeLatePayment.findMany({ where: { status }, orderBy: { id: 'desc' }, skip: (page - 1) * 20, take: 20,
        include: { recharge: { include: { user: { select: { username: true } }, provider: { select: { name: true } } } } } }),
      prisma.rechargeLatePayment.count({ where: { status } })
    ])
    return { total, page, records: rows.map(row => ({ id: row.id, orderNo: row.recharge.orderNo, tradeNo: row.tradeNo,
      gatewayOrderNo: row.gatewayOrderNo, username: row.recharge.user.username, provider: row.recharge.provider.name,
      receivedAmount: row.receivedAmount, currency: row.currency, creditAmount: Number(row.recharge.actualAmount ?? row.recharge.amount),
      reason: row.reason, status: row.status, orderStatus: row.recharge.status, createdAt: row.createdAt,
      note: row.note, handledAt: row.handledAt,
      canCredit: row.eligible && row.status === 'pending' && ['cancelled', 'failed'].includes(row.recharge.status)
    })) }
  })
  app.post('/api/admin/billing/late-payments/:id/resolve', {
    onRequest: [app.authenticate, app.requireAdmin], config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const actor = request.user!
    if (actor.role !== 'admin') return reply.code(403).send({ error: '仅管理员可以处理付款' })
    const id = Number((request.params as { id: string }).id), body = request.body as { action?: string; note?: unknown }
    if (!Number.isSafeInteger(id) || id <= 0 || id > 2147483647 || !['credit', 'resolve'].includes(body?.action || '') ||
      typeof body.note !== 'string' || body.note.trim().length < 5 || body.note.trim().length > 500) {
      return reply.code(400).send({ error: '请选择处理方式，并填写5–500字的核对结论' })
    }
    const note = body.note.trim()
    try {
      const item = await prisma.rechargeLatePayment.findUnique({ where: { id }, include: { recharge: true } })
      if (!item) return reply.code(404).send({ error: '付款记录不存在' })
      if (body.action === 'credit') {
        const result = await completeRecharge(item.recharge.orderNo, { tradeNo: item.tradeNo, actor, latePaymentId: item.id,
          reconciliationNote: note, expectedPaymentDetails: item.expectedPaymentDetails as Record<string, unknown> | null })
        if (!result.completedNow && item.status !== 'credited') return reply.code(409).send({ error: '订单已入账或状态已变更，请刷新核对' })
        if (result.completedNow) await sendNotification(item.recharge.userId, 'recharge_success', {
          orderNo: result.orderNo, amount: Number(result.actualAmount ?? result.amount), tradeNo: result.tradeNo || undefined
        }).catch(error => request.log.warn(error, '补款已入账，但到账通知发送失败'))
        return { success: true, message: '付款已补入余额' }
      }
      await prisma.$transaction(async tx => {
        await advisoryTransactionLockString(tx, PAYMENT_SETTLEMENT_LOCK_NAMESPACE, `${item.providerId}:${item.tradeNo}`)
        await advisoryTransactionLock(tx, USER_BALANCE_LOCK_NAMESPACE, item.recharge.userId)
        await lockAdministrativeUserMutation(tx, item.recharge.userId, actor)
        const changed = await tx.rechargeLatePayment.updateMany({ where: { id, status: 'pending' },
          data: { status: 'resolved', note, handledById: actor.id, handledAt: new Date() } })
        if (!changed.count) throw new Error('LATE_PAYMENT_NOT_CREDITABLE')
      })
      return { success: true, message: '处理结论已保存，余额未变更' }
    } catch (error) {
      if (error instanceof Error && error.message === 'ADMIN_ACTOR_FORBIDDEN') return reply.code(403).send({ error: '管理员权限已变更，请重新登录' })
      if (error instanceof RechargePaymentSelectionChangedError || (error instanceof Error && error.message === 'LATE_PAYMENT_NOT_CREDITABLE')) {
        return reply.code(409).send({ error: '付款证据或订单状态已变更，无法补款，请刷新核对' })
      }
      request.log.error(error, '迟到付款处理失败')
      return reply.code(500).send({ error: '付款处理失败，请稍后重试' })
    }
  })
}
