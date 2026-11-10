import type { Prisma } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { createLog } from '../db/logs.js'
import { advisoryTransactionLock, INSTANCE_OPERATION_LOCK_NAMESPACE } from '../db/advisory-locks.js'
import { getIncusClient } from '../lib/incus/incus-pool.js'
import { execWithOutput } from '../lib/incus/incus-instances.js'
import { ensureDedicatedForward, removeObsoleteDedicatedForwards } from '../lib/incus/dedicated-network.js'
import { HOST_OCCUPIED_INSTANCE_WHERE } from '../lib/host-resource-usage.js'
import { isOnboardingPublicIPv4 } from '../lib/host-onboarding.js'
import { chooseBindAddress, publicIpSettings, publicIpState, publicIpFailureCode, publicIpRetryPolicy, PublicIpSyncError, verifyPublicSshIdentity, type PublicIpSettings } from '../lib/host-public-ip.js'
import { gatewayCommand, gatewayConfigured, type GatewayPeer } from './onboarding-ssh.js'
import { portProtocolView } from './host-port-protocol.js'
import { currentHostAddressWhere, lockOnboardingAddresses } from './onboarding-conflicts.js'
import { hostMaintenanceBlocked } from '../lib/host-maintenance-gate.js'

type Client = Awaited<ReturnType<typeof getIncusClient>>
type Network = { name: string; type: string; managed: boolean }
type NetworkState = { state: string; addresses?: Array<{ family: string; scope: string; address: string }> }
type RemoteInstance = { name: string; status: string; project?: string }
export type PublicIpSyncDependencies = {
  peers: () => Promise<GatewayPeer[]>
  connect: typeof getIncusClient
  fingerprints: (client: Client, name: string) => Promise<string[]>
  verify: typeof verifyPublicSshIdentity
}
const dependencies: PublicIpSyncDependencies = {
  peers: async () => {
    const gateway = await gatewayCommand('peers')
    if (!gateway.peers) throw new PublicIpSyncError('IP_GATEWAY_UPGRADE_REQUIRED')
    return gateway.peers
  },
  connect: host => getIncusClient(host, prisma, 8000),
  fingerprints: async (client, name) => {
    const result = await execWithOutput(client, name, ['sh', '-c',
      'for key in /etc/ssh/ssh_host_ed25519_key.pub /etc/ssh/ssh_host_ecdsa_key.pub /etc/ssh/ssh_host_rsa_key.pub; do [ ! -f "$key" ] || ssh-keygen -lf "$key" -E sha256; done'], {}, 6000)
    return result.stdout.match(/SHA256:[A-Za-z0-9+/]+/g) || []
  },
  verify: verifyPublicSshIdentity
}
const pending = ['PENDING', 'PROCESSING'] as const
const inflight = new Map<number, Promise<PublicIpView>>()
let timer: ReturnType<typeof setTimeout> | undefined
let scan: Promise<void> | undefined
let stopped = true

async function boundedRead<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted()
  let timeout: ReturnType<typeof setTimeout> | undefined
  let abort: (() => void) | undefined
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new PublicIpSyncError('IP_MANAGEMENT_OFFLINE')), 8000)
      if (signal) { abort = () => reject(new PublicIpSyncError('IP_SYNC_DEADLINE')); signal.addEventListener('abort', abort, { once: true }) }
    })])
  } finally { clearTimeout(timeout); if (signal && abort) signal.removeEventListener('abort', abort) }
}

const include = { onboardingNode: { select: { id: true, managementIp: true, status: true, sshFingerprint: true, sshPort: true } } } as const
type SyncHost = Prisma.HostGetPayload<{ include: typeof include }>
export function publicIpView(host: Pick<SyncHost, 'id' | 'natPublicIp' | 'natBindIp' | 'publicIpSync' | 'publicIpSyncBlocked' | 'singleTenant'> & {
  onboardingNode?: { status?: string; managementIp?: string | null } | null
}) {
  return { hostId: host.id, supported: host.singleTenant && host.onboardingNode?.status === 'succeeded' && Boolean(host.onboardingNode.managementIp),
    currentIp: publicIpState(host.publicIpSync).observedIp || host.natPublicIp, confirmedIp: host.natPublicIp,
    currentBindIp: host.natBindIp, blocked: host.publicIpSyncBlocked,
    ...publicIpState(host.publicIpSync) }
}
export type PublicIpView = ReturnType<typeof publicIpView>

export async function getPublicIpSync(hostId: number): Promise<PublicIpView> {
  const host = await prisma.host.findUnique({ where: { id: hostId }, include })
  if (!host) throw new PublicIpSyncError('HOST_NOT_FOUND')
  return publicIpView(host)
}

async function reconcile(hostId: number, settings: PublicIpSettings | undefined, actorId: number | undefined,
  force: boolean, deps: PublicIpSyncDependencies, peers?: GatewayPeer[]): Promise<PublicIpView> {
  // The instance operation lock must precede the host row lock, as in replacement.
  const occupants = await prisma.instance.findMany({ where: { hostId, ...HOST_OCCUPIED_INSTANCE_WHERE }, select: { id: true }, orderBy: { id: 'asc' } })
  let peerError: string | null = null
  if (!peers) {
    try { peers = await boundedRead(deps.peers()) }
    catch (error) { peerError = error instanceof PublicIpSyncError ? error.code : 'IP_GATEWAY_UNAVAILABLE' }
  }
  const before = await prisma.host.findUnique({ where: { id: hostId }, include })
  if (!before) throw new PublicIpSyncError('HOST_NOT_FOUND')
  const selectedSettings = settings || publicIpState(before.publicIpSync).settings
  const selectedPeer = peers?.find(peer => peer.nodeId === before.onboardingNode?.id && peer.managementIp === before.onboardingNode?.managementIp)
  const selectedIp = selectedSettings.mode === 'manual' ? selectedSettings.publicIp : selectedPeer?.publicIp
  const result = await prisma.$transaction(async tx => {
    const signal = AbortSignal.timeout(45000)
    await tx.$executeRaw`SET LOCAL lock_timeout = '8s'`
    for (const instance of occupants) await advisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, instance.id)
    // Only contenders for the same address serialize; slow hosts do not lock all hosts.
    if (isOnboardingPublicIPv4(selectedIp)) await lockOnboardingAddresses(tx, [selectedIp])
    const locked = await tx.$queryRaw<Array<{ id: number }>>`SELECT id FROM hosts WHERE id = ${hostId} FOR UPDATE`
    if (!locked.length) throw new PublicIpSyncError('HOST_NOT_FOUND')
    const host = await tx.host.findUniqueOrThrow({ where: { id: hostId }, include })
    // Registration and this reconciliation share the host row lock. Preserve
    // the prior address/protection during the planned reboot, including if a
    // scan read its peer snapshot before maintenance was registered. Otherwise
    // temporary SSH loss creates an IP fence that prevents customer recovery.
    if(hostMaintenanceBlocked(host.securityHardening)) {
      if(settings)throw new PublicIpSyncError('IP_SYNC_BUSY')
      return {view:publicIpView(host),changed:false,stateChanged:false,previousIp:host.natPublicIp,actorId:actorId??host.userId}
    }
    if (!publicIpView(host).supported || !host.serverCertificate || !host.serverFingerprint) throw new PublicIpSyncError('IP_SYNC_UNSUPPORTED')
    const node = host.onboardingNode!
    const state = publicIpState(host.publicIpSync)
    const previousState = publicIpState(host.publicIpSync)
    if (settings) state.settings = settings
    state.checkedAt = new Date().toISOString()
    state.error = null
    let blocked = host.publicIpSyncBlocked
    let changed = false
    let appliedIp = host.natPublicIp, appliedBind = host.natBindIp
    try {
      if (peerError) { blocked = true; throw new PublicIpSyncError(peerError) }
      const peer = peers?.find(peer => peer.nodeId === node.id && peer.managementIp === node.managementIp)
      if (!peer || peer.lastHandshakeAt < Date.now() / 1000 - 180 || peer.lastHandshakeAt > Date.now() / 1000 + 30) { blocked = true; throw new PublicIpSyncError('IP_MANAGEMENT_OFFLINE') }
      const candidate = state.settings.mode === 'manual' ? state.settings.publicIp : peer.publicIp
      if (!isOnboardingPublicIPv4(candidate)) { blocked = true; throw new PublicIpSyncError('IP_PUBLIC_UNDETECTED') }
      if (candidate !== selectedIp) throw new PublicIpSyncError('IP_SYNC_BUSY')
      state.candidateIp = candidate
      blocked ||= candidate !== host.natPublicIp
      const instances = await tx.instance.findMany({ where: { hostId, ...HOST_OCCUPIED_INSTANCE_WHERE }, orderBy: { id: 'asc' } })
      if (instances.length !== occupants.length || instances.some((instance, i) => instance.id !== occupants[i]?.id) || instances.length > 1) throw new PublicIpSyncError('IP_INSTANCE_BUSY')
      const instance = instances[0]
      const taskScope = { status: { in: [...pending] }, OR: [
        { hostId }, { targetHostId: hostId }, { replacementState: { path: ['sourceHostId'], equals: hostId } },
        ...(instance ? [{ instanceId: instance.id }] : [])
      ] }
      const client = await boundedRead(deps.connect(host), signal)
      // Abort the HTTP request rather than abandoning its promise. Owned writes
      // are idempotent, so a lost response can be checked again on the next pass.
      const remote: Pick<Client, 'request'> = {
        request: (method, path, body = null, timeout = 8000, requestSignal, conditions) => {
          signal.throwIfAborted()
          const limit = Math.max(1, Math.min(timeout, 8000))
          return client.request(method, path, body, limit,
            AbortSignal.any([signal, AbortSignal.timeout(limit), ...(requestSignal ? [requestSignal] : [])]), conditions)
        }
      }
      const networks = await remote.request<Network[]>('GET', '/1.0/networks?recursion=1')
      const physical = networks.filter(network => !network.managed && network.type === 'physical')
      if (!physical.length || physical.length > 8) throw new PublicIpSyncError('IP_BIND_AMBIGUOUS')
      const states = await Promise.all(physical.map(network => remote.request<NetworkState>('GET', `/1.0/networks/${encodeURIComponent(network.name)}/state`)))
      state.bindAddresses = [...new Set(states.filter(network => network.state === 'up').flatMap(network =>
        (network.addresses || []).filter(address => address.family === 'inet' && address.scope === 'global' && address.address !== node.managementIp).map(address => address.address)))]
      if (await tx.host.count({ where: { id: { not: hostId }, ...currentHostAddressWhere(candidate) } }) ||
          await tx.hostOnboardingNode.count({ where: { id: { not: node.id }, activePublicIp: candidate } })) throw new PublicIpSyncError('IP_ALREADY_ASSIGNED')
      // TLS-pinned management confirms this host's authenticated endpoint. Keep
      // ingress confirmation separate, including when the guest is stopped.
      if (state.settings.mode === 'auto') state.observedIp = candidate
      state.managementCheckedAt = new Date().toISOString()
      blocked ||= !host.natBindIp || !state.bindAddresses.includes(host.natBindIp)
      const bind = chooseBindAddress(state.bindAddresses, host.natBindIp, state.settings.bindIp, candidate)
      state.candidateBindIp = bind
      blocked ||= bind !== host.natBindIp
      changed = candidate !== host.natPublicIp || bind !== host.natBindIp
      if (host.poolFaulted) throw new PublicIpSyncError('IP_HOST_QUARANTINED')
      if (await tx.instanceTask.count({ where: taskScope }) ||
          (instance && (await tx.restoreTask.count({ where: { instanceId: instance.id, status: { in: [...pending] } } }) ||
          await tx.backupUploadTask.count({ where: { instanceId: instance.id, status: { in: [...pending] } } })))) throw new PublicIpSyncError('IP_INSTANCE_BUSY')
      if (instance && (!instance.dedicatedIpv4 || !instance.dedicatedNetworkReady || instance.provisioningCleanupPending || instance.deletionBillingPending)) throw new PublicIpSyncError('IP_INSTANCE_NOT_READY')
      if (changed || blocked || force || state.status !== 'synced') {
        const remoteInstances = await remote.request<RemoteInstance[]>('GET', '/1.0/instances?recursion=1&all-projects=true')
        if (remoteInstances.some(row => !instance || row.name !== instance.incusId || (row.project && row.project !== 'default')) ||
            (instance && remoteInstances.length !== 1)) throw new PublicIpSyncError('IP_REMOTE_INSTANCE_CONFLICT')
        if (instance && (instance.status !== 'running' || remoteInstances[0]?.status !== 'Running')) throw new PublicIpSyncError('IP_INSTANCE_STOPPED')
        if (portProtocolView(host).status !== 'applied') throw new PublicIpSyncError('IP_PROTOCOL_PENDING')
        let fingerprints: string[]
        if (instance) {
          if (!instance.ipv4) throw new PublicIpSyncError('IP_INSTANCE_NOT_READY')
          const fingerprintClient = Object.assign(Object.create(client), remote, { readFile: (path: string, readSignal?: AbortSignal) => {
            signal.throwIfAborted()
            return client.readFile(path, readSignal ? AbortSignal.any([signal, readSignal]) : signal)
          } }) as Client
          fingerprints = await boundedRead(deps.fingerprints(fingerprintClient, instance.incusId), signal)
          if (!fingerprints.length) throw new PublicIpSyncError('IP_IDENTITY_UNAVAILABLE')
          await ensureDedicatedForward(remote, instance.incusId, bind, instance.ipv4)
        } else {
          fingerprints = node.sshFingerprint ? [node.sshFingerprint] : []
          const forwards = await remote.request<unknown[]>('GET', '/1.0/networks/incusbr0/forwards?recursion=1')
          if (forwards.length) throw new PublicIpSyncError('IP_REMOTE_INSTANCE_CONFLICT')
        }
        await boundedRead(deps.verify(candidate, instance ? state.settings.sshPort : node.sshPort, fingerprints, 8000, signal), signal)
        state.verifiedAt = new Date().toISOString()
        if (instance) await removeObsoleteDedicatedForwards(remote, instance.incusId, bind, instance.ipv4!)
      }
      appliedIp = candidate; appliedBind = bind
      if (changed) { state.previousIp = host.natPublicIp; state.changedAt = new Date().toISOString() }
      state.observedIp = candidate
      state.status = 'synced'; state.retryAttempts = 0; blocked = false
    } catch (error) {
      blocked = true
      state.error = signal.aborted ? 'IP_SYNC_DEADLINE' : publicIpFailureCode(error)
      state.retryAttempts = !settings && previousState.error === state.error && previousState.candidateIp === state.candidateIp
        ? Math.min(previousState.retryAttempts + 1, 1000000) : 1
      state.status = publicIpRetryPolicy(state.error, state.retryAttempts).status
      changed = false
    }
    state.nextCheckAt = new Date(Date.now() + (state.error ? publicIpRetryPolicy(state.error, state.retryAttempts).delayMs : 60000)).toISOString()
    const saved = await tx.host.update({ where: { id: hostId }, data: {
      publicIpSync: state as unknown as Prisma.InputJsonValue, publicIpSyncBlocked: blocked,
      ...(state.status === 'synced' ? { natPublicIp: appliedIp, natBindIp: appliedBind, ipAddress: appliedIp } : {})
    }, include })
    return { view: publicIpView(saved), changed, stateChanged: publicIpState(host.publicIpSync).error !== state.error || publicIpState(host.publicIpSync).observedIp !== state.observedIp,
      previousIp: host.natPublicIp, actorId: actorId ?? host.userId }
  }, { timeout: 75000, maxWait: 10000 })
  if (result.changed) await createLog(result.actorId, 'host', 'host.public_ip.synced',
    `Host #${hostId} public IPv4 verified and updated: ${result.previousIp} -> ${result.view.currentIp}; management address and customer instance retained`, 'success')
  else if (result.stateChanged) await createLog(result.actorId, 'host', 'host.public_ip.observed',
    `Host #${hostId}: observed IPv4 ${result.view.observedIp || 'unavailable'}; ingress ${result.view.status}; reason ${result.view.error || 'none'}; next check ${result.view.nextCheckAt}; instance and management identity retained`, 'warning')
  return result.view
}

export function syncHostPublicIp(hostId: number, options: { settings?: unknown; actorId?: number; force?: boolean; peers?: GatewayPeer[] } = {}, deps = dependencies): Promise<PublicIpView> {
  if (inflight.has(hostId)) {
    if (options.settings !== undefined) return Promise.reject(new PublicIpSyncError('IP_SYNC_BUSY'))
    return inflight.get(hostId)!
  }
  const settings = options.settings === undefined ? undefined : publicIpSettings(options.settings)
  const task = reconcile(hostId, settings, options.actorId, options.force === true, deps, options.peers).finally(() => { inflight.delete(hostId) })
  inflight.set(hostId, task)
  return task
}

export async function scanHostPublicIps(deps = dependencies, continueScan = () => true): Promise<void> {
  const all = await prisma.host.findMany({ where: { singleTenant: true, onboardingNode: { is: { status: 'succeeded' } } }, select: { id: true, publicIpSync: true }, orderBy: { id: 'asc' } })
  const dueAt = (value: unknown) => Date.parse(publicIpState(value).nextCheckAt || '') || 0
  const hosts = all.filter(host => dueAt(host.publicIpSync) <= Date.now()).sort((a, b) => dueAt(a.publicIpSync) - dueAt(b.publicIpSync))
  if (!hosts.length) return
  let index = 0, snapshot: GatewayPeer[] | undefined, readAt = 0, reading: Promise<GatewayPeer[]> | undefined
  const scanDeps = { ...deps, peers: async () => {
    if (snapshot && Date.now() - readAt < 30000) return snapshot
    reading ||= boundedRead(deps.peers()).then(peers => { snapshot = peers; readAt = Date.now(); return peers }).finally(() => { reading = undefined })
    return reading
  } }
  await Promise.all(Array.from({ length: Math.min(4, hosts.length) }, async () => {
    while (index < hosts.length && continueScan()) {
      const host = hosts[index++]!
      try { await syncHostPublicIp(host.id, {}, scanDeps) }
      catch { console.warn(`[HostPublicIp] Check failed for host #${host.id}; will retry`) }
    }
  }))
}

export function startHostPublicIpSync(): void {
  if (!stopped || !gatewayConfigured()) return
  stopped = false
  const tick = () => {
    scan = scanHostPublicIps(dependencies, () => !stopped).catch(() => { console.warn('[HostPublicIp] Scan failed; will retry') }).finally(() => {
      scan = undefined
      if (!stopped) { timer = setTimeout(tick, 5000); timer.unref() }
    })
  }
  timer = setTimeout(tick, 5000); timer.unref()
}

export async function stopHostPublicIpSync(): Promise<void> {
  stopped = true; clearTimeout(timer)
  await scan
  await Promise.allSettled([...inflight.values()])
}
