import { Prisma } from '@prisma/client'
import { ensure } from './platform-backup-core.js'
import { changeBalanceInTransaction } from '../db/balance.js'
import { recoveryMoneyCents } from './platform-recovery-accounting.js'
import { assertRecoveryOrderOwnership } from './platform-recovery-ownership.js'
import { recoverySettledDeletion, recoveryFailedProvision } from './platform-recovery-lifecycle.js'

export type RecoveryWalletTarget = {userId:number;balance:string}
interface WalletSnapshot {
  order:{id:string;userId:number;totalCents:number;paidAt:Date|null}
  instances:Array<Parameters<typeof recoverySettledDeletion>[0] & {snapshottedSpecs:unknown}>
  bills:Array<{id:number;instanceId:number;userId:number;type:string;amount:Prisma.Decimal;balanceLogId:number|null;
    purchaseBatchId:string|null;createdAt:Date;periodStart:Date;periodEnd:Date}>
  transfers:Parameters<typeof assertRecoveryOrderOwnership>[3]
  tasks?:Parameters<typeof assertRecoveryOrderOwnership>[4]
  wallet:{accounts:Array<{id:number;balance:Prisma.Decimal}>;logs:Array<{id:number;userId:number;instanceId:number|null;orderId:string|null;type:string;amount:Prisma.Decimal;balanceBefore:Prisma.Decimal;balanceAfter:Prisma.Decimal}>}|null
}

// A transferred guest belongs to its recipient, while never-delivered lines
// still belong to the original payer. Each account has its own evidenced final
// balance; no refund is routed by a free-text remark or a customer's name.
export async function reconcileTransferredWallet(tx:Prisma.TransactionClient,snapshot:WalletSnapshot,
  input:{walletTargets?:RecoveryWalletTarget[];walletBalance?:string;reference:string;observedAt:string},
  partial:{allocation:Array<{id:number;status:string;principalCents:number;refundedCents:number}>;missingCents:number}|null,readOnly=false) {
  const {order,instances,bills,transfers,wallet}=snapshot
  ensure(wallet && order.paidAt,'OSS_RECOVERY_BALANCE_REQUIRED',409)
  for(const instance of instances)assertRecoveryOrderOwnership(order.userId,order.paidAt!,instance,transfers,snapshot.tasks)
  const accounts=wallet!.accounts
  ensure(input.walletBalance===undefined && input.walletTargets && input.walletTargets.length===accounts.length &&
    new Set(input.walletTargets.map(row=>row.userId)).size===accounts.length &&
    accounts.every(account=>input.walletTargets!.some(row=>row.userId===account.id)),'OSS_RECOVERY_TRANSFER_BALANCE_REQUIRED',409)
  ensure(bills.every(b=>['newPurchase','renew','upgrade','downgrade','refund'].includes(b.type) &&
    (b.purchaseBatchId===order.id || b.type!=='newPurchase' && b.purchaseBatchId===null)),
    'OSS_RECOVERY_WALLET_LINEAGE_REQUIRED',409)
  const consume=wallet!.logs.filter(row=>row.type==='consume' && row.orderId===order.id)
  ensure(consume.length===1 && consume[0].userId===order.userId && consume[0].orderId===order.id &&
    recoveryMoneyCents(consume[0].amount)===-order.totalCents,'OSS_RECOVERY_ORDER_PRINCIPAL_MISMATCH',409)
  const purchases=bills.filter(row=>row.type==='newPurchase')
  ensure(purchases.length===instances.length && purchases.every(row=>row.userId===order.userId) &&
    instances.every(instance=>purchases.filter(b=>b.instanceId===instance.id).length===1),
    'OSS_RECOVERY_ORDER_PRINCIPAL_MISMATCH',409)
  const ownerAt=(instanceId:number,when:Date)=>{
    let owner=order.userId
    for(const transfer of transfers.filter(t=>t.instanceId===instanceId&&t.status==='accepted').sort((a,b)=>a.acceptedAt!.getTime()-b.acceptedAt!.getTime())){
      ensure(transfer.acceptedAt!.getTime()!==when.getTime(),'OSS_RECOVERY_OWNERSHIP_UNPROVEN',409)
      if(transfer.acceptedAt!<when)owner=transfer.toUserId
    }
    return owner
  }
  for(const bill of bills.filter(row=>['renew','upgrade','downgrade'].includes(row.type))){
    ensure(bill.createdAt>=order.paidAt! && bill.userId===ownerAt(bill.instanceId,bill.createdAt),'OSS_RECOVERY_OWNERSHIP_UNPROVEN',409)
    if(bill.type==='downgrade'){ensure(bill.amount.isZero(),'OSS_RECOVERY_WALLET_LINEAGE_REQUIRED',409);continue}
    const log=wallet!.logs.find(row=>row.id===bill.balanceLogId)
    ensure(log && log.type==='consume' && log.userId===bill.userId && log.instanceId===bill.instanceId &&
      bill.amount.greaterThanOrEqualTo(0) && log.amount.equals(bill.amount.negated()) && log.balanceAfter.minus(log.balanceBefore).equals(log.amount),
      'OSS_RECOVERY_WALLET_LINEAGE_REQUIRED',409)
    ensure(await tx.instanceBillingRecord.count({where:{balanceLogId:log!.id}})===1,'OSS_RECOVERY_WALLET_LINEAGE_REQUIRED',409)
  }
  const linked=new Map<number,number>()
  for(const bill of bills.filter(b=>b.type==='refund')){
    const log=wallet!.logs.find(row=>row.id===bill.balanceLogId),instance=instances.find(row=>row.id===bill.instanceId)
    ensure(instance && log && log.type==='refund' && log.userId===bill.userId &&
      (log.orderId===order.id || log.instanceId===instance.id) && (recoveryMoneyCents(bill.amount)<0 || recoverySettledDeletion(instance) && recoveryMoneyCents(bill.amount)>0) &&
      bill.createdAt.getTime()>=order.paidAt!.getTime(),
      'OSS_RECOVERY_WALLET_REFUND_LINK_REQUIRED',409)
    ensure(log!.balanceAfter.minus(log!.balanceBefore).equals(log!.amount),'OSS_RECOVERY_WALLET_REFUND_LINK_REQUIRED',409)
    ensure(ownerAt(instance!.id,bill.createdAt)===bill.userId,'OSS_RECOVERY_OWNERSHIP_UNPROVEN',409)
    linked.set(log!.id,(linked.get(log!.id)||0)+Math.abs(recoveryMoneyCents(bill.amount)))
  }
  const purchaseTotal=purchases.reduce((n,b)=>n+recoveryMoneyCents(b.amount),0)
  const missing=partial?.missingCents ?? order.totalCents-purchaseTotal
  ensure(missing>=0 && (partial || instances.every(row=>row.status==='deleted')),'OSS_RECOVERY_ORDER_PRINCIPAL_MISMATCH',409)
  let unallocatedReturned=0
  for(const log of wallet!.logs.filter(row=>row.type==='refund')){
    const cents=recoveryMoneyCents(log.amount),allocated=linked.get(log.id)||0
    ensure(cents>0 && allocated<=cents && (allocated===cents || log.userId===order.userId && log.orderId===order.id && log.instanceId===null),
      'OSS_RECOVERY_WALLET_REFUND_LINK_REQUIRED',409)
    unallocatedReturned+=cents-allocated
  }
  ensure(unallocatedReturned<=missing,'OSS_RECOVERY_REFUND_MISMATCH',409)
  const obligations:Array<{userId:number;instanceId:number|null;cents:number;purchase?:typeof purchases[number]}>=[]
  if(missing>unallocatedReturned)obligations.push({userId:order.userId,instanceId:null,cents:missing-unallocatedReturned})
  for(const instance of instances){
    const purchase=purchases.find(b=>b.instanceId===instance.id)!,principal=recoveryMoneyCents(purchase.amount)
    const returned=bills.filter(b=>b.instanceId===instance.id&&b.type==='refund').reduce((n,b)=>n+Math.abs(recoveryMoneyCents(b.amount)),0)
    const paid=bills.filter(b=>b.instanceId===instance.id&&['newPurchase','renew','upgrade'].includes(b.type)).reduce((sum,b)=>sum+recoveryMoneyCents(b.amount),0)
    ensure(principal>=0 && returned<=paid,'OSS_RECOVERY_REFUND_MISMATCH',409)
    // A saved failure marker is only written after wallet settlement. If that
    // ledger is missing, recreating money from the marker would pay it twice.
    if(recoveryFailedProvision(instance))ensure(instance.userId===order.userId &&
      !transfers.some(row=>row.instanceId===instance.id&&row.status==='accepted') && paid===principal && returned===principal,
      'OSS_RECOVERY_WALLET_REFUND_LINK_REQUIRED',409)
    if(instance.status==='deleted' && !recoverySettledDeletion(instance) && !recoveryFailedProvision(instance) && principal>returned)
      obligations.push({userId:instance.userId,instanceId:instance.id,cents:principal-returned,purchase})
  }
  if(readOnly){ensure(!obligations.length,'OSS_RECOVERY_REFUND_INCOMPLETE',409);return}
  for(const account of accounts){
    const target=new Prisma.Decimal(input.walletTargets!.find(row=>row.userId===account.id)!.balance)
    const owed=obligations.filter(row=>row.userId===account.id),refund=new Prisma.Decimal(owed.reduce((n,row)=>n+row.cents,0)).div(100)
    const adjustment=target.minus(account.balance).minus(refund)
    const first=!adjustment.isZero() && account.balance.plus(adjustment).greaterThanOrEqualTo(0)
    const adjust=()=>changeBalanceInTransaction(tx,{userId:account.id,type:'admin_adjust',amount:adjustment.toNumber(),remark:`Recovery final balance; evidence ${input.reference}`})
    if(first)await adjust()
    for(const row of owed){
      const log=await changeBalanceInTransaction(tx,{userId:account.id,type:'refund',amount:row.cents/100,orderId:order.id,
        ...(row.instanceId?{instanceId:row.instanceId}:{}),remark:`Recovered original wallet refund; evidence ${input.reference}`})
      if(row.purchase)await tx.instanceBillingRecord.create({data:{userId:account.id,instanceId:row.instanceId!,type:'refund',amount:new Prisma.Decimal(row.cents).div(-100),
        months:0,periodStart:row.purchase.periodStart,periodEnd:row.purchase.periodEnd,purchaseBatchId:order.id,balanceLogId:log.balanceLog.id,
        createdAt:new Date(input.observedAt),remark:`Recovered wallet refund; evidence ${input.reference}`}})
    }
    if(!first && !adjustment.isZero())await adjust()
  }
}
