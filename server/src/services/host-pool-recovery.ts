import { createHash } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { createLog } from '../db/logs.js'
import { HOST_OCCUPIED_INSTANCE_WHERE } from '../lib/host-resource-usage.js'
import { poolCapacityReady } from '../lib/pool-stock.js'
import { getIncusClient } from '../lib/incus/incus-pool.js'
import { removeDedicatedForward } from '../lib/incus/dedicated-network.js'
import { portProtocolView, PORT_PROTOCOL_CAPABILITY } from './host-port-protocol.js'

type Db = Prisma.TransactionClient | typeof prisma
type Client = Awaited<ReturnType<typeof getIncusClient>>
type Connect = typeof getIncusClient
type RemoteInstance = { name: string; status: string; created_at?: string; project?: string }
type Forward = { listen_address: string; description: string; config: Record<string, string>; ports?: unknown[] }
type Residue = { name: string; status: string; removable: boolean }

export type RecoveryBlocker = 'not-quarantined' | 'assigned' | 'busy' | 'offline' | 'agent-offline' |
  'not-ready' | 'protocol-pending' | 'capacity' | 'unreachable' | 'projects' | 'unknown-instance' |
  'running-instance' | 'unknown-forward' | 'volumes'
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

async function bounded<T>(action: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([action, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new HostRecoveryError('HOST_RECOVERY_UNREACHABLE')), 8000)
    })])
  } finally { clearTimeout(timer) }
}

async function inspect(db: Db, hostId: number, connect: Connect) {
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
  const [assigned, tasks, onboarding, history] = await Promise.all([
    db.instance.count({ where: { hostId, ...HOST_OCCUPIED_INSTANCE_WHERE } }),
    db.instanceTask.count({ where: { status: { in: [...pending] }, OR: [
      { hostId }, { targetHostId: hostId }, { replacementState: { path: ['sourceHostId'], equals: hostId } }
    ] } }),
    db.hostOnboardingNode.count({ where: { hostId, status: { in: ['queued', 'running'] } } }),
    db.instanceTask.findMany({ where: { taskType: 'replace_host', OR: [
      { targetHostId: hostId }, { replacementState: { path: ['sourceHostId'], equals: hostId } }
    ] }, select: { id: true, status: true, targetHostId: true, replacementState: true, createdAt: true, finishedAt: true,
      instance: { select: { hostId: true, incusId: true } } } })
  ])
  if (assigned) blockers.add('assigned')
  if (tasks || onboarding) blockers.add('busy')
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
  // An occupied or active machine must never enter the remote cleanup path.
  if (host.poolFaulted && !assigned && !tasks && !onboarding) {
    try {
      client = await bounded(connect(host))
      const [remoteInstances, projects, networks, operations, pools] = await bounded(Promise.all([
        client.request<RemoteInstance[]>('GET', '/1.0/instances?recursion=1&all-projects=true'),
        client.request<Array<{ name: string }>>('GET', '/1.0/projects?recursion=1'),
        client.request<Array<{ name: string; type: string; managed: boolean }>>('GET', '/1.0/networks?recursion=1'),
        client.request<Record<string, unknown[]>>('GET', '/1.0/operations?recursion=1'),
        client.request<Array<{ name: string; status: string }>>('GET', '/1.0/storage-pools?recursion=1')
      ]))
      instances = remoteInstances
      if (projects.some(project => project.name !== 'default')) blockers.add('projects')
      if (['running', 'pending', 'cancelling'].some(key => operations[key]?.length)) blockers.add('busy')
      if (!networks.some(network => network.name === 'incusbr0' && network.managed && network.type === 'bridge') ||
          host.storagePools.some(pool => pool.purpose === 'instance_data' && !pools.some(remote => remote.name === pool.name && remote.status === 'Created'))) blockers.add('not-ready')
      for (const network of networks.filter(network => network.managed && network.type === 'bridge')) {
        const rows = await bounded(client.request<Forward[]>('GET', `/1.0/networks/${encodeURIComponent(network.name)}/forwards?recursion=1`))
        forwards.push(...rows.map(row => ({ ...row, network: network.name })))
      }
      for (const pool of pools) {
        volumes.push(...await bounded(client.request<typeof volumes>('GET', `/1.0/storage-pools/${encodeURIComponent(pool.name)}/volumes?recursion=1&all-projects=true`)))
      }
      for (const instance of instances) {
        if (!recognized(instance)) blockers.add('unknown-instance')
        if (instance.status !== 'Stopped') blockers.add('running-instance')
      }
      if (forwards.some(row => row.network !== 'incusbr0' || !obsolete.has(row.description.replace(/^payincus-dedicated:/, '')) ||
          !row.description.startsWith('payincus-dedicated:'))) blockers.add('unknown-forward')
      if (volumes.some(volume => volume.type !== 'image' &&
          (!['container', 'virtual-machine'].includes(volume.type) || !instances.some(instance =>
            obsolete.has(instance.name) && (volume.name === instance.name || volume.name.startsWith(instance.name + '/')))))) blockers.add('volumes')
    } catch { blockers.add('unreachable') }
  }
  const report: HostRecoveryReport = {
    hostId, quarantined: host.poolFaulted, checkedAt: new Date().toISOString(), blockers: [...blockers],
    instances: instances.map(instance => ({ name: instance.name, status: instance.status,
      removable: recognized(instance) && instance.status === 'Stopped' })),
    forwardCount: forwards.length, needsCleanup: instances.length > 0 || forwards.length > 0,
    canRecover: blockers.size === 0, confirmation: ''
  }
  // Bind confirmation to the displayed state; never trust names supplied by a browser.
  report.confirmation = createHash('sha256').update(JSON.stringify({ hostId, poolFaulted: host.poolFaulted,
    url: host.url, protocolRevision: host.portProtocolRevision, assigned, tasks, onboarding,
    instances: instances.map(({ name, status, created_at, project }) => ({ name, status, created_at, project })).sort((a,b) => a.name.localeCompare(b.name)),
    forwards: forwards.map(row => ({ network: row.network, listen: row.listen_address, description: row.description, config: row.config, ports: row.ports })).sort((a,b) => a.listen.localeCompare(b.listen)),
    volumes: volumes.map(({ name, type, project }) => ({ name, type, project })).sort((a,b) => a.name.localeCompare(b.name))
  })).digest('hex')
  return { report, client, obsolete, instances }
}

export async function inspectHostRecovery(hostId: number, connect: Connect = getIncusClient): Promise<HostRecoveryReport> {
  return (await inspect(prisma, hostId, connect)).report
}

export async function recoverPoolHost(hostId: number, actorId: number, options: {
  confirmation: string; acknowledgeCleanup: boolean
}, connect: Connect = getIncusClient): Promise<{ success: true }> {
  // The host row serializes recovery with allocation, replacement, and removal.
  // Network failures leave the persistent quarantine set, including after a restart.
  await prisma.$transaction(async tx => {
    const rows = await tx.$queryRaw<Array<{ id: number }>>`SELECT id FROM hosts WHERE id = ${hostId} FOR UPDATE`
    if (!rows.length) throw new HostRecoveryError('HOST_NOT_FOUND')
    const before = await inspect(tx, hostId, connect)
    if (!before.report.canRecover || !before.client) throw new HostRecoveryError('HOST_RECOVERY_BLOCKED', before.report)
    if (before.report.confirmation !== options.confirmation) throw new HostRecoveryError('HOST_RECOVERY_CHANGED', before.report)
    if (before.report.needsCleanup && !options.acknowledgeCleanup) throw new HostRecoveryError('HOST_RECOVERY_CONFIRM_REQUIRED', before.report)
    // Log intent before touching disks, so a timeout cannot erase the audit trail.
    await createLog(actorId, 'host', 'host.pool.recovery_start',
      `Recover host #${hostId}; obsolete systems: ${before.report.instances.map(instance => instance.name).join(', ') || 'none'}`, 'success')
    try {
      for (const instance of before.instances) {
        // Recheck each exact system immediately before deletion. Running systems are refused.
        const current = await bounded(before.client.request<RemoteInstance>('GET', `/1.0/instances/${encodeURIComponent(instance.name)}`))
        if (current.status !== 'Stopped' || current.created_at !== instance.created_at || (current.project || 'default') !== (instance.project || 'default')) throw new HostRecoveryError('HOST_RECOVERY_CHANGED')
        await bounded(before.client.request('DELETE', `/1.0/instances/${encodeURIComponent(instance.name)}`, null, 7000))
      }
      for (const name of before.obsolete) await bounded(removeDedicatedForward(before.client, name))
      const after = await inspect(tx, hostId, connect)
      if (!after.report.canRecover || after.report.needsCleanup) throw new HostRecoveryError('HOST_RECOVERY_BLOCKED', after.report)
      await tx.host.update({ where: { id: hostId }, data: {
        poolFaulted: false, cpuUsed: 0, memoryUsed: 0, diskUsed: 0, natPortsUsedCount: 0
      } })
    } catch (error) {
      if (error instanceof HostRecoveryError) throw error
      throw new HostRecoveryError('HOST_RECOVERY_FAILED')
    }
  }, { timeout: 60000, maxWait: 5000 })
  await createLog(actorId, 'host', 'host.pool.recovered', `Verified host #${hostId} is empty and released its quarantine`, 'success')
  return { success: true }
}
