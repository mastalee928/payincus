import type { FastifyInstance } from 'fastify'
import { AdminEmailError, adminUserEmail } from '../services/admin-user-email.js'
import { isDemoRequest } from '../lib/demo-safety.js'
import { normalizeOrigin } from '../lib/origin-config.js'
import { isTransactionConflict } from '../lib/transaction-conflict.js'
import { closeUserSessions } from '../lib/terminal-proxy.js'

export default async function adminUserEmailRoutes(app: FastifyInstance) {
  for (const method of ['GET', 'PUT'] as const) app.route<{ Params: { id: string }; Body: unknown }>({
    method, url: '/:id/admin-email', onRequest: [app.authenticateAdmin], bodyLimit: 2048,
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    handler: async (request, reply) => {
      reply.header('Cache-Control', 'no-store')
      try {
        const id = Number(request.params.id)
        if (!/^[1-9]\d*$/.test(request.params.id) || !Number.isSafeInteger(id) || id > 2147483647) throw new AdminEmailError('ADMIN_EMAIL_INVALID', 400)
        if (!request.user?.sid || !request.user.iat || !request.headers.authorization?.startsWith('Bearer ') || isDemoRequest(request)) throw new AdminEmailError('ADMIN_EMAIL_FORBIDDEN', 403)
        if (method === 'GET') return await adminUserEmail(id, request.user)
        const origins = (process.env.ADMIN_FRONTEND_URL || '').split(',').map(value => normalizeOrigin(value.trim())).filter(Boolean)
        if (typeof request.headers.origin !== 'string' || !origins.includes(request.headers.origin) || request.headers['sec-fetch-site'] === 'cross-site') throw new AdminEmailError('ADMIN_EMAIL_FORBIDDEN', 403)
        const body = request.body as { revision?: unknown; email?: unknown } | null
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 2 ||
          typeof body.revision !== 'string' || !/^[a-f0-9]{64}$/.test(body.revision) || typeof body.email !== 'string') throw new AdminEmailError('ADMIN_EMAIL_INVALID', 400)
        const result = await adminUserEmail(id, request.user, { revision: body.revision, email: body.email })
        closeUserSessions(id, 'Email changed by administrator')
        return result
      } catch (error) {
        if (error instanceof AdminEmailError) return reply.code(error.statusCode).send({ code: error.code })
        if (error instanceof Error && error.message === 'ADMIN_ACTOR_FORBIDDEN') return reply.code(403).send({ code: 'ADMIN_EMAIL_FORBIDDEN' })
        if (error instanceof Error && error.message === 'USER_NOT_FOUND') return reply.code(404).send({ code: 'ADMIN_EMAIL_NOT_FOUND' })
        const value = error as { code?: string; meta?: { driverAdapterError?: { cause?: { originalCode?: string } } } }
        if (isTransactionConflict(error) || value?.code === '55P03' || value?.meta?.driverAdapterError?.cause?.originalCode === '55P03') return reply.code(409).send({ code: 'ADMIN_EMAIL_BUSY' })
        request.log.error({ code: 'ADMIN_EMAIL_FAILED' }, 'Admin email operation failed')
        return reply.code(500).send({ code: 'ADMIN_EMAIL_FAILED' })
      }
    }
  })
}
