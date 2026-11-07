import assert from 'node:assert/strict'
import { randomUUID, X509Certificate } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:https'

const database=new URL(process.env.DATABASE_URL||'')
assert.equal(database.hostname,'127.0.0.1');assert.ok(database.pathname.endsWith('_pool_test'))
const originalSetInterval=globalThis.setInterval
globalThis.setInterval=((...args:Parameters<typeof setInterval>)=>originalSetInterval(...args).unref()) as typeof setInterval
const {prisma,closePrismaDatabase}=await import('../src/db/prisma.js')
const {captureCustomerBootBaseline,recoverCustomerAfterBoot}=await import('../src/services/customer-boot-recovery.js')
const {IncusClient}=await import('../src/lib/incus/incus-client.js')
const {withHostMaintenanceLane}=await import('../src/lib/host-operation-lane.js')
const {encryptSensitiveData}=await import('../src/lib/security.js')
const {managedCleanupEndpointHash}=await import('../src/lib/managed-cleanup-identity.js')
const {alpineSshMaintenanceDependencies}=await import('../src/services/alpine-ssh-maintenance.js')
const {alpineSshFingerprintInspectionCommand}=await import('../src/lib/alpine-ssh-security.js')
const {hostMaintenanceDependencies,prepareAutomaticHostMaintenance,resumeAutomaticHostMaintenance}=await import('../src/services/host-security-maintenance.js')
const {SECURITY_HARDENING_ENABLED_KEY,SECURITY_HARDENING_REVISION}=await import('../src/lib/security-hardening.js')
const {hardeningIdentityHash}=await import('../src/lib/hardening-identity.js')
const {hostMaintenanceBlocked}=await import('../src/lib/host-maintenance-gate.js')
globalThis.setInterval=originalSetInterval
const root=await mkdtemp(join(tmpdir(),'customer-boot-'))
const key=join(root,'key.pem'),cert=join(root,'cert.pem')
execFileSync(process.env.REVIEW_OPENSSL||'openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1',
  '-subj','/CN=customer-boot','-addext','subjectAltName=IP:127.0.0.1','-keyout',key,'-out',cert],{stdio:'pipe',windowsHide:true})
const certificate=await readFile(cert,'utf8'),name='customer-'+randomUUID().slice(0,8),uuid=randomUUID(),attempt=randomUUID()
let remoteState='Running',remoteUuid=uuid,privileged='false',autostart='false',diskPool='original',networkIp='10.44.0.2'
let remoteType='container',loseStart=false,denyStart=false,startCalls=0,stopCalls=0,logins=0
let ephemeral:unknown=false
let oversizedProbe=false
const calls:string[]=[],originalFingerprint='SHA256:'+'A'.repeat(43)
const remoteConfig=()=>({'volatile.uuid':remoteUuid,'user.payincus.provisioning-attempt':attempt,'security.privileged':privileged,
  'boot.autostart':autostart,'limits.memory':'256MiB','volatile.eth0.hwaddr':'00:16:3e:11:22:33'})
const server=createServer({key:await readFile(key),cert:certificate,ca:certificate,requestCert:true,rejectUnauthorized:true},async(request,response)=>{
  assert.ok((request.socket as any).authorized,'actual pinned mTLS')
  const send=(metadata:unknown)=>{response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({type:'sync',metadata}))}
  const path=request.url||'';calls.push(`${request.method} ${path}`)
  if(path==='/1.0')return send({api_version:'1.0'})
  if(path==='/1.0/instances?recursion=1&all-projects=true')return send([{name,status:remoteState,project:'default'}])
  if(path==='/1.0/operations?recursion=1')return send({})
  if(path===`/1.0/instances/${name}`)return send({name,type:remoteType,ephemeral,status:remoteState,config:remoteConfig(),profiles:[],
    devices:{root:{type:'disk',path:'/',pool:diskPool},eth0:{type:'nic',network:'incusbr0'}},expanded_config:remoteConfig()})
  if(path===`/1.0/instances/${name}/state`&&request.method==='GET')return send({status:remoteState,pid:remoteState==='Running'?123:0})
  if(path===`/1.0/instances/${name}/state`&&request.method==='PUT') {
    let body='';for await(const chunk of request)body+=chunk
    const action=JSON.parse(body)
    if(action.action==='stop') {
      assert.deepEqual(action,{action:'stop',timeout:30,force:false});stopCalls++;remoteState='Stopped';return send({})
    }
    assert.deepEqual(action,{action:'start',timeout:30});startCalls++
    if(denyStart){response.writeHead(500);return response.end(JSON.stringify({type:'error',error:'fixed fixture failure'}))}
    remoteState='Running'
    if(loseStart)return response.destroy()
    return send({})
  }
  if(path==='/1.0/networks/incusbr0')return send({config:{'ipv4.address':'10.44.0.1/24','ipv4.nat':'true'}})
  if(path==='/1.0/networks/incusbr0/forwards?recursion=1')return send([{description:`payincus-dedicated:${name}`,listen_address:'192.0.2.10',config:{target_address:networkIp},ports:[]}])
  if(path===`/1.0/instances/${name}/exec`&&request.method==='POST') {
    let body='';for await(const chunk of request)body+=chunk
    assert.deepEqual(JSON.parse(body),{command:['sh','-c',alpineSshFingerprintInspectionCommand],'wait-for-websocket':false,interactive:false,'record-output':true})
    return send({return:0,output:{'1':`/1.0/instances/${name}/logs/inspection`}})
  }
  if(path===`/1.0/instances/${name}/logs/inspection`) {
    response.writeHead(200,{'content-type':'text/plain'});return response.end(oversizedProbe?'x'.repeat(65537):`INCUDAL_ALPINE_SSH_FIXED\n256 ${originalFingerprint} root (ED25519)\n`)
  }
  response.writeHead(404);response.end(JSON.stringify({type:'error',error:'unexpected fixture path'}))
})
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
const owner=await prisma.user.create({data:{username:name,passwordHash:'fixture',role:'admin'}})
const host=await prisma.host.create({data:{userId:owner.id,name,url:`https://127.0.0.1:${(server.address() as {port:number}).port}`,
  certPath:cert,keyPath:key,serverCertificate:certificate,serverFingerprint:new X509Certificate(certificate).fingerprint256}})
const client=new IncusClient({...host})
await client.connect()
const customer=await prisma.instance.create({data:{hostId:host.id,userId:owner.id,name,incusId:name,status:'running',image:'fixture/alpine',
  cpu:100,memory:256,disk:1024,rootPassword:encryptSensitiveData('original-fixture-password'),sshPort:22,ipv4:networkIp,
  snapshottedSpecs:{managedCleanup:{uuid,attempt,endpointHash:managedCleanupEndpointHash(client)}}}})
const deps={inspect:alpineSshMaintenanceDependencies.inspect,
  login:async(publicHost:string,password:string,fingerprints:string|string[],port?:number)=>{
    assert.equal(publicHost,'192.0.2.10');assert.equal(password,'original-fixture-password');assert.deepEqual(fingerprints,[originalFingerprint]);assert.equal(port,22);logins++
  }}
let held=false,batchId:string|undefined,hadPolicy=false,authorizationDelayUntil=0
const originalPolicy=await prisma.systemConfig.findUnique({where:{key:SECURITY_HARDENING_ENABLED_KEY}})
const allowed=async()=>{
  if(held)throw Error('HARDENING_RECOVERY_HELD')
  if(authorizationDelayUntil>Date.now())await new Promise(resolve=>setTimeout(resolve,authorizationDelayUntil-Date.now()))
}
const recover=(before:Awaited<ReturnType<typeof captureCustomerBootBaseline>>,bootPolicyRestored=false)=>withHostMaintenanceLane(host.id,()=>prisma.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM hosts WHERE id=${host.id} FOR UPDATE`
  return recoverCustomerAfterBoot(tx,client.withMaintenanceDatabase(tx),before,allowed,'192.0.2.10',deps,bootPolicyRestored)
},{timeout:60000}))
try {
  const before=await captureCustomerBootBaseline(client,customer,'192.0.2.10',deps)
  for(const value of [true,undefined,'false',0]) {
    ephemeral=value
    await assert.rejects(captureCustomerBootBaseline(client,customer,'192.0.2.10',deps),/BOOT_RECOVERY_UNVERIFIED/)
  }
  ephemeral=false
  oversizedProbe=true;await assert.rejects(captureCustomerBootBaseline(client,customer,'192.0.2.10',deps),/INCUS_FILE_TOO_LARGE/);oversizedProbe=false
  assert.equal(logins,1);assert.doesNotMatch(JSON.stringify(before),/password|192\.0\.2|00:16:3e/)
  await prisma.host.update({where:{id:host.id},data:{securityHardening:{maintenance:{phase:'waiting-boot'}}}})
  for(const status of ['Running','Stopped'])for(const value of [true,undefined,'false',0]) {
    remoteState=status;ephemeral=value
    await assert.rejects(recover(before),/BOOT_RECOVERY_UNVERIFIED/)
    assert.equal(startCalls,0);assert.equal(stopCalls,0,'ephemeral or unknown persistence cannot reach a lifecycle mutation')
  }
  ephemeral=false;remoteState='Stopped'
  await assert.rejects(client.request('PUT',`/1.0/instances/${name}/state`,{action:'start',timeout:30}),/安全维护/)
  const capability=client.withMaintenanceStart(name,allowed)
  for(const [method,path,body] of [['DELETE',`/1.0/instances/${name}`,null],['PUT',`/1.0/instances/${name}`,{config:{}}],
    ['POST',`/1.0/instances/${name}/exec`,{command:['id']}],['PUT','/1.0/instances/other/state',{action:'start',timeout:30}],
    ['PUT',`/1.0/instances/${name}/state`,{action:'stop',timeout:30}]] as const) {
    const count=calls.length;await assert.rejects(capability.request(method,path,body),/HARDENING_IDENTITY_CHANGED/);assert.equal(calls.length,count)
  }
  const stopCapability=client.withMaintenanceStop(name,allowed)
  for(const body of [{action:'start',timeout:30},{action:'stop',timeout:30,force:true},{action:'stop',timeout:60,force:false}]) {
    const count=calls.length;await assert.rejects(stopCapability.request('PUT',`/1.0/instances/${name}/state`,body),/HARDENING_IDENTITY_CHANGED/);assert.equal(calls.length,count)
  }
  const inspection=client.withMaintenanceSshInspection(name,allowed)
  const inspectionBody={command:['sh','-c',alpineSshFingerprintInspectionCommand],'wait-for-websocket':false,interactive:false,'record-output':true}
  for(const [path,body] of [[`/1.0/instances/${name}/exec`,{...inspectionBody,environment:{PATH:'/tmp'}}],
    [`/1.0/instances/${name}/exec`,{...inspectionBody,command:['sh','-c','reboot']}],
    ['/1.0/instances/other/exec',inspectionBody],[`/1.0/instances/${name}/state`,{action:'start',timeout:30}]] as const) {
    const count=calls.length;await assert.rejects(inspection.request('POST',path,body),/HARDENING_IDENTITY_CHANGED/);assert.equal(calls.length,count)
  }
  loseStart=true;await assert.rejects(recover(before));assert.equal(startCalls,1);assert.equal(remoteState,'Running')
  loseStart=false;assert.equal((await recover(before)).state,'running');assert.equal(startCalls,1,'lost start receipt cannot repeat a running instance start')
  assert.equal((await prisma.instance.findUniqueOrThrow({where:{id:customer.id}})).rootPassword,customer.rootPassword)
  remoteState='Stopped';held=true;await assert.rejects(recover(before),/RECOVERY_HELD/);held=false;assert.equal(startCalls,1)
  const expiresAt=new Date(Date.now()+1500)
  await prisma.instance.update({where:{id:customer.id},data:{expiresAt}})
  authorizationDelayUntil=expiresAt.getTime()+25
  await assert.rejects(recover(before),/HARDENING_BUSY/,'expiry crossing during authority check blocks the actual start request')
  authorizationDelayUntil=0;assert.equal(startCalls,1)
  await prisma.instance.update({where:{id:customer.id},data:{expiresAt:null}})
  await prisma.instance.update({where:{id:customer.id},data:{status:'stopped'}})
  assert.equal((await recover(before)).state,'stopped');assert.equal(startCalls,1,'new stop intent overrides old running baseline')
  await prisma.instance.update({where:{id:customer.id},data:{status:'running',expiresAt:new Date(Date.now()-1000)}})
  assert.equal((await recover(before)).state,'stopped');assert.equal(startCalls,1)
  await prisma.instance.update({where:{id:customer.id},data:{expiresAt:new Date(Date.now()+60000),deletionIntent:{phase:'requested'}}})
  assert.equal((await recover(before)).state,'stopped');assert.equal(startCalls,1)
  await prisma.instance.update({where:{id:customer.id},data:{deletionIntent:(await import('@prisma/client')).Prisma.DbNull}})
  for(const change of ['uuid','disk','network','privilege'] as const) {
    remoteUuid=change==='uuid'?randomUUID():uuid;diskPool=change==='disk'?'changed':'original';networkIp=change==='network'?'10.44.0.3':'10.44.0.2';privileged=change==='privilege'?'true':'false'
    await assert.rejects(recover(before));assert.equal(startCalls,1,'changed original identity/config never starts')
  }
  remoteUuid=uuid;diskPool='original';networkIp='10.44.0.2';privileged='false'
  const stopped=await prisma.instance.update({where:{id:customer.id},data:{status:'stopped'}})
  const stoppedBaseline=await captureCustomerBootBaseline(client,stopped,'192.0.2.10',deps)
  assert.equal((await recover(stoppedBaseline)).state,'stopped');assert.equal(startCalls,1)
  const suspended=await prisma.instance.update({where:{id:customer.id},data:{status:'suspended'}})
  const suspendedBaseline=await captureCustomerBootBaseline(client,suspended,'192.0.2.10',deps)
  assert.equal((await recover(suspendedBaseline)).state,'stopped');assert.equal(startCalls,1,'platform suspension never restarts')
  remoteState='Frozen';await assert.rejects(captureCustomerBootBaseline(client,suspended,'192.0.2.10',deps),/HARDENING_BUSY/)
  remoteState='Stopped';await prisma.instance.update({where:{id:customer.id},data:{status:'stopped'}})
  autostart='true';const enabledBaseline=await captureCustomerBootBaseline(client,stopped,'192.0.2.10',deps)
  assert.equal(enabledBaseline.boot!.autostart,'true')
  await assert.rejects(recover(enabledBaseline),/IDENTITY_CHANGED/,'enabled autostart cannot be assumed prepared')
  autostart='false';assert.equal((await recover(enabledBaseline)).state,'stopped')
  autostart='true';assert.equal((await recover(enabledBaseline,true)).state,'stopped','lost restore receipt uses matching original boot policy')
  autostart='false'
  remoteType='virtual-machine';await assert.rejects(captureCustomerBootBaseline(client,stopped,'192.0.2.10',deps),/VM_RUNTIME_UNVERIFIED/);remoteType='container'
  await prisma.instance.update({where:{id:customer.id},data:{status:'running'}})
  await prisma.instance.update({where:{id:customer.id},data:{expiresAt:new Date(Date.now()-1000)}})
  await prisma.user.update({where:{id:owner.id},data:{status:'banned'}})
  remoteState='Running'
  assert.equal((await recover(before)).state,'stopped');assert.equal(stopCalls,1);assert.equal(startCalls,1)
  await prisma.user.update({where:{id:owner.id},data:{status:'active'}})
  assert.equal((await recover(before)).state,'stopped','current expiry never starts the original')
  await prisma.instance.update({where:{id:customer.id},data:{expiresAt:new Date(Date.now()+60000)}})
  const task=await prisma.instanceTask.create({data:{hostId:host.id,instanceId:customer.id,userId:owner.id,taskType:'rebuild',status:'PENDING'}})
  assert.equal((await recover(before)).state,'stopped');assert.equal(startCalls,1)
  assert.equal((await prisma.instanceTask.findUniqueOrThrow({where:{id:task.id}})).status,'PENDING','normal worker retains latest intent')
  await prisma.instanceTask.delete({where:{id:task.id}})
  // Actual host coordinator + real PG/mTLS customer recovery. The remote boot,
  // kernel and process-label report are explicit fixtures, never native proof.
  batchId=randomUUID()
  await prisma.hostOnboardingBatch.create({data:{id:batchId,name,accountLabel:'isolated-v7',createdById:owner.id,defaults:{}}})
  const node=await prisma.hostOnboardingNode.create({data:{batchId,hostId:host.id,name,managementIp:'10.253.242.2',publicIp:'192.0.2.10',sshPort:22,
    nodePublicKey:'A'.repeat(43)+'=',sshFingerprint:originalFingerprint,status:'succeeded',credentialsExpireAt:new Date(0)}})
  const managedHost=await prisma.host.update({where:{id:host.id},data:{singleTenant:true,isInstalled:true,status:'online',natPublicIp:'192.0.2.10',cpuAllowanceMax:100,memoryMax:256,
    managementSshHost:node.managementIp,managementSshPort:22,managementSshUser:'root'},include:{onboardingNode:{include:{batch:true}}}})
  hadPolicy=true
  await prisma.systemConfig.upsert({where:{key:SECURITY_HARDENING_ENABLED_KEY},update:{value:'true'},create:{key:SECURITY_HARDENING_ENABLED_KEY,value:'true'}})
  const oldBoot=randomUUID();let newBoot=oldBoot,phase='prepared',hostReboots=0,failedReport=true,loseRestore=true
  autostart='true';remoteState='Running'
  const environment=()=>({architecture:'aarch64',bootId:newBoot,pageSize:65536,memoryAvailableKiB:262144,memoryPressure:0,rootAvailableBytes:268435456,
    rootAvailableInodes:1024,rootReadonly:false,packageBusy:false,apparmorKernelSupport:true,apparmorBootDisabled:true,apparmorActive:false,bootloader:'extlinux' as const})
  await prisma.host.update({where:{id:host.id},data:{securityHardening:{revision:SECURITY_HARDENING_REVISION,status:'needs-maintenance',
    identityHash:hardeningIdentityHash(managedHost),environment:environment()}}})
  await prisma.hostAgent.create({data:{hostId:host.id,agentId:randomUUID(),secretHash:'fixture',secretEncrypted:'fixture',enabled:true,lastSeenAt:new Date()}})
  const coordinator={...hostMaintenanceDependencies,held:()=>held,accepted:()=>true,invalidate:async()=>{},connect:async(_host:any,tx:any)=>client.withMaintenanceDatabase(tx),
    capture:(c:any,i:any,h:string,_deps?:any,a?:()=>Promise<void>)=>captureCustomerBootBaseline(c,i,h,deps,a),
    recover:(tx:any,c:any,b:any,a:()=>Promise<void>,h:string,_deps?:any,restored?:boolean)=>recoverCustomerAfterBoot(tx,c,b,a,h,deps,restored),
    command:async(_host:any,operation:any)=>{
      if(operation.action==='prepare')autostart='false'
      if(operation.action==='reboot'&&phase==='prepared'){phase='reboot-intent';remoteState='Stopped';hostReboots++}
      if(operation.action==='restore-customers'){
        autostart='true';phase='customers-restored'
        if(loseRestore){loseRestore=false;throw Error('lost boot policy restoration reply')}
      }
      return {nodeId:node.id,requestId:operation.requestId,identityHash:operation.identityHash,prepareHash:'e'.repeat(64),
        originalBootId:oldBoot,bootId:newBoot,architecture:'aarch64',recipe:operation.recipe,phase} as any
    },inspect:async(_host:any,guests:any,update:boolean,a:()=>Promise<void>)=>{
      assert.equal(update,false);await a()
      return {preflight:{...environment(),apparmorActive:true},apparmor:!failedReport,alpine:true,fixed:true,branch:'3.22',hostSshUpdated:false,
        guests:guests.map((guest:any)=>({...guest,uidMap:'0 1000000 65536',gidMap:'0 1000000 65536',seccomp:2,apparmor:'incus-fixture (enforce)'}))}
    }}
  await prepareAutomaticHostMaintenance(host.id,coordinator);assert.equal(hostReboots,1);assert.equal(autostart,'false')
  newBoot=randomUUID();await prisma.hostAgent.update({where:{hostId:host.id},data:{lastSeenAt:new Date(),lastReport:{metrics:{bootId:newBoot}}}})
  await resumeAutomaticHostMaintenance(host.id,coordinator)
  const partial=await prisma.host.findUniqueOrThrow({where:{id:host.id}})
  assert.equal(phase,'reboot-intent');assert.equal(autostart,'false');assert.equal(hostMaintenanceBlocked(partial.securityHardening),true,'failed kernel report keeps durable boot policy fence')
  const starts=startCalls;failedReport=false;await resumeAutomaticHostMaintenance(host.id,coordinator)
  assert.equal(phase,'customers-restored');assert.equal(autostart,'true')
  assert.equal(hostMaintenanceBlocked((await prisma.host.findUniqueOrThrow({where:{id:host.id}})).securityHardening),true,'lost restoration reply keeps DB fence')
  await resumeAutomaticHostMaintenance(host.id,coordinator)
  assert.equal(hostMaintenanceBlocked((await prisma.host.findUniqueOrThrow({where:{id:host.id}})).securityHardening),false)
  assert.equal(hostReboots,1);assert.equal(startCalls,starts,'lost final report does not start or reboot again')
  const current=await prisma.instance.findUniqueOrThrow({where:{id:customer.id}})
  for(const key of ['userId','hostId','incusId','rootPassword','cpu','memory','disk','ipv4','snapshottedSpecs'] as const)assert.deepEqual(current[key],customer[key])
  console.log('PASS customer boot recovery: real PostgreSQL/pinned mTLS, exact start/stop/read-only SSH capabilities, lost reply no duplicate, current stop/delete/expiry/hold/owner and queued intent, original password/config/network hashes, stopped remains stopped, explicit autostart prepare/restored receipt, full host coordinator/final-report failure continuation, unsafe/VM rejection; no native kernel or boot acceptance')
} finally {
  await client.close();await new Promise<void>(resolve=>server.close(()=>resolve()))
  await prisma.instance.delete({where:{id:customer.id}});await prisma.host.delete({where:{id:host.id}});await prisma.user.delete({where:{id:owner.id}})
  if(batchId)await prisma.hostOnboardingBatch.delete({where:{id:batchId}})
  if(hadPolicy){if(originalPolicy)await prisma.systemConfig.update({where:{key:originalPolicy.key},data:{value:originalPolicy.value}})
    else await prisma.systemConfig.deleteMany({where:{key:SECURITY_HARDENING_ENABLED_KEY}})}
  await closePrismaDatabase();await rm(root,{recursive:true,force:true})
}
