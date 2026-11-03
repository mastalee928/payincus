import { randomUUID } from 'node:crypto'
import { Prisma, type CheckoutPayment } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import * as db from '../db/index.js'
import type { WriteSession } from '../db/user-write-authorization.js'
import { buildEpayConfig, createRechargePayUrl, getRechargeCallbackBaseUrl, getRechargeFrontendUrl, isIpInWhitelist } from '../routes/recharge.js'
import { createEpayClient, type CallbackData } from '../lib/epay.js'
import { buildHeleketConfig, createHeleketClient, getHeleketInvoiceAmount, getHeleketPaymentState } from '../lib/heleket.js'
import { buildUpayProConfig, verifyUpayProNotification } from '../lib/upaypro.js'
import { AntomClient, antomNotificationResponse, buildAntomConfig, calculateAntomMinorAmount, verifyAntomWebhook, type AntomPaymentNotification } from '../lib/antom.js'
import { buildUpayProPaymentDetails, readRechargePaymentDetails } from '../lib/recharge-payment-details.js'
import { buildRechargeProviderConfigSnapshot, parseRechargeProviderConfigSnapshot } from '../lib/recharge-provider-snapshot.js'
import { checkoutOpen, CheckoutError, getCheckout, lockCheckout, settleCheckoutPayment } from './checkout-orders.js'
import { parsePositivePaymentMoney } from '../lib/payment-money.js'
import { recoveryHeld } from './platform-backup-core.js'

const supported = new Set(['yipay','upaypro','heleket','antom'])
function frozenConfig(payment: CheckoutPayment) {
  const parsed = parseRechargeProviderConfigSnapshot(payment.configSnapshot)
  if (!parsed || parsed.type !== payment.providerType) throw new CheckoutError('支付配置暂时无法读取', 503)
  return parsed.config
}
export async function createCheckoutPayment(userId: number, orderId: string, providerId: number, requestedMethod: string | undefined, session: WriteSession) {
  if (recoveryHeld()) throw new CheckoutError('系统正在恢复，请稍后重试', 503)
  const provider = await db.getPaymentProviderById(providerId)
  if (!provider || provider.status !== 'active' || !supported.has(provider.type)) throw new CheckoutError('此支付方式暂不可用', 400)
  const config = (typeof provider.config === 'string' ? JSON.parse(provider.config) : provider.config) as Record<string, unknown>
  const methods = Array.isArray(provider.methods) ? provider.methods as string[] : []
  const method = provider.type === 'yipay' ? requestedMethod || methods[0] || 'alipay' : provider.type === 'upaypro' ? buildUpayProConfig(config).config.payment_type : ''
  if (provider.type === 'yipay' && !(methods.length ? methods : ['alipay']).includes(method)) throw new CheckoutError('此支付方式未启用', 400)
  const validation = provider.type === 'yipay' ? buildEpayConfig(config) : provider.type === 'upaypro' ? buildUpayProConfig(config) : provider.type === 'heleket' ? buildHeleketConfig(config) : buildAntomConfig(config)
  if (!validation.valid) throw new CheckoutError(validation.error || '支付渠道配置不完整', 400)
  if (provider.type === 'heleket' && buildHeleketConfig(config).heleketConfig.currency !== 'CNY') throw new CheckoutError('此渠道暂不支持人民币购买订单', 400)
  const created = await prisma.$transaction(async tx => {
    const order = await lockCheckout(tx, orderId, userId, session)
    if (!checkoutOpen(order)) throw new CheckoutError('订单已付款或关闭，请查看订单状态')
    const existing = await tx.checkoutPayment.findUnique({ where: { orderId_providerId_method: { orderId, providerId, method } } })
    if (existing) return { payment: existing, created: false }
    const amount = order.totalCents / 100
    const range = db.validateRechargeAmount(provider, amount)
    if (!range.valid) throw new CheckoutError(range.error || '金额不在此支付方式支持范围内', 400)
    // Purchase fees are charged on top of the fixed product price, never a wallet gross-up.
    const feeCents = Math.round(db.calculatePaymentFee(provider, amount, method || undefined) * 100)
    if (!Number.isSafeInteger(feeCents) || feeCents < 0) throw new CheckoutError('支付手续费配置无效', 400)
    const payment = await tx.checkoutPayment.create({ data: { id: `P${randomUUID().replaceAll('-','')}`, orderId, providerId,
      providerType: provider.type, providerName: provider.name, method, payableCents: order.totalCents + feeCents, feeCents,
      configSnapshot: buildRechargeProviderConfigSnapshot(provider.type, config), details: {} } })
    return { payment, created: true }
  })
  const payment = created.payment
  // Never create another invoice after an uncertain external response. The same identity remains payable/queryable.
  if (created.created || (payment.providerType === 'yipay' && !payment.payUrl)) {
    const frontend = getRechargeFrontendUrl(), callback = getRechargeCallbackBaseUrl()
    const returnUrl = `${frontend}/order/confirm?checkout=${encodeURIComponent(orderId)}&payment=${encodeURIComponent(`${providerId}:${payment.providerType === 'upaypro' ? '' : payment.method}`)}`
    try {
      const frozen = frozenConfig(payment)
      const reply = await createRechargePayUrl({ id: providerId, type: payment.providerType, methods }, frozen, payment.id,
        payment.payableCents / 100, payment.method || undefined, { notifyUrl: `${callback}/api/checkout/callback/${providerId}`,
          returnUrl, successUrl: returnUrl }, '购买云服务器')
      if (!reply.payUrl || !/^https?:\/\//i.test(reply.payUrl)) throw new Error('Missing payment URL')
      const details = reply.upayOrder ? buildUpayProPaymentDetails(reply.upayOrder, buildUpayProConfig(frozen).config) : {}
      await prisma.$transaction(async tx => {
        const order = await lockCheckout(tx, orderId, userId)
        const expiry = reply.upayOrder?.expiresAt ?? (payment.providerType === 'heleket' ? Date.now() + buildHeleketConfig(frozen).heleketConfig.lifetimeSeconds * 1000 : order.expiresAt.getTime())
        if (order.status === 'pending' && expiry < order.expiresAt.getTime()) await tx.checkoutOrder.update({ where: { id: orderId }, data: { expiresAt: new Date(expiry) } })
        await tx.checkoutPayment.update({ where: { id: payment.id }, data: { payUrl: reply.payUrl, details: details as Prisma.InputJsonValue } })
        await tx.checkoutPayment.updateMany({ where: { id: payment.id, status: 'creating' }, data: { status: 'pending' } })
      })
    } catch {
      await prisma.checkoutPayment.updateMany({ where: { id: payment.id, status: 'creating' }, data: { status: 'uncertain' } })
      throw new CheckoutError('支付链接暂未取得，可更换支付方式；当前订单会继续核对付款状态', 503)
    }
  }
  if (!created.created && !payment.payUrl && payment.providerType !== 'yipay') {
    throw new CheckoutError('支付链接暂未取得，请选择其他方式或取消订单', 503)
  }
  // Persist gateway evidence even after a cancellation, but do not return a
  // navigable response to a session revoked while the gateway was responding.
  await prisma.$transaction(tx => lockCheckout(tx, orderId, userId, session))
  return getCheckout(userId, orderId)
}

export async function handleCheckoutCallback(providerId: number, data: Record<string, unknown>, meta: {
  method: string; requestUri: string; requestTime: string; clientId: string; signature: string; rawBody: string; ip: string
}) {
  const orderNo = data.out_trade_no ?? data.order_id ?? data.paymentRequestId
  if (typeof orderNo !== 'string') throw new CheckoutError('缺少订单号', 400)
  const payment = await prisma.checkoutPayment.findUnique({ where: { id: orderNo } })
  if (!payment || payment.providerId !== providerId) throw new CheckoutError('订单不存在', 404)
  if (!isIpInWhitelist(meta.ip, payment.providerType)) throw new CheckoutError('回调来源不被允许', 403)
  const config = frozenConfig(payment)
  let tradeNo = '', amount: number | undefined, currency = 'CNY', paid = false, reviewReason: string | undefined
  if (payment.providerType === 'yipay') {
    const built = buildEpayConfig(config)
    if (!built.valid) throw new CheckoutError('支付配置不可用', 503)
    const result = createEpayClient(built.epayConfig).verifyWithStatus(data as CallbackData)
    if (!result.valid) throw new CheckoutError('签名验证失败', 400)
    if (data.type !== payment.method) throw new CheckoutError('支付方式不匹配', 400)
    paid = result.tradeSuccess; tradeNo = typeof data.trade_no === 'string' ? data.trade_no : ''
    amount = parsePositivePaymentMoney(data.money)
  } else if (payment.providerType === 'upaypro') {
    const built = buildUpayProConfig(config)
    const notice = meta.method === 'POST' ? verifyUpayProNotification(data, built.config.secret_key) : null
    if (!notice) throw new CheckoutError('签名验证失败', 400)
    const invoice = readRechargePaymentDetails(payment.details).upaypro
    if (!invoice) {
      if (payment.status === 'creating') throw new CheckoutError('支付订单正在保存，请重试通知', 503)
      // A signed receipt can arrive after the create response was lost. Retain
      // this money as a refund obligation; absent invoice/network evidence must
      // never authorize delivery or silently discard a real payment.
      reviewReason = 'invoice_unavailable'
    } else if (invoice.orderId !== payment.id || invoice.tradeId !== notice.trade_id || invoice.paymentType !== built.config.payment_type ||
      invoice.paymentAmount !== notice.actual_amount || invoice.address !== notice.token || Math.round(Number(invoice.invoiceAmount) * 100) !== payment.payableCents) {
      throw new CheckoutError('支付订单或币种网络不匹配', 400)
    }
    paid = notice.status === 2; tradeNo = notice.trade_id; amount = notice.amount
  } else if (payment.providerType === 'heleket') {
    const built = buildHeleketConfig(config)
    if (!createHeleketClient(built.heleketConfig).verifyWebhookSignature(data)) throw new CheckoutError('签名验证失败', 400)
    currency = built.heleketConfig.currency || 'CNY'
    // Purchase prices are CNY; do not interpret a different invoice currency as CNY.
    if (currency !== 'CNY') throw new CheckoutError('订单币种不匹配', 400)
    paid = getHeleketPaymentState(data) === 'paid'
    amount = getHeleketInvoiceAmount(data, currency)
    tradeNo = typeof data.uuid === 'string' ? data.uuid : ''
  } else if (payment.providerType === 'antom') {
    const built = buildAntomConfig(config)
    if (!built.valid || !verifyAntomWebhook({ config: built.config, ...meta })) throw new CheckoutError('签名验证失败', 400)
    const notice = data as unknown as AntomPaymentNotification
    if (notice.notifyType !== 'PAYMENT_RESULT') return antomNotificationResponse(true)
    paid = notice.result?.resultStatus === 'S' && notice.result?.resultCode === 'SUCCESS'
    const paidAmount = notice.actualPaymentAmount || notice.paymentAmount
    if (paid && (!paidAmount || paidAmount.currency !== built.config.currency || paidAmount.value !== calculateAntomMinorAmount(payment.payableCents / 100, built.config))) throw new CheckoutError('支付金额不匹配', 400)
    amount = payment.payableCents / 100; tradeNo = notice.paymentId || ''
  }
  if (paid) {
    if (amount === undefined) throw new CheckoutError('缺少有效支付金额', 400)
    await settleCheckoutPayment(payment.id, tradeNo, Math.round(amount * 100), currency, data, reviewReason)
  }
  if (payment.providerType === 'upaypro') return 'ok'
  if (payment.providerType === 'antom') return antomNotificationResponse(true)
  if (payment.providerType === 'yipay' && config.version === 'v1') return 'success'
  return { code: 'SUCCESS', message: 'OK' }
}

export async function verifyCheckoutPayments(userId: number, orderId: string, session?: WriteSession) {
  if (recoveryHeld()) throw new CheckoutError('系统正在恢复，请稍后重试', 503)
  if (session) await prisma.$transaction(tx => lockCheckout(tx, orderId, userId, session))
  const order = await prisma.checkoutOrder.findFirst({ where: { id: orderId, userId }, include: { payments: true } })
  if (!order) throw new CheckoutError('订单不存在', 404)
  for (const payment of order.payments.filter(row => row.status !== 'paid')) {
    const config = frozenConfig(payment)
    if (payment.providerType === 'yipay' && config.version === 'v1') {
      const result = await createEpayClient(buildEpayConfig(config).epayConfig).queryOrder(payment.id)
      if (result.success && result.paid && result.out_trade_no === payment.id && result.type === payment.method && result.trade_no) {
        const amount = parsePositivePaymentMoney(result.money)
        if (amount !== undefined) await settleCheckoutPayment(payment.id, result.trade_no, Math.round(amount * 100), 'CNY', result.rawData || {})
      }
    } else if (payment.providerType === 'heleket') {
      const built = buildHeleketConfig(config)
      const info = await createHeleketClient(built.heleketConfig).getPaymentInfo({ order_id: payment.id })
      if (info.order_id === payment.id && getHeleketPaymentState(info) === 'paid' && info.uuid) {
        const amount = getHeleketInvoiceAmount(info, 'CNY')
        if (amount !== undefined) await settleCheckoutPayment(payment.id, info.uuid, Math.round(amount * 100), 'CNY', info as unknown as Record<string, unknown>)
      }
    } else if (payment.providerType === 'antom') {
      const built = buildAntomConfig(config)
      const result = await new AntomClient(built.config).inquiryPayment(payment.id)
      const paidAmount = result.actualPaymentAmount || result.paymentAmount
      if (result.result?.resultStatus === 'S' && result.paymentStatus === 'SUCCESS' && result.paymentRequestId === payment.id && result.paymentId &&
        paidAmount?.currency === built.config.currency && paidAmount.value === calculateAntomMinorAmount(payment.payableCents / 100, built.config)) {
        await settleCheckoutPayment(payment.id, result.paymentId, payment.payableCents, 'CNY', result as Record<string, unknown>)
      }
    }
  }
  return getCheckout(userId, orderId)
}

/** Poll supported gateways even if the customer closes the browser. Failures
 * retain the receipt identity; never create a replacement invoice here. */
export async function reconcileCheckoutPayments() {
  if (recoveryHeld()) return
  const payments = await prisma.checkoutPayment.findMany({ where: { status: { in: ['pending','creating','uncertain'] },
    providerType: { in: ['yipay','heleket','antom'] }, updatedAt: { lt: new Date(Date.now() - 60000) },
    createdAt: { gt: new Date(Date.now() - 7 * 86400000) } }, take: 5, orderBy: { updatedAt: 'asc' }, include: { order: true } })
  for (const payment of payments) {
    if (recoveryHeld()) return
    await prisma.checkoutPayment.update({ where: { id: payment.id }, data: { updatedAt: new Date() } })
    try { await verifyCheckoutPayments(payment.order.userId, payment.orderId) }
    catch { /* Next sweep retries; callbacks remain independently available. */ }
  }
}
