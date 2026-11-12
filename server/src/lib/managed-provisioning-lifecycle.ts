import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import * as db from '../db/index.js'
import { assertInstanceMayBoot } from './instance-expiry.js'
import { transferHostIdentity } from './transfer-host-identity.js'
import { cleanupManagedInstanceRemote, managedCleanupEndpointHash } from './managed-cleanup-identity.js'
import type { IncusClient, IncusRequestConditions } from './incus/incus-client.js'
import type { IncusInstance } from '../types/incus.js'
import type { Host } from '../types/database.js'
import { networkModeAllowsPortMapping, networkModeNeedsPublicIpv4 } from './network-modes.js'
import { assertCustomerProfiles } from './incus/customer-isolation.js'
import { notifyAdminInstanceCreateFailed } from './admin-alerts.js'

type Specs = Record<string, unknown> & { managedCleanup?: { attempt?: string; endpointHash?: string; uuid?: string; phase?: string } }
export class ManagedProvisionOwnershipError extends Error {}

/** Claims before POST; all later writes belong to this instance and attempt. */
export async function beginManagedProvision(instanceId: number, host: Host, transport: IncusClient, name: string) {
  const initial = await prisma.instance.findUniqueOrThrow({ where: { id: instanceId } })
  const endpoint = await prisma.host.findUniqueOrThrow({ where: { id: host.id } })
  const target = { id: instanceId, userId: initial.userId, hostId: host.id, incusId: name }
  if (initial.status !== 'creating' || initial.hostId !== host.id || initial.incusId !== name || initial.provisioningCleanupPending) {
    throw new ManagedProvisionOwnershipError('Managed instance creation no longer owns the target')
  }
  assertInstanceMayBoot(initial)
  const specs = { ...((initial.snapshottedSpecs || {}) as Specs) }
  if (specs.managedCleanup?.attempt) throw new ManagedProvisionOwnershipError('Managed creation already started')
  const attempt = randomUUID()
  const claimed = await prisma.instance.updateMany({ where: { ...target, status: 'creating', provisioningCleanupPending: false,
    snapshottedSpecs: { equals: initial.snapshottedSpecs ?? Prisma.DbNull } }, data: {
    snapshottedSpecs: { ...specs, managedCleanup: { attempt, endpointHash: managedCleanupEndpointHash(transport), phase: 'creating' } }
  } })
  if (claimed.count !== 1) throw new ManagedProvisionOwnershipError('Managed instance creation no longer owns the target')
  const check = async (database: Prisma.TransactionClient | typeof prisma = prisma) => {
    const current = await database.instance.findUniqueOrThrow({ where: { id: instanceId } })
    if (current.status !== 'creating' || current.provisioningCleanupPending || current.hostId !== host.id ||
      current.incusId !== name || current.userId !== initial.userId || (current.snapshottedSpecs as Specs)?.managedCleanup?.attempt !== attempt) {
      throw new ManagedProvisionOwnershipError('Managed instance creation no longer owns the target')
    }
    if (current.cpu !== initial.cpu || current.memory !== initial.memory || current.disk !== initial.disk ||
      current.networkMode !== initial.networkMode || current.portLimit !== initial.portLimit) throw new Error('Managed allocation changed')
    assertInstanceMayBoot(current)
    const latestHost = await database.host.findUniqueOrThrow({ where: { id: host.id } })
    if (transferHostIdentity(latestHost) !== transferHostIdentity(endpoint)) throw new Error('Managed host identity changed')
    return current
  }
  let uuid: string | undefined
  let createdAt: string | undefined
  let submitted = false
  const identity = async () => {
    const remote = await transport.request<IncusInstance & { created_at: string; project?: string }>('GET', `/1.0/instances/${encodeURIComponent(name)}`)
    const actualUuid = remote.config?.['volatile.uuid']
    if (remote.name !== name || !['container', 'virtual-machine'].includes(remote.type) || remote.config?.['user.payincus.provisioning-attempt'] !== attempt || !actualUuid ||
      !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(actualUuid) || !Number.isFinite(Date.parse(remote.created_at)) ||
      (remote.project || 'default') !== 'default' || (uuid && uuid !== actualUuid) || (createdAt && createdAt !== remote.created_at)) {
      throw new Error('Managed delivery identity not confirmed')
    }
    if (!uuid) {
      const current = await check()
      const currentSpecs = current.snapshottedSpecs as Specs
      const saved = await prisma.instance.updateMany({ where: { ...target, status: 'creating', provisioningCleanupPending: false,
        snapshottedSpecs: { equals: current.snapshottedSpecs! } }, data: { snapshottedSpecs: {
        ...currentSpecs, managedCleanup: { ...currentSpecs.managedCleanup, uuid: actualUuid },
        recoveryIdentity: { uuid: actualUuid, createdAt: remote.created_at, project: 'default' }
      } as Prisma.InputJsonValue } })
      if (!saved.count) throw new ManagedProvisionOwnershipError('Managed instance creation no longer owns the target')
    }
    uuid = actualUuid
    createdAt = remote.created_at
    return remote
  }
  const client = new Proxy(transport, { get(object, property) {
    if (property === 'request') return async <T>(method: string, path: string, body: unknown = null, timeout?: number, signal?: AbortSignal, conditions?: IncusRequestConditions) => {
      await check()
      if (method === 'POST' && path === '/1.0/instances') {
        if (submitted) throw new ManagedProvisionOwnershipError('Managed creation already submitted')
        submitted = true
      }
      if (method !== 'GET' && path !== '/1.0/instances') await identity()
      await check()
      return object.request<T>(method, path, body, timeout, signal, conditions)
    }
    const value = Reflect.get(object, property)
    return typeof value === 'function' ? value.bind(object) : value
  } })
  const complete = async (data: Prisma.InstanceUpdateManyMutationInput) => {
    const remote = await identity()
    await assertCustomerProfiles(transport, remote)
    if ((await transport.request<{ status?: string }>('GET', `/1.0/instances/${encodeURIComponent(name)}/state`)).status !== 'Running') {
      throw new Error('Instance startup not confirmed')
    }
    return prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM instances WHERE id = ${instanceId} FOR UPDATE`
      await check(tx)
      return tx.instance.updateMany({ where: { ...target, status: 'creating', provisioningCleanupPending: false,
      snapshottedSpecs: { path: ['managedCleanup', 'attempt'], equals: attempt } }, data })
    })
  }
  return { attempt, client, identity, complete }
}

/** Refund independently; retain resources until the original guest, disk and forward are absent. */
export async function failManagedProvision(instanceId: number, host: Host | null, beforeRemoteCreate = false): Promise<boolean> {
  const initial = await prisma.instance.findUnique({ where: { id: instanceId } })
  if (!initial || initial.purchaseBatchId) return false
  const target = { id: instanceId, hostId: initial.hostId, userId: initial.userId, incusId: initial.incusId }
  const specs = { ...((initial.snapshottedSpecs || {}) as Specs) }
  if (beforeRemoteCreate && specs.managedCleanup?.attempt) return false
  if (beforeRemoteCreate && !specs.managedCleanup?.attempt) {
    specs.managedCleanup = { attempt: randomUUID(), phase: 'prepared' }
  }
  const claimed = await prisma.instance.updateMany({ where: { ...target, status: { in: ['creating', 'error'] },
    snapshottedSpecs: { equals: initial.snapshottedSpecs ?? Prisma.DbNull } },
    data: { status: 'error', provisioningCleanupPending: true, snapshottedSpecs: specs as Prisma.InputJsonValue } })
  if (!claimed.count) return false
  const result = await db.compensateFailedInstancePurchase(instanceId, initial.userId, initial.hostId).catch(() => null)
  const settled = result && (result.refunded || ['already_refunded', 'not_paid_purchase', 'external_refund_pending'].includes(result.reason || ''))
  if (initial.status === 'creating') void notifyAdminInstanceCreateFailed({ userId: initial.userId, instanceId,
    errorMessage: '实例开通失败，退款和远端清理由系统继续处理',
    refundStatus: result?.refunded ? 'refunded' : result?.reason === 'not_paid_purchase' ? 'not_required' : settled ? 'already_refunded' : 'failed',
    refundAmount: result?.refundAmount || 0 }).catch(() => undefined)
  const deadline = Date.now() + 30000
  try {
    const identity = specs.managedCleanup
    // No durable attempt means the synchronous allocation stage never sent POST.
    // Legacy async records have no proof of absence, and keep their allocation.
    if (!identity?.attempt) throw new Error('Original creation attempt is not recorded; cleanup remains pending')
    const prepared = identity.phase === 'prepared'
    if (!prepared && (!host || host.id !== initial.hostId)) throw new Error('Original host unavailable')
    const client = prepared ? null : await (await import('./incus/index.js')).getIncusClient(host!)
    if (client && managedCleanupEndpointHash(client) !== identity.endpointHash) throw new Error('Original host endpoint changed')
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM instances WHERE id = ${instanceId} FOR UPDATE`
      const current = await tx.instance.findFirst({ where: { ...target, status: 'error', provisioningCleanupPending: true } })
      if (!current) return
      if (current.cpu !== initial.cpu || current.memory !== initial.memory || current.disk !== initial.disk ||
        (current.snapshottedSpecs as Specs)?.managedCleanup?.attempt !== identity.attempt) throw new Error('Creation allocation changed')
      if (client) await cleanupManagedInstanceRemote(client, initial.incusId, identity.attempt!, deadline, identity.uuid)
      if (!settled || current.deletionBillingPending) throw new Error('Creation billing settlement remains pending')
      await tx.instance.update({ where: { id: instanceId }, data: { status: 'deleted', provisioningCleanupPending: false } })
      await tx.ipAddress.deleteMany({ where: { instanceId } })
      if (current.ipv4) await tx.natIpv4Reservation.deleteMany({ where: { hostId: current.hostId, address: current.ipv4 } })
      const ports = networkModeAllowsPortMapping(current.networkMode) ? current.portLimit || 0 : 0
      await tx.$executeRaw`UPDATE hosts SET cpu_used = GREATEST(cpu_used - ${current.cpu}, 0),
        memory_used = GREATEST(memory_used - ${current.memory}, 0), disk_used = GREATEST(disk_used - ${current.disk}, 0),
        nat_ports_used_count = GREATEST(nat_ports_used_count - ${ports}, 0) WHERE id = ${current.hostId}`
      if (networkModeNeedsPublicIpv4(current.networkMode)) await db.releasePublicIpv4ForInstance(tx, instanceId)
    }, { timeout: 45000 })
  } catch (error) {
    await db.createLog(initial.userId, 'instance', 'instance.create', `实例 ${instanceId} 开通失败；远端清理或账务待确认，资源继续占用，系统自动重试`,
      'failed', { instanceId }).catch(() => undefined)
  }
  return true
}
