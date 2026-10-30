import type { FastifyError, FastifyInstance } from 'fastify'
import { AdminInstancePushError, adminInstancePushPreview, adminInstancePushTarget, createAdminInstancePush } from '../services/admin-instance-push.js'

export default async function adminInstancePushRoutes(fastify: FastifyInstance) {
  const params = { type: 'object', required: ['id'], properties: { id: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER } } }
  fastify.setErrorHandler<FastifyError>((error, request, reply) => {
    if (error instanceof AdminInstancePushError) return reply.code(error.status).send({ code: error.code, error: error.message,
      ...(error.code === 'VERIFICATION_REQUIRED' ? { required: true } : {}) })
    if (error.validation) return reply.code(400).send({ code: 'INVALID_PARAMS', error: '输入格式不正确' })
    if (error.statusCode && error.statusCode < 500) return reply.code(error.statusCode).send({ code: error.code, error: error.message })
    request.log.error(error)
    return reply.code(500).send({ code: 'INTERNAL_ERROR', error: '暂时无法处理实例转移' })
  })
  fastify.get<{ Params: { id: number } }>('/:id', { onRequest: [fastify.authenticateAdmin], schema: { params } }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    return adminInstancePushPreview(request.params.id)
  })
  fastify.get<{ Params: { id: number }; Querystring: { username: string } }>('/:id/target', {
    onRequest: [fastify.authenticateAdmin], schema: { params, querystring: { type: 'object', required: ['username'], properties: {
      username: { type: 'string', minLength: 2, maxLength: 64 }
    } } }
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    return { user: await adminInstancePushTarget(request.params.id, request.query.username) }
  })
  fastify.post<{ Params: { id: number }; Body: { targetUsername: string; expectedOwnerId: number; expectedFee: number; acknowledge: boolean; remark?: string } }>('/:id', {
    onRequest: [fastify.authenticateAdmin], config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: { params, body: { type: 'object', additionalProperties: false, required: ['targetUsername', 'expectedOwnerId', 'expectedFee', 'acknowledge'], properties: {
      targetUsername: { type: 'string', minLength: 2, maxLength: 64 }, expectedOwnerId: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
      expectedFee: { type: 'number', minimum: 0 }, acknowledge: { type: 'boolean' }, remark: { type: 'string', maxLength: 200 }
    } } }
  }, async (request, reply) => reply.code(201).send(await createAdminInstancePush(request.params.id, request.user.id, request.body, request.user)))
}
