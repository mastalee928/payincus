import { prisma } from '../db/prisma.js'
import { Prisma } from '@prisma/client'
import { ensure, validateId } from './platform-backup-core.js'
import { activeRecoveryBatch, recoveryHostSourceHash, validateRecoveryEvidence } from './platform-recovery-state.js'
import { reauthenticateRecoveryOperator } from './platform-recovery-operator.js'
import { recoveryHash } from './platform-recovery-evidence.js'
import { recoveryOriginalUserId } from './platform-recovery-registration.js'
import { IncusClient } from '../lib/incus/incus-client.js'
import { probeGatewayHost } from './onboarding-ssh.js'
import { compareRecoveryIdentities, type LiveRecoveryGuest } from './platform-recovery-inventory.js'

export interface RecoveryInstanceEvidence {
  id: string; instanceId: number; sourceHash: string; reference: string; evidenceHash: string; observedAt: string
  uuid: string; createdAt: string; status: 'running'|'stopped'|'suspended'
}
export async function recoveryInstance(id: number) {
  await activeRecoveryBatch()
  const instance=await prisma.instance.findUnique({where:{id},select:{id:true,name:true,incusId:true,userId:true,hostId:true,status:true,snapshottedSpecs:true}})
  ensure(instance,'OSS_RECOVERY_INSTANCE_MISSING',404)
  const specs=instance.snapshottedSpecs as {recoveryIdentity?:{uuid?:string;createdAt?:string};managedCleanup?:{uuid?:string;createdAt?:string}}|null
  const replacement=await prisma.instanceTask.findFirst({where:{instanceId:id,taskType:'replace_host',status:'COMPLETED',targetHostId:instance.hostId},orderBy:{id:'desc'},select:{replacementState:true}})
  const replaced=replacement?.replacementState as {targetUuid?:string;targetCreatedAt?:string}|null
  return {id:instance.id,name:instance.name,incusId:instance.incusId,userId:instance.userId,hostId:instance.hostId,status:instance.status,
    uuid:replaced?.targetUuid||specs?.recoveryIdentity?.uuid||specs?.managedCleanup?.uuid||null,
    createdAt:replaced?.targetCreatedAt||specs?.recoveryIdentity?.createdAt||specs?.managedCleanup?.createdAt||null,
    sourceHash:await recoveryHostSourceHash(instance.hostId)}
}

// Missing historical UUIDs require an independent original-identity document.
// Reading today's same-name guest alone never creates the identity evidence.
export async function recordRecoveryInstance(input: RecoveryInstanceEvidence, actorId:number, credentials:{password:string;totpCode?:string}) {
  ensure(input&&Object.keys(input).sort().join(',')==='createdAt,evidenceHash,id,instanceId,observedAt,reference,sourceHash,status,uuid', 'OSS_RECOVERY_EVIDENCE_INVALID')
  validateId(input.id);validateId(input.uuid)
  ensure(Number.isSafeInteger(input.instanceId)&&input.instanceId>0&&['running','stopped','suspended'].includes(input.status)&&
    Number.isFinite(Date.parse(input.createdAt))&&Date.parse(input.createdAt)<=Date.parse(input.observedAt),'OSS_RECOVERY_EVIDENCE_INVALID')
  ensure(/^[a-f0-9]{32}$/.test(input.sourceHash),'OSS_RECOVERY_EVIDENCE_INVALID')
  validateRecoveryEvidence({...input,sourceHash:'0'.repeat(64)})
  const batch=await activeRecoveryBatch(), hash=recoveryHash(input)
  ensure(Date.parse(input.observedAt)>=Date.parse(batch.hold.createdAt),'OSS_RECOVERY_EVIDENCE_TIME')
  await reauthenticateRecoveryOperator(actorId,credentials)
  const replay=await prisma.platformRecoveryEvidence.findUnique({where:{id:input.id}})
  if(replay){ensure(replay.batchId===batch.id&&replay.sourceHash===hash,'OSS_RECOVERY_EVIDENCE_CONFLICT',409);return {id:replay.id,replayed:true}}
  const view=await recoveryInstance(input.instanceId)
  ensure(view.sourceHash===input.sourceHash && (!view.uuid||view.uuid===input.uuid) &&
    (!view.createdAt||Date.parse(view.createdAt)===Date.parse(input.createdAt)), 'OSS_REVIEW_IDENTITY_CHANGED',409)
  const instance=await prisma.instance.findUniqueOrThrow({where:{id:input.instanceId}})
  ensure(['running','stopped','suspended'].includes(instance.status)&&!instance.deletionBillingPending&&!instance.provisioningCleanupPending,
    'OSS_RECOVERY_DELIVERY_UNVERIFIED',409)
  ensure(input.status!=='suspended' || instance.status==='suspended' && instance.suspendedAt && instance.suspendReason,
    'OSS_RECOVERY_SUSPENSION_EVIDENCE_REQUIRED',409)
  const host=await prisma.host.findUniqueOrThrow({where:{id:instance.hostId}})
  const node=await prisma.hostOnboardingNode.findFirst({where:{hostId:host.id,deletedAt:null,status:'succeeded'}})
  ensure(node?.managementIp&&node.sshFingerprint&&node.nodePublicKey&&host.serverCertificate&&host.serverFingerprint&&host.certPath&&host.keyPath&&
    host.managementSshHost===node.managementIp&&host.managementSshPort===node.sshPort&&new URL(host.url).hostname===node.managementIp,'OSS_REVIEW_MANAGEMENT_REQUIRED',409)
  await probeGatewayHost(node.id,{sshPort:node.sshPort,sshFingerprint:node.sshFingerprint,nodePublicKey:node.nodePublicKey})
  const client=new IncusClient(host), timer=setTimeout(()=>{void client.agent?.destroy()},30000)
  try{
    await client.connect()
    const live=await client.request<LiveRecoveryGuest>('GET',`/1.0/instances/${encodeURIComponent(instance.incusId)}?project=default`,null,12000)
    ensure(compareRecoveryIdentities([{name:instance.incusId,uuid:input.uuid,createdAt:input.createdAt,ownerId:await recoveryOriginalUserId(instance.userId),
      status:input.status,storagePoolName:instance.storagePoolName}],[live]).inventoryMatched,'OSS_REVIEW_IDENTITY_CHANGED',409)
  }finally{clearTimeout(timer);await client.agent?.destroy()}
  return prisma.$transaction(async tx=>{
    ensure((await activeRecoveryBatch(async(sql,args=[])=>tx.$queryRawUnsafe(sql,...args))).id===batch.id,'OSS_RECOVERY_CONTEXT_CHANGED',409)
    await tx.$queryRaw`SELECT id FROM hosts WHERE id=${host.id} FOR UPDATE`
    await tx.$queryRaw`SELECT id FROM instances WHERE id=${instance.id} FOR UPDATE`
    ensure(await recoveryHostSourceHash(host.id,async(sql,args=[])=>tx.$queryRawUnsafe(sql,...args))===input.sourceHash,'OSS_RECOVERY_EVIDENCE_STALE',409)
    const specs=(instance.snapshottedSpecs||{}) as Prisma.InputJsonObject
    const originalStatus=specs.recoveryStatus as { suspendedAt?: string | null; suspendReason?: string | null; suspendedBy?: number | null } | undefined
    // Restoring a normal state must not leave a stale expiry suspension that can
    // later drive deletion. Preserve it in the evidence and snapshot history.
    const suspension=input.status==='suspended' ? {} : {suspendedAt:null,suspendedBy:null,suspendReason:null}
    await tx.instance.update({where:{id:instance.id},data:{status:input.status,version:{increment:1},snapshottedSpecs:{...specs,
      recoveryIdentity:{uuid:input.uuid,createdAt:input.createdAt,project:'default'},
      recoveryStatus:originalStatus || {suspendedAt:instance.suspendedAt?.toISOString()??null,suspendedBy:instance.suspendedBy,suspendReason:instance.suspendReason}},...suspension}})
    await tx.platformRecoveryHost.updateMany({where:{batchId:batch.id,hostId:host.id},data:{status:'pending',attempts:0,nextAttemptAt:new Date(),leaseToken:null,leaseUntil:null}})
    await tx.platformRecoveryEvidence.create({data:{id:input.id,batchId:batch.id,category:'instance-identity',reference:input.reference,sourceHash:hash,
      evidenceHash:input.evidenceHash,observedAt:new Date(input.observedAt),actorId,payload:{instanceId:instance.id,hostId:host.id,uuid:input.uuid,createdAt:input.createdAt,
        previousStatus:instance.status,status:input.status,originalIdentityWasMissing:!view.uuid}}})
    return {id:input.id,replayed:false}
  })
}
