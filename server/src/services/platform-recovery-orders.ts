import { Prisma } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { ensure, validateId } from './platform-backup-core.js'
import { activeRecoveryBatch, validateRecoveryEvidence, recoveryHostSourceHash, RECOVERY_CHECKOUT_SOURCE_SQL } from './platform-recovery-state.js'
import { reauthenticateRecoveryOperator } from './platform-recovery-operator.js'
import { recoveryHash } from './platform-recovery-evidence.js'
import { tryAdvisoryTransactionLock, USER_BALANCE_LOCK_NAMESPACE } from '../db/advisory-locks.js'
import { recoveryOrderQuantity, assertRecoveredOrderPrincipal, recoveredPartialPrincipal } from './platform-recovery-accounting.js'
import { assertRecoveryOrderOwnership } from './platform-recovery-ownership.js'
import { reconcileTransferredWallet, type RecoveryWalletTarget } from './platform-recovery-wallet.js'
import { recoverySettledDeletion, assertRecoveryRefundableLifecycle } from './platform-recovery-lifecycle.js'
import { recoveredLifecycleLedger } from './platform-recovery-lifecycle-ledger.js'
import { automaticResumeDecision } from './platform-recovery-policy.js'
import { randomUUID } from 'node:crypto'
import { assertRecoveryExternalLedger } from './platform-recovery-external-ledger.js'

type Db = Prisma.TransactionClient | typeof prisma
async function orderSnapshot(db: Db, id: string) {
  const order = await db.checkoutOrder.findUnique({ where: { id }, include: { payments: { orderBy: { id: 'asc' },
    include: { receipts: { orderBy: { id: 'asc' } } } }, refunds: { orderBy: { id: 'asc' } }, reservations: { orderBy: { hostId: 'asc' } } } })
  ensure(order, 'OSS_RECOVERY_ORDER_MISSING', 404)
  const rawInstances = await db.instance.findMany({ where: { purchaseBatchId: id }, orderBy: { id: 'asc' },
    select: { id: true, name:true, userId: true, hostId: true, incusId: true, status: true, version:true, deletionIntent:true, snapshottedSpecs: true, deletionBillingPending: true, provisioningCleanupPending: true } })
  const bills = await db.instanceBillingRecord.findMany({where:{OR:[{purchaseBatchId:id},
    {instanceId:{in:rawInstances.map(row=>row.id)}}]},orderBy:{id:'asc'}})
  const instances=await recoveredLifecycleLedger(db,rawInstances,bills)
  const transfers=await db.instanceTransfer.findMany({where:{instanceId:{in:instances.map(row=>row.id)}},orderBy:{id:'asc'}})
  const tasks=await db.instanceTask.findMany({where:{instanceId:{in:instances.map(row=>row.id)},taskType:{in:['replace_host','change_host','rebuild','recreate']}},orderBy:{id:'asc'}})
  const billingLogs=await db.balanceLog.findMany({where:{id:{in:bills.flatMap(row=>row.balanceLogId?[row.balanceLogId]:[])}} ,orderBy:{id:'asc'}})
  const walletOwners=[...new Set([order.userId,...instances.map(row=>row.userId),...bills.map(row=>row.userId)])].sort((a,b)=>a-b)
  const wallet = order.paymentId === 'balance' ? {
    account: await db.user.findUniqueOrThrow({ where: { id: order.userId }, select: { balance: true } }),
    accounts:await db.user.findMany({where:{id:{in:walletOwners}},orderBy:{id:'asc'},select:{id:true,balance:true}}),
    logs: await db.balanceLog.findMany({ where: { OR:[{orderId:id},{id:{in:bills.flatMap(b=>b.balanceLogId?[b.balanceLogId]:[])}}] }, orderBy: { id: 'asc' } }),
    latest: await db.balanceLog.findMany({ where: { userId:{in:walletOwners} },distinct:['userId'],orderBy:[{userId:'asc'},{id:'desc'}],select:{id:true,userId:true} })
  } : null
  return { order, instances, wallet, bills, transfers, tasks, sourceHash: recoveryHash({ order, instances, wallet, bills, transfers, tasks, billingLogs }) }
}
export async function recoveryOrderSourceHash(db: Db, id: string) {
  return (await orderSnapshot(db,id)).sourceHash
}
function duplicateReceiptRefunds(snapshot:Awaited<ReturnType<typeof orderSnapshot>>) {
  const {order}=snapshot
  return order.payments.filter(payment=>payment.id!==order.paymentId).flatMap(payment=>payment.receipts.flatMap(receipt=>{
    const remaining=receipt.amountCents-order.refunds.filter(row=>row.receiptId===receipt.id).reduce((sum,row)=>sum+row.amountCents,0)
    ensure(remaining>=0,'OSS_RECOVERY_REFUND_MISMATCH',409)
    return remaining?[{id:`recovery-receipt:${receipt.id}`,orderId:order.id,paymentId:payment.id,receiptId:receipt.id,
      amountCents:remaining,principalCents:0,reason:'recovery-duplicate-payment',status:'pending'}]:[]
  }))
}
function partialRefundPlan(snapshot:Awaited<ReturnType<typeof orderSnapshot>>) {
  const {order,instances,bills,wallet}=snapshot
  assertRecoveryRefundableLifecycle(instances,true)
  const plan=recoveredPartialPrincipal(order.totalCents,recoveryOrderQuantity(order.display),instances,bills)
  const missing:Array<{instanceId:number|null;principalCents:number}>=plan.allocation.filter(row=>row.status==='deleted' &&
    !recoverySettledDeletion(instances.find(instance=>instance.id===row.id)!)).map(row=>({instanceId:row.id,principalCents:row.principalCents}))
  if(plan.missingCents)missing.push({instanceId:null,principalCents:plan.missingCents})
  if(wallet)return {plan,refunds:[]}
  const primary=order.payments.find(payment=>payment.id===order.paymentId)
  ensure(primary && primary.receipts.length===1 && primary.payableCents-primary.feeCents===order.totalCents &&
    primary.receipts[0].amountCents===primary.payableCents,'OSS_RECOVERY_ORDER_PRINCIPAL_MISMATCH',409)
  const receipt=primary.receipts[0]
  const existing=order.refunds.filter(row=>row.receiptId===receipt.id)
  let prior=existing.reduce((n,row)=>n+row.amountCents,0),principalBefore=existing.reduce((n,row)=>n+row.principalCents,0)
  const refunds=[]
  for(const item of missing) {
    const allocated=existing.filter(row=>row.instanceId===item.instanceId).reduce((n,row)=>n+row.principalCents,0)
    ensure(allocated<=item.principalCents,'OSS_RECOVERY_REFUND_MISMATCH',409)
    const principalCents=item.principalCents-allocated
    if(!principalCents)continue
    ensure(principalBefore+principalCents<=order.totalCents,'OSS_RECOVERY_REFUND_MISMATCH',409)
    const entitlement=Math.round((principalBefore+principalCents)*primary.payableCents/order.totalCents)
    const amountCents=entitlement-prior
    ensure(amountCents>0 && entitlement<=receipt.amountCents,'OSS_RECOVERY_REFUND_MISMATCH',409)
    refunds.push({id:item.instanceId?`recovery-instance:${item.instanceId}`:`recovery-partial:${receipt.id}`,
      orderId:order.id,paymentId:primary.id,receiptId:receipt.id,instanceId:item.instanceId,principalCents,amountCents,
      reason:'recovery-evidenced',status:'pending'})
    principalBefore+=principalCents;prior+=amountCents
  }
  return {plan,refunds}
}
export async function recoveryOrder(id: string) {
  await activeRecoveryBatch()
  ensure(typeof id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(id), 'OSS_RECOVERY_EVIDENCE_INVALID')
  if(!await prisma.checkoutOrder.count({where:{id}}))return (await import('./platform-recovery-legacy-order.js')).legacyRecoveryOrder(id)
  const snapshot=await orderSnapshot(prisma, id)
  const { order, instances, wallet, sourceHash } = snapshot
  const refunds = order.refunds.map(r => ({ id: r.id, receiptId: r.receiptId, amountCents: r.amountCents, status: r.status }))
  const resourcesAbsent = !instances.some(i => i.status !== 'deleted' || i.deletionBillingPending || i.provisioningCleanupPending)
  let refundableLifecycle=true
  try{assertRecoveryRefundableLifecycle(instances)}catch{refundableLifecycle=false}
  if(!resourcesAbsent || !refundableLifecycle)refunds.push(...duplicateReceiptRefunds(snapshot).map(row=>({id:row.id,receiptId:row.receiptId,amountCents:row.amountCents,status:'unrecorded'})))
  if (resourcesAbsent && refundableLifecycle) for (const payment of order.payments) for (const receipt of payment.receipts) {
    const remaining = receipt.amountCents - refunds.filter(r => r.receiptId === receipt.id).reduce((n,r) => n + r.amountCents, 0)
    if (remaining > 0) refunds.push({ id: `recovery-receipt:${receipt.id}`, receiptId: receipt.id, amountCents: remaining, status: 'unrecorded' })
  }
  const quantity=Array.isArray(order.display) && order.display.length ? recoveryOrderQuantity(order.display) : null
  const deliveryComplete=quantity===instances.length && instances.length>0 && instances.every(row=>
    ['running','stopped','suspended'].includes(row.status)||recoverySettledDeletion(row))
  let partialRefunds:typeof refunds=[],partialAvailable=false,partialUnavailableCode:string|null=null
  // Invalid/incomplete principal cannot be offered as a terminal conclusion.
  try {
    const partial=partialRefundPlan(snapshot);partialAvailable=true
    partialRefunds=[...order.refunds.map(r=>({id:r.id,receiptId:r.receiptId,amountCents:r.amountCents,status:r.status})),
      ...[...partial.refunds,...duplicateReceiptRefunds(snapshot)].map(r=>({id:r.id,receiptId:r.receiptId,amountCents:r.amountCents,status:'unrecorded'}))]
  }catch(error){const code=(error as {code?:string})?.code;if(!code?.startsWith('OSS_RECOVERY_'))throw error;partialUnavailableCode=code}
  return { id, userId: order.userId, status: order.status, amountCents: order.totalCents, quantity, sourceHash,
    paymentKind: wallet ? 'balance' : 'external', balance: wallet?.account.balance.toFixed(2) ?? null,
    walletAccounts:wallet && wallet.accounts.length>1 ? wallet.accounts.map(row=>({userId:row.id,balance:row.balance.toFixed(2)})):[],
    receipts: order.payments.flatMap(p => p.receipts.map(r => ({ id: r.id, tradeNo: r.tradeNo, amountCents: r.amountCents }))),
    refunds,partialRefunds,partialAvailable,partialUnavailableCode,deliveryComplete,
    missingBillingLinks:snapshot.bills.filter(row=>['renew','upgrade'].includes(row.type)&&row.amount.greaterThan(0)&&!row.balanceLogId)
      .map(row=>({id:row.id,instanceId:row.instanceId,userId:row.userId,type:row.type,amount:row.amount.toFixed(2)})),
    instances: instances.map(i => ({ id: i.id, name: i.incusId, hostId: i.hostId, status: i.status })) }
}
export interface RecoveryOrderResolution {
  id: string; orderId: string; sourceHash: string; reference: string; evidenceHash: string; observedAt: string
  conclusion: 'unpaid' | 'delivered' | 'partial' | 'refunded'
  refunds: Array<{ id: string; reference: string }>
  walletBalance?: string
  walletTargets?: RecoveryWalletTarget[]
}
export async function resolveRecoveryOrder(input: RecoveryOrderResolution, actorId: number, credentials: { password: string; totpCode?: string }) {
  const batch = await activeRecoveryBatch()
  ensure(input && Object.keys(input).filter(key => !['walletBalance','walletTargets'].includes(key)).sort().join(',') === 'conclusion,evidenceHash,id,observedAt,orderId,reference,refunds,sourceHash', 'OSS_RECOVERY_EVIDENCE_INVALID')
  ensure(input.walletBalance === undefined || typeof input.walletBalance === 'string' && /^(0|[1-9][0-9]{0,7})\.[0-9]{2}$/.test(input.walletBalance), 'OSS_RECOVERY_EVIDENCE_INVALID')
  ensure(input.walletTargets===undefined || Array.isArray(input.walletTargets) && input.walletTargets.length<=201 && input.walletTargets.every(row=>
    row && Object.keys(row).sort().join(',')==='balance,userId' && Number.isSafeInteger(row.userId) && row.userId>0 &&
    typeof row.balance==='string' && /^(0|[1-9][0-9]{0,7})\.[0-9]{2}$/.test(row.balance)),'OSS_RECOVERY_EVIDENCE_INVALID')
  validateId(input.id); validateRecoveryEvidence(input)
  ensure(Date.parse(input.observedAt) >= Date.parse(batch.hold.createdAt) && ['unpaid','delivered','partial','refunded'].includes(input.conclusion) &&
    Array.isArray(input.refunds) && input.refunds.length <= 100 && input.refunds.every(r => r && Object.keys(r).sort().join(',') === 'id,reference' &&
      typeof r.id === 'string' && r.id.length <= 120 && /^[A-Za-z0-9_.:/-]{6,120}$/.test(r.reference)) &&
    new Set(input.refunds.map(r=>r.id)).size===input.refunds.length, 'OSS_RECOVERY_EVIDENCE_INVALID')
  await reauthenticateRecoveryOperator(actorId, credentials)
  if(!await prisma.checkoutOrder.count({where:{id:input.orderId}}))return (await import('./platform-recovery-legacy-order.js')).resolveLegacyRecoveryOrder(input,actorId)
  return resolveCheckedOrder(input,actorId,batch)
}
// Private entry for the protected worker: the automatic path only requests
// already delivered or never-paid conclusions, and supplies no new money proof.
async function resolveCheckedOrder(input:RecoveryOrderResolution,actorId:number,batch:Awaited<ReturnType<typeof activeRecoveryBatch>>) {
  const hash = recoveryHash(input)
  return prisma.$transaction(async tx => {
    ensure((await activeRecoveryBatch(async(sql,args=[])=>tx.$queryRawUnsafe(sql,...args))).id===batch.id,'OSS_RECOVERY_CONTEXT_CHANGED',409)
    const previous = await tx.platformRecoveryEvidence.findUnique({where:{id:input.id}})
    if(previous){ensure(previous.batchId===batch.id && previous.sourceHash===hash,'OSS_RECOVERY_EVIDENCE_CONFLICT',409);return {id:previous.id,replayed:true}}
    const owner = await tx.checkoutOrder.findUnique({ where: { id: input.orderId }, select: { userId: true } })
    ensure(owner,'OSS_RECOVERY_ORDER_MISSING',404)
    const initial=await orderSnapshot(tx,input.orderId)
    const candidateOwners=initial.wallet?.accounts.map(row=>row.id)||[...new Set([owner.userId,...initial.bills.map(row=>row.userId)])].sort((a,b)=>a-b)
    for(const userId of candidateOwners)ensure(await tryAdvisoryTransactionLock(tx,USER_BALANCE_LOCK_NAMESPACE,userId),'OSS_RECONCILIATION_BUSY',409)
    await tx.$queryRaw`SELECT id FROM checkout_orders WHERE id=${input.orderId} FOR UPDATE`
    const snapshot=await orderSnapshot(tx,input.orderId)
    const {order,instances,wallet,bills,sourceHash}=snapshot
    ensure(!wallet || wallet.accounts.every(row=>candidateOwners.includes(row.id)),'OSS_RECOVERY_EVIDENCE_STALE',409)
    ensure(input.walletBalance===undefined || wallet && ['refunded','partial'].includes(input.conclusion),'OSS_RECOVERY_EVIDENCE_INVALID')
    ensure(input.walletTargets===undefined || wallet && wallet.accounts.length>1 && ['refunded','partial'].includes(input.conclusion),'OSS_RECOVERY_EVIDENCE_INVALID')
    ensure(sourceHash===input.sourceHash && ['recovery_review','completed','partial','refunded','cancelled','expired'].includes(order.status),'OSS_RECOVERY_EVIDENCE_STALE',409)
    const receipts=order.payments.flatMap(p=>p.receipts)
    let status:string|undefined
    if(input.conclusion==='unpaid'){
      ensure(!order.paidAt && !receipts.length && !instances.length && !order.refunds.length && !input.refunds.length,'OSS_RECOVERY_ORDER_NOT_UNPAID',409)
      status='cancelled'
    }else{
      ensure(order.paidAt && (order.paymentId==='balance' || receipts.length),'OSS_RECOVERY_RECEIPT_REQUIRED',409)
      const partial=input.conclusion==='partial'?partialRefundPlan(snapshot):null
      if(input.conclusion==='delivered'||partial)for(const refund of duplicateReceiptRefunds(snapshot)){
        ensure(input.refunds.some(row=>row.id===refund.id),'OSS_RECOVERY_REFUND_UNREVIEWED',409)
        order.refunds.push(await tx.checkoutRefund.create({data:{...refund,createdAt:new Date(input.observedAt)}}))
      }
      if(partial)for(const refund of partial.refunds) {
        ensure(input.refunds.some(row=>row.id===refund.id),'OSS_RECOVERY_REFUND_UNREVIEWED',409)
        order.refunds.push(await tx.checkoutRefund.create({data:{...refund,createdAt:new Date(input.observedAt)}}))
      }
      if(input.conclusion==='refunded') {
        assertRecoveryRefundableLifecycle(instances)
        ensure(!instances.some(i=>i.status!=='deleted'||i.deletionBillingPending||i.provisioningCleanupPending),'OSS_RECOVERY_DELIVERY_PRESENT',409)
        for(const receipt of receipts) {
          const remaining=receipt.amountCents-order.refunds.filter(r=>r.receiptId===receipt.id).reduce((sum,r)=>sum+r.amountCents,0)
          ensure(remaining>=0,'OSS_RECOVERY_REFUND_MISMATCH',409)
          if(remaining) {
            const id=`recovery-receipt:${receipt.id}`
            ensure(input.refunds.some(r=>r.id===id),'OSS_RECOVERY_REFUND_UNREVIEWED',409)
            const payment=order.payments.find(p=>p.id===receipt.paymentId)!
            const principal=receipt.paymentId===order.paymentId ? Math.max(0,order.totalCents-order.refunds.filter(r=>r.paymentId===payment.id).reduce((sum,r)=>sum+r.principalCents,0)) : 0
            order.refunds.push(await tx.checkoutRefund.create({data:{id,orderId:order.id,paymentId:payment.id,receiptId:receipt.id,
              amountCents:remaining,principalCents:principal,reason:'recovery-evidenced',status:'pending',createdAt:new Date(input.observedAt)}}))
          }
        }
      }
      // Already recorded refund evidence is sufficient to repair its missing
      // billing link. Do not demand a second entry of the same bank reference.
      const resolutions=[...input.refunds]
      for(const refund of order.refunds)if(refund.status==='refunded' && refund.instanceId && refund.principalCents>0 && !refund.billingRecordId &&
        !resolutions.some(row=>row.id===refund.id)){
        ensure(refund.resolution && /^[A-Za-z0-9_.:/-]{6,120}$/.test(refund.resolution),'OSS_RECOVERY_REFUND_UNREVIEWED',409)
        resolutions.push({id:refund.id,reference:refund.resolution})
      }
      for(const resolution of resolutions){
        const refund=order.refunds.find(r=>r.id===resolution.id)
        ensure(refund && ['pending','refunded'].includes(refund.status),'OSS_RECOVERY_REFUND_MISMATCH',409)
        if (refund.instanceId && refund.principalCents > 0 && !refund.billingRecordId) {
          const purchase=bills.filter(b=>b.type==='newPurchase'&&b.instanceId===refund.instanceId)
          // An unlinked negative bill is ambiguous. Never add another debit or
          // guess which receipt it belongs to just to make the totals agree.
          ensure(purchase.length===1 && !bills.some(b=>b.type==='refund'&&b.instanceId===refund.instanceId &&
            !order.refunds.some(r=>r.billingRecordId===b.id)), 'OSS_RECOVERY_REFUND_BILLING_CONFLICT',409)
          const charged=purchase[0],debited=bills.filter(b=>b.type==='refund'&&b.instanceId===refund.instanceId)
            .reduce((sum,b)=>sum.minus(b.amount),new Prisma.Decimal(0))
          ensure(charged.amount.minus(debited).greaterThanOrEqualTo(new Prisma.Decimal(refund.principalCents).div(100)), 'OSS_RECOVERY_REFUND_MISMATCH',409)
          const bill=await tx.instanceBillingRecord.create({data:{userId:charged.userId,instanceId:charged.instanceId,type:'refund',
            amount:new Prisma.Decimal(refund.principalCents).div(-100),months:0,periodStart:charged.periodStart,periodEnd:charged.periodEnd,
            purchaseBatchId:order.id,createdAt:new Date(input.observedAt),remark:`Recovered original-channel refund; evidence ${input.reference}`}})
          await tx.checkoutRefund.update({where:{id:refund.id},data:{billingRecordId:bill.id}})
          refund.billingRecordId=bill.id;bills.push(bill)
        }
        if(refund.status==='refunded') ensure(refund.resolution===resolution.reference,'OSS_RECOVERY_EVIDENCE_CONFLICT',409)
        else await tx.checkoutRefund.update({where:{id:refund.id},data:{status:'refunded',resolution:resolution.reference,handledAt:new Date(input.observedAt),handledById:actorId}})
      }
      ensure(order.refunds.every(r=>r.status==='refunded'||input.refunds.some(v=>v.id===r.id)),'OSS_RECOVERY_REFUND_UNREVIEWED',409)
      for(const receipt of receipts)ensure(order.refunds.filter(row=>row.receiptId===receipt.id).reduce((n,row)=>n+row.amountCents,0)<=receipt.amountCents,
        'OSS_RECOVERY_REFUND_MISMATCH',409)
      if(input.conclusion==='delivered' || partial){
        if(!partial)assertRecoveredOrderPrincipal(order.totalCents,recoveryOrderQuantity(order.display),instances,bills)
        if (wallet) {
          const purchaseLogs=new Set(bills.filter(row=>row.type==='newPurchase').map(row=>row.balanceLogId))
          const paid=wallet.logs.filter(row=>row.type==='consume' && (row.orderId===order.id || purchaseLogs.has(row.id)))
            .reduce((sum,row)=>sum.minus(row.amount),new Prisma.Decimal(0))
          ensure(paid.equals(new Prisma.Decimal(order.totalCents).div(100)), 'OSS_RECOVERY_ORDER_PRINCIPAL_MISMATCH',409)
          if(!partial)await reconcileTransferredWallet(tx,snapshot,{walletTargets:wallet.accounts.map(row=>({userId:row.id,balance:row.balance.toFixed(2)})),
            reference:input.reference,observedAt:input.observedAt},{allocation:[],missingCents:0},true)
        } else {
          const primary=order.payments.find(payment=>payment.id===order.paymentId)
          ensure(primary && primary.payableCents-primary.feeCents===order.totalCents && primary.receipts.length===1 &&
            primary.receipts[0].amountCents===primary.payableCents,'OSS_RECOVERY_ORDER_PRINCIPAL_MISMATCH',409)
          for (const payment of order.payments.filter(payment=>payment.id!==order.paymentId)) for(const receipt of payment.receipts) {
            ensure(order.refunds.filter(refund=>refund.receiptId===receipt.id).reduce((sum,refund)=>sum+refund.amountCents,0)===receipt.amountCents,
              'OSS_RECOVERY_REFUND_INCOMPLETE',409)
          }
        }
        ensure(instances.length>0 && instances.every(i=>(['running','stopped','suspended'].includes(i.status) || recoverySettledDeletion(i) || partial && i.status==='deleted') &&
          !i.deletionBillingPending && !i.provisioningCleanupPending),'OSS_RECOVERY_DELIVERY_UNVERIFIED',409)
        for(const instance of instances){
          assertRecoveryOrderOwnership(order.userId,order.paidAt!,instance,snapshot.transfers,snapshot.tasks)
          const result=await tx.platformRecoveryHost.findUnique({where:{batchId_hostId:{batchId:batch.id,hostId:instance.hostId}}})
          ensure(result?.status==='success' && result.checkedAt && result.checkedAt.getTime()>Date.now()-86400000 &&
            result.sourceHash===await recoveryHostSourceHash(instance.hostId, async (sql,values=[])=>tx.$queryRawUnsafe(sql,...values)),'OSS_RECOVERY_DELIVERY_UNVERIFIED',409)
        }
        if(partial && !wallet) {
          const receipt=order.payments.find(payment=>payment.id===order.paymentId)!.receipts[0]
          const originalRefunds=order.refunds.filter(row=>row.receiptId===receipt.id)
          ensure(originalRefunds.filter(row=>!row.instanceId).reduce((n,row)=>n+row.principalCents,0)===partial.plan.missingCents,
            'OSS_RECOVERY_REFUND_INCOMPLETE',409)
          for(const item of partial.plan.allocation) {
            const refunded=originalRefunds.filter(row=>row.instanceId===item.id).reduce((n,row)=>n+row.principalCents,0)
            const negative=bills.filter(row=>row.instanceId===item.id && row.type==='refund').reduce((n,row)=>n.minus(row.amount),new Prisma.Decimal(0))
            ensure(refunded<=item.principalCents && negative.equals(new Prisma.Decimal(refunded).div(100)) &&
              (item.status!=='deleted'||recoverySettledDeletion(instances.find(instance=>instance.id===item.id)!)||refunded===item.principalCents),'OSS_RECOVERY_REFUND_INCOMPLETE',409)
          }
          ensure(originalRefunds.every(row=>!row.instanceId || partial.plan.allocation.some(item=>item.id===row.instanceId)),
            'OSS_RECOVERY_REFUND_MISMATCH',409)
        }
        status=partial?'partial':'completed'
      }
      if(input.conclusion==='refunded' || partial && wallet){
        if(!partial)
        ensure(!instances.some(i=>i.status!=='deleted'||i.deletionBillingPending||i.provisioningCleanupPending),'OSS_RECOVERY_DELIVERY_PRESENT',409)
        if(wallet) {
            ensure(!input.refunds.length,'OSS_RECOVERY_EVIDENCE_INVALID')
            ensure(wallet.accounts.length>1 || input.walletBalance!==undefined,'OSS_RECOVERY_BALANCE_REQUIRED',409)
            if(!partial)for(const instance of instances){
              const checked=await tx.platformRecoveryHost.findUnique({where:{batchId_hostId:{batchId:batch.id,hostId:instance.hostId}}})
              ensure(checked?.status==='success' && checked.checkedAt && checked.checkedAt.getTime()>Date.now()-86400000 &&
                checked.sourceHash===await recoveryHostSourceHash(instance.hostId,async(sql,args=[])=>tx.$queryRawUnsafe(sql,...args)),'OSS_RECOVERY_DELIVERY_UNVERIFIED',409)
            }
            await reconcileTransferredWallet(tx,snapshot,{...input,walletBalance:undefined,
              walletTargets:wallet.accounts.length===1?[{userId:order.userId,balance:input.walletBalance!}]:input.walletTargets},partial?.plan||null)
        } else ensure(input.walletBalance===undefined && receipts.every(receipt=>order.refunds.filter(r=>r.receiptId===receipt.id).reduce((sum,r)=>sum+r.amountCents,0)===receipt.amountCents),
          'OSS_RECOVERY_REFUND_INCOMPLETE',409)
        status=partial?'partial':'refunded'
      }
    }
    if(order.paidAt && !wallet)await assertRecoveryExternalLedger(tx,snapshot,new Date(input.observedAt))
    ensure(status,'OSS_RECOVERY_EVIDENCE_INVALID')
    await tx.checkoutReservation.deleteMany({where:{orderId:order.id}})
    await tx.checkoutOrder.update({where:{id:order.id},data:{status}})
    await tx.platformRecoveryEvidence.create({data:{id:input.id,batchId:batch.id,category:'order-resolution',reference:input.id,
      evidenceHash:input.evidenceHash,sourceHash:hash,observedAt:new Date(input.observedAt),actorId,payload:{reference:input.reference,orderId:order.id,conclusion:input.conclusion,refunds:input.refunds,
        ...(input.walletBalance===undefined ? {} : {walletBalance:input.walletBalance}),
        ...(input.walletTargets===undefined ? {} : {walletTargets:input.walletTargets})}}})
    return {id:input.id,replayed:false}
  })
}

export async function reconcileIntactCheckoutOrders(batch:Awaited<ReturnType<typeof activeRecoveryBatch>>) {
  const orders=await prisma.$queryRaw<Array<{id:string}>>`SELECT c.id FROM checkout_orders c
    LEFT JOIN platform_recovery_evidence a ON a.batch_id=${batch.id}::uuid AND a.category='checkout-order-auto' AND a.reference=c.id
    WHERE c.status='recovery_review' ORDER BY COALESCE(a.created_at,'epoch'::timestamptz),c.id LIMIT 4`
  for(const {id} of orders){
    const [facts]=await prisma.$queryRawUnsafe<Array<{hash:string}>>(`SELECT ${RECOVERY_CHECKOUT_SOURCE_SQL} hash FROM checkout_orders c WHERE c.id=$1`,id)
    if(!facts)continue
    const key={batchId_category_reference:{batchId:batch.id,category:'checkout-order-auto',reference:id}}
    const previous=await prisma.platformRecoveryEvidence.findUnique({where:key})
    const old=previous?.payload as {attempt:number;status:string;nextAt:string}|null
    const attempt=automaticResumeDecision(previous && old?{...old,sourceHash:previous.sourceHash}:null,facts.hash,Date.now())
    // Rotate observation priority without resetting the persisted retry deadline.
    if(attempt===null){await prisma.platformRecoveryEvidence.update({where:key,data:{createdAt:new Date()}});continue}
    let code:string|null=null
    try{
      const snapshot=await orderSnapshot(prisma,id)
      const receipts=snapshot.order.payments.flatMap(row=>row.receipts)
      const conclusion=!snapshot.order.paidAt&&!receipts.length?'unpaid':'delivered'
      await resolveCheckedOrder({id:randomUUID(),orderId:id,sourceHash:snapshot.sourceHash,reference:'automatic-original-ledger',
        evidenceHash:recoveryHash({originalLedger:snapshot.sourceHash}),observedAt:new Date().toISOString(),conclusion,refunds:[]},batch.operator_id,batch)
    }catch(error){code=(error as {code?:string})?.code||null;if(!code?.startsWith('OSS_'))throw error}
    const retry=['OSS_RECOVERY_DELIVERY_UNVERIFIED','OSS_RECOVERY_EVIDENCE_STALE','OSS_RECOVERY_TRANSFER_PENDING','OSS_RECONCILIATION_BUSY'].includes(code||'')
    const payload={status:code?(retry?'retry':'blocked'):'success',code,attempt,
      nextAt:new Date(Date.now()+Math.min(1800000,60000*2**Math.min(attempt-1,5))).toISOString()}
    await prisma.$transaction(async tx=>{
      ensure((await activeRecoveryBatch(async(sql,args=[])=>tx.$queryRawUnsafe(sql,...args))).id===batch.id,'OSS_RECOVERY_CONTEXT_CHANGED',409)
      await tx.platformRecoveryEvidence.create({data:{batchId:batch.id,category:'checkout-order-check',reference:`order-${randomUUID()}`,
        sourceHash:facts.hash,evidenceHash:recoveryHash(payload),observedAt:new Date(),actorId:batch.operator_id,payload:{...payload,orderId:id}}})
      await tx.platformRecoveryEvidence.upsert({where:key,create:{batchId:batch.id,category:'checkout-order-auto',reference:id,
        sourceHash:facts.hash,evidenceHash:recoveryHash(payload),observedAt:new Date(),actorId:batch.operator_id,payload},
        update:{sourceHash:facts.hash,evidenceHash:recoveryHash(payload),observedAt:new Date(),createdAt:new Date(),payload}})
    })
  }
}
