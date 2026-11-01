import { randomUUID } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { authorizeUserWrite, type WriteActor } from '../db/user-write-authorization.js'
import { GatewayTaskError, gatewayTaskHash, validateGatewayTaskPlan, validateGatewayTaskTarget } from '../lib/gateway-task-plan.js'
import { validateStableGatewayEndpoint } from '../lib/onboarding-gateway-endpoint.js'
import { currentGatewayRecoveryContext } from '../lib/gateway-recovery-context.js'
import { managementGatewayPlatformId } from './gateway-management.js'
import { encryptGatewayTaskSecret, decryptGatewayTaskSecret, gatewayCredentialHash, gatewayCredentialSelect } from './gateway-admin-authorization.js'
import { gatewayInstallationExecutorAvailable, launchGatewayInstallationTask } from './gateway-installation-dispatcher.js'
import { executeGatewayDomainChange, type GatewayDomainReceipt } from './gateway-domain-driver.js'

const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/
const key = (id: string) => `management_gateway_domain_${id}`
const RETRIES = [15000, 30000, 60000, 120000, 300000, 600000, 900000]
// Revocation markers are retained for 30 days. Durable intents must expire
// sooner, so a long-offline worker cannot outlive the evidence of a logout.
const authorizationLifetime = 29 * 24 * 60 * 60000
const retryDelay = (attempt: number) => RETRIES[Math.max(0, Math.min(attempt - 1, RETRIES.length - 1))]
const transient = new Set(['SSH_CONNECT_FAILED', 'SSH_DISCONNECTED', 'SSH_COMMAND_TIMEOUT', 'GATEWAY_DNS_LOOKUP_FAILED',
  'GATEWAY_DOMAIN_VERIFY_FAILED', 'GATEWAY_DOMAIN_WORKER_INTERRUPTED', 'GATEWAY_DOMAIN_EXECUTOR_UNAVAILABLE',
  'GATEWAY_DOMAIN_TIMEOUT', 'GATEWAY_DOMAIN_COMMAND_FAILED', 'GATEWAY_DOMAIN_BUSY', 'GATEWAY_DOMAIN_IO_FAILED',
  'GATEWAY_DOMAIN_COMMIT_UNCERTAIN', 'GATEWAY_DOMAIN_ROLLBACK_FAILED'])
const json = (value: unknown) => value as Prisma.InputJsonObject
type Db = Prisma.TransactionClient | typeof prisma
export interface GatewayDomainInput {
  requestId: string; hostname: string; expectedHostname: string; credentials?: { password: string }
}
export interface GatewayDomainConfiguration {
  schemaVersion: 1; hostname: string; origin: string; purpose: 'independent' | 'backup'; consolePort: number
  revision: string; certificateSha256: string; tlsKeySha256: string | null; channelReady: boolean
}
export interface GatewayDomainWork {
  kind: 'domain'; configuration: GatewayDomainConfiguration; hostname: string; origin: string
  retryAt: string | null; step: string; requestId: string; authorizedAt: number
}
const intentHash = (work: GatewayDomainWork) => {
  const { tlsKeySha256: _key, channelReady: _ready, ...configuration } = work.configuration
  return gatewayTaskHash({ origin: work.origin, hostname: work.hostname, configuration })
}
function require(value: unknown, code: string): asserts value { if (!value) throw new GatewayTaskError(code) }
async function gatewayRecord(db: Db, id: string) {
  require(UUID.test(id), 'GATEWAY_TASK_NOT_FOUND')
  const gateway = await db.managementGateway.findFirst({ where: { id, platformId: managementGatewayPlatformId(), retiredAt: null } })
  require(gateway, 'GATEWAY_TASK_NOT_FOUND')
  require(gateway.mode === 'remote', 'GATEWAY_DOMAIN_USE_LOCAL_ENDPOINT')
  return gateway
}
async function configuration(db: Db, id: string): Promise<GatewayDomainConfiguration> {
  const saved = await db.systemConfig.findUnique({ where: { key: key(id) } })
  if (saved) return JSON.parse(saved.value) as GatewayDomainConfiguration
  const installed = await db.managementGatewayTask.findFirst({ where: { gatewayId: id, kind: 'install', status: 'succeeded' },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })
  const installation = installed?.installation as unknown as { desired?: { slot: string; consoleOrigin: string; consolePort: number }; domainChannel?: GatewayDomainReceipt }
  const desired = installation?.desired
  const receipt = installed?.installationReceipt as unknown as { consoleCertificateSha256?: string }
  require(installed && desired && receipt?.consoleCertificateSha256, 'GATEWAY_DOMAIN_NOT_INSTALLED')
  const origin = new URL(desired.consoleOrigin)
  const channel = installation.domainChannel
  if (channel) require(channel.gatewayId === id && channel.origin === origin.origin && channel.revision === (installed.basedOnRevision + 1n).toString() &&
    channel.certificateSha256 === receipt.consoleCertificateSha256 && /^[a-f0-9]{64}$/.test(channel.tlsKeySha256) &&
    channel.verified === true && channel.transportPreserved === true, 'GATEWAY_DOMAIN_RECEIPT_INVALID')
  return { schemaVersion: 1, hostname: origin.hostname, origin: origin.origin, purpose: desired.slot === 'b' ? 'backup' : 'independent',
    consolePort: desired.consolePort, revision: (installed.basedOnRevision + 1n).toString(),
    certificateSha256: receipt.consoleCertificateSha256, tlsKeySha256: channel?.tlsKeySha256 ?? null, channelReady: !!channel }
}
async function administrator(tx: Prisma.TransactionClient, actor: WriteActor, expectedHash?: string | null) {
  require(!actor.iat || (Number.isSafeInteger(actor.iat) && actor.iat * 1000 > Date.now() - authorizationLifetime && actor.iat * 1000 <= Date.now() + 60000),
    'GATEWAY_TASK_APPROVAL_EXPIRED')
  require(await authorizeUserWrite(tx, actor.id, actor), 'GATEWAY_WEB_SESSION_REQUIRED')
  const user = await tx.user.findUnique({ where: { id: actor.id }, select: gatewayCredentialSelect })
  require(user?.role === 'admin' && user.status === 'active', 'GATEWAY_TASK_ADMIN_REQUIRED')
  const hash = gatewayCredentialHash(user)
  require(!expectedHash || hash === expectedHash, 'GATEWAY_TASK_CREDENTIALS_CHANGED')
  return hash
}
const taskActor = (task: { createdById: number; approvedSessionId: string | null; installation: unknown }): WriteActor => ({
  id: task.createdById, sid: task.approvedSessionId ?? undefined, iat: (task.installation as GatewayDomainWork)?.authorizedAt })
export async function getGatewayDomain(id: string) {
  const gateway = await gatewayRecord(prisma, id), current = await configuration(prisma, id)
  const task = await prisma.managementGatewayTask.findFirst({ where: { gatewayId: id, kind: 'update',
    installation: { path: ['kind'], equals: 'domain' } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })
  const work = task?.installation as unknown as GatewayDomainWork | undefined
  return { gatewayId: id, purpose: current.purpose, scope: 'console' as const, hostname: current.hostname,
    desiredHostname: work?.hostname || current.hostname, revision: gateway.revision.toString(),
    requestId: task?.id || null, state: task?.status === 'queued' && task.errorCode ? 'retrying' : task?.status || 'idle',
    step: work?.step || 'idle', errorCode: task?.errorCode || null, attempt: task?.attempt || 0,
    retryAt: work?.retryAt || null, channelReady: current.channelReady,
    credentialsRequired: !current.channelReady || task?.errorCode === 'GATEWAY_DOMAIN_CREDENTIALS_REQUIRED' }
}
export async function requestGatewayDomain(id: string, input: GatewayDomainInput, actor: WriteActor,
  dispatch = { available: gatewayInstallationExecutorAvailable, launch: launchGatewayInstallationTask }) {
  const actorId = actor.id
  require(UUID.test(input.requestId), 'GATEWAY_DOMAIN_INVALID')
  const hostname = validateStableGatewayEndpoint({ hostname: input.hostname, port: 51820 }).hostname
  const expectedHostname = validateStableGatewayEndpoint({ hostname: input.expectedHostname, port: 51820 }).hostname
  require(hostname !== expectedHostname, 'GATEWAY_DOMAIN_UNCHANGED')
  require(!input.credentials || (typeof input.credentials.password === 'string' && input.credentials.password.length > 0 && input.credentials.password.length <= 1024), 'GATEWAY_DOMAIN_INVALID')
  require(dispatch.available(), 'GATEWAY_DOMAIN_EXECUTOR_UNAVAILABLE')
  await prisma.$transaction(async tx => {
    const credentialHash = await administrator(tx, actor)
    await tx.$queryRaw`SELECT id FROM management_gateways WHERE id = ${id} FOR UPDATE`
    const gateway = await gatewayRecord(tx, id), current = await configuration(tx, id)
    const duplicate = await tx.managementGatewayTask.findUnique({ where: { id: input.requestId } })
    if (duplicate) {
      const previous = duplicate.installation as unknown as GatewayDomainWork | null
      require(duplicate.createdById === actorId && duplicate.gatewayId === id && previous?.kind === 'domain' &&
        previous.hostname === hostname && previous.configuration.hostname === expectedHostname, 'GATEWAY_TASK_IDEMPOTENCY_CONFLICT')
      if (duplicate.status === 'failed') {
        require(current.hostname === expectedHostname && duplicate.basedOnRevision === gateway.revision, 'GATEWAY_DOMAIN_CONFLICT')
        require(!await tx.managementGatewayTask.findFirst({ where: { gatewayId: id, id: { not: duplicate.id },
          status: { in: ['queued', 'running', 'awaiting_confirmation', 'needs_review'] }, kind: { not: 'inspect' } } }), 'GATEWAY_TASK_JOURNAL_BUSY')
        require(current.channelReady || previous.configuration.channelReady || input.credentials, 'GATEWAY_DOMAIN_CREDENTIALS_REQUIRED')
        await tx.managementGatewayTask.update({ where: { id: duplicate.id }, data: { status: 'queued', errorCode: null, completedAt: null,
          installation: json({ ...previous, authorizedAt: actor.iat!, retryAt: null, step: 'queued' }), leaseToken: null, leaseUntil: null,
          approvedById: actorId, approvedSessionId: actor.sid, approvedCredentialHash: credentialHash, approvedAt: new Date(), approvalExpiresAt: new Date(actor.iat! * 1000 + authorizationLifetime),
          credentialsEncrypted: input.credentials ? encryptGatewayTaskSecret(JSON.stringify(input.credentials)) : null,
          credentialsExpireAt: input.credentials ? new Date(Date.now() + 30 * 60000) : null } })
      }
      return
    }
    require(current.hostname === expectedHostname && current.revision === gateway.revision.toString(), 'GATEWAY_DOMAIN_CONFLICT')
    require(!await tx.managementGatewayTask.findFirst({ where: { gatewayId: id,
      status: { in: ['queued', 'running', 'awaiting_confirmation', 'needs_review'] }, kind: { not: 'inspect' } } }), 'GATEWAY_TASK_JOURNAL_BUSY')
    require(current.channelReady || input.credentials, 'GATEWAY_DOMAIN_CREDENTIALS_REQUIRED')
    const work: GatewayDomainWork = { kind: 'domain', configuration: current, hostname,
      origin: `https://${hostname}:${current.consolePort}`, retryAt: null, step: 'queued', requestId: input.requestId, authorizedAt: actor.iat! }
    const plan = { schemaVersion: 1, taskId: input.requestId, gatewayId: id, platformId: gateway.platformId, kind: 'update',
      basedOnRevision: gateway.revision.toString(), target: validateGatewayTaskTarget(gateway.target),
      configurationHash: intentHash(work), componentHash: '0'.repeat(64), observedStateHash: gateway.targetHash }
    await tx.managementGatewayTask.create({ data: { id: input.requestId, gatewayId: id, createdById: actorId,
      kind: 'update', plan: json(plan), planHash: gatewayTaskHash(plan), basedOnRevision: gateway.revision,
      status: 'queued', installation: json(work), recoveryContext: currentGatewayRecoveryContext(),
      approvedById: actorId, approvedSessionId: actor.sid, approvedCredentialHash: credentialHash, approvedAt: new Date(), approvalExpiresAt: new Date(actor.iat! * 1000 + authorizationLifetime),
      credentialsEncrypted: input.credentials ? encryptGatewayTaskSecret(JSON.stringify(input.credentials)) : null,
      credentialsExpireAt: input.credentials ? new Date(Date.now() + 30 * 60000) : null } })
    await tx.log.create({ data: { userId: actorId, module: 'host', action: 'gateway.domain.requested', result: 'pending',
      content: `Gateway ${id}: requested console domain ${expectedHostname} -> ${hostname}; task ${input.requestId}` } })
  })
  // A launch failure remains in the durable queue and the dispatcher retries.
  await dispatch.launch(input.requestId).catch(() => {})
  return getGatewayDomain(id)
}
export async function saveGatewayDomainChannel(id: string, receipt: GatewayDomainReceipt, lease?: { id: string; token: string }) {
  await prisma.$transaction(async tx => {
    if (lease) {
      const task = await tx.managementGatewayTask.findUniqueOrThrow({ where: { id: lease.id } })
      await administrator(tx, taskActor(task), task.approvedCredentialHash)
    }
    await tx.$queryRaw`SELECT id FROM management_gateways WHERE id = ${id} FOR UPDATE`
    if (lease) {
      const task = await tx.managementGatewayTask.findUniqueOrThrow({ where: { id: lease.id } })
      require(task.gatewayId === id && task.status === 'running' && task.leaseToken === lease.token &&
        task.recoveryContext === currentGatewayRecoveryContext(), 'GATEWAY_TASK_LEASE_LOST')
    }
    const gateway = await gatewayRecord(tx, id), current = await configuration(tx, id)
    require(receipt.gatewayId === id && receipt.revision === gateway.revision.toString() &&
      receipt.origin === current.origin && receipt.certificateSha256 === current.certificateSha256 &&
      (!current.tlsKeySha256 || current.tlsKeySha256 === receipt.tlsKeySha256), 'GATEWAY_DOMAIN_RECEIPT_INVALID')
    const value = JSON.stringify({ ...current, channelReady: true, tlsKeySha256: receipt.tlsKeySha256 })
    await tx.systemConfig.upsert({ where: { key: key(id) }, create: { key: key(id), value }, update: { value } })
  })
}
export async function runGatewayDomainTask(id: string, execute = executeGatewayDomainChange) {
  const token = randomUUID()
  const task = await prisma.$transaction(async tx => {
    const old = await tx.managementGatewayTask.findUnique({ where: { id } })
    require(old && old.kind === 'update' && (old.installation as unknown as GatewayDomainWork)?.kind === 'domain', 'GATEWAY_DOMAIN_INVALID')
    let failure: string | null = null
    try { await administrator(tx, taskActor(old), old.approvedCredentialHash) }
    catch (error) { failure = error instanceof GatewayTaskError ? error.code : 'GATEWAY_DOMAIN_CONFLICT' }
    await tx.$queryRaw`SELECT id FROM management_gateways WHERE id = ${old.gatewayId} FOR UPDATE`
    const current = await tx.managementGatewayTask.findUniqueOrThrow({ where: { id } })
    const work = current.installation as unknown as GatewayDomainWork
    if (current.status !== 'queued' || (work.retryAt && Date.parse(work.retryAt) > Date.now())) return null
    try {
      const plan = validateGatewayTaskPlan(current.plan)
      const gateway = await gatewayRecord(tx, old.gatewayId)
      const saved = await configuration(tx, old.gatewayId)
      require(current.basedOnRevision === gateway.revision && gatewayTaskHash(gateway.target) === gateway.targetHash &&
        gatewayTaskHash(plan.target) === gateway.targetHash && current.planHash === gatewayTaskHash(plan) &&
        plan.configurationHash === intentHash(work) && plan.taskId === id && plan.gatewayId === gateway.id &&
        plan.kind === 'update' && plan.platformId === gateway.platformId && plan.basedOnRevision === current.basedOnRevision.toString() &&
        work.requestId === id && work.origin === `https://${work.hostname}:${work.configuration.consolePort}` &&
        saved.origin === work.configuration.origin && saved.revision === work.configuration.revision &&
        saved.certificateSha256 === work.configuration.certificateSha256 &&
        (!saved.tlsKeySha256 || !work.configuration.tlsKeySha256 || saved.tlsKeySha256 === work.configuration.tlsKeySha256), 'GATEWAY_DOMAIN_CONFLICT')
      require(current.recoveryContext === currentGatewayRecoveryContext(), 'GATEWAY_RECOVERY_CONTEXT_CHANGED')
      if (saved.tlsKeySha256 && saved.channelReady) work.configuration = { ...work.configuration, tlsKeySha256: saved.tlsKeySha256, channelReady: true }
    } catch (error) { failure = error instanceof GatewayTaskError ? error.code : 'GATEWAY_DOMAIN_CONFLICT' }
    if (failure) {
      await tx.managementGatewayTask.update({ where: { id }, data: { status: 'failed', errorCode: failure, completedAt: new Date(),
        credentialsEncrypted: null, credentialsExpireAt: null, installation: json({ ...work, step: 'failed', retryAt: null }) } })
      return null
    }
    return tx.managementGatewayTask.update({ where: { id }, data: { status: 'running', attempt: { increment: 1 }, leaseToken: token,
      leaseUntil: new Date(Date.now() + 180000), startedAt: new Date(), installation: json({ ...work, step: 'checking', retryAt: null }) } })
  })
  if (!task) return { claimed: false }
  const work = task.installation as unknown as GatewayDomainWork
  const plan = task.plan as unknown as { platformId: string; target: unknown }
  const target = validateGatewayTaskTarget(plan.target)
  const abort = new AbortController(), timeout = setTimeout(() => abort.abort(), 120000)
  try {
    let password: string | undefined
    if (task.credentialsEncrypted && task.credentialsExpireAt && task.credentialsExpireAt.getTime() > Date.now()) {
      password = (JSON.parse(decryptGatewayTaskSecret(task.credentialsEncrypted)) as { password: string }).password
    }
    const receipt = await execute({ gatewayId: task.gatewayId, platformId: plan.platformId, target, requestId: id,
      configuration: work.configuration, origin: work.origin, password, signal: abort.signal,
      progress: async (step, enrolled) => {
        if (enrolled) {
          await saveGatewayDomainChannel(task.gatewayId, enrolled, { id, token })
          work.configuration = { ...work.configuration, tlsKeySha256: enrolled.tlsKeySha256, channelReady: true }
        }
        await prisma.$transaction(async tx => {
          await administrator(tx, taskActor(task), task.approvedCredentialHash)
          require(task.recoveryContext === currentGatewayRecoveryContext() && !abort.signal.aborted, 'GATEWAY_TASK_LEASE_LOST')
          const changed = await tx.managementGatewayTask.updateMany({ where: { id, status: 'running', leaseToken: token },
            data: { installation: json({ ...work, step, retryAt: null }),
              ...(enrolled ? { credentialsEncrypted: null, credentialsExpireAt: null } : {}) } })
          require(changed.count === 1, 'GATEWAY_TASK_LEASE_LOST')
        })
      } })
    require(!abort.signal.aborted && receipt.gatewayId === task.gatewayId && receipt.origin === work.origin &&
      receipt.revision === (task.basedOnRevision + 1n).toString() && receipt.requestId === id &&
      receipt.verified === true && receipt.transportPreserved === true && /^[a-f0-9]{64}$/.test(receipt.certificateSha256) && /^[a-f0-9]{64}$/.test(receipt.tlsKeySha256) &&
      (!work.configuration.tlsKeySha256 || receipt.tlsKeySha256 === work.configuration.tlsKeySha256), 'GATEWAY_DOMAIN_RECEIPT_INVALID')
    await prisma.$transaction(async tx => {
      await administrator(tx, taskActor(task), task.approvedCredentialHash)
      await tx.$queryRaw`SELECT id FROM management_gateways WHERE id = ${task.gatewayId} FOR UPDATE`
      const current = await tx.managementGatewayTask.findUniqueOrThrow({ where: { id } })
      require(current.status === 'running' && current.leaseToken === token && current.recoveryContext === currentGatewayRecoveryContext(), 'GATEWAY_TASK_LEASE_LOST')
      const updated = await tx.managementGateway.updateMany({ where: { id: task.gatewayId, revision: task.basedOnRevision, retiredAt: null },
        data: { revision: { increment: 1 } } })
      require(updated.count === 1, 'GATEWAY_DOMAIN_CONFLICT')
      const value = JSON.stringify({ ...work.configuration, hostname: work.hostname, origin: receipt.origin, revision: receipt.revision,
        certificateSha256: receipt.certificateSha256, tlsKeySha256: receipt.tlsKeySha256, channelReady: true })
      await tx.systemConfig.upsert({ where: { key: key(task.gatewayId) }, create: { key: key(task.gatewayId), value }, update: { value } })
      await tx.managementGatewayTask.update({ where: { id }, data: { status: 'succeeded', completedAt: new Date(),
        errorCode: null, leaseToken: null, leaseUntil: null, credentialsEncrypted: null, credentialsExpireAt: null,
        installation: json({ ...work, step: 'verified', retryAt: null }), installationReceipt: json(receipt) } })
      await tx.log.create({ data: { userId: task.createdById, module: 'host', action: 'gateway.domain.verified', result: 'success',
        content: `Gateway ${task.gatewayId}: verified console domain ${work.hostname}; identity and transport preserved; task ${id}` } })
    })
    return { claimed: true, verified: true }
  } catch (error) {
    const raw = (error as { code?: unknown })?.code
    const code = typeof raw === 'string' && /^(GATEWAY|SSH)_[A-Z_]+$/.test(raw) ? raw : 'GATEWAY_DOMAIN_VERIFY_FAILED'
    const retry = transient.has(code)
    await prisma.managementGatewayTask.updateMany({ where: { id, status: 'running', leaseToken: token }, data: {
      status: retry ? 'queued' : 'failed', errorCode: code, leaseToken: null, leaseUntil: null,
      installation: json({ ...work, step: retry ? 'retrying' : 'failed', retryAt: retry ? new Date(Date.now() + retryDelay(task.attempt)).toISOString() : null }),
      ...(!retry ? { completedAt: new Date(), credentialsEncrypted: null, credentialsExpireAt: null } : {}) } })
    return { claimed: true, verified: false, errorCode: code }
  } finally { clearTimeout(timeout); abort.abort() }
}
export async function dispatchGatewayDomainTasks(available: () => boolean, launch: (id: string) => Promise<void>) {
  const due = await prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM management_gateway_tasks
    WHERE kind = 'update' AND installation->>'kind' = 'domain' AND
    ((status = 'queued' AND COALESCE(installation->>'retryAt', '') <= ${new Date().toISOString()}) OR
     (status = 'running' AND (lease_until IS NULL OR lease_until <= NOW()))) ORDER BY updated_at, id LIMIT 16`
  const tasks = await prisma.managementGatewayTask.findMany({ where: { id: { in: due.map(task => task.id) } } })
  for (const task of tasks) {
    const work = task.installation as unknown as GatewayDomainWork
    if (task.status === 'running') {
      if (!task.leaseUntil || task.leaseUntil.getTime() <= Date.now()) await prisma.managementGatewayTask.updateMany({
        where: { id: task.id, status: 'running', leaseToken: task.leaseToken }, data: { status: 'queued',
          errorCode: 'GATEWAY_DOMAIN_WORKER_INTERRUPTED', leaseToken: null, leaseUntil: null,
          installation: json({ ...work, step: 'retrying', retryAt: new Date(Date.now() + retryDelay(task.attempt)).toISOString() }) } })
      continue
    }
    if (task.credentialsExpireAt && task.credentialsExpireAt.getTime() <= Date.now()) await prisma.managementGatewayTask.updateMany({
      where: { id: task.id }, data: { credentialsEncrypted: null, credentialsExpireAt: null } })
    if (!work.retryAt || Date.parse(work.retryAt) <= Date.now()) {
      let launched = false
      if (available()) { try { await launch(task.id); launched = true } catch { /* Persist a visible dispatch failure below. */ } }
      if (!launched) await prisma.managementGatewayTask.updateMany({ where: { id: task.id, status: 'queued' },
        data: { errorCode: 'GATEWAY_DOMAIN_EXECUTOR_UNAVAILABLE', installation: json({ ...work, step: 'retrying',
          retryAt: new Date(Date.now() + 15000).toISOString() }) } })
    }
  }
}
