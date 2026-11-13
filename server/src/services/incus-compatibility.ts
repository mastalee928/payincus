import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { getIncusClient } from '../lib/incus/incus-pool.js'
import { getHostById } from '../db/hosts.js'
import { registeredGuestIdentity } from '../lib/registered-guest-identity.js'
import { transferHostIdentity } from '../lib/transfer-host-identity.js'
import { INSTANCE_OPERATION_LOCK_NAMESPACE, tryAdvisoryTransactionLock } from '../db/advisory-locks.js'
import { hostMaintenanceBlocked } from '../lib/host-maintenance-gate.js'
import { withHostMaintenanceLane } from '../lib/host-operation-lane.js'
import { lockCurrentHostAgent, type HostAgentRecord } from '../lib/host-agent-credentials.js'
import { recoveryHeld } from './platform-backup-core.js'
const record=(v:unknown):Record<string,any>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,any>:{}
type Fence={version:1;requestId:string;hostIdentity:string;phase:'prepared'|'verified';binaryHash:string;instances:Array<{id:number;name:string;uuid:string;state:string}>}

/** A durable host fence prevents new writes before the Agent's graceful daemon
 * reload. Existing paid guests stay running; deadlines and stop/delete intent
 * are handled by the normal expiry capability rather than being waived. */
export async function incusCompatibilityPermit(agent:HostAgentRecord) {
 if(recoveryHeld()||!Array.isArray(agent.capabilities)||!agent.capabilities.includes('incus-sysinfo-compat-v1'))return null
 const report=record(record(agent.lastReport).hostProvisioningStatus)
 if(!['needed','pending','verified'].includes(report.incusCompat))return null
 if(!/^[a-f0-9]{64}$/.test(report.compatHash||''))return null
 const original=await prisma.host.findUniqueOrThrow({where:{id:agent.hostId}})
 if(!original.singleTenant||original.status!=='online'||original.installPending||original.poolFaulted)return null
 const saved=record(original.securityHardening),existing=record(saved.incusCompat) as Fence
 if(hostMaintenanceBlocked(original.securityHardening)&&existing.version!==1)return null
 const rows=await prisma.instance.findMany({where:{hostId:agent.hostId,status:{not:'deleted'}},orderBy:{id:'asc'}})
 const connect=async()=>{const target=await getHostById(agent.hostId);if(!target)throw Error('COMPAT_HOST_MISSING');return getIncusClient(target,prisma,5000)}
 return withHostMaintenanceLane(agent.hostId,()=>prisma.$transaction(async tx=>{
  await tx.$executeRaw`SET LOCAL lock_timeout='2s'`
  for(const row of rows){if(!await tryAdvisoryTransactionLock(tx,INSTANCE_OPERATION_LOCK_NAMESPACE,row.id))return null;await tx.$queryRaw`SELECT id FROM instances WHERE id=${row.id} FOR UPDATE`}
  await lockCurrentHostAgent(tx,agent,'host')
  const host=await tx.host.findUniqueOrThrow({where:{id:agent.hostId}}),state=record(host.securityHardening),fence=record(state.incusCompat) as Fence
  if(recoveryHeld()||transferHostIdentity(host)!==transferHostIdentity(original))return null
  if(fence.version===1 && report.incusCompat==='verified' && report.compatRequest===fence.requestId &&
    fence.hostIdentity===transferHostIdentity(host) && fence.binaryHash===report.compatHash){
    const client=await connect()
    // The owner's newer stop/expiry/delete intent can legitimately change the
    // old baseline while the daemon reload is finishing. Verify current
    // bindings instead of retaining an obsolete state fence forever.
    const current=await tx.instance.findMany({where:{hostId:host.id,status:{not:'deleted'}}})
    for(const row of current){const saved=fence.instances.find(i=>i.id===row.id&&i.name===row.incusId);if(!saved)return null;const identity=await registeredGuestIdentity(tx,row,host);if(identity.uuid!==saved.uuid)return null;const remote=await client.request<{config?:Record<string,string>}>('GET',`/1.0/instances/${encodeURIComponent(row.incusId)}`,null,5000);if(remote.config?.['volatile.uuid']!==saved.uuid)return null}
    await tx.host.update({where:{id:host.id},data:{securityHardening:{...state,incusCompat:{...fence,phase:'verified'}} as Prisma.InputJsonValue}})
    return null
  }
  if(recoveryHeld()||transferHostIdentity(host)!==transferHostIdentity(original)||
   await tx.instanceTask.count({where:{status:{in:['PENDING','PROCESSING']},OR:[{hostId:host.id},{targetHostId:host.id}]}})||
   await tx.restoreTask.count({where:{hostId:host.id,status:{in:['PENDING','PROCESSING']}}})||
   await tx.backupUploadTask.count({where:{hostId:host.id,status:{in:['PENDING','PROCESSING']}}})||
   await tx.checkoutReservation.count({where:{hostId:host.id}}))return null
  const occupants=await tx.instance.findMany({where:{hostId:host.id,status:{not:'deleted'}},orderBy:{id:'asc'}})
  if(occupants.length!==rows.length||occupants.some((i,n)=>i.id!==rows[n].id||i.incusId!==rows[n].incusId||i.userId!==rows[n].userId||!['running','stopped'].includes(i.status)))return null
  if(fence.version===1&&report.incusCompat==='pending'&&report.compatRequest!==fence.requestId)return null
  if(fence.version===1&&fence.phase==='prepared'&&report.incusCompat==='pending'&&report.compatRequest===fence.requestId&&fence.hostIdentity===transferHostIdentity(host)&&fence.binaryHash===report.compatHash){
   // The daemon may be down after an interrupted reload. Waiting for its API
   // before returning the original permit would deadlock Agent recovery. The
   // authenticated Agent validates the saved daemon/guest journal locally;
   // keep the durable host fence until its verified receipt and remote check.
   const current=[]
   for(const row of occupants){const previous=fence.instances.find(i=>i.id===row.id&&i.name===row.incusId),identity=await registeredGuestIdentity(tx,row,host),state=row.status==='running'?'Running':'Stopped';if(!previous||identity.uuid!==previous.uuid||!(state===previous.state||previous.state==='Running'&&state==='Stopped'))return null;current.push({...previous,state})}
   return {requestId:fence.requestId,hostIdentity:fence.hostIdentity,guests:current.map(i=>({name:i.name,uuid:i.uuid,state:i.state})),expiresAt:new Date(Date.now()+240000).toISOString()}
  }
  const client=await connect()
  const instances=[]
  for(const row of occupants){const identity=await registeredGuestIdentity(tx,row,host);if(!identity.uuid)return null;const remote=await client.request<{config?:Record<string,string>;status?:string}>('GET',`/1.0/instances/${encodeURIComponent(row.incusId)}`,null,5000);if(remote.config?.['volatile.uuid']!==identity.uuid||remote.status!==(row.status==='running'?'Running':'Stopped'))return null;instances.push({id:row.id,name:row.incusId,uuid:identity.uuid,state:remote.status})}
  if(fence.version===1){
   if(fence.hostIdentity!==transferHostIdentity(host)||fence.binaryHash!==report.compatHash)return null
   if(instances.some(i=>!fence.instances.some(old=>old.id===i.id&&old.name===i.name&&old.uuid===i.uuid&&(old.state===i.state||old.state==='Running'&&i.state==='Stopped'))))return null
   if(JSON.stringify(fence.instances)!==JSON.stringify(instances)){fence.instances=instances;await tx.host.update({where:{id:host.id},data:{securityHardening:{...state,incusCompat:fence} as Prisma.InputJsonValue}})}
   if(report.incusCompat==='verified'&&report.compatRequest===fence.requestId){await tx.host.update({where:{id:host.id},data:{securityHardening:{...state,incusCompat:{...fence,phase:'verified'}} as Prisma.InputJsonValue}});return null}
   if(fence.phase==='verified')return null
   return {requestId:fence.requestId,hostIdentity:fence.hostIdentity,guests:fence.instances.map(i=>({name:i.name,uuid:i.uuid,state:i.state})),expiresAt:new Date(Date.now()+240000).toISOString()}
  }
  if(report.incusCompat!=='needed'||hostMaintenanceBlocked(host.securityHardening))return null
  const ops=await client.request<Record<string,unknown[]>>('GET','/1.0/operations?recursion=1',null,5000)
  if(!ops||!Object.values(ops).every(Array.isArray)||Object.values(ops).flat().some(op=>!op||typeof op!=='object'||!['Success','Failure','Cancelled'].includes(String((op as {status?:string}).status))))return null
  const next:Fence={version:1,requestId:randomUUID(),hostIdentity:transferHostIdentity(host),phase:'prepared',binaryHash:report.compatHash,instances}
  await tx.host.update({where:{id:host.id},data:{securityHardening:{...state,incusCompat:next} as Prisma.InputJsonValue}})
  return {requestId:next.requestId,hostIdentity:next.hostIdentity,guests:next.instances.map(i=>({name:i.name,uuid:i.uuid,state:i.state})),expiresAt:new Date(Date.now()+240000).toISOString()}
 },{maxWait:2000,timeout:20000}))
}
