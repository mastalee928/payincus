import type { FastifyInstance } from 'fastify'
import { normalizeOrigin } from '../lib/origin-config.js'
import { requestSimpleGatewaySetup, readSimpleGatewaySetup, simpleGatewayExecutorAvailable, confirmSimpleGatewaySetup, latestSimpleGatewaySetup, simpleGatewayStatus, type SimpleGatewayInput } from '../services/simple-gateway-setup.js'
import { LocalGatewaySetupError } from '../lib/local-gateway-setup.js'

const installed = { request: requestSimpleGatewaySetup, read: readSimpleGatewaySetup, available: simpleGatewayExecutorAvailable, confirm: confirmSimpleGatewaySetup, latest: latestSimpleGatewaySetup, status: simpleGatewayStatus }
type Operations = Omit<typeof installed, 'latest' | 'status'> & { latest?: typeof latestSimpleGatewaySetup; status?: typeof simpleGatewayStatus }
export async function registerSimpleGatewaySetupRoutes(app: FastifyInstance, operations: Operations = installed) {
  app.get('/gateway/setup', { onRequest: [app.authenticateAdmin], config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    const [latest, gateway] = await Promise.all([operations.latest?.(request.user.id), operations.status?.()])
    return { available: operations.available(), latest: latest || null, gateway: gateway || null }
  })
  app.post<{ Body: SimpleGatewayInput }>('/gateway/setup', { onRequest: [app.authenticateAdmin], bodyLimit: 4096,
    config: { rateLimit: { max: 3, timeWindow: '1 minute' } },
    schema: { body: { type: 'object', additionalProperties: false, required: ['requestId', 'sshAddress', 'password'], properties: {
      requestId: { type: 'string', format: 'uuid' }, sshAddress: { type: 'string', minLength: 1, maxLength: 253 }, password: { type: 'string', minLength: 1, maxLength: 1024 }
    } } }
  }, async (request, reply) => {
    const origins = (process.env.ADMIN_FRONTEND_URL || '').split(',').map(value => normalizeOrigin(value.trim())).filter(Boolean)
    if (!request.user.sid || !origins.includes(String(request.headers.origin)) || request.headers['sec-fetch-site'] === 'cross-site' ||
      !request.headers.authorization?.startsWith('Bearer ')) return reply.code(403).send({ code: 'GATEWAY_WEB_SESSION_REQUIRED' })
    try { return reply.code(202).send(await operations.request(request.body, request.user.id, request.user.sid)) }
    catch (error) { return reply.code(400).send({ code: error instanceof LocalGatewaySetupError ? error.code : 'SIMPLE_GATEWAY_FAILED' }) }
  })
  app.post<{ Params: { id: string }; Body: { planHash: string } }>('/gateway/setup/:id/confirm', {
    onRequest: [app.authenticateAdmin], bodyLimit: 1024,
    schema: { params: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
      body: { type: 'object', additionalProperties: false, required: ['planHash'], properties: { planHash: { type: 'string', pattern: '^[a-f0-9]{64}$' } } } }
  }, async (request, reply) => {
    const origins = (process.env.ADMIN_FRONTEND_URL || '').split(',').map(value => normalizeOrigin(value.trim())).filter(Boolean)
    if (!request.user.sid || !origins.includes(String(request.headers.origin)) || request.headers['sec-fetch-site'] === 'cross-site' ||
      !request.headers.authorization?.startsWith('Bearer ')) return reply.code(403).send({ code: 'GATEWAY_WEB_SESSION_REQUIRED' })
    try { return reply.code(202).send(await operations.confirm(request.params.id, request.body.planHash, request.user.id, request.user.sid)) }
    catch (error) { return reply.code(409).send({ code: error instanceof LocalGatewaySetupError ? error.code : 'SIMPLE_GATEWAY_FAILED' }) }
  })
  app.get<{ Params: { id: string } }>('/gateway/setup/:id', { onRequest: [app.authenticateAdmin],
    schema: { params: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } } }
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    try { const state = await operations.read(request.params.id); return state.actorId === request.user.id ? state : reply.code(403).send({ code: 'SIMPLE_GATEWAY_ADMIN_REQUIRED' }) }
    catch { return reply.code(404).send({ code: 'SIMPLE_GATEWAY_TASK_NOT_FOUND' }) }
  })
}
export default async function simpleGatewaySetupRoutes(app: FastifyInstance) { await registerSimpleGatewaySetupRoutes(app) }
