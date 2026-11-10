import assert from 'node:assert/strict'
import { createHash, randomUUID, X509Certificate } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1','localhost'].includes(database.hostname) && database.pathname.endsWith('_pool_test'))
const interval = globalThis.setInterval
globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => { const timer=interval(...args);timer.unref();return timer }) as typeof setInterval
try { await import('../src/lib/security.js') } finally { globalThis.setInterval=interval }
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { createInstanceAsync } = await import('../src/routes/instances.js')
const { failPoolProvision } = await import('../src/services/pool-provisioning.js')
const { beginPoolProvision, PoolProvisionOwnershipError } = await import('../src/services/pool-provisioning.js')
const { IncusClient } = await import('../src/lib/incus/incus-client.js')
const { getHostById } = await import('../src/db/hosts.js')
const { closeAllClients } = await import('../src/lib/incus/incus-pool.js')
const { hardeningIdentityHash, hardeningIdentityInclude } = await import('../src/lib/hardening-identity.js')
const { SECURITY_HARDENING_REVISION } = await import('../src/lib/security-hardening.js')
const tag='pool-provision-'+randomUUID(), root=await mkdtemp(join(tmpdir(),tag))
const keyPath=join(root,'key.pem'),certPath=join(root,'cert.pem')
execFileSync(process.env.REVIEW_OPENSSL || 'openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=incus-fixture','-addext','subjectAltName=IP:127.0.0.1','-keyout',keyPath,'-out',certPath],{stdio:'pipe',windowsHide:true})
const certificate=await readFile(certPath,'utf8'), actions:string[]=[]
let mode='existing', name='', currentId=0, remote: {name:string;status:string;type?:string;created_at?:string;project?:string;devices?:Record<string,any>;profiles?:string[];config:Record<string,string>}|null=null
const storagePending = ['storage-refused','storage-unknown','disk-residue','snapshot-residue']
const server=createServer({key:await readFile(keyPath),cert:certificate,ca:certificate,requestCert:true,rejectUnauthorized:true},async(req,res)=>{
  const ok=(metadata:unknown={})=>res.end(JSON.stringify({type:'sync',metadata})),fail=(code:number,error:string)=>{res.statusCode=code;res.end(JSON.stringify({type:'error',error}))}
  try {
    assert.ok((req.socket as any).authorized);const path=req.url||''
    if(path==='/1.0')return ok({api_version:'1.0'})
    actions.push(`${req.method} ${path}`)
    if(path==='/1.0/instances'&&req.method==='POST') {
      let body='';for await(const chunk of req)body+=chunk
      const config=JSON.parse(body);assert.equal(config.name,name)
      if(mode==='existing')return fail(409,'already exists')
      if(mode==='pending')return fail(500,'creation result unknown')
      remote={name,status:'Running',type:'container',created_at:new Date().toISOString(),devices:config.devices,profiles:[],config:{...config.config,'volatile.uuid':randomUUID()}}
      if(mode==='lost-response')return fail(502,'response lost after creation')
      if(mode==='superseded')await prisma.instance.update({where:{id:currentId},data:{status:'running'}})
      if(mode==='timed-out')await failPoolProvision(currentId,null,'fixture timeout during creation')
      return ok()
    }
    if(path.includes('/files?')){if(mode==='replaced-before-cleanup'&&remote)remote.config['volatile.uuid']=randomUUID();return fail(500,'fixture initialization failed')}
    if(path==='/1.0/operations?recursion=1')return ok(mode==='pending'?{running:[{status:'Running',resources:{instances:[`/1.0/instances/${name}`]}}]}:{})
    if(path==='/1.0/storage-pools?recursion=1') {
      assert.equal(req.method,'GET')
      if(mode==='storage-refused')return fail(500,'fixture storage API unavailable')
      return ok(mode==='storage-unknown'?null:[{name:'fixture'}])
    }
    if(path==='/1.0/storage-pools/fixture/volumes?recursion=1&all-projects=true') {
      assert.equal(req.method,'GET')
      return ok(mode==='disk-residue'?[{name,type:'container',project:'default'}]
        :mode==='snapshot-residue'?[{name:name+'/snapshot0',type:'container',project:'default'}]
          :[{name:'cached-image',type:'image'}])
    }
    if(path==='/1.0/networks')return ok(['/1.0/networks/incusbr0'])
    if(path==='/1.0/networks?recursion=1')return ok([{name:'incusbr0',type:'bridge',managed:true}])
    if(path==='/1.0/networks/incusbr0/forwards?recursion=1')return ok([])
    assert.ok(path===`/1.0/instances/${name}`||path===`/1.0/instances/${name}/state`)
    if(req.method==='GET')return remote?ok(remote):fail(404,'not found')
    if(req.method==='PUT'){if(remote){remote.status='Stopped';if(mode==='uuid-changed')remote.config['volatile.uuid']=randomUUID()}return ok()}
    if(req.method==='DELETE'){if(mode==='delete-refused')return fail(500,'fixture cleanup unavailable');remote=null;return ok()}
    fail(500,'unexpected request')
  }catch(error){fail(500,String(error))}
})
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
const user=await prisma.user.create({data:{username:tag,passwordHash:'fixture',balance:88}})
const host=await prisma.host.create({data:{userId:user.id,name:tag,singleTenant:true,resourcePreset:'E2',customerDiskGiB:30,
  cpuAllowanceMax:200,memoryMax:768,storageSize:38,architecture:'x86_64',isInstalled:true,status:'online',natPublicIp:'192.0.2.20',natBindIp:'10.0.0.20',natPortStart:20000,natPortEnd:20999,
  storagePools:{create:{name:'fixture',driver:'btrfs',purpose:'instance_data'}},
  agent:{create:{agentId:randomUUID(),secretHash:'fixture',secretEncrypted:'fixture',lastSeenAt:new Date(),
    capabilities:['guest-network-protection-v1'],lastReport:{guestProtectionStatus:{applied:true,checkedAt:new Date().toISOString()}}}},
  url:`https://127.0.0.1:${(server.address() as {port:number}).port}`,certPath,keyPath,serverCertificate:certificate,serverFingerprint:new X509Certificate(certificate).fingerprint256}})
let failure:unknown
try {
  for(const scenario of ['existing','confirmed','lost-response','delete-refused',...storagePending,'uuid-changed','replaced-before-cleanup','pending','superseded','timed-out','prepared','unpaid','refund-failed']) {
    mode=scenario;name=tag+'-'+mode;actions.length=0
    await prisma.host.update({where:{id:host.id},data:{poolFaulted:false}})
    remote=mode==='existing'?{name,status:'Running',config:{'user.unrelated':'preserve'}}:null
    const order=await prisma.poolOrder.create({data:{id:randomUUID(),userId:user.id,requestHash:tag,totalCents:1200}})
    const preparedIdentity={attempt:randomUUID(),endpointHash:createHash('sha256').update(IncusClient.normalizeUrl(host.url)).digest('hex')}
    const instance=await prisma.instance.create({data:{name,incusId:name,userId:user.id,hostId:host.id,purchaseBatchId:order.id,dedicatedIpv4:true,status:'creating',cpu:200,memory:768,disk:30720,image:'debian/12',networkMode:'nat',snapshottedSpecs:{poolProvision:{version:1,phase:'prepared'},managedCleanup:preparedIdentity}}})
    if(mode==='prepared') {
      const actualHost=(await getHostById(host.id))!,client=new IncusClient(actualHost)
      for(const altered of [{...preparedIdentity,attempt:'bad'},{...preparedIdentity,endpointHash:'b'.repeat(64)},{...preparedIdentity,uuid:randomUUID()}]) {
        await prisma.instance.update({where:{id:instance.id},data:{snapshottedSpecs:{poolProvision:{version:1,phase:'prepared'},managedCleanup:altered}}})
        await assert.rejects(beginPoolProvision(instance.id,actualHost,client,name),PoolProvisionOwnershipError)
      }
      await prisma.instance.update({where:{id:instance.id},data:{snapshottedSpecs:instance.snapshottedSpecs!}})
    }
    currentId=instance.id
    await prisma.host.update({where:{id:host.id},data:{cpuUsed:200,memoryUsed:768,diskUsed:30720}})
    await prisma.instanceBillingRecord.create({data:{instanceId:instance.id,userId:user.id,type:'newPurchase',amount:mode==='unpaid'?0:12,months:1,periodStart:new Date(),periodEnd:new Date(Date.now()+86400000)}})
    const before=Number((await prisma.user.findUniqueOrThrow({where:{id:user.id}})).balance)
    const originalTransaction=prisma.$transaction
    if(mode==='refund-failed')prisma.$transaction=new Proxy(originalTransaction,{apply(fn,receiver,args){if(args[1]?.timeout===15000)throw Error('fixture refund unavailable');return Reflect.apply(fn,receiver,args)}})
    try {
      if(mode==='prepared')await failPoolProvision(instance.id,null,'fixture failed preparation')
      else await assert.rejects(createInstanceAsync(instance.id,(await getHostById(host.id))!,{name,image:'debian/12',cpu:200,memory:768,disk:30720,networkMode:'nat',cloudInitConfig:{'user.user-data':'#cloud-config\n{}'}},user.id,{cpu:200,memory:768,disk:30720}))
    }finally{prisma.$transaction=originalTransaction}
    const current=await prisma.instance.findUniqueOrThrow({where:{id:instance.id}})
    assert.equal((current.snapshottedSpecs as any).managedCleanup.attempt,preparedIdentity.attempt,'creation keeps the attempt committed with its purchase')
    assert.equal((await prisma.host.findUniqueOrThrow({where:{id:host.id}})).poolFaulted,mode!=='superseded','failed delivery quarantines its host')
    if (mode !== 'superseded') {
      const failure = (current.snapshottedSpecs as any).poolProvision
      assert.ok(failure.error && Number.isFinite(Date.parse(failure.failedAt)), 'original failure persists through compensation')
      assert.ok(await prisma.log.count({ where: { instanceId: instance.id, result: 'failed', content: { contains: '开通失败' } } }), 'failure cause has durable audit')
      const cleanup = (await prisma.host.findUniqueOrThrow({ where: { id: host.id } })).poolCleanup as any
      assert.equal(cleanup.kind, 'verify_empty'); assert.equal(cleanup.name, '')
    }
    const shouldRefund=!['unpaid','superseded','refund-failed'].includes(mode)
    assert.equal(Number((await prisma.user.findUniqueOrThrow({where:{id:user.id}})).balance),before+(shouldRefund?12:0))
    assert.equal(await prisma.instanceBillingRecord.count({where:{instanceId:instance.id,type:'refund'}}),shouldRefund?1:0)
    const retain=['existing','delete-refused',...storagePending,'uuid-changed','replaced-before-cleanup','pending','superseded','refund-failed'].includes(mode)
    if(retain) {
      if(mode==='existing') {
      assert.ok(remote,'a rejected same-name creation must preserve the unrelated remote instance')
      assert.ok(!actions.some(action=>action===`DELETE /1.0/instances/${name}`||action.startsWith('PUT ')))
      }
      assert.equal(current.provisioningCleanupPending,mode!=='superseded')
      assert.equal((await prisma.host.findUniqueOrThrow({where:{id:host.id}})).cpuUsed,200)
      if(storagePending.includes(mode)) {
        assert.equal(remote,null,'guest deletion alone cannot release storage allocation')
        assert.equal(current.status,'error')
        const occupied=await prisma.host.findUniqueOrThrow({where:{id:host.id}})
        assert.equal(occupied.memoryUsed,768);assert.equal(occupied.diskUsed,30720)
      }
    } else {
      assert.equal(remote,null);assert.equal(current.status,'deleted');assert.equal(current.provisioningCleanupPending,false)
      assert.equal((await prisma.host.findUniqueOrThrow({where:{id:host.id}})).cpuUsed,0)
    }
    if(mode==='superseded') {
      assert.equal(current.status,'running');assert.ok(remote)
      assert.ok(!actions.some(action=>action.includes('/files?')||action===`DELETE /1.0/instances/${name}`||action.startsWith('PUT ')))
    }
    if(mode==='replaced-before-cleanup')assert.ok(!actions.some(action=>action===`DELETE /1.0/instances/${name}`||action.startsWith('PUT ')))
    const count=actions.length
    if(mode==='delete-refused'||mode==='refund-failed'||mode==='pending'||storagePending.includes(mode)) {
      mode='confirmed'
      await failPoolProvision(instance.id,(await getHostById(host.id))!,'retry cleanup')
      const retried=await prisma.instance.findUniqueOrThrow({where:{id:instance.id}})
      assert.equal(retried.status,'deleted');assert.equal(retried.provisioningCleanupPending,false)
      const released=await prisma.host.findUniqueOrThrow({where:{id:host.id}})
      assert.equal(released.cpuUsed,0);assert.equal(released.memoryUsed,0);assert.equal(released.diskUsed,0)
      assert.equal(await prisma.instanceBillingRecord.count({where:{instanceId:instance.id,type:'refund'}}),1)
      assert.equal(Number((await prisma.user.findUniqueOrThrow({where:{id:user.id}})).balance),before+12)
      const settledActions=actions.length
      await failPoolProvision(instance.id,(await getHostById(host.id))!,'repeat settled retry')
      assert.equal(actions.length,settledActions,'settled retry does not repeat remote cleanup')
      assert.equal(await prisma.instanceBillingRecord.count({where:{instanceId:instance.id,type:'refund'}}),1)
    } else if(!retain) {
      await failPoolProvision(instance.id,(await getHostById(host.id))!,'repeat compensation')
      assert.equal(actions.length,count,'completed compensation does not repeat remote actions')
    }
    await prisma.instance.delete({where:{id:instance.id}});console.log('PASS pool creation',scenario)
  }
  // Exercise the actual pool completion fence, independently of SSH/network
  // adapter tests. Both architectures must accept the normal customer and
  // reject stale host/guest evidence without any remote mutation.
  for (const architecture of ['x86_64', 'aarch64']) {
    for (const scenario of ['valid', 'receipt-became-due', 'receipt-invalidated', 'stopped', 'privileged', 'wrong-type', 'wrong-project', 'missing-created', 'changed-created', 'changed-pin', 'changed-management', 'install-pending', 'maintenance', 'faulted']) {
      mode='completion'; name=tag+'-'+architecture+'-'+scenario
      await prisma.host.update({where:{id:host.id},data:{architecture,poolFaulted:false,installPending:false,managementSshHost:null,
        securityHardening:(await import('@prisma/client')).Prisma.DbNull,serverFingerprint:host.serverFingerprint}})
      let expires = 0
      if (scenario.startsWith('receipt-')) {
        expires = Date.now() + 2000
        const current = await prisma.host.findUniqueOrThrow({where:{id:host.id},include:hardeningIdentityInclude})
        await prisma.host.update({where:{id:host.id},data:{securityHardening:{revision:SECURITY_HARDENING_REVISION,status:'verified',phase:'finished',
          identityHash:hardeningIdentityHash(current),nextCheckAt:new Date(expires).toISOString()}}})
      }
      const order=await prisma.poolOrder.create({data:{id:randomUUID(),userId:user.id,requestHash:tag,totalCents:1200}})
      const instance=await prisma.instance.create({data:{name,incusId:name,userId:user.id,hostId:host.id,purchaseBatchId:order.id,dedicatedIpv4:true,
        status:'creating',cpu:200,memory:768,disk:30720,image:'debian/12',networkMode:'nat'}})
      const client=new IncusClient({...host,architecture})
      let fence:Awaited<ReturnType<typeof beginPoolProvision>>=null
      try {
        await client.connect()
        fence=await beginPoolProvision(instance.id,(await getHostById(host.id))!,client,name)
        assert.ok(fence)
        remote={name,type:'container',project:'default',created_at:new Date().toISOString(),status:'Running',profiles:[],
          config:{'volatile.uuid':randomUUID(),'user.payincus.provisioning-attempt':fence.attempt,'security.privileged':'false'},
          devices:{root:{type:'disk',path:'/',pool:'fixture'}}}
        await fence.identity()
        if(scenario==='stopped')remote.status='Stopped'
        if(scenario==='privileged')remote.config['security.privileged']='true'
        if(scenario==='wrong-type')remote.type='virtual-machine'
        if(scenario==='wrong-project')remote.project='foreign'
        if(scenario==='missing-created')delete remote.created_at
        if(scenario==='changed-created')remote.created_at='2020-01-01T00:00:00Z'
        if(scenario==='changed-pin')await prisma.host.update({where:{id:host.id},data:{serverFingerprint:'changed'}})
        if(scenario==='changed-management')await prisma.host.update({where:{id:host.id},data:{managementSshHost:'192.0.2.21'}})
        if(scenario==='install-pending')await prisma.host.update({where:{id:host.id},data:{installPending:true}})
        if(scenario==='maintenance')await prisma.host.update({where:{id:host.id},data:{securityHardening:{maintenance:{phase:'waiting-boot'}}}})
        if(scenario==='faulted')await prisma.host.update({where:{id:host.id},data:{poolFaulted:true}})
        if(scenario==='receipt-became-due')await new Promise(resolve=>setTimeout(resolve,Math.max(0,expires-Date.now()+25)))
        if(scenario==='receipt-invalidated')await prisma.host.update({where:{id:host.id},data:{securityHardening:{revision:SECURITY_HARDENING_REVISION,status:'retry',phase:'host-inspection'}}})
        const before=actions.length
        const valid = ['valid','receipt-became-due'].includes(scenario)
        if(valid)assert.equal((await fence.complete({status:'running',dedicatedNetworkReady:true})).count,1)
        else await assert.rejects(fence.complete({status:'running',dedicatedNetworkReady:true}))
        assert.equal((await prisma.instance.findUniqueOrThrow({where:{id:instance.id}})).status,valid?'running':'creating')
        assert.ok(actions.slice(before).every(action=>action.startsWith('GET ')),'completion never mutates the guest')
        console.log('PASS pool completion',architecture,scenario)
      } finally { fence?.finish(); await client.close(); await prisma.instance.delete({where:{id:instance.id}}) }
    }
  }
}catch(error){failure=error}
finally {
  await closeAllClients();await new Promise<void>(resolve=>server.close(()=>resolve()))
  await prisma.log.deleteMany({where:{userId:user.id}});await prisma.balanceLog.deleteMany({where:{userId:user.id}})
  await prisma.instance.deleteMany({where:{hostId:host.id}});await prisma.poolOrder.deleteMany({where:{userId:user.id}})
  await prisma.host.delete({where:{id:host.id}});await prisma.user.delete({where:{id:user.id}});await closePrismaDatabase()
  assert.ok(root.replaceAll('\\','/').startsWith(tmpdir().replaceAll('\\','/').replace(/\/$/,'')+'/'+tag))
  await rm(root,{recursive:true,force:true})
}
if(failure){console.error(failure);process.exitCode=1}
