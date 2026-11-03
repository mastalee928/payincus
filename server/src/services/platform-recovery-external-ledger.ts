import { Prisma } from '@prisma/client'
import { ensure } from './platform-backup-core.js'
import { recoveryMoneyCents } from './platform-recovery-accounting.js'
import { assertRecoveryOrderOwnership } from './platform-recovery-ownership.js'
import { recoverySettledDeletion } from './platform-recovery-lifecycle.js'

type Guest=Parameters<typeof assertRecoveryOrderOwnership>[2] & Parameters<typeof recoverySettledDeletion>[0]
type Bill={id:number;instanceId:number;userId:number;type:string;amount:Prisma.Decimal;balanceLogId:number|null;purchaseBatchId:string|null;createdAt:Date}
// External purchase receipts and subsequent wallet payments are separate money
// sources. Validate each original debit and refund; a matching grand total is
// insufficient to release a restored order.
export async function assertRecoveryExternalLedger(tx:Prisma.TransactionClient,snapshot:{
  order:{id:string;userId:number;paidAt:Date|null;paymentId:string|null;totalCents:number}
  instances:Guest[];transfers:Parameters<typeof assertRecoveryOrderOwnership>[3]
},observedAt:Date) {
  const {order,instances,transfers}=snapshot
  ensure(order.paidAt && observedAt<=new Date(),'OSS_RECOVERY_EVIDENCE_TIME',409)
  for(const instance of instances)assertRecoveryOrderOwnership(order.userId,order.paidAt!,instance,transfers)
  const bills:Bill[]=await tx.instanceBillingRecord.findMany({where:{OR:[{purchaseBatchId:order.id},{instanceId:{in:instances.map(row=>row.id)}}]}})
  const logs=await tx.balanceLog.findMany({where:{id:{in:bills.flatMap(row=>row.balanceLogId?[row.balanceLogId]:[])}}})
  const refunds=await tx.checkoutRefund.findMany({where:{orderId:order.id},include:{receipt:true,payment:true}})
  const ownerAt=(id:number,at:Date)=>{
    let owner=order.userId
    for(const transfer of transfers.filter(row=>row.instanceId===id && row.status==='accepted').sort((a,b)=>a.acceptedAt!.getTime()-b.acceptedAt!.getTime())){
      ensure(transfer.acceptedAt!.getTime()!==at.getTime(),'OSS_RECOVERY_OWNERSHIP_UNPROVEN',409)
      if(transfer.acceptedAt!<at)owner=transfer.toUserId
    }
    return owner
  }
  const purchases=bills.filter(row=>row.type==='newPurchase')
  for(const bill of bills){
    const guest=instances.find(row=>row.id===bill.instanceId)
    ensure(guest && ['newPurchase','renew','upgrade','downgrade','refund'].includes(bill.type) &&
      bill.createdAt>=order.paidAt! && bill.createdAt<=observedAt,'OSS_RECOVERY_WALLET_LINEAGE_REQUIRED',409)
    if(bill.type==='newPurchase'){
      ensure(bill.userId===order.userId && bill.purchaseBatchId===order.id && !bill.balanceLogId && bill.amount.greaterThan(0),
        'OSS_RECOVERY_ORDER_PRINCIPAL_MISMATCH',409)
      continue
    }
    ensure(bill.purchaseBatchId===null || bill.purchaseBatchId===order.id,'OSS_RECOVERY_WALLET_LINEAGE_REQUIRED',409)
    const log=logs.find(row=>row.id===bill.balanceLogId)
    if(log)ensure(log.instanceId===bill.instanceId && log.userId===bill.userId && log.createdAt<=bill.createdAt &&
      log.createdAt>=order.paidAt! && log.balanceAfter.minus(log.balanceBefore).equals(log.amount) &&
      await tx.instanceBillingRecord.count({where:{balanceLogId:log.id}})===1,'OSS_RECOVERY_WALLET_LINEAGE_REQUIRED',409)
    if(['renew','upgrade','downgrade'].includes(bill.type)){
      ensure(bill.userId===ownerAt(bill.instanceId,bill.createdAt) && bill.amount.greaterThanOrEqualTo(0) &&
        (bill.type!=='downgrade'||bill.amount.isZero()),'OSS_RECOVERY_WALLET_LINEAGE_REQUIRED',409)
      ensure(bill.amount.isZero() && !bill.balanceLogId || log && !log.orderId && log.type==='consume' &&
        log.amount.equals(bill.amount.negated()),'OSS_RECOVERY_WALLET_LINEAGE_REQUIRED',409)
      continue
    }
    const linked=refunds.filter(row=>row.billingRecordId===bill.id)
    const external=linked.reduce((sum,row)=>sum+row.principalCents,0)
    const wallet=log?recoveryMoneyCents(log.amount):0
    ensure((bill.amount.lessThan(0)||recoverySettledDeletion(guest!) && bill.amount.greaterThan(0)) &&
      (bill.userId===ownerAt(bill.instanceId,bill.createdAt) || wallet===0 && bill.purchaseBatchId===order.id && bill.userId===order.userId) &&
      (!bill.balanceLogId || log && log.type==='refund' && wallet>0 && bill.userId===ownerAt(bill.instanceId,bill.createdAt)) &&
      wallet+external===Math.abs(recoveryMoneyCents(bill.amount)) && linked.every(row=>row.instanceId===bill.instanceId),
      'OSS_RECOVERY_WALLET_REFUND_LINK_REQUIRED',409)
  }
  for(const refund of refunds){
    ensure(refund.status==='refunded' && refund.resolution && refund.handledAt && refund.handledAt>=refund.createdAt && refund.handledAt<=observedAt &&
      refund.payment.orderId===order.id && refund.receipt.paymentId===refund.paymentId && refund.receipt.providerId===refund.payment.providerId &&
      refund.amountCents>0 && refund.principalCents>=0 && refund.amountCents>=refund.principalCents &&
      refund.receipt.amountCents===refund.payment.payableCents,'OSS_RECOVERY_REFUND_MISMATCH',409)
    ensure(refund.paymentId===order.paymentId || refund.principalCents===0,'OSS_RECOVERY_REFUND_MISMATCH',409)
    if(refund.instanceId && refund.principalCents>0)ensure(refund.billingRecordId && bills.some(bill=>bill.id===refund.billingRecordId && bill.instanceId===refund.instanceId),
      'OSS_RECOVERY_WALLET_REFUND_LINK_REQUIRED',409)
  }
  for(const guest of instances){
    const purchase=purchases.filter(row=>row.instanceId===guest.id)
    ensure(purchase.length===1,'OSS_RECOVERY_ORDER_PRINCIPAL_MISMATCH',409)
    const external=refunds.filter(row=>row.instanceId===guest.id).reduce((sum,row)=>sum+row.principalCents,0)
    ensure(external<=recoveryMoneyCents(purchase[0].amount),'OSS_RECOVERY_REFUND_MISMATCH',409)
    const laterPaid=bills.filter(row=>row.instanceId===guest.id && ['renew','upgrade'].includes(row.type)).reduce((sum,row)=>sum+recoveryMoneyCents(row.amount),0)
    const walletReturned=bills.filter(row=>row.instanceId===guest.id && row.type==='refund').reduce((sum,row)=>{
      const log=logs.find(value=>value.id===row.balanceLogId);return sum+(log?recoveryMoneyCents(log.amount):0)
    },0)
    ensure(walletReturned<=laterPaid,'OSS_RECOVERY_REFUND_MISMATCH',409)
  }
}
