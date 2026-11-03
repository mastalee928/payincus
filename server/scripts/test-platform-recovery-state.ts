import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verifyRecoveryDatabaseCatalog } from './fixtures/recovery-database-catalog.js'
// @ts-ignore bcryptjs follows the runtime auth import
import bcrypt from 'bcryptjs'

const url = new URL(process.env.DATABASE_URL || '')
assert.ok(url.hostname === '127.0.0.1' && url.port !== '5432' && url.pathname.endsWith('_recovery_test'), 'Dedicated disposable local recovery database required')
await verifyRecoveryDatabaseCatalog()
process.env.NODE_ENV = 'test'; process.env.JWT_SECRET = 'recovery-test-b-controller-secret'
process.env.ENCRYPTION_KEY = 'recovery-test-b-encryption-key'
const folder = await mkdtemp(join(tmpdir(),'incudal-recovery-state-')); process.env.PLATFORM_BACKUP_STATE_DIR=folder
const {prisma,closePrismaDatabase}=await import('../src/db/prisma.js')
const core=await import('../src/services/platform-backup-core.js')
const op=await import('../src/services/platform-recovery-operator.js')
const state=await import('../src/services/platform-recovery-state.js')
const evidence=await import('../src/services/platform-recovery-evidence.js')
const registrationService=await import('../src/services/platform-recovery-registration.js')
const queue=await import('../src/services/platform-recovery-queue.js')
const {isAccessTokenInvalidated,invalidateSessionAccessToken}=await import('../src/lib/security.js')
const {pgRecoveryTransaction}=await import('../src/services/platform-backup-database.js')
const {recoveryOrder,resolveRecoveryOrder}=await import('../src/services/platform-recovery-orders.js')
const activation=await import('../src/services/platform-recovery-activation.js')
const password='B-only-password-for-test', holdId=randomUUID()
try {
  await core.initBackupState()
  const original=await prisma.user.create({data:{username:'admin',role:'admin',passwordHash:await bcrypt.hash(password,4)}})
  await op.captureRecoveryOperator(original.id,holdId)
  // The restored old user collides with B's original numeric ID and username.
  await prisma.user.update({where:{id:original.id},data:{passwordHash:await bcrypt.hash('old-snapshot-password',4),status:'banned'}})
  const actorId=await op.installRecoveryOperator(holdId,holdId,'restore')
  assert.notEqual(actorId,original.id)
  assert.equal(await op.installRecoveryOperator(holdId,holdId,'restore'),actorId,'install retry is idempotent')
  const createdAt=new Date(Date.now()-1000).toISOString()
  await core.writeJson(join(folder,'recovery-hold.json'),{taskId:holdId,batchId:holdId,mode:'restore',createdAt,
    snapshot:{createdAt:new Date(Date.now()-86400000).toISOString(),version:'1.8.0'}})
  await assert.rejects(op.authenticateRecoveryOperator('admin','old-snapshot-password'),/CREDENTIALS_INVALID/)
  const login=await op.authenticateRecoveryOperator('admin',password)
  assert.equal(login.id,actorId); assert.ok(await op.validateRecoverySession(login))
  assert.equal(await op.validateRecoverySession({id:original.id,sid:'old-session'}),false)
  const iat=Math.floor(Date.now()/1000)
  await invalidateSessionAccessToken(actorId,login.sid)
  assert.ok(await isAccessTokenInvalidated(actorId,iat,login.sid),'logout revocation is persistent')
  assert.equal((await state.recoveryReadiness()).ready,false)
  await assert.rejects(state.assertRecoveryReady(holdId),/RECONCILIATION_REQUIRED/)
  const hostRows=Array.from({length:1001},(_,i)=>({userId:original.id,name:`recovery-${i}`,url:`https://192.0.2.1:8443`,poolFaulted:true,singleTenant:true}))
  await prisma.host.createMany({data:hostRows})
  await queue.seedRecoveryHosts()
  assert.equal(await prisma.platformRecoveryHost.count({where:{batchId:holdId}}),1001)
  const {recoveryReview}=await import('../src/services/platform-recovery-review.js')
  const finalPage=await recoveryReview('balances',1,41)
  assert.equal(finalPage.hostTotal,1001);assert.equal(finalPage.hosts.length,1)
  const hash=await state.recoveryDatasetHash('finance')
  await assert.rejects(evidence.recordRecoveryEvidence('finance',{reference:'statement-before',evidenceHash:'1'.repeat(64),observedAt:createdAt,sourceHash:'0'.repeat(64)},actorId,{password}),/STALE/)
  await evidence.recordRecoveryEvidence('finance',{reference:'statement-current',evidenceHash:'1'.repeat(64),observedAt:new Date().toISOString(),sourceHash:hash},actorId,{password})
  assert.equal((await state.recoveryReadiness()).categories.find(r=>r.category==='finance')?.verified,true)
  await prisma.user.update({where:{id:original.id},data:{balance:11}})
  assert.equal((await state.recoveryReadiness()).categories.find(r=>r.category==='finance')?.verified,false)
  const host=await prisma.host.findFirstOrThrow({orderBy:{id:'asc'}})
  const sourceHash=await state.recoveryHostSourceHash(host.id)
  await prisma.platformRecoveryHost.update({where:{batchId_hostId:{batchId:holdId,hostId:host.id}},data:{status:'success',sourceHash,checkedAt:new Date(),nextAttemptAt:new Date(Date.now()+12*3600000)}})
  assert.equal((await state.recoveryReadiness()).hosts.passed,'1')
  await prisma.host.update({where:{id:host.id},data:{name:'changed-after-review'}})
  assert.equal((await state.recoveryReadiness()).hosts.passed,'0')
  await queue.seedRecoveryHosts()
  assert.equal((await prisma.platformRecoveryHost.findUniqueOrThrow({where:{batchId_hostId:{batchId:holdId,hostId:host.id}}})).status,'pending')
  const access=await evidence.recoveryAccessAccounts()
  const old=access.rows.find(r=>r.id===original.id)!
  const accessInput={userId:old.id,expectedHash:old.sourceHash,role:'admin' as const,status:'active' as const,newPassword:'new-restored-password',reference:'access-current',evidenceHash:'2'.repeat(64),observedAt:new Date().toISOString()}
  const accessSaved=await evidence.reconcileRecoveryAccess(accessInput,actorId,{password})
  assert.equal((await evidence.reconcileRecoveryAccess(accessInput,actorId,{password})).id,accessSaved.id,'lost access response is idempotent')
  await assert.rejects(evidence.reconcileRecoveryAccess({...accessInput,role:'user'},actorId,{password}),/EVIDENCE_CONFLICT/)
  await assert.rejects(evidence.reconcileRecoveryAccess({...accessInput,newPassword:'different-response-replay'},actorId,{password}),/EVIDENCE_CONFLICT/)
  const corrected=await prisma.user.findUniqueOrThrow({where:{id:old.id}})
  assert.equal(corrected.status,'active');assert.ok(await bcrypt.compare('new-restored-password',corrected.passwordHash))
  assert.equal(await bcrypt.compare('old-snapshot-password',corrected.passwordHash),false)
  await prisma.platformRecoveryHost.updateMany({where:{batchId:holdId},data:{status:'blocked',attempts:8,leaseToken:null,leaseUntil:null,nextAttemptAt:new Date(0)}})
  assert.equal(await queue.claimRecoveryHost(holdId),undefined,'blocked hosts do not retry forever')
  const manual=await queue.claimRecoveryHost(holdId,host.id)
  assert.equal(manual?.attempts,1,'explicit retry starts a bounded new attempt sequence')
  assert.equal(await queue.claimRecoveryHost(holdId,host.id),undefined,'unexpired lease cannot be stolen')
  await prisma.platformRecoveryHost.update({where:{batchId_hostId:{batchId:holdId,hostId:host.id}},data:{leaseUntil:new Date(0)}})
  const reclaimed=await queue.claimRecoveryHost(holdId,host.id)
  assert.ok(reclaimed && reclaimed.token!==manual?.token,'abandoned lease can be reclaimed')
  assert.equal((await prisma.platformRecoveryHost.updateMany({where:{batchId:holdId,hostId:host.id,leaseToken:manual?.token},data:{status:'success'}})).count,0,'late worker cannot publish over a new lease')
  await assert.rejects(queue.retryBlockedRecoveryHosts(randomUUID()),/CONTEXT_CHANGED/)
  assert.equal((await queue.retryBlockedRecoveryHosts(holdId)).queued,1000,'bulk retry excludes an actively leased host')
  assert.equal((await queue.retryBlockedRecoveryHosts(holdId)).queued,0,'repeated bulk request does not reset active attempts')
  await prisma.platformRecoveryHost.updateMany({where:{batchId:holdId},data:{status:'pending',attempts:0,leaseToken:null,leaseUntil:null,nextAttemptAt:new Date(0)}})
  const concurrent=await Promise.all([0,1,2,3].map(()=>queue.claimRecoveryHost(holdId)))
  assert.equal(new Set(concurrent.map(row=>row?.host_id)).size,4,'concurrent claims select four distinct hosts')
  await prisma.platformRecoveryHost.updateMany({where:{batchId:holdId},data:{nextAttemptAt:new Date(Date.now()+86400000)}})
  await prisma.platformRecoveryHost.update({where:{batchId_hostId:{batchId:holdId,hostId:host.id}},data:{status:'retry',attempts:7,leaseToken:null,leaseUntil:null,nextAttemptAt:new Date(0),sourceHash:await state.recoveryHostSourceHash(host.id)}})
  const batch=await state.activeRecoveryBatch()
  const {runRecoveryGatewayCheck}=await import('../src/services/platform-recovery-gateway.js')
  let gatewayChecks=0
  const failedGateway=async()=>{gatewayChecks++;throw Object.assign(new Error('not exposed'),{code:'ECONNRESET'})}
  await runRecoveryGatewayCheck(batch,failedGateway)
  await runRecoveryGatewayCheck(batch,failedGateway)
  assert.equal(gatewayChecks,1,'unchanged gateway failures do not busy-loop')
  const lastGateway=await prisma.platformRecoveryEvidence.findFirstOrThrow({where:{batchId:holdId,category:'gateway-check'},orderBy:{createdAt:'desc'}})
  await prisma.platformRecoveryEvidence.update({where:{id:lastGateway.id},data:{payload:{...(lastGateway.payload as object),nextAt:new Date(0).toISOString()}}})
  await runRecoveryGatewayCheck(batch,async()=>{gatewayChecks++;return {id:randomUUID(),peers:0,checkedAt:new Date().toISOString()}})
  assert.equal(gatewayChecks,2,'the original gateway returning continues automatically')
  assert.equal(await prisma.platformRecoveryEvidence.count({where:{batchId:holdId,category:'gateway-check'}}),2,'gateway failure survives successful recheck')
  const brokenTransport=async(id:number)=>({hostId:id,checkedAt:new Date().toISOString(),managementVerified:false,code:'OSS_REVIEW_HOST_UNREACHABLE'})
  await queue.runRecoveryHostCheck(undefined,batch,brokenTransport)
  let savedHost=await prisma.platformRecoveryHost.findUniqueOrThrow({where:{batchId_hostId:{batchId:holdId,hostId:host.id}}})
  assert.equal(savedHost.status,'retry','eight outages transition to sparse automatic observation, not a permanent dead end')
  assert.equal((savedHost.result as any).automation.mode,'observing')
  assert.equal(await queue.claimRecoveryHost(holdId,host.id+10000),undefined)
  await prisma.platformRecoveryHost.update({where:{batchId_hostId:{batchId:holdId,hostId:host.id}},data:{nextAttemptAt:new Date(0)}})
  await queue.runRecoveryHostCheck(undefined,batch,async(id)=>({...await brokenTransport(id),code:'OSS_REVIEW_IDENTITY_CHANGED'}))
  savedHost=await prisma.platformRecoveryHost.findUniqueOrThrow({where:{batchId_hostId:{batchId:holdId,hostId:host.id}}})
  assert.equal(savedHost.status,'blocked','a verified identity conflict stops repeated remote actions immediately')
  const oldAttempts=savedHost.attempts
  await queue.seedRecoveryHosts()
  assert.equal((await prisma.platformRecoveryHost.findUniqueOrThrow({where:{batchId_hostId:{batchId:holdId,hostId:host.id}}})).attempts,oldAttempts,'unchanged source must not restart a blocked cycle')
  assert.equal(await queue.claimRecoveryHost(holdId),undefined,'conflicts do not cause immediate busy retries')
  await prisma.platformRecoveryHost.update({where:{batchId_hostId:{batchId:holdId,hostId:host.id}},data:{nextAttemptAt:new Date(0)}})
  await queue.runRecoveryHostCheck(undefined,batch,async id=>({hostId:id,checkedAt:new Date().toISOString(),managementVerified:true,
    inventory:{expectedCount:0,actualCount:0,missing:[],unexpected:[],conflicts:[],inventoryMatched:true},code:null}))
  assert.equal((await prisma.platformRecoveryHost.findUniqueOrThrow({where:{batchId_hostId:{batchId:holdId,hostId:host.id}}})).status,'success',
    'original remote identity returning resumes verification without changing DB evidence')
  await prisma.host.update({where:{id:host.id},data:{name:'evidence-corrected'}})
  await queue.seedRecoveryHosts()
  savedHost=await prisma.platformRecoveryHost.findUniqueOrThrow({where:{batchId_hostId:{batchId:holdId,hostId:host.id}}})
  assert.equal(savedHost.status,'pending','changed evidence requeues without an admin retry')
  assert.equal(savedHost.attempts,0)
  assert.equal(await prisma.platformRecoveryEvidence.count({where:{batchId:holdId,category:'host-check'}}),3,'failure receipts survive successful re-observation')
  const {verifyCurrentRecoveryHosts,assertFinalRecoveryHosts}=await import('../src/services/platform-recovery-final-check.js')
  const {pgQuery}=await import('../src/services/platform-backup-database.js')
  let checked=0,inFlight=0,peak=0
  await assert.rejects(verifyCurrentRecoveryHosts(holdId,pgQuery,async id=>{
    inFlight++;peak=Math.max(peak,inFlight)
    try {
      checked++
      if(id===host.id)await prisma.host.update({where:{id},data:{name:'changed-during-final-read'}})
      if(id===host.id+1)throw Object.assign(new Error('unprinted transport error'),{code:'ECONNRESET'})
      if(id===host.id+2)throw Object.assign(new Error('unprinted identity error'),{code:'INCUS_CERTIFICATE_MISMATCH'})
      return {hostId:id,checkedAt:new Date().toISOString(),managementVerified:true,inventory:{expectedCount:0,actualCount:0,missing:[],unexpected:[],conflicts:[],inventoryMatched:true},code:null}
    }finally{inFlight--}
  },{now:()=>0,budgetMs:1}),/FINAL_HOST_CHECK_FAILED/)
  assert.equal(checked,1001,'final verification covers all pages')
  assert.ok(peak<=4,'final verification keeps bounded parallel reads')
  assert.equal(inFlight,0,'final failure waits for all verification lanes before backend can restart')
  assert.equal((await prisma.platformRecoveryHost.findUniqueOrThrow({where:{batchId_hostId:{batchId:holdId,hostId:host.id}}})).status,'retry')
  const finalConflict=await prisma.platformRecoveryHost.findUniqueOrThrow({where:{batchId_hostId:{batchId:holdId,hostId:host.id+2}}})
  assert.equal(finalConflict.status,'blocked','final gate retains deterministic conflict policy')
  assert.equal((finalConflict.result as any).automation.nextAction,'observe-original-condition')
  assert.ok(finalConflict.nextAttemptAt.getTime()>Date.now()+25*60000,'final failure must not reset a conflict to 30-second retries')
  assert.equal(await prisma.platformRecoveryEvidence.count({where:{batchId:holdId,category:'host-final-check'}}),1001,'every final check has persistent history')
  // Keep the first failure history. Recover only the three invalid observations,
  // then prove a timed-out pass continues without repeating successful hosts.
  let resumedChecks=0
  const passedFinal=async(id:number)=>{resumedChecks++;return {hostId:id,checkedAt:new Date().toISOString(),managementVerified:true,
    inventory:{expectedCount:0,actualCount:0,missing:[],unexpected:[],conflicts:[],inventoryMatched:true},code:null}}
  await verifyCurrentRecoveryHosts(holdId,pgQuery,passedFinal,{now:()=>0,budgetMs:1})
  assert.equal(resumedChecks,3,'only failed or changed hosts are checked again')
  await assertFinalRecoveryHosts(holdId,pgQuery)
  await verifyCurrentRecoveryHosts(holdId,pgQuery,passedFinal,{now:()=>0,budgetMs:1})
  assert.equal(resumedChecks,3,'verified hosts survive a lost final response')
  await prisma.$executeRaw`UPDATE hosts SET name='source-change-after-final-'||id::text
    WHERE id IN (${host.id},${host.id+1},${host.id+2},${host.id+3},${host.id+4},${host.id+5})`
  await assert.rejects(assertFinalRecoveryHosts(holdId,pgQuery),/FINAL_HOST_CHECK_PENDING/)
  let clock=0
  await assert.rejects(verifyCurrentRecoveryHosts(holdId,pgQuery,async id=>{clock=100;return passedFinal(id)},
    {now:()=>clock,budgetMs:50}),/FINAL_HOST_CHECK_PENDING/)
  assert.ok(resumedChecks>3 && resumedChecks<=7,'time limit drains at most four lanes')
  await verifyCurrentRecoveryHosts(holdId,pgQuery,passedFinal,{now:()=>0,budgetMs:1})
  assert.equal(resumedChecks,9,'continuation checks each changed host exactly once')
  await prisma.platformRecoveryEvidence.updateMany({where:{batchId:holdId,category:'host-final-check'},data:{createdAt:new Date(Date.now()-25*3600000)}})
  await assert.rejects(assertFinalRecoveryHosts(holdId,pgQuery),/FINAL_HOST_CHECK_PENDING/,'expired observations cannot authorize release')
  const provider=await prisma.paymentProvider.create({data:{name:'Recovery test',type:'yipay',methods:['alipay'],config:{}}})
  const accountInput={id:randomUUID(),reference:'new-user-proof',evidenceHash:'8'.repeat(64),observedAt:new Date().toISOString(),
    originalId:actorId,username:'new-account-only',createdAt:new Date(Date.now()-10000).toISOString()}
  const account=await registrationService.registerRecoveryAccount(accountInput,actorId,{password})
  assert.notEqual(account.userId,actorId,'new customer cannot overwrite the B operator when A IDs collide')
  assert.equal(await registrationService.recoveryOriginalUserId(account.userId),actorId,'explicit mapping preserves original remote owner identity')
  assert.equal((await registrationService.registerRecoveryAccount(accountInput,actorId,{password})).replayed,true)
  await assert.rejects(registrationService.registerRecoveryAccount({...accountInput,id:randomUUID(),reference:'duplicate-account-proof',username:'different-new-account'},actorId,{password}),/USER_EXISTS/)
  const creditInput={id:randomUUID(),reference:'new-recharge-proof',evidenceHash:'9'.repeat(64),observedAt:new Date().toISOString(),
    userId:account.userId,orderNo:'missing-recharge-order',providerId:provider.id,method:'alipay',tradeNo:'missing-recharge-trade',amount:'11.00',creditedAmount:'10.00',fee:'1.00',
    paidAt:new Date(Date.now()-5000).toISOString(),expectedBalance:'0.00',targetBalance:'3.00',expectedLatestLogId:null,currency:'CNY',receivedAmount:'11.00'}
  const credited=await registrationService.registerRecoveryRecharge(creditInput,actorId,{password})
  assert.equal((await registrationService.registerRecoveryRecharge(creditInput,actorId,{password})).replayed,true)
  assert.equal(Number((await prisma.user.findUniqueOrThrow({where:{id:account.userId}})).balance),3,'spent historical recharge retains confirmed final balance')
  assert.equal(await prisma.balanceLog.count({where:{userId:account.userId,type:'recharge'}}),1,'lost reply does not duplicate credit')
  assert.equal(Number((await prisma.rechargeRecord.findUniqueOrThrow({where:{id:credited.rechargeId}})).fee),1)
  await assert.rejects(registrationService.registerRecoveryRecharge({...creditInput,targetBalance:'4.00'},actorId,{password}),/EVIDENCE_CONFLICT/)
  await assert.rejects(registrationService.registerRecoveryRecharge({...creditInput,id:randomUUID(),reference:'before-snapshot',paidAt:new Date(Date.now()-172800000).toISOString()},actorId,{password}),/EVIDENCE_INVALID/)
  const registration={id:randomUUID(),reference:'registration-one',evidenceHash:'3'.repeat(64),observedAt:new Date().toISOString(),
    user:{username:'after-snapshot'},order:{id:randomUUID(),providerId:provider.id,method:'alipay',tradeNo:'evidenced-trade',amountCents:1100,receivedCurrency:'CNY',receivedAmount:'11.00',paidAt:new Date(Date.now()-500).toISOString()}}
  await assert.rejects(evidence.registerRecoveryBusiness({...registration,order:{...registration.order,receivedCurrency:undefined,receivedAmount:undefined}},actorId,{password}),/RECEIVED_AMOUNT_REQUIRED/)
  await evidence.registerRecoveryBusiness(registration,actorId,{password})
  const customer=await prisma.user.findUniqueOrThrow({where:{username:'after-snapshot'}})
  assert.equal(customer.status,'banned');assert.equal(Number(customer.balance),0)
  assert.equal((await evidence.registerRecoveryBusiness(registration,actorId,{password})).replayed,true)
  const pending=await recoveryOrder(registration.order.id)
  assert.equal(pending.status,'recovery_review');assert.equal(pending.refunds.length,1)
  assert.equal(pending.refunds[0].amountCents,1100)
  const resolution={id:randomUUID(),orderId:pending.id,sourceHash:pending.sourceHash,reference:'refund-final',evidenceHash:'4'.repeat(64),observedAt:new Date().toISOString(),conclusion:'refunded' as const,
    refunds:[{id:pending.refunds[0].id,reference:'external-refund-001'}]}
  await resolveRecoveryOrder(resolution,actorId,{password})
  assert.equal((await recoveryOrder(pending.id)).status,'refunded')
  assert.equal((await resolveRecoveryOrder(resolution,actorId,{password})).replayed,true)
  const noRefund={...registration,id:randomUUID(),reference:'without-refund-record',user:{id:customer.id},order:{...registration.order,id:randomUUID(),tradeNo:'without-refund-trade'}}
  await evidence.registerRecoveryBusiness(noRefund,actorId,{password})
  await prisma.checkoutRefund.deleteMany({where:{orderId:noRefund.order.id}})
  const missingRefund=await recoveryOrder(noRefund.order.id)
  assert.equal(missingRefund.refunds[0].status,'unrecorded')
  await resolveRecoveryOrder({...resolution,id:randomUUID(),reference:'missing-refund-final',orderId:missingRefund.id,sourceHash:missingRefund.sourceHash,
    refunds:[{id:missingRefund.refunds[0].id,reference:'external-missing-refund'}]},actorId,{password})
  assert.equal((await recoveryOrder(missingRefund.id)).status,'refunded','existing paid order can record a missing refund')
  const walletOrder=await prisma.checkoutOrder.create({data:{id:randomUUID(),userId:customer.id,requestHash:'wallet-fixture',source:'direct',status:'recovery_review',
    totalCents:1100,snapshot:'test',display:[],expiresAt:new Date(),paidAt:new Date(),paymentId:'balance'}})
  await prisma.balanceLog.create({data:{userId:customer.id,type:'consume',orderId:walletOrder.id,amount:-11,balanceBefore:11,balanceAfter:0}})
  // The independent account review already restored the final ¥11 balance.
  await prisma.user.update({where:{id:customer.id},data:{balance:11}})
  const walletView=await recoveryOrder(walletOrder.id)
  const walletResolution={...resolution,id:randomUUID(),reference:'wallet-refund-final',orderId:walletView.id,sourceHash:walletView.sourceHash,refunds:[],walletBalance:'3.00'}
  await resolveRecoveryOrder(walletResolution,actorId,{password})
  await resolveRecoveryOrder(walletResolution,actorId,{password})
  assert.equal(Number((await prisma.user.findUniqueOrThrow({where:{id:customer.id}})).balance),3,'spent historical refund preserves final balance and does not credit twice')
  assert.equal(await prisma.balanceLog.count({where:{orderId:walletOrder.id,type:'refund'}}),1)
  const partialWallet=await prisma.checkoutOrder.create({data:{id:randomUUID(),userId:customer.id,requestHash:'partial-wallet',source:'direct',status:'recovery_review',
    totalCents:1000,snapshot:'test',display:[{quantity:2}],expiresAt:new Date(),paidAt:new Date(),paymentId:'balance'}})
  const walletHost=await prisma.host.create({data:{userId:actorId,name:'partial-wallet-host',url:'https://192.0.2.25:8443',singleTenant:false}})
  const walletGuest=await prisma.instance.create({data:{userId:customer.id,hostId:walletHost.id,incusId:'original-wallet-guest',name:'original-wallet-guest',
    status:'running',image:'fixture',cpu:100,memory:512,disk:1024,purchaseBatchId:partialWallet.id}})
  await prisma.instanceBillingRecord.create({data:{userId:customer.id,instanceId:walletGuest.id,type:'newPurchase',amount:4,months:1,
    periodStart:new Date(),periodEnd:new Date(Date.now()+86400000),purchaseBatchId:partialWallet.id}})
  await prisma.balanceLog.createMany({data:[{userId:customer.id,type:'consume',orderId:partialWallet.id,amount:-10,balanceBefore:10,balanceAfter:0},
    {userId:customer.id,type:'refund',orderId:partialWallet.id,amount:2,balanceBefore:0,balanceAfter:2}]})
  await prisma.platformRecoveryHost.create({data:{batchId:holdId,hostId:walletHost.id,status:'success',sourceHash:await state.recoveryHostSourceHash(walletHost.id),checkedAt:new Date()}})
  const partialView=await recoveryOrder(partialWallet.id)
  assert.ok(partialView.partialAvailable)
  const partialWalletResolution={...walletResolution,id:randomUUID(),orderId:partialWallet.id,sourceHash:partialView.sourceHash,conclusion:'partial' as const}
  await resolveRecoveryOrder(partialWalletResolution,actorId,{password});await resolveRecoveryOrder(partialWalletResolution,actorId,{password})
  assert.equal((await recoveryOrder(partialWallet.id)).status,'partial')
  assert.equal(Number((await prisma.user.findUniqueOrThrow({where:{id:customer.id}})).balance),3)
  assert.equal(Number((await prisma.balanceLog.aggregate({where:{orderId:partialWallet.id,type:'refund'},_sum:{amount:true}}))._sum.amount),6)
  assert.equal(await prisma.instance.count({where:{purchaseBatchId:partialWallet.id}}),1,'wallet missing line is not provisioned')
  console.log('PASS partial wallet: original debit, existing refund plus missing remainder, historical spent final balance and idempotence')
  await assert.rejects(evidence.registerRecoveryBusiness({...registration,id:randomUUID(),reference:'registration-two',user:{id:customer.id},order:{...registration.order,id:randomUUID()}},actorId,{password}),/RECEIPT_EXISTS/)
  const unpaid=await prisma.checkoutOrder.create({data:{id:randomUUID(),userId:customer.id,requestHash:'test',source:'direct',status:'recovery_review',totalCents:1000,snapshot:'test',display:[],expiresAt:new Date()}})
  const unpaidView=await recoveryOrder(unpaid.id)
  await resolveRecoveryOrder({...resolution,id:randomUUID(),orderId:unpaid.id,sourceHash:unpaidView.sourceHash,reference:'unpaid-final',conclusion:'unpaid',refunds:[]},actorId,{password})
  assert.equal((await recoveryOrder(unpaid.id)).status,'cancelled')
  const waiting=await prisma.checkoutOrder.create({data:{id:randomUUID(),userId:customer.id,requestHash:'before-snapshot-order',source:'direct',
    status:'recovery_review',totalCents:1000,snapshot:'unchanged-original-snapshot',display:[],expiresAt:new Date()}})
  const attempt=await prisma.checkoutPayment.create({data:{id:randomUUID(),orderId:waiting.id,providerId:provider.id,providerType:provider.type,
    providerName:provider.name,method:'alipay',payableCents:1100,feeCents:100,configSnapshot:'original-config-snapshot',details:{},status:'pending'}})
  const waitingView=await recoveryOrder(waiting.id)
  const latePayment={id:randomUUID(),reference:'missing-payment-proof',evidenceHash:'a'.repeat(64),observedAt:new Date().toISOString(),user:{id:customer.id},
    order:{id:waiting.id,providerId:provider.id,method:'alipay',tradeNo:'missing-purchase-payment',amountCents:1000,feeCents:100,
      receivedCurrency:'USDT',receivedAmount:'1.51',paidAt:new Date(Date.now()-500).toISOString(),expectedHash:waitingView.sourceHash}}
  await assert.rejects(evidence.registerRecoveryBusiness({...latePayment,order:{...latePayment.order,expectedHash:'0'.repeat(64)}},actorId,{password}),/EVIDENCE_STALE/)
  await assert.rejects(evidence.registerRecoveryBusiness({...latePayment,user:{id:original.id}},actorId,{password}),/ORDER_MISMATCH/)
  await evidence.registerRecoveryBusiness(latePayment,actorId,{password})
  assert.equal((await evidence.registerRecoveryBusiness(latePayment,actorId,{password})).replayed,true)
  const lateView=await recoveryOrder(waiting.id)
  assert.equal(lateView.receipts.length,1);assert.equal(lateView.receipts[0].amountCents,1100)
  assert.equal(lateView.refunds[0].amountCents,1100,'principal and fee remain owed for undelivered purchase')
  assert.equal(await prisma.checkoutPayment.count({where:{orderId:waiting.id}}),1,'reuse original payment attempt')
  assert.equal((await prisma.checkoutPayment.findUniqueOrThrow({where:{id:attempt.id}})).configSnapshot,'original-config-snapshot')
  assert.equal((await prisma.checkoutOrder.findUniqueOrThrow({where:{id:waiting.id}})).snapshot,'unchanged-original-snapshot')
  assert.equal(Number((await prisma.user.findUniqueOrThrow({where:{id:customer.id}})).balance),3,'external historical purchase never credits wallet')
  const {checkRecoveryInstance}=await import('./fixtures/recovery-instance.js')
  await checkRecoveryInstance(folder,holdId,actorId,account.userId,actorId,password)
  await assert.rejects(pgRecoveryTransaction(async query=>{await query('UPDATE users SET balance=999 WHERE id=$1',[old.id]);throw Error('rollback-test')}),/rollback-test/)
  assert.equal(Number((await prisma.user.findUniqueOrThrow({where:{id:old.id}})).balance),11)
  const resumeId=randomUUID()
  const before={hosts:[{id:host.id,pool_faulted:true,cpu_used:0,memory_used:0,disk_used:0,nat_ports_used_count:0}],operator:[]}
  const record={version:1 as const,taskId:resumeId,batchId:holdId,workerPid:2147483647,phase:'prepared' as const,
    hold:{taskId:holdId,batchId:holdId,mode:'restore',createdAt},before}
  await core.writeJson(activation.recoveryActivationPath(),record)
  await prisma.host.update({where:{id:host.id},data:{poolFaulted:false,cpuUsed:4}})
  await prisma.platformRecoveryBatch.update({where:{id:holdId},data:{completedAt:new Date()}})
  await assert.rejects(activation.recoverInterruptedActivation(),/STATE_INVALID/,'missing public result preserves the WAL')
  assert.ok(await core.readJson(activation.recoveryActivationPath()))
  await core.writeJson(core.statePath('results',`${resumeId}.json`),{id:resumeId,kind:'resume',status:'running',stage:'releasing'})
  await activation.recoverInterruptedActivation()
  assert.equal((await prisma.host.findUniqueOrThrow({where:{id:host.id}})).poolFaulted,true)
  assert.equal((await prisma.platformRecoveryBatch.findUniqueOrThrow({where:{id:holdId}})).completedAt,null)
  assert.ok(core.recoveryHeld(),'interrupted prepared activation returns to review')
  assert.equal(await core.readJson(activation.recoveryActivationPath()),null,'WAL is cleared after rollback receipt')
  await core.writeJson(activation.recoveryActivationPath(),{...record,before:{...before,hosts:[{...before.hosts[0],cpu_used:-1}]}})
  await assert.rejects(activation.recoverInterruptedActivation(),/STATE_INVALID/)
  await core.writeJson(activation.recoveryActivationPath(),{...record,hold:{...record.hold,createdAt:new Date().toISOString()}})
  await assert.rejects(activation.recoverInterruptedActivation(),/CONTEXT_CHANGED/)
  await core.writeJson(activation.recoveryActivationPath(),{...record,phase:'committed'})
  await assert.rejects(activation.recoverInterruptedActivation(),/CONTEXT_CHANGED/,'a committed WAL without DB commit cannot open business')
  await prisma.platformRecoveryBatch.update({where:{id:holdId},data:{completedAt:new Date()}})
  await prisma.host.update({where:{id:host.id},data:{poolFaulted:false,cpuUsed:8}})
  await activation.recoverInterruptedActivation()
  assert.equal(core.recoveryHeld(),false)
  assert.equal((await prisma.host.findUniqueOrThrow({where:{id:host.id}})).cpuUsed,8,'committed activation never overwrites live usage')
  await core.writeJson(join(folder,'recovery-hold.json'),{taskId:holdId,batchId:randomUUID(),mode:'restore',createdAt})
  await assert.rejects(activation.recoverInterruptedActivation(),/CONTEXT_CHANGED/,'old WAL must not remove a different batch hold')
  assert.ok(core.recoveryHeld())
  await assert.rejects(op.validateRecoverySession(login),/OPERATOR_REQUIRED/)
  await unlink(join(folder,'recovery-hold.json'))
  assert.equal(await op.validateRecoverySession(login),false,'recovery sessions never become ordinary admin sessions')
  console.log('Recovery state passed: 1001 hosts, persisted pagination, stale-source rejection, B operator identity, old-password refusal, logout, account correction and transaction rollback.')
} finally {await closePrismaDatabase();await rm(folder,{recursive:true,force:true})}
process.exit(0)
