import { Prisma } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { gatewayCommand, restoreGatewayRuntimeRoute } from './onboarding-ssh.js'
import { ensure, serializeBackupMutation } from './platform-backup-core.js'
import { activeBackupTask } from './platform-backup-scheduler.js'
import { activeRecoveryBatch, recoveryDatasetHash } from './platform-recovery-state.js'
import { reauthenticateRecoveryOperator } from './platform-recovery-operator.js'
import { recoveryHash } from './platform-recovery-evidence.js'
import { recoveryGatewayIdentity } from './platform-recovery-gateway-check.js'
import { authorizeRecoveryHelper, recoveryHelperStatus } from './platform-recovery-helper.js'
import { authorizeRecoveryMapping, recoveryMappingStatus } from './platform-recovery-mapping-intent.js'
import { isIPv4 } from 'node:net'
import { assertSavedRecoveryGateway } from './platform-recovery-gateway-baseline.js'
import { recoveryHostErrorCode, recoveryHostPolicy, automaticResumeDecision } from './platform-recovery-policy.js'
import { randomUUID } from 'node:crypto'

export async function mapRecoveryGateway(actorId:number, input:{address:string;password:string;totpCode?:string}) {
  const batch=await activeRecoveryBatch()
  await reauthenticateRecoveryOperator(actorId,input)
  ensure(batch.mode==='restore' && isIPv4(input.address),'OSS_RECOVERY_GATEWAY_ADDRESS_INVALID')
  return authorizeRecoveryMapping(batch,input.address)
}

export async function upgradeRecoveryGatewayHelper(actorId: number, credentials: { password: string; totpCode?: string; gatewayPassword: string }) {
  const batch=await activeRecoveryBatch()
  await reauthenticateRecoveryOperator(actorId,credentials)
  const current=await gatewayCommand()
  await assertSavedRecoveryGateway(current)
  if(current.recoveryProtocolVersion===1) return {updated:false}
  return authorizeRecoveryHelper(batch,current,credentials.gatewayPassword)
}
export async function recoveryGatewayStatus() {
  const batch=await activeRecoveryBatch(),helper=await recoveryHelperStatus(batch.id),mapping=await recoveryMappingStatus(batch.id)
  const local=['127.0.0.1','localhost','::1'].includes(process.env.ONBOARDING_GATEWAY_HOST||'')
  try {
    const current=await gatewayCommand()
    return {host:current.sshHost,endpoint:current.endpoint,local,helperReady:current.recoveryProtocolVersion===1,reachable:true,helper,mapping}
  } catch {
    // An unreachable old address must not hide the recovery mapping form.
    return {host:process.env.ONBOARDING_GATEWAY_HOST||'',endpoint:process.env.ONBOARDING_WG_ENDPOINT||'',local,helperReady:false,reachable:false,helper,mapping}
  }
}

// The address is configuration, not trust. The configured SSH fingerprint and
// management key pin the current gateway, including a separately enrolled spare.
export async function reconcileRecoveryGateway(actorId: number, credentials: { password: string; totpCode?: string }) {
  const batch = await activeRecoveryBatch()
  await reauthenticateRecoveryOperator(actorId, credentials)
  return verifyRecoveryGateway(batch,actorId)
}

export async function verifyRecoveryGateway(batch:Awaited<ReturnType<typeof activeRecoveryBatch>>,actorId:number,allowRouteRepair=false) {
  const before=await recoveryDatasetHash('gateway')
  ensure((await gatewayCommand()).recoveryProtocolVersion===1,'OSS_RECOVERY_GATEWAY_HELPER_REQUIRED',409)
  const current = await gatewayCommand('recovery-state')
  await assertSavedRecoveryGateway(current)
  const state = current.recovery
  ensure(state && state.version === 1 && Number.isSafeInteger(state.observedAt) && Math.abs(Date.now() - state.observedAt) < 60000,
    'OSS_RECOVERY_GATEWAY_STATE_REQUIRED', 409)
  const nodes = await prisma.hostOnboardingNode.findMany({ where: { OR:[{hostId:{not:null}},{deletedAt:{not:null}}] }, select: { id: true, nodePublicKey: true, managementIp: true, deletedAt: true, hostId: true } })
  const known = new Map(nodes.map(node => [node.id, node]))
  for (const peer of state.peers) {
    const node = known.get(peer.nodeId)
    ensure(node && node.nodePublicKey === peer.nodePublicKey && node.managementIp === peer.managementIp, 'OSS_RECOVERY_GATEWAY_IDENTITY_CHANGED', 409)
    // An old DB tombstone is never removed because a gateway still lists a peer.
    ensure(!node.deletedAt || !peer.enabled, 'OSS_RECOVERY_GATEWAY_REVOCATION_CONFLICT', 409)
  }
  if(allowRouteRepair){
    // A lost SSH reply is resolved by the next authenticated read, without
    // dispatching the same repair again. Preserve the earlier attempt history.
    const pending=await prisma.platformRecoveryEvidence.findMany({where:{batchId:batch.id,category:'gateway-route'}})
    for(const row of pending){
      const prior=row.payload as {status:string;nodeId:string;hostId:number;nextAction:string}
      if(prior.status==='success' && prior.nextAction==='verify-host-connection' || !state.peers.some(peer=>peer.nodeId===prior.nodeId && peer.enabled))continue
      ensure((await activeRecoveryBatch()).id===batch.id && await recoveryDatasetHash('gateway')===before,'OSS_RECOVERY_EVIDENCE_STALE',409)
      const payload={...(row.payload as Prisma.JsonObject),status:'success',code:null,nextAction:'verify-host-connection',nextAt:new Date().toISOString()}
      await prisma.$transaction(async tx=>{
        await tx.platformRecoveryEvidence.update({where:{id:row.id},data:{payload,evidenceHash:recoveryHash(payload),observedAt:new Date()}})
        await tx.platformRecoveryEvidence.create({data:{batchId:batch.id,category:'gateway-route-attempt',reference:`verified-${randomUUID()}`,
          sourceHash:before,evidenceHash:recoveryHash(payload),observedAt:new Date(),actorId,payload}})
        await tx.platformRecoveryHost.updateMany({where:{batchId:batch.id,hostId:prior.hostId,status:{in:['blocked','retry','pending']},
          OR:[{leaseUntil:null},{leaseUntil:{lt:new Date()}}]},data:{nextAttemptAt:new Date()}})
      })
    }
  }
  const missing = nodes.filter(node => !node.deletedAt && !state.peers.some(peer => peer.nodeId === node.id && peer.enabled))
  if (missing.length) {
    let recheck=false
    // Repair at most one absent runtime route per tick. Only the gateway's
    // current protected configuration can authorize this, never the old dump.
    if(allowRouteRepair && state.configHash && state.runtimeHash)for(const node of missing){
      if(!state.peers.some(peer=>peer.nodeId===node.id))continue
      const sourceHash=recoveryHash({node,configHash:state.configHash,runtimeHash:state.runtimeHash,publicKey:current.publicKey})
      const key={batchId_category_reference:{batchId:batch.id,category:'gateway-route',reference:node.id}}
      const prior=await prisma.platformRecoveryEvidence.findUnique({where:key})
      const payload=prior?.payload as {status:string;attempt:number;nextAt:string}|null
      const attempt=automaticResumeDecision(prior&&payload?{...payload,sourceHash:prior.sourceHash}:null,sourceHash,Date.now())
      if(attempt===null){if(payload?.status==='retry' || payload?.status==='dispatched' || payload?.status==='success')recheck=true;continue}
      const operationId=randomUUID()
      const save=async(status:string,code:string|null)=>{
        const next={status,code,attempt:Math.min(attempt,8),nodeId:node.id,hostId:node.hostId,operationId,
          nextAction:status==='blocked'?'observe-original-condition':status==='success'?'verify-restored-route':'restore-saved-route',
          nextAt:new Date(Date.now()+Math.min(1800000,30000*2**Math.min(attempt-1,6))).toISOString()}
        const data={sourceHash,evidenceHash:recoveryHash(next),observedAt:new Date(),actorId,payload:next}
        await prisma.$transaction(async tx=>{
          await tx.platformRecoveryEvidence.upsert({where:key,create:{batchId:batch.id,category:'gateway-route',reference:node.id,...data},update:data})
          await tx.platformRecoveryEvidence.create({data:{batchId:batch.id,category:'gateway-route-attempt',reference:`${operationId}-${status}`,...data}})
        })
      }
      if(attempt>8){await save('blocked','OSS_RECOVERY_GATEWAY_ROUTE_ATTEMPTS_EXHAUSTED');continue}
      await save('dispatched',null) // Durable before dispatch; lost replies respect cooldown.
      ensure((await activeRecoveryBatch()).id===batch.id && await recoveryDatasetHash('gateway')===before,'OSS_RECOVERY_EVIDENCE_STALE',409)
      try{await restoreGatewayRuntimeRoute(node.id,{nodePublicKey:node.nodePublicKey!,managementIp:node.managementIp!,gatewayPublicKey:current.publicKey,
        configHash:state.configHash,expiresAt:Date.now()+25000});await save('success',null);recheck=true}
      catch(error){const code=recoveryHostErrorCode(error),policy=recoveryHostPolicy({managementVerified:false,code},attempt);await save(policy.status,code);recheck=policy.status==='retry'}
      break
    }
    // A missing live route is not proof of revocation. Persist the discrepancy
    // without replacing enrollment status: when the original route returns,
    // automatic host checks can continue. Never add peers from the old dump.
    await prisma.platformRecoveryEvidence.upsert({ where: { batchId_category_reference: { batchId: batch.id, category: 'gateway-conflict', reference: state.stateHash } },
        create: { batchId: batch.id, category: 'gateway-conflict', reference: state.stateHash, sourceHash: recoveryHash(nodes), evidenceHash: state.stateHash,
          observedAt: new Date(state.observedAt), actorId, payload: { missing: missing.map(node => node.id), gatewayPublicKey: current.publicKey } }, update: {} })
    ensure(false, recheck?'OSS_RECOVERY_GATEWAY_ROUTE_RECHECK':'OSS_RECOVERY_GATEWAY_MISSING_ROUTES', 409)
  }
  const sourceHash = await recoveryDatasetHash('gateway')
  ensure(before===sourceHash && (await activeRecoveryBatch()).id===batch.id,'OSS_RECOVERY_EVIDENCE_STALE',409)
  const payload = recoveryGatewayIdentity(current)
  const evidenceHash=recoveryHash(payload)
  const evidence = await prisma.platformRecoveryEvidence.upsert({where:{batchId_category_reference:{batchId:batch.id,category:'gateway',reference:`live-${state.observedAt}`}},
    create:{ batchId: batch.id, category: 'gateway', reference: `live-${state.observedAt}`,sourceHash,evidenceHash,
      observedAt: new Date(state.observedAt), actorId, payload: payload as Prisma.InputJsonValue },update:{} })
  ensure(evidence.sourceHash===sourceHash && evidence.evidenceHash===evidenceHash,'OSS_RECOVERY_EVIDENCE_STALE',409)
  return { id: evidence.id, peers: state.peers.length, checkedAt: new Date(state.observedAt).toISOString() }
}

// Runs only inside the held, single-backend recovery worker. Initial restore
// authorization covers checks and restoring exact, still-saved runtime routes.
export async function runRecoveryGatewayCheck(batch:Awaited<ReturnType<typeof activeRecoveryBatch>>,verify=(batch:Awaited<ReturnType<typeof activeRecoveryBatch>>,actorId:number)=>verifyRecoveryGateway(batch,actorId,true)) {
  return serializeBackupMutation(async()=>{
  if(await activeBackupTask())return
  ensure((await activeRecoveryBatch()).id===batch.id,'OSS_RECOVERY_CONTEXT_CHANGED',409)
  const sourceHash=await recoveryDatasetHash('gateway')
  const previous=await prisma.platformRecoveryEvidence.findFirst({where:{batchId:batch.id,category:'gateway-check'},orderBy:{createdAt:'desc'}})
  const old=previous?.payload as {status:string;attempt:number;nextAt:string}|undefined
  const same=previous?.sourceHash===sourceHash
  if(same && old && Date.parse(old.nextAt)>Date.now())return
  const attempt=same && Number.isSafeInteger(old?.attempt)?Math.min(old!.attempt+1,1000000):1
  let code:string|null=null
  try{await verify(batch,batch.operator_id)}catch(error){code=recoveryHostErrorCode(error)}
  const currentHash=await recoveryDatasetHash('gateway')
  if(currentHash!==sourceHash)code='OSS_RECOVERY_EVIDENCE_STALE'
  ensure((await activeRecoveryBatch()).id===batch.id,'OSS_RECOVERY_CONTEXT_CHANGED',409)
  const policy=code==='OSS_RECOVERY_GATEWAY_ROUTE_RECHECK'?{status:'retry',nextAction:'verify-restored-route',delayMs:30000}:
    recoveryHostPolicy({managementVerified:!code,code,inventory:{inventoryMatched:!code}},attempt)
  const payload={status:policy.status,code,attempt,nextAction:policy.nextAction,nextAt:new Date(Date.now()+policy.delayMs).toISOString()}
  await prisma.platformRecoveryEvidence.create({data:{batchId:batch.id,category:'gateway-check',reference:`gateway-${randomUUID()}`,
    sourceHash:currentHash,evidenceHash:recoveryHash(payload),observedAt:new Date(),actorId:batch.operator_id,payload}})
  })
}
