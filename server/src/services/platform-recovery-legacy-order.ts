import { Prisma } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { prisma } from '../db/prisma.js'
import { ensure } from './platform-backup-core.js'
import { activeRecoveryBatch, recoveryHostSourceHash, RECOVERY_LEGACY_SOURCE_SQL, RECOVERY_LEGACY_RESOLVED_SQL } from './platform-recovery-state.js'
import { recoveryHash } from './platform-recovery-evidence.js'
import { recoveryMoneyCents, recoveredPartialPrincipal } from './platform-recovery-accounting.js'
import { assertRecoveryOrderOwnership } from './platform-recovery-ownership.js'
import { reconcileTransferredWallet } from './platform-recovery-wallet.js'
import { recoverySettledDeletion, recoveryFailedProvision, assertRecoveryRefundableLifecycle } from './platform-recovery-lifecycle.js'
import { recoveredLifecycleLedger } from './platform-recovery-lifecycle-ledger.js'
import { tryAdvisoryTransactionLock, USER_BALANCE_LOCK_NAMESPACE } from '../db/advisory-locks.js'
import type { RecoveryOrderResolution } from './platform-recovery-orders.js'
import { validateId } from './platform-backup-core.js'
import { validateRecoveryEvidence } from './platform-recovery-state.js'
import { reauthenticateRecoveryOperator } from './platform-recovery-operator.js'

type Db=Prisma.TransactionClient|typeof prisma
async function legacySnapshot(db:Db,id:string){
  ensure(!await db.checkoutOrder.count({where:{id}}),'OSS_RECOVERY_EVIDENCE_STALE',409)
  const order=await db.poolOrder.findUnique({where:{id}})
  ensure(order,'OSS_RECOVERY_ORDER_MISSING',404)
  const rawInstances=await db.instance.findMany({where:{purchaseBatchId:id},orderBy:{id:'asc'},select:{
    id:true,name:true,userId:true,hostId:true,incusId:true,status:true,version:true,deletionIntent:true,snapshottedSpecs:true,deletionBillingPending:true,provisioningCleanupPending:true}})
  const bills=await db.instanceBillingRecord.findMany({where:{OR:[{purchaseBatchId:id},
    {instanceId:{in:rawInstances.map(row=>row.id)}}]},orderBy:{id:'asc'}})
  const instances=await recoveredLifecycleLedger(db,rawInstances,bills)
  const transfers=await db.instanceTransfer.findMany({where:{instanceId:{in:instances.map(row=>row.id)}},orderBy:{id:'asc'}})
  const tasks=await db.instanceTask.findMany({where:{instanceId:{in:instances.map(row=>row.id)},taskType:{in:['replace_host','change_host','rebuild','recreate']}},orderBy:{id:'asc'}})
  const logs=await db.balanceLog.findMany({where:{OR:[{orderId:id},{id:{in:bills.flatMap(row=>row.balanceLogId?[row.balanceLogId]:[])}}]},orderBy:{id:'asc'}})
  const userIds=[...new Set([order.userId,...instances.map(row=>row.userId),...bills.map(row=>row.userId)])].sort((a,b)=>a-b)
  const accounts=await db.user.findMany({where:{id:{in:userIds}},select:{id:true,balance:true},orderBy:{id:'asc'}})
  const latest=await db.balanceLog.findMany({where:{userId:{in:userIds}},distinct:['userId'],orderBy:[{userId:'asc'},{id:'desc'}],select:{userId:true,id:true}})
  const [facts]=await db.$queryRawUnsafe<Array<{hash:string}>>(`SELECT ${RECOVERY_LEGACY_SOURCE_SQL} hash FROM pool_orders p WHERE p.id=$1`,id)
  return {order,instances,bills,transfers,tasks,logs,accounts,factHash:facts.hash,sourceHash:recoveryHash({order,instances,bills,transfers,tasks,logs,accounts,latest,factHash:facts.hash})}
}
function validateLegacy(snapshot:Awaited<ReturnType<typeof legacySnapshot>>){
  const {order,instances,bills,logs}=snapshot,total=Number(order.totalCents)
  ensure(Number.isSafeInteger(total)&&total>=0,'OSS_RECOVERY_ORDER_PRINCIPAL_MISMATCH',409)
  const purchases=bills.filter(row=>row.type==='newPurchase'),purchaseLogs=new Set(purchases.map(row=>row.balanceLogId)),
    debits=logs.filter(row=>row.type==='consume' && (purchaseLogs.has(row.id)||row.orderId===order.id))
  ensure(instances.length>0 && instances.length<=100 && purchases.length===instances.length &&
    instances.every(instance=>purchases.filter(row=>row.instanceId===instance.id).length===1), 'OSS_RECOVERY_LEGACY_PURCHASE_LINK_REQUIRED',409)
  ensure(debits.length===1 && debits[0].userId===order.userId && (!debits[0].orderId||debits[0].orderId===order.id) &&
    recoveryMoneyCents(debits[0].amount)===-total && debits[0].balanceBefore.minus(debits[0].balanceAfter).equals(debits[0].amount.negated()) &&
    purchases.every(row=>row.balanceLogId===debits[0].id && row.userId===order.userId &&
      (total===0?recoveryMoneyCents(row.amount)===0:recoveryMoneyCents(row.amount)>0)),
    'OSS_RECOVERY_LEGACY_PURCHASE_LINK_REQUIRED',409)
  ensure(purchases.reduce((n,row)=>n+recoveryMoneyCents(row.amount),0)===total,'OSS_RECOVERY_ORDER_PRINCIPAL_MISMATCH',409)
  ensure(purchases.every(row=>row.purchaseBatchId===order.id),'OSS_RECOVERY_LEGACY_PURCHASE_LINK_REQUIRED',409)
  return {total,quantity:instances.length,paidAt:debits[0].createdAt,debitId:debits[0].id}
}
export async function legacyRecoveryOrderSourceHash(db:Db,id:string){return (await legacySnapshot(db,id)).sourceHash}
export async function legacyRecoveryOrder(id:string){
  const batch=await activeRecoveryBatch(),snapshot=await legacySnapshot(prisma,id)
  let quantity:number|null=null,partialUnavailableCode:string|null=null,partialAvailable=false
  try{
    const valid=validateLegacy(snapshot);quantity=valid.quantity
    if(snapshot.instances.some(row=>row.status==='deleted') && snapshot.instances.some(row=>row.status!=='deleted')){
      assertRecoveryRefundableLifecycle(snapshot.instances,true)
      recoveredPartialPrincipal(valid.total,valid.quantity,snapshot.instances,snapshot.bills);partialAvailable=true
    }
  }catch(error){const code=(error as {code?:string})?.code;if(!code?.startsWith('OSS_RECOVERY_'))throw error;partialUnavailableCode=code}
  const prior=await prisma.platformRecoveryEvidence.findFirst({where:{batchId:batch.id,category:'legacy-order-resolution',reference:id},orderBy:{createdAt:'desc'}})
  const payload=prior?.payload as {factHash?:string;status?:string}|null
  return {id,userId:snapshot.order.userId,status:payload?.factHash===snapshot.factHash?payload.status||'recovery_review':'recovery_review',amountCents:Number(snapshot.order.totalCents),quantity,
    sourceHash:snapshot.sourceHash,paymentKind:'balance',balance:snapshot.accounts.find(row=>row.id===snapshot.order.userId)!.balance.toFixed(2),
    walletAccounts:snapshot.accounts.length>1?snapshot.accounts.map(row=>({userId:row.id,balance:row.balance.toFixed(2)})):[],
    receipts:[] as Array<{id:string;tradeNo:string;amountCents:number}>,refunds:[] as Array<{id:string;receiptId:string;amountCents:number;status:string}>,
    partialRefunds:[] as Array<{id:string;receiptId:string;amountCents:number;status:string}>,partialAvailable,partialUnavailableCode,
    deliveryComplete:quantity===snapshot.instances.length && quantity>0 && snapshot.instances.every(row=>['running','stopped','suspended'].includes(row.status)||recoverySettledDeletion(row)),
    missingBillingLinks:snapshot.bills.filter(row=>['renew','upgrade'].includes(row.type)&&row.amount.greaterThan(0)&&!row.balanceLogId)
      .map(row=>({id:row.id,instanceId:row.instanceId,userId:row.userId,type:row.type,amount:row.amount.toFixed(2)})),
    instances:snapshot.instances.map(row=>({id:row.id,name:row.incusId,hostId:row.hostId,status:row.status}))}
}

export interface LegacyPurchaseLinks {
  id:string;orderId:string;sourceHash:string;reference:string;evidenceHash:string;observedAt:string
  debitId:number;purchaseBillIds:number[]
}
// Restore exact foreign-key links from independent original evidence. Existing
// charges, amounts, ownership and wallet balances are never rewritten here.
export async function restoreLegacyPurchaseLinks(input:LegacyPurchaseLinks,actorId:number,credentials:{password:string;totpCode?:string}) {
  ensure(input && Object.keys(input).sort().join(',')==='debitId,evidenceHash,id,observedAt,orderId,purchaseBillIds,reference,sourceHash',
    'OSS_RECOVERY_EVIDENCE_INVALID')
  validateId(input.id);validateRecoveryEvidence(input)
  ensure(/^[A-Za-z0-9_-]{1,100}$/.test(input.orderId) && Number.isSafeInteger(input.debitId) && input.debitId>0 &&
    Array.isArray(input.purchaseBillIds) && input.purchaseBillIds.length>0 && input.purchaseBillIds.length<=100 &&
    input.purchaseBillIds.every(id=>Number.isSafeInteger(id)&&id>0) && new Set(input.purchaseBillIds).size===input.purchaseBillIds.length,
    'OSS_RECOVERY_EVIDENCE_INVALID')
  const batch=await activeRecoveryBatch(),hash=recoveryHash(input)
  ensure(Date.parse(input.observedAt)>=Date.parse(batch.hold.createdAt),'OSS_RECOVERY_EVIDENCE_TIME')
  await reauthenticateRecoveryOperator(actorId,credentials)
  return prisma.$transaction(async tx=>{
    ensure((await activeRecoveryBatch(async(sql,args=[])=>tx.$queryRawUnsafe(sql,...args))).id===batch.id,'OSS_RECOVERY_CONTEXT_CHANGED',409)
    const previous=await tx.platformRecoveryEvidence.findUnique({where:{id:input.id}})
    if(previous){ensure(previous.batchId===batch.id&&previous.sourceHash===hash,'OSS_RECOVERY_EVIDENCE_CONFLICT',409);return {id:input.id,replayed:true}}
    const initial=await legacySnapshot(tx,input.orderId)
    ensure(await tryAdvisoryTransactionLock(tx,USER_BALANCE_LOCK_NAMESPACE,initial.order.userId),'OSS_RECONCILIATION_BUSY',409)
    await tx.$queryRaw`SELECT id FROM pool_orders WHERE id=${input.orderId} FOR UPDATE`
    await tx.$queryRaw`SELECT id FROM balance_logs WHERE id=${input.debitId} FOR UPDATE`
    for(const id of [...input.purchaseBillIds].sort((a,b)=>a-b))await tx.$queryRaw`SELECT id FROM instance_billing_records WHERE id=${id} FOR UPDATE`
    const snapshot=await legacySnapshot(tx,input.orderId)
    ensure(snapshot.sourceHash===input.sourceHash,'OSS_RECOVERY_EVIDENCE_STALE',409)
    const debit=await tx.balanceLog.findUnique({where:{id:input.debitId}}),total=Number(snapshot.order.totalCents)
    const purchases=snapshot.bills.filter(bill=>bill.type==='newPurchase')
    ensure(debit && debit.type==='consume' && debit.userId===snapshot.order.userId && (!debit.orderId||debit.orderId===snapshot.order.id) &&
      recoveryMoneyCents(debit.amount)===-total && total>0 && debit.balanceBefore.minus(debit.balanceAfter).equals(debit.amount.negated()) &&
      debit.createdAt<=new Date(input.observedAt),'OSS_RECOVERY_LEGACY_PURCHASE_LINK_REQUIRED',409)
    ensure(purchases.length===input.purchaseBillIds.length && purchases.length===snapshot.instances.length &&
      purchases.every(row=>input.purchaseBillIds.includes(row.id) && row.userId===snapshot.order.userId &&
        (!row.purchaseBatchId||row.purchaseBatchId===snapshot.order.id) && (!row.balanceLogId||row.balanceLogId===debit.id)) &&
      snapshot.instances.every(instance=>purchases.filter(row=>row.instanceId===instance.id).length===1) &&
      purchases.reduce((sum,row)=>sum+recoveryMoneyCents(row.amount),0)===total && purchases.every(row=>row.amount.greaterThan(0)),
      'OSS_RECOVERY_LEGACY_PURCHASE_LINK_REQUIRED',409)
    ensure(!await tx.instanceBillingRecord.count({where:{balanceLogId:debit.id,id:{notIn:input.purchaseBillIds}}}),
      'OSS_RECOVERY_LEGACY_DEBIT_REUSED',409)
    ensure(!await tx.platformRecoveryEvidence.count({where:{batchId:batch.id,category:'legacy-purchase-links',
      payload:{path:['debitId'],equals:debit.id},NOT:{payload:{path:['orderId'],equals:input.orderId}}}}),'OSS_RECOVERY_LEGACY_DEBIT_REUSED',409)
    await tx.instanceBillingRecord.updateMany({where:{id:{in:input.purchaseBillIds}},data:{balanceLogId:debit.id,purchaseBatchId:input.orderId}})
    validateLegacy(await legacySnapshot(tx,input.orderId))
    await tx.platformRecoveryEvidence.create({data:{id:input.id,batchId:batch.id,category:'legacy-purchase-links',reference:input.reference,
      sourceHash:hash,evidenceHash:input.evidenceHash,observedAt:new Date(input.observedAt),actorId,
      payload:{orderId:input.orderId,debitId:debit.id,purchaseBillIds:input.purchaseBillIds}}})
    return {id:input.id,replayed:false}
  })
}
// Old pool purchases were wallet transactions. Read their exact newPurchase →
// balanceLogId link. Never parse a remark or create an external payment receipt.
export async function resolveLegacyRecoveryOrder(input:RecoveryOrderResolution,actorId:number){
  const batch=await activeRecoveryBatch(),hash=recoveryHash(input)
  return prisma.$transaction(async tx=>{
    ensure((await activeRecoveryBatch(async(sql,args=[])=>tx.$queryRawUnsafe(sql,...args))).id===batch.id,'OSS_RECOVERY_CONTEXT_CHANGED',409)
    const replay=await tx.platformRecoveryEvidence.findUnique({where:{id:input.id}})
    if(replay){ensure(replay.batchId===batch.id&&replay.sourceHash===hash,'OSS_RECOVERY_EVIDENCE_CONFLICT',409);return {id:replay.id,replayed:true}}
    const before=await legacySnapshot(tx,input.orderId)
    for(const account of before.accounts)ensure(await tryAdvisoryTransactionLock(tx,USER_BALANCE_LOCK_NAMESPACE,account.id),'OSS_RECONCILIATION_BUSY',409)
    await tx.$queryRaw`SELECT id FROM pool_orders WHERE id=${input.orderId} FOR UPDATE`
    const snapshot=await legacySnapshot(tx,input.orderId),valid=validateLegacy(snapshot)
    ensure(snapshot.sourceHash===input.sourceHash && snapshot.accounts.every(row=>before.accounts.some(a=>a.id===row.id)),'OSS_RECOVERY_EVIDENCE_STALE',409)
    ensure(!input.refunds.length && input.conclusion!=='unpaid','OSS_RECOVERY_EVIDENCE_INVALID')
    for(const instance of snapshot.instances){
      assertRecoveryOrderOwnership(snapshot.order.userId,valid.paidAt,instance,snapshot.transfers,snapshot.tasks)
      ensure(!instance.deletionBillingPending&&!instance.provisioningCleanupPending,'OSS_RECOVERY_DELIVERY_UNVERIFIED',409)
      const checked=await tx.platformRecoveryHost.findUnique({where:{batchId_hostId:{batchId:batch.id,hostId:instance.hostId}}})
      ensure(checked?.status==='success'&&checked.checkedAt&&checked.checkedAt.getTime()>Date.now()-86400000&&
        checked.sourceHash===await recoveryHostSourceHash(instance.hostId,async(sql,args=[])=>tx.$queryRawUnsafe(sql,...args)),'OSS_RECOVERY_DELIVERY_UNVERIFIED',409)
    }
    if(input.conclusion==='delivered')ensure(snapshot.instances.every(row=>['running','stopped','suspended'].includes(row.status)||recoverySettledDeletion(row)) &&
      input.walletBalance===undefined && input.walletTargets===undefined,'OSS_RECOVERY_DELIVERY_UNVERIFIED',409)
    else{
      assertRecoveryRefundableLifecycle(snapshot.instances,input.conclusion==='partial')
      const partial=input.conclusion==='partial'?recoveredPartialPrincipal(valid.total,valid.quantity,snapshot.instances,snapshot.bills):null
      ensure(partial||snapshot.instances.every(row=>row.status==='deleted'),'OSS_RECOVERY_DELIVERY_PRESENT',409)
      const targets=snapshot.accounts.length===1 && input.walletBalance!==undefined ? [{userId:snapshot.order.userId,balance:input.walletBalance}]:input.walletTargets
      const normalized={...snapshot,order:{...snapshot.order,totalCents:valid.total,paidAt:valid.paidAt},
        wallet:{accounts:snapshot.accounts,logs:snapshot.logs.map(row=>row.id===valid.debitId?{...row,orderId:input.orderId}:row)}}
      await reconcileTransferredWallet(tx,normalized,{...input,walletBalance:undefined,walletTargets:targets},partial)
    }
    const factHash=(await legacySnapshot(tx,input.orderId)).factHash,status=input.conclusion==='delivered'?'completed':input.conclusion
    await tx.platformRecoveryEvidence.create({data:{id:input.id,batchId:batch.id,category:'order-resolution',reference:input.id,sourceHash:hash,
      evidenceHash:input.evidenceHash,observedAt:new Date(input.observedAt),actorId,payload:{orderId:input.orderId,legacy:true,status}}})
    await tx.platformRecoveryEvidence.upsert({where:{batchId_category_reference:{batchId:batch.id,category:'legacy-order-resolution',reference:input.orderId}},
      create:{id:randomUUID(),batchId:batch.id,category:'legacy-order-resolution',reference:input.orderId,sourceHash:hash,evidenceHash:input.evidenceHash,observedAt:new Date(input.observedAt),actorId,payload:{factHash,status}},
      update:{sourceHash:hash,evidenceHash:input.evidenceHash,observedAt:new Date(input.observedAt),actorId,payload:{factHash,status}}})
    return {id:input.id,replayed:false}
  })
}

// Intact historical wallet orders need no new confirmation. This records only
// verified facts; it never provisions a guest, changes a balance or issues refunds.
export async function reconcileIntactLegacyOrders(batch:Awaited<ReturnType<typeof activeRecoveryBatch>>) {
  const candidates=await prisma.$queryRawUnsafe<Array<{id:string}>>(`SELECT p.id FROM pool_orders p
    WHERE NOT EXISTS(SELECT 1 FROM checkout_orders c WHERE c.id=p.id) AND NOT ${RECOVERY_LEGACY_RESOLVED_SQL}
    AND NOT EXISTS(SELECT 1 FROM platform_recovery_evidence a WHERE a.batch_id=$1::uuid AND a.category='legacy-order-auto'
      AND a.reference=p.id AND a.source_hash=${RECOVERY_LEGACY_SOURCE_SQL}
      AND (a.payload->>'status'='blocked' OR (a.payload->>'nextAt')::timestamptz>NOW()))
    ORDER BY COALESCE((SELECT MAX(a.created_at) FROM platform_recovery_evidence a WHERE a.batch_id=$1::uuid
      AND a.category='legacy-order-auto' AND a.reference=p.id),'epoch'::timestamptz),p.id LIMIT 4`,batch.id)
  for(const {id} of candidates)await prisma.$transaction(async tx=>{
    ensure((await activeRecoveryBatch(async(sql,args=[])=>tx.$queryRawUnsafe(sql,...args))).id===batch.id,'OSS_RECOVERY_CONTEXT_CHANGED',409)
    await tx.$queryRaw`SELECT id FROM pool_orders WHERE id=${id} FOR UPDATE`
    const [facts]=await tx.$queryRawUnsafe<Array<{hash:string}>>(`SELECT ${RECOVERY_LEGACY_SOURCE_SQL} hash FROM pool_orders p WHERE p.id=$1`,id)
    if(!facts)return
    let code:string|null=null
    try {
      const snapshot=await legacySnapshot(tx,id)
      const valid=validateLegacy(snapshot)
      ensure(snapshot.instances.every(row=>['running','stopped','suspended'].includes(row.status)||recoverySettledDeletion(row)||recoveryFailedProvision(row)),
        'OSS_RECOVERY_LEGACY_REFUND_EVIDENCE_REQUIRED',409)
      // Existing exact ledger entries can complete automatically. The read-only
      // mode neither adjusts a wallet nor creates another refund.
      const normalized={...snapshot,order:{...snapshot.order,totalCents:valid.total,paidAt:valid.paidAt},
        wallet:{accounts:snapshot.accounts,logs:snapshot.logs.map(row=>row.id===valid.debitId?{...row,orderId:id}:row)}}
      await reconcileTransferredWallet(tx,normalized,{walletTargets:snapshot.accounts.map(row=>({userId:row.id,balance:row.balance.toFixed(2)})),
          reference:'automatic-existing-ledger',observedAt:new Date().toISOString()}, {allocation:[],missingCents:0},true)
      for(const instance of snapshot.instances) {
        assertRecoveryOrderOwnership(snapshot.order.userId,valid.paidAt,instance,snapshot.transfers,snapshot.tasks)
        const checked=await tx.platformRecoveryHost.findUnique({where:{batchId_hostId:{batchId:batch.id,hostId:instance.hostId}}})
        ensure(!instance.deletionBillingPending&&!instance.provisioningCleanupPending && checked?.status==='success' && checked.checkedAt &&
          checked.checkedAt.getTime()>Date.now()-86400000 &&
          checked.sourceHash===await recoveryHostSourceHash(instance.hostId,async(sql,args=[])=>tx.$queryRawUnsafe(sql,...args)),
          'OSS_RECOVERY_DELIVERY_UNVERIFIED',409)
      }
      ensure((await legacySnapshot(tx,id)).factHash===snapshot.factHash,'OSS_RECOVERY_EVIDENCE_STALE',409)
      const status=snapshot.instances.every(recoveryFailedProvision)?'refunded':snapshot.instances.some(recoveryFailedProvision)?'partial':'completed'
      await tx.platformRecoveryEvidence.upsert({where:{batchId_category_reference:{batchId:batch.id,category:'legacy-order-resolution',reference:id}},
        create:{batchId:batch.id,category:'legacy-order-resolution',reference:id,sourceHash:snapshot.factHash,evidenceHash:recoveryHash({factHash:snapshot.factHash}),
          observedAt:new Date(),actorId:batch.operator_id,payload:{factHash:snapshot.factHash,status,automatic:true}},
        update:{sourceHash:snapshot.factHash,observedAt:new Date(),payload:{factHash:snapshot.factHash,status,automatic:true}}})
    }catch(error){code=(error as {code?:string}).code||null;if(!code?.startsWith('OSS_RECOVERY_'))throw error}
    const old=await tx.platformRecoveryEvidence.findUnique({where:{batchId_category_reference:{batchId:batch.id,category:'legacy-order-auto',reference:id}}})
    const previous=old?.payload as {attempt?:number}|null
    const attempt=old?.sourceHash===facts.hash && Number.isSafeInteger(previous?.attempt)?Math.min(previous!.attempt!+1,1000000):1
    const retry=['OSS_RECOVERY_DELIVERY_UNVERIFIED','OSS_RECOVERY_EVIDENCE_STALE','OSS_RECOVERY_TRANSFER_PENDING'].includes(code||'')
    const payload={status:code?(retry?'retry':'blocked'):'success',code,attempt,
      nextAt:new Date(Date.now()+(retry?Math.min(1800000,60000*2**Math.min(attempt-1,5)):1800000)).toISOString()}
    await tx.platformRecoveryEvidence.create({data:{batchId:batch.id,category:'legacy-order-check',reference:`order-${randomUUID()}`,
      sourceHash:facts.hash,evidenceHash:recoveryHash(payload),observedAt:new Date(),actorId:batch.operator_id,payload:{...payload,orderId:id}}})
    await tx.platformRecoveryEvidence.upsert({where:{batchId_category_reference:{batchId:batch.id,category:'legacy-order-auto',reference:id}},
      create:{batchId:batch.id,category:'legacy-order-auto',reference:id,sourceHash:facts.hash,evidenceHash:recoveryHash(payload),observedAt:new Date(),actorId:batch.operator_id,payload},
      update:{sourceHash:facts.hash,evidenceHash:recoveryHash(payload),observedAt:new Date(),createdAt:new Date(),payload}})
  })
}
