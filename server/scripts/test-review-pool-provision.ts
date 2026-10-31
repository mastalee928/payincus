import assert from 'node:assert/strict'
import { randomUUID, X509Certificate } from 'node:crypto'
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
const { getHostById } = await import('../src/db/hosts.js')
const { closeAllClients } = await import('../src/lib/incus/incus-pool.js')
const tag='pool-provision-'+randomUUID(), root=await mkdtemp(join(tmpdir(),tag))
const keyPath=join(root,'key.pem'),certPath=join(root,'cert.pem')
execFileSync(process.env.REVIEW_OPENSSL || 'openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=incus-fixture','-addext','subjectAltName=IP:127.0.0.1','-keyout',keyPath,'-out',certPath],{stdio:'pipe',windowsHide:true})
const certificate=await readFile(certPath,'utf8'), actions:string[]=[]
let mode='existing', name='', currentId=0, remote: {name:string;status:string;config:Record<string,string>}|null=null
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
      remote={name,status:'Running',config:{...config.config,'volatile.uuid':randomUUID()}}
      if(mode==='lost-response')return fail(502,'response lost after creation')
      if(mode==='superseded')await prisma.instance.update({where:{id:currentId},data:{status:'running'}})
      if(mode==='timed-out')await failPoolProvision(currentId,null,'fixture timeout during creation')
      return ok()
    }
    if(path.includes('/files?')){if(mode==='replaced-before-cleanup'&&remote)remote.config['volatile.uuid']=randomUUID();return fail(500,'fixture initialization failed')}
    if(path==='/1.0/operations?recursion=1')return ok(mode==='pending'?{running:[{status:'Running',resources:{instances:[`/1.0/instances/${name}`]}}]}:{})
    if(path.startsWith('/1.0/networks'))return ok([])
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
  cpuAllowanceMax:200,memoryMax:768,storageSize:38,architecture:'x86_64',url:`https://127.0.0.1:${(server.address() as {port:number}).port}`,certPath,keyPath,serverCertificate:certificate,serverFingerprint:new X509Certificate(certificate).fingerprint256}})
let failure:unknown
try {
  for(const scenario of ['existing','confirmed','lost-response','delete-refused','uuid-changed','replaced-before-cleanup','pending','superseded','timed-out','prepared','unpaid','refund-failed']) {
    mode=scenario;name=tag+'-'+mode;actions.length=0
    await prisma.host.update({where:{id:host.id},data:{poolFaulted:false}})
    remote=mode==='existing'?{name,status:'Running',config:{'user.unrelated':'preserve'}}:null
    const order=await prisma.poolOrder.create({data:{id:randomUUID(),userId:user.id,requestHash:tag,totalCents:1200}})
    const instance=await prisma.instance.create({data:{name,incusId:name,userId:user.id,hostId:host.id,purchaseBatchId:order.id,dedicatedIpv4:true,status:'creating',cpu:200,memory:768,disk:30720,image:'debian/12',networkMode:'nat',snapshottedSpecs:{poolProvision:{version:1,phase:'prepared'}}}})
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
    assert.equal((await prisma.host.findUniqueOrThrow({where:{id:host.id}})).poolFaulted,mode!=='superseded','failed delivery quarantines its host')
    const shouldRefund=!['unpaid','superseded','refund-failed'].includes(mode)
    assert.equal(Number((await prisma.user.findUniqueOrThrow({where:{id:user.id}})).balance),before+(shouldRefund?12:0))
    assert.equal(await prisma.instanceBillingRecord.count({where:{instanceId:instance.id,type:'refund'}}),shouldRefund?1:0)
    const retain=['existing','delete-refused','uuid-changed','replaced-before-cleanup','pending','superseded','refund-failed'].includes(mode)
    if(retain) {
      if(mode==='existing') {
      assert.ok(remote,'a rejected same-name creation must preserve the unrelated remote instance')
      assert.ok(!actions.some(action=>action===`DELETE /1.0/instances/${name}`||action.startsWith('PUT ')))
      }
      assert.equal(current.provisioningCleanupPending,mode!=='superseded')
      assert.equal((await prisma.host.findUniqueOrThrow({where:{id:host.id}})).cpuUsed,200)
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
    if(mode==='delete-refused'||mode==='refund-failed'||mode==='pending') {
      mode='confirmed'
      await failPoolProvision(instance.id,(await getHostById(host.id))!,'retry cleanup')
      assert.equal((await prisma.instance.findUniqueOrThrow({where:{id:instance.id}})).status,'deleted')
      assert.equal(await prisma.instanceBillingRecord.count({where:{instanceId:instance.id,type:'refund'}}),1)
    } else if(!retain) {
      await failPoolProvision(instance.id,(await getHostById(host.id))!,'repeat compensation')
      assert.equal(actions.length,count,'completed compensation does not repeat remote actions')
    }
    await prisma.instance.delete({where:{id:instance.id}});console.log('PASS pool creation',scenario)
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
