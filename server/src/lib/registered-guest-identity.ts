import type { Host, Instance, Prisma } from '@prisma/client'
import { transferHostIdentity } from './transfer-host-identity.js'
import { sameGuestCreationTime } from './guest-identity-time.js'

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

/** Only persisted delivery/recovery proof may identify a lifecycle target.
 * Today's same-name guest is never sufficient to establish that proof. */
export async function registeredGuestIdentity(database: Pick<Prisma.TransactionClient, 'instanceTask'> & Partial<Pick<Prisma.TransactionClient,'restoreTask'>>,
  instance: Pick<Instance, 'id' | 'incusId' | 'snapshottedSpecs'>, host: Host) {
  const specs = record(instance.snapshottedSpecs)
  const replacement = await database.instanceTask.findFirst({ where: { instanceId: instance.id,
    OR: [{ status: 'COMPLETED' }, { AND: [
      { replacementState: { path: ['targetIncusId'], equals: instance.incusId } },
      { OR: [{ replacementState: { path: ['targetPhase'], equals: 'verified' } }, { replacementState: { path: ['targetPhase'], equals: 'source_cleanup' } }] }
    ] }],
    taskType: { in: ['replace_host', 'change_host', 'rebuild', 'recreate'] } }, orderBy: { id: 'desc' } })
  const replaced = record(replacement?.replacementState)
  const recovery = record(specs.recoveryIdentity), cleanup = record(specs.managedCleanup)
  const saved = typeof recovery.uuid === 'string' && recovery.uuid ? recovery : cleanup
  // A later successful restore replaces the old guest without an instanceTask.
  // Its durable imported UUID is proof; unrelated/unfinished restores are not.
  const restored = database.restoreTask ? await database.restoreTask.findFirst({where:{instanceId:instance.id,status:'COMPLETED',hostId:host.id,
    originalIncusId:instance.incusId},orderBy:{id:'desc'}}) : null
  const restoreState=record(restored?.recoveryState), restoredIdentity=record(restoreState.restored)
  if(restored?.finishedAt && (!replacement?.finishedAt || restored.finishedAt>replacement.finishedAt) && typeof restoredIdentity.uuid==='string'){
    return {uuid:restoredIdentity.uuid,createdAt:typeof restoredIdentity.createdAt==='string'?restoredIdentity.createdAt:
      restoredIdentity.uuid===saved.uuid && typeof saved.createdAt==='string'?saved.createdAt:null}
  }
  // Historical in-place rebuilds keep Incus UUID and creation time. Older
  // workers recorded an empty task state, which must not erase the existing
  // delivery proof. A recreation/migration or any partial identity receipt
  // still requires its own verified target and must never use this fallback.
  const legacyInPlaceRebuild = replacement?.taskType === 'rebuild' && replacement.status === 'COMPLETED' &&
    replacement.hostId === host.id && (replacement.targetHostId === null || replacement.targetHostId === host.id) &&
    (replacement.replacementState === null || typeof replacement.replacementState === 'object' &&
    !Array.isArray(replacement.replacementState) && Object.keys(replaced).length === 0)
  const durableSwitch = replacement?.status === 'COMPLETED' || (['verified', 'source_cleanup'].includes(String(replaced.targetPhase)) &&
    replaced.targetUuid === saved.uuid && sameGuestCreationTime(replaced.targetCreatedAt, saved.createdAt))
  const identity = !replacement || legacyInPlaceRebuild ? saved : (durableSwitch && replaced.targetHostIdentity === transferHostIdentity(host) &&
    replaced.targetIncusId === instance.incusId && replacement.targetHostId === host.id
    ? { uuid: replaced.targetUuid, createdAt: replaced.targetCreatedAt } : {})
  return {
    uuid: typeof identity.uuid === 'string' ? identity.uuid : null,
    createdAt: typeof identity.createdAt === 'string' ? identity.createdAt : null
  }
}
