import type { Prisma } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { createLog } from '../db/logs.js'
import { advisoryTransactionLock, advisoryTransactionLockString, INSTANCE_OPERATION_LOCK_NAMESPACE, HOST_PUBLIC_IP_SYNC_LOCK_NAMESPACE } from '../db/advisory-locks.js'
import { getIncusClient } from '../lib/incus/incus-pool.js'
import { execWithOutput } from '../lib/incus/incus-instances.js'
import { ensureDedicatedForward, removeObsoleteDedicatedForwards } from '../lib/incus/dedicated-network.js'
import { HOST_OCCUPIED_INSTANCE_WHERE } from '../lib/host-resource-usage.js'
import { isOnboardingPublicIPv4 } from '../lib/host-onboarding.js'
import { chooseBindAddress, publicIpSettings, publicIpState, PublicIpSyncError, verifyPublicSshIdentity, type PublicIpSettings } from '../lib/host-public-ip.js'
import { gatewayCommand, gatewayConfigured, type GatewayPeer } from './onboarding-ssh.js'
import { portProtocolView } from './host-port-protocol.js'

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
  connect: getIncusClient,
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

async function boundedRead<T>(promise: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new PublicIpSyncError('IP_MANAGEMENT_OFFLINE')), 8000)
    })])
  } finally { clearTimeout(timeout) }
}

const include = { onboardingNode: { select: { id: true, managementIp: true, status: true, sshFingerprint: true, sshPort: true } } } as const
type SyncHost = Prisma.HostGetPayload<{ include: typeof include }>
export function publicIpView(host: Pick<SyncHost, 'id' | 'natPublicIp' | 'natBindIp' | 'publicIpSync' | 'publicIpSyncBlocked' | 'singleTenant'> & {
  onboardingNode?: { status?: string; managementIp?: string | null } | null
}) {
  return { hostId: host.id, supported: host.singleTenant && host.onboardingNode?.status === 'succeeded' && Boolean(host.onboardingNode.managementIp),
    currentIp: host.natPublicIp, currentBindIp: host.natBindIp, blocked: host.publicIpSyncBlocked,
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
    try { peers = await deps.peers() }
    catch (error) { peerError = error instanceof PublicIpSyncError ? error.code : 'IP_GATEWAY_UNAVAILABLE' }
  }
  const result = await prisma.$transaction(async tx => {
    for (const instance of occupants) await advisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, instance.id)
    // Shared with every reconciliation so two hosts cannot claim the same address.
    await advisoryTransactionLockString(tx, HOST_PUBLIC_IP_SYNC_LOCK_NAMESPACE, 'public-ip-sync')
    const locked = await tx.$queryRaw<Array<{ id: number }>>`SELECT id FROM hosts WHERE id = ${hostId} FOR UPDATE`
    if (!locked.length) throw new PublicIpSyncError('HOST_NOT_FOUND')
    const host = await tx.host.findUniqueOrThrow({ where: { id: hostId }, include })
    if (!publicIpView(host).supported || !host.serverCertificate || !host.serverFingerprint) throw new PublicIpSyncError('IP_SYNC_UNSUPPORTED')
    const node = host.onboardingNode!
    const state = publicIpState(host.publicIpSync)
    if (settings) state.settings = settings
    state.checkedAt = new Date().toISOString()
    state.error = null
    let blocked = host.publicIpSyncBlocked
    let changed = false
    let appliedIp = host.natPublicIp, appliedBind = host.natBindIp
    try {
      if (peerError) throw new PublicIpSyncError(peerError)
      const peer = peers?.find(peer => peer.nodeId === node.id && peer.managementIp === node.managementIp)
      if (!peer || peer.lastHandshakeAt < Date.now() / 1000 - 180 || peer.lastHandshakeAt > Date.now() / 1000 + 30) throw new PublicIpSyncError('IP_MANAGEMENT_OFFLINE')
      const candidate = state.settings.mode === 'manual' ? state.settings.publicIp : peer.publicIp
      if (!isOnboardingPublicIPv4(candidate)) throw new PublicIpSyncError('IP_PUBLIC_UNDETECTED')
      state.candidateIp = candidate
      blocked ||= candidate !== host.natPublicIp
      const instances = await tx.instance.findMany({ where: { hostId, ...HOST_OCCUPIED_INSTANCE_WHERE }, orderBy: { id: 'asc' } })
      if (instances.length !== occupants.length || instances.some((instance, i) => instance.id !== occupants[i]?.id) || instances.length > 1) throw new PublicIpSyncError('IP_INSTANCE_BUSY')
      const instance = instances[0]
      const taskScope = { status: { in: [...pending] }, OR: [
        { hostId }, { targetHostId: hostId }, { replacementState: { path: ['sourceHostId'], equals: hostId } },
        ...(instance ? [{ instanceId: instance.id }] : [])
      ] }
      if (host.poolFaulted) throw new PublicIpSyncError('IP_HOST_QUARANTINED')
      if (await tx.instanceTask.count({ where: taskScope }) ||
          (instance && (await tx.restoreTask.count({ where: { instanceId: instance.id, status: { in: [...pending] } } }) ||
          await tx.backupUploadTask.count({ where: { instanceId: instance.id, status: { in: [...pending] } } })))) throw new PublicIpSyncError('IP_INSTANCE_BUSY')
      if (instance && (!instance.dedicatedIpv4 || !instance.dedicatedNetworkReady || instance.provisioningCleanupPending || instance.deletionBillingPending)) throw new PublicIpSyncError('IP_INSTANCE_NOT_READY')
      const client = await boundedRead(deps.connect(host))
      // Abort the HTTP request rather than abandoning its promise. Owned writes
      // are idempotent, so a lost response can be checked again on the next pass.
      const remote: Pick<Client, 'request'> = {
        request: (method, path, body = null) => client.request(method, path, body, 8000, AbortSignal.timeout(8000))
      }
      const networks = await remote.request<Network[]>('GET', '/1.0/networks?recursion=1')
      const physical = networks.filter(network => !network.managed && network.type === 'physical')
      if (!physical.length || physical.length > 8) throw new PublicIpSyncError('IP_BIND_AMBIGUOUS')
      const states = await Promise.all(physical.map(network => remote.request<NetworkState>('GET', `/1.0/networks/${encodeURIComponent(network.name)}/state`)))
      state.bindAddresses = [...new Set(states.filter(network => network.state === 'up').flatMap(network =>
        (network.addresses || []).filter(address => address.family === 'inet' && address.scope === 'global' && address.address !== node.managementIp).map(address => address.address)))]
      blocked ||= !host.natBindIp || !state.bindAddresses.includes(host.natBindIp)
      const bind = chooseBindAddress(state.bindAddresses, host.natBindIp, state.settings.bindIp)
      state.candidateBindIp = bind
      blocked ||= bind !== host.natBindIp
      changed = candidate !== host.natPublicIp || bind !== host.natBindIp
      if (changed || blocked || force || state.status !== 'synced') {
        if (await tx.host.count({ where: { id: { not: hostId }, natPublicIp: candidate } })) throw new PublicIpSyncError('IP_ALREADY_ASSIGNED')
        const remoteInstances = await remote.request<RemoteInstance[]>('GET', '/1.0/instances?recursion=1&all-projects=true')
        if (remoteInstances.some(row => !instance || row.name !== instance.incusId || (row.project && row.project !== 'default')) ||
            (instance && remoteInstances.length !== 1)) throw new PublicIpSyncError('IP_REMOTE_INSTANCE_CONFLICT')
        if (instance && (instance.status !== 'running' || remoteInstances[0]?.status !== 'Running')) throw new PublicIpSyncError('IP_INSTANCE_STOPPED')
        if (portProtocolView(host).status !== 'applied') throw new PublicIpSyncError('IP_PROTOCOL_PENDING')
        let fingerprints: string[]
        if (instance) {
          if (!instance.ipv4) throw new PublicIpSyncError('IP_INSTANCE_NOT_READY')
          fingerprints = await boundedRead(deps.fingerprints(client, instance.incusId))
          if (!fingerprints.length) throw new PublicIpSyncError('IP_IDENTITY_UNAVAILABLE')
          await ensureDedicatedForward(remote, instance.incusId, bind, instance.ipv4)
        } else {
          fingerprints = node.sshFingerprint ? [node.sshFingerprint] : []
          const forwards = await remote.request<unknown[]>('GET', '/1.0/networks/incusbr0/forwards?recursion=1')
          if (forwards.length) throw new PublicIpSyncError('IP_REMOTE_INSTANCE_CONFLICT')
        }
        await deps.verify(candidate, instance ? state.settings.sshPort : node.sshPort, fingerprints)
        if (instance) await removeObsoleteDedicatedForwards(remote, instance.incusId, bind, instance.ipv4!)
      }
      appliedIp = candidate; appliedBind = bind
      if (changed) { state.previousIp = host.natPublicIp; state.changedAt = new Date().toISOString() }
      state.status = 'synced'; blocked = false
    } catch (error) {
      state.error = error instanceof PublicIpSyncError ? error.code : 'IP_CHECK_FAILED'
      state.status = ['IP_MANAGEMENT_OFFLINE', 'IP_INSTANCE_BUSY', 'IP_INSTANCE_STOPPED', 'IP_PROTOCOL_PENDING', 'IP_HOST_QUARANTINED', 'IP_INSTANCE_NOT_READY'].includes(state.error) ? 'pending' : 'failed'
      changed = false
    }
    const saved = await tx.host.update({ where: { id: hostId }, data: {
      publicIpSync: state as unknown as Prisma.InputJsonValue, publicIpSyncBlocked: blocked,
      ...(state.status === 'synced' ? { natPublicIp: appliedIp, natBindIp: appliedBind, ipAddress: appliedIp } : {})
    }, include })
    return { view: publicIpView(saved), changed, previousIp: host.natPublicIp, actorId: actorId ?? host.userId }
  }, { timeout: 120000, maxWait: 10000 })
  if (result.changed) await createLog(result.actorId, 'host', 'host.public_ip.synced',
    `Host #${hostId} public IPv4 verified and updated: ${result.previousIp} -> ${result.view.currentIp}; management address and customer instance retained`, 'success')
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

export async function scanHostPublicIps(deps = dependencies): Promise<void> {
  const hosts = await prisma.host.findMany({ where: { singleTenant: true, onboardingNode: { is: { status: 'succeeded' } } }, select: { id: true }, orderBy: { id: 'asc' } })
  if (!hosts.length) return
  let peers: GatewayPeer[] | undefined
  try { peers = await deps.peers() } catch { /* Persist a visible retry state per host. */ }
  for (const host of hosts) {
    try { await syncHostPublicIp(host.id, { peers }, deps) }
    catch { console.warn(`[HostPublicIp] Check failed for host #${host.id}; will retry`) }
  }
}

export function startHostPublicIpSync(): void {
  if (!stopped || !gatewayConfigured()) return
  stopped = false
  const tick = () => {
    scan = scanHostPublicIps().catch(() => { console.warn('[HostPublicIp] Scan failed; will retry') }).finally(() => {
      scan = undefined
      if (!stopped) { timer = setTimeout(tick, 60000); timer.unref() }
    })
  }
  timer = setTimeout(tick, 5000); timer.unref()
}

export async function stopHostPublicIpSync(): Promise<void> {
  stopped = true; clearTimeout(timer)
  await scan
  await Promise.allSettled([...inflight.values()])
}
