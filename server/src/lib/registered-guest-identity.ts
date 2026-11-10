import type { Host, Instance, Prisma } from '@prisma/client'
import { transferHostIdentity } from './transfer-host-identity.js'

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

/** Only persisted delivery/recovery proof may identify a lifecycle target.
 * Today's same-name guest is never sufficient to establish that proof. */
export async function registeredGuestIdentity(database: Pick<Prisma.TransactionClient, 'instanceTask'>,
  instance: Pick<Instance, 'id' | 'incusId' | 'snapshottedSpecs'>, host: Host) {
  const specs = record(instance.snapshottedSpecs)
  const replacement = await database.instanceTask.findFirst({ where: { instanceId: instance.id,
    OR: [{ status: 'COMPLETED' }, { AND: [
      { replacementState: { path: ['targetIncusId'], equals: instance.incusId } },
      { OR: [{ replacementState: { path: ['targetPhase'], equals: 'verified' } }, { replacementState: { path: ['targetPhase'], equals: 'source_cleanup' } }] }
    ] }],
    taskType: { in: ['replace_host', 'change_host', 'rebuild', 'recreate'] } }, orderBy: { id: 'desc' } })
  const replaced = record(replacement?.replacementState)
  const saved = record(specs.recoveryIdentity ?? specs.managedCleanup)
  const durableSwitch = replacement?.status === 'COMPLETED' || (['verified', 'source_cleanup'].includes(String(replaced.targetPhase)) &&
    replaced.targetUuid === saved.uuid && replaced.targetCreatedAt === saved.createdAt)
  const identity = replacement ? (durableSwitch && replaced.targetHostIdentity === transferHostIdentity(host) &&
    replaced.targetIncusId === instance.incusId && replacement.targetHostId === host.id
    ? { uuid: replaced.targetUuid, createdAt: replaced.targetCreatedAt } : {}) : saved
  return {
    uuid: typeof identity.uuid === 'string' ? identity.uuid : null,
    createdAt: typeof identity.createdAt === 'string' ? identity.createdAt : null
  }
}
