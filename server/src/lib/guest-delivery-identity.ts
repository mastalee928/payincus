import type { Host, Instance, Prisma } from '@prisma/client'
import type { IncusClient } from './incus/incus-client.js'
import { registeredGuestIdentity } from './registered-guest-identity.js'
import { managedCleanupEndpointHash } from './managed-cleanup-identity.js'
import type { IncusInstance } from '../types/incus.js'
import { prisma } from '../db/prisma.js'
import { assertCopyMoveAuthority } from '../db/instance-tasks.js'
import type { InstanceTask } from '@prisma/client'
import { transferHostIdentity } from './transfer-host-identity.js'
import { sameGuestCreationTime } from './guest-identity-time.js'

/** Recheck the persisted actor and both host identities before each dispatch. */
export function guardCopyMoveClient(original: IncusClient, task: InstanceTask, host: Host) {
  return new Proxy(original, { get(object, property) {
    if (property === 'request') return async (...args: Parameters<IncusClient['request']>) => {
      await prisma.$transaction(async tx => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '2s'`
        await assertCopyMoveAuthority(tx, task)
        if (transferHostIdentity(await tx.host.findUniqueOrThrow({ where: { id: host.id } })) !== transferHostIdentity(host)) throw Error('COPY_MOVE_HOST_CHANGED')
      }, { timeout: 10000 })
      if (args[0] !== 'GET') {
        const state = (await prisma.instanceTask.findUniqueOrThrow({ where: { id: task.id } })).replacementState as Record<string, any> | null
        if (args[1] === '/1.0/instances' && args[0] === 'POST') {
          const instance = await prisma.instance.findUniqueOrThrow({ where: { id: task.instanceId } })
          if (task.taskType === 'clone' && (await readRegisteredGuest(prisma, original, instance, host)).status !== 'Stopped') throw Error('CLONE_SOURCE_NOT_STOPPED')
        } else if (state?.targetIncusId && (args[1] === `/1.0/instances/${encodeURIComponent(state.targetIncusId)}` ||
          args[1].startsWith(`/1.0/instances/${encodeURIComponent(state.targetIncusId)}/`))) {
          const identity = await readCreatedGuest(original, state.targetIncusId, state.targetAttempt, state.targetType, state.targetUuid)
          if (state.targetCreatedAt && identity.recoveryIdentity.createdAt !== state.targetCreatedAt) throw Error('COPY_MOVE_TARGET_CHANGED')
        }
      }
      const remaining = 30 * 60000 - (Date.now() - task.startedAt!.getTime())
      if (remaining <= 0) throw Error('COPY_MOVE_DEADLINE')
      args[3] = Math.min(args[3] ?? 120000, remaining)
      return object.request(...args)
    }
    const value = Reflect.get(object, property)
    return typeof value === 'function' ? value.bind(object) : value
  } })
}

type Remote = IncusInstance & { created_at: string; project?: string }
export async function readRegisteredGuest(database: Pick<Prisma.TransactionClient, 'instanceTask' | 'package'>, client: IncusClient, instance: Instance, host: Host) {
  const expected = await registeredGuestIdentity(database, instance, host)
  if (!expected.uuid || !expected.createdAt) throw Error('GUEST_DELIVERY_SOURCE_IDENTITY_MISSING')
  const pkg = instance.packageId ? await database.package.findUnique({ where: { id: instance.packageId } }) : null
  const expectedType = pkg?.instanceType === 'vm' ? 'virtual-machine' : 'container'
  const cleanup = (instance.snapshottedSpecs as { managedCleanup?: { uuid?: string; attempt?: string; endpointHash?: string } } | null)?.managedCleanup
  const remote = await client.request<Remote>('GET', `/1.0/instances/${encodeURIComponent(instance.incusId)}`)
  if (remote.name !== instance.incusId || remote.config?.['volatile.uuid'] !== expected.uuid ||
    remote.type !== expectedType || !sameGuestCreationTime(remote.created_at,expected.createdAt) || (remote.project || 'default') !== 'default' ||
    cleanup?.uuid === expected.uuid && (cleanup.endpointHash !== managedCleanupEndpointHash(client) ||
      cleanup.attempt !== remote.config?.['user.payincus.provisioning-attempt'])) throw Error('GUEST_DELIVERY_SOURCE_IDENTITY_CHANGED')
  return remote
}

/** The caller persists the random marker before the create/copy request. */
export async function readCreatedGuest(client: IncusClient, name: string, attempt: string, type: 'container' | 'virtual-machine', uuid?: string) {
  const remote = await client.request<Remote>('GET', `/1.0/instances/${encodeURIComponent(name)}`)
  if (remote.name !== name || remote.type !== type || (remote.project || 'default') !== 'default' ||
    !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(remote.config?.['volatile.uuid'] || '') || !Number.isFinite(Date.parse(remote.created_at)) ||
    remote.config?.['user.payincus.provisioning-attempt'] !== attempt || uuid && remote.config?.['volatile.uuid'] !== uuid) {
    throw Error('GUEST_DELIVERY_TARGET_IDENTITY_CHANGED')
  }
  return { managedCleanup: { attempt, uuid: remote.config!['volatile.uuid'], endpointHash: managedCleanupEndpointHash(client) },
    recoveryIdentity: { uuid: remote.config!['volatile.uuid'], createdAt: remote.created_at, project: 'default' } }
}
