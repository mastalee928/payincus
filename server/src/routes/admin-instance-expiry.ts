import type { FastifyInstance } from 'fastify'
import { normalizeOrigin } from '../lib/origin-config.js'
import { isTransactionConflict } from '../lib/transaction-conflict.js'
import { adminInstanceExpiry, InstanceExpiryError, parseInstanceExpiry } from '../services/admin-instance-expiry.js'

export default async function adminInstanceExpiryRoutes(app: FastifyInstance) {
  for (const method of ['GET', 'PUT'] as const) {
    app.route<{ Params: { id: string }; Body: unknown }>({ method, url: '/api/admin/instances/:id/expiry',
      onRequest: [app.authenticateAdmin], bodyLimit: 1024,
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      handler: async (request, reply) => {
        reply.header('Cache-Control', 'no-store')
        try {
          const id = Number(request.params.id)
          if (!/^[1-9]\d*$/.test(request.params.id) || !Number.isSafeInteger(id) || id > 2147483647) throw new InstanceExpiryError('EXPIRY_INVALID_REQUEST', 400)
          const actor = request.user
          if (!actor?.sid || !actor.iat || !request.headers.authorization?.startsWith('Bearer ')) throw new InstanceExpiryError('EXPIRY_ADMIN_REQUIRED', 403)
          if (method === 'PUT') {
            const origins = (process.env.ADMIN_FRONTEND_URL || '').split(',').map(value => normalizeOrigin(value.trim())).filter(Boolean)
            if (typeof request.headers.origin !== 'string' || !origins.includes(request.headers.origin) || request.headers['sec-fetch-site'] === 'cross-site') throw new InstanceExpiryError('EXPIRY_ADMIN_REQUIRED', 403)
            const body = request.body as { expiresAt?: unknown; revision?: unknown } | null
            if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 2 ||
              typeof body.revision !== 'string' || !/^[a-f0-9]{64}$/.test(body.revision)) throw new InstanceExpiryError('EXPIRY_INVALID_REQUEST', 400)
            return await adminInstanceExpiry(id, actor, { revision: body.revision, expiresAt: parseInstanceExpiry(body.expiresAt) })
          }
          return await adminInstanceExpiry(id, actor)
        } catch (error) {
          if (error instanceof InstanceExpiryError) return reply.code(error.statusCode).send({ code: error.code })
          if (error instanceof Error && ['ADMIN_ACTOR_FORBIDDEN', 'USER_NOT_FOUND'].includes(error.message)) return reply.code(403).send({ code: 'EXPIRY_ADMIN_REQUIRED' })
          const value = error as { code?: string; cause?: { originalCode?: string }; meta?: { code?: string; driverAdapterError?: { cause?: { originalCode?: string } } } }
          if (isTransactionConflict(error) || [value?.code, value?.meta?.code, value?.cause?.originalCode, value?.meta?.driverAdapterError?.cause?.originalCode].includes('55P03')) return reply.code(409).send({ code: 'EXPIRY_BUSY' })
          request.log.error({ code: 'EXPIRY_SAVE_FAILED' }, 'Instance expiry operation failed')
          return reply.code(500).send({ code: 'EXPIRY_SAVE_FAILED' })
        }
      }
    })
  }
}
