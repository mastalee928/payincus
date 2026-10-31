import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { compensateFailedInstancePurchase } from '../db/instance-provisioning-compensation.js'
import { createLog } from '../db/logs.js'
import { notifyAdminInstanceCreateFailed } from '../lib/admin-alerts.js'
import { getIncusClient } from '../lib/incus/index.js'
import { cleanupManagedInstanceRemote, managedCleanupEndpointHash } from '../lib/managed-cleanup-identity.js'
import type { IncusClient, IncusRequestConditions } from '../lib/incus/incus-client.js'
import type { IncusInstance } from '../types/incus.js'
import type { Host } from '../types/database.js'

const active = new Map<number, AbortController>()
export class PoolProvisionOwnershipError extends Error {}
type Specs = Record<string, unknown> & { poolProvision?: { version?: number; phase?: string }; managedCleanup?: { attempt?: string; endpointHash?: string; uuid?: string } }

/** A durable attempt is installed before the first remote write. Every later
 * request is fenced by the original order and identity, including after timeouts. */
export async function beginPoolProvision(instanceId: number, host: Host, client: IncusClient, name: string) {
  const instance = await prisma.instance.findUniqueOrThrow({ where: { id: instanceId } })
  if (!instance.purchaseBatchId) return null
  const attempt = randomUUID(), controller = new AbortController()
  const endpoint = await prisma.host.findUniqueOrThrow({ where: { id: host.id }, select: { url: true } })
  const specs = (instance.snapshottedSpecs || {}) as Specs
  if (specs.poolProvision?.phase === 'creating') throw new PoolProvisionOwnershipError('Pool creation already started')
  const claimed = await prisma.instance.updateMany({ where: { id: instanceId, userId: instance.userId, hostId: host.id, incusId: name,
    status: 'creating', provisioningCleanupPending: false, snapshottedSpecs: { equals: instance.snapshottedSpecs ?? Prisma.DbNull } },
    data: { snapshottedSpecs: { ...specs, poolProvision: { version: 1, phase: 'creating' },
      managedCleanup: { attempt, endpointHash: managedCleanupEndpointHash(client) } } as Prisma.InputJsonValue } })
  if (claimed.count !== 1) throw new PoolProvisionOwnershipError('Pool creation no longer owns the target')
  active.set(instanceId, controller)
  let uuid: string | undefined
  const check = async () => {
    controller.signal.throwIfAborted()
    const current = await prisma.instance.findUnique({ where: { id: instanceId } })
    if (!current || current.status !== 'creating' || current.provisioningCleanupPending || current.hostId !== host.id ||
      current.incusId !== name || current.userId !== instance.userId ||
      (current.snapshottedSpecs as Specs)?.managedCleanup?.attempt !== attempt) throw new PoolProvisionOwnershipError('Pool creation was cancelled or replaced')
    const latestEndpoint = await prisma.host.findUnique({ where: { id: host.id }, select: { url: true } })
    if (!latestEndpoint || latestEndpoint.url !== endpoint.url) throw new Error('Pool host endpoint changed during creation')
  }
  const identity = async () => {
    const remote = await client.request<IncusInstance>('GET', `/1.0/instances/${encodeURIComponent(name)}`, null, 10000, controller.signal)
    const actualUuid = remote.config?.['volatile.uuid']
    if (remote.name !== name || remote.config?.['user.payincus.provisioning-attempt'] !== attempt ||
      !actualUuid || !/^[a-f0-9-]{36}$/i.test(actualUuid) || (uuid && uuid !== actualUuid)) throw new Error('Pool remote creation identity does not match')
    if (!uuid) {
      const current = await prisma.instance.findUniqueOrThrow({ where: { id: instanceId } })
      const currentSpecs = current.snapshottedSpecs as Specs
      if (currentSpecs.managedCleanup?.attempt !== attempt) throw new Error('Pool creation identity was replaced')
      const saved = await prisma.instance.updateMany({ where: { id: instanceId, status: 'creating', provisioningCleanupPending: false,
        snapshottedSpecs: { equals: current.snapshottedSpecs! } }, data: { snapshottedSpecs: {
          ...currentSpecs, managedCleanup: { ...currentSpecs.managedCleanup, uuid: actualUuid }
        } as Prisma.InputJsonValue } })
      if (!saved.count) throw new Error('Pool creation was finalized before identity confirmation')
    }
    uuid = actualUuid
  }
  const guarded = new Proxy(client, { get(target, property) {
    if (property === 'request') return async <T>(method: string, path: string, body: unknown = null, timeout = 120000, signal?: AbortSignal, conditions?: IncusRequestConditions) => {
      await check()
      if (method !== 'GET' && path !== '/1.0/instances') await identity()
      await check()
      return target.request<T>(method, path, body, timeout, signal ? AbortSignal.any([signal, controller.signal]) : controller.signal, conditions)
    }
    const value = Reflect.get(target, property)
    return typeof value === 'function' ? value.bind(target) : value
  } })
  const complete = async (data: Prisma.InstanceUpdateManyMutationInput) => {
    await check(); await identity(); await check()
    return prisma.instance.updateMany({ where: { id: instanceId, userId: instance.userId, hostId: host.id, incusId: name,
      status: 'creating', provisioningCleanupPending: false,
      snapshottedSpecs: { path: ['managedCleanup', 'attempt'], equals: attempt } }, data })
  }
  return { attempt, client: guarded, check, identity, complete, finish: () => { if (active.get(instanceId) === controller) active.delete(instanceId) } }
}

/** Refunds are independent from cleanup. Stock and addresses stay occupied until
 * both the original remote attempt and its purchase accounting are settled. */
export async function failPoolProvision(instanceId: number, host: Host | null, reason: string): Promise<boolean> {
  const instance = await prisma.instance.findUnique({ where: { id: instanceId } })
  if (!instance?.purchaseBatchId) return false
  if (!['creating', 'error'].includes(instance.status)) return true
  const target = { id: instanceId, userId: instance.userId, hostId: instance.hostId, incusId: instance.incusId }
  const claimed = await prisma.instance.updateMany({ where: { ...target, status: { in: ['creating', 'error'] } },
    data: { status: 'error', provisioningCleanupPending: true, dedicatedNetworkReady: false } })
  if (!claimed.count) return true
  // A host that could not deliver must be inspected before another customer
  // buys it, even after its previous allocation and refund are fully settled.
  await prisma.host.update({ where: { id: instance.hostId }, data: { poolFaulted: true } })
  const firstFailure = instance.status === 'creating'
  active.get(instanceId)?.abort(new Error('Pool provisioning failed or timed out'))
  let billingSettled = false, refundAmount = 0
  try {
    const result = await compensateFailedInstancePurchase(instanceId, instance.userId, instance.hostId)
    const purchase = await prisma.instanceBillingRecord.findFirst({ where: { instanceId, userId: instance.userId, type: 'newPurchase' }, orderBy: { createdAt: 'asc' } })
    billingSettled = result.refunded || result.reason === 'already_refunded' || (!!purchase && Number(purchase.amount) === 0)
    refundAmount = result.refundAmount
  } catch (error) { console.error('[PoolProvision] Purchase refund pending', instanceId, error) }
  const deadline = Date.now() + 30000
  try {
    const originalSpecs = (instance.snapshottedSpecs || {}) as Specs
    // Establish TLS outside the cleanup transaction; a slow or unavailable host
    // must never occupy a transaction connection while connecting.
    const cleanupClient = originalSpecs.poolProvision?.phase === 'prepared' || !host ? null : await getIncusClient(host)
    if (Date.now() >= deadline) throw new Error('Pool cleanup deadline exceeded')
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM instances WHERE id = ${instanceId} FOR UPDATE`
      const current = await tx.instance.findFirst({ where: { ...target, status: 'error', provisioningCleanupPending: true } })
      if (!current) return
      const currentSpecs = (current.snapshottedSpecs || {}) as Specs
      const prepared = currentSpecs.poolProvision?.version === 1 && currentSpecs.poolProvision.phase === 'prepared'
      if (!prepared) {
        const identity = currentSpecs.managedCleanup
        if (!host || host.id !== instance.hostId || !identity?.attempt || !/^[a-f0-9-]{36}$/i.test(identity.attempt)) throw new Error('Original creation identity unavailable')
        const client = cleanupClient
        if (!client) throw new Error('Original Incus connection unavailable')
        if (Date.now() >= deadline) throw new Error('Pool cleanup deadline exceeded')
        if (managedCleanupEndpointHash(client) !== identity.endpointHash) throw new Error('Original host endpoint changed')
        await cleanupManagedInstanceRemote(client, instance.incusId, identity.attempt, deadline, identity.uuid)
      }
      if (!billingSettled || current.deletionBillingPending) throw new Error('Purchase accounting remains unsettled')
      await tx.instance.update({ where: { id: instanceId }, data: { status: 'deleted', provisioningCleanupPending: false,
        snapshottedSpecs: { ...currentSpecs, poolProvision: { version: 1, phase: 'failed' } } as Prisma.InputJsonValue } })
      await tx.ipAddress.deleteMany({ where: { instanceId } })
      if (current.ipv4) await tx.natIpv4Reservation.deleteMany({ where: { hostId: current.hostId, address: current.ipv4 } })
      await tx.$executeRaw`UPDATE hosts SET cpu_used = GREATEST(cpu_used - ${current.cpu}, 0),
        memory_used = GREATEST(memory_used - ${current.memory}, 0), disk_used = GREATEST(disk_used - ${current.disk}, 0) WHERE id = ${instance.hostId}`
    }, { timeout: 45000 })
  } catch (error) {
    await createLog(instance.userId, 'instance', 'instance.create',
      `Pool creation ${instanceId} cleanup pending; inventory retained: ${error instanceof Error ? error.message : 'unknown'}`,
      'failed', { instanceId }).catch(() => undefined)
  }
  console.warn('[PoolProvision] Creation failed', instanceId, reason)
  if (firstFailure) {
    void notifyAdminInstanceCreateFailed({ userId: instance.userId, instanceId, errorMessage: reason,
      refundStatus: billingSettled ? (refundAmount > 0 ? 'refunded' : 'not_required') : 'failed', refundAmount }).catch(() => undefined)
    const { sendNotification } = await import('../lib/notifier.js')
    await sendNotification(instance.userId, 'instance_create_failed', { instanceName: instance.name,
      error: '实例开通失败，如需帮助请发工单' }).catch(() => undefined)
  }
  return true
}
