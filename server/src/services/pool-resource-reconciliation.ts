import { prisma } from '../db/prisma.js'
import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { getHostById } from '../db/hosts.js'
import { INSTANCE_OPERATION_LOCK_NAMESPACE, tryAdvisoryTransactionLock } from '../db/advisory-locks.js'
import { getIncusClient } from '../lib/incus/incus-pool.js'
import { registeredGuestIdentity } from '../lib/registered-guest-identity.js'
import { sameGuestCreationTime } from '../lib/guest-identity-time.js'
import { transferHostIdentity } from '../lib/transfer-host-identity.js'
import { incusResourceSize } from '../lib/resource-size.js'
import { hostMaintenanceBlocked } from '../lib/host-maintenance-gate.js'
import { recoveryHeld } from './platform-backup-core.js'
import { exec } from '../lib/incus/incus-instances.js'
import { alpineGuestDnsRepairScript } from '../lib/alpine-guest-dns.js'

/** Repair only exact legacy MB limits of the original paid pool guest.
 * A quota correction does not restart or resize its filesystem or alter billing.
 */
export async function reconcilePoolInstanceResources(instanceId: number): Promise<boolean> {
  return reconcilePoolInstanceMaintenance(instanceId, 'resources')
}

/** All pool hosts are scanned, including those without public IPv6. */
export async function reconcilePoolInstanceDns(instanceId: number): Promise<boolean> {
  return reconcilePoolInstanceMaintenance(instanceId, 'dns')
}

async function reconcilePoolInstanceMaintenance(instanceId: number, kind: 'resources' | 'dns'): Promise<boolean> {
  if(recoveryHeld())return false
  const row=await prisma.instance.findUniqueOrThrow({where:{id:instanceId},include:{host:true}})
  if(!row.dedicatedIpv4||!row.host.singleTenant||!['running','stopped'].includes(row.status)||row.deletionIntent||row.provisioningCleanupPending||row.deletionBillingPending)return false
  const host=await getHostById(row.hostId)
  if(!host||row.host.status!=='online'||row.host.poolFaulted||row.host.installPending||hostMaintenanceBlocked(row.host.securityHardening))return false
  const client=await getIncusClient(host)
  return prisma.$transaction(async tx=>{
    if(!await tryAdvisoryTransactionLock(tx,INSTANCE_OPERATION_LOCK_NAMESPACE,row.id))return false
    await tx.$queryRaw`SELECT id FROM instances WHERE id=${row.id} FOR UPDATE`
    await tx.$queryRaw`SELECT id FROM hosts WHERE id=${row.hostId} FOR SHARE`
    const current=await tx.instance.findUniqueOrThrow({where:{id:row.id}}),currentHost=await tx.host.findUniqueOrThrow({where:{id:row.hostId}})
    if(recoveryHeld()||current.updatedAt.getTime()!==row.updatedAt.getTime()||current.incusId!==row.incusId||current.hostId!==row.hostId||
      current.userId!==row.userId||hostMaintenanceBlocked(currentHost.securityHardening)||transferHostIdentity(currentHost)!==transferHostIdentity(row.host)||
      await tx.instanceTask.count({where:{instanceId:row.id,status:{in:['PENDING','PROCESSING']}}})||
      await tx.restoreTask.count({where:{instanceId:row.id,status:{in:['PENDING','PROCESSING']}}})||
      await tx.backupUploadTask.count({where:{instanceId:row.id,status:{in:['PENDING','PROCESSING']}}})||
      await tx.instanceTransfer.count({where:{instanceId:row.id,status:{in:['pending','processing']}}}))return false
    const original=await registeredGuestIdentity(tx,current,currentHost)
    if(!original.uuid)return false
    const specs=current.snapshottedSpecs && typeof current.snapshottedSpecs==='object' && !Array.isArray(current.snapshottedSpecs)?current.snapshottedSpecs as Record<string,unknown>:{}
    const cleanup=specs.managedCleanup && typeof specs.managedCleanup==='object' && !Array.isArray(specs.managedCleanup)?specs.managedCleanup as Record<string,unknown>:{}
    // Early paid pool deliveries saved the UUID and trusted endpoint but not
    // Incus creation time. That durable proof still identifies the same guest
    // for bounded guest maintenance; today's same-name alone cannot.
    const legacyProof=!original.createdAt && cleanup.uuid===original.uuid &&
      cleanup.endpointHash===createHash('sha256').update(currentHost.url).digest('hex')
    if(!original.createdAt&&!legacyProof)return false
    let etag:string|undefined
    const remote=await client.request<{status?:string;type?:string;config?:Record<string,string>;devices?:Record<string,Record<string,string>>;created_at?:string}>('GET',`/1.0/instances/${encodeURIComponent(row.incusId)}`,null,5000,undefined,{onEtag:value=>{etag=value}})
    if(!etag||remote.type!=='container'||remote.config?.['volatile.uuid']!==original.uuid||
      (original.createdAt&&!sameGuestCreationTime(remote.created_at,original.createdAt)))return false
    if(kind==='dns'){
      if(current.status!=='running'||remote.status!=='Running'||current.suspendedAt||
        current.expiresAt&&current.expiresAt.getTime()<=Date.now())return false
      // Old duplicate DHCP registration was generated only for Alpine disks.
      // Avoid a remote process for every other image on each maintenance pass.
      if(!/alpine/i.test(current.image||'')&&!/alpine/i.test(remote.config['image.os']||''))return true
      const result=await exec(client.withMaintenanceDatabase(tx),row.incusId,
        ['/bin/sh','-c',`set -eu\n${alpineGuestDnsRepairScript}`],{},18000) as {return?:number}
      if(result?.return!==0)throw Error('POOL_GUEST_DNS_REPAIR_PENDING')
      return true
    }
    const roots=Object.entries(remote.devices||{}).filter(([,d])=>d.type==='disk'&&d.path==='/')
    if(roots.length!==1)return false
    const config:Record<string,string>={},devices:Record<string,Record<string,string>>={}
    if(remote.config['security.syscalls.intercept.sysinfo']!=='true')config['security.syscalls.intercept.sysinfo']='true'
    if(remote.config['limits.memory']===`${current.memory}MB`)config['limits.memory']=incusResourceSize(current.memory)
    if(roots[0][1].size===`${current.disk}MB`)devices[roots[0][0]]={...roots[0][1],size:incusResourceSize(current.disk)}
    if(!Object.keys(config).length&&!Object.keys(devices).length)return true
    await client.withMaintenanceDatabase(tx).request('PATCH',`/1.0/instances/${encodeURIComponent(row.incusId)}`,
      {...(Object.keys(config).length?{config}:{}),...(Object.keys(devices).length?{devices}:{})},8000,undefined,{ifMatch:etag})
    const checked=await client.request<{config?:Record<string,string>;devices?:Record<string,Record<string,string>>}>('GET',`/1.0/instances/${encodeURIComponent(row.incusId)}`,null,5000)
    if(checked.config?.['volatile.uuid']!==original.uuid||
      (config['security.syscalls.intercept.sysinfo']&&checked.config?.['security.syscalls.intercept.sysinfo']!=='true')||
      (config['limits.memory']&&checked.config?.['limits.memory']!==config['limits.memory'])||
      (devices[roots[0][0]]&&checked.devices?.[roots[0][0]]?.size!==devices[roots[0][0]].size))throw Error('POOL_RESOURCE_CORRECTION_UNCONFIRMED')
    return true
  },{maxWait:2000,timeout:kind==='dns'?30000:20000})
}

export async function poolResourceGuestInstructions(hostId:number) {
  if(recoveryHeld())return []
  const host=await prisma.host.findUniqueOrThrow({where:{id:hostId}})
  if(!host.singleTenant||host.status!=='online'||host.installPending||host.poolFaulted||hostMaintenanceBlocked(host.securityHardening))return []
  const rows=await prisma.instance.findMany({where:{hostId,dedicatedIpv4:true,status:'running',deletionIntent:{equals:Prisma.DbNull},
    provisioningCleanupPending:false,deletionBillingPending:false},take:2})
  if(rows.length!==1)return []
  const row=rows[0]
  if(await prisma.instanceTask.count({where:{instanceId:row.id,status:{in:['PENDING','PROCESSING']}}})||
    await prisma.restoreTask.count({where:{instanceId:row.id,status:{in:['PENDING','PROCESSING']}}})||
    await prisma.backupUploadTask.count({where:{instanceId:row.id,status:{in:['PENDING','PROCESSING']}}})||
    await prisma.instanceTransfer.count({where:{instanceId:row.id,status:{in:['pending','processing']}}}))return []
  const identity=await registeredGuestIdentity(prisma,row,host)
  return identity.uuid ? [{name:row.incusId,uuid:identity.uuid,memoryMiB:row.memory}] : []
}

let timer:ReturnType<typeof setTimeout>|undefined,active:Promise<void>|undefined,stopped=true,cursor=0
async function scan(){
  if(recoveryHeld())return
  const rows=await prisma.instance.findMany({where:{id:{gt:cursor},dedicatedIpv4:true,status:{in:['running','stopped']},host:{singleTenant:true,status:'online'}},select:{id:true},orderBy:{id:'asc'},take:20})
  if(!rows.length){cursor=0;return}
  for(const row of rows){
    if(stopped)return;cursor=row.id
    try{await reconcilePoolInstanceResources(row.id)}catch{console.warn(`[PoolResources] 实例 #${row.id} 限额核验待重试`)}
    try{await reconcilePoolInstanceDns(row.id)}catch{console.warn(`[PoolResources] 实例 #${row.id} DNS 核验待重试`)}
  }
}
export function startPoolResourceReconciliation(){if(!stopped)return;stopped=false;const tick=()=>{active=scan().catch(()=>console.warn('[PoolResources] 扫描待重试')).finally(()=>{active=undefined;if(!stopped){timer=setTimeout(tick,30000);timer.unref()}})};timer=setTimeout(tick,10000);timer.unref()}
export async function stopPoolResourceReconciliation(){stopped=true;clearTimeout(timer);await active}
