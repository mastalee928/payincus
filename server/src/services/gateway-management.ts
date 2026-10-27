import { Resolver } from 'node:dns/promises'
import { isIPv4 } from 'node:net'
import { prisma } from '../db/prisma.js'
import { parseRemoteGatewayPreparation } from '../lib/remote-gateway-setup.js'
import { GatewayTaskError, gatewayTaskHash, type GatewayTaskPlan } from '../lib/gateway-task-plan.js'
import { normalizeOnboardingAddress, isOnboardingPublicIPv4, validateCredentials, type OnboardingCredentials } from '../lib/host-onboarding.js'
import { connectOnboardingSsh } from './onboarding-ssh.js'
import { inspectLocalManagementGateway, inspectRemoteManagementGateway, validateGatewayPreflightRequest, type GatewayPreflightReport } from './gateway-preflight.js'
import { registerManagementGateway, createManagementGatewayTask, claimManagementGatewayTask, beginManagementGatewayStep,
  completeManagementGatewayStep, finishManagementGatewayTask, interruptManagementGatewayTask, gatewayTaskPublicSelect } from './gateway-task-journal.js'

export interface ManagementGatewayInspectInput {
  requestId: string
  gatewayId: string
  name: string
  mode: 'local' | 'remote' | 'existing'
  target: null | { address: string; port: number; fingerprint?: string }
  configuration: { slot: 'a' | 'b'; network: string; address: string; listenPort: number; consolePort: number }
  credentials?: OnboardingCredentials
}
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/
let inspecting = false
export function managementGatewayPlatformId(): string {
  const configured = process.env.GATEWAY_PLATFORM_ID || ''
  if (!UUID.test(configured)) throw new GatewayTaskError('GATEWAY_PLATFORM_NOT_CONFIGURED')
  return configured
}
async function targetAddress(value: string): Promise<string> {
  const normalized = normalizeOnboardingAddress(value)
  if (isIPv4(normalized)) return normalized
  const resolver = new Resolver({ timeout: 4000, tries: 1 })
  try {
    const records = [...new Set(await resolver.resolve4(normalized))]
    if (records.length !== 1 || !isOnboardingPublicIPv4(records[0])) throw new GatewayTaskError('GATEWAY_TARGET_ADDRESS_INVALID')
    return records[0]
  } catch { throw new GatewayTaskError('GATEWAY_TARGET_ADDRESS_INVALID') }
  finally { resolver.cancel() }
}
function publicTask<T>(value: T): unknown {
  // BigInt database revisions have explicit decimal transport encoding.
  return JSON.parse(JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item))
}
export async function listManagementGateways() {
  const platformId = managementGatewayPlatformId()
  // Filter failures before limiting history. Successes must not crowd out an
  // unresolved failure, and old attempt rows must not all enter process memory.
  const prefix = `management_gateway_remote_attempt_${platformId}_`
  const attempts = await prisma.$queryRaw<Array<{ key: string; value: string }>>`
    SELECT key, value FROM system_configs
    WHERE left(key, length(${prefix})) = ${prefix}
      AND value ~ '"state"[[:space:]]*:[[:space:]]*"failed"'
    ORDER BY updated_at DESC, key DESC LIMIT 100`
  const preparations = attempts.flatMap(row => {
    const value = parseRemoteGatewayPreparation(row.value)
    return value?.state === 'failed' && row.key === `management_gateway_remote_attempt_${platformId}_${value.requestId}` ? [value] : []
  }).slice(0, 20).map(value => ({ ...value, retryable: true }))
  const retired = await prisma.managementGateway.findMany({ where: { platformId, retiredAt: { not: null } }, select: { id: true } })
  const retiredIds = new Set(retired.map(gateway => gateway.id))
  const usedCandidates = await prisma.managementGatewayTask.findMany({ where: {
    gatewayId: { in: preparations.map(value => value.gatewayId) }, gateway: { platformId }, kind: 'install',
    OR: [{ status: { notIn: ['failed', 'cancelled'] } },
      { steps: { some: { key: { in: ['install-components', 'verify-installation'] }, status: { not: 'pending' } } } }]
  }, select: { gatewayId: true } })
  const usedIds = new Set(usedCandidates.map(task => task.gatewayId))
  for (const preparation of preparations) preparation.retryable = !retiredIds.has(preparation.gatewayId) && !usedIds.has(preparation.gatewayId)
  const gateways = await prisma.managementGateway.findMany({ where: { platformId, retiredAt: null }, orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, mode: true, target: true, revision: true, retiredAt: true,
      tasks: { take: 5, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: gatewayTaskPublicSelect } } })
  // Automatic conflict checks may produce many inspections. Keep the latest
  // task of each lifecycle kind visible even after those checks fill the list.
  const lifecycle = await Promise.all(['inspect', 'install', 'attach', 'update'].map(kind =>
    prisma.managementGateway.findMany({ where: { id: { in: gateways.map(gateway => gateway.id) }, platformId },
      select: { id: true, tasks: { where: { kind }, take: 1,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: gatewayTaskPublicSelect } } })))
  const histories = new Map(gateways.map(gateway => [gateway.id, new Map(gateway.tasks.map(task => [task.id, task]))]))
  for (const group of lifecycle) for (const gateway of group) for (const task of gateway.tasks) histories.get(gateway.id)!.set(task.id, task)
  return { configured: true, platformId, preparations, gateways: publicTask(gateways.map(gateway => ({ ...gateway,
    tasks: [...histories.get(gateway.id)!.values()].sort((left, right) =>
      right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id)) }))) }
}
export async function getManagementGatewayTask(id: string) {
  if (!UUID.test(id)) throw new GatewayTaskError('GATEWAY_TASK_NOT_FOUND')
  const task = await prisma.managementGatewayTask.findFirst({ where: { id, gateway: { platformId: managementGatewayPlatformId() } }, select: gatewayTaskPublicSelect })
  if (!task) throw new GatewayTaskError('GATEWAY_TASK_NOT_FOUND')
  return publicTask(task)
}
export async function inspectManagementGateway(input: ManagementGatewayInspectInput, actorId: number) {
  if (inspecting) throw new GatewayTaskError('GATEWAY_TASK_JOURNAL_BUSY')
  inspecting = true
  let client: Awaited<ReturnType<typeof connectOnboardingSsh>> | undefined
  let active: { id: string; token: string } | undefined
  try {
    input = structuredClone(input)
    const platformId = managementGatewayPlatformId()
    if (!UUID.test(input.requestId) || !UUID.test(input.gatewayId) || !['local', 'remote', 'existing'].includes(input.mode) ||
      typeof input.name !== 'string' || !input.name.trim() || input.name.length > 80) throw new GatewayTaskError('GATEWAY_PREFLIGHT_INVALID')
    if (input.mode === 'local' && (input.target !== null || input.credentials !== undefined)) throw new GatewayTaskError('GATEWAY_LOCAL_SSH_FORBIDDEN')
    const existing = await prisma.managementGateway.findUnique({ where: { id: input.gatewayId } })
    if (existing && (existing.platformId !== platformId || existing.retiredAt)) throw new GatewayTaskError('GATEWAY_TASK_TARGET_CONFLICT')
    const request = validateGatewayPreflightRequest({ schemaVersion: 1, platformId, gatewayId: input.gatewayId,
      expectedMachineId: existing?.machineId || null, ...input.configuration })
    const duplicate = await prisma.managementGatewayTask.findUnique({ where: { id: input.requestId } })
    if (duplicate) {
      if (duplicate.createdById !== actorId || duplicate.gatewayId !== input.gatewayId || duplicate.kind !== 'inspect') throw new GatewayTaskError('GATEWAY_TASK_IDEMPOTENCY_CONFLICT')
      const oldPlan = duplicate.plan as unknown as GatewayTaskPlan
      if (duplicate.planHash !== gatewayTaskHash(oldPlan) || oldPlan.platformId !== platformId ||
        oldPlan.configurationHash !== gatewayTaskHash(input.configuration) || oldPlan.target.mode !== input.mode ||
        (input.mode !== 'local' && ((input.target?.fingerprint && oldPlan.target.ssh?.fingerprint !== input.target.fingerprint) || oldPlan.target.ssh?.port !== input.target?.port ||
          oldPlan.target.ssh?.address !== await targetAddress(input.target?.address || '')))) throw new GatewayTaskError('GATEWAY_TASK_IDEMPOTENCY_CONFLICT')
      return { task: await getManagementGatewayTask(input.requestId), report: (duplicate.inspection as unknown as { report?: GatewayPreflightReport })?.report || null, canWrite: false, duplicate: true }
    }
    let report: GatewayPreflightReport, target: GatewayTaskPlan['target']
    if (input.mode === 'local') {
      if (input.target !== null || input.credentials !== undefined) throw new GatewayTaskError('GATEWAY_LOCAL_SSH_FORBIDDEN')
      report = await inspectLocalManagementGateway(request)
      target = { mode: 'local', machineId: report.machineId, ssh: null }
    } else {
      if (!input.target || !Number.isInteger(input.target.port) || input.target.port < 1 || input.target.port > 65535 ||
        (input.target.fingerprint !== undefined && !/^SHA256:[A-Za-z0-9+/]{43}$/.test(input.target.fingerprint))) throw new GatewayTaskError('GATEWAY_SSH_FINGERPRINT_REQUIRED')
      validateCredentials(input.credentials)
      const address = await targetAddress(input.target.address)
      const registered = existing?.target as unknown as GatewayTaskPlan['target'] | undefined
      if (registered && (registered.mode !== input.mode || registered.ssh?.address !== address || registered.ssh.port !== input.target.port)) throw new GatewayTaskError('GATEWAY_TASK_TARGET_CONFLICT')
      const expectedFingerprint = registered?.ssh?.fingerprint || input.target.fingerprint
      let observedFingerprint = ''
      client = await connectOnboardingSsh({ host: address, port: input.target.port, ...input.credentials }, async fingerprint => {
        observedFingerprint = fingerprint
        return expectedFingerprint ? fingerprint === expectedFingerprint : true
      })
      if (!observedFingerprint) throw new GatewayTaskError('GATEWAY_SSH_FINGERPRINT_REQUIRED')
      report = await inspectRemoteManagementGateway(client, request)
      target = { mode: input.mode, machineId: report.machineId, ssh: { address, port: input.target.port, username: 'root', fingerprint: observedFingerprint } }
    }
    if (report.blockers.includes('GATEWAY_TARGET_IDENTITY_CHANGED')) throw new GatewayTaskError('GATEWAY_TASK_TARGET_CONFLICT')
    const gateway = await registerManagementGateway({ id: input.gatewayId, platformId, name: input.name, target }, actorId)
    const plan: GatewayTaskPlan = { schemaVersion: 1, taskId: input.requestId, gatewayId: input.gatewayId, platformId, kind: 'inspect',
      basedOnRevision: gateway.revision.toString(), target, configurationHash: gatewayTaskHash(input.configuration), observedStateHash: report.observedStateHash,
      componentHash: gatewayTaskHash({ component: 'gateway-preflight', schemaVersion: 1 }) }
    await createManagementGatewayTask(plan, actorId)
    const task = await claimManagementGatewayTask(plan.taskId)
    if (!task?.leaseToken) throw new GatewayTaskError('GATEWAY_TASK_JOURNAL_BUSY')
    active = { id: task.id, token: task.leaseToken }
    for (const key of ['verify-target', 'inspect-environment']) {
      const step = await beginManagementGatewayStep(task.id, task.leaseToken, key)
      await completeManagementGatewayStep(task.id, task.leaseToken, key, { schemaVersion: 1, taskId: task.id, operationId: step.operationId,
        step: key, planHash: gatewayTaskHash(plan), targetHash: gatewayTaskHash(target), evidenceHash: report.observedStateHash,
        configurationHash: null, issuedAt: report.inspectedAt, outcome: 'verified' })
    }
    const result = await finishManagementGatewayTask(task.id, task.leaseToken, { request, report })
    active = undefined
    return { task: publicTask(result), report, canWrite: false, duplicate: false }
  } catch (error) {
    if (active) await interruptManagementGatewayTask(active.id, active.token).catch(() => {})
    throw error
  } finally { client?.end(); inspecting = false }
}
