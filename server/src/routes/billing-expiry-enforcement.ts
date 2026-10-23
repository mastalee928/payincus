import type { FastifyInstance } from 'fastify'
import { normalizeOrigin } from '../lib/origin-config.js'
import { recoveryHeld } from '../services/platform-backup-core.js'

export interface ExpiryEnforcementOperations {
  status: () => unknown
  start: () => unknown
  run: () => Promise<void>
}
export async function registerExpiryEnforcementRoutes(app: FastifyInstance, operations: ExpiryEnforcementOperations) {
  app.get('/api/admin/billing/expiry-enforcement', { onRequest: [app.authenticateAdmin] }, async (_request, reply) => {
    reply.header('Cache-Control', 'no-store')
    return operations.status()
  })
  for (const action of ['start', 'run'] as const) {
    app.post('/api/admin/billing/expiry-enforcement/' + action, {
      onRequest: [app.authenticateAdmin], bodyLimit: 1024, config: { rateLimit: { max: 4, timeWindow: '1 minute' } },
      schema: { body: { type: 'object', additionalProperties: false, properties: {} } }
    }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store')
      const origins = (process.env.ADMIN_FRONTEND_URL || '').split(',').map(value => normalizeOrigin(value.trim())).filter(Boolean)
      if (!request.user.sid || typeof request.headers.origin !== 'string' || !origins.includes(request.headers.origin) ||
        request.headers['sec-fetch-site'] === 'cross-site' || !request.headers.authorization?.startsWith('Bearer ')) {
        return reply.code(403).send({ code: 'EXPIRY_WEB_SESSION_REQUIRED' })
      }
      if (recoveryHeld()) return reply.code(409).send({ code: 'EXPIRY_RECOVERY_HELD' })
      if (action === 'start') await operations.start()
      else void operations.run().catch(() => {})
      return reply.code(202).send(await operations.status())
    })
  }
}
