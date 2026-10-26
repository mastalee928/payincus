/**
 * 一机一卖的多台订单接口：购物车结算与「直接付款」共用。
 * 挂在 /api/instances 前缀下。
 */
import type { FastifyInstance } from 'fastify'
import { turnstileVerifier } from '../lib/turnstile.js'
import { apiError, ErrorCode, type ErrorCodeType } from '../lib/errors.js'
import { getPoolOrderResult, placePoolOrder, PoolOrderError, type PoolOrderInput } from '../services/pool-orders.js'
import { prisma } from '../db/prisma.js'

const STATUS_BY_CODE: Partial<Record<ErrorCodeType, number>> = {
  [ErrorCode.POOL_STOCK_SHORT]: 409,
  [ErrorCode.POOL_PRICE_CHANGED]: 409,
  [ErrorCode.SSH_KEY_NOT_OWNED]: 403
}

export default async function poolOrderRoutes(fastify: FastifyInstance) {
  fastify.post<{ Body: { requestId: string; username: string; name: string; poolPriceId: number; image: string;
    expectedTotal: number; billing: 'free' | 'paid'; chargeFirstMonth: boolean } }>('/admin/pool-create', {
    onRequest: [fastify.authenticateAdmin],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: { body: { type: 'object', additionalProperties: false,
      required: ['requestId', 'username', 'name', 'poolPriceId', 'image', 'expectedTotal', 'billing', 'chargeFirstMonth'], properties: {
        requestId: { type: 'string', format: 'uuid' }, username: { type: 'string', minLength: 1, maxLength: 64 },
        name: { type: 'string', minLength: 2, maxLength: 60 }, poolPriceId: { type: 'integer', minimum: 1 },
        image: { type: 'string', minLength: 1, maxLength: 200 }, expectedTotal: { type: 'integer', minimum: 0 },
        billing: { type: 'string', enum: ['free', 'paid'] }, chargeFirstMonth: { type: 'boolean' }
      } } }
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    const target = await prisma.user.findUnique({ where: { username: request.body.username }, select: { id: true, username: true, status: true } })
    if (!target || target.status !== 'active') return reply.code(400).send(apiError(ErrorCode.USER_NOT_FOUND))
    const key = await prisma.sshKey.findFirst({ where: { userId: target.id }, orderBy: { id: 'asc' }, select: { id: true } })
    try {
      const result = await placePoolOrder(target.id, target.username, {
        requestId: request.body.requestId, expectedTotal: request.body.expectedTotal, sshKeyId: key?.id ?? null,
        items: [{ poolPriceId: request.body.poolPriceId, quantity: 1, namePrefix: request.body.name, image: request.body.image }]
      }, { actorId: request.user.id, billing: request.body.billing, chargeFirstMonth: request.body.chargeFirstMonth })
      return reply.code(202).send(result)
    } catch (error) {
      if (error instanceof PoolOrderError) return reply.code(STATUS_BY_CODE[error.code] ?? 400).send({ ...apiError(error.code, error.message), ...error.details })
      throw error
    }
  })
  fastify.post<{ Body: PoolOrderInput }>('/pool-order', {
    onRequest: [fastify.authenticate],
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['requestId', 'items', 'expectedTotal'],
        properties: {
          requestId: { type: 'string', format: 'uuid' },
          turnstileToken: { type: 'string', maxLength: 2048 },
          items: {
            type: 'array',
            minItems: 1,
            maxItems: 200,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['poolPriceId', 'quantity', 'namePrefix', 'image'],
              properties: {
                poolPriceId: { type: 'integer', minimum: 1 },
                quantity: { type: 'integer', minimum: 1, maximum: 1000 },
                namePrefix: { type: 'string', minLength: 2, maxLength: 60 },
                image: { type: 'string', minLength: 1, maxLength: 200 },
                customInitCommandIds: { type: 'array', maxItems: 50, items: { type: 'integer', minimum: 1 } }
              }
            }
          },
          sshKeyId: { type: ['integer', 'null'], minimum: 1 },
          expectedTotal: { type: 'integer', minimum: 0 }
        }
      }
    }
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    await turnstileVerifier(request, reply)
    if (reply.sent) return
    try {
      const result = await placePoolOrder(request.user.id, request.user.username, request.body)
      return reply.code(202).send(result)
    } catch (error) {
      if (error instanceof PoolOrderError) {
        return reply.code(STATUS_BY_CODE[error.code] ?? 400).send({ ...apiError(error.code, error.message), ...error.details })
      }
      throw error
    }
  })
  fastify.get<{ Params: { id: string } }>('/pool-orders/:id', {
    onRequest: [fastify.authenticate], schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } } }
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    const order = await getPoolOrderResult(request.user.id, request.params.id)
    if (!order) return reply.code(404).send(apiError(ErrorCode.NOT_FOUND))
    return order
  })

}
