import { recordRecoveryEvidence, recoveryAccessAccounts, reconcileRecoveryAccess, registerRecoveryBusiness, type RecoveryRegistration, type RecoveryEvidenceInput } from '../services/platform-recovery-evidence.js'
import { reconcileRecoveryGateway, recoveryGatewayStatus, upgradeRecoveryGatewayHelper, mapRecoveryGateway } from '../services/platform-recovery-gateway.js'
import { recoveryOrder, resolveRecoveryOrder, type RecoveryOrderResolution } from '../services/platform-recovery-orders.js'
import { restoreLegacyPurchaseLinks, type LegacyPurchaseLinks } from '../services/platform-recovery-legacy-order.js'
import { restoreRecoveryBillingLinks, type RecoveryBillingLinks } from '../services/platform-recovery-billing-links.js'
import { registerRecoveryAccount, registerRecoveryRecharge, type RecoveryAccountRegistration, type RecoveryRechargeRegistration } from '../services/platform-recovery-registration.js'
import { recoveryInstance, recordRecoveryInstance, type RecoveryInstanceEvidence } from '../services/platform-recovery-instance.js'
import type { RecoveryCategory } from '../services/platform-recovery-state.js'
import { backupRoot } from '../services/platform-backup-core.js'
import { beginAutomaticRestore, readAutomaticRestore, publicAutomaticRestore, automaticRestorePending } from '../services/platform-recovery-start.js'
import { join } from 'node:path'
import { recoveryReadiness, assertRecoveryReady } from '../services/platform-recovery-state.js'
import { runRecoveryHostCheck, seedRecoveryHosts, retryBlockedRecoveryHosts } from '../services/platform-recovery-queue.js'
import { recoveryOperator, validateRecoverySession } from '../services/platform-recovery-operator.js'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { AliyunOssClient, sanitizedOssError } from '../services/aliyun-oss-client.js'
import { BackupError, ensure, initBackupState, normalizeConfig, OSS_REGIONS, publicConfig, readBackupConfig, readJson, recoveryHeld, sealSecret, serializeBackupMutation, statePath, taskResults, validateBucket, validateId, validateObjectPrefix, validateRegion, writeBackupConfig, type BackupTaskResult } from '../services/platform-backup-core.js'
import { activeBackupTask, backupRuntimeReady, enqueueBackupTask } from '../services/platform-backup-scheduler.js'
import { isDemoRequest } from '../lib/demo-safety.js'
import { createLog } from '../db/logs.js'
import { recoveryReview, RECOVERY_REVIEW_SECTIONS, type RecoveryReviewSection } from '../services/platform-recovery-review.js'
import { normalizeOrigin } from '../lib/origin-config.js'
import { reconcileRecovery, recoveryReconciliations, recoveryCorrectionAccount, type RecoveryCorrection } from '../services/platform-recovery-reconciliation.js'

export default async function adminAliyunOssRoutes(fastify: FastifyInstance) {
  const requireBackupAdmin = async (request: FastifyRequest) => {
    ensure(!isDemoRequest(request), 'OSS_DEMO_FORBIDDEN', 403)
    if (recoveryHeld()) {
      ensure(await validateRecoverySession(request.user), 'OSS_RECOVERY_LOGIN_REQUIRED', 403)
      request.user.username = (await recoveryOperator()).username
      return
    }
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
    const held=await readJson<{restorePolicy?:string}>(join(backupRoot(),'recovery-hold.json'))
    if(held?.restorePolicy==='snapshot-v1' && !['GET','HEAD'].includes(request.method)){
      // The held backend serves progress during remote waits. Legacy manual
      // accounting/identity editors cannot alter the snapshot before root seals it.
      const path=request.url.split('?')[0]
      ensure(/\/recovery-review\/hosts\/(?:retry|[1-9][0-9]*\/probe)$/.test(path),'OSS_RECOVERY_SNAPSHOT_READ_ONLY',409)
    }
  }
  fastify.get<{ Querystring: { section?: RecoveryReviewSection; page?: number; hostPage?: number } }>('/recovery-review', {
    onRequest: [fastify.authenticateAdmin, requireBackupAdmin, requireReviewWebSession], schema: { querystring: { ...objectSchema, properties: {
      hostPage: { type: 'integer', minimum: 1, maximum: 1000000 }, section: { type: 'string', enum: [...RECOVERY_REVIEW_SECTIONS] }, page: { type: 'integer', minimum: 1, maximum: 1000000 }
    } } }
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    return recoveryReview(request.query.section, request.query.page, request.query.hostPage)
  })
  fastify.post<{ Params: { id: string } }>('/recovery-review/hosts/:id/probe', {
    onRequest: [fastify.authenticateAdmin, requireBackupAdmin, requireReviewWebSession], config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: { params: { ...objectSchema, required: ['id'], properties: { id: { type: 'string', pattern: '^[1-9][0-9]{0,9}$' } } },
      body: { ...objectSchema, maxProperties: 0 } }
  }, async request => {
    ensure(!await activeBackupTask(), 'OSS_TASK_BUSY', 409)
    return await runRecoveryHostCheck(Number(request.params.id)) || { queued: true }
  })
  fastify.post<{ Body: { batchId: string } }>('/recovery-review/hosts/retry', {
    onRequest: [fastify.authenticateAdmin, requireBackupAdmin, requireReviewWebSession], config: {rateLimit:{max:3,timeWindow:'1 minute'}},
    schema: {body:{...objectSchema,required:['batchId'],properties:{batchId:{type:'string',format:'uuid'}}}}
  }, async request => serializeBackupMutation(() => retryBlockedRecoveryHosts(request.body.batchId)))
  fastify.get<{ Querystring: { page?: number } }>('/recovery-review/reconciliations', {
    onRequest: [fastify.authenticateAdmin, requireBackupAdmin, requireReviewWebSession],
    schema: { querystring: { ...objectSchema, properties: { page: { type: 'integer', minimum: 1, maximum: 1000000 } } } }
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    return recoveryReconciliations(request.query.page)
  })
  fastify.get<{ Params: { id: string } }>('/recovery-review/accounts/:id', {
    onRequest: [fastify.authenticateAdmin, requireBackupAdmin, requireReviewWebSession],
    schema: { params: { ...objectSchema, required: ['id'], properties: { id: { type: 'string', pattern: '^[1-9][0-9]{0,9}$' } } } }
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    return recoveryCorrectionAccount(Number(request.params.id), request.user.id)
  })
  fastify.post<{ Body: { correction: RecoveryCorrection; password: string; totpCode?: string } }>('/recovery-review/reconcile', {
    onRequest: [fastify.authenticateAdmin, requireBackupAdmin, requireReviewWebSession], bodyLimit: 32768,
    config: { rateLimit: { max: 8, timeWindow: '1 minute' } },
    schema: { body: { ...objectSchema, required: ['correction', 'password'], properties: {
      password: { type: 'string', minLength: 1, maxLength: 256 }, totpCode: { type: 'string', pattern: '^[0-9]{6}$' },
      correction: { ...objectSchema, required: ['id', 'holdTaskId', 'userId', 'reference', 'observedAt', 'expectedBalance', 'targetBalance', 'expectedLatestLogId', 'instances', 'recharges'], properties: {
        id: { type: 'string', maxLength: 36 }, holdTaskId: { type: 'string', maxLength: 36 }, userId: { type: 'integer', minimum: 1, maximum: 2147483647 },
        reference: { type: 'string', minLength: 6, maxLength: 120 }, observedAt: { type: 'string', maxLength: 24 },
        expectedBalance: { type: 'string', maxLength: 11 }, targetBalance: { type: 'string', maxLength: 11 },
        expectedLatestLogId: { anyOf: [{ type: 'integer', minimum: 1, maximum: 2147483647 }, { type: 'null' }] },
        instances: { type: 'array', maxItems: 20, items: { ...objectSchema, required: ['id', 'expectedVersion', 'expectedExpiresAt', 'targetExpiresAt'], properties: {
          id: { type: 'integer', minimum: 1 }, expectedVersion: { type: 'integer', minimum: 0 }, expectedExpiresAt: { type: 'string', maxLength: 24 }, targetExpiresAt: { type: 'string', maxLength: 24 },
          expectedLatestBillingRecordId: { anyOf: [{ type: 'integer', minimum: 1, maximum: 2147483647 }, { type: 'null' }] },
          renewals: { type: 'array', minItems: 1, maxItems: 20, items: { ...objectSchema, required: ['reference', 'amount', 'months', 'periodStart', 'periodEnd', 'completedAt'], properties: {
            reference: { type: 'string', minLength: 6, maxLength: 120 }, amount: { type: 'string', maxLength: 11 }, months: { type: 'integer', minimum: 1, maximum: 24 },
            periodStart: { type: 'string', maxLength: 24 }, periodEnd: { type: 'string', maxLength: 24 }, completedAt: { type: 'string', maxLength: 24 }
          } } }
        } } },
        recharges: { type: 'array', maxItems: 20, items: { ...objectSchema, required: ['id', 'orderNo', 'expectedStatus', 'expectedAmount'], properties: {
          id: { type: 'integer', minimum: 1 }, orderNo: { type: 'string', maxLength: 100 }, expectedStatus: { type: 'string', enum: ['pending', 'paid', 'cancelled'] }, expectedAmount: { type: 'string', maxLength: 11 },
          settlement: { ...objectSchema, required: ['creditedAmount', 'completedAt'], properties: {
            creditedAmount: { type: 'string', maxLength: 11 }, completedAt: { type: 'string', maxLength: 24 }, tradeNo: { type: 'string', minLength: 1, maxLength: 100 }
          } }
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
  const recoveryWrite = [fastify.authenticateAdmin, requireBackupAdmin, requireReviewWebSession]
  const credentialsSchema = { password: { type: 'string', minLength: 1, maxLength: 256 }, totpCode: { type: 'string', pattern: '^[0-9]{6}$' } }
  const evidenceSchema = { reference: { type: 'string', minLength: 6, maxLength: 120 }, evidenceHash: { type: 'string', pattern: '^[a-f0-9]{64}$' }, observedAt: { type: 'string', format: 'date-time' }, sourceHash: { type: 'string', pattern: '^[a-f0-9]{64}$' } }
  fastify.get<{Params:{id:string}}>('/recovery-review/orders/:id', {onRequest:recoveryWrite,
    schema:{params:{...objectSchema,required:['id'],properties:{id:{type:'string',pattern:'^[A-Za-z0-9_-]{1,100}$'}}}}}, async(request,reply)=>{
    reply.header('Cache-Control','no-store');return recoveryOrder(request.params.id)
  })
  fastify.post<{Body:{resolution:RecoveryOrderResolution;password:string;totpCode?:string}}>('/recovery-review/orders/resolve', {
    onRequest:recoveryWrite,bodyLimit:32768,config:{rateLimit:{max:8,timeWindow:'1 minute'}},schema:{body:{...objectSchema,required:['resolution','password'],properties:{
      ...credentialsSchema,resolution:{...objectSchema,required:['id','orderId','sourceHash','reference','evidenceHash','observedAt','conclusion','refunds'],properties:{...evidenceSchema,
        id:{type:'string',maxLength:36},orderId:{type:'string',pattern:'^[A-Za-z0-9_-]{1,100}$'},conclusion:{enum:['unpaid','delivered','partial','refunded']},walletBalance:{type:'string',pattern:'^(0|[1-9][0-9]{0,7})\\.[0-9]{2}$'},
        walletTargets:{type:'array',maxItems:201,items:{...objectSchema,required:['userId','balance'],properties:{userId:{type:'integer',minimum:1},balance:{type:'string',pattern:'^(0|[1-9][0-9]{0,7})\\.[0-9]{2}$'}}}},
        refunds:{type:'array',maxItems:100,items:{...objectSchema,required:['id','reference'],properties:{id:{type:'string',maxLength:120},reference:{type:'string',minLength:6,maxLength:120}}}}}}}}}
  },async request=>serializeBackupMutation(async()=>{ensure(!await activeBackupTask(),'OSS_TASK_BUSY',409);return resolveRecoveryOrder(request.body.resolution,request.user.id,request.body)}))
  fastify.post<{Body:{links:LegacyPurchaseLinks;password:string;totpCode?:string}}>('/recovery-review/orders/legacy-links',{
    preValidation:async request=>{
      const body=request.body,links=body?.links
      ensure(body && Object.keys(body).every(key=>['links','password','totpCode'].includes(key)) && links &&
        Object.keys(links).sort().join(',')==='debitId,evidenceHash,id,observedAt,orderId,purchaseBillIds,reference,sourceHash',
        'OSS_RECOVERY_EVIDENCE_INVALID')
    },
    onRequest:recoveryWrite,bodyLimit:16384,config:{rateLimit:{max:8,timeWindow:'1 minute'}},schema:{body:{...objectSchema,required:['links','password'],properties:{
      ...credentialsSchema,links:{...objectSchema,required:['id','orderId','sourceHash','reference','evidenceHash','observedAt','debitId','purchaseBillIds'],properties:{
        ...evidenceSchema,id:{type:'string',maxLength:36},orderId:{type:'string',pattern:'^[A-Za-z0-9_-]{1,100}$'},debitId:{type:'integer',minimum:1,maximum:2147483647},
        purchaseBillIds:{type:'array',minItems:1,maxItems:100,uniqueItems:true,items:{type:'integer',minimum:1,maximum:2147483647}}}}}}}
  },async request=>serializeBackupMutation(async()=>{ensure(!await activeBackupTask(),'OSS_TASK_BUSY',409);return restoreLegacyPurchaseLinks(request.body.links,request.user.id,request.body)}))
  fastify.post<{Body:{links:RecoveryBillingLinks;password:string;totpCode?:string}}>('/recovery-review/orders/billing-links',{
    preValidation:async request=>{
      const body=request.body
      ensure(body && Object.keys(body).every(key=>['links','password','totpCode'].includes(key)), 'OSS_RECOVERY_EVIDENCE_INVALID')
    },
    onRequest:recoveryWrite,bodyLimit:16384,config:{rateLimit:{max:8,timeWindow:'1 minute'}},schema:{body:{...objectSchema,required:['links','password'],properties:{
      ...credentialsSchema,links:{type:'object'}}}}
  },async request=>serializeBackupMutation(async()=>{ensure(!await activeBackupTask(),'OSS_TASK_BUSY',409);return restoreRecoveryBillingLinks(request.body.links,request.user.id,request.body)}))
  fastify.post<{ Body: { category: RecoveryCategory; evidence: RecoveryEvidenceInput; password: string; totpCode?: string } }>('/recovery-review/evidence', {
    onRequest: recoveryWrite, config: { rateLimit: { max: 8, timeWindow: '1 minute' } }, schema: { body: { ...objectSchema,
      required: ['category', 'evidence', 'password'], properties: { ...credentialsSchema, category: { enum: ['finance', 'access', 'tasks'] },
      evidence: { ...objectSchema, required: Object.keys(evidenceSchema), properties: evidenceSchema } } } }
  }, async request => serializeBackupMutation(async () => { ensure(!await activeBackupTask(), 'OSS_TASK_BUSY', 409); return recordRecoveryEvidence(request.body.category, request.body.evidence, request.user.id, request.body) }))
  fastify.get<{ Querystring: { page?: number } }>('/recovery-review/access', { onRequest: recoveryWrite,
    schema: { querystring: { ...objectSchema, properties: { page: { type: 'integer', minimum: 1, maximum: 1000000 } } } }
  }, async (request, reply) => { reply.header('Cache-Control', 'no-store'); return recoveryAccessAccounts(request.query.page) })
  fastify.post<{ Body: { correction: Parameters<typeof reconcileRecoveryAccess>[0]; password: string; totpCode?: string } }>('/recovery-review/access', {
    onRequest: recoveryWrite, bodyLimit: 8192, config: { rateLimit: { max: 8, timeWindow: '1 minute' } }, schema: { body: { ...objectSchema, required: ['correction','password'], properties: {
      ...credentialsSchema, correction: { ...objectSchema, required: ['userId','expectedHash','role','status','reference','evidenceHash','observedAt'], properties: {
        ...evidenceSchema, userId: { type: 'integer', minimum: 1, maximum: 2147483647 }, expectedHash: { type: 'string', pattern: '^[a-f0-9]{32}$' },
        role: { enum: ['admin','user'] }, status: { enum: ['active','banned'] }, newPassword: { type: 'string', minLength: 12, maxLength: 128 } } } } } }
  }, async request => serializeBackupMutation(async () => { ensure(!await activeBackupTask(), 'OSS_TASK_BUSY', 409); return reconcileRecoveryAccess(request.body.correction, request.user.id, request.body) }))
  fastify.post<{ Body: { password: string; totpCode?: string } }>('/recovery-review/gateway', {
    onRequest: recoveryWrite, config: { rateLimit: { max: 8, timeWindow: '1 minute' } }, schema: { body: { ...objectSchema, required: ['password'], properties: credentialsSchema } }
  }, async request => serializeBackupMutation(async () => { ensure(!await activeBackupTask(), 'OSS_TASK_BUSY', 409); return reconcileRecoveryGateway(request.user.id, request.body) }))
  fastify.get('/recovery-review/gateway', {onRequest:recoveryWrite}, async (_request,reply)=>{
    reply.header('Cache-Control','no-store');return recoveryGatewayStatus()
  })
  fastify.post<{Body:{address:string;password:string;totpCode?:string}}>('/recovery-review/gateway/map',{
    onRequest:recoveryWrite,bodyLimit:4096,config:{rateLimit:{max:3,timeWindow:'1 minute'}},schema:{body:{...objectSchema,
      required:['address','password'],properties:{...credentialsSchema,address:{type:'string',format:'ipv4'}}}}
  },async request=>serializeBackupMutation(()=>mapRecoveryGateway(request.user.id,request.body)))
  fastify.post<{Body:{password:string;totpCode?:string;gatewayPassword:string}}>('/recovery-review/gateway/helper', {
    onRequest:recoveryWrite,bodyLimit:4096,config:{rateLimit:{max:3,timeWindow:'1 minute'}},schema:{body:{...objectSchema,
      required:['password','gatewayPassword'],properties:{...credentialsSchema,gatewayPassword:{type:'string',minLength:1,maxLength:1024}}}}
  },async request=>serializeBackupMutation(async()=>{ensure(!await activeBackupTask(),'OSS_TASK_BUSY',409);return upgradeRecoveryGatewayHelper(request.user.id,request.body)}))
  fastify.post<{ Body: { registration: RecoveryRegistration; password: string; totpCode?: string } }>('/recovery-review/register', {
    onRequest: recoveryWrite, bodyLimit: 32768, config: { rateLimit: { max: 8, timeWindow: '1 minute' } }, schema: { body: { ...objectSchema, required: ['registration','password'], properties: {
      ...credentialsSchema, registration: { type: 'object' } } } }
  }, async request => serializeBackupMutation(async () => { ensure(!await activeBackupTask(), 'OSS_TASK_BUSY', 409); return registerRecoveryBusiness(request.body.registration, request.user.id, request.body) }))
  fastify.post<{ Body: { registration: RecoveryAccountRegistration; password: string; totpCode?: string } }>('/recovery-review/register-account', {
    onRequest: recoveryWrite, bodyLimit: 16384, config: { rateLimit: { max: 8, timeWindow: '1 minute' } }, schema: { body: { ...objectSchema,
      required: ['registration','password'], properties: { ...credentialsSchema, registration: { type: 'object' } } } }
  }, async request => serializeBackupMutation(async () => { ensure(!await activeBackupTask(), 'OSS_TASK_BUSY', 409); return registerRecoveryAccount(request.body.registration,request.user.id,request.body) }))
  fastify.get<{Params:{id:string}}>('/recovery-review/instances/:id', {onRequest:recoveryWrite,schema:{params:{...objectSchema,required:['id'],properties:{id:{type:'string',pattern:'^[1-9][0-9]{0,9}$'}}}}},
    async(request,reply)=>{reply.header('Cache-Control','no-store');return recoveryInstance(Number(request.params.id))})
  fastify.post<{Body:{evidence:RecoveryInstanceEvidence;password:string;totpCode?:string}}>('/recovery-review/instance-evidence',{
    onRequest:recoveryWrite,bodyLimit:16384,config:{rateLimit:{max:8,timeWindow:'1 minute'}},schema:{body:{...objectSchema,required:['evidence','password'],
      properties:{...credentialsSchema,evidence:{type:'object'}}}}
  },async request=>serializeBackupMutation(async()=>{ensure(!await activeBackupTask(),'OSS_TASK_BUSY',409);return recordRecoveryInstance(request.body.evidence,request.user.id,request.body)}))
  fastify.post<{ Body: { registration: RecoveryRechargeRegistration; password: string; totpCode?: string } }>('/recovery-review/register-recharge', {
    onRequest: recoveryWrite, bodyLimit: 16384, config: { rateLimit: { max: 8, timeWindow: '1 minute' } }, schema: { body: { ...objectSchema,
      required: ['registration','password'], properties: { ...credentialsSchema, registration: { type: 'object' } } } }
  }, async request => serializeBackupMutation(async () => { ensure(!await activeBackupTask(), 'OSS_TASK_BUSY', 409); return registerRecoveryRecharge(request.body.registration,request.user.id,request.body) }))
  fastify.get('/recovery-review/readiness', { onRequest: [fastify.authenticateAdmin, requireBackupAdmin, requireReviewWebSession] }, async (_request, reply) => {
    reply.header('Cache-Control', 'no-store'); await seedRecoveryHosts(); return recoveryReadiness()
  })
  fastify.get('/config', { onRequest: [fastify.authenticateAdmin, requireBackupAdmin] }, async () => {
    await initBackupState()
    const config = await readBackupConfig()
    return { config: config ? publicConfig(config) : null, runtimeReady: backupRuntimeReady(), recoveryHeld: recoveryHeld(), activeTask: await activeBackupTask() }
  })
  fastify.put<{ Body: Record<string, unknown> }>('/config', { onRequest: [fastify.authenticateAdmin, requireBackupAdmin], bodyLimit: 8192 }, async request => serializeBackupMutation(async () => {
    ensure(!await activeBackupTask() && !recoveryHeld(), 'OSS_TASK_BUSY', 409)
    ensure(!automaticRestorePending(await readAutomaticRestore()),'OSS_TASK_BUSY',409)
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
    return connection(client => client.listObjects(validateObjectPrefix(request.query.prefix || '', true), request.query.cursor), request.query)
  })
  fastify.get<{ Querystring: { prefix?: string;cursor?:string } }>('/backups', { onRequest: [fastify.authenticateAdmin, requireBackupAdmin] }, async request => {
    const config = await readBackupConfig(); ensure(config, 'OSS_CONFIG_REQUIRED', 409)
    // A replacement installation has a new ID. Discover the bucket's complete
    // backups instead of requiring the owner to type A's installation UUID.
    return connection(client => client.discoverBackups(request.query.prefix ? validateObjectPrefix(request.query.prefix) : '',request.query.cursor))
  })
  fastify.get('/tasks', { onRequest: [fastify.authenticateAdmin, requireBackupAdmin] }, async () => {
    const active = await activeBackupTask(), failure = await readJson<BackupTaskResult>(statePath('inbox', 'last-failure.json'))
    const tasks = await taskResults()
    for (const task of [active, failure]) if (task) {
      const index = tasks.findIndex(t => t.id === task.id)
      if (index < 0) tasks.unshift(task)
      else if (Date.parse(task.updatedAt) >= Date.parse(tasks[index].updatedAt)) tasks[index] = task
    }
    const contextFailure=await readJson<{error:string;updatedAt:string}>(join(backupRoot(),'recovery-supervisor-failure.json'))
    const hold=await readJson<{autoResume?:boolean}>(join(backupRoot(),'recovery-hold.json'))
    return { tasks, activeTask: active, automaticRestore:publicAutomaticRestore(await readAutomaticRestore()), recoveryHeld: recoveryHeld(), autoResume:hold?.autoResume===true, continuationFailure: contextFailure && {
      error: /^[A-Z0-9_]{1,100}$/.test(contextFailure.error)?contextFailure.error:'OSS_RECOVERY_SUPERVISOR_FAILED',
      updatedAt:contextFailure.updatedAt
    } }
  })
  fastify.post('/backups', { onRequest: [fastify.authenticateAdmin, requireBackupAdmin] }, async (request, reply) => serializeBackupMutation(async () => {
    const task = await enqueueBackupTask('backup', request.user.id); await audit(request, 'backup.start'); return reply.code(202).send({ task })
  }))
  fastify.post<{ Body: { prefix: string; password: string } }>('/restore-previews', {
    onRequest: [fastify.authenticateAdmin, requireBackupAdmin], bodyLimit: 4096, schema: { body: { ...objectSchema, required: ['prefix', 'password'], properties: { prefix: { type: 'string', maxLength: 1023 }, password: { type: 'string', minLength: 12, maxLength: 256 } } } }
  }, async (request, reply) => serializeBackupMutation(async () => {
    const task = await enqueueBackupTask('preview', request.user.id, { sourcePrefix: validateObjectPrefix(request.body.prefix), password: sealSecret(request.body.password) })
    await audit(request, 'restore.preview'); return reply.code(202).send({ task })
  }))
  fastify.post<{Body:{id:string;prefix:string;password?:string}}>('/automatic-restores',{
    preValidation:async request=>{ensure(request.body && Object.keys(request.body).every(key=>['id','prefix','password'].includes(key)),'OSS_CONFIG_INVALID')},
    onRequest:[fastify.authenticateAdmin,requireBackupAdmin,requireReviewWebSession],bodyLimit:4096,
    config:{rateLimit:{max:5,timeWindow:'1 minute'}},schema:{body:{...objectSchema,required:['id','prefix'],properties:{
      id:{type:'string',format:'uuid'},prefix:{type:'string',maxLength:1023},password:{type:'string',minLength:12,maxLength:256}}}}
  },async(request,reply)=>serializeBackupMutation(async()=>{
    const operation=await beginAutomaticRestore(request.body,request.user.id)
    await audit(request,'restore.automatic');return reply.code(202).send({operation})
  }))
  fastify.post<{ Body: { previewId: string; confirmation: string } }>('/restores', {
    onRequest: [fastify.authenticateAdmin, requireBackupAdmin, requireReviewWebSession], schema: { body: { ...objectSchema, required: ['previewId', 'confirmation'], properties: { previewId: { type: 'string', maxLength: 36 }, confirmation: { type: 'string', maxLength: 80 } } } }
  }, async (request, reply) => serializeBackupMutation(async () => {
    const previewId = validateId(request.body.previewId)
    ensure(request.body.confirmation === `RESTORE ${previewId}`, 'OSS_CONFIRMATION_REQUIRED')
    const task = await enqueueBackupTask('restore', request.user.id, { previewId, confirmation: request.body.confirmation })
    await audit(request, 'restore.start'); return reply.code(202).send({ task })
  }))
  fastify.post<{ Body: { confirmation: string } }>('/resume', {
    onRequest: [fastify.authenticateAdmin, requireBackupAdmin, requireReviewWebSession], schema: { body: { ...objectSchema, required: ['confirmation'], properties: { confirmation: { type: 'string', maxLength: 80 } } } }
  }, async (request, reply) => serializeBackupMutation(async () => {
    ensure(request.body.confirmation === 'RESUME AFTER RECONCILIATION', 'OSS_CONFIRMATION_REQUIRED')
    const batch = await recoveryReadiness()
    await assertRecoveryReady(batch.batchId)
    const task = await enqueueBackupTask('resume', request.user.id, { confirmation: request.body.confirmation, recoveryBatchId: batch.batchId })
    await audit(request, 'recovery.resume'); return reply.code(202).send({ task })
  }))
  fastify.post<{ Body: { confirmation: string } }>('/rollback', {
    onRequest: [fastify.authenticateAdmin, requireBackupAdmin, requireReviewWebSession], schema: { body: { ...objectSchema, required: ['confirmation'], properties: { confirmation: { type: 'string', maxLength: 80 } } } }
  }, async (request, reply) => serializeBackupMutation(async () => {
    ensure(request.body.confirmation === 'ROLLBACK RESTORE', 'OSS_CONFIRMATION_REQUIRED')
    const task = await enqueueBackupTask('rollback', request.user.id, { confirmation: request.body.confirmation })
    await audit(request, 'recovery.rollback'); return reply.code(202).send({ task })
  }))
}
