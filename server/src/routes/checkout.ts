import type { FastifyInstance } from 'fastify'
import { Readable } from 'node:stream'
import { prisma } from '../db/prisma.js'
import { turnstileVerifier } from '../lib/turnstile.js'
import { createCheckout, getCheckout, cancelCheckout, payCheckoutBalance, CheckoutError, lockCheckout, type CheckoutInput } from '../services/checkout-orders.js'
import { createCheckoutPayment, handleCheckoutCallback, verifyCheckoutPayments } from '../services/checkout-payments.js'
import { PoolOrderError } from '../services/pool-orders.js'
import { lockAdministrativeUserMutation } from '../db/user-write-authorization.js'
import { createLog } from '../db/logs.js'
import { advisoryTransactionLock, USER_BALANCE_LOCK_NAMESPACE } from '../db/advisory-locks.js'
import { publicPoolCatalog } from '../services/host-pool-prices.js'

const idParams = { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } }
export default async function checkoutRoutes(app: FastifyInstance) {
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_request, body, done) => {
    const values: Record<string, string> = {}
    for (const [key, value] of new URLSearchParams(body as string)) {
      if (Object.hasOwn(values, key)) { done(new CheckoutError('重复回调字段', 400)); return }
      Object.defineProperty(values, key, { value, enumerable: true })
    }
    done(null, values)
  })
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof CheckoutError) return reply.code(error.status).send({ error: error.message, code: error.code })
    if (error instanceof PoolOrderError) return reply.code(error.code === 'FORBIDDEN' ? 403 : 409).send({ error: error.message, code: error.code, ...error.details })
    if (error && typeof error === 'object' && 'validation' in error) return reply.code(400).send({ error: '请求参数无效' })
    return reply.code(500).send({ error: '订单处理暂时失败，请稍后重试', code: 'CHECKOUT_RETRY' })
  })
  app.addHook('onSend', async (_req, reply) => { reply.header('Cache-Control','no-store') })
  // Only the authenticated buyer can see stock their new intent may replace.
  // The public catalog and every allocation path still deduct all reservations.
  app.get<{ Querystring: { source: 'direct' | 'cart' } }>('/api/checkout/catalog', {
    onRequest: [app.authenticate], schema: { querystring: { type: 'object', additionalProperties: false,
      required: ['source'], properties: { source: { type: 'string', enum: ['direct','cart'] } } } }
  }, request => publicPoolCatalog({ userId: request.user.id, source: request.query.source }))
  app.post<{ Body: CheckoutInput }>('/api/checkout', { onRequest: [app.authenticate], config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: { body: { type: 'object', additionalProperties: false, required: ['requestId','source','items','expectedTotal'], properties: {
      requestId: { type: 'string', format: 'uuid' }, source: { type: 'string', enum: ['direct','cart'] },
      expectedTotal: { type: 'integer', minimum: 0, maximum: 100000000 }, sshKeyId: { type: ['integer','null'], minimum: 1 },
      turnstileToken: { type: 'string', maxLength: 2048 }, items: { type: 'array', minItems: 1, maxItems: 100, items: {
        type: 'object', additionalProperties: false, required: ['poolPriceId','quantity','namePrefix','image'], properties: {
          poolPriceId: { type: 'integer', minimum: 1, maximum: 2147483647 }, quantity: { type: 'integer', minimum: 1, maximum: 100 },
          namePrefix: { type: 'string', minLength: 2, maxLength: 60 }, image: { type: 'string', minLength: 1, maxLength: 200 },
          customInitCommandIds: { type: 'array', maxItems: 50, items: { type: 'integer', minimum: 1, maximum: 2147483647 } }
        }
      } }
    } } } }, async (request, reply) => {
    await turnstileVerifier(request, reply)
    if (reply.sent) return
    return createCheckout(request.user.id, request.body, request.user)
  })
  app.get<{ Querystring: { before?: string } }>('/api/checkout', { onRequest: [app.authenticate] }, async request => {
    const before = request.query.before ? await prisma.checkoutOrder.findFirst({ where: { id: request.query.before, userId: request.user.id }, select: { id: true, createdAt: true } }) : null
    if (request.query.before && !before) throw new CheckoutError('分页位置无效', 400)
    const orders = await prisma.checkoutOrder.findMany({ where: { userId: request.user.id, ...(before ? { OR: [{ createdAt: { lt: before.createdAt } }, { createdAt: before.createdAt, id: { lt: before.id } }] } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 21, select: { id: true, status: true, totalCents: true, display: true, createdAt: true, expiresAt: true } })
    return { orders: orders.slice(0,20), next: orders.length > 20 ? orders[19].id : null }
  })
  app.get<{ Params: { id: string } }>('/api/checkout/:id', { onRequest: [app.authenticate], schema: { params: idParams } }, request => getCheckout(request.user.id, request.params.id))
  app.post<{ Params: { id: string } }>('/api/checkout/:id/cancel', { onRequest: [app.authenticate], schema: { params: idParams } }, request => cancelCheckout(request.user.id, request.params.id, request.user))
  app.post<{ Params: { id: string } }>('/api/checkout/:id/balance', { onRequest: [app.authenticate], schema: { params: idParams } }, request => payCheckoutBalance(request.user.id, request.params.id, request.user))
  app.post<{ Params: { id: string }; Body: { providerId: number; method?: string } }>('/api/checkout/:id/payment', {
    onRequest: [app.authenticate], config: { rateLimit: { max: 20, timeWindow: '1 minute' } }, schema: { params: idParams,
      body: { type: 'object', additionalProperties: false, required: ['providerId'], properties: { providerId: { type: 'integer', minimum: 1 }, method: { type: 'string', maxLength: 64 } } } }
  }, request => createCheckoutPayment(request.user.id, request.params.id, request.body.providerId, request.body.method, request.user))
  app.post<{ Params: { id: string } }>('/api/checkout/:id/verify', { onRequest: [app.authenticate], schema: { params: idParams },
    config: { rateLimit: { max: 6, timeWindow: '1 minute' } } }, request => verifyCheckoutPayments(request.user.id, request.params.id, request.user))

  app.route<{ Params: { providerId: string } }>({ method: ['GET','POST'], url: '/api/checkout/callback/:providerId', bodyLimit: 262144,
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
    preParsing: async (request, _reply, payload) => {
      const chunks: Buffer[] = []; let size = 0
      for await (const chunk of payload) { size += chunk.length; if (size > 262144) throw new CheckoutError('请求过大', 413); chunks.push(Buffer.from(chunk)) }
      const body = Buffer.concat(chunks); (request as typeof request & { checkoutRaw: string }).checkoutRaw = body.toString('utf8')
      return Readable.from(body)
    }, handler: async request => {
      const data = request.method === 'GET' ? request.query : request.body
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new CheckoutError('回调格式无效', 400)
      return handleCheckoutCallback(Number(request.params.providerId), data as Record<string, unknown>, {
        method: request.method, requestUri: request.url.split('?')[0], ip: request.ip,
        requestTime: String(request.headers['request-time'] || ''), clientId: String(request.headers['client-id'] || ''),
        signature: String(request.headers.signature || ''), rawBody: (request as typeof request & { checkoutRaw?: string }).checkoutRaw || ''
      })
    } })
  app.get('/api/checkout-admin/refunds', { onRequest: [app.authenticateAdmin] }, async () => ({
    refunds: await prisma.checkoutRefund.findMany({ where: { status: 'pending' }, orderBy: { createdAt: 'asc' }, take: 100,
      include: { order: { select: { userId: true } }, payment: { select: { providerName: true, method: true } }, receipt: { select: { tradeNo: true, amountCents: true, currency: true } } } })
  }))
  app.post<{ Params: { id: string }; Body: { receipt: string } }>('/api/checkout-admin/refunds/:id/complete', {
    onRequest: [app.authenticateAdmin], schema: { body: { type: 'object', additionalProperties: false, required: ['receipt'],
      properties: { receipt: { type: 'string', minLength: 6, maxLength: 500 } } } }
  }, async request => {
    if (request.body.receipt.trim().length < 6) throw new CheckoutError('请填写有效退款回执', 400)
    await prisma.$transaction(async tx => {
      const refund = await tx.checkoutRefund.findUniqueOrThrow({ where: { id: request.params.id }, include: { order: true } })
      await advisoryTransactionLock(tx, USER_BALANCE_LOCK_NAMESPACE, refund.order.userId)
      await lockAdministrativeUserMutation(tx, refund.order.userId, request.user)
      await lockCheckout(tx, refund.orderId, refund.order.userId)
      await tx.checkoutRefund.updateMany({ where: { id: refund.id, status: 'pending' }, data: { status: 'refunded',
        resolution: request.body.receipt.trim(), handledAt: new Date(), handledById: request.user.id } })
      if (!await tx.checkoutRefund.count({ where: { orderId: refund.orderId, status: 'pending' } })) {
        await tx.checkoutOrder.updateMany({ where: { id: refund.orderId, status: 'refund_pending' }, data: { status: 'refunded' } })
      }
    })
    await createLog(request.user.id,'admin','checkout.refund','管理员登记购买订单原路退款回执','success')
    return { success: true }
  })
}
