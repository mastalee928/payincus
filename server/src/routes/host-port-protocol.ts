import type { FastifyInstance } from 'fastify'
import { prisma } from '../db/prisma.js'
import { apiError, ErrorCode } from '../lib/errors.js'
import { PORT_PROTOCOL_CAPABILITY, portProtocolSelect, portProtocolView, type PortProtocol } from '../services/host-port-protocol.js'
import { PortProtocolUpdateError, updateHostPortProtocol } from '../services/host-port-protocol-update.js'

export default async function hostPortProtocolRoutes(fastify: FastifyInstance) {
  const hostId = { type: 'integer', minimum: 1, maximum: 2147483647 }
  const protocolSchema = { type: 'string', enum: ['tcp', 'tcp_udp'] }
  const params = { type: 'object', required: ['id'], properties: { id: hostId } }
  fastify.patch<{ Body: { hostIds: number[]; protocol: PortProtocol } }>('/port-protocol/batch', {
    onRequest: [fastify.authenticateAdmin], config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    schema: { body: { type: 'object', additionalProperties: false, required: ['hostIds', 'protocol'], properties: {
      hostIds: { type: 'array', minItems: 1, maxItems: 100, uniqueItems: true, items: hostId }, protocol: protocolSchema
    } } }
  }, async request => {
    const results: Array<{ id: number; success: boolean; protocol?: ReturnType<typeof portProtocolView>; code?: string }> = []
    let next = 0
    const deadline = Date.now() + 20000
    const update = async () => { while (next < request.body.hostIds.length) {
      const id = request.body.hostIds[next++]
      if (Date.now() >= deadline) { results.push({ id, success: false, code: 'PORT_PROTOCOL_BATCH_TIMEOUT' }); continue }
      try {
        const protocol = await updateHostPortProtocol(id, request.body.protocol, request.user)
        results.push({ id, success: true, protocol })
      } catch (error) {
        if (!(error instanceof PortProtocolUpdateError)) request.log.error({ err: error, hostId: id }, 'Host protocol update failed')
        results.push({ id, success: false, code: error instanceof PortProtocolUpdateError ? error.code : 'INTERNAL_ERROR' })
      }
    } }
    await Promise.all(Array.from({ length: Math.min(4, request.body.hostIds.length) }, update))
    return { results: request.body.hostIds.map(id => results.find(result => result.id === id)!) }
  })
  fastify.get<{ Params: { id: number } }>('/:id/port-protocol', {
    onRequest: [fastify.authenticateAdmin], schema: { params }
  }, async (request, reply) => {
    const host = await prisma.host.findUnique({ where: { id: request.params.id }, select: {
      userId: true, ...portProtocolSelect, agent: { select: { enabled: true, capabilities: true, lastSeenAt: true } }
    } })
    if (!host) return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    if (request.user.role !== 'admin' && host.userId !== request.user.id) return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    return {
      ...portProtocolView(host),
      error: host.portProtocolError,
      supported: host.agent?.enabled === true && Array.isArray(host.agent.capabilities) && host.agent.capabilities.includes(PORT_PROTOCOL_CAPABILITY),
      lastSeenAt: host.agent?.lastSeenAt || null
    }
  })

  fastify.patch<{ Params: { id: number }; Body: { protocol: PortProtocol } }>('/:id/port-protocol', {
    onRequest: [fastify.authenticateAdmin],
    config: { rateLimit: { max: 15, timeWindow: '1 minute' } },
    schema: { params, body: { type: 'object', additionalProperties: false, required: ['protocol'], properties: { protocol: protocolSchema } } }
  }, async (request, reply) => {
    try {
      return await updateHostPortProtocol(request.params.id, request.body.protocol, request.user)
    } catch (error) {
      if (!(error instanceof PortProtocolUpdateError)) throw error
      return reply.code(error.statusCode).send({ code: error.code, error: error.message })
    }
  })
}
