import type { FastifyInstance } from 'fastify'
import { prisma } from '../db/prisma.js'
import { hardeningPublicView } from '../lib/hardening-view.js'

/** Administrative status only. Grants no remote action or trust. */
export default async function securityHardeningRoutes(fastify: FastifyInstance) {
  fastify.get<{ Params: { id: string } }>('/:id/security-hardening', { onRequest: [fastify.authenticateAdmin] }, async (request, reply) => {
    reply.header('Cache-Control','no-store')
    const id = Number(request.params.id)
    if (!/^[1-9]\d*$/.test(request.params.id) || !Number.isSafeInteger(id) || id > 2147483647) return reply.code(400).send({ error: 'INVALID_ID' })
    const host = await prisma.host.findUnique({ where: { id }, select: { securityHardening: true } })
    if (!host) return reply.code(404).send({ error: 'HOST_NOT_FOUND' })
    return { hostId:id,...hardeningPublicView(host.securityHardening) }
  })
}
