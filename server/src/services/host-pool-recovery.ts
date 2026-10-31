import { createHash } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { createLog } from '../db/logs.js'
import { HOST_OCCUPIED_INSTANCE_WHERE } from '../lib/host-resource-usage.js'
import { poolCapacityReady } from '../lib/pool-stock.js'
import { getIncusClient } from '../lib/incus/incus-pool.js'
import type { IncusRequestConditions } from '../lib/incus/incus-client.js'
import { removeDedicatedForward } from '../lib/incus/dedicated-network.js'
import { portProtocolView, PORT_PROTOCOL_CAPABILITY } from './host-port-protocol.js'
import { dedicatedIpv6State, normalizeIpv6 } from '../lib/host-public-ipv6.js'

type Db = Prisma.TransactionClient | typeof prisma
type Client = Pick<Awaited<ReturnType<typeof getIncusClient>>, 'request'>
type Connect = typeof getIncusClient
type RemoteInstance = { name: string; status: string; created_at?: string; project?: string }
type Forward = { listen_address: string; description: string; config: Record<string, string>; ports?: Array<{ protocol: string; listen_port: string; target_address?: string; target_port?: string; snat?: boolean }> }
type Residue = { name: string; status: string; removable: boolean }

export type RecoveryBlocker = 'not-quarantined' | 'assigned' | 'busy' | 'offline' | 'agent-offline' |
  'not-ready' | 'protocol-pending' | 'capacity' | 'unreachable' | 'projects' | 'unknown-instance' |
  'running-instance' | 'unknown-forward' | 'volumes' | 'assigned-mismatch' | 'assigned-not-ready'
export interface HostRecoveryReport {
  hostId: number
  quarantined: boolean
  checkedAt: string
  blockers: RecoveryBlocker[]
  instances: Residue[]
  forwardCount: number
  needsCleanup: boolean
  canRecover: boolean
  confirmation: string
  mode: 'empty' | 'preserve'
}
export class HostRecoveryError extends Error {
  constructor(public code: string, public report?: HostRecoveryReport) { super(code) }
}

const pending = ['PENDING', 'PROCESSING'] as const
const hostSelect = {
  id: true, url: true, certPath: true, keyPath: true, status: true, poolFaulted: true,
  singleTenant: true, isInstalled: true, instanceType: true, natPublicIp: true, natBindIp: true,
  portProtocol: true, portProtocolRevision: true, portProtocolApplied: true, portProtocolAppliedRevision: true, portProtocolError: true,
  resourcePreset: true, customerDiskGiB: true, architecture: true, cpuAllowanceMax: true,
  memoryMax: true, storageSize: true, cpuUsed: true, memoryUsed: true, diskUsed: true,
  natPortStart: true, natPortEnd: true, natPortsUsedCount: true,
  agent: { select: { enabled: true, lastSeenAt: true, capabilities: true } },
  onboardingNode: { select: { status: true } },
  storagePools: { select: { name: true, purpose: true } }
} as const

function recoveryScope() {
  // Start before audit, connection acquisition and row locks, not after them.
  const deadline = Date.now() + 60000
  const controller = new AbortController()
  const expired = () => new HostRecoveryError('HOST_RECOVERY_UNREACHABLE')
  const timer = setTimeout(() => controller.abort(expired()), 60000)
  const remaining = () => {
    const milliseconds = deadline - Date.now()
    if (milliseconds <= 0) controller.abort(expired())
    controller.signal.throwIfAborted()
    return milliseconds
  }
  async function run<T>(action: () => PromiseLike<T>, limit = remaining()): Promise<T> {
    const budget = Math.min(limit, remaining())
    let onAbort!: () => void
    const operationTimer = setTimeout(() => controller.abort(expired()), budget)
    try {
      const cancelled = new Promise<never>((_, reject) => {
        onAbort = () => reject(controller.signal.reason)
        controller.signal.addEventListener('abort', onAbort, { once: true })
      })
      const result = await Promise.race([action(), cancelled])
      remaining() // A transport that ignores cancellation cannot advance cleanup.
      return result
    } finally {
      clearTimeout(operationTimer)
      controller.signal.removeEventListener('abort', onAbort)
    }
  }
  return {
    remaining, run,
    client(original: Client): Client {
      return { request<T = unknown>(method: string, path: string, body: unknown = null,
        timeout = 8000, signal?: AbortSignal, conditions?: IncusRequestConditions): Promise<T> {
        const budget = Math.min(8000, timeout, remaining())
        const requestSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
        requestSignal.throwIfAborted()
        return run(() => original.request<T>(method, path, body, budget, requestSignal, conditions), budget)
      } }
    },
    close() {
      controller.abort(expired())
      clearTimeout(timer)
    }
  }
}

async function inspect(db: Db, hostId: number, connect: Connect, scope: ReturnType<typeof recoveryScope>) {
  scope.remaining()
  const host = await db.host.findUnique({ where: { id: hostId }, select: hostSelect })
  if (!host) throw new HostRecoveryError('HOST_NOT_FOUND')
  const blockers = new Set<RecoveryBlocker>()
  if (!host.poolFaulted) blockers.add('not-quarantined')
  if (host.status !== 'online') blockers.add('offline')
  if (!host.agent?.enabled || !host.agent.lastSeenAt || host.agent.lastSeenAt.getTime() < Date.now() - 90000) blockers.add('agent-offline')
  if (!host.singleTenant || !host.isInstalled || !['container', 'both'].includes(host.instanceType) ||
      !host.natPublicIp || !host.natBindIp || !host.storagePools.some(pool => pool.purpose === 'instance_data') ||
      (host.onboardingNode && host.onboardingNode.status !== 'succeeded') ||
      !Array.isArray(host.agent?.capabilities) || !host.agent.capabilities.includes(PORT_PROTOCOL_CAPABILITY)) blockers.add('not-ready')
  if (portProtocolView(host).status !== 'applied') blockers.add('protocol-pending')
  // Old resource counters are corrected only after remote emptiness is verified.
  if (!poolCapacityReady({ ...host, cpuUsed: 0, memoryUsed: 0, diskUsed: 0 })) blockers.add('capacity')
  const [assignedInstances, tasks, onboarding, history] = await Promise.all([
    db.instance.findMany({ where: { hostId, ...HOST_OCCUPIED_INSTANCE_WHERE }, select: {
      id: true, incusId: true, status: true, dedicatedIpv4: true, dedicatedNetworkReady: true, dedicatedIpv6: true,
      ipv4: true, cpu: true, memory: true, disk: true, provisioningCleanupPending: true, deletionBillingPending: true,
      storagePoolName: true, userId: true
    }, orderBy: { id: 'asc' } }),
    db.instanceTask.count({ where: { status: { in: [...pending] }, OR: [
      { hostId }, { targetHostId: hostId }, { replacementState: { path: ['sourceHostId'], equals: hostId } }
    ] } }),
    db.hostOnboardingNode.count({ where: { hostId, status: { in: ['queued', 'running'] } } }),
    db.instanceTask.findMany({ where: { taskType: 'replace_host', OR: [
      { targetHostId: hostId }, { replacementState: { path: ['sourceHostId'], equals: hostId } }
    ] }, select: { id: true, status: true, targetHostId: true, replacementState: true, createdAt: true, finishedAt: true,
      instance: { select: { hostId: true, incusId: true } } } })
  ])
  const assigned = assignedInstances.length
  const preserve = assigned > 0
  if (preserve && (assigned !== 1 || assignedInstances.some(instance => instance.provisioningCleanupPending || instance.deletionBillingPending || instance.status === 'deleted'))) blockers.add('assigned')
  if (preserve && assignedInstances.some(instance => !instance.dedicatedIpv4 || !instance.dedicatedNetworkReady || !instance.ipv4 ||
      !['running', 'stopped', 'suspended'].includes(instance.status) || !instance.storagePoolName)) blockers.add('assigned-not-ready')
  if (preserve && assignedInstances.some(instance => instance.cpu > host.cpuAllowanceMax || instance.memory > host.memoryMax || instance.disk > host.storageSize * 1024)) blockers.add('capacity')
  if (tasks || onboarding) blockers.add('busy')
  if (preserve) {
    const ids = assignedInstances.map(instance => instance.id)
    const inProgress = { instanceId: { in: ids }, status: { in: [...pending] } }
    if (await db.restoreTask.count({ where: inProgress }) || await db.backupUploadTask.count({ where: inProgress })) blockers.add('busy')
  }
  const obsolete = new Set<string>()
  const creationBounds = new Map<string, { after: number; before: number }>()
  for (const task of history) {
    const state = task.replacementState as Record<string, unknown> | null
    if (!state) continue
    if (task.status === 'COMPLETED' && state.stage === 'delivered' && state.sourceHostId === hostId &&
        task.instance.hostId !== hostId && typeof state.sourceIncusId === 'string') {
      obsolete.add(state.sourceIncusId)
      creationBounds.set(state.sourceIncusId, { after: 0, before: task.createdAt.getTime() })
    }
    if (['FAILED', 'CANCELLED'].includes(task.status) && task.targetHostId === hostId && task.instance.hostId !== hostId &&
        task.finishedAt && ['creating', 'cleanup_pending', 'cleaned'].includes(String(state.stage)) && typeof state.targetIncusId === 'string') {
      obsolete.add(state.targetIncusId)
      creationBounds.set(state.targetIncusId, { after: task.createdAt.getTime(), before: task.finishedAt.getTime() })
    }
  }
  const recognized = (instance: RemoteInstance) => {
    const bounds = creationBounds.get(instance.name)
    const createdAt = Date.parse(instance.created_at || '')
    return Boolean(bounds && createdAt >= bounds.after && createdAt <= bounds.before && (!instance.project || instance.project === 'default'))
  }
  let client: Client | undefined
  let instances: RemoteInstance[] = []
  const forwards: Array<Forward & { network: string }> = []
  let volumes: Array<{ name: string; type: string; project?: string }> = []
  // Occupied recovery reads the exact existing instance; it never enters cleanup.
  if (host.poolFaulted && !tasks && !onboarding) {
    try {
      client = scope.client(await scope.run(() => connect(host, db), 8000))
      const [remoteInstances, projects, networks, operations, pools] = await Promise.all([
        client.request<RemoteInstance[]>('GET', '/1.0/instances?recursion=1&all-projects=true'),
        client.request<Array<{ name: string }>>('GET', '/1.0/projects?recursion=1'),
        client.request<Array<{ name: string; type: string; managed: boolean }>>('GET', '/1.0/networks?recursion=1'),
        client.request<Record<string, unknown[]>>('GET', '/1.0/operations?recursion=1'),
        client.request<Array<{ name: string; status: string }>>('GET', '/1.0/storage-pools?recursion=1')
      ])
      instances = remoteInstances
      if (projects.some(project => project.name !== 'default')) blockers.add('projects')
      if (['running', 'pending', 'cancelling'].some(key => operations[key]?.length)) blockers.add('busy')
      if (!networks.some(network => network.name === 'incusbr0' && network.managed && network.type === 'bridge') ||
          host.storagePools.some(pool => pool.purpose === 'instance_data' && !pools.some(remote => remote.name === pool.name && remote.status === 'Created'))) blockers.add('not-ready')
      for (const network of networks.filter(network => network.managed && network.type === 'bridge')) {
        const rows = await client.request<Forward[]>('GET', `/1.0/networks/${encodeURIComponent(network.name)}/forwards?recursion=1`)
        forwards.push(...rows.map(row => ({ ...row, network: network.name })))
      }
      for (const pool of pools) {
        volumes.push(...await client.request<typeof volumes>('GET', `/1.0/storage-pools/${encodeURIComponent(pool.name)}/volumes?recursion=1&all-projects=true`))
      }
      if (preserve) {
        const expected = assignedInstances[0]
        if (assigned !== 1 || instances.length !== 1 || !expected || instances[0].name !== expected.incusId ||
            (instances[0].project || 'default') !== 'default' || instances[0].status !== (expected.status === 'running' ? 'Running' : 'Stopped')) blockers.add('assigned-mismatch')
        if (expected) {
          const owner = `payincus-dedicated:${expected.incusId}`
          const ipv6 = dedicatedIpv6State(expected.dedicatedIpv6)
          // Quarantine intentionally pauses IPv6 reconciliation. Verify its retained mappings
          // against the remote rules below rather than requiring quarantine to be removed first.
          const pausedIpv6 = ipv6?.status === 'pending' && ipv6.error === 'IPV6_HOST_QUARANTINED' && ipv6.mappings.length > 0
          if (ipv6 && (ipv6.hostId !== hostId || ipv6.instanceName !== expected.incusId || (!['none', 'ready'].includes(ipv6.status) && !pausedIpv6) || ipv6.mappings.some(mapping => !mapping.ready))) blockers.add('assigned-not-ready')
          const ipv4Forward = (row: Forward) => row.listen_address === host.natBindIp && row.config.target_address === expected.ipv4 && !row.ports?.length
          const ipv6Forward = (row: Forward) => ipv6?.mappings.some(mapping => normalizeIpv6(row.listen_address) === mapping.publicIp &&
            normalizeIpv6(row.config.target_address) === (mapping.fallbackIp || mapping.privateIp) &&
            (mapping.fallbackIp ? row.ports?.length === 2 && ['tcp', 'udp'].every(protocol => row.ports?.some(port => port.protocol === protocol && port.listen_port === '1-65535' &&
              normalizeIpv6(port.target_address) === mapping.privateIp && !port.target_port && port.snat === true)) : !row.ports?.length))
          if (!forwards.some(row => row.network === 'incusbr0' && row.description === owner && ipv4Forward(row)) ||
              forwards.some(row => row.network !== 'incusbr0' || row.description !== owner || (!ipv4Forward(row) && !ipv6Forward(row))) ||
              ipv6?.mappings.some(mapping => !forwards.some(row => row.description === owner && normalizeIpv6(row.listen_address) === mapping.publicIp && ipv6Forward(row)))) blockers.add('unknown-forward')
          if (!host.storagePools.some(pool => pool.name === expected.storagePoolName && pool.purpose === 'instance_data') ||
              !volumes.some(volume => volume.name === expected.incusId && ['container', 'virtual-machine'].includes(volume.type)) ||
              volumes.some(volume => (volume.project || 'default') !== 'default' || (volume.type !== 'image' &&
                (!['container', 'virtual-machine'].includes(volume.type) || !(volume.name === expected.incusId || volume.name.startsWith(expected.incusId + '/')))))) blockers.add('volumes')
        }
      } else {
        for (const instance of instances) {
          if (!recognized(instance)) blockers.add('unknown-instance')
          if (instance.status !== 'Stopped') blockers.add('running-instance')
        }
        if (forwards.some(row => row.network !== 'incusbr0' || !obsolete.has(row.description.replace(/^payincus-dedicated:/, '')) ||
            !row.description.startsWith('payincus-dedicated:'))) blockers.add('unknown-forward')
        if (volumes.some(volume => volume.type !== 'image' &&
            (!['container', 'virtual-machine'].includes(volume.type) || !instances.some(instance =>
              obsolete.has(instance.name) && (volume.name === instance.name || volume.name.startsWith(instance.name + '/')))))) blockers.add('volumes')
      }
    } catch { blockers.add('unreachable') }
  }
  const report: HostRecoveryReport = {
    hostId, quarantined: host.poolFaulted, checkedAt: new Date().toISOString(), blockers: [...blockers],
    mode: preserve ? 'preserve' : 'empty',
    instances: preserve ? [] : instances.map(instance => ({ name: instance.name, status: instance.status,
      removable: recognized(instance) && instance.status === 'Stopped' })),
    forwardCount: preserve ? 0 : forwards.length, needsCleanup: !preserve && (instances.length > 0 || forwards.length > 0),
    canRecover: blockers.size === 0, confirmation: ''
  }
  // Bind confirmation to the displayed state; never trust names supplied by a browser.
  report.confirmation = createHash('sha256').update(JSON.stringify({ hostId, poolFaulted: host.poolFaulted,
    url: host.url, protocolRevision: host.portProtocolRevision, assigned, assignedInstances, tasks, onboarding,
    instances: instances.map(({ name, status, created_at, project }) => ({ name, status, created_at, project })).sort((a,b) => a.name.localeCompare(b.name)),
    forwards: forwards.map(row => ({ network: row.network, listen: row.listen_address, description: row.description, config: row.config, ports: row.ports })).sort((a,b) => a.listen.localeCompare(b.listen)),
    volumes: volumes.map(({ name, type, project }) => ({ name, type, project })).sort((a,b) => a.name.localeCompare(b.name))
  })).digest('hex')
  return { report, client, obsolete, instances }
}

export async function inspectHostRecovery(hostId: number, connect: Connect = getIncusClient): Promise<HostRecoveryReport> {
  const scope = recoveryScope()
  try { return (await inspect(prisma, hostId, connect, scope)).report }
  finally { scope.close() }
}

export async function recoverPoolHost(hostId: number, actorId: number, options: {
  confirmation: string; acknowledgeCleanup: boolean
}, connect: Connect = getIncusClient): Promise<{ success: true }> {
  const scope = recoveryScope()
  try {
    // Commit the request audit before holding a transaction connection. A later
    // rollback must retain it, and an audit failure must prevent remote cleanup.
    try {
      await scope.run(() => prisma.log.create({ data: {
        userId: actorId, module: 'host', action: 'host.pool.recovery_start', result: 'pending',
        content: `Requested recovery of host #${hostId}; confirmation: ${options.confirmation}; cleanup acknowledged: ${options.acknowledgeCleanup}`
      } }))
    } catch { throw new HostRecoveryError('HOST_RECOVERY_FAILED') }
    // The host row serializes recovery with allocation, replacement, and removal.
    // Network failures leave the persistent quarantine set, including after a restart.
    await prisma.$transaction(async tx => {
      try {
        scope.remaining()
        const rows = await tx.$queryRaw<Array<{ id: number }>>`SELECT id FROM hosts WHERE id = ${hostId} FOR UPDATE`
        scope.remaining()
        if (!rows.length) throw new HostRecoveryError('HOST_NOT_FOUND')
        await tx.$queryRaw`SELECT id FROM instances WHERE host_id = ${hostId} ORDER BY id FOR UPDATE`
        scope.remaining()
        const before = await inspect(tx, hostId, connect, scope)
        if (!before.report.canRecover || !before.client) throw new HostRecoveryError('HOST_RECOVERY_BLOCKED', before.report)
        if (before.report.confirmation !== options.confirmation) throw new HostRecoveryError('HOST_RECOVERY_CHANGED', before.report)
        if (before.report.needsCleanup && !options.acknowledgeCleanup) throw new HostRecoveryError('HOST_RECOVERY_CONFIRM_REQUIRED', before.report)
        if (before.report.mode === 'preserve') {
          // Retain customer ownership, accounting, disks, network rules and occupied resource counters.
          scope.remaining()
          await tx.host.update({ where: { id: hostId }, data: { poolFaulted: false } })
          return
        }
        // The request audit is already durable; all destructive calls share its deadline.
        try {
          for (const instance of before.instances) {
            // Recheck each exact system immediately before deletion. Running systems are refused.
            const current = await before.client.request<RemoteInstance>('GET', `/1.0/instances/${encodeURIComponent(instance.name)}`)
            if (current.status !== 'Stopped' || current.created_at !== instance.created_at || (current.project || 'default') !== (instance.project || 'default')) throw new HostRecoveryError('HOST_RECOVERY_CHANGED')
            await before.client.request('DELETE', `/1.0/instances/${encodeURIComponent(instance.name)}`, null, 7000)
          }
          for (const name of before.obsolete) await removeDedicatedForward(before.client, name)
          const after = await inspect(tx, hostId, connect, scope)
          if (!after.report.canRecover || after.report.needsCleanup) throw new HostRecoveryError('HOST_RECOVERY_BLOCKED', after.report)
          scope.remaining()
          await tx.host.update({ where: { id: hostId }, data: {
            poolFaulted: false, cpuUsed: 0, memoryUsed: 0, diskUsed: 0, natPortsUsedCount: 0
          } })
        } catch (error) {
          if (error instanceof HostRecoveryError) throw error
          throw new HostRecoveryError('HOST_RECOVERY_FAILED')
        }
      } finally { scope.close() }
    }, { timeout: scope.remaining(), maxWait: Math.min(5000, scope.remaining()) })
  } finally { scope.close() }
  await createLog(actorId, 'host', 'host.pool.recovered', `Verified host #${hostId} and released its quarantine; existing customer instances were preserved`, 'success')
  return { success: true }
}
