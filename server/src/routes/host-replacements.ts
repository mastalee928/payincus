import type { FastifyInstance } from 'fastify'
import { prisma } from '../db/prisma.js'
import { replacementCandidates, requestHostReplacement } from '../services/host-replacement.js'

export default async function hostReplacementRoutes(fastify: FastifyInstance) {
  const params = { type: 'object', required: ['id'], properties: { id: { type: 'integer', minimum: 1 } } }
  fastify.get<{ Params: { id: number }; Querystring: { allRegions?: boolean } }>('/:id/replacement-options', {
    onRequest: [fastify.authenticateAdmin], schema: { params, querystring: {
      type: 'object', additionalProperties: false, properties: { allRegions: { type: 'boolean' } }
    } }
  }, async (request, reply) => {
    const instance = await prisma.instance.findUnique({ where: { id: request.params.id }, select: { id: true, userId: true, dedicatedIpv4: true } })
    if (!instance?.dedicatedIpv4) return reply.code(404).send({ code: 'INSTANCE_NOT_FOUND', error: '独占实例不存在' })
    const [hosts, backups, task] = await Promise.all([
      replacementCandidates(instance.id, request.query.allRegions === true),
      prisma.backupUploadTask.findMany({ where: { instanceId: instance.id, userId: instance.userId, status: 'COMPLETED',
        remoteFileName: { not: null }, storageConfig: { userId: instance.userId } }, orderBy: { finishedAt: 'desc' },
        select: { id: true, remoteFileName: true, finishedAt: true }, take: 30 }),
      prisma.instanceTask.findFirst({ where: { instanceId: instance.id, taskType: 'replace_host' }, orderBy: { id: 'desc' },
        select: { id: true, status: true, progress: true, error: true, targetHostId: true, finishedAt: true } })
    ])
    reply.header('Cache-Control', 'no-store')
    return { hosts, backups, task }
  })
  fastify.post<{ Params: { id: number }; Body: { targetHostId: number; backupUploadId?: number | null; acknowledgeRebuild?: boolean; allRegions?: boolean } }>('/:id/replace-host', {
    onRequest: [fastify.authenticateAdmin], config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    schema: { params, body: { type: 'object', additionalProperties: false, required: ['targetHostId'], properties: {
      targetHostId: { type: 'integer', minimum: 1 }, backupUploadId: { type: ['integer', 'null'], minimum: 1 }, acknowledgeRebuild: { type: 'boolean' }, allRegions: { type: 'boolean' }
    } } }
  }, async (request, reply) => {
    if (!request.body.backupUploadId && request.body.acknowledgeRebuild !== true) {
      return reply.code(400).send({ code: 'REBUILD_CONFIRMATION_REQUIRED', error: '请选择异地备份，或确认重新创建系统' })
    }
    try {
      const result = await requestHostReplacement(request.params.id, request.body.targetHostId, request.user.id, request.body.backupUploadId, request.body.allRegions === true)
      return reply.code(202).send(result)
    } catch (error) {
      return reply.code(409).send({ code: 'HOST_REPLACEMENT_UNAVAILABLE', error: error instanceof Error ? error.message : '暂时无法换机' })
    }
  })
}
