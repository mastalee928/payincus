import assert from 'node:assert/strict'
import { Prisma } from '@prisma/client'
import { randomUUID, X509Certificate } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:https'
import { join } from 'node:path'
import ssh2 from 'ssh2'
import { prisma } from '../../src/db/prisma.js'
import { sshFingerprint } from '../../src/services/onboarding-ssh.js'
import { recoveryInstance, recordRecoveryInstance } from '../../src/services/platform-recovery-instance.js'
import { recoveryHostSourceHash, activeRecoveryBatch, unresolvedLegacyRecoveryOrders, recoveryReadiness, recoveryDatasetHash } from '../../src/services/platform-recovery-state.js'
import { reconcileIntactLegacyOrders, restoreLegacyPurchaseLinks } from '../../src/services/platform-recovery-legacy-order.js'
import { reconcileIntactCheckoutOrders } from '../../src/services/platform-recovery-orders.js'
import { dedicatedIpv6Address } from '../../src/lib/host-public-ipv6.js'
import { dedicatedIpv6NetworkDigest } from '../../src/lib/incus/dedicated-ipv6.js'

// Real local SSH and mTLS transports; the endpoints emulate only read-only
// identity replies. This is not an Incus or customer-network acceptance test.
export async function checkRecoveryInstance(folder:string,batchId:string,actorId:number,userId:number,originalUserId:number,password:string) {
  const certPath=join(folder,'instance.crt'),keyPath=join(folder,'instance.key')
  execFileSync(process.env.REVIEW_OPENSSL || (process.platform==='win32'?'C:/Program Files/Git/usr/bin/openssl.exe':'openssl'),
    ['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=recovery-test','-addext','subjectAltName=IP:127.0.0.1','-keyout',keyPath,'-out',certPath],
    {stdio:'pipe',windowsHide:true})
  const cert=await readFile(certPath,'utf8'),sshKey=ssh2.utils.generateKeyPairSync('rsa',{bits:2048})
  const parsed=ssh2.utils.parseKey(sshKey.private);assert.ok(!(parsed instanceof Error))
  const sshKeyPath=join(folder,'gateway-test.key');await writeFile(sshKeyPath,sshKey.private)
  const connections=new Set<import('ssh2').Connection>(),sockets=new Set<import('node:stream').Duplex>()
  let reads=0,probes=0,writes=0,hostId=0,mode='normal',fileBytes=0
  let restoredNetwork:{publicIp:string;privateIp:string;fallbackIp:string;gateway:string}|undefined
  const nodeId=randomUUID(),name='original-customer',uuid=randomUUID(),createdAt='2026-10-01T00:00:00.000Z'
  const nodeIds=new Set([nodeId])
  const guest={name,created_at:createdAt,status:'Running',type:'container',config:{'volatile.uuid':uuid,'user.payincus.user-id':String(originalUserId),
    'limits.cpu':'1','limits.cpu.allowance':'100%','limits.memory':'512MB'},expanded_devices:{root:{type:'disk',path:'/',pool:'customer',size:'1024MB'}}}
  const gateway=new ssh2.Server({hostKeys:[sshKey.private]},connection=>{
    connections.add(connection);connection.on('close',()=>connections.delete(connection))
    connection.on('authentication',ctx=>ctx.method==='publickey' ? ctx.accept() : ctx.reject())
    connection.on('ready',()=>connection.on('session',accept=>{
      const session=accept();session.on('exec',(accept,_reject,info)=>{
        const stream=accept();let input='';stream.on('data',(chunk:Buffer)=>{input+=chunk.toString()})
        stream.on('end',()=>{
          assert.ok(nodeIds.has(info.command.replace(/^probe /,'')));const proof=JSON.parse(input)
          assert.equal(proof.sshFingerprint,'SHA256:registered-node');assert.equal(proof.nodePublicKey,'A'.repeat(43)+'=')
          probes++;stream.write(JSON.stringify({nodeId:info.command.slice(6),sshIdentityVerified:true,keysAndRoutesPreserved:true}));stream.exit(0);stream.end()
        })
      })
    }))
  })
  const remote=createServer({key:await readFile(keyPath),cert,ca:cert,requestCert:true,rejectUnauthorized:true},async(req,res)=>{
    try {
      assert.ok((req.socket as import('node:tls').TLSSocket).authorized)
      if(req.method!=='GET')writes++
      assert.equal(req.method,'GET');reads++
      res.setHeader('content-type','application/json')
      if(req.url==='/1.0/instances/size-test/files?path=/recovery-size-test') {
        res.setHeader('content-type','application/octet-stream');res.end(Buffer.alloc(fileBytes,65));return
      }
      if(req.url?.startsWith(`/1.0/instances/${name}/files?`)) {
        const path=new URL(req.url,'https://fixture.test').searchParams.get('path')
        assert.ok(restoredNetwork)
        assert.ok(['/etc/payincus/ipv6/gateway','/etc/payincus/ipv6/addresses'].includes(path!))
        res.setHeader('content-type','application/octet-stream')
        return void res.end(path!.endsWith('/gateway')?restoredNetwork.gateway+'\n':restoredNetwork.privateIp+'\n'+restoredNetwork.fallbackIp+'\n')
      }
      if(req.url==='/1.0')return void res.end(JSON.stringify({type:'sync',metadata:{api_version:'1.0'}}))
      if(req.url==='/1.0/networks/incusbr0/forwards?recursion=1') return void res.end(JSON.stringify({type:'sync',metadata:[{
        listen_address:'192.0.2.200',description:`payincus-dedicated:${name}`,config:{target_address:'10.0.0.5'},ports:[] },
        ...(restoredNetwork?[{listen_address:restoredNetwork.publicIp,description:`payincus-dedicated:${name}`,config:{target_address:restoredNetwork.fallbackIp},
          ports:['tcp','udp'].map(protocol=>({protocol,listen_port:'1-65535',target_address:restoredNetwork!.privateIp,snat:true}))}]:[])]}))
      if(req.url==='/1.0/networks/incusbr0')return void res.end(JSON.stringify({type:'sync',metadata:{config:{'ipv6.address':restoredNetwork!.gateway+'/64','ipv6.nat':'true',
        'user.payincus.ipv6.ready':dedicatedIpv6NetworkDigest([{...restoredNetwork!,ready:true}])}}}))
      if(req.url===`/1.0/instances/${name}/state?project=default`)return void res.end(JSON.stringify({type:'sync',metadata:{network:{eth0:{addresses:
        [restoredNetwork!.privateIp,restoredNetwork!.fallbackIp].map(address=>({address}))}}}}))
      assert.equal(req.url,`/1.0/instances/${name}?project=default`)
      if(mode==='database-change')await prisma.host.update({where:{id:hostId},data:{name:'host-changed-during-read'}})
      const live=structuredClone(guest)
      if(mode==='uuid-change')live.config['volatile.uuid']=randomUUID()
      if(mode==='owner-change')live.config['user.payincus.user-id']=String(originalUserId+1)
      if(mode==='resource-change')live.config['limits.memory']='1024MB'
      res.end(JSON.stringify({type:'sync',metadata:live}))
    }catch(error){res.statusCode=500;res.end(JSON.stringify({type:'error',error:String(error)}))}
  })
  remote.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket))})
  const saved=Object.fromEntries(['ONBOARDING_GATEWAY_HOST','ONBOARDING_GATEWAY_PORT','ONBOARDING_GATEWAY_KEY_PATH','ONBOARDING_GATEWAY_FINGERPRINT','ONBOARDING_WG_ENDPOINT'].map(key=>[key,process.env[key]]))
  try {
    await new Promise<void>(done=>gateway.listen(0,'127.0.0.1',done));await new Promise<void>(done=>remote.listen(0,'127.0.0.1',done))
    process.env.ONBOARDING_GATEWAY_HOST='127.0.0.1';process.env.ONBOARDING_GATEWAY_PORT=String((gateway.address() as {port:number}).port)
    process.env.ONBOARDING_GATEWAY_KEY_PATH=sshKeyPath;process.env.ONBOARDING_GATEWAY_FINGERPRINT=sshFingerprint(parsed.getPublicSSH());process.env.ONBOARDING_WG_ENDPOINT='gateway.example.test:51820'
    const host=await prisma.host.create({data:{userId:actorId,name:'identity-test',url:`https://127.0.0.1:${(remote.address() as {port:number}).port}`,
      managementSshHost:'127.0.0.1',managementSshPort:22,certPath,keyPath,serverCertificate:cert,serverFingerprint:new X509Certificate(cert).fingerprint256,
      poolFaulted:false,singleTenant:true,cpuAllowanceMax:100,memoryMax:512,customerDiskGiB:1}})
    hostId=host.id
    const {IncusClient}=await import('../../src/lib/incus/incus-client.js')
    const reader=new IncusClient(host)
    try {
      await reader.connect();fileBytes=32768
      assert.equal((await reader.readFile('/1.0/instances/size-test/files?path=/recovery-size-test',AbortSignal.timeout(3000),32768)).content.length,32768)
      fileBytes=32769
      await assert.rejects(reader.readFile('/1.0/instances/size-test/files?path=/recovery-size-test',AbortSignal.timeout(3000),32768),/INCUS_FILE_TOO_LARGE/)
    }finally{await reader.close()}
    const onboarding=await prisma.hostOnboardingBatch.create({data:{id:randomUUID(),createdById:actorId,name:'Recovery transport test',accountLabel:'test',defaults:{}}})
    await prisma.hostOnboardingNode.create({data:{id:nodeId,batchId:onboarding.id,hostId,name:'identity-test',publicIp:'192.0.2.200',managementIp:'127.0.0.1',
      sshPort:22,sshFingerprint:'SHA256:registered-node',nodePublicKey:'A'.repeat(43)+'=',status:'succeeded',credentialsExpireAt:new Date()}})
    const instance=await prisma.instance.create({data:{userId,hostId,incusId:name,name,status:'stopped',image:'fixture',cpu:100,memory:512,disk:1024,storagePoolName:'customer'}})
    await prisma.host.update({where:{id:hostId},data:{poolFaulted:true}})
    await prisma.platformRecoveryHost.create({data:{batchId,hostId,status:'blocked',attempts:8}})
    const input={id:randomUUID(),instanceId:instance.id,sourceHash:await recoveryHostSourceHash(hostId),reference:'original-delivery-document',evidenceHash:'b'.repeat(64),
      observedAt:new Date().toISOString(),uuid,createdAt,status:'running' as const}
    await recordRecoveryInstance(input,actorId,{password})
    assert.equal((await recordRecoveryInstance(input,actorId,{password})).replayed,true)
    const view=await recoveryInstance(instance.id);assert.equal(view.uuid,uuid);assert.equal(view.status,'running')
    assert.equal((await prisma.platformRecoveryHost.findUniqueOrThrow({where:{batchId_hostId:{batchId,hostId}}})).status,'pending')
    assert.equal((await prisma.host.findUniqueOrThrow({where:{id:hostId}})).poolFaulted,true,'identity evidence alone never releases inventory')
    const again={...input,id:randomUUID(),reference:'second-document',sourceHash:view.sourceHash}
    const before=reads
    await assert.rejects(recordRecoveryInstance({...again,uuid:randomUUID()},actorId,{password}),/IDENTITY_CHANGED/)
    assert.equal(reads,before,'conflicting original identity rejected before transport')
    for(const change of ['uuid-change','owner-change','database-change']) {
      mode=change
      await assert.rejects(recordRecoveryInstance({...again,id:randomUUID()},actorId,{password}),change==='database-change'?/EVIDENCE_STALE/:/IDENTITY_CHANGED/)
    }
    assert.equal(await prisma.platformRecoveryEvidence.count({where:{batchId,category:'instance-identity'}}),1)
    // Simulate a post-snapshot delivery absent from the restored database.
    // The remote guest remains unchanged; no delete/create is sent to it.
    mode='normal';await prisma.instance.delete({where:{id:instance.id}})
    await prisma.host.update({where:{id:hostId},data:{natBindIp:'192.0.2.200'}})
    const pkg=await prisma.package.create({data:{userId:actorId,name:'recovery-test',cpuMax:100,memoryMax:512,diskMax:1024}})
    const plan=await prisma.packagePlan.create({data:{packageId:pkg.id,name:'recovery-test',price:1000,cpu:100,memory:512,disk:1024,
      portLimit:0,snapshotLimit:0,backupLimit:0,siteLimit:0,trafficLimit:0}})
    const provider=await prisma.paymentProvider.create({data:{name:'transport-test',type:'yipay',config:{},methods:['alipay']}})
    guest.created_at=new Date(Date.now()-5000).toISOString()
    const {registerRecoveryBusiness}=await import('../../src/services/platform-recovery-evidence.js')
    const purchase={id:randomUUID(),reference:'transport-purchase-proof',evidenceHash:'c'.repeat(64),observedAt:new Date().toISOString(),user:{id:userId},
      order:{id:randomUUID(),providerId:provider.id,method:'alipay',tradeNo:'transport-purchase',quantity:1,amountCents:1000,receivedCurrency:'CNY',receivedAmount:'10.00',paidAt:guest.created_at},
      instance:{originalId:instance.id,hostId,name,uuid,createdAt:guest.created_at,image:'fixture',cpu:100,memory:512,disk:1024,storagePoolName:'customer',ipv4:'10.0.0.5',
        expiresAt:new Date(Date.now()+86400000).toISOString(),packageId:pkg.id,packagePlanId:plan.id,billingPrice:'10.00',billingCycle:1}}
    await assert.rejects(prisma.instance.create({data:{userId,hostId,incusId:'unapproved',name:'unapproved',status:'running',image:'fixture',cpu:100,memory:512,disk:1024}}),/HOST_POOL_FAULTED/)
    const beforeRejectedHost={reads,probes,writes}
    await prisma.host.update({where:{id:hostId},data:{singleTenant:false}})
    await assert.rejects(registerRecoveryBusiness(purchase,actorId,{password}),/DEDICATED_HOST_REQUIRED/)
    await prisma.host.update({where:{id:hostId},data:{singleTenant:true}})
    await assert.rejects(registerRecoveryBusiness({...purchase,instance:{...purchase.instance,sharedNetwork:{mode:'nat'}}} as any,actorId,{password}),/EVIDENCE_INVALID/)
    assert.deepEqual({reads,probes,writes},beforeRejectedHost,'unsupported host/input is rejected before remote IO')
    assert.equal(await prisma.checkoutOrder.count({where:{id:purchase.order.id}}),0,'rejected registration cannot insert payment or delivery records')
    mode='resource-change'
    await assert.rejects(registerRecoveryBusiness(purchase,actorId,{password}),/RESOURCE_MISMATCH/)
    mode='normal'
    // First recover only the historical receipt, then attach the missing guest
    // without inserting a second receipt or retaining an undelivered obligation.
    const {instance:missing,...receiptOnly}=purchase
    await registerRecoveryBusiness({...receiptOnly,id:randomUUID(),reference:'receipt-before-guest'},actorId,{password})
    const {recoveryOrder,resolveRecoveryOrder}=await import('../../src/services/platform-recovery-orders.js')
    const paidBefore=await recoveryOrder(purchase.order.id)
    assert.equal(paidBefore.receipts.length,1);assert.equal(paidBefore.refunds.length,1)
    const complete={...purchase,order:{...purchase.order,expectedHash:paidBefore.sourceHash}}
    const publicIp='2603:c020:802a:cc00::1',gatewayIp='fd42:1:2:3::1'
    restoredNetwork={publicIp,gateway:gatewayIp,privateIp:dedicatedIpv6Address(gatewayIp,instance.id,publicIp),fallbackIp:dedicatedIpv6Address(gatewayIp,instance.id,`${publicIp}:other-protocols`)}
    await prisma.package.update({where:{id:pkg.id},data:{instanceType:'vm'}})
    await assert.rejects(registerRecoveryBusiness(complete,actorId,{password}),/RESOURCE_MISMATCH/)
    assert.equal(await prisma.instance.count({where:{purchaseBatchId:purchase.order.id}}),0,'wrong package type rolls back registration')
    await prisma.package.update({where:{id:pkg.id},data:{instanceType:'container'}})
    const registered=await registerRecoveryBusiness(complete,actorId,{password})
    assert.ok(registered.instanceId)
    assert.equal(registered.instanceId,instance.id,'recovery retains the original ID used by customer network identity')
    const recoveredIpv6=(await prisma.instance.findUniqueOrThrow({where:{id:instance.id}})).dedicatedIpv6 as any
    assert.equal(recoveredIpv6.mappings[0].privateIp,restoredNetwork.privateIp,'original IPv6 mapping is discovered and registered without rewriting the guest')
    assert.equal(recoveredIpv6.mappings[0].ready,false,'registration does not invent egress evidence')
    restoredNetwork=undefined
    assert.equal((await registerRecoveryBusiness(complete,actorId,{password})).replayed,true)
    assert.equal((await recoveryOrder(purchase.order.id)).receipts.length,1)
    assert.equal((await recoveryOrder(purchase.order.id)).refunds.length,0)
    assert.equal((await prisma.host.findUniqueOrThrow({where:{id:hostId}})).poolFaulted,true)
    assert.equal(await prisma.instanceBillingRecord.count({where:{purchaseBatchId:purchase.order.id,type:'newPurchase'}}),1)
    const networkHash=await recoveryHostSourceHash(hostId)
    const port=await prisma.portMapping.create({data:{hostId,instanceId:registered.instanceId!,protocol:'tcp',publicPort:2200,privatePort:22}})
    assert.notEqual(await recoveryHostSourceHash(hostId),networkHash,'port changes invalidate host evidence')
    await prisma.portMapping.delete({where:{id:port.id}})
    const planHash=await recoveryHostSourceHash(hostId)
    await prisma.package.update({where:{id:pkg.id},data:{instanceType:'vm'}})
    assert.notEqual(await recoveryHostSourceHash(hostId),planHash,'package type changes invalidate host evidence')
    await prisma.package.update({where:{id:pkg.id},data:{instanceType:'container'}})
    const payment=await prisma.checkoutPayment.findFirstOrThrow({where:{orderId:purchase.order.id},include:{receipts:true}})
    const refund=await prisma.checkoutRefund.create({data:{id:randomUUID(),orderId:purchase.order.id,paymentId:payment.id,receiptId:payment.receipts[0].id,
      instanceId:registered.instanceId!,amountCents:400,principalCents:400,reason:'partial-historical-refund',status:'pending'}})
    await prisma.platformRecoveryHost.update({where:{batchId_hostId:{batchId,hostId}},data:{status:'success',sourceHash:await recoveryHostSourceHash(hostId),checkedAt:new Date()}})
    const paidView=await recoveryOrder(purchase.order.id)
    const resolution={id:randomUUID(),orderId:paidView.id,sourceHash:paidView.sourceHash,reference:'refund-with-original-guest',evidenceHash:'d'.repeat(64),
      observedAt:new Date().toISOString(),conclusion:'delivered' as const,refunds:[{id:refund.id,reference:'actual-partial-refund'}]}
    await resolveRecoveryOrder(resolution,actorId,{password});await resolveRecoveryOrder(resolution,actorId,{password})
    const refundSaved=await prisma.checkoutRefund.findUniqueOrThrow({where:{id:refund.id}})
    assert.ok(refundSaved.billingRecordId)
    assert.equal(Number((await prisma.instanceBillingRecord.findUniqueOrThrow({where:{id:refundSaved.billingRecordId!}})).amount),-4)
    assert.equal(await prisma.instanceBillingRecord.count({where:{purchaseBatchId:purchase.order.id,type:'refund'}}),1,'one negative bill despite lost response')
    const moreHosts=[]
    for(let i=0;i<2;i++) {
      const next=await prisma.host.create({data:{userId:actorId,name:`multi-recovery-${i}`,url:host.url,managementSshHost:'127.0.0.1',managementSshPort:22,
        certPath,keyPath,serverCertificate:cert,serverFingerprint:host.serverFingerprint,poolFaulted:true,singleTenant:true,
        cpuAllowanceMax:100,memoryMax:512,customerDiskGiB:1,natBindIp:'192.0.2.200'}})
      const id=randomUUID();nodeIds.add(id)
      await prisma.hostOnboardingNode.create({data:{id,batchId:onboarding.id,hostId:next.id,name:next.name,publicIp:`192.0.2.${210+i}`,managementIp:'127.0.0.1',
        sshPort:22,sshFingerprint:'SHA256:registered-node',nodePublicKey:'A'.repeat(43)+'=',status:'succeeded',credentialsExpireAt:new Date()}})
      await prisma.platformRecoveryHost.create({data:{batchId,hostId:next.id,status:'pending'}})
      moreHosts.push(next)
    }
    const multi={...purchase,id:randomUUID(),reference:'multi-original-delivery',order:{...purchase.order,id:randomUUID(),tradeNo:'multi-transport',quantity:2,
      amountCents:1500,receivedAmount:'15.00'},instance:{...purchase.instance,originalId:instance.id+100000,hostId:moreHosts[0].id,principalCents:600}}
    await assert.rejects(registerRecoveryBusiness({...multi,instance:{...multi.instance,principalCents:1500}},actorId,{password}),/PRINCIPAL_MISMATCH/)
    await assert.rejects(registerRecoveryBusiness({...multi,instance:{...multi.instance,originalId:instance.id}},actorId,{password}),/INSTANCE_ID_OCCUPIED/)
    assert.equal(await prisma.checkoutOrder.count({where:{id:multi.order.id}}),0,'rejected registration rolls back payment and order')
    const {serializeBackupMutation}=await import('../../src/services/platform-backup-core.js')
    const pair=await Promise.all([0,1].map(()=>serializeBackupMutation(()=>registerRecoveryBusiness(multi,actorId,{password}))))
    assert.equal(pair.filter(result=>result.replayed).length,1,'concurrent requests obey the actual route serialization and record one guest')
    const firstView=await recoveryOrder(multi.order.id)
    assert.equal(firstView.instances.length,1);assert.equal(firstView.quantity,2)
    await assert.rejects(resolveRecoveryOrder({...resolution,id:randomUUID(),orderId:multi.order.id,sourceHash:firstView.sourceHash,refunds:[]},actorId,{password}),/QUANTITY_MISMATCH/)
    const primary=await prisma.checkoutPayment.findFirstOrThrow({where:{orderId:multi.order.id},include:{receipts:true}})
    const companionOrder=await prisma.checkoutOrder.findUniqueOrThrow({where:{id:multi.order.id}})
    await prisma.poolOrder.create({data:{id:companionOrder.id,userId:companionOrder.userId,requestHash:companionOrder.requestHash,totalCents:companionOrder.totalCents}})
    const recipient=await prisma.user.create({data:{username:'restored-transfer-recipient',passwordHash:'unusable-fixture-hash'}})
    const transferredGuest=await prisma.instance.findUniqueOrThrow({where:{id:multi.instance.originalId}})
    const transfer=await prisma.instanceTransfer.create({data:{instanceId:transferredGuest.id,fromUserId:userId,toUserId:recipient.id,
      status:'processing',snapshot:{fixture:true},cleanupState:{stage:'finalize',sourceOwnerId:userId,targetOwnerId:recipient.id,hostId:transferredGuest.hostId,
        remoteUuid:(transferredGuest.snapshottedSpecs as any).recoveryIdentity.uuid,oldIncusId:transferredGuest.incusId,newIncusId:transferredGuest.incusId}}})
    const actualRefund=await prisma.checkoutRefund.create({data:{id:randomUUID(),orderId:multi.order.id,paymentId:primary.id,receiptId:primary.receipts[0].id,
      instanceId:multi.instance.originalId,amountCents:100,principalCents:100,reason:'original-partial-refund',status:'pending'}})
    const second={...multi,id:randomUUID(),order:{...multi.order,expectedHash:(await recoveryOrder(multi.order.id)).sourceHash},
      instance:{...multi.instance,hostId:moreHosts[1].id,originalId:multi.instance.originalId+1,principalCents:900}}
    await assert.rejects(registerRecoveryBusiness({...second,order:{...second.order,quantity:1}},actorId,{password}),/QUANTITY_MISMATCH/)
    await assert.rejects(registerRecoveryBusiness({...second,instance:{...second.instance,principalCents:899}},actorId,{password}),/PRINCIPAL_MISMATCH/)
    await assert.rejects(registerRecoveryBusiness(second,actorId,{password}),/TRANSFER_PENDING/)
    await prisma.instanceTransfer.update({where:{id:transfer.id},data:{status:'accepted',acceptedAt:new Date()}})
    await prisma.instance.update({where:{id:transferredGuest.id},data:{userId:recipient.id}})
    await assert.rejects(registerRecoveryBusiness(second,actorId,{password}),/EVIDENCE_STALE/)
    const transferredSecond={...second,order:{...second.order,expectedHash:(await recoveryOrder(multi.order.id)).sourceHash}}
    await prisma.poolOrder.update({where:{id:multi.order.id},data:{totalCents:1499}})
    await assert.rejects(registerRecoveryBusiness(transferredSecond,actorId,{password}),/ORDER_EXISTS/)
    await prisma.poolOrder.update({where:{id:multi.order.id},data:{totalCents:1500}})
    await registerRecoveryBusiness(transferredSecond,actorId,{password})
    assert.equal((await prisma.instance.findUniqueOrThrow({where:{id:transferredGuest.id}})).userId,recipient.id)
    const full=await recoveryOrder(multi.order.id)
    assert.equal(full.instances.length,2);assert.equal(full.receipts.length,1);assert.equal(full.refunds[0].id,actualRefund.id)
    for(const next of moreHosts)await prisma.platformRecoveryHost.update({where:{batchId_hostId:{batchId,hostId:next.id}},
      data:{status:'success',sourceHash:await recoveryHostSourceHash(next.id),checkedAt:new Date()}})
    await resolveRecoveryOrder({...resolution,id:randomUUID(),orderId:multi.order.id,sourceHash:(await recoveryOrder(multi.order.id)).sourceHash,observedAt:new Date().toISOString(),
      refunds:[{id:actualRefund.id,reference:'multi-original-refund'}]},actorId,{password})
    const multiBills=await prisma.instanceBillingRecord.findMany({where:{purchaseBatchId:multi.order.id,type:'newPurchase'},orderBy:{instanceId:'asc'}})
    assert.deepEqual(multiBills.map(row=>Number(row.amount)),[6,9])
    assert.equal((await prisma.checkoutOrder.findUniqueOrThrow({where:{id:multi.order.id}})).status,'completed')
    console.log('PASS multi-guest recovery: partial count blocked, per-guest principal, exact final total, ID collision, concurrent replay and retained original refund')
    // A second provider payment must be visible as a refund obligation even
    // while original guests remain delivered; it must never enter the wallet.
    const duplicatePayment=await prisma.checkoutPayment.create({data:{id:randomUUID(),orderId:multi.order.id,providerId:primary.providerId,
      providerType:primary.providerType,providerName:primary.providerName,method:'wxpay',payableCents:1520,feeCents:20,
      configSnapshot:primary.configSnapshot,details:{fixture:true},status:'paid'}})
    const duplicateReceipt=await prisma.checkoutReceipt.create({data:{id:randomUUID(),paymentId:duplicatePayment.id,providerId:primary.providerId,
      tradeNo:'duplicate-original-channel',amountCents:1520,currency:'CNY',proof:{fixture:true}}})
    const duplicateView=await recoveryOrder(multi.order.id)
    const duplicateOwed=duplicateView.refunds.find(row=>row.receiptId===duplicateReceipt.id)!
    assert.equal(duplicateOwed.amountCents,1520);assert.equal(duplicateOwed.status,'unrecorded')
    const duplicateResolution={...resolution,id:randomUUID(),orderId:multi.order.id,sourceHash:duplicateView.sourceHash,observedAt:new Date().toISOString(),
      refunds:[{id:duplicateOwed.id,reference:'actual-duplicate-payment-return'}]}
    await assert.rejects(resolveRecoveryOrder({...duplicateResolution,refunds:[]},actorId,{password}),/REFUND_UNREVIEWED/)
    const oldCheck=new Date(Date.now()-25*3600000)
    await prisma.platformRecoveryHost.update({where:{batchId_hostId:{batchId,hostId:moreHosts[0].id}},data:{checkedAt:oldCheck}})
    await assert.rejects(resolveRecoveryOrder(duplicateResolution,actorId,{password}),/DELIVERY_UNVERIFIED/)
    assert.equal(await prisma.checkoutRefund.count({where:{receiptId:duplicateReceipt.id}}),0,'expired host check rolls back a new refund')
    await prisma.platformRecoveryHost.update({where:{batchId_hostId:{batchId,hostId:moreHosts[0].id}},data:{checkedAt:new Date()}})
    // Already acknowledged refunds can recover a missing bill from their own
    // recorded reference without asking the operator to enter it a second time.
    const originalRefund=await prisma.checkoutRefund.findUniqueOrThrow({where:{id:actualRefund.id}})
    assert.ok(originalRefund.billingRecordId)
    await prisma.checkoutRefund.update({where:{id:actualRefund.id},data:{billingRecordId:null}})
    await prisma.instanceBillingRecord.delete({where:{id:originalRefund.billingRecordId!}})
    await resolveRecoveryOrder({...duplicateResolution,sourceHash:(await recoveryOrder(multi.order.id)).sourceHash},actorId,{password})
    assert.equal((await prisma.checkoutRefund.findUniqueOrThrow({where:{id:duplicateOwed.id}})).principalCents,0)
    assert.equal(await prisma.instanceBillingRecord.count({where:{purchaseBatchId:multi.order.id,type:'refund'}}),1)
    assert.ok((await prisma.checkoutRefund.findUniqueOrThrow({where:{id:actualRefund.id}})).billingRecordId)
    console.log('PASS duplicate receipt recovery: visible obligation, required original refund, expired host rollback and existing receipt repairs a missing bill')
    await prisma.instanceTransfer.update({where:{id:transfer.id},data:{status:'processing'}})
    const ownershipResolution={...resolution,id:randomUUID(),orderId:multi.order.id,sourceHash:(await recoveryOrder(multi.order.id)).sourceHash,observedAt:new Date().toISOString(),refunds:[]}
    await assert.rejects(resolveRecoveryOrder(ownershipResolution,actorId,{password}),/TRANSFER_PENDING/)
    await prisma.instanceTransfer.update({where:{id:transfer.id},data:{status:'accepted',acceptedAt:new Date()}})
    await prisma.instance.update({where:{id:transferredGuest.id},data:{userId:recipient.id}})
    await assert.rejects(resolveRecoveryOrder(ownershipResolution,actorId,{password}),/EVIDENCE_STALE/)
    await prisma.platformRecoveryHost.update({where:{batchId_hostId:{batchId,hostId:transferredGuest.hostId}},data:{sourceHash:await recoveryHostSourceHash(transferredGuest.hostId),checkedAt:new Date()}})
    await resolveRecoveryOrder({...ownershipResolution,sourceHash:(await recoveryOrder(multi.order.id)).sourceHash},actorId,{password})
    assert.equal((await prisma.instance.findUniqueOrThrow({where:{id:transferredGuest.id}})).userId,recipient.id)
    assert.equal((await prisma.checkoutOrder.findUniqueOrThrow({where:{id:multi.order.id}})).userId,userId,'purchase and refund source remain the original payer')
    console.log('PASS recovery transfer: pending blocked, stale receipt rejected, accepted original UUID chain retains recipient and original payer')
    // A third line was never delivered. Its original invoice and refund evidence
    // close the order without provisioning the absent guest or crediting a wallet.
    await prisma.checkoutOrder.update({where:{id:multi.order.id},data:{totalCents:2400,display:[{quantity:3}],status:'recovery_review'}})
    await prisma.checkoutPayment.update({where:{id:actualRefund.paymentId},data:{payableCents:2400}})
    await prisma.checkoutReceipt.update({where:{id:actualRefund.receiptId},data:{amountCents:2400}})
    const incomplete=await recoveryOrder(multi.order.id)
    assert.equal(incomplete.partialAvailable,true)
    const owed=incomplete.partialRefunds.filter(row=>row.status!=='refunded')
    assert.deepEqual(owed.map(row=>row.amountCents),[900])
    const beforeBalance=(await prisma.user.findUniqueOrThrow({where:{id:userId}})).balance.toString()
    const partialResolution={...resolution,id:randomUUID(),orderId:multi.order.id,sourceHash:incomplete.sourceHash,observedAt:new Date().toISOString(),conclusion:'partial' as const,
      refunds:owed.map(row=>({id:row.id,reference:'original-missing-line-refund'}))}
    await assert.rejects(resolveRecoveryOrder({...partialResolution,refunds:[]},actorId,{password}),/REFUND_UNREVIEWED/)
    await resolveRecoveryOrder(partialResolution,actorId,{password});await resolveRecoveryOrder(partialResolution,actorId,{password})
    assert.equal((await recoveryOrder(multi.order.id)).status,'partial')
    assert.equal(await prisma.instance.count({where:{purchaseBatchId:multi.order.id}}),2)
    assert.equal((await prisma.user.findUniqueOrThrow({where:{id:userId}})).balance.toString(),beforeBalance)
    const secondGuest=await prisma.instance.findFirstOrThrow({where:{purchaseBatchId:multi.order.id,hostId:moreHosts[1].id}})
    await prisma.instance.update({where:{id:secondGuest.id},data:{status:'deleted',deletionBillingPending:true}})
    assert.equal((await recoveryOrder(multi.order.id)).partialUnavailableCode,'OSS_RECOVERY_DELETION_CAUSE_REQUIRED')
    await assert.rejects(resolveRecoveryOrder({...partialResolution,id:randomUUID(),sourceHash:(await recoveryOrder(multi.order.id)).sourceHash},actorId,{password}),/DELETION_CAUSE_REQUIRED/)
    await prisma.instance.update({where:{id:secondGuest.id},data:{snapshottedSpecs:{...(secondGuest.snapshottedSpecs as object),poolProvision:{version:1,phase:'failed'}}}})
    const deletedView=await recoveryOrder(multi.order.id)
    const deletedResolution={...partialResolution,id:randomUUID(),sourceHash:deletedView.sourceHash,observedAt:new Date().toISOString(),
      refunds:deletedView.partialRefunds.filter(row=>row.status!=='refunded').map(row=>({id:row.id,reference:'original-deleted-line-refund'}))}
    assert.deepEqual(deletedView.partialRefunds.filter(row=>row.status!=='refunded').map(row=>row.amountCents),[900])
    await assert.rejects(resolveRecoveryOrder(deletedResolution,actorId,{password}),/DELIVERY_UNVERIFIED/)
    assert.equal(await prisma.checkoutRefund.count({where:{id:deletedResolution.refunds[0].id}}),0,'unverified cleanup rolls back refund registration')
    await prisma.instance.update({where:{id:secondGuest.id},data:{deletionBillingPending:false}})
    await assert.rejects(resolveRecoveryOrder({...deletedResolution,sourceHash:(await recoveryOrder(multi.order.id)).sourceHash},actorId,{password}),/DELIVERY_UNVERIFIED/)
    await prisma.platformRecoveryHost.update({where:{batchId_hostId:{batchId,hostId:secondGuest.hostId}},data:{status:'success',sourceHash:await recoveryHostSourceHash(secondGuest.hostId),checkedAt:new Date()}})
    await resolveRecoveryOrder({...deletedResolution,sourceHash:(await recoveryOrder(multi.order.id)).sourceHash},actorId,{password})
    assert.equal(Number((await prisma.instanceBillingRecord.findFirstOrThrow({where:{instanceId:secondGuest.id,type:'refund'}})).amount),-9)
    console.log('PASS partial external orders: missing and deleted lines, exact original principal, required refund evidence, pending cleanup/stale host rollback and no wallet credit')
    const walletId=randomUUID(),walletPaidAt=new Date(Date.now()-10000)
    await prisma.checkoutOrder.create({data:{id:walletId,userId,requestHash:'transferred-wallet',source:'direct',status:'recovery_review',totalCents:1500,
      snapshot:'isolated-wallet',display:[{quantity:3}],paidAt:walletPaidAt,paymentId:'balance',expiresAt:new Date()}})
    const donorHost=await prisma.host.create({data:{userId:actorId,name:'wallet-recovery-only',url:'https://192.0.2.80:8443',singleTenant:false}})
    const walletGuests=[]
    for(const [index,owner] of [userId,recipient.id].entries()){
      const item=await prisma.instance.create({data:{userId:owner,hostId:donorHost.id,name:`wallet-original-${index}`,incusId:`wallet-original-${index}`,
        status:index?'deleted':'running',cpu:100,memory:512,disk:1024,image:'fixture',purchaseBatchId:walletId,snapshottedSpecs:{recoveryIdentity:{uuid}}}})
      walletGuests.push(item)
      await prisma.instanceBillingRecord.create({data:{userId,instanceId:item.id,type:'newPurchase',amount:index?6:4,months:1,
        purchaseBatchId:walletId,createdAt:walletPaidAt,periodStart:walletPaidAt,periodEnd:new Date(Date.now()+86400000)}})
    }
    await prisma.instanceTransfer.create({data:{instanceId:walletGuests[1].id,fromUserId:userId,toUserId:recipient.id,status:'accepted',
      acceptedAt:new Date(Date.now()-5000),snapshot:{fixture:true},cleanupState:{stage:'finalize',sourceOwnerId:userId,targetOwnerId:recipient.id,hostId:donorHost.id,
        remoteUuid:uuid,oldIncusId:walletGuests[1].incusId,newIncusId:walletGuests[1].incusId}}})
    await prisma.balanceLog.create({data:{userId,orderId:walletId,type:'consume',amount:-15,balanceBefore:15,balanceAfter:0}})
    const renewalDebit=await prisma.balanceLog.create({data:{userId:recipient.id,instanceId:walletGuests[1].id,type:'consume',amount:-3,balanceBefore:3,balanceAfter:0}})
    const renewalBill=await prisma.instanceBillingRecord.create({data:{userId:recipient.id,instanceId:walletGuests[1].id,type:'renew',amount:3,months:1,
      balanceLogId:renewalDebit.id,createdAt:new Date(Date.now()-3000),periodStart:walletPaidAt,periodEnd:new Date(Date.now()+86400000)}})
    const originalRefundLog=await prisma.balanceLog.create({data:{userId:recipient.id,instanceId:walletGuests[1].id,type:'refund',amount:8,balanceBefore:0,balanceAfter:8}})
    const settledWalletBill=await prisma.instanceBillingRecord.create({data:{userId:recipient.id,instanceId:walletGuests[1].id,type:'refund',amount:-8,months:0,
      purchaseBatchId:null,balanceLogId:originalRefundLog.id,createdAt:new Date(Date.now()-1000),periodStart:walletPaidAt,periodEnd:new Date(Date.now()+86400000)}})
    const recipientDeletion={version:1,revision:randomUUID(),actor:{id:actorId},mode:'admin',refund:true,adminRefundType:'remaining',
      ownerId:recipient.id,hostId:donorHost.id,name:walletGuests[1].incusId,hostIdentity:'isolated-original-host',instanceVersion:walletGuests[1].version,
      requestedAt:new Date(Date.now()-2000).toISOString(),status:'done',attempts:1,sites:[],refundAmount:8,refundPending:false,refundBillingRecordId:settledWalletBill.id}
    await prisma.instance.update({where:{id:walletGuests[1].id},data:{deletionIntent:recipientDeletion}})
    await prisma.platformRecoveryHost.create({data:{batchId,hostId:donorHost.id,status:'success',sourceHash:await recoveryHostSourceHash(donorHost.id),checkedAt:new Date()}})
    const walletView=await recoveryOrder(walletId)
    assert.equal(walletView.walletAccounts.length,2)
    const walletResolution={...resolution,id:randomUUID(),orderId:walletId,sourceHash:walletView.sourceHash,observedAt:new Date().toISOString(),
      conclusion:'partial' as const,refunds:[],walletTargets:[{userId,balance:'3.00'},{userId:recipient.id,balance:'1.00'}]}
    await assert.rejects(resolveRecoveryOrder({...walletResolution,walletTargets:undefined,walletBalance:'3.00'},actorId,{password}),/TRANSFER_BALANCE_REQUIRED/)
    await prisma.balanceLog.update({where:{id:originalRefundLog.id},data:{userId}})
    await assert.rejects(resolveRecoveryOrder({...walletResolution,sourceHash:(await recoveryOrder(walletId)).sourceHash},actorId,{password}),/WALLET_LINEAGE_REQUIRED/)
    await prisma.balanceLog.update({where:{id:originalRefundLog.id},data:{userId:recipient.id}})
    await prisma.instanceBillingRecord.update({where:{id:renewalBill.id},data:{balanceLogId:null}})
    await assert.rejects(resolveRecoveryOrder({...walletResolution,sourceHash:(await recoveryOrder(walletId)).sourceHash},actorId,{password}),/WALLET_LINEAGE_REQUIRED/)
    await prisma.instanceBillingRecord.update({where:{id:renewalBill.id},data:{balanceLogId:renewalDebit.id}})
    await prisma.user.update({where:{id:recipient.id},data:{balance:8}})
    await assert.rejects(resolveRecoveryOrder(walletResolution,actorId,{password}),/EVIDENCE_STALE/)
    const correctWallet={...walletResolution,sourceHash:(await recoveryOrder(walletId)).sourceHash}
    await resolveRecoveryOrder(correctWallet,actorId,{password});await resolveRecoveryOrder(correctWallet,actorId,{password})
    const {default:Fastify}=await import('fastify'),{default:routes}=await import('../../src/routes/admin-aliyun-oss.js')
    const http=Fastify(),priorOrigin=process.env.ADMIN_FRONTEND_URL
    process.env.ADMIN_FRONTEND_URL='https://recovery.example.test'
    http.decorate('authenticateAdmin',async(request:any)=>{request.user={id:actorId,role:'admin',username:'recovery',
      sid:request.headers['x-old-session']?'old-session':`recovery:${batchId}:isolated`}})
    await http.register(routes,{prefix:'/api/admin/aliyun-oss'})
    const headers={origin:'https://recovery.example.test',authorization:'Bearer isolated-fixture'}
    const send=(payload:unknown,override:Record<string,string>={})=>http.inject({method:'POST',url:'/api/admin/aliyun-oss/recovery-review/orders/resolve',headers:{...headers,...override},payload:payload as any})
    try {
      const accepted=await send({password,resolution:correctWallet});assert.equal(accepted.statusCode,200,accepted.body);assert.equal(accepted.json().replayed,true)
      for(const target of [{userId,balance:'-1.00'},{userId,balance:2},{balance:'1.00'},{userId:0,balance:'1.00'}]){
        assert.equal((await send({password,resolution:{...correctWallet,walletTargets:[target]}})).statusCode,400)
      }
      assert.equal((await send({password,resolution:{...correctWallet,walletTargets:Array(202).fill({userId,balance:'1.00'})}})).statusCode,400)
      assert.equal((await send({password,resolution:correctWallet},{origin:'https://untrusted.example.test'})).statusCode,403)
      assert.equal((await send({password,resolution:correctWallet},{'x-old-session':'true'})).statusCode,403)
      console.log('PASS actual Fastify recovery route: walletTargets accepted, malformed amounts/accounts/limits rejected, cross-origin and old-session denied')
    }finally{await http.close();if(priorOrigin===undefined)delete process.env.ADMIN_FRONTEND_URL;else process.env.ADMIN_FRONTEND_URL=priorOrigin}
    assert.equal(Number((await prisma.user.findUniqueOrThrow({where:{id:userId}})).balance),3)
    assert.equal(Number((await prisma.user.findUniqueOrThrow({where:{id:recipient.id}})).balance),1)
    const walletReturns=await prisma.balanceLog.findMany({where:{orderId:walletId,type:'refund'}})
    assert.deepEqual(walletReturns.map(row=>[row.userId,Number(row.amount)]),[[userId,5]])
    assert.equal(await prisma.instanceBillingRecord.count({where:{instanceId:walletGuests[1].id,type:'refund'}}),1,'completed remaining-value deletion never invents a second refund')
    assert.equal((await prisma.instance.findUniqueOrThrow({where:{id:walletGuests[1].id}})).userId,recipient.id)
    const repeated={...correctWallet,id:randomUUID(),sourceHash:(await recoveryOrder(walletId)).sourceHash,observedAt:new Date().toISOString()}
    await resolveRecoveryOrder(repeated,actorId,{password})
    assert.equal(await prisma.balanceLog.count({where:{orderId:walletId,type:'refund'}}),1,'new evidence ID does not refund twice')
    console.log('PASS transferred wallet: original payer gets missing line, recipient retains already settled remaining-value refund, no invented full refund, final spent balances and replay')
    const legacyId=randomUUID()
    await prisma.poolOrder.create({data:{id:legacyId,userId,requestHash:'legacy-wallet-original',totalCents:700}})
    const legacyDebit=await prisma.balanceLog.create({data:{userId,type:'consume',amount:-7,balanceBefore:7,balanceAfter:0,createdAt:walletPaidAt,
      remark:'deliberately unrelated text; must not be parsed'}})
    const legacyGuests=[]
    for(const [index,amount] of [3,4].entries()){
      const item=await prisma.instance.create({data:{userId,hostId:donorHost.id,name:`legacy-guest-${index}`,incusId:`legacy-guest-${index}`,status:index?'deleted':'running',
        cpu:100,memory:512,disk:1024,image:'fixture',purchaseBatchId:legacyId,...(index?{snapshottedSpecs:{poolProvision:{version:1,phase:'failed'}}}:{})}})
      legacyGuests.push(item)
      await prisma.instanceBillingRecord.create({data:{userId,instanceId:item.id,type:'newPurchase',amount,months:1,purchaseBatchId:legacyId,
        balanceLogId:legacyDebit.id,createdAt:walletPaidAt,periodStart:walletPaidAt,periodEnd:new Date(Date.now()+86400000)}})
    }
    await prisma.platformRecoveryHost.update({where:{batchId_hostId:{batchId,hostId:donorHost.id}},data:{sourceHash:await recoveryHostSourceHash(donorHost.id),checkedAt:new Date()}})
    const logsBeforeMissingRefund=await prisma.balanceLog.count()
    await assert.rejects(resolveRecoveryOrder({...resolution,id:randomUUID(),orderId:legacyId,sourceHash:(await recoveryOrder(legacyId)).sourceHash,
      observedAt:new Date().toISOString(),conclusion:'partial',refunds:[],walletBalance:'2.00'},actorId,{password}),/WALLET_REFUND_LINK_REQUIRED/)
    assert.equal(await prisma.balanceLog.count(),logsBeforeMissingRefund)
    // Real poolProvision.failed is written only after the original wallet
    // settlement. Preserve that exact original refund instead of minting it.
    const legacyRefundLog=await prisma.balanceLog.create({data:{userId,instanceId:legacyGuests[1].id,type:'refund',amount:4,balanceBefore:3,balanceAfter:7}})
    await prisma.instanceBillingRecord.create({data:{userId,instanceId:legacyGuests[1].id,type:'refund',amount:-4,months:0,balanceLogId:legacyRefundLog.id,
      periodStart:walletPaidAt,periodEnd:walletPaidAt}})
    await prisma.platformRecoveryHost.update({where:{batchId_hostId:{batchId,hostId:donorHost.id}},data:{sourceHash:await recoveryHostSourceHash(donorHost.id),checkedAt:new Date()}})
    const legacyView=await recoveryOrder(legacyId)
    assert.equal(await unresolvedLegacyRecoveryOrders(batchId),1,'old wallet orders are included in the release gate')
    await prisma.platformRecoveryEvidence.create({data:{batchId,category:'tasks',reference:'checkout-task-proof',sourceHash:await recoveryDatasetHash('tasks'),
      evidenceHash:'c'.repeat(64),observedAt:new Date(),actorId,payload:{conclusion:'reconciled'}}})
    const blockedReady=await recoveryReadiness()
    assert.equal(blockedReady.categories.find(row=>row.category==='tasks')?.verified,false,'generic task confirmation cannot override unresolved legacy orders')
    assert.equal(blockedReady.legacyOrders[0].id,legacyId)
    assert.equal(legacyView.quantity,2);assert.equal(legacyView.partialAvailable,true)
    const legacyResolution={...resolution,id:randomUUID(),orderId:legacyId,sourceHash:legacyView.sourceHash,observedAt:new Date().toISOString(),conclusion:'partial' as const,
      refunds:[],walletBalance:'2.00'}
    const missingBill=await prisma.instanceBillingRecord.findFirstOrThrow({where:{instanceId:legacyGuests[1].id,type:'newPurchase'}})
    await prisma.instanceBillingRecord.update({where:{id:missingBill.id},data:{balanceLogId:null}})
    const missingLinkView=await recoveryOrder(legacyId)
    assert.equal(missingLinkView.partialUnavailableCode,'OSS_RECOVERY_LEGACY_PURCHASE_LINK_REQUIRED')
    await assert.rejects(resolveRecoveryOrder({...legacyResolution,sourceHash:missingLinkView.sourceHash},actorId,{password}),/LEGACY_PURCHASE_LINK_REQUIRED/)
    const originalBills=await prisma.instanceBillingRecord.findMany({where:{purchaseBatchId:legacyId,type:'newPurchase'},orderBy:{id:'asc'}})
    const links={id:randomUUID(),orderId:legacyId,sourceHash:missingLinkView.sourceHash,reference:'original-purchase-link-evidence',
      evidenceHash:'e'.repeat(64),observedAt:new Date().toISOString(),debitId:legacyDebit.id,purchaseBillIds:originalBills.map(row=>row.id)}
    const beforeLinkBalance=Number((await prisma.user.findUniqueOrThrow({where:{id:userId}})).balance)
    await assert.rejects(restoreLegacyPurchaseLinks({...links,purchaseBillIds:[missingBill.id]},actorId,{password}),/PURCHASE_LINK_REQUIRED/)
    await assert.rejects(restoreLegacyPurchaseLinks({...links,debitId:originalRefundLog.id},actorId,{password}),/PURCHASE_LINK_REQUIRED/)
    const collision=await prisma.instanceBillingRecord.create({data:{userId,instanceId:walletGuests[0].id,type:'newPurchase',amount:7,months:1,
      balanceLogId:legacyDebit.id,createdAt:walletPaidAt,periodStart:walletPaidAt,periodEnd:new Date(Date.now()+86400000)}})
    await assert.rejects(restoreLegacyPurchaseLinks(links,actorId,{password}),/LEGACY_DEBIT_REUSED/)
    await prisma.instanceBillingRecord.delete({where:{id:collision.id}})
    await restoreLegacyPurchaseLinks(links,actorId,{password});await restoreLegacyPurchaseLinks(links,actorId,{password})
    const linksHttp=Fastify();process.env.ADMIN_FRONTEND_URL='https://recovery.example.test'
    linksHttp.decorate('authenticateAdmin',async(request:any)=>{request.user={id:actorId,role:'admin',username:'recovery',
      sid:request.headers['x-old-session']?'old-session':`recovery:${batchId}:isolated`}})
    await linksHttp.register(routes,{prefix:'/api/admin/aliyun-oss'})
    const sendLinks=(payload:unknown,override:Record<string,string>={})=>linksHttp.inject({method:'POST',url:'/api/admin/aliyun-oss/recovery-review/orders/legacy-links',headers:{...headers,...override},payload:payload as any})
    try{
      const accepted=await sendLinks({password,links});assert.equal(accepted.statusCode,200,accepted.body);assert.equal(accepted.json().replayed,true)
      for(const invalid of [{...links,extra:true},{...links,debitId:0},{...links,purchaseBillIds:Array(101).fill(1)}])
        assert.equal((await sendLinks({password,links:invalid})).statusCode,400)
      assert.equal((await sendLinks({password,links},{origin:'https://untrusted.example.test'})).statusCode,403)
      assert.equal((await sendLinks({password,links},{'x-old-session':'true'})).statusCode,403)
    }finally{await linksHttp.close();if(priorOrigin===undefined)delete process.env.ADMIN_FRONTEND_URL;else process.env.ADMIN_FRONTEND_URL=priorOrigin}
    assert.equal(Number((await prisma.user.findUniqueOrThrow({where:{id:userId}})).balance),beforeLinkBalance)
    assert.equal((await prisma.balanceLog.findUniqueOrThrow({where:{id:legacyDebit.id}})).orderId,null)
    console.log('PASS missing legacy bill links: exact original IDs restored, incomplete/wrong debit rejected, no debit rewrite or balance movement, replay retained')
    await resolveRecoveryOrder(legacyResolution,actorId,{password});await resolveRecoveryOrder(legacyResolution,actorId,{password})
    assert.equal((await recoveryOrder(legacyId)).status,'partial')
    assert.equal(Number((await prisma.user.findUniqueOrThrow({where:{id:userId}})).balance),2)
    assert.equal(await prisma.checkoutOrder.count({where:{id:legacyId}}),0,'legacy wallet remains an original pool order')
    assert.equal((await prisma.balanceLog.findUniqueOrThrow({where:{id:legacyDebit.id}})).orderId,null,'old debit is not rewritten')
    assert.equal(await prisma.balanceLog.count({where:{orderId:legacyId,type:'refund'}}),0,'existing failure settlement is retained without another refund')
    await resolveRecoveryOrder({...legacyResolution,id:randomUUID(),sourceHash:(await recoveryOrder(legacyId)).sourceHash},actorId,{password})
    assert.equal(await prisma.balanceLog.count({where:{orderId:legacyId,type:'refund'}}),0)
    assert.equal(await unresolvedLegacyRecoveryOrders(batchId),0)
    await prisma.balanceLog.create({data:{userId,type:'admin_adjust',amount:1,balanceBefore:2,balanceAfter:3}})
    await prisma.user.update({where:{id:userId},data:{balance:3}})
    assert.equal((await recoveryOrder(legacyId)).status,'partial','an unrelated account correction cannot reopen a reconciled order')
    assert.equal(await unresolvedLegacyRecoveryOrders(batchId),0)
    await prisma.instanceBillingRecord.update({where:{id:missingBill.id},data:{amount:5}})
    assert.equal(await unresolvedLegacyRecoveryOrders(batchId),1,'a changed original bill invalidates the completion')
    await prisma.instanceBillingRecord.update({where:{id:missingBill.id},data:{amount:4}})
    assert.equal(await unresolvedLegacyRecoveryOrders(batchId),0)
    const cleanId=randomUUID(),cleanAt=new Date(Date.now()-9000)
    await prisma.poolOrder.create({data:{id:cleanId,userId,requestHash:'intact-legacy',totalCents:300}})
    const cleanDebit=await prisma.balanceLog.create({data:{userId,type:'consume',amount:-3,balanceBefore:3,balanceAfter:0,createdAt:cleanAt}})
    const cleanGuest=await prisma.instance.create({data:{userId,hostId:donorHost.id,name:'intact-legacy',incusId:'intact-legacy',status:'running',
      cpu:100,memory:512,disk:1024,image:'fixture',purchaseBatchId:cleanId}})
    await prisma.instanceBillingRecord.create({data:{userId,instanceId:cleanGuest.id,type:'newPurchase',amount:3,months:1,purchaseBatchId:cleanId,
      balanceLogId:cleanDebit.id,createdAt:cleanAt,periodStart:cleanAt,periodEnd:new Date(Date.now()+86400000)}})
    await reconcileIntactLegacyOrders(await activeRecoveryBatch())
    assert.equal((await recoveryOrder(cleanId)).status,'recovery_review','stale host check prevents automatic completion')
    const {recoveryReview}=await import('../../src/services/platform-recovery-review.js')
    const reviewProgress=async()=>((await recoveryReview('poolOrders')).rows.find(row=>row.id===cleanId) as any)?.recovery
    assert.equal((await reviewProgress()).status,'retry');assert.ok((await reviewProgress()).nextAt)
    await prisma.platformRecoveryHost.update({where:{batchId_hostId:{batchId,hostId:donorHost.id}},data:{sourceHash:await recoveryHostSourceHash(donorHost.id),checkedAt:new Date()}})
    const retryKey={batchId_category_reference:{batchId,category:'legacy-order-auto',reference:cleanId}}
    const retry=await prisma.platformRecoveryEvidence.findUniqueOrThrow({where:retryKey})
    const retryPayload=retry.payload as {attempt:number;nextAt:string}
    assert.equal(retryPayload.attempt,1)
    await reconcileIntactLegacyOrders(await activeRecoveryBatch())
    assert.equal((await prisma.platformRecoveryEvidence.findUniqueOrThrow({where:retryKey})).createdAt.getTime(),retry.createdAt.getTime(),'cooldown survives repeated ticks')
    await prisma.platformRecoveryEvidence.update({where:retryKey,data:{payload:{...(retry.payload as Record<string,unknown>),nextAt:new Date(0).toISOString()}}})
    await reconcileIntactLegacyOrders(await activeRecoveryBatch());await reconcileIntactLegacyOrders(await activeRecoveryBatch())
    assert.equal((await recoveryOrder(cleanId)).status,'completed')
    assert.equal((await reviewProgress()).status,'completed');assert.equal((await reviewProgress()).code,null);assert.equal((await reviewProgress()).nextAt,null)
    assert.equal(await prisma.balanceLog.count({where:{orderId:cleanId}}),0,'automatic completion does not charge or refund')
    assert.equal(Number((await prisma.user.findUniqueOrThrow({where:{id:userId}})).balance),3)
    assert.equal(await unresolvedLegacyRecoveryOrders(batchId),0)
    console.log('PASS legacy automation: exact intact order resumes after host verification, cooldown, zero money movement, stable completion across unrelated balances and invalidation by changed bills')
    console.log('PASS legacy pool order: exact purchase/debit IDs, no remark parsing, mixed live/deleted guests, missing link refusal, original record preservation and refund replay')
    for(const count of [0,1]){
      const id=randomUUID(),paidAt=new Date(Date.now()-10000)
      await prisma.checkoutOrder.create({data:{id,userId,requestHash:'single-wallet-'+count,source:'direct',status:'recovery_review',totalCents:1000,
        snapshot:'fixture',display:[{quantity:2}],paymentId:'balance',paidAt,expiresAt:new Date()}})
      await prisma.balanceLog.create({data:{userId,orderId:id,type:'consume',amount:-10,balanceBefore:10,balanceAfter:0}})
      if(count){
        const item=await prisma.instance.create({data:{userId,hostId:donorHost.id,name:'single-wallet-guest',incusId:'single-wallet-guest',status:'running',
          cpu:100,memory:512,disk:1024,image:'fixture',purchaseBatchId:id}})
        await prisma.instanceBillingRecord.create({data:{userId,instanceId:item.id,type:'newPurchase',amount:4,months:1,purchaseBatchId:id,
          createdAt:paidAt,periodStart:paidAt,periodEnd:new Date(Date.now()+86400000)}})
        await prisma.balanceLog.create({data:{userId,orderId:id,type:'refund',amount:2,balanceBefore:0,balanceAfter:2}})
        await prisma.platformRecoveryHost.update({where:{batchId_hostId:{batchId,hostId:donorHost.id}},data:{sourceHash:await recoveryHostSourceHash(donorHost.id),checkedAt:new Date()}})
      }
      const view=await recoveryOrder(id),input={...resolution,id:randomUUID(),orderId:id,sourceHash:view.sourceHash,
        observedAt:new Date().toISOString(),conclusion:count?'partial' as const:'refunded' as const,refunds:[],walletBalance:'1.00'}
      await resolveRecoveryOrder(input,actorId,{password});await resolveRecoveryOrder(input,actorId,{password})
      assert.equal(Number((await prisma.user.findUniqueOrThrow({where:{id:userId}})).balance),1)
      assert.equal(Number((await prisma.balanceLog.aggregate({where:{orderId:id,type:'refund'},_sum:{amount:true}}))._sum.amount),count?6:10)
      assert.equal(await prisma.instance.count({where:{purchaseBatchId:id}}),count)
    }
    console.log('PASS single wallet unified accounting: no delivery/full refund, partial delivery/prior refund, final spent balance and replay')
    const settled={version:1,revision:randomUUID(),actor:{id:userId},mode:'user_destroy',refund:false,ownerId:userId,hostId:donorHost.id,
      name:cleanGuest.incusId,hostIdentity:'original-host-identity',instanceVersion:cleanGuest.version,requestedAt:new Date().toISOString(),
      status:'done',attempts:1,sites:[],refundAmount:0,refundPending:false}
    await prisma.instance.update({where:{id:cleanGuest.id},data:{status:'deleted',deletionIntent:settled}})
    await prisma.platformRecoveryHost.update({where:{batchId_hostId:{batchId,hostId:donorHost.id}},data:{sourceHash:await recoveryHostSourceHash(donorHost.id),checkedAt:new Date()}})
    const balanceBefore=Number((await prisma.user.findUniqueOrThrow({where:{id:userId}})).balance)
    const settledView=await recoveryOrder(cleanId)
    await assert.rejects(resolveRecoveryOrder({...resolution,id:randomUUID(),orderId:cleanId,sourceHash:settledView.sourceHash,
      observedAt:new Date().toISOString(),conclusion:'refunded',refunds:[],walletBalance:'4.00'},actorId,{password}),/ORDER_ALREADY_SETTLED/)
    await reconcileIntactLegacyOrders(await activeRecoveryBatch())
    assert.equal((await recoveryOrder(cleanId)).status,'completed')
    assert.equal(await prisma.balanceLog.count({where:{orderId:cleanId}}),0)
    assert.equal(Number((await prisma.user.findUniqueOrThrow({where:{id:userId}})).balance),balanceBefore)
    await prisma.instance.update({where:{id:cleanGuest.id},data:{deletionIntent:{...settled,ownerId:recipient.id}}})
    await prisma.platformRecoveryHost.update({where:{batchId_hostId:{batchId,hostId:donorHost.id}},data:{sourceHash:await recoveryHostSourceHash(donorHost.id),checkedAt:new Date()}})
    await reconcileIntactLegacyOrders(await activeRecoveryBatch())
    assert.equal((await recoveryOrder(cleanId)).status,'recovery_review','wrong original deletion owner cannot establish settled lifecycle')
    await prisma.instance.update({where:{id:cleanGuest.id},data:{deletionIntent:settled}})
    const closedId=randomUUID()
    await prisma.checkoutOrder.create({data:{id:closedId,userId,requestHash:'settled-deletion',source:'direct',status:'recovery_review',totalCents:300,
      snapshot:'fixture',display:[{quantity:1}],paymentId:'balance',paidAt:cleanAt,expiresAt:new Date()}})
    const closed=await prisma.instance.create({data:{userId,hostId:donorHost.id,name:'settled-checkout',incusId:'settled-checkout',status:'deleted',
      cpu:100,memory:512,disk:1024,image:'fixture',purchaseBatchId:closedId,deletionIntent:{...settled,name:'settled-checkout',instanceVersion:0}}})
    await prisma.instance.update({where:{id:closed.id},data:{deletionIntent:{...settled,name:closed.incusId,instanceVersion:closed.version}}})
    const closedDebit=await prisma.balanceLog.create({data:{userId,orderId:closedId,type:'consume',amount:-3,balanceBefore:3,balanceAfter:0}})
    await prisma.instanceBillingRecord.create({data:{userId,instanceId:closed.id,type:'newPurchase',amount:3,months:1,purchaseBatchId:closedId,
      balanceLogId:closedDebit.id,createdAt:cleanAt,periodStart:cleanAt,periodEnd:new Date(Date.now()+86400000)}})
    await prisma.platformRecoveryHost.update({where:{batchId_hostId:{batchId,hostId:donorHost.id}},data:{sourceHash:await recoveryHostSourceHash(donorHost.id),checkedAt:new Date()}})
    const closedView=await recoveryOrder(closedId)
    await assert.rejects(resolveRecoveryOrder({...resolution,id:randomUUID(),orderId:closedId,sourceHash:closedView.sourceHash,
      observedAt:new Date().toISOString(),conclusion:'refunded',refunds:[],walletBalance:'4.00'},actorId,{password}),/ORDER_ALREADY_SETTLED/)
    await resolveRecoveryOrder({...resolution,id:randomUUID(),orderId:closedId,sourceHash:closedView.sourceHash,
      observedAt:new Date().toISOString(),conclusion:'delivered',refunds:[]},actorId,{password})
    assert.equal((await recoveryOrder(closedId)).status,'completed');assert.equal(await prisma.balanceLog.count({where:{orderId:closedId,type:'refund'}}),0)
    for(const intent of [{...settled,refund:true,refundAmount:1},{...settled,status:'running'}]){
      await prisma.instance.update({where:{id:closed.id},data:{deletionIntent:{...intent,name:closed.incusId,instanceVersion:closed.version}}})
      await assert.rejects(resolveRecoveryOrder({...resolution,id:randomUUID(),orderId:closedId,sourceHash:(await recoveryOrder(closedId)).sourceHash,
        observedAt:new Date().toISOString(),conclusion:'refunded',refunds:[],walletBalance:'4.00'},actorId,{password}),/WALLET_LINEAGE_REQUIRED/)
      assert.equal(await prisma.balanceLog.count({where:{orderId:closedId,type:'refund'}}),0)
    }
    console.log('PASS completed non-refunding deletion: original lifecycle retained, legacy automatic completion, mismatched owner refused and checkout cannot invent a full refund')
    await prisma.instance.update({where:{id:cleanGuest.id},data:{deletionIntent:Prisma.DbNull}})
    const oldDestroy=await prisma.userDestroyRecord.create({data:{instanceId:cleanGuest.id,userId,hostId:donorHost.id,
      instanceName:cleanGuest.name,refundAmount:0,feeAmount:0,isFirstTime:true}})
    await prisma.platformRecoveryHost.update({where:{batchId_hostId:{batchId,hostId:donorHost.id}},data:{sourceHash:await recoveryHostSourceHash(donorHost.id),checkedAt:new Date()}})
    const destroyBalance=(await prisma.user.findUniqueOrThrow({where:{id:userId}})).balance.toString()
    await reconcileIntactLegacyOrders(await activeRecoveryBatch())
    assert.equal((await recoveryOrder(cleanId)).status,'completed','original non-refunding destroy receipt ends the lifecycle automatically')
    await prisma.userDestroyRecord.update({where:{id:oldDestroy.id},data:{refundAmount:1}})
    assert.equal((await recoveryOrder(cleanId)).status,'recovery_review','changing an original destroy receipt invalidates the completion')
    await prisma.userDestroyRecord.update({where:{id:oldDestroy.id},data:{refundAmount:0}})
    assert.equal((await recoveryOrder(cleanId)).status,'completed')
    assert.equal((await prisma.user.findUniqueOrThrow({where:{id:userId}})).balance.toString(),destroyBalance)
    console.log('PASS historical destroy receipt: exact account/host/name/time, automatic zero-money completion and changed receipt invalidation')
    const giftId=randomUUID(),giftAt=new Date(Date.now()-5000)
    await prisma.poolOrder.create({data:{id:giftId,userId,requestHash:'original-free-first-period',totalCents:0}})
    const giftDebit=await prisma.balanceLog.create({data:{userId,type:'consume',amount:0,balanceBefore:3,balanceAfter:3,createdAt:giftAt}})
    const gift=await prisma.instance.create({data:{userId,hostId:donorHost.id,name:'original-free-guest',incusId:'original-free-guest',status:'running',
      cpu:100,memory:512,disk:1024,image:'fixture',purchaseBatchId:giftId}})
    const giftBill=await prisma.instanceBillingRecord.create({data:{userId,instanceId:gift.id,type:'newPurchase',amount:0,months:1,purchaseBatchId:giftId,
      balanceLogId:giftDebit.id,createdAt:giftAt,periodStart:giftAt,periodEnd:new Date(Date.now()+86400000)}})
    const giftBalance=(await prisma.user.findUniqueOrThrow({where:{id:userId}})).balance.toString()
    await prisma.platformRecoveryHost.update({where:{batchId_hostId:{batchId,hostId:donorHost.id}},data:{sourceHash:await recoveryHostSourceHash(donorHost.id),checkedAt:new Date()}})
    await reconcileIntactLegacyOrders(await activeRecoveryBatch())
    assert.equal((await recoveryOrder(giftId)).status,'completed');assert.equal((await recoveryOrder(giftId)).quantity,1)
    assert.equal((await prisma.user.findUniqueOrThrow({where:{id:userId}})).balance.toString(),giftBalance)
    await prisma.instanceBillingRecord.update({where:{id:giftBill.id},data:{amount:1}})
    await reconcileIntactLegacyOrders(await activeRecoveryBatch());assert.equal((await recoveryOrder(giftId)).status,'recovery_review')
    console.log('PASS original free-period order: zero charge linked exactly, automatic completion without balance change and nonzero bill conflict rejected')
    const {refundBillingRecordId:ignoredBillId,...oldRecipientDeletion}=recipientDeletion
    await prisma.instance.update({where:{id:walletGuests[1].id},data:{deletionIntent:oldRecipientDeletion}})
    await prisma.instanceBillingRecord.update({where:{id:settledWalletBill.id},data:{remark:`管理员删除并退款：${recipientDeletion.revision}`}})
    assert.equal((await recoveryOrder(walletId)).partialAvailable,true,'legacy deletion uses the exact intent UUID settlement reference')
    await prisma.instanceBillingRecord.update({where:{id:settledWalletBill.id},data:{remark:`管理员删除并退款：${randomUUID()}`}})
    assert.equal((await recoveryOrder(walletId)).partialAvailable,false,'another intent is never linked by equal money or close timestamps')
    await prisma.instance.update({where:{id:walletGuests[1].id},data:{deletionIntent:recipientDeletion}})
    await prisma.instance.update({where:{id:closed.id},data:{deletionIntent:{...settled,name:closed.incusId,instanceVersion:closed.version}}})
    await prisma.platformRecoveryHost.update({where:{batchId_hostId:{batchId,hostId:donorHost.id}},data:{status:'retry'}})
    await prisma.checkoutOrder.update({where:{id:closedId},data:{status:'recovery_review'}})
    for(let i=0;i<6;i++)await reconcileIntactCheckoutOrders(await activeRecoveryBatch())
    const autoKey={batchId_category_reference:{batchId,category:'checkout-order-auto',reference:closedId}}
    const auto=await prisma.platformRecoveryEvidence.findUniqueOrThrow({where:autoKey})
    assert.equal((auto.payload as any).code,'OSS_RECOVERY_DELIVERY_UNVERIFIED')
    assert.equal((auto.payload as any).attempt,1,'repeated automatic scans retain cooldown')
    const beforeAutomatic=await prisma.balanceLog.count()
    await prisma.platformRecoveryHost.update({where:{batchId_hostId:{batchId,hostId:donorHost.id}},data:{status:'success',sourceHash:await recoveryHostSourceHash(donorHost.id),checkedAt:new Date()}})
    await prisma.platformRecoveryEvidence.update({where:autoKey,data:{payload:{...(auto.payload as object),nextAt:new Date(0).toISOString()}}})
    for(let i=0;i<6;i++)await reconcileIntactCheckoutOrders(await activeRecoveryBatch())
    assert.equal((await recoveryOrder(closedId)).status,'completed')
    assert.equal(await prisma.balanceLog.count(),beforeAutomatic,'automatic completion never adjusts customer money')
    assert.equal(await prisma.balanceLog.count({where:{orderId:closedId,type:'refund'}}),0)
    console.log('PASS checkout automation: host outage backoff, original settled lifecycle auto-continues, exact legacy deletion reference and zero money movement')
    // A deletion can return purchase money externally and later renewal money
    // to the wallet. Verify both exact paths; equal totals alone are insufficient.
    const mixedId=randomUUID(),mixedAt=new Date(Date.now()-10000),mixedRefundAt=new Date(Date.now()-1000)
    await prisma.checkoutOrder.create({data:{id:mixedId,userId,requestHash:'mixed-refund',source:'direct',status:'recovery_review',totalCents:300,
      snapshot:'isolated',display:[{quantity:1}],paidAt:mixedAt,expiresAt:new Date()}})
    const mixedPayment=await prisma.checkoutPayment.create({data:{id:randomUUID(),orderId:mixedId,providerId:provider.id,providerType:'yipay',providerName:'fixture',
      method:'alipay',payableCents:310,feeCents:10,configSnapshot:'isolated',details:{},status:'paid'}})
    await prisma.checkoutOrder.update({where:{id:mixedId},data:{paymentId:mixedPayment.id}})
    const mixedReceipt=await prisma.checkoutReceipt.create({data:{id:randomUUID(),paymentId:mixedPayment.id,providerId:provider.id,tradeNo:'mixed-settled',amountCents:310,currency:'CNY',proof:{}}})
    const mixedGuest=await prisma.instance.create({data:{userId,hostId:donorHost.id,name:'mixed-settled',incusId:'mixed-settled',status:'deleted',
      cpu:100,memory:512,disk:1024,image:'fixture',purchaseBatchId:mixedId}})
    const purchaseMixed=await prisma.instanceBillingRecord.create({data:{userId,instanceId:mixedGuest.id,type:'newPurchase',amount:3,months:1,
      purchaseBatchId:mixedId,createdAt:mixedAt,periodStart:mixedAt,periodEnd:new Date()}})
    const renewalMixedLog=await prisma.balanceLog.create({data:{userId,instanceId:mixedGuest.id,type:'consume',amount:-2,balanceBefore:7,balanceAfter:5,createdAt:new Date(mixedAt.getTime()+1000)}})
    const renewalMixedBill=await prisma.instanceBillingRecord.create({data:{userId,instanceId:mixedGuest.id,type:'renew',amount:2,months:1,balanceLogId:renewalMixedLog.id,
      createdAt:new Date(mixedAt.getTime()+1000),periodStart:mixedAt,periodEnd:new Date()}})
    const refundMixedLog=await prisma.balanceLog.create({data:{userId,instanceId:mixedGuest.id,type:'refund',amount:2,balanceBefore:5,balanceAfter:7,createdAt:mixedRefundAt}})
    const refundMixedBill=await prisma.instanceBillingRecord.create({data:{userId,instanceId:mixedGuest.id,type:'refund',amount:-5,months:0,
      balanceLogId:refundMixedLog.id,createdAt:mixedRefundAt,periodStart:mixedAt,periodEnd:new Date()}})
    const mixedRefund=await prisma.checkoutRefund.create({data:{id:randomUUID(),orderId:mixedId,paymentId:mixedPayment.id,receiptId:mixedReceipt.id,
      instanceId:mixedGuest.id,billingRecordId:refundMixedBill.id,amountCents:310,principalCents:300,reason:'instance_refund',status:'refunded',
      createdAt:mixedRefundAt,handledAt:new Date(),resolution:'original-bank-refund'}})
    await prisma.instance.update({where:{id:mixedGuest.id},data:{deletionIntent:{...settled,name:mixedGuest.incusId,ownerId:userId,
      instanceVersion:mixedGuest.version,mode:'admin',refund:true,refundAmount:5,refundPending:true,refundBillingRecordId:refundMixedBill.id,
      requestedAt:new Date(Date.now()-5000).toISOString()}}})
    assert.equal((await recoveryOrder(mixedId)).deliveryComplete,true,'actual settled receipt supersedes the original pending display flag')
    for(const patch of [{amountCents:200},{principalCents:301},{handledAt:new Date(Date.now()+60000)},{paymentId:duplicatePayment.id}]){
      await prisma.checkoutRefund.update({where:{id:mixedRefund.id},data:patch})
      assert.equal((await recoveryOrder(mixedId)).deliveryComplete,false,'invalid original-channel link or chronology does not settle deletion')
      await prisma.checkoutRefund.update({where:{id:mixedRefund.id},data:{amountCents:310,principalCents:300,handledAt:new Date(),paymentId:mixedPayment.id}})
    }
    await prisma.instanceBillingRecord.update({where:{id:purchaseMixed.id},data:{purchaseBatchId:null}})
    assert.equal((await recoveryOrder(mixedId)).deliveryComplete,false,'missing purchase source cannot borrow an equal-valued external receipt')
    await prisma.instanceBillingRecord.update({where:{id:purchaseMixed.id},data:{purchaseBatchId:mixedId}})
    await prisma.platformRecoveryHost.update({where:{batchId_hostId:{batchId,hostId:donorHost.id}},data:{sourceHash:await recoveryHostSourceHash(donorHost.id),checkedAt:new Date()}})
    const mixedProof=async()=>({...resolution,id:randomUUID(),orderId:mixedId,sourceHash:(await recoveryOrder(mixedId)).sourceHash,
      observedAt:new Date().toISOString(),refunds:[]})
    await prisma.instanceBillingRecord.update({where:{id:renewalMixedBill.id},data:{balanceLogId:null}})
    await assert.rejects(resolveRecoveryOrder(await mixedProof(),actorId,{password}),/WALLET_LINEAGE_REQUIRED/)
    await prisma.instanceBillingRecord.update({where:{id:renewalMixedBill.id},data:{balanceLogId:renewalMixedLog.id}})
    const unchangedProof=await mixedProof()
    await prisma.balanceLog.update({where:{id:renewalMixedLog.id},data:{balanceBefore:8,balanceAfter:6}})
    await assert.rejects(resolveRecoveryOrder(unchangedProof,actorId,{password}),/EVIDENCE_STALE/)
    for(const patch of [{userId:recipient.id},{amount:-1},{createdAt:new Date(mixedRefundAt.getTime()+1)},{orderId:mixedId}]){
      await prisma.balanceLog.update({where:{id:renewalMixedLog.id},data:patch})
      await assert.rejects(resolveRecoveryOrder(await mixedProof(),actorId,{password}),/WALLET_LINEAGE_REQUIRED/)
      await prisma.balanceLog.update({where:{id:renewalMixedLog.id},data:{userId,amount:-2,balanceBefore:7,balanceAfter:5,createdAt:new Date(mixedAt.getTime()+1000),orderId:null}})
    }
    const reusedExternalDebit=await prisma.instanceBillingRecord.create({data:{userId,instanceId:cleanGuest.id,type:'renew',amount:2,months:1,
      balanceLogId:renewalMixedLog.id,periodStart:mixedAt,periodEnd:new Date()}})
    await assert.rejects(resolveRecoveryOrder(await mixedProof(),actorId,{password}),/WALLET_LINEAGE_REQUIRED/)
    for(let i=0;i<6;i++)await reconcileIntactCheckoutOrders(await activeRecoveryBatch())
    const sharedAttemptKey={batchId_category_reference:{batchId,category:'checkout-order-auto',reference:mixedId}}
    const sharedAttempt=await prisma.platformRecoveryEvidence.findUniqueOrThrow({where:sharedAttemptKey})
    assert.equal((sharedAttempt.payload as any).status,'blocked')
    await prisma.platformRecoveryEvidence.update({where:sharedAttemptKey,data:{payload:{...(sharedAttempt.payload as object),nextAt:new Date(0).toISOString()}}})
    await prisma.instanceBillingRecord.delete({where:{id:reusedExternalDebit.id}})
    console.log('PASS external-order renewal lineage: missing/reused original debit, wrong owner, amount, time and order denied; changed debit invalidates stale proof')
    const mixedBalances=await prisma.user.findMany({where:{id:{in:[userId,recipient.id]}},select:{id:true,balance:true},orderBy:{id:'asc'}})
    for(let i=0;i<6;i++)await reconcileIntactCheckoutOrders(await activeRecoveryBatch())
    assert.equal((await recoveryOrder(mixedId)).status,'completed')
    assert.deepEqual(await prisma.user.findMany({where:{id:{in:[userId,recipient.id]}},select:{id:true,balance:true},orderBy:{id:'asc'}}),mixedBalances)
    assert.equal(await prisma.checkoutRefund.count({where:{orderId:mixedId}}),1)
    console.log('PASS mixed-source deletion: original receipt plus wallet return, exact source/amount/time rejection, automatic completion and zero repeat settlement')
    const brokenId='000-unproven-checkout',unpaidId='zzz-unpaid-checkout'
    for(const id of [brokenId,unpaidId])await prisma.checkoutOrder.create({data:{id,userId,requestHash:id,source:'direct',status:'recovery_review',totalCents:300,
      snapshot:'isolated',display:[],paidAt:id===brokenId?mixedAt:null,paymentId:'balance',expiresAt:new Date()}})
    for(let i=0;i<6;i++)await reconcileIntactCheckoutOrders(await activeRecoveryBatch())
    const brokenKey={batchId_category_reference:{batchId,category:'checkout-order-auto',reference:brokenId}}
    const brokenAttempt=await prisma.platformRecoveryEvidence.findUniqueOrThrow({where:brokenKey})
    assert.equal((brokenAttempt.payload as any).status,'blocked')
    assert.equal((await recoveryOrder(unpaidId)).status,'cancelled','one broken order does not starve later orders')
    await prisma.platformRecoveryEvidence.update({where:brokenKey,data:{payload:{...(brokenAttempt.payload as object),nextAt:new Date(0).toISOString()}}})
    await prisma.balanceLog.create({data:{userId,type:'admin_adjust',amount:1,balanceBefore:7,balanceAfter:8}})
    for(let i=0;i<6;i++)await reconcileIntactCheckoutOrders(await activeRecoveryBatch())
    assert.equal((await prisma.platformRecoveryEvidence.findUniqueOrThrow({where:brokenKey})).observedAt.getTime(),brokenAttempt.observedAt.getTime(),
      'unrelated wallet changes do not rerun the same deterministic order failure')
    await prisma.platformRecoveryEvidence.create({data:{batchId,category:'tasks',reference:'checkout-final-task-proof',sourceHash:await recoveryDatasetHash('tasks'),
      evidenceHash:'a'.repeat(64),observedAt:new Date(),actorId,payload:{}}})
    const readyOrders=await recoveryReadiness()
    assert.ok(readyOrders.checkoutPending>0);assert.equal(readyOrders.categories.find(row=>row.category==='tasks')!.verified,false,
      'a generic task acknowledgment cannot bypass unresolved checkouts')
    assert.equal(readyOrders.checkoutOrders.find(row=>row.id===brokenId)?.status,'blocked')
    console.log('PASS checkout queue: deterministic failure rotates without blocking other orders, unrelated wallet changes retain attempt, task acknowledgment cannot bypass pending orders')
    const {restoreRecoveryBillingLinks}=await import('../../src/services/platform-recovery-billing-links.js')
    const upgradeTime=new Date(Date.now()-500)
    const originalUpgradeDebit=await prisma.balanceLog.create({data:{userId,instanceId:cleanGuest.id,type:'consume',amount:-1,balanceBefore:8,balanceAfter:7,createdAt:upgradeTime}})
    const originalUpgradeBill=await prisma.instanceBillingRecord.create({data:{userId,instanceId:cleanGuest.id,type:'upgrade',amount:1,months:0,
      createdAt:new Date(upgradeTime.getTime()+1),periodStart:upgradeTime,periodEnd:new Date(Date.now()+86400000)}})
    const linksView=await recoveryOrder(cleanId)
    assert.deepEqual(linksView.missingBillingLinks?.map(row=>row.id),[originalUpgradeBill.id])
    const linkProof={id:randomUUID(),orderId:cleanId,sourceHash:linksView.sourceHash,reference:'original-upgrade-receipt',evidenceHash:'b'.repeat(64),
      observedAt:new Date().toISOString(),links:[{billId:originalUpgradeBill.id,debitId:originalUpgradeDebit.id}]}
    const linkMoneyBefore=await prisma.balanceLog.count()
    await assert.rejects(restoreRecoveryBillingLinks({...linkProof,links:[{billId:originalUpgradeBill.id,debitId:refundMixedLog.id}]},actorId,{password}),/BILLING_LINK_INVALID/)
    await assert.rejects(restoreRecoveryBillingLinks({...linkProof,orderId:closedId},actorId,{password}),/EVIDENCE_STALE/)
    const billingHttp=Fastify();process.env.ADMIN_FRONTEND_URL='https://recovery.example.test'
    billingHttp.decorate('authenticateAdmin',async(request:any)=>{request.user={id:actorId,role:'admin',username:'recovery',
      sid:request.headers['x-old-session']?'old-session':`recovery:${batchId}:isolated`}})
    await billingHttp.register(routes,{prefix:'/api/admin/aliyun-oss'})
    const sendBilling=(payload:unknown,override:Record<string,string>={})=>billingHttp.inject({method:'POST',url:'/api/admin/aliyun-oss/recovery-review/orders/billing-links',
      headers:{...headers,...override},payload:payload as any})
    try {
      for(const invalid of [null,{}, {...linkProof,force:true},{...linkProof,links:[]},{...linkProof,links:Array(101).fill(linkProof.links[0])},
        {...linkProof,links:[{billId:originalUpgradeBill.id,debitId:0}]},{...linkProof,links:[{billId:originalUpgradeBill.id,debitId:String(originalUpgradeDebit.id)}]},
        {...linkProof,links:[{...linkProof.links[0],force:true}]},{...linkProof,links:[linkProof.links[0],linkProof.links[0]]}])
        assert.equal((await sendBilling({password,links:invalid})).statusCode,400)
      assert.equal((await sendBilling({password,links:linkProof,force:true})).statusCode,400)
      assert.equal((await sendBilling({password,links:linkProof},{origin:'https://untrusted.example.test'})).statusCode,403)
      assert.equal((await sendBilling({password,links:linkProof},{'x-old-session':'true'})).statusCode,403)
      assert.equal((await sendBilling({password:'incorrect-test-password',links:linkProof})).statusCode,403)
      assert.equal((await prisma.instanceBillingRecord.findUniqueOrThrow({where:{id:originalUpgradeBill.id}})).balanceLogId,null,
        'rejected requests never alter the original bill')
      const accepted=await sendBilling({password,links:linkProof});assert.equal(accepted.statusCode,200,accepted.body)
      assert.equal(accepted.json().replayed,false)
      const repeated=await sendBilling({password,links:linkProof});assert.equal(repeated.statusCode,200,repeated.body);assert.equal(repeated.json().replayed,true)
      console.log('PASS actual Fastify billing-links route: malformed and extra fields, invalid IDs, duplicate links, old-session, cross-origin and wrong-password refused; original link and replay accepted')
    }finally{await billingHttp.close();if(priorOrigin===undefined)delete process.env.ADMIN_FRONTEND_URL;else process.env.ADMIN_FRONTEND_URL=priorOrigin}
    assert.equal((await prisma.instanceBillingRecord.findUniqueOrThrow({where:{id:originalUpgradeBill.id}})).balanceLogId,originalUpgradeDebit.id)
    assert.equal(await prisma.balanceLog.count(),linkMoneyBefore,'link recovery never inserts money movements')
    assert.equal((await recoveryOrder(cleanId)).missingBillingLinks?.length,0)
    const collisionBill=await prisma.instanceBillingRecord.create({data:{userId,instanceId:cleanGuest.id,type:'upgrade',amount:1,months:0,periodStart:upgradeTime,periodEnd:new Date()}})
    await assert.rejects(restoreRecoveryBillingLinks({...linkProof,id:randomUUID(),sourceHash:(await recoveryOrder(cleanId)).sourceHash,
      observedAt:new Date().toISOString(),links:[{billId:collisionBill.id,debitId:originalUpgradeDebit.id}]},actorId,{password}),/DEBIT_REUSED/)
    await prisma.instanceBillingRecord.delete({where:{id:collisionBill.id}})
    await reconcileIntactLegacyOrders(await activeRecoveryBatch())
    assert.equal((await recoveryOrder(cleanId)).status,'completed','original upgrade linkage automatically resumes the intact legacy order')
    console.log('PASS original upgrade debit linkage: exact bill/account/guest/amount, missing and reused references rejected, replay and automatic zero-money continuation')
    await (await import('./recovery-replacement.js')).checkRecoveryReplacement(batchId,actorId,password)
    assert.equal(writes,0);assert.ok(probes>=4)
    console.log('PASS recovery original identity: real pinned SSH + mTLS, original-owner mapping, same-name UUID/owner and stale DB rejected, idempotent evidence, zero remote writes')
  }finally {
    for(const [key,value] of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value}
    for(const connection of connections)connection.end()
    for(const socket of sockets)socket.destroy()
    await Promise.all([new Promise<void>(done=>gateway.close(()=>done())),new Promise<void>(done=>remote.close(()=>done()))])
  }
}
