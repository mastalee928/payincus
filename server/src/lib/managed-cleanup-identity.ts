import { prisma } from '../db/prisma.js'
import { createHash } from 'node:crypto'
import { IncusApiError, type IncusClient } from './incus/incus-client.js'
import type { IncusInstance } from '../types/incus.js'
import { removeDedicatedForward } from './incus/dedicated-network.js'

/** Pending managed creations retain their original endpoint and attempt marker.
 * Legacy pending records without that evidence need operator reconciliation. */
export async function assertManagedCleanupIdentity(client: IncusClient, instanceId: number): Promise<void> {
  const instance = await prisma.instance.findUniqueOrThrow({ where: { id: instanceId } })
  if (!instance.provisioningCleanupPending) return
  const specs = instance.snapshottedSpecs as Record<string, unknown> | null
  const identity = specs?.managedCleanup as { attempt?: unknown; endpointHash?: unknown; uuid?: unknown } | undefined
  if (typeof identity?.attempt !== 'string' || !/^[a-f0-9-]{36}$/i.test(identity.attempt) || identity.endpointHash !== managedCleanupEndpointHash(client)) {
    throw new Error('创建清理身份缺失或宿主连接已变化，请先核对原宿主；记录和库存已保留')
  }
  const path = `/1.0/instances/${encodeURIComponent(instance.incusId)}`
  let remote: IncusInstance
  try { remote = await client.request<IncusInstance>('GET', path, null, 10000) }
  catch (error) {
    if (error instanceof IncusApiError && error.statusCode === 404 && error.path === path) return
    throw error
  }
  if (remote.name !== instance.incusId || remote.config?.['user.payincus.provisioning-attempt'] !== identity.attempt ||
    (identity.uuid && remote.config?.['volatile.uuid'] !== identity.uuid) ||
    !/^[a-f0-9-]{36}$/i.test(remote.config?.['volatile.uuid'] || '')) {
    throw new Error('远端同名实例不属于本次创建，请先核对原实例；记录和库存已保留')
  }
}

export function managedCleanupEndpointHash(client: IncusClient): string {
  return createHash('sha256').update(client.baseUrl).digest('hex')
}

/** Called only by a deletion owner after confirmed remote cleanup. */
export async function finalizeManagedCleanupForDeletion(instanceId: number): Promise<void> {
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM instances WHERE id = ${instanceId} FOR UPDATE`
    const instance = await tx.instance.findUniqueOrThrow({ where: { id: instanceId } })
    if (!instance.provisioningCleanupPending) return
    if (instance.status !== 'deleted') throw new Error('实例删除状态已变化，保留清理标记')
    await tx.$executeRaw`UPDATE public_ipv4_addresses SET status = 'free', instance_id = NULL, released_at = NOW(), updated_at = NOW()
      WHERE instance_id = ${instanceId} AND status = 'assigned'`
    await tx.instance.update({ where: { id: instanceId }, data: { provisioningCleanupPending: false } })
  })
}

/** Shared bounded remote cleanup for the original managed creation identity. */
export async function cleanupManagedInstanceRemote(client: IncusClient, name: string, attempt: string, deadline = Date.now() + 30000, expectedUuid?: string): Promise<void> {
  const originalClient = client
  const remaining = Math.min(30000, deadline - Date.now())
  if (remaining <= 0) throw new Error('Managed cleanup deadline exceeded')
  const signal = AbortSignal.timeout(remaining)
  const boundedClient: Pick<IncusClient, 'request'> = {
    request<T = unknown>(method: string, path: string, body: unknown = null): Promise<T> {
      signal.throwIfAborted()
      if (Date.now() >= deadline) throw new Error('Managed cleanup deadline exceeded')
      return originalClient.request<T>(method, path, body, deadline - Date.now(), signal)
    }
  }
  const path = `/1.0/instances/${encodeURIComponent(name)}`
  try {
    const remote = await boundedClient.request<IncusInstance>('GET', path)
    if (remote.name !== name || remote.config?.['user.payincus.provisioning-attempt'] !== attempt) {
      throw new Error('Remote instance does not belong to this creation attempt')
    }
    const uuid = remote.config?.['volatile.uuid']
    if (!uuid || !/^[a-f0-9-]{36}$/i.test(uuid)) throw new Error('Remote instance UUID not confirmed')
    if (expectedUuid && uuid !== expectedUuid) throw new Error('Remote instance UUID changed from the original creation')
    if (remote.status !== 'Stopped') await boundedClient.request('PUT', `${path}/state`, { action: 'stop', force: true, timeout: 20 })
    const stopped = await boundedClient.request<IncusInstance>('GET', path)
    if (stopped.name !== name || stopped.config?.['user.payincus.provisioning-attempt'] !== attempt ||
      stopped.config?.['volatile.uuid'] !== uuid || stopped.status !== 'Stopped') {
      throw new Error('Remote identity or stopped state not confirmed')
    }
    await boundedClient.request('DELETE', path)
  } catch (cleanupError) {
    // An operation/network error mentioning "not found" is not absence.
    if (!(cleanupError instanceof IncusApiError) || cleanupError.statusCode !== 404 || cleanupError.path !== path) throw cleanupError
  }
  let absent = false
  try { await boundedClient.request('GET', path) }
  catch (error) { if (error instanceof IncusApiError && error.statusCode === 404 && error.path === path) absent = true; else throw error }
  if (!absent) throw new Error('Remote deletion not confirmed')
  const operations = await boundedClient.request<unknown>('GET', '/1.0/operations?recursion=1')
  const hasPendingCreation = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(hasPendingCreation)
    if (!value || typeof value !== 'object') return false
    const operation = value as { status?: string; status_code?: number; resources?: { instances?: string[] } }
    if (operation.resources?.instances?.some(resource => new URL(resource, 'https://incus.invalid').pathname === path) &&
      !['success', 'failure', 'cancelled', 'canceled'].includes(operation.status?.toLowerCase() || '') &&
      (typeof operation.status_code !== 'number' || operation.status_code < 200)) return true
    return Object.values(value).some(hasPendingCreation)
  }
  if (hasPendingCreation(operations)) throw new Error('Remote instance operation still pending; cleanup not confirmed')
  await removeDedicatedForward(boundedClient, name)
  let forwards: Array<{ description?: string }>
  try { forwards = await boundedClient.request('GET', '/1.0/networks/incusbr0/forwards?recursion=1') }
  catch (error) {
    const networks = await boundedClient.request<string[]>('GET', '/1.0/networks')
    if (networks.includes('/1.0/networks/incusbr0')) throw error
    forwards = []
  }
  if (forwards.some(forward => forward.description === `payincus-dedicated:${name}`)) {
    throw new Error('Remote address forward deletion not confirmed')
  }
}

export async function deletePendingManagedInstance(client: IncusClient, instanceId: number): Promise<boolean> {
  const instance = await prisma.instance.findUniqueOrThrow({ where: { id: instanceId } })
  if (!instance.provisioningCleanupPending) return false
  await assertManagedCleanupIdentity(client, instanceId)
  const identity = (instance.snapshottedSpecs as { managedCleanup: { attempt: string } }).managedCleanup
  await cleanupManagedInstanceRemote(client, instance.incusId, identity.attempt, undefined,
    (instance.snapshottedSpecs as { managedCleanup: { uuid?: string } }).managedCleanup.uuid)
  return true
}
