import { prisma } from '../db/prisma.js'
import { GatewayTaskError, gatewayTaskHash, validateGatewayTaskTarget } from '../lib/gateway-task-plan.js'
import { OnboardingError, validateCredentials, normalizeOnboardingAddress } from '../lib/host-onboarding.js'
import { planRemoteGatewayConfiguration, remoteGatewayInspectionId, parseRemoteGatewayPreparation, type RemoteGatewaySetupInput, type RemoteGatewayPreparation } from '../lib/remote-gateway-setup.js'
import { inspectManagementGateway, getManagementGatewayTask, managementGatewayPlatformId } from './gateway-management.js'
import { requestGatewayInstallation } from './gateway-installation-management.js'
import type { GatewayInstallationDesired } from '../lib/gateway-installation.js'
import type { GatewayPreflightRequest } from './gateway-preflight.js'
import { currentGatewayRecoveryContext } from '../lib/gateway-recovery-context.js'
import { validateStableGatewayEndpoint } from '../lib/onboarding-gateway-endpoint.js'
import { resolveGatewayEndpointAddress, resolveRemoteGatewayDomain } from './onboarding-gateway-endpoint.js'

let preparing = false
export async function prepareRemoteGateway(input: RemoteGatewaySetupInput, actorId: number,
  operations: { inspect: typeof inspectManagementGateway; install: typeof requestGatewayInstallation; resolve?: typeof resolveGatewayEndpointAddress; now?: () => number } =
    { inspect: inspectManagementGateway, install: requestGatewayInstallation }) {
  if (preparing) throw new GatewayTaskError('GATEWAY_TASK_JOURNAL_BUSY')
  preparing = true
  let recordKey: string | undefined, step: RemoteGatewayPreparation['step'] = 'validate-domain'
  let recordAddress = '', recordHostname = ''
  const saveAttempt = async (state: 'running' | 'failed' | 'succeeded', code: string | null = null) => {
    if (!recordKey) return
    const value = JSON.stringify({ requestId: input.requestId, gatewayId: input.gatewayId, actorId, name: input.name.trim(),
      purpose: input.purpose, address: recordAddress, hostname: recordHostname, state, step, code, updatedAt: new Date().toISOString() })
    await prisma.systemConfig.upsert({ where: { key: recordKey }, create: { key: recordKey, type: 'json', value }, update: { value } })
  }
  try {
    input = structuredClone(input)
    if (currentGatewayRecoveryContext()) throw new GatewayTaskError('GATEWAY_TASK_RESTORED_REVIEW')
    const platformId = managementGatewayPlatformId()
    if (![input.requestId, input.gatewayId].every(value => typeof value === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value)) ||
      typeof input.name !== 'string' || !input.name.trim() || input.name.length > 80 || /[\u0000-\u001f\u007f]/.test(input.name) ||
      !Number.isSafeInteger(actorId) || actorId < 1 || !['independent', 'backup'].includes(input.purpose)) throw new GatewayTaskError('GATEWAY_REMOTE_SETUP_INVALID')
    recordKey = `management_gateway_remote_attempt_${platformId}_${input.requestId}`
    const previousAttempt = await prisma.systemConfig.findUnique({ where: { key: recordKey }, select: { value: true } })
    if (previousAttempt) {
      const previous = parseRemoteGatewayPreparation(previousAttempt.value)
      let address: string, hostname: string
      try {
        address = normalizeOnboardingAddress(input.address)
        hostname = validateStableGatewayEndpoint({ hostname: input.hostname, port: 51820 }).hostname
      } catch { throw new GatewayTaskError('GATEWAY_TASK_IDEMPOTENCY_CONFLICT') }
      if (!previous || previous.actorId !== actorId || previous.gatewayId !== input.gatewayId || previous.requestId !== input.requestId ||
        previous.address !== address || previous.hostname !== hostname ||
        previous.purpose !== input.purpose || previous.name !== input.name.trim()) throw new GatewayTaskError('GATEWAY_TASK_IDEMPOTENCY_CONFLICT')
    }
    validateCredentials(input.credentials)
    const address = normalizeOnboardingAddress(input.address)
    recordAddress = address
    const hostname = validateStableGatewayEndpoint({ hostname: input.hostname, port: 51820 }).hostname
    recordHostname = hostname
    const duplicate = await prisma.managementGatewayTask.findUnique({ where: { id: input.requestId }, include: { gateway: true } })
    if (duplicate) {
      const desired = (duplicate.installation as unknown as { desired?: GatewayInstallationDesired })?.desired
      if (duplicate.gatewayId !== input.gatewayId || duplicate.createdById !== actorId || duplicate.gateway.platformId !== platformId || duplicate.kind !== 'install' ||
        duplicate.gateway.name !== input.name.trim() || !desired || desired.slot !== (input.purpose === 'backup' ? 'b' : 'a') ||
        validateGatewayTaskTarget(duplicate.gateway.target).ssh?.address !== await (operations.resolve || resolveGatewayEndpointAddress)(address) ||
        desired?.consoleOrigin !== `https://${hostname}:${desired?.consolePort}`) throw new GatewayTaskError('GATEWAY_TASK_IDEMPOTENCY_CONFLICT')
      return { gatewayId: input.gatewayId, task: await getManagementGatewayTask(input.requestId) }
    }
    input.address = address; input.hostname = hostname
    await saveAttempt('running')
    const verified = await resolveRemoteGatewayDomain(address, hostname, operations.resolve)
    step = 'inspect-environment'; await saveAttempt('running')
    const registered = await prisma.managementGateway.findUnique({ where: { id: input.gatewayId } })
    if (registered && (registered.platformId !== platformId || registered.retiredAt || registered.mode !== 'remote' || registered.revision !== 0n)) throw new GatewayTaskError('GATEWAY_INSTALL_EXISTING_REQUIRES_ATTACH')
    if (registered) {
      const installations = await prisma.managementGatewayTask.findMany({ where: { gatewayId: input.gatewayId, kind: 'install' }, include: { steps: true } })
      if (installations.some(task => !['failed', 'cancelled'].includes(task.status) || task.steps.some(step =>
        ['install-components', 'verify-installation'].includes(step.key) && step.status !== 'pending'))) {
        throw new GatewayTaskError('GATEWAY_INSTALL_EXISTING_REQUIRES_ATTACH')
      }
    }
    const initial = await prisma.managementGatewayTask.findUnique({ where: { id: remoteGatewayInspectionId(input.requestId) } })
    if (initial && (initial.createdById !== actorId || initial.gatewayId !== input.gatewayId || initial.kind !== 'inspect')) throw new GatewayTaskError('GATEWAY_TASK_IDEMPOTENCY_CONFLICT')
    const prior = initial || await prisma.managementGatewayTask.findFirst({ where: { gatewayId: input.gatewayId, kind: 'inspect', status: 'succeeded' }, orderBy: { createdAt: 'desc' } })
    let configuration: GatewayInstallationDesired
    const networks: string[] = [], ports: Array<{ protocol: 'tcp' | 'udp'; port: number }> = []
    if (prior) {
      const saved = (prior.inspection as unknown as { request: GatewayPreflightRequest }).request
      if (saved.slot !== (input.purpose === 'backup' ? 'b' : 'a')) throw new GatewayTaskError('GATEWAY_TASK_TARGET_CONFLICT')
      configuration = { slot: saved.slot, network: saved.network, address: saved.address, listenPort: saved.listenPort, consolePort: saved.consolePort, consoleOrigin: `https://${hostname}:${saved.consolePort}` }
    } else {
      const tasks = await prisma.managementGatewayTask.findMany({ where: { gateway: { platformId, retiredAt: null },
        OR: [{ kind: 'inspect', status: 'succeeded' }, { kind: 'install' }] }, select: { inspection: true, installation: true } })
      networks.push(...tasks.flatMap(task => {
        const desired = (task.installation as unknown as { desired?: GatewayInstallationDesired } | null)?.desired
        const request = (task.inspection as unknown as { request?: GatewayPreflightRequest } | null)?.request
        return desired ? [desired.network] : request ? [request.network] : []
      }))
      if (process.env.ONBOARDING_MANAGEMENT_ADDRESS) networks.push(process.env.ONBOARDING_MANAGEMENT_ADDRESS)
      else if (process.env.ONBOARDING_GATEWAY_HOST) networks.push('10.253.240.0/24')
      configuration = planRemoteGatewayConfiguration(input.purpose, hostname, networks)
    }
    // Remote read-only inspection captures the first SSH identity, then all
    // installation work is bound to that persisted machine and fingerprint.
    // A connection and probe can take 45 seconds. Reserve that entire bound
    // before another conflict check, so a synchronous request cannot outlive
    // the browser deadline while silently continuing to create plans.
    const now = operations.now || Date.now
    const inspectionDeadline = now() + 70000
    let inspectionId = '', inspectionConfiguration: Omit<GatewayInstallationDesired, 'consoleOrigin'> | undefined
    for (let attempt = 0; attempt <= 16; attempt++) {
      if (attempt > 0 && inspectionDeadline - now() < 45000) throw new GatewayTaskError('GATEWAY_INSPECTION_TIMEOUT')
      inspectionId = remoteGatewayInspectionId(input.requestId, attempt)
      const { consoleOrigin: _origin, ...settings } = configuration
      inspectionConfiguration = settings
      const inspected = await operations.inspect({ requestId: inspectionId, gatewayId: input.gatewayId, name: input.name.trim(), mode: 'remote',
        target: { address: verified.address, port: 22, ...(registered ? { fingerprint: validateGatewayTaskTarget(registered.target).ssh!.fingerprint } : {}) },
        configuration: settings, credentials: input.credentials }, actorId)
      const report = inspected.report
      if (!report || report.facts.interface.exists || Object.values(report.facts.services).some(service => service.installed) ||
          !(report.facts.routeConflicts.length || report.facts.portConflicts.length)) break
      if (attempt === 16) throw new GatewayTaskError('GATEWAY_REMOTE_PLANNING_EXHAUSTED')
      networks.push(...report.facts.routeConflicts.map(conflict => conflict.network))
      ports.push(...report.facts.portConflicts)
      configuration = planRemoteGatewayConfiguration(input.purpose, hostname, networks, ports)
    }
    const inspected = await prisma.managementGatewayTask.findUniqueOrThrow({ where: { id: inspectionId } })
    const saved = (inspected.inspection as unknown as { request: GatewayPreflightRequest }).request
    const { schemaVersion: _schema, platformId: _platform, gatewayId: _gateway, expectedMachineId: _machine, ...settings } = saved
    if (gatewayTaskHash(settings) !== gatewayTaskHash(inspectionConfiguration)) throw new GatewayTaskError('GATEWAY_TASK_PLAN_STALE')
    step = 'prepare-installation'; await saveAttempt('running')
    const task = await operations.install({ requestId: input.requestId, gatewayId: input.gatewayId, configuration, credentials: input.credentials }, actorId)
    await saveAttempt('succeeded')
    return { gatewayId: input.gatewayId, task }
  } catch (error) {
    if (recordKey && !(error instanceof GatewayTaskError && error.code === 'GATEWAY_TASK_IDEMPOTENCY_CONFLICT')) {
      await saveAttempt('failed', error instanceof GatewayTaskError || error instanceof OnboardingError ? error.code : 'GATEWAY_REMOTE_PREPARATION_FAILED')
    }
    throw error
  } finally { preparing = false }
}
