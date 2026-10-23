import { prisma } from '../db/prisma.js'
import { gatewayTaskHash, GatewayTaskError, validateGatewayTaskTarget, type GatewayTaskPlan } from '../lib/gateway-task-plan.js'
import { validateCredentials, type OnboardingCredentials } from '../lib/host-onboarding.js'
import { validateGatewayInstallationDesired, type GatewayInstallationDesired } from '../lib/gateway-installation.js'
import { authorizeGatewayAdministration, encryptGatewayTaskSecret } from './gateway-admin-authorization.js'
import { managementGatewayPlatformId, getManagementGatewayTask } from './gateway-management.js'
import { approveManagementGatewayTask, cancelManagementGatewayTask, createManagementGatewayTask, takeGatewayBootstrapMaterial } from './gateway-task-journal.js'
import { gatewayInstallationExecutorAvailable, launchGatewayInstallationTask } from './gateway-installation-dispatcher.js'

export interface GatewayInstallationInput { requestId: string; gatewayId: string; configuration: GatewayInstallationDesired; credentials?: OnboardingCredentials }
export interface GatewayInstallationConfirmation { planHash: string; confirmation: string; password: string; totpCode?: string }
export interface GatewayInstallationDispatch { available: () => boolean; launch: (id: string) => Promise<void> }
const installedDispatch: GatewayInstallationDispatch = { available: gatewayInstallationExecutorAvailable, launch: launchGatewayInstallationTask }
export async function requestGatewayInstallation(input: GatewayInstallationInput, actorId: number, dispatch = installedDispatch) {
  if (![input.requestId, input.gatewayId].every(value => typeof value === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value))) throw new GatewayTaskError('GATEWAY_INSTALLATION_INVALID')
  const gateway = await prisma.managementGateway.findFirst({ where: { id: input.gatewayId, platformId: managementGatewayPlatformId(), retiredAt: null } })
  if (!gateway) throw new GatewayTaskError('GATEWAY_INSTALL_EXISTING_REQUIRES_ATTACH')
  const target = validateGatewayTaskTarget(gateway.target)
  if (target.mode === 'existing') throw new GatewayTaskError('GATEWAY_INSTALL_EXISTING_REQUIRES_ATTACH')
  const desired = validateGatewayInstallationDesired(input.configuration, { platformId: gateway.platformId, gatewayId: gateway.id, machineId: target.machineId })
  const existing = await prisma.managementGatewayTask.findUnique({ where: { id: input.requestId } })
  if (existing) {
    const saved = existing.installation as unknown as { desired?: unknown } | null
    if (existing.kind !== 'install' || existing.gatewayId !== gateway.id || existing.createdById !== actorId || !saved?.desired ||
        gatewayTaskHash(saved.desired) !== gatewayTaskHash(desired)) throw new GatewayTaskError('GATEWAY_TASK_IDEMPOTENCY_CONFLICT')
    return getManagementGatewayTask(existing.id)
  }
  if (gateway.revision !== 0n) throw new GatewayTaskError('GATEWAY_INSTALL_EXISTING_REQUIRES_ATTACH')
  if (!dispatch.available()) throw new GatewayTaskError('GATEWAY_INSTALL_EXECUTOR_UNAVAILABLE')
  let credentials: { encrypted: string; expiresAt: Date } | undefined
  if (target.mode === 'local') {
    if (input.credentials !== undefined) throw new GatewayTaskError('GATEWAY_LOCAL_SSH_FORBIDDEN')
  } else {
    validateCredentials(input.credentials)
    credentials = { encrypted: encryptGatewayTaskSecret(JSON.stringify({ password: input.credentials.password || undefined, privateKey: input.credentials.privateKey || undefined })),
      expiresAt: new Date(Date.now() + 30 * 60000) }
  }
  const plan: GatewayTaskPlan = { schemaVersion: 1, taskId: input.requestId, platformId: gateway.platformId, gatewayId: gateway.id, kind: 'install',
    basedOnRevision: gateway.revision.toString(), target, configurationHash: gatewayTaskHash(desired), componentHash: '0'.repeat(64), observedStateHash: '0'.repeat(64) }
  const task = await createManagementGatewayTask(plan, actorId, credentials, desired)
  if (task.preparationState === 'queued' && task.status === 'awaiting_confirmation') await dispatch.launch(task.id)
  return getManagementGatewayTask(task.id)
}
async function installationTask(id: string) {
  const task = await getManagementGatewayTask(id) as { kind: string; preparationState: string | null }
  if (task.kind !== 'install' || task.preparationState === null) throw new GatewayTaskError('GATEWAY_TASK_NOT_FOUND')
}
export async function confirmGatewayInstallation(id: string, input: GatewayInstallationConfirmation, actorId: number, sessionId: string, dispatch = installedDispatch) {
  // Scope checks precede credential verification; passwords never enter task JSON.
  await installationTask(id)
  const task = await approveManagementGatewayTask(id, input.planHash, actorId, { verifiedAt: Date.now(), confirmation: input.confirmation, sessionId },
    tx => authorizeGatewayAdministration(tx, actorId, input))
  if (task.status === 'queued') await dispatch.launch(id)
  return getManagementGatewayTask(id)
}
export async function cancelGatewayInstallation(id: string, actorId: number) {
  await installationTask(id)
  await cancelManagementGatewayTask(id, actorId)
  return getManagementGatewayTask(id)
}
export async function retrieveGatewayBootstrap(id: string, input: { password?: string; totpCode?: string }, actorId: number, sessionId: string) {
  await installationTask(id)
  return takeGatewayBootstrapMaterial(id, actorId, sessionId,
    input.password ? tx => authorizeGatewayAdministration(tx, actorId, { password: input.password!, totpCode: input.totpCode }) : undefined)
}
