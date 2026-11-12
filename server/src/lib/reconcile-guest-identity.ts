import type { Host, Instance, Prisma } from '@prisma/client'
import type { IncusClient } from './incus/incus-client.js'
import { registeredGuestIdentity } from './registered-guest-identity.js'
import { sameGuestCreationTime, guestIdentityInstant } from './guest-identity-time.js'

/** Old delivery receipts sometimes kept only UUID. Complete that exact proof,
 * never learn a different UUID from a same-name guest. */
export async function reconcileRegisteredGuestIdentity(database:Pick<Prisma.TransactionClient,'instanceTask'|'instance'> & Partial<Pick<Prisma.TransactionClient,'restoreTask'>>,
  client:Pick<IncusClient,'request'>, instance:Instance, host:Host) {
  const identity=await registeredGuestIdentity(database,instance,host)
  if(!identity.uuid) return identity
  const remote=await client.request<{name:string;project?:string;created_at?:string;config?:Record<string,string>}>('GET',`/1.0/instances/${encodeURIComponent(instance.incusId)}`)
  if(remote.name!==instance.incusId || (remote.project||'default')!=='default' || remote.config?.['volatile.uuid']!==identity.uuid ||
    !remote.created_at || !guestIdentityInstant(remote.created_at) || identity.createdAt && !sameGuestCreationTime(identity.createdAt,remote.created_at))throw Error('GUEST_CURRENT_IDENTITY_CHANGED')
  if(!identity.createdAt){
    const specs=instance.snapshottedSpecs as Prisma.JsonObject|null
    await database.instance.updateMany({where:{id:instance.id,hostId:host.id,incusId:instance.incusId,version:instance.version},
      data:{snapshottedSpecs:{...(specs||{}),recoveryIdentity:{uuid:identity.uuid,createdAt:remote.created_at,project:'default'}}}})
  }
  return {uuid:identity.uuid,createdAt:remote.created_at}
}
