import type { Prisma, Instance, Host } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { IncusApiError, IncusClient } from '../lib/incus/incus-client.js'
import { panelCertificatePaths, resolveCertificatePair } from '../lib/incus/certificate-paths.js'
import { instanceTermExpired } from '../lib/instance-expiry.js'
import { closeInstanceSessions } from '../lib/terminal-proxy.js'
import { recoveryScope, type RecoveryInstance } from './host-pool-recovery.js'
import { recoveryHeld } from './platform-backup-core.js'
import { settleExpiredGuestOperations } from './expiry-operation-recovery.js'

const record = (v:unknown):Record<string,any> => v && typeof v==='object' && !Array.isArray(v) ? v as Record<string,any> : {}

/** Dispatch does not depend on /1.0 discovery succeeding. Original TLS trust
 * is still checked by every request; only missing local certificate references
 * use the existing platform certificate, never generate a new identity. */
export function expiryTransport(host:Host,tx:Pick<Prisma.TransactionClient,'host'>=prisma):IncusClient {
  const pair=resolveCertificatePair(host.certPath,host.keyPath),fallback=panelCertificatePaths()
  const client=new IncusClient({...host,certPath:pair.certPath||fallback.certPath,keyPath:pair.keyPath||fallback.keyPath},tx)
  client.agent=client.createTransport({connectTimeout:8000,headersTimeout:8000,bodyTimeout:8000})
  client.connected=true
  return client
}

/** Only a fresh committed term and current DB binding select the stop target.
 * Legacy metadata and unrelated workflows cannot veto expiry enforcement. */
export async function stopExpiredCurrentGuest(instanceId:number):Promise<'renewed'|'stopped'|'absent'> {
  const scope=recoveryScope(55000)
  let owned:IncusClient|undefined
  try {
    const result=await prisma.$transaction(async tx=>{
      await tx.$executeRaw`SET LOCAL lock_timeout = '2s'`
      await tx.$queryRaw`SELECT id FROM instances WHERE id=${instanceId} FOR NO KEY UPDATE`
      const current=await tx.instance.findUnique({where:{id:instanceId}})
      if(!current || !instanceTermExpired(current))return {status:'renewed' as const}
      if(recoveryHeld())throw Error('PLATFORM_RECOVERY_HELD')
      closeInstanceSessions(instanceId,'Instance expired')
      const host=await tx.host.findUniqueOrThrow({where:{id:current.hostId}})
      const transport=owned=expiryTransport(host,tx)
      const allowed=async()=>{
        const fresh=await tx.instance.findUniqueOrThrow({where:{id:instanceId}})
        if(recoveryHeld())throw Error('PLATFORM_RECOVERY_HELD')
        if(!instanceTermExpired(fresh)||fresh.hostId!==current.hostId||fresh.incusId!==current.incusId)throw Error('EXPIRY_TERM_OR_TARGET_CHANGED')
      }
      const guarded=transport.withExpiryAccess(current.incusId,allowed)
      const client={request<T=unknown>(method:string,path:string,body:unknown=null){
        return guarded.request<T>(method,path,body,8000,scope.signal)
      }}
      const path=`/1.0/instances/${encodeURIComponent(current.incusId)}`
      const read=async()=>{
        try {return await client.request<RecoveryInstance & {ephemeral?:boolean}>('GET',path)}
        catch(e){if(e instanceof IncusApiError&&e.statusCode===404&&e.path===path)return null;throw e}
      }
      const saveBoot=async(specs:Record<string,any>,boot:Record<string,any>)=>{
        // A PostgreSQL statement error aborts its transaction. Restore the
        // savepoint so that bookkeeping errors cannot suppress physical stop.
        await tx.$executeRaw`SAVEPOINT expiry_boot_save`
        try{await tx.instance.update({where:{id:instanceId},data:{snapshottedSpecs:{...specs,expiryBoot:boot} as Prisma.InputJsonValue}})}
        catch(e){await tx.$executeRaw`ROLLBACK TO SAVEPOINT expiry_boot_save`;throw e}
        finally{await tx.$executeRaw`RELEASE SAVEPOINT expiry_boot_save`}
      }
      let before:Awaited<ReturnType<typeof read>>|undefined
      try {before=await read()}catch{/* Discovery failure still dispatches stop. */}
      if(before===null)return {status:'absent' as const}
      let bootError:unknown,bootSaveError:unknown
      if(before){
        const specs=record(current.snapshottedSpecs),old=record(specs.expiryBoot)
        const boot=old.hostId===host.id&&old.incusId===current.incusId&&old.paidUntil===current.expiresAt?.toISOString()?old:{hostId:host.id,incusId:current.incusId,paidUntil:current.expiresAt?.toISOString(),
          autostart:before.config?.['boot.autostart']??null,uuid:before.config?.['volatile.uuid']??null}
        try{await saveBoot(specs,boot)}catch(e){bootSaveError=e}
      }
      let stopError:unknown
      if(before?.status!=='Stopped'){
        try {await client.request('PUT',path+'/state',{action:'stop',force:true,timeout:5})}catch(e){stopError=e}
      }
      // An accepted stop with a lost response is confirmed, never reissued to
      // find out what happened. Actual state, not HTTP success, is the receipt.
      let after:Awaited<ReturnType<typeof read>>
      try{after=await read()}catch(e){return {error:e}}
      if(after===null)return {status:'absent' as const}
      if(after.status!=='Stopped'){
        await settleExpiredGuestOperations(guarded,current.incusId,scope.signal)
        try{await client.request('PUT',path+'/state',{action:'stop',force:true,timeout:5})}catch(e){stopError=e}
        after=await read()
        if(after===null)return {status:'absent' as const}
        if(after.status!=='Stopped')return {error:stopError||Error('EXPIRY_STOP_NOT_VERIFIED')}
      }
      if(!before){
        const specs=record(current.snapshottedSpecs)
        try{await saveBoot(specs,{hostId:host.id,incusId:current.incusId,paidUntil:current.expiresAt?.toISOString(),
          autostart:after.config?.['boot.autostart']??null,uuid:after.config?.['volatile.uuid']??null})}catch(e){bootSaveError=e}
      }
      // Keep a recoverable original boot value; stop already succeeded, and a
      // failed bookkeeping write must never lock in false as the original.
      if(bootSaveError)return {error:bootSaveError}
      if(after.config?.['boot.autostart']!=='false'){
        try {await client.request('PATCH',path,{config:{'boot.autostart':'false'}});bootError=undefined}catch(e){bootError=e}
        try{if((await read())?.config?.['boot.autostart']!=='false')return {error:bootError||Error('EXPIRY_AUTOSTART_NOT_DISABLED')}}catch(e){return {error:e}}
      }
      if(bootSaveError||bootError)return {error:bootSaveError||bootError}
      await allowed()
      await tx.$executeRaw`SAVEPOINT expiry_task_save`
      try{await tx.instanceTask.updateMany({where:{instanceId,taskType:{in:['start','restart']},status:{in:['PENDING','PROCESSING']}},
        data:{status:'FAILED',finishedAt:new Date(),error:'实例已到期，电源任务已取消'}})}
      catch(e){await tx.$executeRaw`ROLLBACK TO SAVEPOINT expiry_task_save`;return {error:e}}
      finally{await tx.$executeRaw`RELEASE SAVEPOINT expiry_task_save`}
      return {status:'stopped' as const}
    },{timeout:scope.remaining(),maxWait:3000})
    if('error' in result)throw result.error
    return result.status
  } finally{scope.close();if(owned)await owned.close()}
}

/** Deletion eligibility has exactly the same deadline as renewal admission. */
export function expiryDeleteDue(instance:Pick<Instance,'expiresAt'>,now=Date.now()):boolean {
  return !!instance.expiresAt && instance.expiresAt.getTime()+3*86400000<=now
}
