import type { FastifyInstance } from 'fastify'
import { normalizeOrigin } from '../lib/origin-config.js'
import { normalizeOnboardingAddress, OnboardingError } from '../lib/host-onboarding.js'
import { stableGatewayEndpointText, validateStableGatewayEndpoint } from '../lib/onboarding-gateway-endpoint.js'
import { recoveryHeld } from '../services/platform-backup-core.js'
import { loadStableGatewayEndpoint, saveStableGatewayEndpoint, resolveGatewayEndpointAddress } from '../services/onboarding-gateway-endpoint.js'
import { gatewayCommand, gatewayConfigured } from '../services/onboarding-ssh.js'
import { listHostGatewayDns, installHostGatewayDns } from '../services/host-gateway-dns.js'

export async function registerGatewayEndpointRoutes(app: FastifyInstance, operations = {
  load: loadStableGatewayEndpoint, save: saveStableGatewayEndpoint,
  resolve: resolveGatewayEndpointAddress, gateway: gatewayCommand, configured: gatewayConfigured,
  hosts: listHostGatewayDns, install: installHostGatewayDns
}) {
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
    try { return await operations.install(request.params.id, request.user.id) }
    catch (error) { return reply.code(error instanceof OnboardingError && error.code.endsWith('_BUSY') ? 409 : 400).send({ code: error instanceof OnboardingError ? error.code : 'GATEWAY_DNS_INSTALL_FAILED' }) }
  })
  app.put('/gateway/endpoint', {
    onRequest: [app.authenticateAdmin], bodyLimit: 2048, config: { rateLimit: { max: 4, timeWindow: '1 minute' } },
    schema: { body: { type: 'object', additionalProperties: false, required: ['hostname', 'port'], properties: {
      hostname: { type: 'string', maxLength: 253 }, port: { type: 'integer', minimum: 1, maximum: 65535 }
    } } }
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    const origins = (process.env.ADMIN_FRONTEND_URL || '').split(',').map(value => normalizeOrigin(value.trim())).filter(Boolean)
    if (!request.user.sid || typeof request.headers.origin !== 'string' || !origins.includes(request.headers.origin) ||
      request.headers['sec-fetch-site'] === 'cross-site' || !request.headers.authorization?.startsWith('Bearer ')) return reply.code(403).send({ code: 'GATEWAY_WEB_SESSION_REQUIRED' })
    if (recoveryHeld()) return reply.code(409).send({ code: 'GATEWAY_RECOVERY_HELD' })
    try {
      const input = validateStableGatewayEndpoint(request.body)
      if (!operations.configured()) throw new OnboardingError('GATEWAY_NOT_CONFIGURED')
      const gateway = await operations.gateway()
      const current = /:([0-9]+)$/.exec(gateway.endpoint)
      if (!current || Number(current[1]) !== input.port) throw new OnboardingError('GATEWAY_DNS_PORT_CONFLICT')
      const address = await operations.resolve(input.hostname)
      const configuredHost = gateway.endpoint.replace(/:[0-9]+$/, '')
      const originalAddress = await operations.resolve(normalizeOnboardingAddress(configuredHost))
      if (address !== originalAddress) throw new OnboardingError('GATEWAY_DNS_TARGET_MISMATCH')
      if (recoveryHeld()) return reply.code(409).send({ code: 'GATEWAY_RECOVERY_HELD' })
      const endpoint = await operations.save(input)
      return { endpoint, effectiveEndpoint: stableGatewayEndpointText(endpoint), existingHostsNeedUpdate: true }
    } catch (error) {
      return reply.code(error instanceof OnboardingError ? 400 : 500).send({ code: error instanceof OnboardingError ? error.code : 'GATEWAY_DNS_SAVE_FAILED' })
    }
  })
}
