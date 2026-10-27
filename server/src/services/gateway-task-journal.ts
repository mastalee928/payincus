import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { tryAdvisoryTransactionLock, MANAGEMENT_GATEWAY_TASK_LOCK_NAMESPACE } from '../db/advisory-locks.js'
import { GatewayTaskError, GATEWAY_TASK_STEPS, gatewayTaskHash, validateGatewayTaskPlan, validateGatewayTaskTarget,
  validateGatewayStepReceipt, type GatewayTaskPlan } from '../lib/gateway-task-plan.js'
import { bindGatewayPreflightReport, validateGatewayPreflightRequest } from './gateway-preflight.js'
import { validateGatewayInstallationDesired, validateGatewayInstallationPreview, validateGatewayInstallationRequest, validateGatewayInstallationReceipt, validateGatewayBootstrapMaterial,
  type GatewayInstallationDesired } from '../lib/gateway-installation.js'
import { decryptGatewayTaskSecret, gatewayCredentialHash, gatewayCredentialSelect } from './gateway-admin-authorization.js'
import { currentGatewayRecoveryContext } from '../lib/gateway-recovery-context.js'
import { remoteGatewayNetworksOverlap } from '../lib/remote-gateway-setup.js'

const LEASE_MS = 60000
const APPROVAL_MS = 10 * 60000
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/
const HASH = /^[a-f0-9]{64}$/
function fail(code: string): never { throw new GatewayTaskError(code) }
const json = (value: unknown) => value as Prisma.InputJsonObject
let queue: Promise<unknown> = Promise.resolve()
let queued = 0
async function journalTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  // Queue before opening the transaction: duplicate requests must not burn
  // their transaction timeout while waiting for this process's previous work.
  if (queued >= 64) fail('GATEWAY_TASK_JOURNAL_BUSY')
  queued++
  const operation = queue.catch(() => {}).then(() => prisma.$transaction(work, { maxWait: 5000, timeout: 5000 }))
  queue = operation
  try { return await operation } finally { queued-- }
}
// Internal journal only. No HTTP authorization or remote executor is implied.
// In particular, caller-supplied receipts are not trusted by a web route.
export const gatewayTaskPublicSelect = {
  id: true, gatewayId: true, kind: true, plan: true, planHash: true, inspection: true, basedOnRevision: true,
  preparationState: true, installationPreview: true, installationReceipt: true, bootstrapExpiresAt: true,
  status: true, approvedAt: true, approvalExpiresAt: true, attempt: true, errorCode: true,
  startedAt: true, completedAt: true, createdAt: true, updatedAt: true,
  steps: { select: { key: true, ordinal: true, status: true, operationId: true, receipt: true,
    receiptHash: true, startedAt: true, completedAt: true }, orderBy: { ordinal: 'asc' as const } }
} as const
async function lock(tx: Prisma.TransactionClient) {
  // First version has one serialized control-plane mutation lane. Never hold
  // this transaction open across SSH, network work, or local privileged work.
  if (!await tryAdvisoryTransactionLock(tx, MANAGEMENT_GATEWAY_TASK_LOCK_NAMESPACE, 1)) fail('GATEWAY_TASK_JOURNAL_BUSY')
}
async function activeAdmin(tx: Prisma.TransactionClient, id: number) {
  if (!Number.isSafeInteger(id) || id < 1) fail('GATEWAY_TASK_ADMIN_REQUIRED')
  // The row share lock also prevents demotion/banning during this commit.
  const rows = await tx.$queryRaw<Array<{ role: string; status: string }>>`
    SELECT role, status FROM users WHERE id = ${id} FOR SHARE`
  if (rows[0]?.role !== 'admin' || rows[0]?.status !== 'active') fail('GATEWAY_TASK_ADMIN_REQUIRED')
}
async function currentApprovalCredentials(tx: Prisma.TransactionClient, task: { createdById: number; approvedCredentialHash: string | null }) {
  if (task.approvedCredentialHash === null) return
  const user = await tx.user.findUnique({ where: { id: task.createdById }, select: gatewayCredentialSelect })
  if (!user || gatewayCredentialHash(user) !== task.approvedCredentialHash) fail('GATEWAY_TASK_CREDENTIALS_CHANGED')
}
function currentRecoveryContext(task: { preparationState: string | null; recoveryContext: string | null }) {
  if (task.preparationState !== null && task.recoveryContext !== currentGatewayRecoveryContext()) fail('GATEWAY_RECOVERY_CONTEXT_CHANGED')
}
function authenticatedPlan(task: { id: string; gatewayId: string; kind: string; plan: unknown; planHash: string; basedOnRevision: bigint },
  gateway: { platformId: string; targetHash: string; target: Prisma.JsonValue; revision: bigint; retiredAt: Date | null; mode: string; machineId: string }) {
  const plan = validateGatewayTaskPlan(task.plan)
  if (task.planHash !== gatewayTaskHash(plan) || task.id !== plan.taskId || task.gatewayId !== plan.gatewayId ||
    task.kind !== plan.kind || task.basedOnRevision.toString() !== plan.basedOnRevision ||
    gateway.platformId !== plan.platformId || gateway.targetHash !== gatewayTaskHash(plan.target) ||
    gatewayTaskHash(gateway.target) !== gateway.targetHash || gateway.mode !== plan.target.mode ||
    gateway.machineId !== plan.target.machineId || gateway.retiredAt || gateway.revision !== task.basedOnRevision) fail('GATEWAY_TASK_PLAN_STALE')
  return plan
}
export async function registerManagementGateway(input: { id: string; platformId: string; name: string; target: unknown }, actorId: number) {
  if (!UUID.test(input.id) || !UUID.test(input.platformId) || typeof input.name !== 'string' ||
    !input.name.trim() || input.name.length > 80 || [...input.name].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) fail('GATEWAY_TASK_TARGET_INVALID')
  const target = validateGatewayTaskTarget(input.target), targetHash = gatewayTaskHash(target)
  const id = input.id, platformId = input.platformId, name = input.name.trim()
  return journalTransaction(async tx => {
    await lock(tx); await activeAdmin(tx, actorId)
    const existing = await tx.managementGateway.findUnique({ where: { id } })
    if (existing) {
      if (existing.platformId !== platformId || existing.targetHash !== targetHash ||
        gatewayTaskHash(existing.target) !== targetHash || existing.mode !== target.mode ||
        existing.machineId !== target.machineId || existing.retiredAt) fail('GATEWAY_TASK_TARGET_CONFLICT')
      return existing
    }
    if (await tx.managementGateway.findUnique({ where: { machineId: target.machineId } })) fail('GATEWAY_TASK_TARGET_CONFLICT')
    return tx.managementGateway.create({ data: { id, platformId,
      name, mode: target.mode, machineId: target.machineId, target: json(target), targetHash } })
  })
}
// DD retry retires an unused candidate, preserving its original identity and
// all receipts. It never resets a live or partly installed gateway's trust.
export async function retireUnusedGatewayCandidate(id: string, actorId: number) {
  if (!UUID.test(id) || currentGatewayRecoveryContext()) fail('GATEWAY_TASK_RESTORED_REVIEW')
  return journalTransaction(async tx => {
    await lock(tx); await activeAdmin(tx, actorId)
    const gateway = await tx.managementGateway.findUnique({ where: { id }, include: { tasks: { include: { steps: true } } } })
    if (!gateway || gateway.platformId !== process.env.GATEWAY_PLATFORM_ID || gateway.mode !== 'remote' || gateway.revision !== 0n) {
      fail('GATEWAY_INSTALL_EXISTING_REQUIRES_ATTACH')
    }
    if (gateway.tasks.some(task => !['inspect', 'install'].includes(task.kind) || !['succeeded', 'failed', 'cancelled'].includes(task.status) ||
      task.kind !== 'inspect' && (!['failed', 'cancelled'].includes(task.status) || task.steps.some(step =>
        ['install-components', 'verify-installation'].includes(step.key) && step.status !== 'pending')))) {
      fail('GATEWAY_INSTALL_EXISTING_REQUIRES_ATTACH')
    }
    if (!gateway.retiredAt) await tx.managementGateway.update({ where: { id }, data: { retiredAt: new Date() } })
    return { retired: true }
  })
}
export async function createManagementGatewayTask(input: unknown, actorId: number,
  credentials?: { encrypted: string; expiresAt: Date }, preparation?: GatewayInstallationDesired) {
  // Snapshot input before awaiting; exact fields reject secret-bearing plans.
  const plan = validateGatewayTaskPlan(input), planHash = gatewayTaskHash(plan)
  const desired = preparation ? validateGatewayInstallationDesired(preparation, { ...plan, machineId: plan.target.machineId }) : undefined
  if (desired && (plan.kind !== 'install' || plan.basedOnRevision !== '0' || plan.target.mode === 'existing' ||
      plan.configurationHash !== gatewayTaskHash(desired))) fail('GATEWAY_INSTALLATION_INVALID')
  if (credentials && (plan.target.mode === 'local' || typeof credentials.encrypted !== 'string' ||
    !/^[a-f0-9]{32}:[a-f0-9]{32}:(?:[a-f0-9]{2})+$/.test(credentials.encrypted) || credentials.encrypted.length > 65536 || !(credentials.expiresAt instanceof Date) ||
    !Number.isFinite(credentials.expiresAt.getTime()) || credentials.expiresAt.getTime() <= Date.now() ||
    credentials.expiresAt.getTime() > Date.now() + 24 * 60 * 60000)) fail('GATEWAY_TASK_CREDENTIALS_INVALID')
  const secret = credentials ? { encrypted: credentials.encrypted, expiresAt: new Date(credentials.expiresAt) } : undefined
  return journalTransaction(async tx => {
    await lock(tx); await activeAdmin(tx, actorId)
    const existing = await tx.managementGatewayTask.findUnique({ where: { id: plan.taskId } })
    if (existing) {
      const savedDesired = (existing.installation as unknown as { desired?: unknown } | null)?.desired
      const savedPlan = validateGatewayTaskPlan(existing.plan)
      if (existing.createdById !== actorId || (desired ? !savedDesired || gatewayTaskHash(savedDesired) !== gatewayTaskHash(desired) ||
          ['taskId', 'platformId', 'gatewayId', 'kind', 'basedOnRevision'].some(key => savedPlan[key as keyof GatewayTaskPlan] !== plan[key as keyof GatewayTaskPlan]) ||
          gatewayTaskHash(savedPlan.target) !== gatewayTaskHash(plan.target) :
          existing.planHash !== planHash || gatewayTaskHash(existing.plan) !== planHash)) fail('GATEWAY_TASK_IDEMPOTENCY_CONFLICT')
      return tx.managementGatewayTask.findUniqueOrThrow({ where: { id: existing.id }, select: gatewayTaskPublicSelect })
    }
    const gateway = await tx.managementGateway.findUnique({ where: { id: plan.gatewayId } })
    if (!gateway) fail('GATEWAY_TASK_TARGET_UNKNOWN')
    authenticatedPlan({ id: plan.taskId, gatewayId: plan.gatewayId, kind: plan.kind, plan: json(plan), planHash, basedOnRevision: BigInt(plan.basedOnRevision) }, gateway)
    if (await tx.managementGatewayTask.count({ where: { gatewayId: plan.gatewayId, status: { in: ['queued', 'running', 'needs_review'] } } })) fail('GATEWAY_TASK_TARGET_BUSY')
    if (desired && plan.target.mode === 'remote') {
      // Reserve network intent in the same serialized DB transaction as the
      // installation task. A crashed or failed install may still own routes;
      // only retirement releases that machine's reserved network.
      const reserved = await tx.managementGatewayTask.findMany({ where: { kind: 'install', gatewayId: { not: plan.gatewayId },
        gateway: { platformId: plan.platformId, retiredAt: null } }, select: { installation: true } })
      for (const task of reserved) {
        const other = (task.installation as unknown as { desired?: GatewayInstallationDesired } | null)?.desired
        if (other && remoteGatewayNetworksOverlap(desired.network, other.network)) fail('GATEWAY_REMOTE_NETWORK_RESERVED')
        if (other?.slot === desired.slot) fail('GATEWAY_REMOTE_ROLE_RESERVED')
      }
    }
    return tx.managementGatewayTask.create({ data: {
      id: plan.taskId, gatewayId: plan.gatewayId, createdById: actorId, kind: plan.kind, plan: json(plan), planHash,
      basedOnRevision: BigInt(plan.basedOnRevision), status: plan.kind === 'inspect' ? 'queued' : 'awaiting_confirmation',
      credentialsEncrypted: secret?.encrypted, credentialsExpireAt: secret?.expiresAt,
      preparationState: desired ? 'queued' : null,
      installation: desired ? json({ schemaVersion: 1, desired }) : undefined,
      recoveryContext: desired ? currentGatewayRecoveryContext() : null,
      steps: { create: GATEWAY_TASK_STEPS[plan.kind].map((key, ordinal) => ({ key, ordinal, operationId: randomUUID() })) }
    }, select: gatewayTaskPublicSelect })
  })
}
// The caller must perform current-session password/MFA verification and CSRF
// checking before calling this function. A recent timestamp alone is not auth.
export async function approveManagementGatewayTask(id: string, planHash: string, actorId: number,
  authorization: { verifiedAt: number; confirmation: string; sessionId?: string }, reauthenticate?: (tx: Prisma.TransactionClient) => Promise<string>) {
  if (!UUID.test(id) || !HASH.test(planHash) || !Number.isSafeInteger(authorization.verifiedAt) ||
    authorization.verifiedAt > Date.now() || authorization.verifiedAt < Date.now() - 120000 ||
    authorization.confirmation !== `CONFIRM ${id}`) fail('GATEWAY_TASK_REAUTH_REQUIRED')
  const verifiedAt = authorization.verifiedAt
  return journalTransaction(async tx => {
    await lock(tx); await activeAdmin(tx, actorId)
    if (verifiedAt < Date.now() - 120000) fail('GATEWAY_TASK_REAUTH_REQUIRED')
    const task = await tx.managementGatewayTask.findUnique({ where: { id }, include: { gateway: true } })
    if (task && authorization.sessionId && task.createdById === actorId && task.planHash === planHash && gatewayTaskHash(task.plan) === planHash &&
        task.approvedSessionId === authorization.sessionId && ['queued', 'running', 'succeeded'].includes(task.status)) {
      await currentApprovalCredentials(tx, task)
      currentRecoveryContext(task)
      return tx.managementGatewayTask.findUniqueOrThrow({ where: { id }, select: gatewayTaskPublicSelect })
    }
    if (!task || task.createdById !== actorId || task.planHash !== planHash ||
      !['awaiting_confirmation', 'needs_review'].includes(task.status)) fail('GATEWAY_TASK_NOT_APPROVABLE')
    authenticatedPlan(task, task.gateway)
    currentRecoveryContext(task)
    if (task.preparationState !== null) {
      const prepared = task.installation as unknown as { request?: { expiresAt: number } } | null
      const preview = task.installationPreview as unknown as { installable?: boolean } | null
      if (task.preparationState !== 'ready' || !prepared?.request || prepared.request.expiresAt <= Date.now() || !preview?.installable) fail('GATEWAY_INSTALL_PLAN_NOT_READY')
      if (!reauthenticate || typeof authorization.sessionId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(authorization.sessionId)) fail('GATEWAY_TASK_REAUTH_REQUIRED')
    }
    if (task.kind === 'inspect' && task.status === 'awaiting_confirmation') fail('GATEWAY_TASK_NOT_APPROVABLE')
    if (await tx.managementGatewayTask.count({ where: { gatewayId: task.gatewayId, id: { not: id }, status: { in: ['queued', 'running', 'needs_review'] } } })) fail('GATEWAY_TASK_TARGET_BUSY')
    const now = new Date()
    const approvedCredentialHash = reauthenticate ? await reauthenticate(tx) : undefined
    if (approvedCredentialHash !== undefined && !HASH.test(approvedCredentialHash)) fail('GATEWAY_TASK_REAUTH_REQUIRED')
    await tx.managementGatewayTask.update({ where: { id }, data: { status: 'queued', approvedById: actorId,
      approvedAt: now, approvalExpiresAt: new Date(now.getTime() + APPROVAL_MS), approvedCredentialHash,
      approvedSessionId: authorization.sessionId,
      errorCode: null, leaseToken: null, leaseUntil: null } })
    return tx.managementGatewayTask.findUniqueOrThrow({ where: { id }, select: gatewayTaskPublicSelect })
  })
}
export async function claimManagementGatewayTask(id?: string) {
  if (id !== undefined && !UUID.test(id)) fail('GATEWAY_TASK_PLAN_INVALID')
  return journalTransaction(async tx => {
    await lock(tx)
    // Expired executors are not automatically replayed. They may have changed
    // the target after their last DB checkpoint; require journal reconciliation.
    await tx.$executeRaw`
      UPDATE management_gateway_tasks SET status = 'needs_review', error_code = 'GATEWAY_TASK_EXECUTOR_INTERRUPTED',
        lease_token = NULL, lease_until = NULL, updated_at = (NOW() AT TIME ZONE 'UTC')
      WHERE status = 'running' AND lease_until <= (NOW() AT TIME ZONE 'UTC')`
    const task = await tx.managementGatewayTask.findFirst({ where: { status: 'queued', ...(id ? { id } : {}) }, orderBy: { createdAt: 'asc' }, include: { gateway: true } })
    if (!task) return null
    let errorCode: string | undefined
    try { await activeAdmin(tx, task.createdById); await currentApprovalCredentials(tx, task); currentRecoveryContext(task); authenticatedPlan(task, task.gateway) }
    catch (error) { if (error instanceof GatewayTaskError) errorCode = error.code; else throw error }
    if (task.kind !== 'inspect' && (!task.approvalExpiresAt || task.approvalExpiresAt <= new Date())) errorCode = 'GATEWAY_TASK_APPROVAL_EXPIRED'
    if (task.credentialsEncrypted && (!task.credentialsExpireAt || task.credentialsExpireAt <= new Date())) errorCode = 'GATEWAY_TASK_CREDENTIALS_EXPIRED'
    if (errorCode) {
      const uncertain = await tx.managementGatewayStep.count({ where: { taskId: task.id, status: { not: 'pending' } } })
      await tx.managementGatewayTask.update({ where: { id: task.id }, data: { status: uncertain ? 'needs_review' : 'failed',
        errorCode, credentialsEncrypted: null, credentialsExpireAt: null, completedAt: uncertain ? null : new Date() } })
      return null
    }
    return tx.managementGatewayTask.update({ where: { id: task.id }, data: { status: 'running', leaseToken: randomUUID(),
      leaseUntil: new Date(Date.now() + LEASE_MS), attempt: { increment: 1 }, startedAt: task.startedAt || new Date(), errorCode: null },
      include: { gateway: true, steps: { orderBy: { ordinal: 'asc' } } } })
  })
}
async function liveTask(tx: Prisma.TransactionClient, id: string, token: string) {
  const task = await tx.managementGatewayTask.findUnique({ where: { id }, include: { gateway: true, steps: { orderBy: { ordinal: 'asc' } } } })
  if (!task || task.status !== 'running' || task.leaseToken !== token || !task.leaseUntil || task.leaseUntil <= new Date()) fail('GATEWAY_TASK_LEASE_LOST')
  await activeAdmin(tx, task.createdById)
  await currentApprovalCredentials(tx, task)
  currentRecoveryContext(task)
  if (task.kind !== 'inspect' && (!task.approvalExpiresAt || task.approvalExpiresAt <= new Date())) fail('GATEWAY_TASK_APPROVAL_EXPIRED')
  if (task.credentialsEncrypted && (!task.credentialsExpireAt || task.credentialsExpireAt <= new Date())) fail('GATEWAY_TASK_CREDENTIALS_EXPIRED')
  const plan = authenticatedPlan(task, task.gateway), expected = GATEWAY_TASK_STEPS[plan.kind]
  if (task.steps.length !== expected.length || task.steps.some((step, i) => step.key !== expected[i] || step.ordinal !== i)) fail('GATEWAY_TASK_JOURNAL_INVALID')
  let unfinished = false
  for (const step of task.steps) {
    if (step.status !== 'succeeded') { unfinished = true; continue }
    if (unfinished || step.receiptHash !== gatewayTaskHash(validateGatewayStepReceipt(step.receipt, plan, step.key, step.operationId))) fail('GATEWAY_TASK_JOURNAL_INVALID')
  }
  return { task, plan }
}
export async function heartbeatManagementGatewayTask(id: string, token: string) {
  return journalTransaction(async tx => {
    await lock(tx); await liveTask(tx, id, token)
    await tx.managementGatewayTask.update({ where: { id }, data: { leaseUntil: new Date(Date.now() + LEASE_MS) } })
  })
}
export async function beginManagementGatewayStep(id: string, token: string, key: string) {
  return journalTransaction(async tx => {
    await lock(tx)
    const { task, plan } = await liveTask(tx, id, token)
    const expected = GATEWAY_TASK_STEPS[plan.kind]
    if (task.steps.length !== expected.length || task.steps.some((step, i) => step.key !== expected[i] || step.ordinal !== i)) fail('GATEWAY_TASK_JOURNAL_INVALID')
    const step = task.steps.find(item => item.key === key)
    if (!step || task.steps.some(item => item.ordinal < step.ordinal && item.status !== 'succeeded')) fail('GATEWAY_TASK_STEP_ORDER_INVALID')
    if (step.status === 'succeeded') {
      const receipt = validateGatewayStepReceipt(step.receipt, plan, key, step.operationId)
      if (step.receiptHash !== gatewayTaskHash(receipt)) fail('GATEWAY_TASK_JOURNAL_INVALID')
      return { operationId: step.operationId, reconcile: false, completed: true }
    }
    const reconcile = step.status === 'started'
    if (!reconcile) await tx.managementGatewayStep.update({ where: { taskId_key: { taskId: id, key } }, data: { status: 'started', startedAt: new Date() } })
    return { operationId: step.operationId, reconcile, completed: false }
  })
}
export async function completeManagementGatewayStep(id: string, token: string, key: string, input: unknown) {
  // No raw command output is ever accepted into this journal.
  const snapshot: unknown = structuredClone(input)
  return journalTransaction(async tx => {
    await lock(tx)
    const { task, plan } = await liveTask(tx, id, token)
    const step = task.steps.find(item => item.key === key)
    if (!step || !['started', 'succeeded'].includes(step.status) || task.steps.some(item => item.ordinal < step.ordinal && item.status !== 'succeeded')) fail('GATEWAY_TASK_STEP_ORDER_INVALID')
    const receipt = validateGatewayStepReceipt(snapshot, plan, key, step.operationId), receiptHash = gatewayTaskHash(receipt)
    if (step.status === 'succeeded') {
      if (step.receiptHash !== receiptHash || gatewayTaskHash(step.receipt) !== receiptHash) fail('GATEWAY_TASK_RECEIPT_CONFLICT')
      return { duplicate: true }
    }
    await tx.managementGatewayStep.update({ where: { taskId_key: { taskId: id, key } }, data: { status: 'succeeded', receipt: json(receipt), receiptHash, completedAt: new Date() } })
    return { duplicate: false }
  })
}
export async function finishManagementGatewayTask(id: string, token: string, inspection?: { request: unknown; report: unknown },
  installation?: { receipt: unknown; bootstrapEncrypted: string; bootstrapExpiresAt: Date }) {
  const snapshot = inspection ? structuredClone(inspection) : undefined
  return journalTransaction(async tx => {
    await lock(tx)
    const { task, plan } = await liveTask(tx, id, token), expected = GATEWAY_TASK_STEPS[plan.kind]
    if (task.steps.length !== expected.length || task.steps.some((step, i) => step.ordinal !== i || step.key !== expected[i] || step.status !== 'succeeded')) fail('GATEWAY_TASK_INCOMPLETE')
    for (const step of task.steps) if (step.receiptHash !== gatewayTaskHash(validateGatewayStepReceipt(step.receipt, plan, step.key, step.operationId))) fail('GATEWAY_TASK_JOURNAL_INVALID')
    let evidence: Prisma.InputJsonObject | undefined
    let installed: Prisma.InputJsonObject | undefined
    if (task.preparationState !== null) {
      if (task.preparationState !== 'ready' || plan.kind !== 'install' || !installation) fail('GATEWAY_INSTALLATION_INVALID')
      const saved = task.installation as unknown as { request: import('../lib/gateway-installation.js').GatewayInstallationRequest }
      installed = json(validateGatewayInstallationReceipt(installation.receipt, saved.request))
      if (!/^[a-f0-9]{32}:[a-f0-9]{32}:(?:[a-f0-9]{2})+$/.test(installation.bootstrapEncrypted) || installation.bootstrapEncrypted.length > 16384 ||
          !(installation.bootstrapExpiresAt instanceof Date) || installation.bootstrapExpiresAt.getTime() <= Date.now() ||
          installation.bootstrapExpiresAt.getTime() > Date.now() + 24 * 60 * 60000) fail('GATEWAY_INSTALLATION_INVALID')
    } else if (installation) fail('GATEWAY_INSTALLATION_INVALID')
    if (snapshot) {
      if (plan.kind !== 'inspect') fail('GATEWAY_TASK_RECEIPT_INVALID')
      const request = validateGatewayPreflightRequest(snapshot.request), report = bindGatewayPreflightReport(JSON.stringify(snapshot.report), request)
      const { slot, network, address, listenPort, consolePort } = request
      if (request.platformId !== plan.platformId || request.gatewayId !== plan.gatewayId || report.machineId !== plan.target.machineId ||
        report.observedStateHash !== plan.observedStateHash || gatewayTaskHash({ slot, network, address, listenPort, consolePort }) !== plan.configurationHash ||
        task.steps.some(step => (step.receipt as unknown as { evidenceHash: string }).evidenceHash !== report.observedStateHash)) fail('GATEWAY_TASK_RECEIPT_INVALID')
      evidence = json({ request, report })
    }
    if (plan.kind !== 'inspect') await tx.managementGateway.update({ where: { id: task.gatewayId }, data: { revision: { increment: 1 } } })
    await tx.managementGatewayTask.update({ where: { id }, data: { status: 'succeeded', completedAt: new Date(),
      inspection: evidence, leaseToken: null, leaseUntil: null, credentialsEncrypted: null, credentialsExpireAt: null } })
    if (installation) await tx.managementGatewayTask.update({ where: { id }, data: { installationReceipt: installed,
      bootstrapEncrypted: installation.bootstrapEncrypted, bootstrapExpiresAt: installation.bootstrapExpiresAt } })
    return tx.managementGatewayTask.findUniqueOrThrow({ where: { id }, select: gatewayTaskPublicSelect })
  })
}

export async function claimGatewayInstallationPreparation(id: string) {
  if (!UUID.test(id)) fail('GATEWAY_INSTALLATION_INVALID')
  return journalTransaction(async tx => {
    await lock(tx)
    const task = await tx.managementGatewayTask.findUnique({ where: { id }, include: { gateway: true } })
    if (!task || task.kind !== 'install' || task.status !== 'awaiting_confirmation' ||
        !['queued', 'running'].includes(task.preparationState || '')) return null
    if (task.preparationState === 'running' && task.leaseUntil && task.leaseUntil > new Date()) return null
    let plan: GatewayTaskPlan
    try { await activeAdmin(tx, task.createdById); currentRecoveryContext(task); plan = authenticatedPlan(task, task.gateway) }
    catch (error) {
      if (!(error instanceof GatewayTaskError)) throw error
      await tx.managementGatewayTask.update({ where: { id }, data: { preparationState: 'failed', status: 'failed', errorCode: error.code,
        leaseToken: null, leaseUntil: null, credentialsEncrypted: null, credentialsExpireAt: null, completedAt: new Date() } })
      return null
    }
    const saved = task.installation as unknown as { schemaVersion: number; desired: unknown } | null
    if (!saved || Object.keys(saved).length !== 2 || saved.schemaVersion !== 1) fail('GATEWAY_INSTALLATION_INVALID')
    const desired = validateGatewayInstallationDesired(saved.desired, { ...plan, machineId: plan.target.machineId })
    if (plan.configurationHash !== gatewayTaskHash(desired)) fail('GATEWAY_INSTALLATION_INVALID')
    if (plan.target.mode !== 'local' && (!task.credentialsEncrypted || !task.credentialsExpireAt || task.credentialsExpireAt <= new Date())) {
      await tx.managementGatewayTask.update({ where: { id }, data: { preparationState: 'failed', status: 'failed', errorCode: 'GATEWAY_TASK_CREDENTIALS_EXPIRED',
        leaseToken: null, leaseUntil: null, credentialsEncrypted: null, credentialsExpireAt: null, completedAt: new Date() } })
      return null
    }
    return tx.managementGatewayTask.update({ where: { id }, data: { preparationState: 'running', leaseToken: randomUUID(),
      leaseUntil: new Date(Date.now() + LEASE_MS), errorCode: null }, include: { gateway: true } })
  })
}

async function livePreparation(tx: Prisma.TransactionClient, id: string, token: string) {
  const task = await tx.managementGatewayTask.findUnique({ where: { id }, include: { gateway: true } })
  if (!task || task.status !== 'awaiting_confirmation' || task.preparationState !== 'running' || task.leaseToken !== token ||
      !task.leaseUntil || task.leaseUntil <= new Date()) fail('GATEWAY_TASK_LEASE_LOST')
  await activeAdmin(tx, task.createdById)
  authenticatedPlan(task, task.gateway)
  currentRecoveryContext(task)
  if (task.credentialsEncrypted && (!task.credentialsExpireAt || task.credentialsExpireAt <= new Date())) fail('GATEWAY_TASK_CREDENTIALS_EXPIRED')
  return task
}

export async function heartbeatGatewayInstallationPreparation(id: string, token: string) {
  return journalTransaction(async tx => {
    await lock(tx); await livePreparation(tx, id, token)
    await tx.managementGatewayTask.update({ where: { id }, data: { leaseUntil: new Date(Date.now() + LEASE_MS) } })
  })
}

export async function completeGatewayInstallationPreparation(id: string, token: string, input: unknown, previewInput: unknown, platformSigningKey: string) {
  const request = validateGatewayInstallationRequest(input, platformSigningKey)
  const preview = validateGatewayInstallationPreview(previewInput, request)
  return journalTransaction(async tx => {
    await lock(tx)
    const task = await livePreparation(tx, id, token), previous = validateGatewayTaskPlan(task.plan)
    const saved = task.installation as unknown as { desired: GatewayInstallationDesired }
    const { signedTransport: _signed, ...desired } = request.configuration
    if (request.task.taskId !== id || request.task.gatewayId !== task.gatewayId || request.task.platformId !== task.gateway.platformId ||
        request.task.basedOnRevision !== previous.basedOnRevision || gatewayTaskHash(request.task.target) !== gatewayTaskHash(previous.target) ||
        gatewayTaskHash(desired) !== gatewayTaskHash(saved.desired) || request.expiresAt <= Date.now()) fail('GATEWAY_INSTALLATION_INVALID')
    await tx.managementGatewayTask.update({ where: { id }, data: { plan: json(request.task), planHash: gatewayTaskHash(request.task),
      installation: json({ schemaVersion: 1, desired, request }), installationPreview: json(preview), preparationState: 'ready', leaseToken: null, leaseUntil: null } })
    return tx.managementGatewayTask.findUniqueOrThrow({ where: { id }, select: gatewayTaskPublicSelect })
  })
}

export async function failGatewayInstallationPreparation(id: string, token: string, code = 'GATEWAY_INSTALL_PREPARATION_FAILED') {
  if (!/^(?:GATEWAY|SSH)_[A-Z_]{1,80}$/.test(code)) code = 'GATEWAY_INSTALL_PREPARATION_FAILED'
  return journalTransaction(async tx => {
    await lock(tx)
    const changed = await tx.managementGatewayTask.updateMany({ where: { id, preparationState: 'running', leaseToken: token, status: 'awaiting_confirmation' },
      data: { preparationState: 'failed', status: 'failed', errorCode: code, leaseToken: null, leaseUntil: null,
        credentialsEncrypted: null, credentialsExpireAt: null, completedAt: new Date() } })
    if (!changed.count) fail('GATEWAY_TASK_LEASE_LOST')
  })
}

export async function takeGatewayBootstrapMaterial(id: string, actorId: number, sessionId: string,
  reauthenticate?: (tx: Prisma.TransactionClient) => Promise<string>) {
  if (!UUID.test(id) || !/^[A-Za-z0-9_-]{1,128}$/.test(sessionId)) fail('GATEWAY_TASK_REAUTH_REQUIRED')
  return journalTransaction(async tx => {
    await lock(tx); await activeAdmin(tx, actorId)
    const task = await tx.managementGatewayTask.findUnique({ where: { id } })
    if (!task || task.createdById !== actorId || task.status !== 'succeeded' || task.kind !== 'install' ||
        !task.bootstrapEncrypted || !task.bootstrapExpiresAt || task.bootstrapExpiresAt <= new Date()) fail('GATEWAY_BOOTSTRAP_UNAVAILABLE')
    currentRecoveryContext(task)
    const user = await tx.user.findUniqueOrThrow({ where: { id: actorId }, select: gatewayCredentialSelect })
    const recent = task.approvedSessionId === sessionId && task.approvedAt && task.approvedAt.getTime() > Date.now() - APPROVAL_MS &&
      task.approvedCredentialHash === gatewayCredentialHash(user)
    if (!recent) {
      if (!reauthenticate || await reauthenticate(tx) !== gatewayCredentialHash(user)) fail('GATEWAY_TASK_REAUTH_REQUIRED')
    }
    const material = validateGatewayBootstrapMaterial(JSON.parse(decryptGatewayTaskSecret(task.bootstrapEncrypted)))
    await tx.managementGatewayTask.update({ where: { id }, data: { bootstrapEncrypted: null, bootstrapExpiresAt: null } })
    return material
  })
}

export async function expireGatewayInstallationTasks() {
  return journalTransaction(async tx => {
    await lock(tx)
    const now = new Date()
    const context = currentGatewayRecoveryContext()
    const stale = await tx.managementGatewayTask.findMany({ where: { kind: 'install', preparationState: { not: null },
      status: { in: ['awaiting_confirmation', 'queued', 'running'] } }, take: 100, include: { steps: { select: { status: true } } } })
    for (const task of stale) if (task.recoveryContext !== context) {
      const uncertain = task.steps.some(step => step.status !== 'pending')
      await tx.managementGatewayTask.update({ where: { id: task.id }, data: { status: uncertain ? 'needs_review' : 'failed',
        errorCode: 'GATEWAY_RECOVERY_CONTEXT_CHANGED', preparationState: task.preparationState === 'running' ? 'failed' : task.preparationState,
        leaseToken: null, leaseUntil: null, credentialsEncrypted: null, credentialsExpireAt: null, bootstrapEncrypted: null, bootstrapExpiresAt: null,
        approvedCredentialHash: null, approvedSessionId: null, completedAt: uncertain ? null : now } })
    }
    await tx.managementGatewayTask.updateMany({ where: { kind: 'install', status: 'running', leaseUntil: { lte: now } },
      data: { status: 'needs_review', errorCode: 'GATEWAY_TASK_EXECUTOR_INTERRUPTED', leaseToken: null, leaseUntil: null } })
    await tx.managementGatewayTask.updateMany({ where: { kind: 'install', status: 'awaiting_confirmation', preparationState: 'running', leaseUntil: { lte: now } },
      data: { preparationState: 'failed', status: 'failed', errorCode: 'GATEWAY_INSTALL_PREPARATION_INTERRUPTED', leaseToken: null, leaseUntil: null,
        credentialsEncrypted: null, credentialsExpireAt: null, completedAt: now } })
    await tx.managementGatewayTask.updateMany({ where: { kind: 'install', bootstrapExpiresAt: { lte: now } },
      data: { bootstrapEncrypted: null, bootstrapExpiresAt: null } })
    await tx.managementGatewayTask.updateMany({ where: { kind: 'install', credentialsExpireAt: { lte: now } },
      data: { credentialsEncrypted: null, credentialsExpireAt: null } })
    const pending = await tx.managementGatewayTask.findMany({ where: { kind: 'install', status: 'awaiting_confirmation', preparationState: 'ready' }, take: 100,
      select: { id: true, installation: true } })
    for (const task of pending) {
      const expiresAt = (task.installation as unknown as { request?: { expiresAt?: number } } | null)?.request?.expiresAt
      if (!Number.isSafeInteger(expiresAt) || expiresAt! <= now.getTime()) await tx.managementGatewayTask.update({ where: { id: task.id },
        data: { status: 'failed', errorCode: 'GATEWAY_INSTALL_PLAN_EXPIRED', credentialsEncrypted: null, credentialsExpireAt: null, completedAt: now } })
    }
    await tx.managementGatewayTask.updateMany({ where: { kind: 'install', status: 'awaiting_confirmation', preparationState: 'queued', createdAt: { lte: new Date(Date.now() - 90000) } },
      data: { status: 'failed', preparationState: 'failed', errorCode: 'GATEWAY_WORKER_START_FAILED', credentialsEncrypted: null, credentialsExpireAt: null, completedAt: now } })
    const stalled = await tx.managementGatewayTask.findMany({ where: { kind: 'install', status: 'queued', preparationState: 'ready', approvedAt: { lte: new Date(Date.now() - 90000) } },
      take: 100, include: { steps: { select: { status: true } } } })
    for (const task of stalled) {
      const uncertain = task.steps.some(step => step.status !== 'pending')
      await tx.managementGatewayTask.update({ where: { id: task.id }, data: { status: uncertain ? 'needs_review' : 'failed',
        errorCode: 'GATEWAY_WORKER_START_FAILED', credentialsEncrypted: null, credentialsExpireAt: null, completedAt: uncertain ? null : now } })
    }
  })
}
export async function interruptManagementGatewayTask(id: string, token: string, code = 'GATEWAY_TASK_EXECUTOR_INTERRUPTED') {
  if (!/^(?:GATEWAY|SSH)_[A-Z_]{1,80}$/.test(code)) code = 'GATEWAY_TASK_EXECUTOR_INTERRUPTED'
  return journalTransaction(async tx => {
    await lock(tx)
    const changed = await tx.managementGatewayTask.updateMany({ where: { id, status: 'running', leaseToken: token },
      data: { status: 'needs_review', errorCode: code, leaseToken: null, leaseUntil: null } })
    if (!changed.count) fail('GATEWAY_TASK_LEASE_LOST')
  })
}
export async function failGatewayInstallationBeforeExecution(id: string, token: string, code: string) {
  if (!/^(?:GATEWAY|SSH)_[A-Z_]{1,80}$/.test(code)) fail('GATEWAY_INSTALLATION_INVALID')
  return journalTransaction(async tx => {
    await lock(tx)
    const task = await tx.managementGatewayTask.findUnique({ where: { id }, include: { steps: true } })
    if (!task || task.kind !== 'install' || task.status !== 'running' || task.leaseToken !== token ||
        task.steps.some(step => ['install-components', 'verify-installation'].includes(step.key) && step.status !== 'pending')) fail('GATEWAY_TASK_LEASE_LOST')
    await tx.managementGatewayTask.update({ where: { id }, data: { status: 'failed', errorCode: code, completedAt: new Date(),
      leaseToken: null, leaseUntil: null, credentialsEncrypted: null, credentialsExpireAt: null } })
  })
}
export async function cancelManagementGatewayTask(id: string, actorId: number) {
  return journalTransaction(async tx => {
    await lock(tx); await activeAdmin(tx, actorId)
    const task = await tx.managementGatewayTask.findUnique({ where: { id }, include: { steps: true } })
    if (!task || task.createdById !== actorId || !['awaiting_confirmation', 'queued', 'failed'].includes(task.status) ||
      task.steps.some(step => step.status !== 'pending')) fail('GATEWAY_TASK_NOT_CANCELLABLE')
    await tx.managementGatewayTask.update({ where: { id }, data: { status: 'cancelled', completedAt: new Date(),
      leaseToken: null, leaseUntil: null, credentialsEncrypted: null, credentialsExpireAt: null } })
    return tx.managementGatewayTask.findUniqueOrThrow({ where: { id }, select: gatewayTaskPublicSelect })
  })
}
