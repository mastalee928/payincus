import type { FastifyInstance } from 'fastify'
import { normalizeOrigin } from '../lib/origin-config.js'
import { normalizeOnboardingAddress, OnboardingError } from '../lib/host-onboarding.js'
import { stableGatewayEndpointText, validateStableGatewayEndpoint } from '../lib/onboarding-gateway-endpoint.js'
import { recoveryHeld } from '../services/platform-backup-core.js'
import { loadStableGatewayEndpoint, saveStableGatewayEndpoint, resolveGatewayEndpointAddress } from '../services/onboarding-gateway-endpoint.js'
import { gatewayCommand, gatewayConfigured } from '../services/onboarding-ssh.js'
import { listHostGatewayDns, queueHostGatewayDns, startHostGatewayDnsDispatcher } from '../services/host-gateway-dns.js'

const installedOperations = {
  load: loadStableGatewayEndpoint, save: saveStableGatewayEndpoint,
  resolve: resolveGatewayEndpointAddress, gateway: gatewayCommand, configured: gatewayConfigured,
  hosts: listHostGatewayDns, install: async (id: string, actor: number) => queueHostGatewayDns(actor, id), queue: queueHostGatewayDns
}
type EndpointOperations = Omit<typeof installedOperations, 'install' | 'queue'> & {
  install: (id: string, actor: number) => Promise<unknown>; queue?: typeof queueHostGatewayDns
}
export async function registerGatewayEndpointRoutes(app: FastifyInstance, operations: EndpointOperations = installedOperations) {
  app.get('/gateway/endpoint', { onRequest: [app.authenticateAdmin] }, async (_request, reply) => {
    reply.header('Cache-Control', 'no-store')
    const endpoint = await operations.load()
    return { endpoint, effectiveEndpoint: endpoint ? stableGatewayEndpointText(endpoint) : process.env.ONBOARDING_WG_ENDPOINT || null,
      existingHostsNeedUpdate: true }
  })
  app.get('/gateway/endpoint/hosts', { onRequest: [app.authenticateAdmin] }, async (_request, reply) => {
    reply.header('Cache-Control', 'no-store')
    return { hosts: await operations.hosts() }
  })
  app.post<{ Params: { id: string } }>('/gateway/endpoint/hosts/:id', {
    onRequest: [app.authenticateAdmin], bodyLimit: 1024, config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    schema: { params: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
      body: { type: 'object', additionalProperties: false, properties: {} } }
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    const origins = (process.env.ADMIN_FRONTEND_URL || '').split(',').map(value => normalizeOrigin(value.trim())).filter(Boolean)
    if (!request.user.sid || typeof request.headers.origin !== 'string' || !origins.includes(request.headers.origin) ||
      request.headers['sec-fetch-site'] === 'cross-site' || !request.headers.authorization?.startsWith('Bearer ')) return reply.code(403).send({ code: 'GATEWAY_WEB_SESSION_REQUIRED' })
    if (recoveryHeld()) return reply.code(409).send({ code: 'GATEWAY_RECOVERY_HELD' })
    try { return reply.code(202).send(await operations.install(request.params.id, request.user.id)) }
    catch (error) { return reply.code(error instanceof OnboardingError && error.code.endsWith('_BUSY') ? 409 : 400).send({ code: error instanceof OnboardingError ? error.code : 'GATEWAY_DNS_INSTALL_FAILED' }) }
  })
  app.post<{ Body: { failedOnly?: boolean } }>('/gateway/endpoint/hosts', {
    onRequest: [app.authenticateAdmin], bodyLimit: 1024,
    schema: { body: { type: 'object', additionalProperties: false, properties: { failedOnly: { type: 'boolean' } } } }
  }, async (request, reply) => {
    const origins = (process.env.ADMIN_FRONTEND_URL || '').split(',').map(value => normalizeOrigin(value.trim())).filter(Boolean)
    if (!request.user.sid || typeof request.headers.origin !== 'string' || !origins.includes(request.headers.origin) ||
      request.headers['sec-fetch-site'] === 'cross-site' || !request.headers.authorization?.startsWith('Bearer ')) return reply.code(403).send({ code: 'GATEWAY_WEB_SESSION_REQUIRED' })
    try {
      if (!operations.queue) return reply.code(503).send({ code: 'GATEWAY_DNS_NOT_READY' })
      return reply.code(202).send(await operations.queue(request.user.id, undefined, request.body.failedOnly))
    }
    catch (error) { return reply.code(409).send({ code: error instanceof OnboardingError ? error.code : 'GATEWAY_DNS_INSTALL_FAILED' }) }
  })
  app.put('/gateway/endpoint', {
    onRequest: [app.authenticateAdmin], bodyLimit: 2048, config: { rateLimit: { max: 4, timeWindow: '1 minute' } },
    schema: { body: { type: 'object', additionalProperties: false, required: ['hostname'], properties: {
      hostname: { type: 'string', maxLength: 253 }, port: { type: 'integer', minimum: 1, maximum: 65535 }
    } } }
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    const origins = (process.env.ADMIN_FRONTEND_URL || '').split(',').map(value => normalizeOrigin(value.trim())).filter(Boolean)
    if (!request.user.sid || typeof request.headers.origin !== 'string' || !origins.includes(request.headers.origin) ||
      request.headers['sec-fetch-site'] === 'cross-site' || !request.headers.authorization?.startsWith('Bearer ')) return reply.code(403).send({ code: 'GATEWAY_WEB_SESSION_REQUIRED' })
    if (recoveryHeld()) return reply.code(409).send({ code: 'GATEWAY_RECOVERY_HELD' })
    try {
      const configured = operations.configured()
      const gateway = configured ? await operations.gateway() : null
      const current = gateway ? /:([0-9]+)$/.exec(gateway.endpoint) : null
      const body = request.body as { hostname: string; port?: number }
      const input = validateStableGatewayEndpoint({ hostname: body.hostname, port: current ? Number(current[1]) : 51820 })
      if (!configured) {
        await operations.resolve(input.hostname)
        const endpoint = await operations.save(input)
        const synchronization = operations.queue ? await operations.queue(request.user.id) : { queued: 0 }
        return { endpoint, effectiveEndpoint: stableGatewayEndpointText(endpoint), existingHostsNeedUpdate: true, ...synchronization }
      }
      if (!gateway || !current || (request.body as { port?: number }).port !== undefined && Number((request.body as { port?: number }).port) !== input.port) throw new OnboardingError('GATEWAY_DNS_PORT_CONFLICT')
      const address = await operations.resolve(input.hostname)
      const configuredHost = gateway.endpoint.replace(/:[0-9]+$/, '')
      const originalAddress = await operations.resolve(normalizeOnboardingAddress(configuredHost))
      if (address !== originalAddress) throw new OnboardingError('GATEWAY_DNS_TARGET_MISMATCH')
      if (recoveryHeld()) return reply.code(409).send({ code: 'GATEWAY_RECOVERY_HELD' })
      const endpoint = await operations.save(input)
      const synchronization = operations.queue ? await operations.queue(request.user.id) : { queued: 0 }
      return { endpoint, effectiveEndpoint: stableGatewayEndpointText(endpoint), existingHostsNeedUpdate: true, ...synchronization }
    } catch (error) {
      return reply.code(error instanceof OnboardingError ? 400 : 500).send({ code: error instanceof OnboardingError ? error.code : 'GATEWAY_DNS_SAVE_FAILED' })
    }
  })
  let stop: (() => void) | undefined
  app.addHook('onReady', async () => { if (operations.queue === queueHostGatewayDns) stop = startHostGatewayDnsDispatcher() })
  app.addHook('onClose', async () => { stop?.() })
}
