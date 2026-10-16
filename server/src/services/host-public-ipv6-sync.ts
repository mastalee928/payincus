import type { Prisma } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { advisoryTransactionLock, advisoryTransactionLockString, INSTANCE_OPERATION_LOCK_NAMESPACE, HOST_PUBLIC_IP_SYNC_LOCK_NAMESPACE } from '../db/advisory-locks.js'
import { getIncusClient } from '../lib/incus/incus-pool.js'
import { dedicatedIpv6Dependencies, reconcileDedicatedIpv6 } from '../lib/incus/dedicated-ipv6.js'
import { dedicatedIpv6State, discoverHostPublicIpv6, publicIpv6State, PublicIpv6SyncError,
  MAX_PUBLIC_IPV6_ADDRESSES, type DedicatedIpv6State } from '../lib/host-public-ipv6.js'
import { ipv6BoundedClient, waitForIpv6Connection } from '../lib/incus/ipv6-deadline.js'
import { HOST_OCCUPIED_INSTANCE_WHERE } from '../lib/host-resource-usage.js'
import { publicIpState } from '../lib/host-public-ip.js'
import { portProtocolView } from './host-port-protocol.js'
import type { IncusClient } from '../lib/incus/incus-client.js'

const include = { onboardingNode: { select: { status: true, managementIp: true } },
  agent: { select: { enabled: true, capabilities: true } } } as const
type SyncHost = Prisma.HostGetPayload<{ include: typeof include }>
export function supportsAutomaticIpv6(host: Pick<SyncHost, 'singleTenant' | 'ipv6Mode' | 'ipv6Subnet' | 'onboardingNode'>): boolean {
  // Routed/shared configurations retain their existing administrator-managed behavior.
  return host.singleTenant && host.ipv6Mode === 3 && !host.ipv6Subnet &&
    host.onboardingNode?.status === 'succeeded' && Boolean(host.onboardingNode.managementIp)
}
export function publicIpv6View(host: Pick<SyncHost, 'publicIpv6Sync' | 'singleTenant' | 'ipv6Mode' | 'ipv6Subnet' | 'onboardingNode'>) {
  return { supported: supportsAutomaticIpv6(host), ...publicIpv6State(host.publicIpv6Sync) }
}
export const publicIpv6SyncDependencies = { connect: getIncusClient, discover: discoverHostPublicIpv6, reconcile: reconcileDedicatedIpv6 }
const inflight = new Map<number, Promise<ReturnType<typeof publicIpv6View>>>()
let timer: ReturnType<typeof setTimeout> | undefined
let scan: Promise<void> | undefined
let stopped = true
const pending = ['PENDING', 'PROCESSING'] as const
const json = (value: unknown) => value as Prisma.InputJsonValue

function requireIpv6Agent(host: SyncHost): void {
  if (!host.agent?.enabled || !Array.isArray(host.agent.capabilities) || !host.agent.capabilities.includes('dedicated-ipv6-v1')) {
    throw new PublicIpv6SyncError('IPV6_AGENT_UPGRADE_REQUIRED')
  }
}

function pendingInstanceState(previous: unknown, hostId: number, name: string, addresses: string[], error: string): DedicatedIpv6State {
  const old = dedicatedIpv6State(previous)
  const same = old?.hostId === hostId && old.instanceName === name
  return { version: 1, hostId, instanceName: name,
    mappings: same ? old.mappings.filter(mapping => addresses.includes(mapping.publicIp)) : [],
    configured: same && old.configured, primary: addresses[0] ?? null, status: 'pending', checkedAt: new Date().toISOString(), error }
}

async function reconcileHost(hostId: number, force: boolean, deps: typeof publicIpv6SyncDependencies) {
  const occupants = await prisma.instance.findMany({ where: { hostId, ...HOST_OCCUPIED_INSTANCE_WHERE }, select: { id: true }, orderBy: { id: 'asc' } })
  return prisma.$transaction(async tx => {
    // Includes lock acquisition. Leave 30s for persistence after network abort;
    // never continue modifying a host after this transaction has expired.
    const signal = AbortSignal.timeout(90000)
    for (const instance of occupants) await advisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, instance.id)
    await advisoryTransactionLockString(tx, HOST_PUBLIC_IP_SYNC_LOCK_NAMESPACE, 'public-ipv6-sync')
    const locked = await tx.$queryRaw<Array<{ id: number }>>`SELECT id FROM hosts WHERE id = ${hostId} FOR UPDATE`
    if (!locked.length) throw new PublicIpv6SyncError('HOST_NOT_FOUND')
    const host = await tx.host.findUniqueOrThrow({ where: { id: hostId }, include })
    if (!supportsAutomaticIpv6(host) || !host.serverCertificate || !host.serverFingerprint) throw new PublicIpv6SyncError('IPV6_SYNC_UNSUPPORTED')
    const state = publicIpv6State(host.publicIpv6Sync)
    state.checkedAt = new Date().toISOString()
    let discovered = false
    const instances = await tx.instance.findMany({ where: { hostId, ...HOST_OCCUPIED_INSTANCE_WHERE }, orderBy: { id: 'asc' } })
    const instance = instances.length === 1 ? instances[0] : undefined
    try {
      signal.throwIfAborted()
      const client = ipv6BoundedClient(await waitForIpv6Connection(deps.connect(host),
        AbortSignal.any([signal, AbortSignal.timeout(15000)])), signal)
      const addresses = await deps.discover(client, state.primary)
      if (addresses.length > MAX_PUBLIC_IPV6_ADDRESSES) throw new PublicIpv6SyncError('IPV6_TOO_MANY_ADDRESSES')
      if (JSON.stringify(addresses) !== JSON.stringify(state.addresses)) state.changedAt = state.checkedAt
      state.addresses = addresses; state.primary = addresses[0] ?? null; discovered = true
      if (instances.length !== occupants.length || instances.some((row, i) => row.id !== occupants[i]?.id) || instances.length > 1) {
        throw new PublicIpv6SyncError('IPV6_INSTANCE_BUSY')
      }
      if (host.poolFaulted) throw new PublicIpv6SyncError('IPV6_HOST_QUARANTINED')
      if (instance) {
        const taskScope = { status: { in: [...pending] }, OR: [{ hostId }, { targetHostId: hostId },
          { replacementState: { path: ['sourceHostId'], equals: hostId } }, { instanceId: instance.id }] }
        if (await tx.instanceTask.count({ where: taskScope }) ||
            await tx.restoreTask.count({ where: { instanceId: instance.id, status: { in: [...pending] } } }) ||
            await tx.backupUploadTask.count({ where: { instanceId: instance.id, status: { in: [...pending] } } })) {
          throw new PublicIpv6SyncError('IPV6_INSTANCE_BUSY')
        }
        if (!instance.dedicatedIpv4 || !instance.dedicatedNetworkReady || instance.provisioningCleanupPending || instance.deletionBillingPending) {
          throw new PublicIpv6SyncError('IPV6_INSTANCE_NOT_READY')
        }
        if (instance.status !== 'running') throw new PublicIpv6SyncError('IPV6_INSTANCE_STOPPED')
        if (portProtocolView(host).status !== 'applied') throw new PublicIpv6SyncError('IPV6_PROTOCOL_PENDING')
        if (addresses.length) requireIpv6Agent(host)
        const remote = await client.request<Array<{ name: string; status: string; project?: string }>>('GET', '/1.0/instances?recursion=1&all-projects=true')
        if (remote.length !== 1 || remote[0]?.name !== instance.incusId || (remote[0].project && remote[0].project !== 'default')) {
          throw new PublicIpv6SyncError('IPV6_REMOTE_INSTANCE_CONFLICT')
        }
        if (remote[0].status !== 'Running') throw new PublicIpv6SyncError('IPV6_INSTANCE_STOPPED')
        if (addresses.length && await tx.host.count({ where: { id: { not: hostId }, OR: addresses.map(address => ({
          publicIpv6Sync: { path: ['addresses'], array_contains: [address] }
        })) } })) throw new PublicIpv6SyncError('IPV6_ALREADY_ASSIGNED')
        const delivery = await deps.reconcile(client, { hostId, instanceId: instance.id, name: instance.incusId,
          addresses, previous: instance.dedicatedIpv6, sshPort: publicIpState(host.publicIpSync).settings.sshPort, force, signal })
        await tx.instance.update({ where: { id: instance.id }, data: { dedicatedIpv6: json(delivery) } })
        state.status = delivery.status === 'ready' || delivery.status === 'none' ? 'synced' : delivery.status
        state.error = delivery.error
      } else {
        state.status = 'synced'; state.error = null
      }
    } catch (error) {
      state.error = signal.aborted ? 'IPV6_SYNC_DEADLINE' : error instanceof PublicIpv6SyncError ? error.code : 'IPV6_MANAGEMENT_UNAVAILABLE'
      state.status = ['IPV6_HOST_QUARANTINED', 'IPV6_INSTANCE_BUSY', 'IPV6_INSTANCE_STOPPED', 'IPV6_INSTANCE_NOT_READY', 'IPV6_PROTOCOL_PENDING', 'IPV6_SYNC_DEADLINE'].includes(state.error) ? 'pending' : 'failed'
      // Only a successful inventory read may retire an address. Offline != removed.
      if (discovered && instance?.dedicatedIpv4) {
        await tx.instance.update({ where: { id: instance.id }, data: { dedicatedIpv6: json(pendingInstanceState(
          instance.dedicatedIpv6, hostId, instance.incusId, state.addresses, state.error)) } })
      }
    }
    const saved = await tx.host.update({ where: { id: hostId }, data: {
      publicIpv6Sync: json(state), ...(discovered ? { natPublicIpv6: state.primary, natBindIpv6: state.primary } : {})
    }, include })
    return publicIpv6View(saved)
  }, { timeout: 120000, maxWait: 10000 })
}

export function syncHostPublicIpv6(hostId: number, options: { force?: boolean } = {}, deps = publicIpv6SyncDependencies) {
  if (inflight.has(hostId)) return inflight.get(hostId)!
  const task = reconcileHost(hostId, options.force === true, deps).finally(() => inflight.delete(hostId))
  inflight.set(hostId, task)
  return task
}

/** Called from a provision/restore task. Cross-host results are returned for its final ownership transaction. */
export async function prepareDedicatedIpv6Delivery(client: IncusClient, instanceId: number, hostId: number, name: string): Promise<DedicatedIpv6State | null> {
  const host = await prisma.host.findUniqueOrThrow({ where: { id: hostId }, include })
  if (!supportsAutomaticIpv6(host)) return null
  const instance = await prisma.instance.findUniqueOrThrow({ where: { id: instanceId } })
  const state = publicIpv6State(host.publicIpv6Sync)
  let delivery: DedicatedIpv6State
  try {
    const signal = AbortSignal.timeout(90000)
    const remote = ipv6BoundedClient(client, signal)
    state.addresses = await discoverHostPublicIpv6(remote, state.primary)
    state.primary = state.addresses[0] ?? null
    if (state.addresses.length) requireIpv6Agent(host)
    delivery = await reconcileDedicatedIpv6(remote, { hostId, instanceId, name, addresses: state.addresses,
      previous: instance.dedicatedIpv6, sshPort: publicIpState(host.publicIpSync).settings.sshPort, signal }, dedicatedIpv6Dependencies)
    state.status = ['none', 'ready'].includes(delivery.status) ? 'synced' : delivery.status as 'pending' | 'failed'
    state.error = delivery.error
  } catch (error) {
    state.status = 'failed'
    state.error = error instanceof PublicIpv6SyncError ? error.code : 'IPV6_MANAGEMENT_UNAVAILABLE'
    delivery = pendingInstanceState(instance.dedicatedIpv6, hostId, name, state.addresses, state.error)
  }
  state.checkedAt = new Date().toISOString()
  await prisma.host.update({ where: { id: hostId }, data: { publicIpv6Sync: json(state), natPublicIpv6: state.primary, natBindIpv6: state.primary } })
  return delivery
}

export async function scanHostPublicIpv6(deps = publicIpv6SyncDependencies): Promise<void> {
  const hosts = await prisma.host.findMany({ where: { singleTenant: true, ipv6Mode: 3, ipv6Subnet: null,
    onboardingNode: { is: { status: 'succeeded' } } }, select: { id: true }, orderBy: { id: 'asc' } })
  for (const host of hosts) {
    try { await syncHostPublicIpv6(host.id, {}, deps) }
    catch { console.warn(`[HostPublicIpv6] Check failed for host #${host.id}; will retry`) }
  }
}
export function startHostPublicIpv6Sync(): void {
  if (!stopped) return
  stopped = false
  const tick = () => {
    scan = scanHostPublicIpv6().catch(() => console.warn('[HostPublicIpv6] Scan failed; will retry')).finally(() => {
      scan = undefined
      if (!stopped) { timer = setTimeout(tick, 60000); timer.unref() }
    })
  }
  timer = setTimeout(tick, 7000); timer.unref()
}
export async function stopHostPublicIpv6Sync(): Promise<void> {
  stopped = true; clearTimeout(timer)
  await scan
  await Promise.allSettled([...inflight.values()])
}
