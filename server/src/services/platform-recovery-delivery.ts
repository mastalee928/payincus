import { createHash, randomUUID } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { backupRoot, ensure, readJson } from './platform-backup-core.js'
import { join } from 'node:path'
import { isIPv4 } from 'node:net'
import { probeGatewayHost } from './onboarding-ssh.js'
import { IncusClient } from '../lib/incus/incus-client.js'
import { managedCleanupEndpointHash } from '../lib/managed-cleanup-identity.js'
import { assertRecoveryGuestResources, compareRecoveryIdentities, type LiveRecoveryGuest } from './platform-recovery-inventory.js'
import { readOriginalDedicatedNetwork } from './platform-recovery-network.js'
import { publicIpv6State, type DedicatedIpv6State } from '../lib/host-public-ipv6.js'
import { decryptSensitiveData } from '../lib/security.js'
import { checkSshLogin } from '../lib/dedicated-ssh.js'
import { assertGuestNetworkProtection } from '../lib/guest-network-protection.js'
import { recoveryHostErrorCode, recoveryHostPolicy } from './platform-recovery-policy.js'
import { recoveryHostSourceHash } from './platform-recovery-state.js'
import { restoreMissingDeliveryForwards } from './platform-recovery-delivery-network.js'

type Pending = { id:number;hostId:number;userId:number;incusId:string;status:string;purchaseBatchId:string|null;
  provisioningCleanupPending:boolean;deletionBillingPending:boolean;dedicatedIpv4:boolean;
  storagePoolName:string|null;ipv4:string|null;rootPassword:string|null;cpu:number;memory:number;disk:number;snapshottedSpecs:unknown }
type Identity = { attempt?:string;endpointHash?:string;uuid?:string }
type DeliveryStep = 'management'|'inventory'|'identity'|'operations'|'network'|'ssh'|'save'
type DeliveryCheck = {instanceId:number;hostId:number;step:DeliveryStep;status:'success'|'retry'|'blocked';code:string|null;attempt:number;nextAt:string}
const encodeRow=(value:unknown)=>JSON.stringify(value,(_key,item)=>typeof item==='bigint'?item.toString():item)
export function pendingDeliveryLocation(row:Pending,live:LiveRecoveryGuest) {
  const specs=row.snapshottedSpecs as {poolProvision?:{version?:number;phase?:string};managedCleanup?:Identity}|null
  ensure(specs?.poolProvision?.version===1 && ['prepared','creating'].includes(specs.poolProvision.phase||'') && specs.managedCleanup?.attempt &&
    live.config?.['user.payincus.provisioning-attempt']===specs.managedCleanup.attempt,'OSS_RECOVERY_DELIVERY_IDENTITY_MISSING',409)
  const devices=live.expanded_devices||live.devices||{}
  const roots=Object.values(devices).filter(device=>device.type==='disk' && device.path==='/')
  const nic=devices.eth0,ipv4=nic?.['ipv4.address']
  ensure(roots.length===1 && roots[0].pool && nic?.type==='nic' && nic.network==='incusbr0' &&
    ipv4 && isIPv4(ipv4) && /^10\.10\.[0-3]\./.test(ipv4) && !['10.10.0.0','10.10.0.1','10.10.3.255'].includes(ipv4) &&
    (!row.ipv4||row.ipv4===ipv4) && (!row.storagePoolName||row.storagePoolName===roots[0].pool),
    'OSS_REVIEW_RESOURCE_MISMATCH',409)
  return {ipv4,storagePoolName:roots[0].pool}
}
export function pendingDeliveryIdentity(row:Pending,endpointHash:string,live:LiveRecoveryGuest) {
  const specs=row.snapshottedSpecs as {poolProvision?:{version?:number;phase?:string};managedCleanup?:Identity;
    recoveryIdentity?:{uuid?:string;createdAt?:string;project?:string}}|null
  const saved=specs?.managedCleanup,uuid=specs?.recoveryIdentity?.uuid || saved?.uuid
  ensure(row.status==='creating' && row.purchaseBatchId && !row.provisioningCleanupPending && !row.deletionBillingPending &&
    row.dedicatedIpv4 && row.ipv4 && row.storagePoolName && specs?.poolProvision?.version===1 && ['prepared','creating'].includes(specs.poolProvision.phase||'') &&
    saved?.endpointHash===endpointHash && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(saved.attempt||''),
    'OSS_RECOVERY_DELIVERY_IDENTITY_MISSING',409)
  ensure(live.config?.['user.payincus.provisioning-attempt']===saved.attempt &&
    (!saved.uuid || live.config?.['volatile.uuid']===saved.uuid), 'OSS_REVIEW_IDENTITY_CHANGED',409)
  // A durable, random attempt was saved before POST /instances. It can identify
  // that exact creation after a crash before its UUID response reached the DB.
  const identity={name:row.incusId,uuid:uuid || live.config?.['volatile.uuid'],createdAt:specs.recoveryIdentity?.createdAt,
    project:specs.recoveryIdentity?.project || 'default',ownerId:row.userId,status:'running',storagePoolName:row.storagePoolName}
  ensure(compareRecoveryIdentities([identity],[live],true).inventoryMatched,'OSS_REVIEW_IDENTITY_CHANGED',409)
  assertRecoveryGuestResources({...row,instanceType:'container'},live)
  return {uuid:identity.uuid!,createdAt:live.created_at,project:'default'}
}

async function inspectPendingDelivery(row:Pending,step:(value:DeliveryStep)=>void=()=>{},
  context?:{batchId:string;guard:()=>Promise<void>;record:(address:string,phase:'planned'|'verified')=>Promise<void>}):Promise<{status:'running'|'stopped';identity:ReturnType<typeof pendingDeliveryIdentity>;network:DedicatedIpv6State;location?:{ipv4:string;storagePoolName:string}}> {
  step('management')
  const host=await prisma.host.findUniqueOrThrow({where:{id:row.hostId}})
  const node=await prisma.hostOnboardingNode.findFirst({where:{hostId:row.hostId,status:'succeeded',deletedAt:null}})
  ensure(host.singleTenant && host.serverCertificate && host.serverFingerprint && host.certPath && host.keyPath &&
    node?.managementIp && node.sshFingerprint && node.nodePublicKey && host.managementSshHost===node.managementIp &&
    host.managementSshPort===node.sshPort && new URL(host.url).hostname===node.managementIp,'OSS_REVIEW_MANAGEMENT_REQUIRED',409)
  await probeGatewayHost(node.id,{sshPort:node.sshPort,sshFingerprint:node.sshFingerprint,nodePublicKey:node.nodePublicKey})
  const client=new IncusClient(host),deadline=Date.now()+60000,timer=setTimeout(()=>{void client.agent?.destroy()},60000)
  try {
    await client.connect()
    step('inventory')
    const live=await client.request<LiveRecoveryGuest[]>('GET','/1.0/instances?recursion=1&all-projects=true',null,12000)
    ensure(live.length===1 && live[0].name===row.incusId,'OSS_RECOVERY_DELIVERY_UNVERIFIED',409)
    step('identity')
    const location=pendingDeliveryLocation(row,live[0])
    if(!row.ipv4||!row.storagePoolName) {
      ensure(await prisma.storagePool.count({where:{hostId:row.hostId,name:location.storagePoolName,purpose:'instance_data'}})===1,
        'OSS_REVIEW_RESOURCE_MISMATCH',409)
      ensure(!await prisma.instance.count({where:{hostId:row.hostId,id:{not:row.id},ipv4:location.ipv4,status:{not:'deleted'}}}),
        'OSS_REVIEW_RESOURCE_MISMATCH',409)
      row={...row,...location}
    }
    const identity=pendingDeliveryIdentity(row,managedCleanupEndpointHash(client),live[0])
    // The original guest may have been stopped after the snapshot. Its exact
    // identity, disk and persisted networking can be checked without starting it.
    ensure(['Running','Stopped'].includes(live[0].status),'OSS_RECOVERY_DELIVERY_UNVERIFIED',409)
    step('operations')
    const operations=await client.request<Record<string,unknown[]>>('GET','/1.0/operations?recursion=1',null,12000)
    ensure(!['running','pending','cancelling'].some(key=>operations[key]?.length),'OSS_REVIEW_RESOURCE_BUSY',409)
    step('network')
    const addresses=publicIpv6State(host.publicIpv6Sync).addresses
    try {
      const existing=await readOriginalDedicatedNetwork(client,{hostId:row.hostId,originalId:row.id,name:row.incusId,ipv4:row.ipv4!,natBindIp:host.natBindIp},live[0].status==='Running')
      ensure(addresses.length===existing.mappings.length && addresses.every(ip=>existing.mappings.some(mapping=>mapping.publicIp===ip)),
        'OSS_RECOVERY_IPV6_NETWORK_PENDING',409)
    }
    catch(error) {
    if(!context)throw error
    await restoreMissingDeliveryForwards(client,{hostId:row.hostId,instanceId:row.id,name:row.incusId,
      ipv4:row.ipv4!,natBindIp:host.natBindIp||'',publicIpv6:addresses},async()=>{
      ensure(Date.now()<deadline,'OSS_REVIEW_TRANSPORT_TIMEOUT',409)
      const hold=await readJson<{batchId?:string;taskId:string;restorePolicy?:string}>(join(backupRoot(),'recovery-hold.json'))
      ensure(hold?.restorePolicy==='snapshot-v1' && hold.batchId===context.batchId && hold.taskId===context.batchId,
        'OSS_RECOVERY_CONTEXT_CHANGED',409)
      ensure(host.portProtocol==='tcp' || host.portProtocol==='tcp_udp','OSS_RECOVERY_DELIVERY_PROTOCOL_PENDING',409)
      // Heartbeats are held during restore. Read the current filter through the
      // pinned management path instead of waiting forever for a paused Agent ack.
      await probeGatewayHost(node.id,{sshPort:node.sshPort,sshFingerprint:node.sshFingerprint!,nodePublicKey:node.nodePublicKey!,portProtocol:host.portProtocol})
      ensure(Date.now()<deadline,'OSS_REVIEW_TRANSPORT_TIMEOUT',409)
      await context.guard()
      const current=await client.request<LiveRecoveryGuest[]>('GET','/1.0/instances?recursion=1&all-projects=true',null,12000)
      ensure(current.length===1 && current[0].name===row.incusId,'OSS_REVIEW_IDENTITY_CHANGED',409)
      const latest=pendingDeliveryIdentity(row,managedCleanupEndpointHash(client),current[0])
      ensure(latest.uuid===identity.uuid,'OSS_REVIEW_IDENTITY_CHANGED',409)
      pendingDeliveryLocation(row,current[0])
      const operations=await client.request<Record<string,unknown[]>>('GET','/1.0/operations?recursion=1',null,12000)
      ensure(!['running','pending','cancelling'].some(key=>operations[key]?.length),'OSS_REVIEW_RESOURCE_BUSY',409)
    },context.record)
    }
    const network=await readOriginalDedicatedNetwork(client,{hostId:row.hostId,originalId:row.id,name:row.incusId,ipv4:row.ipv4!,natBindIp:host.natBindIp},live[0].status==='Running')
    ensure(addresses.length===network.mappings.length && addresses.every(ip=>network.mappings.some(mapping=>mapping.publicIp===ip)),
      'OSS_RECOVERY_IPV6_NETWORK_PENDING',409)
    // Existing delivered guests may have changed their password since backup.
    // Only a not-yet-delivered running guest needs its original login verified.
    if(live[0].status==='Running') {
      step('ssh')
      const fingerprints:string[]=[]
      for(const name of ['ed25519','ecdsa','rsa']) {
        const response=await client.readFile(`/1.0/instances/${encodeURIComponent(row.incusId)}/files?path=${encodeURIComponent(`/etc/ssh/ssh_host_${name}_key.pub`)}&project=default`,AbortSignal.timeout(10000),8192)
        if(response.statusCode===404)continue
        ensure(response.statusCode===200,'OSS_RECOVERY_DELIVERY_SSH_PENDING',409)
        const parts=response.content.trim().split(/\s+/)
        ensure(parts.length>=2 && /^(ssh-|ecdsa-)/.test(parts[0]) && /^[A-Za-z0-9+/]+={0,2}$/.test(parts[1]),'OSS_REVIEW_IDENTITY_CHANGED',409)
        fingerprints.push(`SHA256:${createHash('sha256').update(Buffer.from(parts[1],'base64')).digest('base64').replace(/=+$/,'')}`)
      }
      ensure(fingerprints.length && row.rootPassword && host.natPublicIp,'OSS_RECOVERY_DELIVERY_SSH_PENDING',409)
      const password=decryptSensitiveData(row.rootPassword!)
      ensure(password,'OSS_RECOVERY_DELIVERY_SSH_PENDING',409)
      try{await assertGuestNetworkProtection(client);await checkSshLogin(host.natPublicIp!,password!,fingerprints)}
      catch{ensure(false,'OSS_RECOVERY_DELIVERY_SSH_PENDING',409)}
    }
    return {status:live[0].status==='Running'?'running':'stopped',identity,network,location}
  }catch(error){ensure(false,recoveryHostErrorCode(error),409);throw error}
  finally{clearTimeout(timer);await client.agent?.destroy()}
}

// Root calls this before issuing the snapshot receipt and before business starts.
// The held backend may serve progress; ordinary APIs and workers remain blocked.
// Original guests/disks are read only. An absent original forward can be added
// after pinned identity and network checks; no create, guest write or refund.
// A committed DB correction is safe to replay after a lost local receipt: it no
// longer matches creating. Money, ownership, expiry and stock are unchanged.
export async function reconcileRestoredDeliveries(batchId:string,inspect=inspectPendingDelivery,
  runtime={now:Date.now,budgetMs:120000}) {
  const batch=await prisma.platformRecoveryBatch.findUniqueOrThrow({where:{id:batchId}})
  ensure(batch.mode==='restore' && !batch.completedAt,'OSS_RECOVERY_CONTEXT_CHANGED',409)
  const deadline=runtime.now()+runtime.budgetMs
  let lastId=0
  while(runtime.now()<deadline) {
    // Select due work in PostgreSQL. Scanning thousands of cooling-down rows on
    // every pass must not consume the whole budget before reaching later guests.
    const due=await prisma.$queryRaw<Array<{id:number}>>`SELECT i.id FROM instances i
      LEFT JOIN platform_recovery_evidence e ON e.batch_id=${batchId}::uuid
        AND e.category='snapshot-delivery-check' AND e.reference='instance-'||i.id::text
      WHERE i.id>${lastId} AND i.status='creating'
        AND (e.id IS NULL OR (e.payload->>'nextAt')::timestamptz<=${new Date(runtime.now())})
      ORDER BY i.id LIMIT 50`
    const rows=await prisma.instance.findMany({where:{id:{in:due.map(row=>row.id)},status:'creating'},orderBy:{id:'asc'}})
    if(!rows.length)break
    let next=0
    const settled=await Promise.allSettled(Array.from({length:4},async()=>{
      while(next<rows.length && runtime.now()<deadline) {
        const row=rows[next++],reference=`instance-${row.id}`
        const hostHash=await recoveryHostSourceHash(row.hostId)
        const sourceHash=createHash('sha256').update(encodeRow({row,hostHash})).digest('hex')
        const previous=await prisma.platformRecoveryEvidence.findUnique({where:{batchId_category_reference:{batchId,category:'snapshot-delivery-check',reference}}})
        const saved=previous?.payload as DeliveryCheck|null
        // An original identity returning is observed on the saved schedule;
        // changes to a row never create a rapid retry loop.
        if(saved && runtime.now()<Date.parse(saved.nextAt))continue
        const attempt=previous?.sourceHash===sourceHash?Math.min((saved?.attempt||0)+1,1000000):1
        let step:DeliveryStep='management',checked:Awaited<ReturnType<typeof inspect>>|undefined,code:string|null=null
        try {
          const guard=async()=>{
            const currentBatch=await prisma.platformRecoveryBatch.findUniqueOrThrow({where:{id:batchId}})
            const current=await prisma.instance.findUniqueOrThrow({where:{id:row.id}})
            ensure(!currentBatch.completedAt && currentBatch.mode==='restore','OSS_RECOVERY_CONTEXT_CHANGED',409)
            ensure(encodeRow(current)===encodeRow(row) && await recoveryHostSourceHash(row.hostId)===hostHash,
              'OSS_RECOVERY_EVIDENCE_STALE',409)
          }
          checked=await inspect(row,value=>{step=value},{batchId,guard,record:async(address,phase)=>{
            await guard()
            const payload={instanceId:row.id,hostId:row.hostId,phase,addressHash:createHash('sha256').update(address).digest('hex')}
            await prisma.platformRecoveryEvidence.create({data:{batchId,category:'snapshot-delivery-network',reference:randomUUID(),
              sourceHash,evidenceHash:createHash('sha256').update(JSON.stringify(payload)).digest('hex'),observedAt:new Date(),actorId:batch.operatorId,payload}})
          }})
          ensure(await recoveryHostSourceHash(row.hostId)===hostHash,'OSS_RECOVERY_EVIDENCE_STALE',409)
        } catch(error) { code=recoveryHostErrorCode(error) }
        const policy=code?recoveryHostPolicy({managementVerified:false,code},attempt):null
        const payload:DeliveryCheck={instanceId:row.id,hostId:row.hostId,step:code?step:'save',
          status:policy?.status||'success',code,attempt,nextAt:new Date(runtime.now()+(policy?.delayMs||0)).toISOString()}
        await prisma.$transaction(async tx=>{
        const currentBatch=await tx.platformRecoveryBatch.findUniqueOrThrow({where:{id:batchId}})
        ensure(!currentBatch.completedAt && currentBatch.mode==='restore','OSS_RECOVERY_CONTEXT_CHANGED',409)
        await tx.$queryRaw`SELECT id FROM hosts WHERE id=${row.hostId} FOR UPDATE`
        await tx.$queryRaw`SELECT id FROM instances WHERE id=${row.id} FOR UPDATE`
        const current=await tx.instance.findUniqueOrThrow({where:{id:row.id}})
        ensure(encodeRow(current)===encodeRow(row),'OSS_RECOVERY_EVIDENCE_STALE',409)
        if(checked && !code) {
        ensure(await recoveryHostSourceHash(row.hostId,(sql,params=[])=>tx.$queryRawUnsafe(sql,...params))===hostHash,'OSS_RECOVERY_EVIDENCE_STALE',409)
        const specs=(row.snapshottedSpecs||{}) as Prisma.InputJsonObject
        if(checked.location) {
          // Reservations are short-lived allocator leases, not instance ownership.
          // The locked host and persisted instance address retain this allocation.
          ensure(!await tx.instance.count({where:{hostId:row.hostId,id:{not:row.id},ipv4:checked.location.ipv4,status:{not:'deleted'}}}),
            'OSS_REVIEW_RESOURCE_MISMATCH',409)
        }
        await tx.instance.update({where:{id:row.id},data:{status:checked.status,dedicatedNetworkReady:true,
          ...(checked.location||{}),
          dedicatedIpv6:checked.network as unknown as Prisma.InputJsonValue,
          snapshottedSpecs:{...specs,recoveryIdentity:checked.identity,poolProvision:{version:1,phase:'completed'}}}})
        await tx.platformRecoveryEvidence.create({data:{batchId,category:'snapshot-delivery',reference:`instance-${row.id}`,
          sourceHash:createHash('sha256').update(encodeRow(row)).digest('hex'),
          evidenceHash:createHash('sha256').update(JSON.stringify(checked)).digest('hex'),observedAt:new Date(),
          actorId:batch.operatorId,
          payload:{instanceId:row.id,hostId:row.hostId,previousStatus:row.status,status:checked.status,identity:checked.identity}}})
        }
        const evidence={sourceHash,evidenceHash:createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
          observedAt:new Date(runtime.now()),actorId:batch.operatorId,payload:payload as unknown as Prisma.InputJsonObject}
        await tx.platformRecoveryEvidence.upsert({where:{batchId_category_reference:{batchId,category:'snapshot-delivery-check',reference}},
          create:{batchId,category:'snapshot-delivery-check',reference,...evidence},update:evidence})
        await tx.platformRecoveryEvidence.create({data:{batchId,category:'snapshot-delivery-attempt',reference:`${reference}-${randomUUID()}`,...evidence}})
        })
      }
    }))
    // All lanes finish before the root lock is released or a new pass begins.
    const failed=settled.find((value):value is PromiseRejectedResult=>value.status==='rejected')
    if(failed)throw failed.reason
    lastId=rows[rows.length-1].id
  }
  ensure(await prisma.instance.count({where:{status:'creating'}})===0,'OSS_RECOVERY_DELIVERY_CHECK_PENDING',409)
}
