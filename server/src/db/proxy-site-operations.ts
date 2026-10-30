import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { Host, Instance, Prisma, ProxySite, ProxySiteOperation, ProxySiteOperationAction } from '@prisma/client'
import { prisma } from './prisma.js'
import { authorizeUserWrite, type WriteActor } from './user-write-authorization.js'
import { INSTANCE_OPERATION_LOCK_NAMESPACE, tryAdvisoryTransactionLock } from './advisory-locks.js'
import { withProxySiteMutation, ProxySiteMutationError } from './proxy-site-mutations.js'
import { PENDING_PROXY_SITE_OPERATION_STATES } from './proxy-site-operation-guards.js'
import { createCaddyClient, CaddyManagedSiteConflictError } from '../lib/caddy-client.js'
import { normalizeLogContentForStorage } from '../lib/log-localization.js'
import { sanitizeTokensInString } from '../lib/log-sanitizer.js'
import { transferHostIdentity } from '../lib/transfer-host-identity.js'

export type ProxySiteOperationAuthority = 'owner' | 'network' | 'lifecycle'
export type ProxySiteLifecycleClaim = { kind: 'instance_task' | 'transfer'; id: number } | { kind: 'delete' | 'provisioning_cleanup' }
export type ProxySiteDesiredConfig = {
  domain: string; targetIp: string; targetPort: number; httpsEnabled: boolean; remark: string | null
}
export type ProxySiteOperationRequest = {
  requestId: string; expectedRevision: number; action: ProxySiteOperationAction
  requireEnabled?: boolean
  changes?: { targetPort?: number; httpsEnabled?: boolean; remark?: string | null }
}
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const MAX_ATTEMPTS = 5
const ATTEMPT_TIMEOUT_MS = 150000
const activeOperations = new Set<string>()
const activeHosts = new Set<number>()

export function validateProxySiteOperationRequest(input: unknown): { requestId: string; expectedRevision: number } {
  const value = input as { requestId?: unknown; expectedRevision?: unknown } | null
  if (!value || typeof value.requestId !== 'string' || !UUID.test(value.requestId) ||
    !Number.isSafeInteger(value.expectedRevision) || Number(value.expectedRevision) < 0) {
    throw new ProxySiteMutationError(409, '站点状态需要重新确认，请刷新页面后重试', 'SITE_REVISION_REQUIRED')
  }
  return { requestId: value.requestId.toLowerCase(), expectedRevision: Number(value.expectedRevision) }
}

function requestHash(input: ProxySiteOperationRequest): string {
  return createHash('sha256').update(JSON.stringify([input.expectedRevision, input.action,
    input.changes?.targetPort ?? null, input.changes?.httpsEnabled ?? null,
    input.changes?.remark === undefined ? ['unchanged'] : input.changes.remark])).digest('hex')
}

export function proxySiteHostIdentity(host: Host): string {
  let caDigest = 'missing'
  const caPath = process.env.CADDY_CA_PATH?.trim()
  if (caPath) {
    try { caDigest = createHash('sha256').update(readFileSync(caPath)).digest('hex') } catch { /* An unavailable trust file remains an explicit apply failure. */ }
  }
  return createHash('sha256').update(JSON.stringify([host.id, host.userId, host.url, host.certPath, host.keyPath,
    host.serverCertificate, host.serverFingerprint, host.natPublicIp, host.ipAddress, host.caddyPort || 8444,
    host.caddyUsername, host.caddyPassword, caDigest, process.env.CADDY_TLS_SERVER_NAME || 'caddy-admin'])).digest('hex')
}

function publicOperationError(error: unknown, host?: Host): string {
  let message = error instanceof Error ? error.message : String(error)
  for (const secret of [host?.caddyPassword, host?.caddyUsername && host.caddyPassword &&
    Buffer.from(`${host.caddyUsername}:${host.caddyPassword}`).toString('base64')]) {
    if (secret) message = message.split(secret).join('[redacted]')
  }
  return sanitizeTokensInString(message).slice(0, 2000)
}

async function assertLifecycleClaim(tx: Prisma.TransactionClient, instance: Instance, claim: ProxySiteLifecycleClaim | undefined) {
  let valid = false
  if (claim?.kind === 'delete') valid = instance.status === 'deleted'
  if (claim?.kind === 'provisioning_cleanup') valid = instance.provisioningCleanupPending
  if (claim?.kind === 'instance_task') {
    const task = await tx.instanceTask.findFirst({ where: { id: claim.id, instanceId: instance.id } })
    const state = task?.replacementState as { kind?: string; phase?: string; instanceId?: number; ownerId?: number; hostId?: number; incusId?: string } | null
    // A preflight failure has made no instance changes. Its already committed
    // deletes may finish after the task fails; all target/site identities are
    // still checked by applyProxySiteOperation before touching Caddy.
    valid = task?.status === 'PROCESSING' || Boolean(task?.status === 'FAILED' && task.progress === 'cleaning_proxy_sites' &&
      ['recreate', 'change_host'].includes(task.taskType) && state?.kind === 'instance_task_sites_v1' && state.phase === 'pending' &&
      state.instanceId === instance.id && state.ownerId === instance.userId && state.hostId === instance.hostId && state.incusId === instance.incusId)
  }
  if (claim?.kind === 'transfer') {
    const transfer = await tx.instanceTransfer.findFirst({ where: {
      id: claim.id, instanceId: instance.id, fromUserId: instance.userId, status: 'processing'
    }, select: { cleanupState: true } })
    const state = transfer?.cleanupState as { hostId?: number; oldIncusId?: string; sourceOwnerId?: number; targetOwnerId?: number;
      hostIdentity?: string; actor?: WriteActor } | null
    await tx.$queryRaw`SELECT id FROM hosts WHERE id = ${instance.hostId} FOR SHARE`
    const host = await tx.host.findUnique({ where: { id: instance.hostId } })
    valid = Boolean(state && host && state.hostId === instance.hostId && state.oldIncusId === instance.incusId &&
      state.sourceOwnerId === instance.userId && state.hostIdentity === transferHostIdentity(host) && state.actor &&
      [state.sourceOwnerId, state.targetOwnerId].includes(state.actor.id) && await authorizeUserWrite(tx, state.actor.id, state.actor, true))
  }
  if (!valid) throw new ProxySiteMutationError(409, '原生命周期领取状态已变化，禁止继续清理站点', 'SITE_LIFECYCLE_CLAIM_CHANGED')
}

async function assertNoResourceWorkflow(tx: Prisma.TransactionClient, instanceId: number, claim?: ProxySiteLifecycleClaim) {
  const where = { instanceId, status: { in: ['PENDING', 'PROCESSING'] as Array<'PENDING' | 'PROCESSING'> } }
  if (await tx.instanceTask.count({ where: { ...where, ...(claim?.kind === 'instance_task' ? { id: { not: claim.id } } : {}) } }) || await tx.restoreTask.count({ where }) ||
    await tx.backupUploadTask.count({ where }) ||
    await tx.instanceTransfer.count({ where: { instanceId, status: { in: ['pending', 'processing'] }, ...(claim?.kind === 'transfer' ? { id: { not: claim.id } } : {}) } })) {
    throw new ProxySiteMutationError(409, '实例正在执行其他操作，反代意图保留待重试', 'INSTANCE_BUSY')
  }
}

async function authorizeOperation(tx: Prisma.TransactionClient, actor: WriteActor, authority: ProxySiteOperationAuthority,
  instance: Instance, host: Host) {
  if (!await authorizeUserWrite(tx, actor.id, actor)) throw new ProxySiteMutationError(403, '原操作会话已失效，请重新登录后重试', 'FORBIDDEN')
  const current = await tx.user.findUniqueOrThrow({ where: { id: actor.id }, select: { role: true } })
  if (authority === 'owner' ? current.role !== 'user' || instance.userId !== actor.id
    : current.role !== 'admin' && host.userId !== actor.id && instance.userId !== actor.id) {
    throw new ProxySiteMutationError(403, '当前账号无权应用此站点意图', 'FORBIDDEN')
  }
}

/** Caller already holds the instance operation/row and host row locks. */
export async function prepareProxySiteOperationInTransaction(tx: Prisma.TransactionClient,
  context: { instance: Instance; host: Host; site: ProxySite; actor: WriteActor; authority?: ProxySiteOperationAuthority },
  input: ProxySiteOperationRequest, lifecycleClaim?: ProxySiteLifecycleClaim): Promise<ProxySiteOperation> {
  const { instance, host, site, actor } = context
  const authority = context.authority || 'owner'
  validateProxySiteOperationRequest(input)
  if (authority === 'lifecycle') {
    if (input.action !== 'delete') throw new ProxySiteMutationError(403, '生命周期清理仅允许删除站点')
    await assertLifecycleClaim(tx, instance, lifecycleClaim)
  } else await authorizeOperation(tx, actor, authority, instance, host)
  await assertNoResourceWorkflow(tx, instance.id, lifecycleClaim)
  if (authority !== 'lifecycle' && (!['running', 'stopped'].includes(instance.status) || instance.provisioningCleanupPending || instance.deletionBillingPending ||
    (instance.expiresAt && instance.expiresAt <= new Date()))) throw new ProxySiteMutationError(409, '实例未就绪或已到期，不能提交站点修改', 'INSTANCE_NOT_READY')
  const hash = requestHash(input)
  const existing = await tx.proxySiteOperation.findUnique({ where: { id: input.requestId } })
  if (existing) {
    if (existing.siteKey !== site.siteKey || existing.actorId !== actor.id || existing.requestHash !== hash ||
      existing.revision !== input.expectedRevision + 1) {
      throw new ProxySiteMutationError(409, '请求标识已用于不同的站点操作', 'SITE_REQUEST_CONFLICT')
    }
    if (existing.authority !== authority || Boolean(existing.lifecycleClaim) !== Boolean(lifecycleClaim)) {
      throw new ProxySiteMutationError(409, '请求标识已用于不同权限的站点操作', 'SITE_REQUEST_CONFLICT')
    }
    return existing
  }
  if (site.revision !== input.expectedRevision) throw new ProxySiteMutationError(409, '站点配置已变化，请刷新后重试', 'SITE_REVISION_CHANGED')
  if (input.requireEnabled && !site.enabled) throw new ProxySiteMutationError(400, '站点已禁用，请先启用')
  if (await tx.proxySiteOperation.count({ where: { siteKey: site.siteKey, state: { in: [...PENDING_PROXY_SITE_OPERATION_STATES] } } })) {
    throw new ProxySiteMutationError(409, '站点已有未完成操作，请重试原操作', 'SITE_OPERATION_PENDING')
  }
  if (site.revision >= 2147483647) throw new ProxySiteMutationError(409, '站点代次已达上限，请联系管理员')
  if (input.action === 'upsert' && !instance.ipv4) throw new ProxySiteMutationError(409, '实例未分配 IPv4，不能提交反代配置')
  const desired: ProxySiteDesiredConfig = { domain: site.domain, targetIp: instance.ipv4 || '',
    targetPort: input.changes?.targetPort ?? site.targetPort, httpsEnabled: input.changes?.httpsEnabled ?? site.httpsEnabled,
    remark: input.changes?.remark === undefined ? site.remark : input.changes.remark }
  const revision = site.revision + 1
  await tx.proxySite.update({ where: { id: site.id }, data: { revision } })
  const operation = await tx.proxySiteOperation.create({ data: { id: input.requestId, siteId: site.id, siteKey: site.siteKey,
    instanceId: instance.id, hostId: host.id, ownerId: instance.userId, actorId: actor.id, actorSid: actor.sid!, actorIat: actor.iat!,
    authority, ...(lifecycleClaim ? { lifecycleClaim } : {}), identityHash: proxySiteHostIdentity(host), incusId: instance.incusId, revision, action: input.action,
    desiredConfig: desired, requestHash: hash, state: 'pending', nextRetryAt: new Date() } })
  await tx.log.create({ data: { userId: actor.id, instanceId: instance.id, module: 'proxy', action: 'site.operation.accepted',
    content: normalizeLogContentForStorage(`Accepted proxy site ${site.domain} ${input.action}, operation ${operation.id}, revision ${revision}`), result: 'pending' } })
  return operation
}

export async function prepareProxySiteOperation(instanceId: number, siteId: number, actor: WriteActor,
  input: ProxySiteOperationRequest): Promise<ProxySiteOperation> {
  validateProxySiteOperationRequest(input)
  // A lost successful delete response still has an authenticated durable receipt.
  const receipt = await prisma.proxySiteOperation.findUnique({ where: { id: input.requestId } })
  if (receipt) return prisma.$transaction(async tx => {
    if (!await authorizeUserWrite(tx, actor.id, actor, true) || receipt.actorId !== actor.id ||
      receipt.siteId !== siteId || receipt.instanceId !== instanceId || receipt.requestHash !== requestHash(input) ||
      receipt.revision !== input.expectedRevision + 1 || receipt.authority !== 'owner') {
      throw new ProxySiteMutationError(409, '请求收据与当前账号或操作不匹配', 'SITE_REQUEST_CONFLICT')
    }
    return tx.proxySiteOperation.findUniqueOrThrow({ where: { id: receipt.id } })
  })
  return withProxySiteMutation(instanceId, siteId, actor, ({ tx, instance, host, site }) =>
    prepareProxySiteOperationInTransaction(tx, { instance, host, site: site!, actor }, input))
}

/** Caller holds the instance, host and site locks. Only the IP changes; the
 * authorized configuration and exact site/host identity remain the same. */
export async function supersedeProxySiteIpv4Operation(tx: Prisma.TransactionClient,
  context: { instance: Instance; host: Host; site: ProxySite; actor: WriteActor }, previous: ProxySiteOperation
): Promise<ProxySiteOperation> {
  const { instance, host, site } = context
  if (previous.action !== 'upsert' || !['owner', 'network'].includes(previous.authority) || previous.lifecycleClaim ||
    previous.siteKey !== site.siteKey || previous.siteId !== site.id || previous.revision !== site.revision ||
    previous.instanceId !== instance.id || previous.ownerId !== instance.userId || previous.hostId !== host.id ||
    previous.incusId !== instance.incusId || previous.identityHash !== proxySiteHostIdentity(host) ||
    !PENDING_PROXY_SITE_OPERATION_STATES.includes(previous.state as typeof PENDING_PROXY_SITE_OPERATION_STATES[number])) {
    throw new ProxySiteMutationError(409, '原反代意图身份或目标已变化，禁止自动替换', 'SITE_IDENTITY_CHANGED')
  }
  const actor = previous.authority === 'owner'
    ? { id: previous.actorId, sid: previous.actorSid, iat: previous.actorIat } : context.actor
  await authorizeOperation(tx, actor, previous.authority as 'owner' | 'network', instance, host)
  await tx.$executeRawUnsafe('SAVEPOINT proxy_ipv4_replace')
  try {
  await tx.$queryRaw`SELECT id FROM proxy_site_operations WHERE id = ${previous.id}::uuid FOR UPDATE`
  const replacementId = randomUUID()
  const retired = await tx.proxySiteOperation.updateMany({ where: { id: previous.id, revision: previous.revision,
    state: previous.state, attemptId: previous.attemptId }, data: { state: 'superseded', attemptId: null,
    nextRetryAt: null, completedAt: new Date(), error: `IPv4 已变化，原代次停止；替代操作 ${replacementId}` } })
  if (retired.count !== 1) throw new ProxySiteMutationError(409, '原执行代次已变化，请重新同步', 'SITE_REVISION_CHANGED')
  const desired = previous.desiredConfig as ProxySiteDesiredConfig
  const replacement = await prepareProxySiteOperationInTransaction(tx, { ...context, actor, authority: previous.authority as 'owner' | 'network' },
    { requestId: replacementId, expectedRevision: site.revision, action: 'upsert', requireEnabled: true,
      changes: { targetPort: desired.targetPort, httpsEnabled: desired.httpsEnabled, remark: desired.remark } })
  await tx.$executeRawUnsafe('RELEASE SAVEPOINT proxy_ipv4_replace')
  return replacement
  } catch (error) {
    await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT proxy_ipv4_replace')
    await tx.$executeRawUnsafe('RELEASE SAVEPOINT proxy_ipv4_replace')
    throw error
  }
}

export async function retryProxySiteOperation(instanceId: number, siteId: number, actor: WriteActor,
  input: { requestId: string; expectedRevision: number }): Promise<ProxySiteOperation> {
  return withProxySiteMutation(instanceId, siteId, actor, async ({ tx, instance, host, site }) => {
    const operation = await tx.proxySiteOperation.findUnique({ where: { id: input.requestId } })
    const lifecycleRetry = operation?.authority === 'lifecycle' &&
      (operation.lifecycleClaim as ProxySiteLifecycleClaim | null)?.kind === 'instance_task'
    if (!operation || operation.actorId !== actor.id || (operation.authority !== 'owner' && !lifecycleRetry) ||
      operation.siteKey !== site!.siteKey || operation.revision !== input.expectedRevision ||
      site!.revision !== input.expectedRevision) throw new ProxySiteMutationError(409, '原操作或站点代次已变化，请刷新后重试')
    if (lifecycleRetry) {
      const claim = operation.lifecycleClaim as ProxySiteLifecycleClaim & { id: number }
      const task = await tx.instanceTask.findUnique({ where: { id: claim.id } })
      if (task?.status !== 'FAILED' || task.progress !== 'cleaning_proxy_sites') {
        throw new ProxySiteMutationError(409, '原任务尚未结束或不是安全预检失败，禁止重试站点清理', 'SITE_LIFECYCLE_CLAIM_CHANGED')
      }
      await assertLifecycleClaim(tx, instance, claim)
    }
    if (operation.state === 'succeeded') return operation
    if (operation.state === 'superseded') throw new ProxySiteMutationError(409, '原操作已被新 IPv4 代次替代，请刷新页面', 'SITE_REVISION_CHANGED')
    if (operation.state === 'applying' && operation.startedAt && Date.now() - operation.startedAt.getTime() < ATTEMPT_TIMEOUT_MS) return operation
    if (operation.ownerId !== instance.userId || operation.hostId !== host.id || operation.incusId !== instance.incusId ||
      operation.identityHash !== proxySiteHostIdentity(host) || operation.action === 'upsert' && (operation.desiredConfig as ProxySiteDesiredConfig).targetIp !== (instance.ipv4 || '')) {
      throw new ProxySiteMutationError(409, '原操作的实例或宿主身份已变化，必须先恢复原连接；禁止改用新目标重试', 'SITE_IDENTITY_CHANGED')
    }
    return tx.proxySiteOperation.update({ where: { id: operation.id }, data: { actorId: actor.id, actorSid: actor.sid!, actorIat: actor.iat!,
      authority: lifecycleRetry ? 'lifecycle' : 'owner', state: 'pending', attemptId: null, startedAt: null, attempts: 0, nextRetryAt: new Date() } })
  })
}

export function proxySiteOperationFields(site: ProxySite, operation?: ProxySiteOperation | null) {
  const pending = Boolean(operation && operation.state !== 'succeeded')
  return { siteKey: site.siteKey, revision: site.revision, appliedRevision: site.appliedRevision, syncPending: pending,
    operationId: pending ? operation!.id : null, operationAction: pending ? operation!.action : null,
    operationState: pending ? operation!.state : null, nextRetryAt: pending ? operation!.nextRetryAt : null }
}

export async function loadProxySiteOperationView(site: ProxySite) {
  const operation = await prisma.proxySiteOperation.findUnique({ where: { siteKey_revision: { siteKey: site.siteKey, revision: site.revision } } })
  return { ...site, ...proxySiteOperationFields(site, operation) }
}

export async function proxySiteOperationResponse(operation: ProxySiteOperation) {
  const site = await prisma.proxySite.findFirst({ where: { id: operation.siteId, siteKey: operation.siteKey,
    instance: { userId: operation.ownerId } } })
  const pending = operation.state !== 'succeeded'
  const httpStatus = !pending ? 200 : ['blocked', 'superseded'].includes(operation.state) ? 409 : operation.state === 'retry' ? 502 : 202
  return { httpStatus, pending, operationId: operation.id, operationAction: operation.action,
    operationState: operation.state, nextRetryAt: operation.nextRetryAt,
    message: pending ? operation.error || '站点操作已接受，正在同步' : operation.action === 'delete' ? '站点已删除' : '站点配置已同步',
    ...(operation.error ? { error: operation.error } : {}),
    ...(site ? { site: { ...site, ...proxySiteOperationFields(site, operation) }, enabled: site.enabled, status: site.status }
      : { deleted: operation.state === 'succeeded' && operation.action === 'delete' }) }
}

/** The committed intent survives any SQL/commit failure after remote success. */
export async function applyProxySiteOperation(operationId: string): Promise<ProxySiteOperation> {
  const initial = await prisma.proxySiteOperation.findUniqueOrThrow({ where: { id: operationId } })
  if (['succeeded', 'blocked', 'superseded'].includes(initial.state) || activeOperations.has(operationId) || activeHosts.has(initial.hostId)) return initial
  activeOperations.add(operationId); activeHosts.add(initial.hostId)
  const attemptId = randomUUID()
  let currentHost: Host | undefined
  let didClaim = false
  try {
    const now = new Date()
    const claimed = await prisma.proxySiteOperation.updateMany({ where: { id: operationId, revision: initial.revision,
      OR: [{ state: { in: ['pending', 'retry'] }, OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }] },
        { state: 'applying', OR: [{ startedAt: null }, { startedAt: { lt: new Date(now.getTime() - ATTEMPT_TIMEOUT_MS) } }] }] },
      data: { state: 'applying', attemptId, startedAt: now, attempts: { increment: 1 } } })
    if (!claimed.count) return prisma.proxySiteOperation.findUniqueOrThrow({ where: { id: operationId } })
    didClaim = true
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`
      if (!await tryAdvisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, initial.instanceId)) throw new ProxySiteMutationError(409, '实例正在执行其他操作', 'INSTANCE_BUSY')
      await tx.$queryRaw`SELECT id FROM instances WHERE id = ${initial.instanceId} FOR UPDATE`
      const instance = await tx.instance.findUnique({ where: { id: initial.instanceId } })
      if (!instance || instance.userId !== initial.ownerId || instance.hostId !== initial.hostId || instance.incusId !== initial.incusId) {
        throw new ProxySiteMutationError(409, '实例身份或归属变化，原站点操作已阻止', 'SITE_IDENTITY_CHANGED')
      }
      await tx.$queryRaw`SELECT id FROM hosts WHERE id = ${initial.hostId} FOR SHARE`
      const host = await tx.host.findUnique({ where: { id: initial.hostId } }); currentHost = host ?? undefined
      if (!host || proxySiteHostIdentity(host) !== initial.identityHash) throw new ProxySiteMutationError(409, '宿主机连接身份或凭据变化，请恢复原连接后重试', 'SITE_IDENTITY_CHANGED')
      const lifecycleClaim = initial.authority === 'lifecycle' ? initial.lifecycleClaim as ProxySiteLifecycleClaim : undefined
      if (initial.authority === 'lifecycle') await assertLifecycleClaim(tx, instance, lifecycleClaim)
      else await authorizeOperation(tx, { id: initial.actorId, sid: initial.actorSid, iat: initial.actorIat }, initial.authority as ProxySiteOperationAuthority, instance, host)
      await assertNoResourceWorkflow(tx, instance.id, lifecycleClaim)
      if (initial.authority !== 'lifecycle' && (instance.provisioningCleanupPending || instance.deletionBillingPending || instance.status === 'deleted')) {
        throw new ProxySiteMutationError(409, '实例正在清理，原站点操作已阻止', 'INSTANCE_NOT_READY')
      }
      await tx.$queryRaw`SELECT id FROM proxy_sites WHERE id = ${initial.siteId} FOR UPDATE`
      const site = await tx.proxySite.findUnique({ where: { id: initial.siteId } })
      const operation = await tx.proxySiteOperation.findUniqueOrThrow({ where: { id: operationId } })
      if (!site || site.siteKey !== initial.siteKey || site.revision !== initial.revision || site.instanceId !== instance.id || site.hostId !== host.id ||
        operation.attemptId !== attemptId || operation.state !== 'applying') throw new ProxySiteMutationError(409, '站点代次或执行尝试已变化，旧操作已停止', 'SITE_REVISION_CHANGED')
      const desired = operation.desiredConfig as ProxySiteDesiredConfig
      if (operation.action === 'upsert' && desired.targetIp !== (instance.ipv4 || '')) throw new ProxySiteMutationError(409, '实例 IP 已变化，原站点目标已阻止', 'SITE_IDENTITY_CHANGED')
      if (operation.action === 'upsert' && (!['running', 'stopped'].includes(instance.status) || (instance.expiresAt && instance.expiresAt <= new Date()))) {
        throw new ProxySiteMutationError(409, '实例未就绪或已到期，反代意图保留', 'INSTANCE_NOT_READY')
      }
      if (!host.caddyEnabled || !host.caddyUsername || !host.caddyPassword) throw new Error('Caddy 未启用或凭据缺失')
      const address = host.natPublicIp || host.ipAddress
      if (!address) throw new Error('宿主机未配置 Caddy 连接地址')
      const client = createCaddyClient({ host: address, port: host.caddyPort || 8444, username: host.caddyUsername, password: host.caddyPassword })
      await client.reconcileManagedSite({ siteKey: site.siteKey, revision: operation.revision, action: operation.action,
        ...desired, adoptLegacy: site.appliedRevision === 0 }, async () => {
        const current = await tx.proxySiteOperation.findUnique({ where: { id: operationId }, select: { state: true, attemptId: true } })
        if (current?.state !== 'applying' || current.attemptId !== attemptId) throw new ProxySiteMutationError(409, '旧执行尝试已停止', 'SITE_REVISION_CHANGED')
      })
      if (operation.action === 'delete') await tx.proxySite.delete({ where: { id: site.id } })
      else await tx.proxySite.update({ where: { id: site.id }, data: { targetPort: desired.targetPort, httpsEnabled: desired.httpsEnabled,
        remark: desired.remark, enabled: operation.action === 'upsert', status: operation.action === 'upsert' ? 'active' : 'pending',
        error: null, ipv4SyncPending: false, appliedRevision: operation.revision } })
      const completed = await tx.proxySiteOperation.updateMany({ where: { id: operation.id, state: 'applying', attemptId, revision: operation.revision },
        data: { state: 'succeeded', completedAt: new Date(), error: null, nextRetryAt: null } })
      if (!completed.count) throw new ProxySiteMutationError(409, '操作回执已变化，待重新核验', 'SITE_REVISION_CHANGED')
      await tx.log.create({ data: { userId: operation.actorId, instanceId: instance.id, module: 'proxy', action: 'site.operation.applied',
        content: normalizeLogContentForStorage(`Applied proxy site ${desired.domain} ${operation.action}, operation ${operation.id}, revision ${operation.revision}`), result: 'success' } })
    }, { maxWait: 5000, timeout: 120000 })
  } catch (error) {
    if (!didClaim) throw error
    const latest = await prisma.proxySiteOperation.findUnique({ where: { id: operationId } })
    if (!latest) throw error
    const blocked = error instanceof CaddyManagedSiteConflictError ||
      error instanceof ProxySiteMutationError && error.code !== 'INSTANCE_BUSY' || latest.attempts >= MAX_ATTEMPTS
    const message = `站点 ${((latest.desiredConfig as ProxySiteDesiredConfig).domain)} 同步失败：${publicOperationError(error, currentHost)}`
    // If commit actually succeeded but its response was lost, this CAS is a no-op.
    await prisma.$transaction(async tx => {
      const recorded = await tx.proxySiteOperation.updateMany({ where: { id: operationId, state: 'applying', attemptId },
        data: { state: blocked ? 'blocked' : 'retry', error: message,
          nextRetryAt: blocked ? null : new Date(Date.now() + Math.min(600000, 5000 * 3 ** Math.max(0, latest.attempts - 1))) } })
      if (recorded.count) await tx.proxySite.updateMany({ where: { id: latest.siteId, siteKey: latest.siteKey, revision: latest.revision }, data: { error: message } })
    })
  } finally {
    activeOperations.delete(operationId); activeHosts.delete(initial.hostId)
  }
  return prisma.proxySiteOperation.findUniqueOrThrow({ where: { id: operationId } })
}

/** Run only after the durable lifecycle claim commits, before ownership/resource
 * finalization. A fixed caller snapshot cannot silently expand to newer sites.
 */
export async function cleanupProxySitesForLifecycle(instanceId: number, claim: ProxySiteLifecycleClaim,
  expectedSites?: Array<{ id: number; siteKey: string; revision: number }>, retryBlocked = false
): Promise<{ deleted: number; pending: number; errors: string[] }> {
  const candidates = expectedSites ?? await prisma.proxySite.findMany({ where: { instanceId },
    select: { id: true, siteKey: true, revision: true }, orderBy: { id: 'asc' } })
  let deleted = 0
  const errors: string[] = []
  for (const candidate of candidates) {
    try {
      const operation = await prisma.$transaction(async tx => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`
        if (!await tryAdvisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, instanceId)) {
          throw new ProxySiteMutationError(409, '实例生命周期正在处理，请重试站点清理', 'INSTANCE_BUSY')
        }
        await tx.$queryRaw`SELECT id FROM instances WHERE id = ${instanceId} FOR UPDATE`
        const instance = await tx.instance.findUnique({ where: { id: instanceId } })
        if (!instance) throw new ProxySiteMutationError(409, '实例记录缺失，无法核验原清理领取', 'SITE_IDENTITY_CHANGED')
        await assertLifecycleClaim(tx, instance, claim)
        await tx.$queryRaw`SELECT id FROM hosts WHERE id = ${instance.hostId} FOR SHARE`
        const host = await tx.host.findUniqueOrThrow({ where: { id: instance.hostId } })
        await tx.$queryRaw`SELECT id FROM proxy_sites WHERE id = ${candidate.id} FOR UPDATE`
        const site = await tx.proxySite.findUnique({ where: { id: candidate.id } })
        const receipt = await tx.proxySiteOperation.findFirst({ where: { instanceId, siteKey: candidate.siteKey,
          action: 'delete', authority: 'lifecycle', lifecycleClaim: { equals: claim } }, orderBy: { revision: 'desc' } })
        if (receipt) {
          if (receipt.state === 'succeeded') {
            if (site) throw new ProxySiteMutationError(409, '删除收据与站点记录不一致，请核验', 'SITE_IDENTITY_CHANGED')
            return receipt
          }
          if (!site || site.siteKey !== candidate.siteKey || site.revision !== receipt.revision ||
            receipt.ownerId !== instance.userId || receipt.hostId !== host.id || receipt.incusId !== instance.incusId ||
            receipt.identityHash !== proxySiteHostIdentity(host) ||
            (candidate.revision !== receipt.revision && candidate.revision + 1 !== receipt.revision)) {
            throw new ProxySiteMutationError(409, '原生命周期站点身份已变化，禁止清理新目标', 'SITE_IDENTITY_CHANGED')
          }
          if (retryBlocked && receipt.state === 'blocked') return tx.proxySiteOperation.update({ where: { id: receipt.id },
            data: { state: 'pending', attempts: 0, attemptId: null, startedAt: null, nextRetryAt: new Date() } })
          return receipt
        }
        if (!site || site.siteKey !== candidate.siteKey || site.revision !== candidate.revision || site.instanceId !== instanceId || site.hostId !== host.id) {
          throw new ProxySiteMutationError(409, '固定站点清单与当前记录不一致且无成功删除收据', 'SITE_IDENTITY_CHANGED')
        }
        return prepareProxySiteOperationInTransaction(tx, { instance, host, site,
          actor: { id: instance.userId, sid: 'lifecycle', iat: Math.floor(Date.now() / 1000) }, authority: 'lifecycle' },
          { requestId: randomUUID(), expectedRevision: site.revision, action: 'delete' }, claim)
      }, { maxWait: 5000, timeout: 15000 })
      const applied = await applyProxySiteOperation(operation.id)
      if (applied.state === 'succeeded') deleted++
      else errors.push(applied.error || `站点 ${candidate.id} 删除仍待处理 (${applied.state})`)
    } catch (error) {
      errors.push(publicOperationError(error))
    }
  }
  return { deleted, pending: candidates.length - deleted, errors }
}

export async function reconcilePendingProxySiteOperations(): Promise<number> {
  const now = new Date()
  const candidates = await prisma.proxySiteOperation.findMany({ where: { OR: [
    { state: { in: ['pending', 'retry'] }, OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }] },
    { state: 'applying', OR: [{ startedAt: null }, { startedAt: { lt: new Date(now.getTime() - ATTEMPT_TIMEOUT_MS) } }] }
  ] }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 20, select: { id: true } })
  for (const candidate of candidates) await applyProxySiteOperation(candidate.id)
  return candidates.length
}
