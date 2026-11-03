import { randomUUID } from 'node:crypto'
// @ts-ignore -- same bcryptjs runtime as authentication.
import bcrypt from 'bcryptjs'
import { Prisma } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { ensure, validateId } from './platform-backup-core.js'
import { activeRecoveryBatch, validateRecoveryEvidence } from './platform-recovery-state.js'
import { readRecoveryHold } from './platform-recovery-review.js'
import { reauthenticateRecoveryOperator } from './platform-recovery-operator.js'
import { recoveryHash } from './platform-recovery-evidence.js'
import { changeBalanceInTransaction } from '../db/balance.js'
import { tryAdvisoryTransactionLock, USER_BALANCE_LOCK_NAMESPACE } from '../db/advisory-locks.js'
import { buildRechargeProviderConfigSnapshot } from '../lib/recharge-provider-snapshot.js'

interface Evidence { id: string; reference: string; evidenceHash: string; observedAt: string }
export interface RecoveryAccountRegistration extends Evidence {
  originalId: number; username: string; email?: string; createdAt: string
}
export interface RecoveryRechargeRegistration extends Evidence {
  userId: number; orderNo: string; providerId: number; method: string; tradeNo: string
  amount: string; creditedAmount: string; fee: string; paidAt: string
  expectedBalance: string; targetBalance: string; expectedLatestLogId: number | null
  currency: string; receivedAmount: string
}
function fields(value: object, allowed: string[]) {
  ensure(value && !Array.isArray(value) && Object.keys(value).every(key => allowed.includes(key)), 'OSS_RECOVERY_EVIDENCE_INVALID')
}
function money(value: string) {
  ensure(typeof value === 'string' && /^(0|[1-9][0-9]{0,7})\.[0-9]{2}$/.test(value), 'OSS_RECOVERY_MONEY_INVALID')
  return new Prisma.Decimal(value)
}
async function context(input: Evidence, actorId: number, credentials: {password: string; totpCode?: string}) {
  validateId(input.id); validateRecoveryEvidence({...input,sourceHash:'0'.repeat(64)})
  const batch = await activeRecoveryBatch(), hold = await readRecoveryHold()
  ensure(batch.mode === 'restore' && hold.snapshot && Date.parse(input.observedAt) >= Date.parse(hold.createdAt), 'OSS_RECOVERY_EVIDENCE_TIME')
  await reauthenticateRecoveryOperator(actorId, credentials)
  return {batch, snapshotAt: Date.parse(hold.snapshot.createdAt), hash: recoveryHash(input)}
}

// IDs from A are retained as evidence, not inserted over B's recovery operator.
// Remote owner markers use this explicit mapping during guest verification.
export async function registerRecoveryAccount(input: RecoveryAccountRegistration, actorId: number, credentials: {password: string; totpCode?: string}) {
  fields(input, ['id','reference','evidenceHash','observedAt','originalId','username','email','createdAt'])
  const {batch,snapshotAt,hash} = await context(input,actorId,credentials)
  ensure(Number.isSafeInteger(input.originalId) && input.originalId > 0 && input.originalId <= 2147483647 &&
    /^[A-Za-z0-9_-]{3,64}$/.test(input.username) && (!input.email || input.email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) &&
    Date.parse(input.createdAt) > snapshotAt && Date.parse(input.createdAt) <= Date.parse(input.observedAt), 'OSS_RECOVERY_USER_INVALID')
  return prisma.$transaction(async tx => {
    const prior = await tx.platformRecoveryEvidence.findUnique({where:{id:input.id}})
    if (prior) { ensure(prior.batchId===batch.id && prior.sourceHash===hash,'OSS_RECOVERY_EVIDENCE_CONFLICT',409); return {id:prior.id,...prior.payload as {userId:number},replayed:true} }
    ensure(!await tx.user.count({where:{username:input.username}}), 'OSS_RECOVERY_USER_EXISTS',409)
    const collision=await tx.user.findUnique({where:{id:input.originalId},select:{id:true}})
    if(collision && collision.id!==batch.operator_id) {
      const createdHere=await tx.$queryRaw<Array<{id:string}>>`SELECT id FROM platform_recovery_evidence WHERE batch_id=${batch.id}::uuid
        AND category='user-registration' AND payload->>'userId'=${String(collision.id)} LIMIT 1`
      ensure(createdHere.length===1,'OSS_RECOVERY_USER_EXISTS',409)
    }
    const mappings = await tx.$queryRaw<Array<{id:string}>>`SELECT id FROM platform_recovery_evidence WHERE batch_id=${batch.id}::uuid
      AND category='user-registration' AND payload->>'originalUserId'=${String(input.originalId)} LIMIT 1`
    ensure(!mappings.length,'OSS_RECOVERY_USER_EXISTS',409)
    const user = await tx.user.create({data:{username:input.username,email:input.email,status:'banned',role:'user',
      passwordHash:await bcrypt.hash(randomUUID()+randomUUID(),12),createdAt:new Date(input.createdAt)}})
    const payload={userId:user.id,originalUserId:input.originalId,username:input.username,createdAt:input.createdAt}
    await tx.platformRecoveryEvidence.create({data:{id:input.id,batchId:batch.id,category:'user-registration',reference:input.reference,
      sourceHash:hash,evidenceHash:input.evidenceHash,observedAt:new Date(input.observedAt),actorId,payload}})
    return {id:input.id,...payload,replayed:false}
  })
}

export async function recoveryOriginalUserId(userId: number, db: Prisma.TransactionClient | typeof prisma = prisma) {
  const [mapping] = await db.$queryRaw<Array<{original_id:string}>>`SELECT payload->>'originalUserId' original_id FROM platform_recovery_evidence
    WHERE category='user-registration' AND payload->>'userId'=${String(userId)} ORDER BY created_at DESC LIMIT 1`
  return mapping ? Number(mapping.original_id) : userId
}

// Reconstruct a proven historical credit plus its confirmed final balance.
// This never contacts a payment provider or invokes a live payment callback.
export async function registerRecoveryRecharge(input: RecoveryRechargeRegistration, actorId: number, credentials: {password: string; totpCode?: string}) {
  fields(input,['id','reference','evidenceHash','observedAt','userId','orderNo','providerId','method','tradeNo','amount','creditedAmount','fee','paidAt',
    'expectedBalance','targetBalance','expectedLatestLogId','currency','receivedAmount'])
  const {batch,snapshotAt,hash}=await context(input,actorId,credentials)
  const amount=money(input.amount),credit=money(input.creditedAmount),fee=money(input.fee),expected=money(input.expectedBalance),target=money(input.targetBalance)
  ensure([input.userId,input.providerId].every(n=>Number.isSafeInteger(n)&&n>0) &&
    (input.expectedLatestLogId===null || Number.isSafeInteger(input.expectedLatestLogId)&&input.expectedLatestLogId>0) &&
    /^[A-Za-z0-9_-]{1,100}$/.test(input.orderNo) && /^[A-Za-z0-9_-]{1,100}$/.test(input.tradeNo) && /^[A-Za-z0-9_-]{0,64}$/.test(input.method) &&
    /^[A-Z0-9]{3,12}$/.test(input.currency) && /^(0|[1-9][0-9]{0,15})(\.[0-9]{1,18})?$/.test(input.receivedAmount) && new Prisma.Decimal(input.receivedAmount).greaterThan(0) &&
    amount.greaterThan(0) && credit.greaterThan(0) && Date.parse(input.paidAt)>snapshotAt && Date.parse(input.paidAt)<=Date.parse(input.observedAt),'OSS_RECOVERY_EVIDENCE_INVALID')
  return prisma.$transaction(async tx=>{
    const prior=await tx.platformRecoveryEvidence.findUnique({where:{id:input.id}})
    if(prior){ensure(prior.batchId===batch.id&&prior.sourceHash===hash,'OSS_RECOVERY_EVIDENCE_CONFLICT',409);return {id:prior.id,...prior.payload as {userId:number;rechargeId:number},replayed:true}}
    ensure(await tryAdvisoryTransactionLock(tx,USER_BALANCE_LOCK_NAMESPACE,input.userId),'OSS_RECONCILIATION_BUSY',409)
    const user=await tx.user.findUnique({where:{id:input.userId},select:{balance:true}})
    const latest=await tx.balanceLog.findFirst({where:{userId:input.userId},orderBy:{id:'desc'},select:{id:true}})
    ensure(user&&user.balance.equals(expected)&&(latest?.id??null)===input.expectedLatestLogId,'OSS_RECOVERY_EVIDENCE_STALE',409)
    const provider=await tx.paymentProvider.findUnique({where:{id:input.providerId}})
    ensure(provider&&['yipay','upaypro','heleket','antom'].includes(provider.type),'OSS_RECOVERY_PROVIDER_UNSUPPORTED')
    ensure(!await tx.rechargeRecord.count({where:{OR:[{orderNo:input.orderNo},{providerId:input.providerId,tradeNo:input.tradeNo}]}}) &&
      !await tx.checkoutReceipt.count({where:{providerId:input.providerId,tradeNo:input.tradeNo}}) &&
      !await tx.rechargeLatePayment.count({where:{providerId:input.providerId,tradeNo:input.tradeNo}}) &&
      !await tx.checkoutOrder.count({where:{id:input.orderNo}}) && !await tx.poolOrder.count({where:{id:input.orderNo}}) &&
      !await tx.balanceLog.count({where:{orderId:input.orderNo}}),'OSS_RECOVERY_RECEIPT_EXISTS',409)
    const row=await tx.rechargeRecord.create({data:{userId:input.userId,providerId:input.providerId,orderNo:input.orderNo,tradeNo:input.tradeNo,
      amount,actualAmount:credit,fee,paymentMethod:input.method,status:'completed',createdAt:new Date(input.paidAt),completedAt:new Date(input.paidAt),
      providerConfigSnapshot:buildRechargeProviderConfigSnapshot(provider.type,{recoveryEvidenceOnly:true}),
      paymentDetails:{recovery:true,currency:input.currency,receivedAmount:input.receivedAmount,evidenceId:input.id}}})
    const adjustment=target.minus(expected).minus(credit)
    // A spent recharge may have a final balance smaller than the credit. Record
    // credits first, so reconstructing later spending never crosses below zero.
    const adjustmentFirst=!adjustment.isZero() && expected.plus(adjustment).greaterThanOrEqualTo(0)
    if(adjustmentFirst) await changeBalanceInTransaction(tx,{userId:input.userId,type:'admin_adjust',amount:adjustment.toNumber(),remark:`Recovery balance; evidence ${input.reference}`})
    const log=await changeBalanceInTransaction(tx,{userId:input.userId,type:'recharge',amount:credit.toNumber(),orderId:input.orderNo,remark:`Recovered recharge; evidence ${input.reference}`})
    if(!adjustmentFirst && !adjustment.isZero()) await changeBalanceInTransaction(tx,{userId:input.userId,type:'admin_adjust',amount:adjustment.toNumber(),remark:`Recovery balance; evidence ${input.reference}`})
    const payload={userId:input.userId,rechargeId:row.id,balanceLogId:log.balanceLog.id,orderNo:input.orderNo,targetBalance:input.targetBalance,
      currency:input.currency,receivedAmount:input.receivedAmount}
    await tx.platformRecoveryEvidence.create({data:{id:input.id,batchId:batch.id,category:'recharge-registration',reference:input.reference,
      sourceHash:hash,evidenceHash:input.evidenceHash,observedAt:new Date(input.observedAt),actorId,payload}})
    return {id:input.id,...payload,replayed:false}
  })
}
