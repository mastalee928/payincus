import { protectedAgentFixture } from './fixtures/guest-protection.js'
import assert from 'node:assert/strict'
import { randomUUID, createHash, generateKeyPairSync, sign } from 'node:crypto'
import Fastify from 'fastify'
const url = new URL(process.env.DATABASE_URL || '')
assert.ok(url.hostname === '127.0.0.1' && url.pathname.endsWith('_pool_test'), 'Isolated local database required')
process.env.JWT_SECRET ||= 'checkout-test-secret-not-production'
process.env.FRONTEND_URL = 'https://checkout.example.com'
process.env.PUBLIC_API_URL = 'https://checkout.example.com'
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { createCheckout, getCheckout, cancelCheckout, payCheckoutBalance, settleCheckoutPayment, materializeCheckout, processCheckoutQueue, creditFailedCheckoutRefundToBalance } = await import('../src/services/checkout-orders.js')
const { createCheckoutPayment, handleCheckoutCallback } = await import('../src/services/checkout-payments.js')
const { upsertPoolPrice, poolInventory } = await import('../src/services/host-pool-prices.js')
const { selectAndReserveHostWithLock } = await import('../src/db/hosts.js')
const { compensateFailedInstancePurchase } = await import('../src/db/instance-provisioning-compensation.js')
const { refundInstancePayment } = await import('../src/services/checkout-refunds.js')
const { getUserDeletionBlockers } = await import('../src/db/users.js')
const { performPlanChange } = await import('../src/db/billing-operations.js')
const { advisoryTransactionLock, USER_BALANCE_LOCK_NAMESPACE } = await import('../src/db/advisory-locks.js')
const { buildRechargeProviderConfigSnapshot } = await import('../src/lib/recharge-provider-snapshot.js')
const { buildUpayProPaymentDetails } = await import('../src/lib/recharge-payment-details.js')
const { default: checkoutRoutes } = await import('../src/routes/checkout.js')
const { default: orderRoutes } = await import('../src/routes/orders.js')
const { default: adminBillingRoutes } = await import('../src/routes/admin-billing.js')
const { createBalanceAdjustmentRequest, approveBalanceAdjustmentRequest } = await import('../src/db/balance.js')
const prefix = `checkout-${randomUUID().slice(0,8)}`, session = { sid: randomUUID(), iat: Math.floor(Date.now()/1000) }
const owner = await prisma.user.create({ data: { username: `${prefix}-owner`, role:'admin', passwordHash:'unusable-fixture' } })
const buyer = await prisma.user.create({ data: { username: `${prefix}-buyer`, balance:100, passwordHash:'unusable-fixture' } })
const other = await prisma.user.create({ data: { username: `${prefix}-other`, balance:100, passwordHash:'unusable-fixture' } })
const group = await prisma.hostMachineGroup.create({ data: { name: prefix } })
const region = await prisma.hostRegionGroup.create({ data: { name: prefix, machineGroupId:group.id, countryCode:'us' } })
const image = await prisma.systemImage.create({ data: { name:prefix,remoteAlias:`${prefix}/debian`,architecture:'x86_64',instanceType:'container',icon:'debian' } })
const priceInput = { machineGroupId:group.id,regionGroupId:region.id,resourcePreset:'E2' as const,diskGiB:30,monthlyPrice:1000,setupFee:100 }
const price = (await upsertPoolPrice(priceInput,owner.id)).price
let hostCount=0
async function host() { const h=await prisma.host.create({data:{userId:owner.id,name:`${prefix}-${++hostCount}`,url:'https://127.0.0.1:1',singleTenant:true,
  machineGroupId:group.id,regionGroupId:region.id,resourcePreset:'E2',customerDiskGiB:30,status:'online',isInstalled:true,certPath:'fixture.crt',keyPath:'fixture.key',
  architecture:'x86_64',cpuAllowanceMax:200,memoryMax:768,storageSize:38,natPublicIp:`192.0.2.${hostCount}`,natPortStart:20000,natPortEnd:30000,agent:{create:protectedAgentFixture()}}})
  await prisma.storagePool.create({data:{hostId:h.id,name:'test',driver: 'lvm', purpose: 'instance_data', config: { 'volume.block.filesystem': 'btrfs' }}});return h }
const input=(quantity=1)=>({requestId:randomUUID(),source:'direct' as const,items:[{poolPriceId:price.id,quantity,namePrefix:`server-${randomUUID().slice(0,8)}`,image:image.remoteAlias}],expectedTotal:quantity*1100})
// V1 only constructs a signed URL. Use a public literal address so outbound DNS
// validation stays real without depending on a made-up hostname or issuing a payment.
const config={version:'v1',apiurl:'https://1.1.1.1',pid:'fixture-merchant',key:'fixture-sign-key'}
const provider=await prisma.paymentProvider.create({data:{name:'Fixture Epay',type:'yipay',status:'active',methods:['alipay','wxpay'],config,feeRate:0,feeFixed:0,minAmount:1}})
const meta={method:'GET',requestUri:`/api/checkout/callback/${provider.id}`,requestTime:'',clientId:'',signature:'',rawBody:'',ip:'127.0.0.1'}
function callback(id:string,trade:string,method='alipay',money='11.00') {
 const fields:Record<string,string>={pid:config.pid,out_trade_no:id,trade_no:trade,type:method,money,trade_status:'TRADE_SUCCESS'}
 const sign=createHash('md5').update(Object.keys(fields).sort().map(k=>`${k}=${fields[k]}`).join('&')+config.key).digest('hex')
 return {...fields,sign,sign_type:'MD5'}
}
const balance=async()=>Number((await prisma.user.findUniqueOrThrow({where:{id:buyer.id}})).balance)
let expectedWallet=100
const app=Fastify()
app.decorate('authenticate',async(request:any)=>{request.user={id:buyer.id,...session}})
app.decorate('authenticateUser',app.authenticate)
app.decorate('authenticateAdmin',async(request:any)=>{request.user={id:owner.id,...session}})
app.decorate('requireAdmin',async(request:any)=>{request.user={id:owner.id,role:'admin',...session}})
await app.register(checkoutRoutes)
await app.register(orderRoutes)
await app.register(adminBillingRoutes)
try {
 const h=await host(); let intent=input()
 const concurrent=await Promise.allSettled([createCheckout(buyer.id,intent,session),createCheckout(other.id,input(),session)])
 for (const result of concurrent) if (result.status === 'rejected') console.log('reservation rejection:', result.reason?.message)
 assert.equal(concurrent.filter(r=>r.status==='fulfilled').length,1,'last inventory only reserved once')
 // Normalize the winning order to this buyer for the subsequent cases.
 if(concurrent[0].status==='rejected') { const won=await prisma.checkoutOrder.findFirstOrThrow({where:{userId:other.id,status:'pending'}});await cancelCheckout(other.id,won.id,session);await createCheckout(buyer.id,intent,session) }
 assert.equal(await balance(),expectedWallet)
 assert.equal(await prisma.instance.count({where:{hostId:h.id}}),0,'unpaid reservation creates no customer instance')
 assert.equal((await poolInventory()).find(p=>p.machineGroupId===group.id)?.idle,0)
 // The same buyer can replace their abandoned hold even when no public stock
 // remains. The other purchase entry point and other buyers cannot borrow it.
 const ownCatalog=await app.inject({method:'GET',url:'/api/checkout/catalog?source=direct'})
 assert.equal(ownCatalog.statusCode,200,ownCatalog.body)
 assert.equal(ownCatalog.json().regions[0].products[0].idle,1)
 assert.equal((await app.inject({method:'GET',url:'/api/checkout/catalog?source=cart'})).json().regions[0].products[0].idle,0)
 assert.equal((await poolInventory({replacing:{userId:other.id,source:'direct'}})).find(p=>p.machineGroupId===group.id)?.idle,0)
 await assert.rejects(createCheckout(buyer.id,{...input(),source:'cart'},session),/库存/)
 await assert.rejects(createCheckout(buyer.id,input(2),session),/库存/)
 assert.equal((await getCheckout(buyer.id,intent.requestId)).status,'pending','failed replacement rolls back cancellation')
 const abandonedId=intent.requestId
 const abandonedPay=(await createCheckoutPayment(buyer.id,abandonedId,provider.id,'alipay',session)).payments[0]
 intent=input(); await createCheckout(buyer.id,intent,session)
 assert.equal((await getCheckout(buyer.id,abandonedId)).status,'cancelled')
 assert.equal(await prisma.checkoutReservation.count({where:{orderId:intent.requestId}}),1)
 await handleCheckoutCallback(provider.id,callback(abandonedPay.id,'replaced-late'),meta)
 assert.equal(await prisma.checkoutRefund.count({where:{orderId:abandonedId,reason:'closed_order'}}),1)
 assert.equal(await prisma.instance.count({where:{purchaseBatchId:abandonedId}}),0)
 assert.equal(await balance(),expectedWallet)
 await assert.rejects(prisma.instance.create({data:{hostId:h.id,userId:other.id,name:'raw-insert',incusId:'raw-insert',image:image.remoteAlias,cpu:200,memory:768,disk:30720}}),/HOST_SINGLE_TENANT_OCCUPIED/)
 await assert.rejects(getCheckout(other.id,intent.requestId),/订单不存在/)
 const [a,b]=await Promise.all([createCheckout(buyer.id,intent,session),createCheckout(buyer.id,intent,session)])
 assert.equal(a.id,b.id)
 let order=await createCheckoutPayment(buyer.id,intent.requestId,provider.id,'alipay',session)
 assert.match(order.payments[0].payUrl || '',/type=alipay/)
 order=await createCheckoutPayment(buyer.id,intent.requestId,provider.id,'wxpay',session)
 assert.equal(order.payments.length,2);assert.equal(await balance(),expectedWallet)
 const ali=order.payments.find(p=>p.method==='alipay')!,wx=order.payments.find(p=>p.method==='wxpay')!
 assert.match(wx.payUrl || '',/type=wxpay/)
 await assert.rejects(handleCheckoutCallback(provider.id,{...callback(ali.id,'bad'),money:'0.01'},meta),/签名/)
 await assert.rejects(handleCheckoutCallback(provider.id,callback(ali.id,'wrong-money','alipay','0.01'),meta),/金额/)
 await assert.rejects(handleCheckoutCallback(provider.id,callback(ali.id,'wrong-method','wxpay'),meta),/方式/)
 const signed=callback(ali.id,'paid-1')
 const response=await app.inject({method:'GET',url:`/api/checkout/callback/${provider.id}?${new URLSearchParams(signed).toString()}`})
 assert.equal(response.statusCode,200,response.body);assert.equal(response.body,'success')
 const post=await app.inject({method:'POST',url:`/api/checkout/callback/${provider.id}`,headers:{'content-type':'application/x-www-form-urlencoded'},payload:new URLSearchParams(signed).toString()})
 assert.equal(post.statusCode,200,post.body);assert.equal(post.body,'success')
 await Promise.all([handleCheckoutCallback(provider.id,signed,meta),handleCheckoutCallback(provider.id,signed,meta),payCheckoutBalance(buyer.id,intent.requestId,session)])
 assert.equal(await balance(),expectedWallet,'external payment never touches wallet even when balance races later')
 assert.equal(await prisma.balanceLog.count({where:{userId:buyer.id}}),0)
 assert.ok((await getUserDeletionBlockers(buyer.id)).checkoutOrders > 0,'purchase history blocks destructive user deletion')
 assert.equal(await prisma.rechargeRecord.count({where:{userId:buyer.id}}),0)
 assert.equal((await getCheckout(buyer.id,intent.requestId)).status,'paid','receipt commits durable fulfillment state')
 // A new process can materialize only from the persisted order, without a browser/session.
 await upsertPoolPrice({...priceInput,monthlyPrice:2000},owner.id)
 const materialized=await materializeCheckout(intent.requestId)
 assert.equal(materialized?.entries.length,1)
 assert.equal((await materializeCheckout(intent.requestId))?.entries.length,0,'materialization is idempotent')
 const instance=await prisma.instance.findFirstOrThrow({where:{purchaseBatchId:intent.requestId}})
 assert.equal(Number(instance.billingPrice),10,'confirmed price survives catalog change')
 assert.equal(await prisma.checkoutReservation.count({where:{orderId:intent.requestId}}),0)
 assert.equal(await balance(),expectedWallet)
 await handleCheckoutCallback(provider.id,callback(wx.id,'paid-2','wxpay'),meta)
 assert.equal(await prisma.checkoutRefund.count({where:{orderId:intent.requestId,reason:'duplicate_payment'}}),1)
 await Promise.all([compensateFailedInstancePurchase(instance.id,buyer.id,h.id),compensateFailedInstancePurchase(instance.id,buyer.id,h.id)])
 expectedWallet+=11
 assert.equal(await balance(),expectedWallet,'failed verified external payment credits the original payer once')
 assert.equal(await prisma.checkoutRefund.count({where:{instanceId:instance.id}}),1)
 assert.equal(await prisma.balanceLog.count({where:{userId:buyer.id,type:'refund',instanceId:instance.id}}),1)
 await prisma.instance.update({where:{id:instance.id},data:{status:'error'}})
 await processCheckoutQueue()
 assert.equal((await getCheckout(buyer.id,intent.requestId)).status,'refund_pending')
 const pendingFailure = (await getCheckout(buyer.id,intent.requestId)).result!.instances.find(row=>row.id===instance.id)!
 assert.equal(pendingFailure.refundPending,false,'the failed line is already credited, while the unrelated duplicate payment stays pending')
 assert.equal(pendingFailure.refunded,true)
 assert.equal(pendingFailure.refundedToBalance,true,'customer wallet hint requires the actual credited balance ledger')
 const adminRefundList=await app.inject({method:'GET',url:'/api/checkout-admin/refunds'})
 assert.equal(adminRefundList.statusCode,200,adminRefundList.body)
 assert.ok(!adminRefundList.json().refunds.some((row:any)=>row.instanceId===instance.id),'automatic wallet refunds need no manual original-payment completion')
 assert.ok(adminRefundList.json().refunds.some((row:any)=>row.reason==='duplicate_payment'),'duplicate payments retain the original refund route')
 for (const refund of await prisma.checkoutRefund.findMany({where:{orderId:intent.requestId}})) {
   const response=await app.inject({method:'POST',url:`/api/checkout-admin/refunds/${encodeURIComponent(refund.id)}/complete`,payload:{receipt:'fixture-bank-receipt'}})
   assert.equal(response.statusCode,200,response.body)
 }
 assert.equal((await getCheckout(buyer.id,intent.requestId)).status,'refunded')
 const completedFailure = (await getCheckout(buyer.id,intent.requestId)).result!.instances.find(row=>row.id===instance.id)!
 assert.equal(completedFailure.refundPending,false)
 assert.equal(completedFailure.refunded,true,'only completed refund receipts permit the customer refunded label')
 assert.equal(completedFailure.refundedToBalance,true,'repeated administrator completion never overwrites the wallet receipt marker')
 await upsertPoolPrice(priceInput,owner.id)
 await host()
 const cancelled=input();await createCheckout(buyer.id,cancelled,session)
 const cancelPay=(await createCheckoutPayment(buyer.id,cancelled.requestId,provider.id,'alipay',session)).payments[0]
 await cancelCheckout(buyer.id,cancelled.requestId,session)
 await handleCheckoutCallback(provider.id,callback(cancelPay.id,'late-payment'),meta)
 assert.equal((await getCheckout(buyer.id,cancelled.requestId)).status,'cancelled')
 assert.equal(await prisma.instance.count({where:{purchaseBatchId:cancelled.requestId}}),0)
 assert.equal(await prisma.checkoutRefund.count({where:{orderId:cancelled.requestId,reason:'closed_order'}}),1)
 const wallet=input();await createCheckout(buyer.id,wallet,session)
 await Promise.all([payCheckoutBalance(buyer.id,wallet.requestId,session),payCheckoutBalance(buyer.id,wallet.requestId,session)])
 assert.equal(await balance(),expectedWallet-11,'balance debited exactly once')
 assert.equal(await prisma.balanceLog.count({where:{userId:buyer.id,type:'consume'}}),1)
 // The queued paid intent survives closure/restart and refunds a revoked image
 // without browser work or a second confirmation, exactly once.
 await prisma.systemImage.update({where:{id:image.id},data:{hidden:true}})
 await processCheckoutQueue()
 await processCheckoutQueue()
 assert.equal((await getCheckout(buyer.id,wallet.requestId)).status,'refunded')
 assert.equal(await balance(),expectedWallet)
 await prisma.systemImage.update({where:{id:image.id},data:{hidden:false}})
 await assert.rejects(cancelCheckout(buyer.id,wallet.requestId,session),/已付款/)
 await host();const exp=input();await createCheckout(buyer.id,exp,session)
 await prisma.checkoutOrder.update({where:{id:exp.requestId},data:{expiresAt:new Date(0)}})
 await cancelCheckout(buyer.id,exp.requestId)
 assert.equal((await getCheckout(buyer.id,exp.requestId)).status,'expired')
 assert.equal(await prisma.checkoutReservation.count({where:{orderId:exp.requestId}}),0)
 // Refunds of an externally paid instance stay on its original receipt, then
 // subsequent wallet-paid renewals can return to the wallet.
 const later=input();await createCheckout(buyer.id,later,session)
 const laterPay=(await createCheckoutPayment(buyer.id,later.requestId,provider.id,'alipay',session)).payments[0]
 await handleCheckoutCallback(provider.id,callback(laterPay.id,'later-paid'),meta)
 await materializeCheckout(later.requestId)
 const laterInstance=await prisma.instance.findFirstOrThrow({where:{purchaseBatchId:later.requestId}})
 const purchaseBill=await prisma.instanceBillingRecord.findFirstOrThrow({where:{instanceId:laterInstance.id,type:'newPurchase'}})
 const purchaseView=await app.inject({method:'GET',url:`/api/orders/instance_billing/${purchaseBill.id}`})
 assert.equal(purchaseView.statusCode,200,purchaseView.body)
 assert.equal(purchaseView.json().order.paymentMethod,'alipay')
 assert.equal(purchaseView.json().order.provider.name,'Fixture Epay')
 const adjustment={userId:buyer.id,requestedByUserId:owner.id,requestType:'refund' as const,sourceType:'instance_billing',sourceId:purchaseBill.id,amount:1,reason:'fixture bypass'}
 await assert.rejects(createBalanceAdjustmentRequest(adjustment),/第三方付款/)
 const legacyRequest=await prisma.balanceAdjustmentRequest.create({data:{...adjustment,requestedByUserId:owner.id}})
 await assert.rejects(approveBalanceAdjustmentRequest(legacyRequest.id,{id:owner.id,role:'admin',...session}),/第三方付款/)
 assert.equal((await prisma.balanceAdjustmentRequest.findUniqueOrThrow({where:{id:legacyRequest.id}})).status,'pending')
 async function refundWithBill(amount:number, userId=buyer.id) { return prisma.$transaction(async tx=>{
   await advisoryTransactionLock(tx,USER_BALANCE_LOCK_NAMESPACE,userId)
   const refund=await refundInstancePayment(tx,laterInstance.id,userId,amount,'fixture refund')
   await tx.instanceBillingRecord.create({data:{instanceId:laterInstance.id,userId,type:'refund',amount:-amount,periodStart:new Date(),periodEnd:new Date(),months:0,remark:'fixture refund',balanceLogId:refund.balanceLogId,checkoutRefunds:{connect:refund.refundIds.map(id=>({id}))}}})
   return refund
 }) }
 const refund=await refundWithBill(5)
 const refundBill=await prisma.instanceBillingRecord.findFirstOrThrow({where:{instanceId:laterInstance.id,type:'refund'},orderBy:{id:'desc'}})
 const refundView=await app.inject({method:'GET',url:`/api/orders/instance_billing/${refundBill.id}`})
 assert.equal(refundView.json().order.status,'refund_pending')
 assert.equal(refundView.json().order.completedAt,null)
 assert.equal(refundView.json().order.paymentMethod,'alipay')
 assert.equal(refund.externalCents,500);assert.equal(refund.walletAmount,0);assert.equal(await balance(),expectedWallet)
 // The unpaid refund principal survives a transfer and still targets the old
 // payer's receipt, even when a single refund also contains new wallet money.
 await prisma.instance.update({where:{id:laterInstance.id},data:{userId:other.id}})
 const renewalBill=await prisma.instanceBillingRecord.create({data:{instanceId:laterInstance.id,userId:other.id,type:'renew',amount:2,periodStart:new Date(),periodEnd:new Date(Date.now()+86400000),months:1}})
 const transferredBalance=Number((await prisma.user.findUniqueOrThrow({where:{id:other.id}})).balance)
 const mixed=await refundWithBill(8,other.id)
 assert.equal(mixed.externalCents,600);assert.equal(mixed.walletAmount,2)
 const mixedRefund=await prisma.checkoutRefund.findUniqueOrThrow({where:{id:mixed.refundIds[0]},include:{receipt:true,order:true}})
 assert.equal(mixedRefund.receipt.tradeNo,'later-paid');assert.equal(mixedRefund.order.userId,buyer.id)
 assert.equal(Number((await prisma.user.findUniqueOrThrow({where:{id:other.id}})).balance),transferredBalance+2)
 const mixedView=await app.inject({method:'GET',url:`/api/admin/orders/instance_billing/${mixedRefund.billingRecordId}`})
 assert.equal(mixedView.statusCode,200,mixedView.body)
 assert.deepEqual(mixedView.json().order.paymentSources.map((row:any)=>[row.method,row.amount,row.status]),[['alipay',6,'refund_pending'],['balance',2,'refunded']])
 const renewalView=await app.inject({method:'GET',url:`/api/admin/orders/instance_billing/${renewalBill.id}`})
 assert.equal(renewalView.json().order.walletRefundAllowed,false)
 const completedRefund=await app.inject({method:'POST',url:`/api/checkout-admin/refunds/${encodeURIComponent(mixed.refundIds[0])}/complete`,payload:{receipt:'fixture-bank-refund-receipt'}})
 assert.equal(completedRefund.statusCode,200,completedRefund.body)
 const doneView=await app.inject({method:'GET',url:`/api/admin/orders/instance_billing/${mixedRefund.billingRecordId}`})
 assert.equal(doneView.json().order.status,'refunded');assert.ok(doneView.json().order.completedAt)
 assert.equal((await app.inject({method:'GET',url:`/api/orders/instance_billing/${refundBill.id}`})).json().order.status,'refund_pending','a different refund receipt stays pending')
 assert.equal((await prisma.checkoutRefund.aggregate({where:{orderId:later.requestId},_sum:{amountCents:true}}))._sum.amountCents,1100)
 await assert.rejects(refundWithBill(0.01,other.id),/剩余/)
 // After transfer, refunds still go to the original payer's receipt. Wallet
 // renewal money is separate and cannot increase the external refund limit.
 await prisma.instance.update({where:{id:laterInstance.id},data:{userId:other.id}})
 await prisma.instanceBillingRecord.create({data:{instanceId:laterInstance.id,userId:other.id,type:'renew',amount:3,periodStart:new Date(),periodEnd:new Date(Date.now()+86400000),months:1}})
 const otherBefore=Number((await prisma.user.findUniqueOrThrow({where:{id:other.id}})).balance)
 await prisma.$transaction(async tx=>{await advisoryTransactionLock(tx,USER_BALANCE_LOCK_NAMESPACE,other.id)
   const r=await refundInstancePayment(tx,laterInstance.id,other.id,3,'renewal refund')
   assert.equal(r.externalCents,0);assert.equal(r.walletAmount,3)
   await tx.instanceBillingRecord.create({data:{instanceId:laterInstance.id,userId:other.id,type:'refund',amount:-3,periodStart:new Date(),periodEnd:new Date(),months:0,balanceLogId:r.balanceLogId}})
 })
 assert.equal(Number((await prisma.user.findUniqueOrThrow({where:{id:other.id}})).balance),otherBefore+3)
 await prisma.instance.update({where:{id:laterInstance.id},data:{userId:buyer.id}})
 const beforeCompensation=await balance()
 await compensateFailedInstancePurchase(laterInstance.id,buyer.id,laterInstance.hostId)
 assert.equal(await balance(),beforeCompensation,'fully refunded purchase cannot refund again on provisioning failure')
 // A two-unit order with a one-cent channel fee must refund every cent across
 // separate lines, with no rounding remainder and exactly one wallet credit per line.
 await host();await host()
 await prisma.paymentProvider.update({where:{id:provider.id},data:{feeFixed:0.01}})
 const batch=input(2);await createCheckout(buyer.id,batch,session)
 const bp=(await createCheckoutPayment(buyer.id,batch.requestId,provider.id,'alipay',session)).payments[0]
 await handleCheckoutCallback(provider.id,callback(bp.id,'batch-paid','alipay','22.01'),meta)
 await materializeCheckout(batch.requestId)
 const batchInstances=await prisma.instance.findMany({where:{purchaseBatchId:batch.requestId}})
 for(const row of batchInstances)await compensateFailedInstancePurchase(row.id,buyer.id,row.hostId)
 expectedWallet+=22.01
 assert.equal((await prisma.checkoutRefund.aggregate({where:{orderId:batch.requestId},_sum:{amountCents:true,principalCents:true}}))._sum.amountCents,2201)
 assert.equal(await prisma.balanceLog.count({where:{userId:buyer.id,orderId:batch.requestId,type:'refund'}}),2)
 assert.equal(await balance(),expectedWallet)
 // Real admin routes must return externally paid price reductions to their
 // receipt too, for both individual and batch adjustments.
 await prisma.paymentProvider.update({where:{id:provider.id},data:{feeFixed:0}})
 for(const mode of ['single','batch']) {
   await host();const adjusted=input();await createCheckout(buyer.id,adjusted,session)
   const attempt=(await createCheckoutPayment(buyer.id,adjusted.requestId,provider.id,'alipay',session)).payments[0]
   await handleCheckoutCallback(provider.id,callback(attempt.id,'price-'+mode),meta)
   await materializeCheckout(adjusted.requestId)
   const machine=await prisma.instance.findFirstOrThrow({where:{purchaseBatchId:adjusted.requestId}})
   await prisma.instance.update({where:{id:machine.id},data:{status:'running',expiresAt:new Date(Date.now()+15*86400000)}})
   const response=await app.inject({method:'POST',url:mode==='single'?`/api/admin/instances/${machine.id}/update-price`:'/api/admin/instances/batch-update-price',payload:mode==='single'?{newPrice:5,settleBalance:true,expectedVersion:machine.version}:{instanceIds:[machine.id],newPrice:5,settleBalance:true,expectations:[{instanceId:machine.id,version:machine.version}]}})
   assert.equal(response.statusCode,200,response.body)
   assert.ok(await prisma.checkoutRefund.count({where:{orderId:adjusted.requestId,billingRecordId:{not:null}}}))
   assert.equal(await balance(),expectedWallet,'price reduction cannot turn external money into wallet credit')
   if(mode==='single') {
     const existingPlan=await prisma.packagePlan.findUniqueOrThrow({where:{id:machine.packagePlanId!}})
     const {id:_planId,createdAt:_created,updatedAt:_updated,...planData}=existingPlan
     const lower=await prisma.packagePlan.create({data:{...planData,name:prefix+'-lower',price:100}})
     const current=await prisma.instance.update({where:{id:machine.id},data:{expiresAt:new Date(Date.now()+20*86400000)}})
     const count=await prisma.checkoutRefund.count({where:{orderId:adjusted.requestId}})
     const changed=await performPlanChange(buyer.id,current,lower)
     assert.ok(changed.refundAmount && changed.refundAmount>0)
     assert.equal(await prisma.checkoutRefund.count({where:{orderId:adjusted.requestId}}),count+1)
     assert.equal(await balance(),expectedWallet,'plan downgrade preserves external refund destination')
   }
 }
 // Signed UPAY receipts require the saved invoice's exact network/address and
 // amount; lost invoice responses become a refund obligation, not fulfillment.
 await host()
 const upayConfig={apiurl:'https://1.1.1.1',secret_key:'fixture-upay-sign',payment_type:'USDT-TRC20' as const}
 const cryptoProvider=await prisma.paymentProvider.create({data:{name:'Fixture USDT',type:'upaypro',status:'active',config:upayConfig}})
 const cryptoOrder=input();await createCheckout(buyer.id,cryptoOrder,session)
 const cp=await prisma.checkoutPayment.create({data:{id:'P'+randomUUID().replaceAll('-',''),orderId:cryptoOrder.requestId,providerId:cryptoProvider.id,providerType:'upaypro',providerName:'Fixture USDT',method:'USDT-TRC20',payableCents:1100,feeCents:0,configSnapshot:buildRechargeProviderConfigSnapshot('upaypro',upayConfig),details:{},status:'creating'}})
 const notice={actual_amount:1.52,amount:11,block_transaction_id:'fixture-tx',order_id:cp.id,status:2,token:'fixture-address',trade_id:'fixture-crypto-trade'}
 const signNotice=(value:typeof notice)=>({...value,signature:createHash('md5').update(Object.keys(value).sort().map(k=>`${k}=${value[k as keyof typeof value]}`).join('&')+upayConfig.secret_key).digest('hex')})
 await assert.rejects(handleCheckoutCallback(cryptoProvider.id,signNotice(notice),{...meta,method:'POST'}),/正在保存/)
 await prisma.checkoutPayment.update({where:{id:cp.id},data:{status:'pending',details:buildUpayProPaymentDetails({orderId:cp.id,tradeId:notice.trade_id,amount:11,actualAmount:1.52,address:notice.token,expiresAt:Date.now()+60000,payUrl:'https://1.1.1.1'},upayConfig) as any}})
 await assert.rejects(handleCheckoutCallback(cryptoProvider.id,signNotice({...notice,token:'wrong-address'}),{...meta,method:'POST'}),/网络/)
 await handleCheckoutCallback(cryptoProvider.id,signNotice(notice),{...meta,method:'POST'})
 assert.equal((await getCheckout(buyer.id,cryptoOrder.requestId)).status,'paid');assert.equal(await balance(),expectedWallet)
 await materializeCheckout(cryptoOrder.requestId)
 const cryptoInstance=await prisma.instance.findFirstOrThrow({where:{purchaseBatchId:cryptoOrder.requestId}})
 await Promise.all([compensateFailedInstancePurchase(cryptoInstance.id,buyer.id,cryptoInstance.hostId),compensateFailedInstancePurchase(cryptoInstance.id,buyer.id,cryptoInstance.hostId)])
 expectedWallet+=11
 await prisma.instance.update({where:{id:cryptoInstance.id},data:{status:'error'}})
 const cryptoPending=(await getCheckout(buyer.id,cryptoOrder.requestId)).result!.instances[0]
 assert.equal(cryptoPending.refundPending,false,'USDT failed delivery credits the wallet in the refund transaction')
 assert.equal(cryptoPending.refunded,true)
 assert.equal(cryptoPending.refundedToBalance,true)
 const cryptoRefund=await prisma.checkoutRefund.findFirstOrThrow({where:{instanceId:cryptoInstance.id}})
 assert.equal(cryptoRefund.status,'refunded')
 assert.equal(await balance(),expectedWallet,'USDT credits one wallet refund after the signed receipt and failed delivery')
 assert.match(cryptoRefund.resolution!,/^balance-log:[1-9]\d*$/)
 const cryptoBill=await prisma.instanceBillingRecord.findFirstOrThrow({where:{instanceId:cryptoInstance.id,type:'refund'}})
 const cryptoBillView=await app.inject({method:'GET',url:`/api/orders/instance_billing/${cryptoBill.id}`})
 assert.equal(cryptoBillView.statusCode,200,cryptoBillView.body)
 assert.equal(cryptoBillView.json().order.paymentSources[0].method,'balance','refund bill shows its actual wallet destination')
 const cryptoComplete=await app.inject({method:'POST',url:`/api/checkout-admin/refunds/${encodeURIComponent(cryptoRefund.id)}/complete`,payload:{receipt:'fixture-usdt-refund-transaction'}})
 assert.equal(cryptoComplete.statusCode,200,cryptoComplete.body)
 const cryptoDone=(await getCheckout(buyer.id,cryptoOrder.requestId)).result!.instances[0]
 assert.equal(cryptoDone.refundPending,false);assert.equal(cryptoDone.refunded,true)
 assert.equal(cryptoDone.refundedToBalance,true)
 const forgedWalletReceipt=await app.inject({method:'POST',url:`/api/checkout-admin/refunds/${encodeURIComponent(cryptoRefund.id)}/complete`,payload:{receipt:cryptoRefund.resolution}})
 assert.equal(forgedWalletReceipt.statusCode,400,'administrator cannot forge an automatic wallet receipt')
 const {assertRecoveryExternalLedger}=await import('../src/services/platform-recovery-external-ledger.js')
 const recoveredOrder=await prisma.checkoutOrder.findUniqueOrThrow({where:{id:cryptoOrder.requestId}})
 const recoveredGuest=await prisma.instance.findUniqueOrThrow({where:{id:cryptoInstance.id}})
 await prisma.$transaction(tx=>assertRecoveryExternalLedger(tx,{order:recoveredOrder,instances:[recoveredGuest],transfers:[]},new Date()))
 const creditedLogId=Number(cryptoRefund.resolution!.split(':')[1])
 await assert.rejects(prisma.$transaction(async tx=>{
   await tx.balanceLog.update({where:{id:creditedLogId},data:{amount:1}})
   await assertRecoveryExternalLedger(tx,{order:recoveredOrder,instances:[recoveredGuest],transfers:[]},new Date())
 }),/退款|账|OSS_RECOVERY/,'restored wallet refund must verify its actual exact ledger and never double count the external principal')
 await host();const lost=input();await createCheckout(buyer.id,lost,session)
 const lp=await prisma.checkoutPayment.create({data:{id:'P'+randomUUID().replaceAll('-',''),orderId:lost.requestId,providerId:cryptoProvider.id,providerType:'upaypro',providerName:'Fixture USDT',method:'USDT-TRC20',payableCents:1100,feeCents:0,configSnapshot:buildRechargeProviderConfigSnapshot('upaypro',upayConfig),details:{},status:'uncertain'}})
 await handleCheckoutCallback(cryptoProvider.id,signNotice({...notice,order_id:lp.id,trade_id:'fixture-lost-trade'}),{...meta,method:'POST'})
 assert.equal((await getCheckout(buyer.id,lost.requestId)).status,'refund_pending')
 assert.equal(await prisma.checkoutReservation.count({where:{orderId:lost.requestId}}),0)
 assert.equal(await prisma.checkoutRefund.count({where:{orderId:lost.requestId,reason:'invoice_unavailable'}}),1)
 assert.equal(await balance(),expectedWallet)
 // Verify every supported callback family at the checkout boundary, using real
 // signatures and persisted invoices, without contacting a payment provider.
 const keys=generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}})
 const {signHeleketPayload}=await import('../src/lib/heleket.js')
 const {signAntomContent}=await import('../src/lib/antom.js')
 for(const kind of ['epay-v2','heleket','antom'] as const){
   await host();const request=input();await createCheckout(buyer.id,request,session)
   const type=kind==='epay-v2'?'yipay':kind
   const cfg=kind==='epay-v2'?{version:'v2',apiurl:'https://1.1.1.1',pid:'test-v2',merchant_private_key:keys.privateKey,platform_public_key:keys.publicKey}
     :kind==='heleket'?{merchant_uuid:'test-merchant',api_key:'test-key',currency:'CNY'}
     :{environment:'sandbox',apiurl:'https://open-sea-global.alipay.com',clientId:'SANDBOX_PAYINCUS',antom_public_key:keys.publicKey,merchant_private_key:keys.privateKey,currency:'USD',currencyRate:0.14,currencyExponent:2,sessionExpiryMinutes:30}
   const gateway=await prisma.paymentProvider.create({data:{name:kind,type,config:cfg,status:'active'}})
   const attempt=await prisma.checkoutPayment.create({data:{id:'P'+randomUUID().replaceAll('-',''),orderId:request.requestId,providerId:gateway.id,providerName:kind,providerType:type,method:kind==='epay-v2'?'wxpay':'',payableCents:1100,feeCents:0,configSnapshot:buildRechargeProviderConfigSnapshot(type,cfg),details:{},status:'pending'}})
   const notice:Record<string,unknown>=kind==='epay-v2'?{pid:'test-v2',out_trade_no:attempt.id,trade_no:kind,type:'wxpay',money:'11.00',trade_status:'TRADE_SUCCESS'}
     :kind==='heleket'?{order_id:attempt.id,uuid:kind,amount:'11.00',currency:'CNY',status:'paid',is_final:true}
     :{notifyType:'PAYMENT_RESULT',paymentRequestId:attempt.id,paymentId:kind,paymentAmount:{currency:'USD',value:'154'},result:{resultStatus:'S',resultCode:'SUCCESS'}}
   const callbackMeta={...meta,ip:kind==='heleket'?'31.133.220.8':meta.ip,method:'POST',requestUri:`/api/checkout/callback/${gateway.id}`,requestTime:String(Date.now()),clientId:'SANDBOX_PAYINCUS',rawBody:JSON.stringify(notice)}
   if(kind==='epay-v2')notice.sign=sign('RSA-SHA256',Buffer.from(Object.keys(notice).sort().map(k=>`${k}=${notice[k]}`).join('&')),keys.privateKey).toString('base64')
   if(kind==='heleket')notice.sign=signHeleketPayload(notice,'test-key')
   if(kind==='antom')callbackMeta.signature=`algorithm=RSA256, keyVersion=1, signature=${encodeURIComponent(signAntomContent(`POST ${callbackMeta.requestUri}\n${callbackMeta.clientId}.${callbackMeta.requestTime}.${callbackMeta.rawBody}`,keys.privateKey))}`
   await assert.rejects(handleCheckoutCallback(gateway.id,{...notice,sign:'invalid'},{...callbackMeta,signature:'invalid'}),/签名/)
   await handleCheckoutCallback(gateway.id,notice,callbackMeta)
   await handleCheckoutCallback(gateway.id,notice,callbackMeta)
   assert.equal((await getCheckout(buyer.id,request.requestId)).status,'paid',kind)
   assert.equal(await prisma.checkoutReceipt.count({where:{paymentId:attempt.id}}),1)
   assert.equal(await balance(),expectedWallet)
 }
 // A paid order that cannot even materialize a guest must use the same wallet
 // refund and survive rollback/retry without creating a duplicate balance log.
 await host();const unmaterialized=input();await createCheckout(buyer.id,unmaterialized,session)
 const failedPayment=(await createCheckoutPayment(buyer.id,unmaterialized.requestId,provider.id,'alipay',session)).payments[0]
 await handleCheckoutCallback(provider.id,callback(failedPayment.id,'never-materialized'),meta)
 const original=await prisma.checkoutOrder.findUniqueOrThrow({where:{id:unmaterialized.requestId}})
 const beforeRollback=await balance()
 await assert.rejects(prisma.$transaction(async tx=>{
   await creditFailedCheckoutRefundToBalance(tx,original,null,1100,'fulfillment_failed')
   throw Error('fixture rollback after credit')
 }),/fixture rollback/)
 assert.equal(await balance(),beforeRollback)
 assert.equal(await prisma.checkoutRefund.count({where:{orderId:original.id}}),0,'refund receipt and wallet credit roll back together')
 assert.equal(await prisma.balanceLog.count({where:{orderId:original.id,type:'refund'}}),0)
 await assert.rejects(prisma.$transaction(tx=>creditFailedCheckoutRefundToBalance(tx,{...original,paymentId:'wrong-payment'},null,1100,'fulfillment_failed')),/原付款/)
 await prisma.checkoutOrder.updateMany({where:{id:{not:original.id},status:{in:['paid','fulfilling','refund_pending']}},data:{nextAttemptAt:new Date(Date.now()+3600000)}})
 await host();const sibling=input();await createCheckout(buyer.id,sibling,session)
 const siblingPayment=(await createCheckoutPayment(buyer.id,sibling.requestId,provider.id,'alipay',session)).payments[0]
 await handleCheckoutCallback(provider.id,callback(siblingPayment.id,'refund-sibling'),meta)
 const originalReceipt=await prisma.checkoutReceipt.findFirstOrThrow({where:{paymentId:failedPayment.id}})
 await prisma.checkoutReceipt.update({where:{id:originalReceipt.id},data:{currency:'EUR'}})
 await prisma.systemImage.update({where:{id:image.id},data:{hidden:true}})
 await processCheckoutQueue()
 assert.equal((await getCheckout(buyer.id,original.id)).status,'paid','failed refund remains retryable instead of being marked refunded')
 assert.equal(await prisma.balanceLog.count({where:{orderId:original.id,type:'refund'}}),0)
 assert.equal((await getCheckout(buyer.id,sibling.requestId)).status,'refunded','one refund failure does not stop the remaining orders')
 assert.equal(await balance(),beforeRollback+11)
 await prisma.checkoutReceipt.update({where:{id:originalReceipt.id},data:{currency:'CNY'}})
 await prisma.checkoutOrder.update({where:{id:original.id},data:{nextAttemptAt:new Date()}})
 await Promise.all([processCheckoutQueue(),processCheckoutQueue()])
 await prisma.systemImage.update({where:{id:image.id},data:{hidden:false}})
 const failure=await getCheckout(buyer.id,original.id)
 assert.equal(await balance(),beforeRollback+22,'unmaterialized paid order retries and credits once while the sibling stays settled')
 assert.equal(failure.status,'refunded');assert.equal(failure.result,null)
 assert.equal(failure.error,'本台主机未能开通，款项已自动退至账户余额。')
 assert.equal(failure.refunds[0].refundedToBalance,true)
 assert.equal(await prisma.balanceLog.count({where:{orderId:original.id,type:'refund'}}),1)
 await Promise.all([prisma.$transaction(tx=>creditFailedCheckoutRefundToBalance(tx,original,null,1100,'fulfillment_failed')),
   prisma.$transaction(tx=>creditFailedCheckoutRefundToBalance(tx,original,null,1100,'fulfillment_failed'))])
 assert.equal(await prisma.balanceLog.count({where:{orderId:original.id,type:'refund'}}),1,'parallel retries after completion never credit twice')
 const reuse=input();reuse.requestId=cancelled.requestId
 await assert.rejects(createCheckout(buyer.id,reuse,session),/重新下单/)
 await prisma.tokenInvalidation.create({data:{userId:buyer.id,sessionId:session.sid,invalidatedAt:session.iat}})
 await assert.rejects(createCheckout(buyer.id,input(),session),/登录/)
 console.log('PASS: purchase reservation, signature callback, wallet isolation, price snapshot, duplicate/late refunds, balance idempotency, expiration, revocation')
} finally { await app.close(); await closePrismaDatabase() }
// Imported security modules retain their housekeeping timer after DB shutdown.
process.exit(0)
