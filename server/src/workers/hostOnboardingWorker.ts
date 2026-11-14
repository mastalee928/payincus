import { randomUUID, X509Certificate } from 'crypto'
import { readFile } from 'fs/promises'
import { fileURLToPath } from 'url'
import { isIPv4 } from 'net'
import type { Client } from 'ssh2'
import { Prisma } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { guestProtectionReady } from '../lib/guest-network-protection.js'
import { hostProvisioningToolsReady } from '../lib/host-provisioning-tools.js'
import { hardeningReason } from '../lib/security-hardening.js'
import { createLog } from '../db/logs.js'
import { readOnboardingCredentials } from '../lib/onboarding-credentials.js'
import { ONBOARDING_RETRY_CODES, canAutomaticallyResumeOnboarding } from '../lib/onboarding-retry.js'
import { OnboardingError, shellQuote as q, onboardingPanelOrigin, type OnboardingDefaults, type OnboardingCredentials } from '../lib/host-onboarding.js'
import { connectOnboardingSsh, gatewayConfigured, sshExec } from '../services/onboarding-ssh.js'
import { lockOnboardingLifecycle, processOnboardingRetirements, inspectCurrentOnboardingSystem, enrollOnboardingGateway, readPeerRetirement } from '../services/onboarding-lifecycle.js'
import { currentHostAddressWhere, lockOnboardingAddresses } from '../services/onboarding-conflicts.js'
import { preflightScript, prepareKeyScript, wireguardScript, installerStartScript, installerPollScript } from '../services/onboarding-scripts.js'
import { withHostAddressRegistryLock, prepareHostAddressSnapshotForWrite, persistHostAddressSnapshot } from '../services/host-address-monitor.js'
import { panelCertificatePaths } from '../lib/incus/certificate-paths.js'
import { IncusClient } from '../lib/incus/index.js'
import { parseResourceProbe, resolveHostResources, verifyOnboardingArchitecture, type ResolvedHostResources } from '../lib/onboarding-resources.js'
import { lockHostGroups, resolveHostGroups } from '../services/host-groups.js'
import { queueHostGatewayDns } from '../services/host-gateway-dns.js'
import { hardenExistingHost } from '../services/security-hardening-queue.js'
import { finishSecureOnboarding } from '../services/onboarding-security-gate.js'
import { prepareAutomaticHostMaintenance, resumeAutomaticHostMaintenance } from '../services/host-security-maintenance.js'
import { assertOnboardingAuthority, assertOnboardingLease } from '../services/onboarding-authority.js'
import { NATIVE_VALIDATED_MAINTENANCE_RECIPES } from '../lib/host-maintenance-plan.js'
import { POOL_DISK_NAME, POOL_DISK_DRIVER } from '../lib/pool-disk-isolation.js'
import { ensureIsolatedPool } from '../lib/pool-disk-isolation-remote.js'
export { assertOnboardingAuthority } from '../services/onboarding-authority.js'

let timer: ReturnType<typeof setInterval> | undefined
let ticking = false
let stopped = true
const active = new Set<Promise<void>>()
const connections = new Set<Client>()
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export async function claimHostOnboardingNode() {
  return prisma.$transaction(async tx => {
    await lockOnboardingLifecycle(tx)
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM host_onboarding_nodes n
      WHERE deleted_at IS NULL AND (status = 'queued' AND
        (step = 'hardening' OR error_code IS NULL OR error_code NOT IN (${Prisma.join([...ONBOARDING_RETRY_CODES])}) OR
          n.updated_at <= (NOW() AT TIME ZONE 'UTC') -
            (LEAST(300, 15 * POWER(2, LEAST(GREATEST(attempt - 1, 0), 5))) * INTERVAL '1 second')) AND
        (step <> 'hardening' OR EXISTS (SELECT 1 FROM hosts h WHERE h.id = host_id AND
          (h.security_hardening->>'nextCheckAt' IS NULL OR h.security_hardening->>'nextCheckAt' <= ${new Date().toISOString()} OR
            (h.security_hardening->>'status' = 'needs-maintenance' AND
              h.security_hardening->'diagnostic'->>'reason' = 'HARDENING_NATIVE_ACCEPTANCE_REQUIRED' AND
              COALESCE(h.security_hardening->'maintenance'->>'phase', 'aborted') IN ('verified', 'aborted') AND
              CONCAT(CASE h.security_hardening->'environment'->>'bootloader'
                WHEN 'grub' THEN 'alpine-apparmor-grub-v1' WHEN 'extlinux' THEN 'alpine-apparmor-extlinux-v1' ELSE '' END,
                ':', h.security_hardening->'environment'->>'architecture') IN (${Prisma.join([...NATIVE_VALIDATED_MAINTENANCE_RECIPES])})) OR
            (h.security_hardening->>'status' = 'verified' AND h.security_hardening->>'phase' = 'finished' AND
              n.updated_at <= (NOW() AT TIME ZONE 'UTC') - INTERVAL '30 seconds')))) AND
        (error_code IS DISTINCT FROM 'HARDENING_BATCH_PAUSED' OR NOT EXISTS (
          SELECT 1 FROM hosts other WHERE other.id <> n.host_id AND
            other.security_hardening->'maintenance' IS NOT NULL AND
            other.security_hardening->'maintenance' <> 'null'::jsonb AND
            COALESCE(other.security_hardening->'maintenance'->>'phase','') NOT IN ('verified','aborted'))) AND
        (peer_retirement->>'nextAttemptAt' IS NULL OR peer_retirement->>'nextAttemptAt' <= ${new Date().toISOString()})
        OR (status = 'running' AND lease_until < (NOW() AT TIME ZONE 'UTC')))
      ORDER BY CASE WHEN step = 'hardening' AND EXISTS (SELECT 1 FROM hosts h WHERE h.id = host_id AND
        h.security_hardening->'maintenance' IS NOT NULL AND
        COALESCE(h.security_hardening->'maintenance'->>'phase', '') NOT IN ('verified', 'aborted')) THEN 0
        WHEN step = 'hardening' AND EXISTS (SELECT 1 FROM hosts h WHERE h.id = host_id AND
          (h.security_hardening->'maintenance'->>'phase' IN ('verified', 'aborted') OR
            (h.security_hardening->>'status' = 'verified' AND h.security_hardening->>'phase' = 'finished'))) THEN 1 ELSE 2 END,
        created_at ASC, id ASC FOR UPDATE SKIP LOCKED LIMIT 1`
    if (!rows[0]) return null
    const current = await tx.hostOnboardingNode.findUniqueOrThrow({ where: { id: rows[0].id } })
    const claimed = await tx.hostOnboardingNode.update({ where: { id: current.id }, data: {
      status: 'running', leaseToken: randomUUID(), leaseUntil: new Date(Date.now() + 60000),
      attempt: current.status === 'queued' && current.step !== 'hardening' ? { increment: 1 } : undefined,
      startedAt: current.startedAt || new Date(), errorCode: null
    }, include: { batch: true, host: true } })
    return { ...claimed, installerRestartAllowed: current.status === 'queued' && !current.startedAt && !current.errorCode }
  })
}

export const onboardingHardeningDependencies = {
  resume: resumeAutomaticHostMaintenance, harden: hardenExistingHost,
  prepare: prepareAutomaticHostMaintenance, finish: finishSecureOnboarding
}
/** Both first installation and a recovered lease use this same completion
 * path. Finishing consumes the current full receipt, never a partial boot. */
export async function continueHostOnboardingHardening(nodeId: string, leaseToken: string, hostId: number,
  interrupted = () => false, deps = onboardingHardeningDependencies) {
  const lease = { nodeId, leaseToken }
  await deps.resume(hostId, undefined, lease)
  await deps.harden(hostId, undefined, lease)
  await deps.prepare(hostId, undefined, lease)
  if (interrupted()) throw new OnboardingError('WORKER_INTERRUPTED')
  await deps.finish(nodeId, leaseToken, hostId)
}

async function runNode(node: NonNullable<Awaited<ReturnType<typeof claimHostOnboardingNode>>>) {
  let ssh: Client | undefined
  let lostLease = false
  let gatewayStage = false
  let currentStep = node.step
  const where = { id: node.id, leaseToken: node.leaseToken, status: 'running', deletedAt: null }
  const checkpoint = async (step: string, data: Prisma.HostOnboardingNodeUpdateManyMutationInput = {}) => {
    if (stopped || lostLease) throw new OnboardingError('WORKER_INTERRUPTED')
    await assertOnboardingAuthority(node.batch.createdById)
    const changed = await prisma.hostOnboardingNode.updateMany({ where: { ...where, leaseUntil: { gt: new Date() } }, data: { ...data, step, leaseUntil: new Date(Date.now() + (step === 'hardening' ? 600000 : 60000)) } })
    if (!changed.count) throw new OnboardingError('WORKER_INTERRUPTED')
    currentStep = step
  }
  const heartbeat = setInterval(() => {
    assertOnboardingAuthority(node.batch.createdById).then(() => prisma.hostOnboardingNode.updateMany({ where: { ...where, leaseUntil: { gt: new Date() } }, data: { leaseUntil: new Date(Date.now() + (currentStep === 'hardening' ? 600000 : 60000)) } })).then(result => {
      if (!result.count) { lostLease = true; clearInterval(heartbeat); ssh?.destroy() }
    }).catch(() => { lostLease = true; clearInterval(heartbeat); ssh?.destroy() })
  }, 15000)
  const identityReset = node.identityReset as { version?: number; requestId?: string; reason?: string } | null
  const execute = async (client: Client, command: string, input = '', timeoutMs = 30000) => {
    if (stopped || lostLease) throw new OnboardingError('WORKER_INTERRUPTED')
    await assertOnboardingLease(node)
    return sshExec(client, command, input, timeoutMs)
  }
  const inspectCurrentSystem = node.hostId === null && identityReset?.version === 1 && ['retry', 'new'].includes(identityReset.reason || '')
  const connect = async (host: string, credentials: OnboardingCredentials) => {
    if (stopped || lostLease) throw new OnboardingError('WORKER_INTERRUPTED')
    await assertOnboardingAuthority(node.batch.createdById)
    const client = await connectOnboardingSsh({ host, port: node.sshPort, ...credentials }, async fingerprint => {
      const saved = await assertOnboardingLease(node)
      if (stopped || lostLease) return false
      if (saved.sshFingerprint) return saved.sshFingerprint === fingerprint
      const pinned = await prisma.hostOnboardingNode.updateMany({ where: { ...where, leaseUntil: { gt: new Date() }, sshFingerprint: null }, data: { sshFingerprint: fingerprint } })
      return pinned.count === 1
    })
    connections.add(client)
    client.once('close', () => connections.delete(client))
    return client
  }
  try {
    if (node.step === 'hardening' && node.hostId !== null) {
      await checkpoint('hardening')
      await continueHostOnboardingHardening(node.id, node.leaseToken!, node.hostId, () => stopped || lostLease)
      await queueHostGatewayDns(node.batch.createdById, node.id).catch(() => {})
      await createLog(node.batch.createdById, 'host', 'host.onboarding.complete', `Onboarded host "${node.name}" after automatic security verification`, 'success')
      return
    }
    const owner = await prisma.user.findUnique({ where: { id: node.batch.createdById }, select: { role: true, status: true } })
    if (owner?.role !== 'admin' || owner.status !== 'active') throw new OnboardingError('ADMIN_REQUIRED')
    if (!node.credentialsEncrypted || node.credentialsExpireAt < new Date()) throw new OnboardingError('SSH_CREDENTIALS_REQUIRED')
    const credentials = readOnboardingCredentials(node.credentialsEncrypted)
    const defaults = node.batch.defaults as unknown as OnboardingDefaults
    const panelOrigin = onboardingPanelOrigin()
    await checkpoint('checking')
    // Resumed tasks can recover over the management tunnel even if public
    // ports have subsequently been assigned to a customer.
    if (inspectCurrentSystem) {
      ssh = await inspectCurrentOnboardingSystem(node, node.batch.createdById, credentials)
      connections.add(ssh); ssh.once('close', () => connections.delete(ssh!))
      node.resolvedResources = (await prisma.hostOnboardingNode.findUniqueOrThrow({ where: { id: node.id }, select: { resolvedResources: true } })).resolvedResources
    } else {
      try { ssh = await connect(node.managementIp || node.publicIp, credentials) }
      catch (error) {
        if (!node.managementIp) throw error
        ssh = await connect(node.publicIp, credentials)
      }
      await execute(ssh, 'sh -s', preflightScript(node.id))
    }
    await checkpoint('tunnel')
    const prepared = await execute(ssh, 'sh -s', prepareKeyScript(node.id), 600000)
    const osId = prepared.match(/INCUDAL_OS_ID:([a-z]+)/)?.[1]
    if (!osId || !['alpine', 'debian', 'ubuntu'].includes(osId)) throw new OnboardingError('OS_UNSUPPORTED')
    await checkpoint('resources')
    let resources = node.resolvedResources as unknown as ResolvedHostResources | null
    if (!resources) {
      const probeScript = await readFile(fileURLToPath(new URL('../../../scripts/probe-onboarding-resources.py', import.meta.url)), 'utf8')
      const probe = parseResourceProbe(await execute(ssh, 'python3 -', probeScript))
      resources = node.host ? {
        version: 1, detectedAt: new Date().toISOString(), probe, resourcePreset: null,
        cpuAllowanceMax: node.host.cpuAllowanceMax, memoryMax: node.host.memoryMax, storageSize: node.host.storageSize,
        customerDiskGiB: node.host.customerDiskGiB, memoryReserveMiB: probe.memoryMiB - node.host.memoryMax, diskReserveGiB: 4
      } : resolveHostResources(probe, { ...defaults, resourcePreset: node.resourcePreset as OnboardingDefaults['resourcePreset'],
        customerDiskGiB: node.customerDiskGiB ?? defaults.customerDiskGiB })
      await checkpoint('resources', { resolvedResources: resources as unknown as Prisma.InputJsonObject })
    }
    await checkpoint('swap')
    const swapScript = await readFile(fileURLToPath(new URL('../../../scripts/ensure-host-swap.py', import.meta.url)), 'utf8')
    await execute(ssh, 'python3 -', swapScript, 180000)
    const publicKey = prepared.match(/INCUDAL_PUBLIC_KEY:([A-Za-z0-9+/]{43}=)/)?.[1]
    const bindIp = prepared.match(/INCUDAL_BIND_IP:([0-9.]+)/)?.[1]
    if (!publicKey || !bindIp || !isIPv4(bindIp)) throw new OnboardingError('NODE_NETWORK_INVALID')
    // A key can change independently of SSH (for example an interrupted OS
    // restore). Only an explicit, authenticated no-Host inspection can replace it.
    gatewayStage = true
    const gateway = await enrollOnboardingGateway(node, publicKey, inspectCurrentSystem)
    gatewayStage = false
    if (!gateway.managementIp) throw new OnboardingError('GATEWAY_RESPONSE_INVALID')
    await checkpoint('tunnel', { managementIp: gateway.managementIp, nodePublicKey: publicKey })
    await execute(ssh, 'sh -s', wireguardScript(node.id, gateway), 60000)
    // Resolve the stable endpoint independently of the controller/Agent, so a
    // restored co-located controller can reconnect after the DNS A record moves.
    const endpoint = /^(.+):([0-9]+)$/.exec(gateway.endpoint)!
    if (!isIPv4(endpoint[1])) {
      const dnsDirectory = '/root/.incudal-onboarding/' + node.id
      for (const file of ['refresh-host-gateway-endpoint.py', 'install-host-gateway-dns.sh']) {
        const source = await readFile(fileURLToPath(new URL('../../../scripts/' + file, import.meta.url)), 'utf8')
        await execute(ssh, `umask 077; cat > ${q(dnsDirectory + '/' + file)}`, source)
      }
      const binding = { schemaVersion: 1, nodeId: node.id, localPublicKey: publicKey, peerPublicKey: gateway.publicKey,
        localAddress: gateway.managementIp + '/32', allowedIp: gateway.controlIp + '/32', hostname: endpoint[1].toLowerCase(), port: Number(endpoint[2]) }
      await execute(ssh, `bash ${q(dnsDirectory + '/install-host-gateway-dns.sh')}`, JSON.stringify(binding), 60000)
    }
    let management: Client | undefined
    for (let attempt = 0; attempt < 5; attempt++) {
      try { management = await connect(gateway.managementIp, credentials); break } catch { await pause(2000) }
    }
    if (!management) throw new OnboardingError('MANAGEMENT_UNREACHABLE')
    ssh.end(); ssh = management

    let host = node.host
    if (!host) {
      const url = `https://${gateway.managementIp}:8443`
      host = await withHostAddressRegistryLock(async () => {
        const snapshot = await prepareHostAddressSnapshotForWrite(url)
        return prisma.$transaction(async tx => {
          await lockOnboardingAddresses(tx, [node.publicIp])
          await lockOnboardingLifecycle(tx)
          await lockHostGroups(tx)
          const duplicate = await tx.host.findFirst({ where: currentHostAddressWhere(node.publicIp), select: { id: true } })
          if (duplicate) throw new OnboardingError('HOST_ALREADY_REGISTERED')
          // Group edits made while SSH setup runs must be reflected in the new host.
          const currentNode = await assertOnboardingLease(node, tx)
          const groups = await resolveHostGroups(tx, { machineGroupId: currentNode.machineGroupId, regionGroupId: currentNode.regionGroupId })
          const created = await tx.host.create({ data: {
            userId: node.batch.createdById, name: node.name, url, location: node.batch.accountLabel,
            countryCode: node.countryCode || defaults.countryCode, tags: ['oci', node.batch.accountLabel],
            ...groups, singleTenant: true, resourcePreset: resources!.resourcePreset, customerDiskGiB: resources!.customerDiskGiB,
            portProtocol: defaults.portProtocol ?? 'tcp',
            resourceSnapshot: resources as unknown as Prisma.InputJsonObject, architecture: resources!.probe.architecture,
            natPublicIp: node.publicIp, natBindIp: bindIp, ipAddress: node.publicIp, natPortStart: 1, natPortEnd: 65535,
            managementSshHost: gateway.managementIp, managementSshPort: node.sshPort, managementSshUser: 'root',
            ...panelCertificatePaths(), storageDriver: POOL_DISK_DRIVER, storageType: 'loop', storageSize: resources!.storageSize,
            ipv6Mode: 3, enableResourcePool: false, instanceType: 'container', cpuAllowanceMax: resources!.cpuAllowanceMax, memoryMax: resources!.memoryMax,
            installToken: randomUUID(), installTokenExpire: new Date(Date.now() + 24 * 60 * 60 * 1000), certDownloadExpire: new Date(Date.now() + 60 * 60 * 1000)
          } })
          await persistHostAddressSnapshot(created.id, snapshot, 'create', tx)
          const linked = await tx.hostOnboardingNode.updateMany({ where: { ...where, leaseUntil: { gt: new Date() } }, data: { hostId: created.id } })
          if (!linked.count) throw new OnboardingError('WORKER_INTERRUPTED')
          return created
        })
      })
    }
    await checkpoint('installing')
    if (!host.isInstalled) {
      if (!host.installToken || !host.installTokenExpire || host.installTokenExpire < new Date()) {
        // Only an explicit retry may rotate an expired installer session.
        if (!node.installerRestartAllowed || node.attempt < 2) throw new OnboardingError('INSTALL_SESSION_EXPIRED')
        host = await prisma.host.update({ where: { id: host.id }, data: { installToken: randomUUID(), installTokenExpire: new Date(Date.now() + 86400000), certDownloadExpire: new Date(Date.now() + 3600000), certDownloadCount: 0 } })
      }
      await execute(ssh, 'sh -s', installerStartScript(node.id, node.attempt, `${panelOrigin}/api/hosts/install.sh/${host.installToken}`,
        { storageSize: host.storageSize, osId, retryFailedInstall: node.installerRestartAllowed }), 150000)
      const installDeadline = Date.now() + 45 * 60 * 1000
      while (true) {
        await checkpoint('installing')
        if (Date.now() > installDeadline) throw new OnboardingError('INSTALL_TIMEOUT')
        if ((await execute(ssh, 'sh -s', installerPollScript(node.id))).trim() === 'done') break
        await pause(5000)
      }
    }
    await checkpoint('network')
    const networkScript = await readFile(fileURLToPath(new URL('../../../scripts/configure-oci-node-network.sh', import.meta.url)), 'utf8')
    const networkPath = '/root/.incudal-onboarding/' + node.id + '/oci-network.sh'
    await execute(ssh, `umask 077; cat > ${q(networkPath)}`, networkScript)
    await execute(ssh, `bash ${q(networkPath)} --control-ip ${q(gateway.controlIp)} --management-interface incudal-mgmt --ssh-port ${q(node.sshPort)} --api-port 8443 --persist`, '', 180000)
    await checkpoint('verifying')
    host = await prisma.host.findUniqueOrThrow({ where: { id: host.id } })
    // Bootstrap the Incus TLS pin over the already pinned SSH connection.
    const certificatePem = (await execute(ssh, 'cat /var/lib/incus/server.crt')).trim()
    const serverCertificate = new X509Certificate(certificatePem)
    if (host.serverFingerprint && host.serverFingerprint !== serverCertificate.fingerprint256) throw new OnboardingError('TLS_BOOTSTRAP_MISSING')
    const verificationHostId = host.id
    host = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM hosts WHERE id = ${verificationHostId} FOR UPDATE`
      await assertOnboardingLease(node, tx)
      const latest = await tx.host.findUniqueOrThrow({ where: { id: verificationHostId } })
      if (latest.serverFingerprint && latest.serverFingerprint !== serverCertificate.fingerprint256) throw new OnboardingError('TLS_BOOTSTRAP_MISSING')
      return tx.host.update({ where: { id: verificationHostId }, data: { serverCertificate: certificatePem, serverFingerprint: serverCertificate.fingerprint256 } })
    })
    const client = new IncusClient({ id:host.id,url: host.url, ...panelCertificatePaths(), serverCertificate: host.serverCertificate, serverFingerprint: host.serverFingerprint })
    try {
      const info = await client.connect() as { environment?: { kernel_architecture?: string } }
      const architecture = verifyOnboardingArchitecture(info.environment?.kernel_architecture, resources.probe.architecture)
      await client.getResources()
      const poolName = POOL_DISK_NAME
      const registered = await prisma.storagePool.findUnique({ where: { hostId_name: { hostId: host.id, name: poolName } } })
      const pool = await ensureIsolatedPool(client, host.storageSize, registered?.driver === 'btrfs', async () => { await assertOnboardingLease(node) })
      await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM hosts WHERE id = ${host.id} FOR UPDATE`
        await tx.$queryRaw`SELECT id FROM host_onboarding_nodes WHERE id = ${node.id} FOR UPDATE`
        if (stopped || lostLease) throw new OnboardingError('WORKER_INTERRUPTED')
        await assertOnboardingLease(node, tx)
        await tx.storagePool.upsert({ where: { hostId_name: { hostId: host.id, name: poolName } },
          create: { hostId: host.id, name: poolName, driver: pool.driver, purpose: 'instance_data', config: pool.config },
          update: { driver: pool.driver, purpose: 'instance_data', config: pool.config } })
        await tx.host.update({ where: { id: host.id }, data: {
          ...panelCertificatePaths(),
          status: 'online', isInstalled: true, installPending: false, installToken: null, installTokenExpire: null, certDownloadExpire: null,
          architecture, storageDriver: POOL_DISK_DRIVER
        } })
      })
    } finally { await client.close() }
    let agentReady = false
    for (let attempt = 0; attempt < 36; attempt++) {
      await checkpoint('verifying')
      const check = await prisma.host.findUniqueOrThrow({ where: { id: host.id }, include: { agent: true } })
      if (guestProtectionReady(check.agent)&&hostProvisioningToolsReady(check.agent)) { agentReady = true; break }
      await pause(5000)
    }
    if (!agentReady) throw new OnboardingError('AGENT_NOT_READY')
    await checkpoint('hardening')
    await continueHostOnboardingHardening(node.id, node.leaseToken!, host.id, () => stopped || lostLease)
    await queueHostGatewayDns(node.batch.createdById, node.id).catch(() => {})
    await createLog(node.batch.createdById, 'host', 'host.onboarding.complete', `Onboarded host "${node.name}" via management tunnel`, 'success')
  } catch (error) {
    const code = error instanceof Error && /^POOL_DISK_/.test(error.message) ? 'POOL_DISK_ISOLATION_PENDING' : error instanceof OnboardingError ? error.code : error instanceof Error &&
      /^(?:HARDENING_[A-Z_]+|WORKER_INTERRUPTED)$/.test(error.message) ? error.message : 'ONBOARDING_STEP_FAILED'
    // During shutdown, leave the durable job resumable. The detached remote
    // installer keeps running; its PID/exit files prevent duplicate installs.
    if (!stopped && !lostLease && code !== 'WORKER_INTERRUPTED') {
      const current = await prisma.hostOnboardingNode.findUnique({ where: { id: node.id } })
      const hardeningResume = current?.step === 'hardening' && current.hostId !== null && code.startsWith('HARDENING_')
      const retirement = readPeerRetirement(current?.peerRetirement)
      const resumable = gatewayStage && current?.hostId === null && retirement && retirement.attempts < 5 &&
        ['GATEWAY_RETIREMENT_FAILED', 'GATEWAY_RETIREMENT_EXPIRED', 'GATEWAY_RECOVERY_BUSY', 'SSH_CONNECT_FAILED', 'SSH_DISCONNECTED', 'SSH_COMMAND_TIMEOUT'].includes(code)
      const bootstrapResume = !gatewayStage && current && canAutomaticallyResumeOnboarding(current, code)
      const saved = await prisma.hostOnboardingNode.updateMany({ where, data: { status: resumable || hardeningResume || bootstrapResume ? 'queued' : 'failed', errorCode: code,
        completedAt: resumable || hardeningResume || bootstrapResume ? null : new Date(), leaseToken: null, leaseUntil: null,
        ...(resumable ? { peerRetirement: { ...retirement, attempts: retirement.attempts + 1, error: code,
          nextAttemptAt: new Date(Date.now() + Math.min(300000, 15000 * 2 ** retirement.attempts)).toISOString() } as unknown as Prisma.InputJsonValue } : {}) } })
      if (saved.count && hardeningResume) await createLog(node.batch.createdById, 'host', 'host.onboarding.wait',
        `宿主 #${current!.hostId} 接入安全验收：${hardeningReason(code)}。保留原任务自动续接。`, 'warning')
    }
  } finally { clearInterval(heartbeat); ssh?.end() }
}

async function tick() {
  if (ticking || stopped) return
  ticking = true
  try {
    await prisma.hostOnboardingNode.updateMany({ where: { credentialsExpireAt: { lt: new Date() }, credentialsEncrypted: { not: null } }, data: { credentialsEncrypted: null } })
    if (!gatewayConfigured()) return
    const cleanup = processOnboardingRetirements()
    active.add(cleanup)
    try { await cleanup } finally { active.delete(cleanup) }
    while (active.size < 2 && !stopped) {
      const node = await claimHostOnboardingNode()
      if (!node) break
      const work = runNode(node).catch(() => {}).finally(() => active.delete(work))
      active.add(work)
    }
  } finally { ticking = false }
}

export function startHostOnboardingWorker() {
  if (timer) return
  stopped = false
  timer = setInterval(() => { void tick().catch(() => console.error('[Onboarding] Queue poll failed')) }, 3000)
  void tick().catch(() => console.error('[Onboarding] Initial queue poll failed'))
}
export async function stopHostOnboardingWorker() {
  stopped = true
  clearInterval(timer); timer = undefined
  for (const connection of connections) connection.destroy()
  await Promise.allSettled([...active])
}
