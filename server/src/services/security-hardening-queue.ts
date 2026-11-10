import { randomUUID } from 'node:crypto'
import { setTimeout as wait } from 'node:timers/promises'
import { Prisma } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { tryAdvisoryTransactionLock, INSTANCE_OPERATION_LOCK_NAMESPACE } from '../db/advisory-locks.js'
import { hasActiveTransferWorkflow } from '../db/transfers.js'
import { assertNoPendingSnapshotOperations } from '../db/snapshot-operation-guards.js'
import { assertNoPendingProxySiteOperations } from '../db/proxy-site-operation-guards.js'
import { HOST_OCCUPIED_INSTANCE_WHERE } from '../lib/host-resource-usage.js'
import { readCustomerIsolation } from '../lib/incus/customer-isolation.js'
import { getIncusClient } from '../lib/incus/incus-pool.js'
import { managedCleanupEndpointHash } from '../lib/managed-cleanup-identity.js'
import { SECURITY_HARDENING_ENABLED_KEY, SECURITY_HARDENING_REVISION, hardeningFailure, hardeningReason,
  hardeningSchedule, hardeningUpdateBudget, hardeningDiagnostic, hardeningPhaseLabel, hardeningNeedsReadOnlyRecovery,
  type HardeningCheck, type HardeningState } from '../lib/security-hardening.js'
import { inspectHostSecurity, safeCustomerRuntime, hardeningPreflightCheck } from './host-security-inspection.js'
import { maintainAlpineCustomerSsh } from './alpine-ssh-maintenance.js'
import { recoveryHeld } from './platform-backup-core.js'
import { hardeningIdentityHash } from '../lib/hardening-identity.js'
import { hostMaintenanceBlocked } from '../lib/host-maintenance-gate.js'
import { prepareAutomaticHostMaintenance, resumeAutomaticHostMaintenance } from './host-security-maintenance.js'
import { onboardingOwnsHardening, ownsOnboardingHardeningLease } from '../lib/onboarding-hardening-owner.js'

const include = { onboardingNode: { include: { batch: true } } } as const
type SecurityHost = Prisma.HostGetPayload<{ include: typeof include }>
const pending: { in: Array<'PENDING' | 'PROCESSING'> } = { in: ['PENDING', 'PROCESSING'] }
const stateJson = (value: HardeningState) => value as unknown as Prisma.InputJsonValue
export const securityHardeningDependencies = { connect: getIncusClient, host: inspectHostSecurity, customer: maintainAlpineCustomerSsh, held: recoveryHeld }

function identity(host: SecurityHost): string {
  return hardeningIdentityHash(host)
}
export type OnboardingHardeningLease = { nodeId: string; leaseToken: string }
function nodeReady(host: SecurityHost, enrollment?: OnboardingHardeningLease) {
  const node = host.onboardingNode
  return node?.status === 'succeeded' || Boolean(enrollment && node?.id === enrollment.nodeId &&
    node.status === 'running' && node.step === 'hardening' && node.leaseToken === enrollment.leaseToken &&
    node.leaseUntil && node.leaseUntil > new Date())
}
async function allowed(tx: Prisma.TransactionClient, host: SecurityHost, held = recoveryHeld, enrollment?: OnboardingHardeningLease) {
  if (held()) throw new Error('HARDENING_RECOVERY_HELD')
  await tx.$queryRaw`SELECT id FROM system_configs WHERE key = ${SECURITY_HARDENING_ENABLED_KEY} FOR SHARE`
  const policy = await tx.systemConfig.findUnique({ where: { key: SECURITY_HARDENING_ENABLED_KEY } })
  if (!policy || !['true', '1'].includes(policy.value)) throw new Error('HARDENING_DISABLED')
  const node = host.onboardingNode
  if (!node || node.deletedAt || !nodeReady(host, enrollment) || !node.nodePublicKey || !node.sshFingerprint ||
    !host.singleTenant || !host.isInstalled || !host.serverCertificate || !host.serverFingerprint ||
    host.managementSshHost !== node.managementIp || host.managementSshPort !== node.sshPort || host.managementSshUser !== 'root') {
    throw new Error('HARDENING_IDENTITY_MISSING')
  }
  await tx.$queryRaw`SELECT id FROM host_onboarding_nodes WHERE id = ${node.id} FOR SHARE`
  await tx.$queryRaw`SELECT id FROM host_onboarding_batches WHERE id = ${node.batchId} FOR SHARE`
  const current = await tx.host.findUniqueOrThrow({ where: { id: host.id }, include })
  if (identity(current) !== identity(host) || current.managementSshPort !== current.onboardingNode?.sshPort ||
    !nodeReady(current, enrollment) || current.onboardingNode?.deletedAt) {
    throw new Error('HARDENING_IDENTITY_CHANGED')
  }
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${node.batch.createdById} FOR SHARE`
  const actor = await tx.user.findUnique({ where: { id: node.batch.createdById }, select: { status: true, role: true } })
  if (actor?.status !== 'active' || actor.role !== 'admin') throw new Error('HARDENING_ADMIN_REQUIRED')
  if (host.status !== 'online') throw new Error('HARDENING_OFFLINE')
  if (host.poolFaulted) throw new Error('HARDENING_HOST_QUARANTINED')
  if (host.publicIpSyncBlocked) throw new Error('HARDENING_PUBLIC_IP_PENDING')
  if (host.installPending) throw new Error('HARDENING_INSTALL_PENDING')
}
function currentState(value: Prisma.JsonValue | null): Partial<HardeningState> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Partial<HardeningState> : {} }

/** A lease is scheduling only. Every actual remote action separately locks and
 * verifies the current host/customer/authority; a stored receipt grants no trust. */
export async function hardenExistingHost(hostId: number, deps = securityHardeningDependencies, enrollment?: OnboardingHardeningLease): Promise<void> {
  if (deps.held()) return
  const claim = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL lock_timeout = '2s'`
    const rows = await tx.$queryRaw<Array<{ id: number }>>`SELECT id FROM hosts WHERE id = ${hostId} FOR UPDATE`
    if (!rows.length) return null
    const host = await tx.host.findUniqueOrThrow({ where: { id: hostId }, include })
    if (enrollment ? !ownsOnboardingHardeningLease(host.onboardingNode, enrollment) : onboardingOwnsHardening(host.onboardingNode)) return null
    const previous = currentState(host.securityHardening)
    if (previous.revision === SECURITY_HARDENING_REVISION && previous.nextCheckAt && Date.parse(previous.nextCheckAt) > Date.now()) return null
    // Paid pool delivery already owns this host. A periodic inspection cannot
    // overwrite its admission receipt and then wait for that same delivery.
    // Keep the due time unchanged: after delivery/cleanup the next scan resumes.
    if (!hostMaintenanceBlocked(host.securityHardening) && await tx.instance.count({ where: {
      hostId, status: 'creating', purchaseBatchId: { not: null }
    } })) return null
    const leaseToken = randomUUID()
    const sameRevision = previous.revision === SECURITY_HARDENING_REVISION
    const state: HardeningState = { revision: SECURITY_HARDENING_REVISION, status: 'retry',
      attempts: Math.min(sameRevision && previous.status === 'retry' && Number.isSafeInteger(previous.attempts) ? Math.max(previous.attempts!, 0) + 1 : 1, 1000000),
      // Revision changes cannot silently renew an exhausted write budget.
      updateAttempts: hardeningUpdateBudget(previous), phase: 'authority',
      checkedAt: new Date().toISOString(), nextCheckAt: new Date(Date.now() + 600000).toISOString(), leaseToken,
      identityHash: identity(host) }
    if (previous.maintenance !== undefined) state.maintenance = previous.maintenance
    state.remoteRequestId = typeof previous.remoteRequestId === 'string' && /^[a-f0-9-]{36}$/.test(previous.remoteRequestId)
      ? previous.remoteRequestId : randomUUID()
    await tx.host.update({ where: { id: hostId }, data: { securityHardening: stateJson(state) } })
    return { host, state, previous }
  }, { maxWait: 3000, timeout: 8000 })
  if (!claim) return
  const { host: original, state, previous } = claim
  const inspectOnly = hardeningNeedsReadOnlyRecovery(previous) || state.updateAttempts! >= 6
  const leaseToken = state.leaseToken
  let actorId: number | null = original.onboardingNode?.batch.createdById ?? null
  let failedUpdate = false
  let auditedInstances: Array<{ id: number; incusId: string; userId: number; status: string; snapshottedSpecs: Prisma.JsonValue | null }> | undefined
  try {
    const occupants = await prisma.instance.findMany({ where: { hostId, ...HOST_OCCUPIED_INSTANCE_WHERE }, select: { id: true }, orderBy: { id: 'asc' } })
    const inspection = await prisma.$transaction(async tx => {
      const deadline = Date.now() + 170000
      await tx.$executeRaw`SET LOCAL lock_timeout = '3s'`
      for (const row of occupants) if (!await tryAdvisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, row.id)) throw new Error('HARDENING_BUSY')
      await tx.$queryRaw`SELECT id FROM hosts WHERE id = ${hostId} FOR UPDATE`
      const host = await tx.host.findUniqueOrThrow({ where: { id: hostId }, include })
      if (identity(host) !== identity(original) || currentState(host.securityHardening).leaseToken !== state.leaseToken) throw new Error('HARDENING_IDENTITY_CHANGED')
      await allowed(tx, host, deps.held, enrollment)
      if (hostMaintenanceBlocked(host.securityHardening)) throw new Error('HOST_SECURITY_MAINTENANCE')
      actorId = host.onboardingNode!.batch.createdById
      state.phase = 'inventory'
      const instances = await tx.instance.findMany({ where: { hostId, ...HOST_OCCUPIED_INSTANCE_WHERE }, orderBy: { id: 'asc' } })
      // A running enrollment lease grants host-only hardening, never customer
      // maintenance or authority to reuse an occupied host as a new machine.
      if (enrollment && instances.length) throw new Error('HARDENING_IDENTITY_CHANGED')
      if (instances.length > 1 || instances.length !== occupants.length || instances.some((instance, i) => instance.id !== occupants[i].id) ||
        await tx.instanceTask.count({ where: { status: pending, OR: [{ hostId }, { targetHostId: hostId }, { replacementState: { path: ['sourceHostId'], equals: hostId } }] } }) ||
        await tx.checkoutReservation.count({ where: { hostId } })) throw new Error('HARDENING_BUSY')
      for (const instance of instances) {
        await tx.$queryRaw`SELECT id FROM instances WHERE id = ${instance.id} FOR UPDATE`
        if (!['running', 'stopped', 'suspended'].includes(instance.status) || instance.provisioningCleanupPending || instance.deletionBillingPending ||
          instance.deletionIntent || instance.status === 'running' && instance.expiresAt && instance.expiresAt <= new Date() ||
          await hasActiveTransferWorkflow(instance.id, tx) ||
          await tx.restoreTask.count({ where: { instanceId: instance.id, status: pending } }) ||
          await tx.backupUploadTask.count({ where: { instanceId: instance.id, status: pending } }) ||
          await tx.instanceTransfer.count({ where: { instanceId: instance.id, status: { in: ['pending', 'processing'] } } })) throw new Error('HARDENING_BUSY')
        try { await assertNoPendingSnapshotOperations(tx, instance.id); await assertNoPendingProxySiteOperations(tx, instance.id) }
        catch { throw new Error('HARDENING_BUSY') }
      }
      const client = await deps.connect(host, tx, 8000)
      const remote = await client.request<Array<{ name: string; project?: string }>>('GET', '/1.0/instances?recursion=1&all-projects=true', null, 8000)
      if (!Array.isArray(remote) || remote.length !== instances.length || remote.some(row => row.project && row.project !== 'default' || !instances.some(instance => row.name === instance.incusId))) {
        throw new Error('HARDENING_IDENTITY_CHANGED')
      }
      const checks: NonNullable<HardeningState['instances']> = []
      state.instances = checks
      state.phase = 'runtime'
      const guests: Array<{ instanceId: number; pid: number }> = []
      const uuids = new Map<number, string>()
      for (const instance of instances) {
        const entry = { instanceId: instance.id, isolation: { status: 'verified' } as HardeningCheck, ssh: { status: 'retry', reason: 'ALPINE_SSH_TARGET_NOT_READY' } as HardeningCheck }
        checks.push(entry)
        try {
          const current = await readCustomerIsolation(client, instance.incusId)
          const uuid = current.config?.['volatile.uuid']
          if (typeof uuid !== 'string' || !/^[a-f0-9-]{36}$/i.test(uuid)) throw new Error('HARDENING_IDENTITY_MISSING')
          const specs = instance.snapshottedSpecs as Record<string, unknown> | null
          const saved = specs?.managedCleanup as { uuid?: string; attempt?: string; endpointHash?: string } | undefined
          if (!saved?.attempt || !/^[a-f0-9-]{36}$/i.test(saved.attempt) || saved.uuid !== uuid ||
            saved.endpointHash !== managedCleanupEndpointHash(client) || current.config?.['user.payincus.provisioning-attempt'] !== saved.attempt) {
            throw new Error('HARDENING_IDENTITY_CHANGED')
          }
          uuids.set(instance.id, uuid)
          if (instance.status === 'running' && current.type === 'container') {
            const runtime = await client.request<{ pid?: number; status?: string }>('GET', `/1.0/instances/${encodeURIComponent(instance.incusId)}/state`, null, 8000)
            if (runtime.status !== 'Running' || !Number.isSafeInteger(runtime.pid) || runtime.pid! <= 0) throw new Error('HARDENING_GUEST_NOT_RUNNING')
            guests.push({ instanceId: instance.id, pid: runtime.pid! })
          } else if (current.type === 'container') {
            entry.isolation = { status: 'needs-maintenance', reason: 'HARDENING_GUEST_NOT_RUNNING' }
          } else {
            entry.isolation = { status: 'needs-maintenance', reason: 'HARDENING_VM_RUNTIME_UNVERIFIED' }
          }
        } catch (error) { entry.isolation = hardeningFailure(error) }
      }
      const exhausted = state.updateAttempts! >= 6
      state.phase = 'host-inspection'
      const runtime = await deps.host(host, guests, !inspectOnly && !exhausted && checks.every(entry => entry.isolation.status === 'verified'), () => allowed(tx, host, deps.held, enrollment), deadline, state.remoteRequestId)
      state.environment = runtime.preflight
      const preflight = hardeningPreflightCheck(runtime.preflight)
      for (const entry of checks) {
        const guest = runtime.guests.find(row => row.instanceId === entry.instanceId)
        if (guest && !safeCustomerRuntime(guest)) entry.isolation = { status: 'needs-maintenance', reason: 'HARDENING_GUEST_RUNTIME_UNSAFE' }
      }
      const apparmor: HardeningCheck = runtime.apparmor && runtime.guests.every(guest => guest.apparmor?.includes('(enforce)') && guest.apparmor.startsWith('incus-')) ?
        { status: 'verified' } : { status: 'needs-maintenance', reason: !runtime.preflight.apparmorKernelSupport ? 'HARDENING_APPARMOR_KERNEL_UNSUPPORTED' :
          runtime.preflight.apparmorBootDisabled ? 'HARDENING_APPARMOR_BOOT_DISABLED' : 'HARDENING_APPARMOR_REQUIRED' }
      const ssh: HardeningCheck = !runtime.alpine ? { status: 'not-applicable' } : runtime.fixed ? { status: 'verified' } :
        preflight.status !== 'verified' ? { ...preflight } :
        inspectOnly && !exhausted ? { status: 'retry', reason: 'ALPINE_SSH_PATCH_REQUIRED' } :
        { status: 'needs-maintenance', reason: exhausted ? 'HARDENING_RETRY_EXHAUSTED' : 'ALPINE_SSH_UNSUPPORTED' }
      await allowed(tx, host, deps.held, enrollment)
      // The exact original Incus identity must still exist after the host reload.
      for (const instance of instances) {
        if (!uuids.has(instance.id)) continue
        const after = await readCustomerIsolation(client, instance.incusId)
        const saved = (instance.snapshottedSpecs as { managedCleanup?: { attempt?: string } } | null)?.managedCleanup
        if (after.config?.['volatile.uuid'] !== uuids.get(instance.id) || after.config?.['user.payincus.provisioning-attempt'] !== saved?.attempt) throw new Error('HARDENING_IDENTITY_CHANGED')
        const guest = guests.find(row => row.instanceId === instance.id)
        if (guest) {
          const afterRuntime = await client.request<{ pid?: number; status?: string }>('GET', `/1.0/instances/${encodeURIComponent(instance.incusId)}/state`, null, 8000)
          if (afterRuntime.status !== 'Running' || afterRuntime.pid !== guest.pid) throw new Error('HARDENING_IDENTITY_CHANGED')
        }
      }
      const hostChecks = { apparmor, ssh, preflight }
      state.host = hostChecks
      state.phase = 'customer-ssh'
      // Commit the probe receipt and next phase with the original lease before
      // entering customer maintenance. A backend crash preserves this progress.
      await tx.host.update({ where: { id: hostId }, data: { securityHardening: stateJson(state) } })
      return { host: hostChecks, checks, instances }
    }, { maxWait: 5000, timeout: 180000 })
    state.host = inspection.host
    state.instances = inspection.checks
    auditedInstances = inspection.instances
    state.phase = 'customer-ssh'
    for (const entry of state.instances) {
      if (deps.held()) throw new Error('HARDENING_RECOVERY_HELD')
      if (entry.isolation.status !== 'verified') { entry.ssh = { status: 'needs-maintenance', reason: entry.isolation.reason }; continue }
      if (inspection.host.preflight.status !== 'verified') { entry.ssh = { ...inspection.host.preflight }; continue }
      try {
        const instance = inspection.instances.find(row => row.id === entry.instanceId)!
        const saved = (instance.snapshottedSpecs as { managedCleanup: { uuid: string; attempt: string; endpointHash: string } }).managedCleanup
        const node = original.onboardingNode!
        const result = await deps.customer(entry.instanceId, actorId!, undefined, undefined, true, {
          ...saved, hostId, incusId: instance.incusId, url: original.url, serverCertificate: original.serverCertificate,
          serverFingerprint: original.serverFingerprint, nodeId: node.id, nodePublicKey: node.nodePublicKey, sshFingerprint: node.sshFingerprint,
          managementSshHost: original.managementSshHost, managementSshPort: original.managementSshPort, managementSshUser: original.managementSshUser,
          inspectOnly
        })
        entry.ssh = { status: result.status === 'not-alpine' ? 'not-applicable' : 'verified' }
      } catch (error) {
        entry.ssh = hardeningFailure(error)
        if (['ALPINE_SSH_UPDATE_FAILED', 'ALPINE_SSH_VERIFICATION_FAILED'].includes(entry.ssh.reason || '')) failedUpdate = true
        state.diagnostic = hardeningDiagnostic(entry.ssh.reason!, 'customer-ssh', entry.instanceId)
      }
    }
  } catch (error) {
    state.error = hardeningFailure(error).reason
    if (['ALPINE_SSH_UPDATE_FAILED', 'ALPINE_SSH_VERIFICATION_FAILED'].includes(state.error || '')) failedUpdate = true
    state.diagnostic = hardeningDiagnostic(state.error!, state.phase!)
  }
  if (failedUpdate) state.updateAttempts = Math.min(state.updateAttempts! + 1, 1000000)
  const checks = [state.error ? hardeningFailure(new Error(state.error)) : null,
    state.host?.preflight, state.host?.apparmor, state.host?.ssh, ...(state.instances || []).flatMap(instance => [instance.isolation, instance.ssh])].filter(Boolean) as HardeningCheck[]
  Object.assign(state, hardeningSchedule(checks, state.attempts))
  if (state.updateAttempts! >= 6 && state.status !== 'verified') {
    state.error = 'HARDENING_RETRY_EXHAUSTED'
    Object.assign(state, hardeningSchedule([{ status: 'needs-maintenance' }], state.attempts))
    state.diagnostic = hardeningDiagnostic(state.error, state.phase!)
  }
  if (!state.diagnostic) {
    const failed = checks.find(check => check.status === 'needs-maintenance') || checks.find(check => check.status === 'retry')
    if (failed?.reason) {
      const instance = state.instances?.find(row => row.isolation === failed || row.ssh === failed)
      state.diagnostic = hardeningDiagnostic(failed.reason, instance ? failed === instance.isolation ? 'runtime' : 'customer-ssh' : 'host-inspection', instance?.instanceId)
    }
  }
  if (state.status === 'verified') state.phase = 'finished'
  delete state.leaseToken
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL lock_timeout = '2s'`
    let receiptBusy = false
    for (const instance of auditedInstances || []) {
      // Frequent traffic/status observations hold this lane briefly. Give
      // them a bounded chance to finish, instead of repeatedly missing the
      // same small window and retaining an unfinished receipt indefinitely.
      const until = Date.now() + 1500
      let acquired = await tryAdvisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, instance.id)
      while (!acquired && Date.now() < until) {
        await wait(Math.min(100, until - Date.now()))
        acquired = await tryAdvisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, instance.id)
      }
      if (!acquired) { receiptBusy = true; break }
    }
    await tx.$queryRaw`SELECT id FROM hosts WHERE id = ${hostId} FOR UPDATE`
    const host = await tx.host.findUnique({ where: { id: hostId }, include })
    if (!host || currentState(host.securityHardening).leaseToken !== leaseToken) return
    // Maintenance may register between the probe and this receipt. Preserve
    // its current durable fence; a successful older probe cannot erase it.
    const currentMaintenance = currentState(host.securityHardening).maintenance
    if (currentMaintenance === undefined) delete state.maintenance
    else state.maintenance = currentMaintenance
    if (receiptBusy) {
      // Without the current customer lane no inspection result may grant
      // success. Persist only scheduling/diagnostic fields on our own claim;
      // retain its lease so the next pass inspects before any further update.
      const pending = currentState(host.securityHardening)
      await tx.host.update({ where: { id: hostId }, data: { securityHardening: stateJson({
        ...pending, revision: pending.revision!, status: 'retry', phase: 'receipt',
        updateAttempts: Math.max(hardeningUpdateBudget(pending), state.updateAttempts || 0),
        diagnostic: hardeningDiagnostic('HARDENING_BUSY', 'receipt'),
        nextCheckAt: new Date(Date.now() + 30000).toISOString()
      } as HardeningState) } })
      return
    }
    try {
      if (identity(host) !== identity(original)) throw new Error('HARDENING_IDENTITY_CHANGED')
      if (auditedInstances) {
        await allowed(tx, host, deps.held, enrollment)
        if (hostMaintenanceBlocked(host.securityHardening)) throw new Error('HOST_SECURITY_MAINTENANCE')
      }
    } catch (error) {
      state.error = hardeningFailure(error).reason
      state.phase = 'receipt'
      state.diagnostic = hardeningDiagnostic(state.error!, state.phase)
      state.host = undefined; state.instances = undefined; state.environment = undefined
      Object.assign(state, hardeningSchedule([hardeningFailure(new Error(state.error))], state.attempts))
    }
    if (auditedInstances) {
      const current = await tx.instance.findMany({ where: { hostId, ...HOST_OCCUPIED_INSTANCE_WHERE }, orderBy: { id: 'asc' } })
      const pendingWork = await tx.instanceTask.count({ where: { status: pending, OR: [{ hostId }, { targetHostId: hostId },
        { replacementState: { path: ['sourceHostId'], equals: hostId } }] } }) || await tx.checkoutReservation.count({ where: { hostId } })
      if (current.length !== auditedInstances.length || current.some((row, index) => {
        const before = auditedInstances![index]
        const saved = (before.snapshottedSpecs as { managedCleanup?: unknown } | null)?.managedCleanup
        return row.id !== before.id || row.incusId !== before.incusId || row.userId !== before.userId || row.status !== before.status ||
          JSON.stringify((row.snapshottedSpecs as { managedCleanup?: unknown } | null)?.managedCleanup) !== JSON.stringify(saved)
      })) {
        state.error = 'HARDENING_IDENTITY_CHANGED'
        state.phase = 'receipt'
        state.diagnostic = hardeningDiagnostic(state.error, state.phase)
        Object.assign(state, hardeningSchedule([hardeningFailure(new Error(state.error))], state.attempts))
        state.instances = state.instances?.map(row => ({ instanceId: row.instanceId,
          isolation: hardeningFailure(new Error(state.error)), ssh: hardeningFailure(new Error(state.error)) }))
      } else if (state.status === 'verified' && (pendingWork || current.some(row => row.provisioningCleanupPending || row.deletionBillingPending || row.deletionIntent ||
        row.status === 'running' && row.expiresAt && row.expiresAt <= new Date()))) {
        state.error = 'HARDENING_BUSY'
        state.phase = 'receipt'
        state.diagnostic = hardeningDiagnostic(state.error, state.phase)
        Object.assign(state, hardeningSchedule([hardeningFailure(new Error(state.error))], state.attempts))
      }
    }
    if (state.status === 'verified') state.updateAttempts = 0
    await tx.host.update({ where: { id: hostId }, data: { securityHardening: stateJson(state) } })
    const reasons = [...new Set([...checks.map(check => check.reason), state.error].filter(Boolean))]
    const oldReasons = JSON.stringify(previous.host) + JSON.stringify(previous.instances) + previous.error
    const changed = previous.revision !== state.revision || previous.status !== state.status || oldReasons !== JSON.stringify(state.host) + JSON.stringify(state.instances) + state.error
    const label = (check: HardeningCheck) => check.status === 'verified' ? '已验证' : check.status === 'not-applicable' ? '不适用' : check.status === 'retry' ? '等待重试' : '需维护'
    if (changed) await tx.log.create({ data: { userId: actorId, module: 'host', action: 'host.security_hardening',
      result: state.status === 'verified' ? 'success' : 'warning', content: `宿主 #${hostId} 自动安全加固：${state.status === 'verified' ? '已验证' : state.status === 'retry' ? '等待自动重试' : '暂未通过'}；${reasons.map(hardeningReason).join('；') || '隔离与适用 SSH 补丁已核验'}；${(state.instances || []).map(row => `客户 #${row.instanceId} 隔离：${label(row.isolation)}，SSH：${label(row.ssh)}`).join('；')}；${state.diagnostic ? `失败阶段：${hardeningPhaseLabel(state.diagnostic.phase)}，${state.diagnostic.nextAction}；` : ''}下次检查 ${state.nextCheckAt}。本任务保留原客户运行状态、密码、网络和账务。` } })
  }, { maxWait: 3000, timeout: 8000 })
}

/** Bounded keyset pages; leased/recent successes cannot starve offline or newly
 * installed hosts. One target runs at a time, independent from repair queues. */
let cursor = 0
export const securityHardeningMaintenanceDependencies={resume:resumeAutomaticHostMaintenance}
export async function processSecurityHardeningQueue(deps = securityHardeningDependencies, stopped = () => false,
  maintenance=securityHardeningMaintenanceDependencies) {
  if (deps.held() || stopped()) return
  const policy = await prisma.systemConfig.findUnique({ where: { key: SECURITY_HARDENING_ENABLED_KEY } })
  if (!policy || !['true', '1'].includes(policy.value)) return
  // A preparation has a finite deadline. Resume its durable owner before
  // inspecting later hosts; otherwise a large keyset pass can consume that
  // deadline while every new target merely reports the global batch fence.
  // Include changed/offline/deleted enrollments: their original maintenance
  // remains a blocker until the recovery path verifies current authority.
  const pendingMaintenance=await prisma.host.findMany({where:{securityHardening:{path:['maintenance'],not:Prisma.AnyNull}},
    select:{id:true,securityHardening:true,onboardingNode:{select:{id:true,status:true,step:true,deletedAt:true}}},orderBy:{id:'asc'}})
  const active=pendingMaintenance.find(host=>hostMaintenanceBlocked(host.securityHardening))
  if(active) {
    // Enrollment owns its lease and due time. Calling the general resumer
    // without that lease used to reject authority and postpone it forever.
    if(onboardingOwnsHardening(active.onboardingNode))return
    const state=currentState(active.securityHardening)
    if(!stopped()&&(!state.nextCheckAt||Date.parse(state.nextCheckAt)<=Date.now()))await maintenance.resume(active.id)
    return
  }
  const completed=pendingMaintenance.find(host=>{
    if(onboardingOwnsHardening(host.onboardingNode))return false
    const state=currentState(host.securityHardening)
    return state.status!=='verified'&&state.maintenance&&typeof state.maintenance==='object'&&!Array.isArray(state.maintenance)&&
      (state.maintenance as {phase?:unknown}).phase==='verified'&&(!state.nextCheckAt||Date.parse(state.nextCheckAt)<=Date.now())
  })
  if(completed&&!deps.held()&&!stopped()) {
    // Recovery marks the intent complete, then the normal full inspection
    // grants saleability. Do that before starting the next host's maintenance,
    // so a recovered empty host is not stranded behind the entire batch.
    await hardenExistingHost(completed.id,deps)
    return
  }
  const hosts = await prisma.host.findMany({ where: { id: { gt: cursor }, singleTenant:true,isInstalled:true,
    onboardingNode: { is: { status: 'succeeded',deletedAt:null } } },
    select: { id: true, securityHardening: true }, orderBy: { id: 'asc' }, take: 50 })
  if (!hosts.length) { cursor = 0; return }
  for (const host of hosts) {
    if (deps.held() || stopped()) return
    cursor = host.id
    const state = currentState(host.securityHardening)
    if(hostMaintenanceBlocked(host.securityHardening)){
      if(!state.nextCheckAt||Date.parse(state.nextCheckAt)<=Date.now())await resumeAutomaticHostMaintenance(host.id)
      continue
    }
    if (state.revision !== SECURITY_HARDENING_REVISION || !state.nextCheckAt || Date.parse(state.nextCheckAt) <= Date.now()) {
      await hardenExistingHost(host.id, deps)
      if(deps===securityHardeningDependencies)await prepareAutomaticHostMaintenance(host.id)
      return
    }
  }
}
