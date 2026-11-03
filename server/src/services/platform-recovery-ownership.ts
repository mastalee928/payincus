import { ensure } from './platform-backup-core.js'

interface TransferProof {
  instanceId:number; fromUserId:number; toUserId:number; status:string; acceptedAt:Date|null; cleanupState:unknown
}
export interface RecoveryMutationProof {
  instanceId:number; taskType:string; status:string; hostId:number; targetHostId:number|null
  createdAt:Date; finishedAt:Date|null; replacementState:unknown
}
const uuidPattern=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i
const identityTasks=['replace_host','change_host','rebuild','recreate']
// Preserve a completed transfer's recipient without pretending the purchaser
// still owns the guest. No names, remarks or pending transfers establish lineage.
export function assertRecoveryOrderOwnership(purchaser:number,paidAt:Date,instance:{id:number;userId:number;hostId:number;incusId:string;snapshottedSpecs:unknown},transfers:TransferProof[],tasks:RecoveryMutationProof[] = []) {
  const records=transfers.filter(row=>row.instanceId===instance.id)
  ensure(!records.some(row=>['pending','processing'].includes(row.status)),'OSS_RECOVERY_TRANSFER_PENDING',409)
  const mutations=tasks.filter(row=>row.instanceId===instance.id && identityTasks.includes(row.taskType))
  ensure(!mutations.some(row=>['PENDING','PROCESSING'].includes(row.status)),'OSS_RECOVERY_INSTANCE_TASK_PENDING',409)
  const completed=mutations.filter(row=>row.status==='COMPLETED')
  const accepted=records.filter(row=>row.status==='accepted')
  if(!accepted.length){ensure(instance.userId===purchaser,'OSS_RECOVERY_OWNERSHIP_UNPROVEN',409);return}
  ensure(accepted.every(row=>row.acceptedAt && Number.isFinite(row.acceptedAt.getTime())),'OSS_RECOVERY_OWNERSHIP_UNPROVEN',409)
  const firstTransfer=Math.min(...accepted.map(row=>row.acceptedAt!.getTime()))
  const laterMutations=completed.filter(row=>!row.finishedAt || row.finishedAt.getTime()>=firstTransfer)
  // Other rebuild paths do not yet persist a complete source→target identity.
  // A success label alone cannot bridge a different remote guest.
  ensure(laterMutations.every(row=>row.taskType==='replace_host'),'OSS_RECOVERY_REPLACEMENT_UNPROVEN',409)
  const specs=instance.snapshottedSpecs as {recoveryIdentity?:{uuid?:string};managedCleanup?:{uuid?:string}}|null
  const originalUuid=specs?.recoveryIdentity?.uuid||specs?.managedCleanup?.uuid
  const events=[...accepted.map(transfer=>({time:transfer.acceptedAt?.getTime()??NaN,transfer,task:null})),
    ...laterMutations.map(task=>({time:task.finishedAt?.getTime()??NaN,transfer:null,task}))].sort((a,b)=>a.time-b.time)
  ensure(Number.isFinite(paidAt.getTime()) && events.every(row=>Number.isFinite(row.time)&&row.time>=paidAt.getTime()),'OSS_RECOVERY_OWNERSHIP_UNPROVEN',409)
  let owner=purchaser,cursor:{hostId:number;name:string;uuid:string}|undefined,previousTime=-Infinity
  // Replacements preceding the first transfer need no invented earlier owner
  // chain; their target is already independently anchored by that transfer.
  const prior=completed.filter(row=>row.taskType==='replace_host' && row.finishedAt && row.finishedAt.getTime()<firstTransfer)
    .sort((a,b)=>b.finishedAt!.getTime()-a.finishedAt!.getTime())[0]
  let latestReplacementUuid=(prior?.replacementState as {stage?:string;targetUuid?:string}|null)?.stage==='delivered'
    ? (prior!.replacementState as {targetUuid?:string}).targetUuid : undefined
  for(const event of events){
    ensure(event.time>previousTime,'OSS_RECOVERY_OWNERSHIP_UNPROVEN',409)
    if(event.transfer){
      const transfer=event.transfer
      const state=transfer.cleanupState as {stage?:string;sourceOwnerId?:number;targetOwnerId?:number;hostId?:number;remoteUuid?:string;oldIncusId?:string;newIncusId?:string}|null
      ensure(transfer.fromUserId===owner && transfer.toUserId!==owner && Number.isSafeInteger(transfer.toUserId) && transfer.toUserId>0 &&
        state?.stage==='finalize' && state.sourceOwnerId===owner && state.targetOwnerId===transfer.toUserId && Number.isSafeInteger(state.hostId) && state.hostId!>0 &&
        typeof state.remoteUuid==='string' && uuidPattern.test(state.remoteUuid) && state.oldIncusId && state.newIncusId &&
        (!cursor || state.oldIncusId===cursor.name && state.hostId===cursor.hostId && state.remoteUuid===cursor.uuid),'OSS_RECOVERY_OWNERSHIP_UNPROVEN',409)
      owner=transfer.toUserId;cursor={hostId:state.hostId!,name:state.newIncusId,uuid:state.remoteUuid}
    }else{
      const task=event.task!
      const state=task.replacementState as {stage?:string;sourceHostId?:number;sourceIncusId?:string;sourceUuid?:string;
        targetIncusId?:string;targetUuid?:string;targetCreatedAt?:string;sourceHostIdentity?:string;targetHostIdentity?:string}|null
      ensure(Number.isFinite(task.createdAt.getTime()) && task.createdAt.getTime()>=paidAt.getTime() && task.createdAt.getTime()>previousTime && task.createdAt.getTime()<=event.time &&
        state?.stage==='delivered' && Number.isSafeInteger(state.sourceHostId) && state.sourceHostId!>0 &&
        Number.isSafeInteger(task.targetHostId) && task.targetHostId!>0 && task.hostId===task.targetHostId && state.sourceHostId!==task.targetHostId &&
        typeof state.sourceIncusId==='string' && !!state.sourceIncusId && typeof state.targetIncusId==='string' && !!state.targetIncusId &&
        typeof state.targetUuid==='string' && uuidPattern.test(state.targetUuid) && typeof state.targetCreatedAt==='string' &&
        Number.isFinite(Date.parse(state.targetCreatedAt)) && Date.parse(state.targetCreatedAt)<=event.time &&
        (!state.sourceUuid || uuidPattern.test(state.sourceUuid)) &&
        [state.sourceHostIdentity,state.targetHostIdentity].every(value=>typeof value==='string' && /^[a-f0-9]{64}$/.test(value)) &&
        (!cursor || cursor.hostId===state.sourceHostId && cursor.name===state.sourceIncusId && (!state.sourceUuid || state.sourceUuid===cursor.uuid)),
        'OSS_RECOVERY_REPLACEMENT_UNPROVEN',409)
      // Legacy completed replacements lack sourceUuid. The same instance ID,
      // source host/name and ordered prior transfer establish that old leg;
      // the saved target UUID anchors all following transfers and the live check.
      cursor={hostId:task.targetHostId!,name:state.targetIncusId,uuid:state.targetUuid}
      latestReplacementUuid=state.targetUuid
    }
    previousTime=event.time
  }
  ensure(owner===instance.userId && cursor?.hostId===instance.hostId && cursor.name===instance.incusId &&
    cursor.uuid===(latestReplacementUuid||originalUuid),'OSS_RECOVERY_OWNERSHIP_UNPROVEN',409)
}
