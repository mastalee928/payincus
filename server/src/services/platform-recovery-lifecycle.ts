import { ensure } from './platform-backup-core.js'

interface RecoveredGuest {
  id:number;userId:number;hostId:number;incusId:string;status:string
  snapshottedSpecs?:unknown
  recoverySettlementCents?:number
  version?:number;deletionIntent?:unknown;deletionBillingPending?:boolean;provisioningCleanupPending?:boolean
}
// A completed, non-refunding deletion ends a delivered guest's lifecycle. It is
// not failed provisioning and must never create an obligation for full principal.
export function recoveryCompletedDeletion(instance:RecoveredGuest) {
  const intent=instance.deletionIntent as Record<string,unknown>|null
  if(instance.status!=='deleted' || instance.deletionBillingPending || instance.provisioningCleanupPending || !intent)return false
  const actor=intent.actor as {id?:number}|undefined
  return intent.version===1 && intent.status==='done' && typeof intent.revision==='string' &&
    /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(intent.revision) &&
    ['admin','host','owner','user_destroy'].includes(String(intent.mode)) && Number.isSafeInteger(actor?.id) && Number(actor?.id)>0 &&
    intent.ownerId===instance.userId && intent.hostId===instance.hostId && intent.name===instance.incusId &&
    intent.instanceVersion===instance.version && typeof intent.hostIdentity==='string' && intent.hostIdentity.length>0 &&
    typeof intent.requestedAt==='string' && Date.parse(intent.requestedAt)>0 && Date.parse(intent.requestedAt)<=Date.now() &&
    typeof intent.refund==='boolean' && typeof intent.refundAmount==='number' && Number.isFinite(intent.refundAmount) &&
    /^\d+(\.\d{1,2})?$/.test(String(intent.refundAmount)) && Number.isSafeInteger(Math.round(intent.refundAmount*100)) &&
    (intent.refundBillingRecordId===undefined || Number.isSafeInteger(intent.refundBillingRecordId) && Number(intent.refundBillingRecordId)>0) &&
    Array.isArray(intent.sites) && Number.isSafeInteger(intent.attempts) && Number(intent.attempts)>=0
}
export function recoverySettledDeletion(instance:RecoveredGuest) {
  if(instance.status==='deleted' && instance.deletionIntent==null && instance.recoverySettlementCents===0 &&
    !instance.deletionBillingPending && !instance.provisioningCleanupPending)return true
  if(!recoveryCompletedDeletion(instance))return false
  const intent=instance.deletionIntent as {refund:boolean;refundAmount:number;refundPending?:boolean}
  return !intent.refund && intent.refundAmount===0 && intent.refundPending===false ||
    intent.refund && instance.recoverySettlementCents!==undefined
}
export function assertRecoveryRefundableLifecycle(instances:RecoveredGuest[],allowSettled=false) {
  ensure(allowSettled || !instances.some(recoverySettledDeletion),'OSS_RECOVERY_ORDER_ALREADY_SETTLED',409)
  ensure(!instances.some(instance=>instance.status==='deleted' && instance.deletionIntent!=null &&
    !(allowSettled&&recoverySettledDeletion(instance))),'OSS_RECOVERY_WALLET_LINEAGE_REQUIRED',409)
  ensure(instances.every(instance=>instance.status!=='deleted'||recoveryFailedProvision(instance)||allowSettled&&recoverySettledDeletion(instance)),
    'OSS_RECOVERY_DELETION_CAUSE_REQUIRED',409)
}
// The saved provisioning failure marker is written after original-target
// cleanup and purchase settlement. Current absence alone cannot prove it.
export function recoveryFailedProvision(instance:RecoveredGuest) {
  const specs=instance.snapshottedSpecs as {poolProvision?:{version?:number;phase?:string}}|null
  return instance.status==='deleted' && instance.deletionIntent==null &&
    specs?.poolProvision?.version===1 && specs.poolProvision.phase==='failed'
}
