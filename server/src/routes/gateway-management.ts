import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { GatewayTaskError } from '../lib/gateway-task-plan.js'
import { OnboardingError } from '../lib/host-onboarding.js'
import { normalizeOrigin } from '../lib/origin-config.js'
import { getManagementGatewayTask, inspectManagementGateway, listManagementGateways, type ManagementGatewayInspectInput } from '../services/gateway-management.js'
import { requestGatewayInstallation, confirmGatewayInstallation, cancelGatewayInstallation, retrieveGatewayBootstrap,
  type GatewayInstallationInput, type GatewayInstallationConfirmation } from '../services/gateway-installation-management.js'
import { startGatewayInstallationDispatcher } from '../services/gateway-installation-dispatcher.js'

export interface GatewayManagementOperations {
  list: typeof listManagementGateways
  task: typeof getManagementGatewayTask
  inspect: typeof inspectManagementGateway
  install?: typeof requestGatewayInstallation
  confirm?: typeof confirmGatewayInstallation
  cancel?: typeof cancelGatewayInstallation
  bootstrap?: typeof retrieveGatewayBootstrap
}
export async function registerGatewayManagementRoutes(fastify: FastifyInstance, operations: GatewayManagementOperations) {
  const webMutation = async (request: FastifyRequest, reply: FastifyReply) => {
    // This control plane requires a Web session and the configured admin origin.
    // It cannot be called by PAT, a gateway cookie, or a cross-origin page.
    const allowed = (process.env.ADMIN_FRONTEND_URL || '').split(',').map(value => normalizeOrigin(value.trim())).filter(Boolean)
    const origin = request.headers.origin
    if (!request.user.sid || typeof origin !== 'string' || !allowed.includes(origin) ||
      request.headers['sec-fetch-site'] === 'cross-site' || !request.headers.authorization?.startsWith('Bearer ')) {
      return reply.code(403).send({ code: 'GATEWAY_WEB_SESSION_REQUIRED' })
    }
  }
  const failure = (reply: FastifyReply, error: unknown) => {
    if (error instanceof GatewayTaskError || error instanceof OnboardingError) {
      const code = error.code
      return reply.code(code === 'GATEWAY_TASK_NOT_FOUND' ? 404 : code.includes('BUSY') || code.includes('CONFLICT') ? 409 :
        code === 'GATEWAY_PLATFORM_NOT_CONFIGURED' || code === 'GATEWAY_INSTALL_EXECUTOR_UNAVAILABLE' ? 503 : 400).send({ code })
    }
    return reply.code(500).send({ code: 'GATEWAY_MANAGEMENT_FAILED' })
  }
  fastify.get('/management-gateways', { onRequest: [fastify.authenticateAdmin], config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (_request, reply) => {
    reply.header('Cache-Control', 'no-store')
    try { return await operations.list() } catch (error) { return failure(reply, error) }
  })
  fastify.get<{ Params: { id: string } }>('/management-gateways/tasks/:id', { onRequest: [fastify.authenticateAdmin],
    schema: { params: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } } }
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    try { return await operations.task(request.params.id) } catch (error) { return failure(reply, error) }
  })
  fastify.post<{ Body: ManagementGatewayInspectInput }>('/management-gateways/inspect', {
    onRequest: [fastify.authenticateAdmin, webMutation], bodyLimit: 40000,
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    schema: { body: { type: 'object', additionalProperties: false, required: ['requestId', 'gatewayId', 'name', 'mode', 'target', 'configuration'], properties: {
      requestId: { type: 'string', format: 'uuid' }, gatewayId: { type: 'string', format: 'uuid' }, name: { type: 'string', minLength: 1, maxLength: 80 },
      mode: { enum: ['local', 'remote', 'existing'] }, target: { anyOf: [{ type: 'null' }, { type: 'object', additionalProperties: false,
        required: ['address', 'port', 'fingerprint'], properties: { address: { type: 'string', minLength: 1, maxLength: 253 }, port: { type: 'integer', minimum: 1, maximum: 65535 }, fingerprint: { type: 'string', pattern: '^SHA256:[A-Za-z0-9+/]{43}$' } } }] },
      configuration: { type: 'object', additionalProperties: false, required: ['slot', 'network', 'address', 'listenPort', 'consolePort'], properties: {
        slot: { enum: ['a', 'b'] }, network: { type: 'string', maxLength: 18 }, address: { type: 'string', maxLength: 15 },
        listenPort: { type: 'integer', minimum: 1024, maximum: 65535 }, consolePort: { type: 'integer', minimum: 1024, maximum: 65535 }
      } }, credentials: { type: 'object', additionalProperties: false, properties: { password: { type: 'string', maxLength: 1024 }, privateKey: { type: 'string', maxLength: 32768 } } }
    } } }
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    try { return await operations.inspect(request.body, request.user.id) } catch (error) { return failure(reply, error) }
  })
  const params = { type: 'object', additionalProperties: false, required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } }
  if (operations.install) fastify.post<{ Body: GatewayInstallationInput }>('/management-gateways/installations', {
    onRequest: [fastify.authenticateAdmin, webMutation], bodyLimit: 40000, config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    schema: { body: { type: 'object', additionalProperties: false, required: ['requestId', 'gatewayId', 'configuration'], properties: {
      requestId: { type: 'string', format: 'uuid' }, gatewayId: { type: 'string', format: 'uuid' },
      configuration: { type: 'object', additionalProperties: false, required: ['slot', 'network', 'address', 'listenPort', 'consolePort', 'consoleOrigin'], properties: {
        slot: { enum: ['a', 'b'] }, network: { type: 'string', maxLength: 18 }, address: { type: 'string', maxLength: 15 },
        listenPort: { type: 'integer', minimum: 1024, maximum: 65535 }, consolePort: { type: 'integer', minimum: 1024, maximum: 65535 }, consoleOrigin: { type: 'string', maxLength: 300 }
      } }, credentials: { type: 'object', additionalProperties: false, properties: { password: { type: 'string', maxLength: 1024 }, privateKey: { type: 'string', maxLength: 32768 } } }
    } } }
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    try { const task = await operations.install!(request.body, request.user.id); return reply.code(202).send(task) } catch (error) { return failure(reply, error) }
  })
  if (operations.confirm) fastify.post<{ Params: { id: string }; Body: GatewayInstallationConfirmation }>('/management-gateways/tasks/:id/confirm', {
    onRequest: [fastify.authenticateAdmin, webMutation], bodyLimit: 4096, config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    schema: { params, body: { type: 'object', additionalProperties: false, required: ['planHash', 'confirmation', 'password'], properties: {
      planHash: { type: 'string', pattern: '^[a-f0-9]{64}$' }, confirmation: { type: 'string', maxLength: 44 }, password: { type: 'string', minLength: 1, maxLength: 256 }, totpCode: { type: 'string', pattern: '^[0-9]{6}$' }
    } } }
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    try { return reply.code(202).send(await operations.confirm!(request.params.id, request.body, request.user.id, request.user.sid!)) } catch (error) { return failure(reply, error) }
  })
  if (operations.cancel) fastify.post<{ Params: { id: string }; Body: Record<string, never> }>('/management-gateways/tasks/:id/cancel', {
    onRequest: [fastify.authenticateAdmin, webMutation], schema: { params, body: { type: 'object', additionalProperties: false, properties: {} } }
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    try { return await operations.cancel!(request.params.id, request.user.id) } catch (error) { return failure(reply, error) }
  })
  if (operations.bootstrap) fastify.post<{ Params: { id: string }; Body: { password?: string; totpCode?: string } }>('/management-gateways/tasks/:id/bootstrap', {
    onRequest: [fastify.authenticateAdmin, webMutation], bodyLimit: 4096, config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    schema: { params, body: { type: 'object', additionalProperties: false, properties: { password: { type: 'string', minLength: 1, maxLength: 256 }, totpCode: { type: 'string', pattern: '^[0-9]{6}$' } } } }
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store').header('Pragma', 'no-cache')
    try { return await operations.bootstrap!(request.params.id, request.body, request.user.id, request.user.sid!) } catch (error) { return failure(reply, error) }
  })
}
export default async function gatewayManagementRoutes(fastify: FastifyInstance) {
  await registerGatewayManagementRoutes(fastify, { list: listManagementGateways, task: getManagementGatewayTask, inspect: inspectManagementGateway,
    install: requestGatewayInstallation, confirm: confirmGatewayInstallation, cancel: cancelGatewayInstallation, bootstrap: retrieveGatewayBootstrap })
  let stop: (() => void) | undefined
  fastify.addHook('onReady', async () => { stop = startGatewayInstallationDispatcher() })
  fastify.addHook('onClose', async () => { stop?.() })
}
