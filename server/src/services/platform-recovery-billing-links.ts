import { prisma } from '../db/prisma.js'
import { ensure, validateId } from './platform-backup-core.js'
import { activeRecoveryBatch, validateRecoveryEvidence } from './platform-recovery-state.js'
import { reauthenticateRecoveryOperator } from './platform-recovery-operator.js'
import { recoveryHash } from './platform-recovery-evidence.js'
import { recoveryOrderSourceHash } from './platform-recovery-orders.js'
import { legacyRecoveryOrderSourceHash } from './platform-recovery-legacy-order.js'
import { tryAdvisoryTransactionLock, USER_BALANCE_LOCK_NAMESPACE } from '../db/advisory-locks.js'

export interface RecoveryBillingLinks {
  id:string;orderId:string;sourceHash:string;reference:string;evidenceHash:string;observedAt:string
  links:Array<{billId:number;debitId:number}>
}
// An original receipt names exact IDs. This operation only restores missing
// references; matching names, rounded amounts or nearby timestamps is not proof.
export async function restoreRecoveryBillingLinks(input:RecoveryBillingLinks,actorId:number,credentials:{password:string;totpCode?:string}) {
  ensure(input && Object.keys(input).sort().join(',')==='evidenceHash,id,links,observedAt,orderId,reference,sourceHash', 'OSS_RECOVERY_EVIDENCE_INVALID')
  validateId(input.id);validateRecoveryEvidence(input)
  ensure(/^[A-Za-z0-9_-]{1,100}$/.test(input.orderId) && Array.isArray(input.links) && input.links.length>0 && input.links.length<=100 &&
    input.links.every(row=>row && Object.keys(row).sort().join(',')==='billId,debitId' &&
      [row.billId,row.debitId].every(value=>Number.isSafeInteger(value)&&value>0&&value<=2147483647)) &&
    new Set(input.links.map(row=>row.billId)).size===input.links.length && new Set(input.links.map(row=>row.debitId)).size===input.links.length,
    'OSS_RECOVERY_EVIDENCE_INVALID')
  const batch=await activeRecoveryBatch(),hash=recoveryHash(input)
  ensure(Date.parse(input.observedAt)>=Date.parse(batch.hold.createdAt),'OSS_RECOVERY_EVIDENCE_TIME')
  await reauthenticateRecoveryOperator(actorId,credentials)
  return prisma.$transaction(async tx=>{
    ensure((await activeRecoveryBatch(async(sql,args=[])=>tx.$queryRawUnsafe(sql,...args))).id===batch.id,'OSS_RECOVERY_CONTEXT_CHANGED',409)
    const previous=await tx.platformRecoveryEvidence.findUnique({where:{id:input.id}})
    if(previous){ensure(previous.batchId===batch.id && previous.sourceHash===hash,'OSS_RECOVERY_EVIDENCE_CONFLICT',409);return {id:input.id,replayed:true}}
    const isCheckout=!!await tx.checkoutOrder.count({where:{id:input.orderId}})
    const readHash=()=>isCheckout?recoveryOrderSourceHash(tx,input.orderId):legacyRecoveryOrderSourceHash(tx,input.orderId)
    const ids=input.links.map(row=>row.billId),bills=await tx.instanceBillingRecord.findMany({where:{id:{in:ids}}})
    for(const userId of [...new Set(bills.map(row=>row.userId))].sort((a,b)=>a-b))
      ensure(await tryAdvisoryTransactionLock(tx,USER_BALANCE_LOCK_NAMESPACE,userId),'OSS_RECONCILIATION_BUSY',409)
    if(isCheckout)await tx.$queryRaw`SELECT id FROM checkout_orders WHERE id=${input.orderId} FOR UPDATE`
    else await tx.$queryRaw`SELECT id FROM pool_orders WHERE id=${input.orderId} FOR UPDATE`
    for(const id of [...ids].sort((a,b)=>a-b))await tx.$queryRaw`SELECT id FROM instance_billing_records WHERE id=${id} FOR UPDATE`
    for(const id of input.links.map(row=>row.debitId).sort((a,b)=>a-b))await tx.$queryRaw`SELECT id FROM balance_logs WHERE id=${id} FOR UPDATE`
    ensure(await readHash()===input.sourceHash,'OSS_RECOVERY_EVIDENCE_STALE',409)
    for(const link of input.links){
      const bill=await tx.instanceBillingRecord.findUnique({where:{id:link.billId},include:{instance:{select:{purchaseBatchId:true}}}})
      const debit=await tx.balanceLog.findUnique({where:{id:link.debitId}})
      ensure(bill && ['renew','upgrade'].includes(bill.type) && bill.amount.greaterThan(0) && bill.instance.purchaseBatchId===input.orderId &&
        (!bill.balanceLogId||bill.balanceLogId===link.debitId) && debit && debit.type==='consume' && debit.userId===bill.userId && debit.instanceId===bill.instanceId &&
        !debit.orderId && debit.amount.equals(bill.amount.negated()) && debit.balanceAfter.minus(debit.balanceBefore).equals(debit.amount) &&
        debit.createdAt<=bill.createdAt && bill.createdAt<=new Date(input.observedAt), 'OSS_RECOVERY_BILLING_LINK_INVALID',409)
      ensure(!await tx.instanceBillingRecord.count({where:{balanceLogId:link.debitId,id:{not:link.billId}}}),'OSS_RECOVERY_LEGACY_DEBIT_REUSED',409)
      await tx.instanceBillingRecord.update({where:{id:link.billId},data:{balanceLogId:link.debitId}})
    }
    await tx.platformRecoveryEvidence.create({data:{id:input.id,batchId:batch.id,category:'billing-links',reference:input.id,
      evidenceHash:input.evidenceHash,sourceHash:hash,observedAt:new Date(input.observedAt),actorId,payload:{orderId:input.orderId,links:input.links,reference:input.reference}}})
    return {id:input.id,replayed:false}
  })
}
