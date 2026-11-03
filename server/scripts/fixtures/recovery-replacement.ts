import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { prisma } from '../../src/db/prisma.js'
import { activeRecoveryBatch, recoveryHostSourceHash } from '../../src/services/platform-recovery-state.js'
import { recoveryOrder, reconcileIntactCheckoutOrders, resolveRecoveryOrder } from '../../src/services/platform-recovery-orders.js'
import { reconcileIntactLegacyOrders } from '../../src/services/platform-recovery-legacy-order.js'

// Database lifecycle records only. No customer replacement or network write.
export async function checkRecoveryReplacement(batchId:string,actorId:number,password:string){
  const payer=await prisma.user.create({data:{username:'replacement-original-payer',passwordHash:'unusable',balance:17}})
  const middle=await prisma.user.create({data:{username:'replacement-middle-owner',passwordHash:'unusable',balance:9}})
  const recipient=await prisma.user.create({data:{username:'replacement-final-owner',passwordHash:'unusable',balance:11}})
  const source=await prisma.host.create({data:{userId:actorId,name:'replacement-original-host',url:'https://192.0.2.91:8443'}})
  const target=await prisma.host.create({data:{userId:actorId,name:'replacement-current-host',url:'https://192.0.2.92:8443'}})
  for(const legacy of [false,true]){
    const id=legacy?'000-replacement-legacy':'000-replacement-checkout',paidAt=new Date(Date.now()-60000)
    const at=(ms:number)=>new Date(paidAt.getTime()+ms),oldUuid=randomUUID(),targetUuid=randomUUID()
    if(legacy)await prisma.poolOrder.create({data:{id,userId:payer.id,requestHash:id,totalCents:300}})
    else await prisma.checkoutOrder.create({data:{id,userId:payer.id,requestHash:id,source:'direct',status:'recovery_review',totalCents:300,
      snapshot:'isolated',display:[{quantity:1}],paidAt,paymentId:'balance',expiresAt:at(100000)}})
    const guest=await prisma.instance.create({data:{userId:recipient.id,hostId:target.id,name:id,incusId:id+'-final',status:'running',
      image:'fixture',cpu:100,memory:512,disk:1024,purchaseBatchId:id,snapshottedSpecs:{recoveryIdentity:{uuid:oldUuid,createdAt:paidAt.toISOString()}}}})
    const debit=await prisma.balanceLog.create({data:{userId:payer.id,instanceId:guest.id,orderId:legacy?null:id,type:'consume',amount:-3,
      balanceBefore:20,balanceAfter:17,createdAt:paidAt}})
    await prisma.instanceBillingRecord.create({data:{userId:payer.id,instanceId:guest.id,type:'newPurchase',amount:3,months:1,
      balanceLogId:debit.id,purchaseBatchId:id,createdAt:paidAt,periodStart:paidAt,periodEnd:at(86400000)}})
    for(const [from,to,hostId,remoteUuid,oldIncusId,newIncusId,time] of [
      [payer.id,middle.id,source.id,oldUuid,id+'-old',id+'-middle',10000],
      [middle.id,recipient.id,target.id,targetUuid,id+'-target',id+'-final',40000]
    ] as const)await prisma.instanceTransfer.create({data:{instanceId:guest.id,fromUserId:from,toUserId:to,status:'accepted',
      acceptedAt:at(time),snapshot:{fixture:true},cleanupState:{stage:'finalize',sourceOwnerId:from,targetOwnerId:to,hostId,
        remoteUuid,oldIncusId,newIncusId}}})
    const state={stage:'delivered',sourceHostId:source.id,sourceIncusId:id+'-middle',targetIncusId:id+'-target',targetUuid,
      targetCreatedAt:at(25000).toISOString(),sourceHostIdentity:'a'.repeat(64),targetHostIdentity:'b'.repeat(64)}
    const task=await prisma.instanceTask.create({data:{instanceId:guest.id,userId:actorId,hostId:target.id,targetHostId:target.id,
      taskType:'replace_host',status:'COMPLETED',createdAt:at(20000),finishedAt:at(30000),replacementState:state}})
    const checkHost=async()=>prisma.platformRecoveryHost.upsert({where:{batchId_hostId:{batchId,hostId:target.id}},
      create:{batchId,hostId:target.id,status:'success',sourceHash:await recoveryHostSourceHash(target.id),checkedAt:new Date()},
      update:{status:'success',sourceHash:await recoveryHostSourceHash(target.id),checkedAt:new Date()}})
    await checkHost()
    const proof=async()=>({id:randomUUID(),orderId:id,sourceHash:(await recoveryOrder(id)).sourceHash,reference:'original-replacement-records',
      evidenceHash:'b'.repeat(64),observedAt:new Date().toISOString(),conclusion:'delivered' as const,refunds:[]})
    const stale=await proof()
    await prisma.instanceTask.update({where:{id:task.id},data:{replacementState:{...state,sourceIncusId:'different-source'}}})
    await assert.rejects(resolveRecoveryOrder(stale,actorId,{password}),/EVIDENCE_STALE/)
    await assert.rejects(resolveRecoveryOrder(await proof(),actorId,{password}),/REPLACEMENT_UNPROVEN/)
    const reconcile=legacy?reconcileIntactLegacyOrders:reconcileIntactCheckoutOrders
    for(let i=0;i<6;i++)await reconcile(await activeRecoveryBatch())
    const key={batchId_category_reference:{batchId,category:legacy?'legacy-order-auto':'checkout-order-auto',reference:id}}
    const blocked=await prisma.platformRecoveryEvidence.findUniqueOrThrow({where:key})
    assert.equal((blocked.payload as any).code,'OSS_RECOVERY_REPLACEMENT_UNPROVEN')
    assert.equal((blocked.payload as any).status,'blocked')
    await prisma.platformRecoveryEvidence.update({where:key,data:{payload:{...(blocked.payload as object),nextAt:new Date(0).toISOString()}}})
    for(let i=0;i<6;i++)await reconcile(await activeRecoveryBatch())
    assert.equal((await prisma.platformRecoveryEvidence.findUniqueOrThrow({where:key})).observedAt.getTime(),blocked.observedAt.getTime())
    const before=await prisma.user.findMany({where:{id:{in:[payer.id,middle.id,recipient.id]}},select:{id:true,balance:true},orderBy:{id:'asc'}})
    const moneyCount=await prisma.balanceLog.count(),billCount=await prisma.instanceBillingRecord.count()
    await prisma.instanceTask.update({where:{id:task.id},data:{replacementState:state}})
    await checkHost()
    for(let i=0;i<6;i++)await reconcile(await activeRecoveryBatch())
    assert.equal((await recoveryOrder(id)).status,'completed')
    assert.equal((await prisma.instance.findUniqueOrThrow({where:{id:guest.id}})).userId,recipient.id)
    assert.equal(await prisma.balanceLog.count(),moneyCount);assert.equal(await prisma.instanceBillingRecord.count(),billCount)
    assert.deepEqual(await prisma.user.findMany({where:{id:{in:[payer.id,middle.id,recipient.id]}},select:{id:true,balance:true},orderBy:{id:'asc'}}),before)
    if(legacy){
      await prisma.instanceTask.update({where:{id:task.id},data:{replacementState:{...state,targetUuid:randomUUID()}}})
      assert.notEqual((await recoveryOrder(id)).status,'completed','changed replacement invalidates the completed legacy fact hash')
    }
    console.log(`PASS ${legacy?'legacy':'checkout'} replacement lineage: stale task proof, exact source conflict, no retry of unchanged conflict, changed record automatic completion, retained recipient and zero money writes`)
  }
}
