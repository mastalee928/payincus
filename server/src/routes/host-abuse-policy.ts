import type { FastifyInstance } from 'fastify'
import { AbusePolicyError, listAbuseHosts, retryAllAbuseHosts, saveAbusePolicy, type AbusePolicy } from '../services/host-abuse-policy.js'

export default async function hostAbusePolicyRoutes(fastify: FastifyInstance) {
  const revision = { type: 'integer', minimum: 0, maximum: 2147483647 }
  fastify.get<{ Querystring: { page?: number; search?: string; state?: string } }>('/abuse-policy', {
    onRequest: [fastify.authenticateAdmin],
    schema: { querystring: { type: 'object', additionalProperties: false, properties: {
      page: { type: 'integer', minimum: 1, maximum: 100000 }, search: { type: 'string', maxLength: 100 },
      state: { enum: ['all', 'attention', 'applied', 'pending', 'retrying', 'offline', 'unsupported', 'unconfigured', 'conflict'] }
    } } }
  }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.code(403).send({ code: 'FORBIDDEN' })
    reply.header('Cache-Control', 'no-store')
    try { return await listAbuseHosts(request.query) }
    catch (error) { if (error instanceof AbusePolicyError) return reply.code(error.statusCode).send({ code: error.code }); throw error }
  })
  fastify.put<{ Body: AbusePolicy }>('/abuse-policy', {
    onRequest: [fastify.authenticateAdmin], config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: { body: { type: 'object', additionalProperties: false, required: ['revision', 'blockBt', 'blockMining'], properties: { revision, blockBt: { type: 'boolean' }, blockMining: { type: 'boolean' } } } }
  }, async (request, reply) => {
    try { return await saveAbusePolicy(request.body, request.user) }
    catch (error) { if (error instanceof AbusePolicyError) return reply.code(error.statusCode).send({ code: error.code }); throw error }
  })
  fastify.post<{ Body: { revision: number } }>('/abuse-policy/retry', {
    onRequest: [fastify.authenticateAdmin], config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: { body: { type: 'object', additionalProperties: false, required: ['revision'], properties: { revision } } }
  }, async (request, reply) => {
    try { return await retryAllAbuseHosts(request.body.revision, request.user) }
    catch (error) { if (error instanceof AbusePolicyError) return reply.code(error.statusCode).send({ code: error.code }); throw error }
  })
}
