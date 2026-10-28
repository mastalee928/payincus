import { assertNoPendingSnapshotOperations, } from '../db/snapshot-operation-guards.js'
import { randomUUID } from 'node:crypto'
import { Prisma, type Host } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { INSTANCE_OPERATION_LOCK_NAMESPACE, advisoryTransactionLock } from '../db/advisory-locks.js'
import { assertNoPendingProxySiteOperations } from '../db/proxy-site-operation-guards.js'
import { cleanupProxySitesForLifecycle } from '../db/proxy-site-operations.js'
import { redactAuditText } from '../lib/risk-audit.js'
import { IncusClient } from '../lib/incus/incus-client.js'
import { executeTransfer, hasActiveTransferWorkflow } from '../db/transfers.js'
import { transferHostIdentity } from '../lib/transfer-host-identity.js'
import { authorizeUserWrite, type WriteActor } from '../db/user-write-authorization.js'
import type { IncusInstance } from '../types/incus.js'

type TransferCleanupState = {
  version: 1
  stage: 'claimed' | 'renamed' | 'sites' | 'ports' | 'snapshots' | 'backups' | 'finalize'
  sourceOwnerId: number; targetOwnerId: number; hostId: number
  oldIncusId: string; newIncusId: string; newName: string
  dedicated: boolean
  hostIdentity: string
  remoteUuid?: string
  attemptId?: string
  actor?: WriteActor
  sites: Array<{ id: number; siteKey: string; revision: number }>
  ports: Array<{ id: number; protocol: 'tcp' | 'udp'; publicPort: number; privatePort: number }>
  snapshots: Array<{ id: number; incusName: string }>
  backups: Array<{ id: number; incusName: string }>
  error?: string
}
const STAGES: TransferCleanupState['stage'][] = ['claimed', 'renamed', 'sites', 'ports', 'snapshots', 'backups', 'finalize']
// The private backend is a single process. A restart drops only execution ownership,
// while the persisted plan, UUID and completed stages remain authoritative.
const activeTransfers = new Set<number>()
const safeName = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(value)

function decodeState(value: unknown): TransferCleanupState {
  const state = value as TransferCleanupState | null
  if (!state || state.version !== 1 || !STAGES.includes(state.stage) ||
    !safeName(state.oldIncusId) || !safeName(state.newIncusId) || typeof state.newName !== 'string' ||
    typeof state.hostIdentity !== 'string' || !/^[a-f0-9]{64}$/.test(state.hostIdentity) ||
    ![state.sourceOwnerId, state.targetOwnerId, state.hostId].every(id => Number.isSafeInteger(id) && id > 0) ||
    ![state.sites, state.ports, state.snapshots, state.backups].every(Array.isArray) ||
    [...state.snapshots, ...state.backups].some(item => !safeName(item.incusName)) ||
    state.ports.some(port => !['tcp', 'udp'].includes(port.protocol) || !Number.isInteger(port.publicPort) ||
      port.publicPort < 1 || port.publicPort > 65535 || !Number.isInteger(port.privatePort) || port.privatePort < 1 || port.privatePort > 65535) ||
    (state.dedicated && (state.ports.length !== 0 || state.oldIncusId !== state.newIncusId))) throw new Error('TRANSFER_CLEANUP_STATE_INVALID')
  return structuredClone(value as TransferCleanupState)
}

async function saveError(transferId: number, attemptId: string, error: unknown) {
  try {
    const row = await prisma.instanceTransfer.findUnique({ where: { id: transferId } })
    if (!row || row.status !== 'processing' || !row.cleanupState) return
    const state = decodeState(row.cleanupState)
    if (state.attemptId !== attemptId) return
    state.error = redactAuditText(error instanceof Error ? error.message : String(error)).slice(0, 1500)
    await prisma.instanceTransfer.updateMany({ where: { id: transferId, status: 'processing', cleanupState: { equals: row.cleanupState } },
      data: { cleanupState: state as Prisma.InputJsonValue } })
  }
  catch (recordError) { console.error('[Transfer] Unable to persist cleanup error:', redactAuditText(recordError instanceof Error ? recordError.message : String(recordError))) }
}

/** Called only for a processing transfer. Capture old resource identities once. */
export async function prepareTransferCleanup(transferId: number, newIncusId: string, newName: string, actor: WriteActor): Promise<TransferCleanupState> {
  return prisma.$transaction(async tx => {
    const initial = await tx.instanceTransfer.findUniqueOrThrow({ where: { id: transferId } })
    await advisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, initial.instanceId)
    await tx.$queryRaw`SELECT id FROM instances WHERE id = ${initial.instanceId} FOR UPDATE`
    await tx.$queryRaw`SELECT id FROM instance_transfers WHERE id = ${transferId} FOR UPDATE`
    const candidate = await tx.instanceTransfer.findUniqueOrThrow({ where: { id: transferId } })
    if (candidate.status !== 'processing') throw new Error('TRANSFER_NOT_PROCESSING')
    const current = await tx.instance.findUniqueOrThrow({ where: { id: candidate.instanceId } })
    await tx.$queryRaw`SELECT id FROM hosts WHERE id = ${current.hostId} FOR SHARE`
    const host = await tx.host.findUniqueOrThrow({ where: { id: current.hostId } })
    if (![candidate.fromUserId, candidate.toUserId].includes(actor.id) ||
      !await authorizeUserWrite(tx, actor.id, actor, true)) throw new Error('FORBIDDEN')
    if (current.userId !== candidate.fromUserId || !['running', 'stopped'].includes(current.status) ||
      (current.dedicatedIpv4 && newIncusId !== current.incusId) ||
      (!current.dedicatedIpv4 && current.status !== 'stopped')) throw new Error('TRANSFER_SOURCE_CHANGED')
    if (candidate.cleanupState !== null) {
      const saved = decodeState(candidate.cleanupState)
      if (saved.oldIncusId !== current.incusId || saved.hostId !== current.hostId || saved.dedicated !== current.dedicatedIpv4 ||
        saved.sourceOwnerId !== candidate.fromUserId || saved.targetOwnerId !== candidate.toUserId) throw new Error('TRANSFER_CLEANUP_STATE_CHANGED')
      return saved
    }
    if (!safeName(newIncusId) || !newName || newName.length > 64) throw new Error('TRANSFER_CLEANUP_STATE_INVALID')
    await assertNoPendingSnapshotOperations(tx, candidate.instanceId)
    await assertNoPendingProxySiteOperations(tx, candidate.instanceId)
    const [sites, ports, snapshots, backups] = await Promise.all([
      tx.proxySite.findMany({ where: { instanceId: current.id }, select: { id: true, siteKey: true, revision: true } }),
      current.dedicatedIpv4 ? Promise.resolve([]) : tx.portMapping.findMany({ where: { instanceId: current.id },
        select: { id: true, protocol: true, publicPort: true, privatePort: true } }),
      tx.snapshot.findMany({ where: { instanceId: current.id }, select: { id: true, incusName: true } }),
      tx.backup.findMany({ where: { instanceId: current.id, status: { not: 'deleted' } }, select: { id: true, incusName: true } })
    ])
    const state: TransferCleanupState = { version: 1, stage: 'claimed', sourceOwnerId: candidate.fromUserId,
      targetOwnerId: candidate.toUserId, hostId: current.hostId, oldIncusId: current.incusId, newIncusId,
      newName, dedicated: current.dedicatedIpv4, hostIdentity: transferHostIdentity(host), sites, ports, snapshots, backups }
    await tx.snapshotPolicy.deleteMany({ where: { instanceId: current.id } })
    await tx.backupPolicy.deleteMany({ where: { instanceId: current.id } })
    await tx.instanceTransfer.update({ where: { id: transferId }, data: { cleanupState: state as Prisma.InputJsonValue } })
    return state
  }, { maxWait: 5000, timeout: 20000 })
}

async function remoteList(client: IncusClient, path: string): Promise<string[]> {
  const names = await client.request<unknown>('GET', path, null, 30000)
  if (!Array.isArray(names) || names.some(item => typeof item !== 'string' || !item.startsWith(`${path}/`))) {
    throw new Error('TRANSFER_REMOTE_LIST_INVALID')
  }
  return names
}

async function remoteIdentity(client: IncusClient, state: TransferCleanupState, allowOld: boolean) {
  const names = await remoteList(client, '/1.0/instances')
  const oldExists = names.includes(`/1.0/instances/${state.oldIncusId}`)
  const newExists = names.includes(`/1.0/instances/${state.newIncusId}`)
  if (state.oldIncusId === state.newIncusId ? !oldExists : oldExists === newExists || !allowOld && oldExists) {
    throw new Error('TRANSFER_INCUS_IDENTITY_UNKNOWN')
  }
  const name = oldExists ? state.oldIncusId : state.newIncusId
  const remote = await client.request<IncusInstance>('GET', `/1.0/instances/${name}`, null, 30000)
  const uuid = remote.config?.['volatile.uuid'] || remote.expanded_config?.['volatile.uuid']
  if (remote.name !== name || typeof uuid !== 'string' || !uuid || state.remoteUuid && state.remoteUuid !== uuid ||
    !state.dedicated && remote.status !== 'Stopped') throw new Error('TRANSFER_INCUS_IDENTITY_CHANGED')
  if (!state.remoteUuid && name !== state.oldIncusId) throw new Error('TRANSFER_INCUS_IDENTITY_UNKNOWN')
  return { name, uuid, remote }
}

async function withRemote<T>(host: Host, work: (client: IncusClient) => Promise<T>): Promise<T> {
  // Bound the entire connection/action/confirmation sequence below the SQL lock lifetime.
  const deadline = Date.now() + 90000
  class TransferClient extends IncusClient {
    override async request<R = unknown>(method: string, path: string, body: unknown = null, timeout = 120000, signal?: AbortSignal): Promise<R> {
      const remaining = deadline - Date.now()
      if (remaining <= 0) throw new Error('TRANSFER_REMOTE_TIMEOUT')
      return super.request<R>(method, path, body, Math.min(timeout, remaining), signal)
    }
  }
  const client = new TransferClient(host)
  try { await client.connect(); return await work(client) }
  finally { await client.close() }
}

/** Every stage rechecks the persistent claim and its original identity under the shared lock. */
async function step(transferId: number, actor: WriteActor, attemptId: string, claim: boolean,
  work: (tx: Prisma.TransactionClient, state: TransferCleanupState, host: Host, instanceId: number) => Promise<void>) {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`
    const initial = await tx.instanceTransfer.findUniqueOrThrow({ where: { id: transferId } })
    await advisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, initial.instanceId)
    await tx.$queryRaw`SELECT id FROM instances WHERE id = ${initial.instanceId} FOR UPDATE`
    const instance = await tx.instance.findUniqueOrThrow({ where: { id: initial.instanceId } })
    await tx.$queryRaw`SELECT id FROM hosts WHERE id = ${instance.hostId} FOR UPDATE`
    const host = await tx.host.findUniqueOrThrow({ where: { id: instance.hostId } })
    await tx.$queryRaw`SELECT id FROM instance_transfers WHERE id = ${transferId} FOR UPDATE`
    const transfer = await tx.instanceTransfer.findUniqueOrThrow({ where: { id: transferId } })
    const state = decodeState(transfer.cleanupState)
    if (transfer.status !== 'processing' || transfer.instanceId !== instance.id ||
      transfer.fromUserId !== state.sourceOwnerId || transfer.toUserId !== state.targetOwnerId ||
      instance.userId !== state.sourceOwnerId || instance.hostId !== state.hostId || instance.incusId !== state.oldIncusId ||
      instance.dedicatedIpv4 !== state.dedicated || transferHostIdentity(host) !== state.hostIdentity ||
      !claim && state.attemptId !== attemptId) throw new Error('TRANSFER_SOURCE_CHANGED')
    if (![transfer.fromUserId, transfer.toUserId].includes(actor.id)) throw new Error('FORBIDDEN')
    const userIds = [...new Set([transfer.fromUserId, transfer.toUserId])].sort((a, b) => a - b)
    await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id IN (${Prisma.join(userIds)}) ORDER BY id FOR UPDATE`)
    if (!await authorizeUserWrite(tx, actor.id, actor, true)) throw new Error('FORBIDDEN')
    if (await tx.user.count({ where: { id: { in: userIds }, status: 'active' } }) !== userIds.length) throw new Error('TRANSFER_TO_BANNED')
    if (!host.transferEnabled || !['running', 'stopped'].includes(instance.status) || instance.provisioningCleanupPending ||
      instance.deletionBillingPending || !state.dedicated && instance.status !== 'stopped' ||
      state.dedicated && (!instance.dedicatedNetworkReady || host.publicIpSyncBlocked || host.poolFaulted)) throw new Error('TRANSFER_INVALID_STATUS')
    if (await hasActiveTransferWorkflow(instance.id, tx)) throw new Error('TRANSFER_INSTANCE_BUSY')
    if (claim) { state.attemptId = attemptId; state.actor = actor }
    await work(tx, state, host, instance.id)
    delete state.error
    const saved = await tx.instanceTransfer.updateMany({ where: { id: transferId, status: 'processing', cleanupState: { equals: transfer.cleanupState! } },
      data: { cleanupState: state as Prisma.InputJsonValue } })
    if (saved.count !== 1) throw new Error('TRANSFER_CLEANUP_STATE_CHANGED')
    return state
  }, { maxWait: 5000, timeout: 240000 })
}

async function deleteRemoteResource(client: IncusClient, state: TransferCleanupState, kind: 'snapshots' | 'backups', name: string) {
  await remoteIdentity(client, state, false)
  const path = `/1.0/instances/${state.newIncusId}/${kind}`
  const target = `${path}/${name}`
  if ((await remoteList(client, path)).includes(target)) await client.request('DELETE', target, null, 30000)
  if ((await remoteList(client, path)).includes(target)) throw new Error('TRANSFER_REMOTE_DELETE_UNCONFIRMED')
}

/** Retries use the fixed claim snapshot; no current-resource list is re-scanned. */
export async function runTransferCleanup(transferId: number, actor: WriteActor): Promise<void> {
  if (activeTransfers.has(transferId)) throw new Error('TRANSFER_INSTANCE_BUSY')
  activeTransfers.add(transferId)
  const attemptId = randomUUID()
  try {
    let state = await step(transferId, actor, attemptId, true, async () => {})
    const transfer = await prisma.instanceTransfer.findUniqueOrThrow({ where: { id: transferId } })
    const advance = async (stage: TransferCleanupState['stage']) => {
      state = await step(transferId, actor, attemptId, false, async (_tx, current) => { current.stage = stage })
    }
    if (state.stage === 'claimed') {
      // Persist UUID before rename: a lost response cannot make a different instance a valid retry target.
      state = await step(transferId, actor, attemptId, false, async (_tx, current, host) => withRemote(host, async client => {
        const remote = await remoteIdentity(client, current, true)
        current.remoteUuid = remote.uuid
      }))
      state = await step(transferId, actor, attemptId, false, async (_tx, current, host) => withRemote(host, async client => {
        const remote = await remoteIdentity(client, current, true)
        if (state.oldIncusId !== state.newIncusId) {
          if (remote.name === current.oldIncusId) await client.request('POST', `/1.0/instances/${current.oldIncusId}`, { name: current.newIncusId }, 30000)
        }
        await remoteIdentity(client, current, false)
        current.stage = 'renamed'
      }))
    }
    if (state.stage === 'renamed') {
      const sites = await cleanupProxySitesForLifecycle(transfer.instanceId, { kind: 'transfer', id: transferId }, state.sites, true)
      if (sites.pending) throw new Error(`TRANSFER_SITE_CLEANUP_PENDING: ${sites.errors.join('; ')}`)
      await advance('sites')
    }
    if (state.stage === 'sites') {
      for (const port of state.ports) await step(transferId, actor, attemptId, false, async (tx, current, host, instanceId) => {
        const mapping = await tx.portMapping.findUnique({ where: { id: port.id } })
        if (mapping && (mapping.instanceId !== instanceId || mapping.hostId !== host.id || mapping.protocol !== port.protocol ||
          mapping.publicPort !== port.publicPort || mapping.privatePort !== port.privatePort)) throw new Error('TRANSFER_PORT_IDENTITY_CHANGED')
        await withRemote(host, async client => {
          const { remote } = await remoteIdentity(client, current, false)
          const deviceName = `proxy-${port.protocol}-${port.publicPort}`
          const names = [deviceName, `${deviceName}-v6`]
          const devices = { ...remote.devices }
          for (const name of names) {
            const device = devices[name]
            if (!device) {
              if (remote.expanded_devices?.[name]) throw new Error('TRANSFER_INHERITED_PORT_DEVICE')
              continue
            }
            if (device.type !== 'proxy' || typeof device.listen !== 'string' || typeof device.connect !== 'string' ||
              !device.listen.startsWith(`${port.protocol}:`) || !device.listen.endsWith(`:${port.publicPort}`) ||
              !device.connect.startsWith(`${port.protocol}:`) || !device.connect.endsWith(`:${port.privatePort}`)) throw new Error('TRANSFER_PORT_DEVICE_CHANGED')
            delete devices[name]
          }
          if (names.some(name => remote.devices?.[name])) {
            await client.request('PUT', `/1.0/instances/${current.newIncusId}`, { ...remote, devices }, 30000)
          }
          const confirmed = await remoteIdentity(client, current, false)
          if (names.some(name => confirmed.remote.devices?.[name] || confirmed.remote.expanded_devices?.[name])) throw new Error('TRANSFER_REMOTE_DELETE_UNCONFIRMED')
        })
        if (mapping) await tx.portMapping.delete({ where: { id: port.id } })
        const actual = await tx.portMapping.count({ where: { hostId: host.id, instance: { status: { not: 'deleted' } } } })
        await tx.host.update({ where: { id: host.id }, data: { natPortsUsedCount: actual } })
      })
      await advance('ports')
    }
    if (state.stage === 'ports') {
      for (const snapshot of state.snapshots) await step(transferId, actor, attemptId, false, async (tx, current, host, instanceId) => {
        const row = await tx.snapshot.findUnique({ where: { id: snapshot.id } })
        if (row && (row.instanceId !== instanceId || row.incusName !== snapshot.incusName)) throw new Error('TRANSFER_SNAPSHOT_IDENTITY_CHANGED')
        await withRemote(host, client => deleteRemoteResource(client, current, 'snapshots', snapshot.incusName))
        if (row) await tx.snapshot.delete({ where: { id: row.id } })
      })
      await advance('snapshots')
    }
    if (state.stage === 'snapshots') {
      for (const backup of state.backups) await step(transferId, actor, attemptId, false, async (tx, current, host, instanceId) => {
        const row = await tx.backup.findUnique({ where: { id: backup.id } })
        if (row && (row.instanceId !== instanceId || row.incusName !== backup.incusName)) throw new Error('TRANSFER_BACKUP_IDENTITY_CHANGED')
        await withRemote(host, client => deleteRemoteResource(client, current, 'backups', backup.incusName))
        if (row) await tx.backup.update({ where: { id: row.id }, data: { status: 'deleted' } })
      })
      await advance('backups')
    }
    if (state.stage === 'backups') await advance('finalize')
    if (state.stage === 'finalize') {
      await step(transferId, actor, attemptId, false, async (_tx, current, host) => withRemote(host, async client => {
        await remoteIdentity(client, current, false)
        if ((await remoteList(client, `/1.0/instances/${current.newIncusId}/snapshots`)).length ||
          (await remoteList(client, `/1.0/instances/${current.newIncusId}/backups`)).length) throw new Error('TRANSFER_CLEANUP_RESOURCES_CHANGED')
      }))
      await executeTransfer(transferId, transfer.instanceId, state.sourceOwnerId,
        state.targetOwnerId, state.newName, state.newIncusId, state.oldIncusId, attemptId, actor)
    }
  } catch (error) {
    await saveError(transferId, attemptId, error)
    throw error
  } finally { activeTransfers.delete(transferId) }
}
