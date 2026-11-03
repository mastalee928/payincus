import { Prisma } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { recoveryCompletedDeletion } from './platform-recovery-lifecycle.js'
import { recoveryMoneyCents } from './platform-recovery-accounting.js'

type Guest=Parameters<typeof recoveryCompletedDeletion>[0] & {name?:string}
type Bill={id:number;instanceId:number;userId:number;type:string;amount:Prisma.Decimal;balanceLogId:number|null;createdAt:Date;purchaseBatchId:string|null}
// This annotation is derived on every read, never accepted from an HTTP body or
// persisted in customer specs. A done intent alone does not prove money returned.
export async function recoveredLifecycleLedger<T extends Guest>(db:Prisma.TransactionClient|typeof prisma,instances:T[],bills:Bill[]) {
  const result:Array<T & {recoverySettlementCents?:number}>=[]
  for(const instance of instances){
    let settled:number|undefined
    if(recoveryCompletedDeletion(instance)){
      const intent=instance.deletionIntent as {refund:boolean;refundPending?:boolean;refundAmount:number;refundBillingRecordId?:number;requestedAt:string;revision:string;adminRefundType?:string}
      if(intent.refund && intent.refundAmount===0 && intent.refundPending===false && !intent.refundBillingRecordId)settled=0
      else if(intent.refund){
        // Older administrator deletions wrote the immutable intent UUID in the
        // exact settlement reference. Do not infer linkage by amount/time/name.
        const legacy=!intent.refundBillingRecordId && ['full','remaining'].includes(intent.adminRefundType||'') ?
          await db.instanceBillingRecord.findMany({where:{instanceId:instance.id,type:'refund',remark:`管理员删除并退款：${intent.revision}`}}):[]
        const billId=intent.refundBillingRecordId || (legacy.length===1?legacy[0].id:undefined)
        const bill=bills.find(row=>row.id===billId && row.instanceId===instance.id &&
          row.userId===instance.userId && row.type==='refund' && row.createdAt.getTime()>=Date.parse(intent.requestedAt) && row.createdAt<=new Date())
        if(bill && Math.abs(recoveryMoneyCents(bill.amount))===recoveryMoneyCents(intent.refundAmount)){
          const refunds=await db.checkoutRefund.findMany({where:{billingRecordId:bill.id},include:{receipt:true,payment:true,order:true}})
          const log=bill.balanceLogId?await db.balanceLog.findUnique({where:{id:bill.balanceLogId}}):null
          const wallet=log && log.userId===bill.userId && log.instanceId===instance.id && log.type==='refund' && log.amount.greaterThan(0) &&
            log.balanceAfter.minus(log.balanceBefore).equals(log.amount) ? recoveryMoneyCents(log.amount) : 0
          const validExternal=refunds.every(row=>row.status==='refunded' && row.handledAt && row.handledAt>=row.createdAt &&
            row.handledAt<=new Date() && row.resolution && row.principalCents>0 && row.order.paidAt &&
            row.instanceId===instance.id && row.order.paymentId===row.paymentId && row.payment.orderId===row.orderId &&
            row.receipt.paymentId===row.paymentId && row.receipt.providerId===row.payment.providerId &&
            row.payment.payableCents-row.payment.feeCents===row.order.totalCents && row.receipt.amountCents===row.payment.payableCents &&
            row.amountCents>=row.principalCents && row.amountCents<=row.receipt.amountCents &&
            bills.some(purchase=>purchase.instanceId===instance.id && purchase.type==='newPurchase' && purchase.purchaseBatchId===row.orderId &&
              purchase.userId===row.order.userId && recoveryMoneyCents(purchase.amount)>=row.principalCents))
          const external=refunds.reduce((sum,row)=>sum+row.principalCents,0)
          let validReceipts=true
          for(const row of refunds){
            const totals=await db.checkoutRefund.aggregate({where:{receiptId:row.receiptId},_sum:{amountCents:true,principalCents:true}})
            if((totals._sum.amountCents||0)>row.receipt.amountCents ||
              (totals._sum.principalCents||0)>row.payment.payableCents-row.payment.feeCents)validReceipts=false
          }
          // A shared refund bill/log cannot silently be counted for two guests.
          const shared=log?await db.instanceBillingRecord.count({where:{balanceLogId:log.id,id:{not:bill.id}}}):0
          if(validExternal && validReceipts && !shared && (!bill.balanceLogId||wallet>0) &&
            wallet+external===Math.abs(recoveryMoneyCents(bill.amount)))settled=wallet+external
        }
      }
    }else if(instance.status==='deleted' && instance.deletionIntent==null && !instance.deletionBillingPending && !instance.provisioningCleanupPending){
      const record=await db.userDestroyRecord.findUnique({where:{instanceId:instance.id}})
      if(record && record.userId===instance.userId && record.hostId===instance.hostId && record.instanceName===instance.name &&
        record.refundAmount.isZero() && record.feeAmount.isZero() && record.destroyedAt<=new Date() &&
        bills.some(row=>row.instanceId===instance.id && row.type==='newPurchase' && row.createdAt<=record.destroyedAt))settled=0
    }
    result.push({...instance,...(settled===undefined?{}:{recoverySettlementCents:settled})})
  }
  return result
}
