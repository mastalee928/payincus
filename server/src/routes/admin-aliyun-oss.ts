import type { FastifyInstance, FastifyRequest } from 'fastify'
import { AliyunOssClient, sanitizedOssError } from '../services/aliyun-oss-client.js'
import { BackupError, ensure, initBackupState, normalizeConfig, OSS_REGIONS, publicConfig, readBackupConfig, readJson, recoveryHeld, sealSecret, serializeBackupMutation, statePath, taskResults, validateBucket, validateId, validatePrefix, validateRegion, writeBackupConfig, type BackupTaskResult } from '../services/platform-backup-core.js'
import { activeBackupTask, backupRuntimeReady, enqueueBackupTask } from '../services/platform-backup-scheduler.js'
import { isDemoRequest } from '../lib/demo-safety.js'
import { createLog } from '../db/logs.js'
import { recoveryReview, probeRecoveryHost, RECOVERY_REVIEW_SECTIONS, type RecoveryReviewSection } from '../services/platform-recovery-review.js'
import { normalizeOrigin } from '../lib/origin-config.js'
import { reconcileRecovery, recoveryReconciliations, type RecoveryCorrection } from '../services/platform-recovery-reconciliation.js'

export default async function adminAliyunOssRoutes(fastify: FastifyInstance) {
  const requireBackupAdmin = async (request: FastifyRequest) => {
    ensure(!isDemoRequest(request), 'OSS_DEMO_FORBIDDEN', 403)
    const raw = process.env.PLATFORM_BACKUP_ALLOWED_ADMIN_IDS?.trim()
    const allowed = raw ? raw.split(',').map(v => Number(v.trim())).filter(v => Number.isSafeInteger(v) && v > 0) : null
    ensure(request.user.role === 'admin' && (allowed ? allowed.includes(request.user.id) : request.user.username === 'admin'), 'OSS_ADMIN_REQUIRED', 403)
  }
  fastify.setErrorHandler((error, _request, reply) => {
    if ((error as { validation?: unknown }).validation) return reply.code(400).send({ code: 'OSS_CONFIG_INVALID', error: 'Invalid backup request' })
    const safe = error instanceof BackupError ? error : sanitizedOssError(error)
    return reply.code(safe.status).send({ code: safe.code, error: safe.code })
  })
  const objectSchema = { type: 'object', additionalProperties: false } as const
  const audit = (request: FastifyRequest, action: string) => createLog(request.user.id, 'system', `oss.${action}`, `OSS ${action}`, 'success')
  const requireReviewWebSession = async (request: FastifyRequest) => {
    const origins = (process.env.ADMIN_FRONTEND_URL || '').split(',').map(value => normalizeOrigin(value.trim())).filter(Boolean)
    const origin = request.headers.origin
    ensure(request.user.sid && request.headers.authorization?.startsWith('Bearer ') && request.headers['sec-fetch-site'] !== 'cross-site' &&
      (request.method === 'GET' && origin === undefined || typeof origin === 'string' && origins.includes(origin)), 'OSS_REVIEW_WEB_SESSION_REQUIRED', 403)
  }
  fastify.get<{ Querystring: { section?: RecoveryReviewSection; page?: number } }>('/recovery-review', {
    onRequest: [fastify.authenticateAdmin, requireBackupAdmin, requireReviewWebSession], schema: { querystring: { ...objectSchema, properties: {
      section: { type: 'string', enum: [...RECOVERY_REVIEW_SECTIONS] }, page: { type: 'integer', minimum: 1, maximum: 1000000 }
    } } }
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    return recoveryReview(request.query.section, request.query.page)
  })
  fastify.post<{ Params: { id: string } }>('/recovery-review/hosts/:id/probe', {
    onRequest: [fastify.authenticateAdmin, requireBackupAdmin, requireReviewWebSession], config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: { params: { ...objectSchema, required: ['id'], properties: { id: { type: 'string', pattern: '^[1-9][0-9]{0,9}$' } } },
      body: { ...objectSchema, maxProperties: 0 } }
  }, async request => serializeBackupMutation(async () => {
    ensure(!await activeBackupTask(), 'OSS_TASK_BUSY', 409)
    return probeRecoveryHost(Number(request.params.id))
  }))
  fastify.get('/recovery-review/reconciliations', {
    onRequest: [fastify.authenticateAdmin, requireBackupAdmin, requireReviewWebSession]
  }, async (_request, reply) => {
    reply.header('Cache-Control', 'no-store')
    return recoveryReconciliations()
  })
  fastify.post<{ Body: { correction: RecoveryCorrection; password: string; totpCode?: string } }>('/recovery-review/reconcile', {
    onRequest: [fastify.authenticateAdmin, requireBackupAdmin, requireReviewWebSession], bodyLimit: 16384,
    config: { rateLimit: { max: 8, timeWindow: '1 minute' } },
    schema: { body: { ...objectSchema, required: ['correction', 'password'], properties: {
      password: { type: 'string', minLength: 1, maxLength: 256 }, totpCode: { type: 'string', pattern: '^[0-9]{6}$' },
      correction: { ...objectSchema, required: ['id', 'holdTaskId', 'userId', 'reference', 'observedAt', 'expectedBalance', 'targetBalance', 'expectedLatestLogId', 'instances', 'recharges'], properties: {
        id: { type: 'string', maxLength: 36 }, holdTaskId: { type: 'string', maxLength: 36 }, userId: { type: 'integer', minimum: 1, maximum: 2147483647 },
        reference: { type: 'string', minLength: 6, maxLength: 120 }, observedAt: { type: 'string', maxLength: 24 },
        expectedBalance: { type: 'string', maxLength: 11 }, targetBalance: { type: 'string', maxLength: 11 },
        expectedLatestLogId: { anyOf: [{ type: 'integer', minimum: 1, maximum: 2147483647 }, { type: 'null' }] },
        instances: { type: 'array', maxItems: 20, items: { ...objectSchema, required: ['id', 'expectedVersion', 'expectedExpiresAt', 'targetExpiresAt'], properties: {
          id: { type: 'integer', minimum: 1 }, expectedVersion: { type: 'integer', minimum: 0 }, expectedExpiresAt: { type: 'string', maxLength: 24 }, targetExpiresAt: { type: 'string', maxLength: 24 }
        } } },
        recharges: { type: 'array', maxItems: 20, items: { ...objectSchema, required: ['id', 'orderNo', 'expectedStatus', 'expectedAmount'], properties: {
          id: { type: 'integer', minimum: 1 }, orderNo: { type: 'string', maxLength: 100 }, expectedStatus: { type: 'string', enum: ['pending', 'paid', 'cancelled'] }, expectedAmount: { type: 'string', maxLength: 11 }
        } } }
      } }
    } } }
  }, async (request, reply) => serializeBackupMutation(async () => {
    ensure(!await activeBackupTask(), 'OSS_TASK_BUSY', 409)
    reply.header('Cache-Control', 'no-store')
    return reconcileRecovery(request.body.correction, request.user.id, { password: request.body.password, totpCode: request.body.totpCode })
  }))
  async function connection<T>(action: (client: AliyunOssClient) => Promise<T>, target?: { region?: string; bucket?: string }) {
    const config = await readBackupConfig(); ensure(config, 'OSS_CONFIG_REQUIRED', 409)
    const client = new AliyunOssClient({ ...config, ...(target?.region ? { region: validateRegion(target.region) } : {}), ...(target?.bucket ? { bucket: validateBucket(target.bucket) } : {}) })
    try { return await action(client) } finally { client.close() }
  }
  fastify.get('/config', { onRequest: [fastify.authenticateAdmin, requireBackupAdmin] }, async () => {
    await initBackupState()
    const config = await readBackupConfig()
    return { config: config ? publicConfig(config) : null, runtimeReady: backupRuntimeReady(), recoveryHeld: recoveryHeld(), activeTask: await activeBackupTask() }
  })
  fastify.put<{ Body: Record<string, unknown> }>('/config', { onRequest: [fastify.authenticateAdmin, requireBackupAdmin], bodyLimit: 8192 }, async request => serializeBackupMutation(async () => {
    ensure(!await activeBackupTask() && !recoveryHeld(), 'OSS_TASK_BUSY', 409)
    await initBackupState(); const previous = await readBackupConfig()
    const config = normalizeConfig(request.body, previous || undefined)
    ensure(!config.enabled || backupRuntimeReady(), 'OSS_RUNTIME_NOT_INSTALLED', 503)
    await writeBackupConfig(config); await audit(request, 'config.update')
    return { config: publicConfig(config) }
  }))
  fastify.post('/test-connection', { onRequest: [fastify.authenticateAdmin, requireBackupAdmin] }, async request => serializeBackupMutation(async () => {
    ensure(!await activeBackupTask() && !recoveryHeld(), 'OSS_TASK_BUSY', 409)
    const config = await readBackupConfig(); ensure(config, 'OSS_CONFIG_REQUIRED', 409)
    await connection(client => client.test(config))
    config.testedRevision = config.revision; await writeBackupConfig(config); await audit(request, 'connection.test')
    return { config: publicConfig(config) }
  }))
  fastify.get('/regions', { onRequest: [fastify.authenticateAdmin, requireBackupAdmin] }, async () => ({ regions: OSS_REGIONS }))
  fastify.get<{ Querystring: { cursor?: string } }>('/buckets', { onRequest: [fastify.authenticateAdmin, requireBackupAdmin] }, async request => connection(client => client.listBuckets(request.query.cursor)))
  fastify.post<{ Body: { region: string; name: string } }>('/buckets', {
    onRequest: [fastify.authenticateAdmin, requireBackupAdmin], schema: { body: { ...objectSchema, required: ['region', 'name'], properties: { region: { type: 'string', maxLength: 64 }, name: { type: 'string', maxLength: 63 } } } }
  }, async request => serializeBackupMutation(async () => {
    ensure(!await activeBackupTask() && !recoveryHeld(), 'OSS_TASK_BUSY', 409)
    const name = validateBucket(request.body.name)
    await connection(client => client.client.putBucket(name, { acl: 'private', storageClass: 'Standard', dataRedundancyType: 'LRS', timeout: 60000 }), { region: request.body.region, bucket: name })
    await audit(request, 'bucket.create'); return { success: true }
  }))
  fastify.delete<{ Params: { name: string }; Body: { region: string; confirmation: string } }>('/buckets/:name', {
    onRequest: [fastify.authenticateAdmin, requireBackupAdmin], schema: { body: { ...objectSchema, required: ['region', 'confirmation'], properties: { region: { type: 'string', maxLength: 64 }, confirmation: { type: 'string', maxLength: 63 } } } }
  }, async request => serializeBackupMutation(async () => {
    ensure(!await activeBackupTask() && !recoveryHeld(), 'OSS_TASK_BUSY', 409)
    const config = await readBackupConfig(), name = validateBucket(request.params.name)
    ensure(config?.bucket !== name, 'OSS_BUCKET_IN_USE', 409)
    ensure(request.body.confirmation === name, 'OSS_CONFIRMATION_REQUIRED')
    await connection(client => client.client.deleteBucket(name), { region: request.body.region, bucket: name })
    await audit(request, 'bucket.delete'); return { success: true }
  }))
  fastify.get<{ Querystring: { region?: string; bucket?: string; prefix?: string; cursor?: string } }>('/objects', { onRequest: [fastify.authenticateAdmin, requireBackupAdmin] }, async request => {
    return connection(client => client.listObjects(validatePrefix(request.query.prefix || '', true), request.query.cursor), request.query)
  })
  fastify.get<{ Querystring: { prefix?: string } }>('/backups', { onRequest: [fastify.authenticateAdmin, requireBackupAdmin] }, async request => {
    const config = await readBackupConfig(); ensure(config, 'OSS_CONFIG_REQUIRED', 409)
    return { backups: await connection(client => client.backups(request.query.prefix ? validatePrefix(request.query.prefix) : `${config.prefix}${config.installationId}/`)) }
  })
  fastify.get('/tasks', { onRequest: [fastify.authenticateAdmin, requireBackupAdmin] }, async () => {
    const active = await activeBackupTask(), failure = await readJson<BackupTaskResult>(statePath('inbox', 'last-failure.json'))
    const tasks = await taskResults()
    for (const task of [active, failure]) if (task) {
      const index = tasks.findIndex(t => t.id === task.id)
      if (index < 0) tasks.unshift(task)
      else if (Date.parse(task.updatedAt) >= Date.parse(tasks[index].updatedAt)) tasks[index] = task
    }
    return { tasks, recoveryHeld: recoveryHeld() }
  })
  fastify.post('/backups', { onRequest: [fastify.authenticateAdmin, requireBackupAdmin] }, async (request, reply) => serializeBackupMutation(async () => {
    const task = await enqueueBackupTask('backup', request.user.id); await audit(request, 'backup.start'); return reply.code(202).send({ task })
  }))
  fastify.post<{ Body: { prefix: string; password: string } }>('/restore-previews', {
    onRequest: [fastify.authenticateAdmin, requireBackupAdmin], bodyLimit: 4096, schema: { body: { ...objectSchema, required: ['prefix', 'password'], properties: { prefix: { type: 'string', maxLength: 400 }, password: { type: 'string', minLength: 12, maxLength: 256 } } } }
  }, async (request, reply) => serializeBackupMutation(async () => {
    const task = await enqueueBackupTask('preview', request.user.id, { sourcePrefix: validatePrefix(request.body.prefix), password: sealSecret(request.body.password) })
    await audit(request, 'restore.preview'); return reply.code(202).send({ task })
  }))
  fastify.post<{ Body: { previewId: string; confirmation: string } }>('/restores', {
    onRequest: [fastify.authenticateAdmin, requireBackupAdmin], schema: { body: { ...objectSchema, required: ['previewId', 'confirmation'], properties: { previewId: { type: 'string', maxLength: 36 }, confirmation: { type: 'string', maxLength: 80 } } } }
  }, async (request, reply) => serializeBackupMutation(async () => {
    const previewId = validateId(request.body.previewId)
    ensure(request.body.confirmation === `RESTORE ${previewId}`, 'OSS_CONFIRMATION_REQUIRED')
    const task = await enqueueBackupTask('restore', request.user.id, { previewId, confirmation: request.body.confirmation })
    await audit(request, 'restore.start'); return reply.code(202).send({ task })
  }))
  fastify.post<{ Body: { confirmation: string } }>('/resume', {
    onRequest: [fastify.authenticateAdmin, requireBackupAdmin], schema: { body: { ...objectSchema, required: ['confirmation'], properties: { confirmation: { type: 'string', maxLength: 80 } } } }
  }, async (request, reply) => serializeBackupMutation(async () => {
    ensure(request.body.confirmation === 'RESUME AFTER RECONCILIATION', 'OSS_CONFIRMATION_REQUIRED')
    const task = await enqueueBackupTask('resume', request.user.id, { confirmation: request.body.confirmation })
    await audit(request, 'recovery.resume'); return reply.code(202).send({ task })
  }))
  fastify.post<{ Body: { confirmation: string } }>('/rollback', {
    onRequest: [fastify.authenticateAdmin, requireBackupAdmin], schema: { body: { ...objectSchema, required: ['confirmation'], properties: { confirmation: { type: 'string', maxLength: 80 } } } }
  }, async (request, reply) => serializeBackupMutation(async () => {
    ensure(request.body.confirmation === 'ROLLBACK RESTORE', 'OSS_CONFIRMATION_REQUIRED')
    const task = await enqueueBackupTask('rollback', request.user.id, { confirmation: request.body.confirmation })
    await audit(request, 'recovery.rollback'); return reply.code(202).send({ task })
  }))
}
