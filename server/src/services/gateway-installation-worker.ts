import { prisma } from '../db/prisma.js'
import { GatewayTaskError, gatewayTaskHash, validateGatewayTaskPlan } from '../lib/gateway-task-plan.js'
import { OnboardingError, validateCredentials, type OnboardingCredentials } from '../lib/host-onboarding.js'
import { validateGatewayInstallationDesired, validateGatewayInstallationRequest, type GatewayInstallationDesired, type GatewayInstallationRequest } from '../lib/gateway-installation.js'
import { decryptGatewayTaskSecret, encryptGatewayTaskSecret } from './gateway-admin-authorization.js'
import { createGatewayInstallationDriver } from './gateway-installation-driver.js'
import { retryGatewayJournal } from './gateway-journal-retry.js'
import { claimGatewayInstallationPreparation, heartbeatGatewayInstallationPreparation, completeGatewayInstallationPreparation, failGatewayInstallationPreparation,
  claimManagementGatewayTask, heartbeatManagementGatewayTask, beginManagementGatewayStep, completeManagementGatewayStep, finishManagementGatewayTask,
  interruptManagementGatewayTask, failGatewayInstallationBeforeExecution } from './gateway-task-journal.js'

export async function runGatewayInstallationTask(id: string) {
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(id)) throw new GatewayTaskError('GATEWAY_INSTALLATION_INVALID')
  const candidate = await prisma.managementGatewayTask.findUnique({ where: { id } })
  if (!candidate || candidate.kind !== 'install' || candidate.preparationState === null) throw new GatewayTaskError('GATEWAY_INSTALLATION_INVALID')
  const preparing = candidate.status === 'awaiting_confirmation' && ['queued', 'running'].includes(candidate.preparationState)
  const task = await retryGatewayJournal(() => preparing ? claimGatewayInstallationPreparation(id) : claimManagementGatewayTask(id))
  if (!task) return { claimed: false }
  const token = task.leaseToken!, plan = validateGatewayTaskPlan(task.plan), abort = new AbortController()
  const journal = <T>(work: () => Promise<T>) => retryGatewayJournal(work, abort.signal)
  let driver: Awaited<ReturnType<typeof createGatewayInstallationDriver>> | undefined, beating = false, leaseError: unknown
  const heartbeat = async () => {
    if (beating || abort.signal.aborted) return
    beating = true
    try { if (preparing) await journal(() => heartbeatGatewayInstallationPreparation(id, token)); else await journal(() => heartbeatManagementGatewayTask(id, token)) }
    catch (error) { leaseError = error; abort.abort() }
    finally { beating = false }
  }
  const timer = setInterval(() => { void heartbeat() }, 10000)
  const deadline = setTimeout(() => { leaseError = new GatewayTaskError('GATEWAY_INSTALL_TIMEOUT'); abort.abort() }, 15 * 60000)
  const assertLease = () => { if (leaseError || abort.signal.aborted) throw new GatewayTaskError('GATEWAY_TASK_LEASE_LOST') }
  const initialSteps = (task as { steps?: Array<{ key: string; status: string }> }).steps || []
  let writing = !preparing && initialSteps.some(step => ['install-components', 'verify-installation'].includes(step.key) && step.status !== 'pending')
  try {
    let credentials: OnboardingCredentials | undefined
    if (task.credentialsEncrypted) {
      const value = JSON.parse(decryptGatewayTaskSecret(task.credentialsEncrypted))
      if (!value || typeof value !== 'object' || !Object.keys(value).every(key => key === 'password' || key === 'privateKey')) throw new GatewayTaskError('GATEWAY_TASK_SECRET_INVALID')
      validateCredentials(value); credentials = { password: value.password || undefined, privateKey: value.privateKey || undefined }
    }
    if (!preparing && task.preparationState !== 'ready') throw new GatewayTaskError('GATEWAY_INSTALL_PLAN_NOT_READY')
    driver = await createGatewayInstallationDriver(plan, credentials, abort.signal)
    const saved = task.installation as unknown as { schemaVersion: number; desired: GatewayInstallationDesired; request?: GatewayInstallationRequest }
    if (!saved || saved.schemaVersion !== 1) throw new GatewayTaskError('GATEWAY_INSTALLATION_INVALID')
    const desired = validateGatewayInstallationDesired(saved.desired, { ...plan, machineId: plan.target.machineId })
    if (preparing) {
      const { request, preview } = await driver.prepare(desired)
      assertLease()
      await journal(() => completeGatewayInstallationPreparation(id, token, request, preview, driver!.platformSigningKey))
      return { claimed: true, prepared: true, installable: preview.installable }
    }
    const request = validateGatewayInstallationRequest(saved.request, driver.platformSigningKey)
    if (gatewayTaskHash(request.task) !== gatewayTaskHash(plan)) throw new GatewayTaskError('GATEWAY_TASK_PLAN_STALE')
    const report = await driver.inspect(desired)
    if (report.observedStateHash !== request.task.observedStateHash) throw new GatewayTaskError('GATEWAY_INSTALL_OBSERVATION_CHANGED')
    const complete = async (key: string, evidence: unknown, configurationHash: string | null = null) => {
      assertLease()
      const step = await journal(() => beginManagementGatewayStep(id, token, key))
      if (step.completed) return
      await journal(() => completeManagementGatewayStep(id, token, key, { schemaVersion: 1, taskId: id, operationId: step.operationId, step: key,
        planHash: gatewayTaskHash(plan), targetHash: gatewayTaskHash(plan.target), evidenceHash: gatewayTaskHash(evidence), configurationHash,
        issuedAt: Date.now(), outcome: 'verified' }))
    }
    await complete('verify-target', { machineId: report.machineId, target: plan.target })
    await complete('inspect-environment', report)
    // Fresh-install rollback starts from a verified absence of managed objects;
    // the exact new-object inventory is already persisted in the approved preview.
    await complete('save-rollback', { observedStateHash: report.observedStateHash, before: report.facts, inventory: task.installationPreview })
    await journal(() => beginManagementGatewayStep(id, token, 'install-components'))
    writing = true
    const installed = await driver.execute(request)
    assertLease()
    const encrypted = encryptGatewayTaskSecret(JSON.stringify(installed.bootstrap))
    await complete('install-components', installed.receipt)
    await complete('verify-installation', installed.receipt, plan.configurationHash)
    await journal(() => finishManagementGatewayTask(id, token, undefined, { receipt: installed.receipt, bootstrapEncrypted: encrypted,
      bootstrapExpiresAt: new Date(Date.now() + 30 * 60000) }))
    return { claimed: true, installed: true, canWrite: false }
  } catch (error) {
    if (preparing) await retryGatewayJournal(() => failGatewayInstallationPreparation(id, token,
      error instanceof GatewayTaskError || error instanceof OnboardingError ? error.code : 'GATEWAY_INSTALL_PREPARATION_FAILED')).catch(() => {})
    else if (writing) await retryGatewayJournal(() => interruptManagementGatewayTask(id, token,
      error instanceof GatewayTaskError || error instanceof OnboardingError ? error.code : 'GATEWAY_TASK_EXECUTOR_INTERRUPTED')).catch(() => {})
    else await retryGatewayJournal(() => failGatewayInstallationBeforeExecution(id, token,
      error instanceof GatewayTaskError || error instanceof OnboardingError ? error.code : 'GATEWAY_INSTALL_EXECUTOR_FAILED')).catch(() => {})
    throw error
  } finally { clearInterval(timer); clearTimeout(deadline); abort.abort(); driver?.close() }
}
