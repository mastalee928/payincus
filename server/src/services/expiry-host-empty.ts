import type { IncusClient } from '../lib/incus/incus-client.js'
import { IncusApiError } from '../lib/incus/incus-client.js'
import { verifyInstanceDeleted } from '../lib/incus/verify-instance-deleted.js'
import { settleExpiredGuestOperations } from './expiry-operation-recovery.js'

/** Dedicated one-customer host only, while its DB allocation row is locked.
 * Restore/rebuild copies and stray projects must not survive expiry resale. */
export async function emptyExpiredDedicatedHost(transport:IncusClient,allowed:()=>Promise<void>,signal:AbortSignal):Promise<void>{
  const guests=await transport.request<Array<{name:string;project?:string;status?:string}>>('GET','/1.0/instances?recursion=1&all-projects=true',null,8000,signal)
  if(!Array.isArray(guests))throw Error('EXPIRY_HOST_LIST_UNVERIFIED')
  const failures:unknown[]=[]
  for(const guest of guests){
    try{
    await allowed()
    const project=guest.project||'default',suffix=project==='default'?'':`?project=${encodeURIComponent(project)}`
    const base=`/1.0/instances/${encodeURIComponent(guest.name)}`,path=base+suffix
    const client=transport.withExpiryAccess(guest.name,allowed,true,project)
    if(guest.status!=='Stopped')try{await client.request('PUT',base+'/state'+suffix,{action:'stop',force:true,timeout:5},8000,signal)}catch{/* DELETE still attempts exact listed target. */}
    try{await client.request('DELETE',path,null,8000,signal)}catch(e){
      let absent=false
      try{await client.request('GET',path,null,8000,signal)}catch(readError){absent=readError instanceof IncusApiError&&readError.statusCode===404&&readError.path===path}
      if(!absent){
        await settleExpiredGuestOperations(client,guest.name,signal)
        try{await client.request('PUT',base+'/state'+suffix,{action:'stop',force:true,timeout:5},8000,signal)}catch{/* retry deletion */}
        await client.request('DELETE',path,null,8000,signal)
      }
    }
    if(project==='default')await verifyInstanceDeleted(transport,guest.name)
    else{
      const pools=await transport.request<Array<{name:string}>>('GET','/1.0/storage-pools?recursion=1',null,8000,signal)
      if(!Array.isArray(pools))throw Error('EXPIRY_PROJECT_STORAGE_UNVERIFIED')
      for(const pool of pools){
        const volumes=await transport.request<Array<{name:string;type:string;project?:string}>>('GET',`/1.0/storage-pools/${encodeURIComponent(pool.name)}/volumes?recursion=1&all-projects=true`,null,8000,signal)
        if(!Array.isArray(volumes)||volumes.some(v=>v.project===project&&['container','virtual-machine'].includes(v.type)&&(v.name===guest.name||v.name.startsWith(guest.name+'/'))))throw Error('EXPIRY_PROJECT_DISK_NOT_RELEASED')
      }
    }
    }catch(e){failures.push(e)}
  }
  const remaining=await transport.request<unknown[]>('GET','/1.0/instances?all-projects=true',null,8000,signal)
  if(!Array.isArray(remaining)||remaining.length)throw Error('EXPIRY_HOST_NOT_EMPTY')
  // The final list verifies absence after lost responses; disk checks remain
  // independent, including projects whose DELETE returned an error.
  if(failures.length){
    const pools=await transport.request<Array<{name:string}>>('GET','/1.0/storage-pools?recursion=1',null,8000,signal)
    if(!Array.isArray(pools))throw Error('EXPIRY_STORAGE_UNVERIFIED')
    for(const pool of pools){
      const volumes=await transport.request<Array<{name:string;type:string;project?:string}>>('GET',`/1.0/storage-pools/${encodeURIComponent(pool.name)}/volumes?recursion=1&all-projects=true`,null,8000,signal)
      if(!Array.isArray(volumes)||volumes.some(v=>['container','virtual-machine'].includes(v.type)))throw Error('EXPIRY_HOST_DISK_NOT_RELEASED')
    }
    for(const guest of guests){if((guest.project||'default')==='default')await verifyInstanceDeleted(transport,guest.name)}
  }
}
