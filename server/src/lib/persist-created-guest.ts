import type { IncusClient } from './incus/incus-client.js'
import { prisma } from '../db/prisma.js'
import { instanceTermExpired } from './instance-expiry.js'

/** Ordinary legacy creation also records the exact guest before first boot. */
export async function persistCreatedGuestIdentity(client:IncusClient,instanceId:number,name:string){
  const remote=await client.request<{name:string;created_at:string;config:Record<string,string>}>('GET',`/1.0/instances/${encodeURIComponent(name)}`)
  if(remote.name!==name||!/^[a-f0-9-]{36}$/i.test(remote.config?.['volatile.uuid']||'')||!Number.isFinite(Date.parse(remote.created_at)))throw Error('CREATED_GUEST_IDENTITY_MISSING')
  await prisma.$transaction(async tx=>{
    await tx.$queryRaw`SELECT id FROM instances WHERE id=${instanceId} FOR UPDATE`
    const row=await tx.instance.findUniqueOrThrow({where:{id:instanceId}})
    if(row.incusId!==name||row.status==='deleted'||instanceTermExpired(row))throw Error('CREATED_GUEST_BINDING_CHANGED')
    await tx.instance.update({where:{id:instanceId},data:{snapshottedSpecs:{...(row.snapshottedSpecs as Record<string,any>||{}),
      recoveryIdentity:{uuid:remote.config['volatile.uuid'],createdAt:remote.created_at,project:'default'}}}})
  })
}
