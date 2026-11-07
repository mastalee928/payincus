import assert from 'node:assert/strict'
import { randomInt, randomUUID } from 'node:crypto'

const url=new URL(process.env.DATABASE_URL||'')
assert.equal(url.hostname,'127.0.0.1')
assert.ok(url.pathname.endsWith('_pool_test'))
// Imported process-local cache sweepers are not work this isolated test owns.
// Unref only timers installed during imports; remote/transaction waits retain
// their normal handles, and failures still end naturally with a nonzero exit.
const originalSetInterval=globalThis.setInterval
globalThis.setInterval=((...args:Parameters<typeof setInterval>)=>originalSetInterval(...args).unref()) as typeof setInterval
const {prisma,closePrismaDatabase}=await import('../src/db/prisma.js')
const {prepareAutomaticHostMaintenance,resumeAutomaticHostMaintenance}=await import('../src/services/host-security-maintenance.js')
const {hostMaintenanceDependencies}=await import('../src/services/host-security-maintenance.js')
const {hardeningIdentityHash}=await import('../src/lib/hardening-identity.js')
const {hostMaintenanceBlocked}=await import('../src/lib/host-maintenance-gate.js')
const {beginHostMutation,withHostMaintenanceLane}=await import('../src/lib/host-operation-lane.js')
const {maintenanceWireOperation}=await import('../src/services/host-maintenance-channel.js')
const {SECURITY_HARDENING_ENABLED_KEY,SECURITY_HARDENING_REVISION}=await import('../src/lib/security-hardening.js')
globalThis.setInterval=originalSetInterval
const prefix='maintenance-'+randomUUID().slice(0,8),recipe='alpine-apparmor-extlinux-v1'
const policy=await prisma.systemConfig.findUnique({where:{key:SECURITY_HARDENING_ENABLED_KEY}})
const admin=await prisma.user.create({data:{username:prefix,passwordHash:'fixture',role:'admin'}})
const batch=await prisma.hostOnboardingBatch.create({data:{id:randomUUID(),name:prefix,accountLabel:prefix,createdById:admin.id,defaults:{}}})
const hosts:number[]=[]
let held=false,losePrepare=false,loseReboot=false,loseRollback=false,failBeforeDispatch=false,mutateInventory=false,reportApparmor=true
let commands:string[]=[],reboots=0,currentBoot=randomUUID(),remotePhase='prepared'
const originalBoot=currentBoot,prepareHash='d'.repeat(64)
const preflight=(architecture:string)=>({architecture,bootId:currentBoot,pageSize:architecture==='aarch64'?65536:4096,
  memoryAvailableKiB:262144,memoryPressure:0,rootAvailableBytes:268435456,rootAvailableInodes:1024,rootReadonly:false,packageBusy:false,
  apparmorKernelSupport:true,apparmorBootDisabled:true,apparmorActive:false,bootloader:'extlinux' as const})
async function create(architecture:'x86_64'|'aarch64') {
  const ip=`10.253.212.${randomInt(24,220)}`
  let publicIp=''
  do {publicIp=`198.18.${randomInt(1,254)}.${randomInt(1,254)}`}
  while(await prisma.hostOnboardingNode.findFirst({where:{publicIp,deletedAt:null},select:{id:true}}))
  const host=await prisma.host.create({data:{userId:admin.id,name:prefix+hosts.length,url:`https://${ip}:8443`,singleTenant:true,
    isInstalled:true,status:'online',serverCertificate:'fixture-original-cert',serverFingerprint:'fixture-original-pin',
    managementSshHost:ip,managementSshPort:22,managementSshUser:'root',onboardingNode:{create:{batchId:batch.id,name:prefix+hosts.length,
      publicIp,managementIp:ip,sshPort:22,sshFingerprint:'SHA256:fixture-original',nodePublicKey:'A'.repeat(43)+'=',
      status:'succeeded',credentialsExpireAt:new Date(0)}}},include:{onboardingNode:{include:{batch:true}}}})
  hosts.push(host.id)
  await prisma.host.update({where:{id:host.id},data:{securityHardening:{revision:SECURITY_HARDENING_REVISION,status:'needs-maintenance',
    identityHash:hardeningIdentityHash(host),environment:preflight(architecture)}}})
  await prisma.hostAgent.create({data:{hostId:host.id,agentId:randomUUID(),secretHash:'fixture',secretEncrypted:'fixture',enabled:true,lastSeenAt:new Date()}})
  return host
}
const state=async(id:number)=>(await prisma.host.findUniqueOrThrow({where:{id}})).securityHardening as any
const deps={...hostMaintenanceDependencies,held:()=>held,accepted:(name:string,arch:string)=>name===recipe&&['x86_64','aarch64'].includes(arch),invalidate:async()=>{},
  command:async(target:any,operation:any)=>{
    const wire=maintenanceWireOperation(operation,target.onboardingNode.id,Date.now()+59000)
    assert.deepEqual(Object.keys(wire).sort(),['action','architecture','bootId','customers','expiresAt','identityHash','nodeId','prepareHash','recipe','requestId'])
    commands.push(operation.action)
    if(operation.action==='prepare'){
      if(losePrepare){losePrepare=false;throw Error('simulated lost preparation reply')}
    } else if(operation.action==='reboot'){
      if(failBeforeDispatch){failBeforeDispatch=false;throw Error('simulated stopped before remote dispatch')}
      if(remotePhase==='prepared'){remotePhase='reboot-intent';reboots++}
      if(loseReboot){loseReboot=false;throw Error('simulated lost reboot reply')}
    } else if(operation.action==='rollback'){
      assert.equal(currentBoot,wire.bootId);assert.equal(remotePhase,'prepared')
      remotePhase='rolled-back'
      if(loseRollback){loseRollback=false;throw Error('simulated lost rollback reply')}
    }
    return {nodeId:wire.nodeId,requestId:wire.requestId,identityHash:wire.identityHash,prepareHash,originalBootId:wire.bootId,
      bootId:currentBoot,architecture:wire.architecture,recipe,phase:remotePhase} as any
  },connect:async()=>({request:async(method:string,path:string)=>{
    assert.equal(method,'GET','empty-host maintenance makes no customer Incus mutation')
    if(path.startsWith('/1.0/operations'))return {}
    assert.match(path,/instances/)
    return mutateInventory?[{name:'unknown-customer'}]:[]
  }} as any),inspect:async(target:any,_guests:any,allowUpdate:boolean,allowed:()=>Promise<void>)=>{
    assert.equal(allowUpdate,false,'reconnect inspection never reapplies an SSH update')
    await allowed()
    const s=await state(target.id)
    return {preflight:{...preflight(s.maintenance.architecture),apparmorActive:true},apparmor:reportApparmor,alpine:true,fixed:true,
      branch:'3.22',guests:[],hostSshUpdated:false}
  }}
async function reset(hostId:number,architecture:'x86_64'|'aarch64') {
  currentBoot=originalBoot;remotePhase='prepared';commands=[];reboots=0
  const host=await prisma.host.findUniqueOrThrow({where:{id:hostId},include:{onboardingNode:{include:{batch:true}}}})
  await prisma.host.update({where:{id:hostId},data:{securityHardening:{revision:SECURITY_HARDENING_REVISION,status:'needs-maintenance',
    identityHash:hardeningIdentityHash(host),environment:preflight(architecture)}}})
}
async function arrive(hostId:number){currentBoot=randomUUID();await prisma.hostAgent.update({where:{hostId},data:{lastSeenAt:new Date(),lastReport:{metrics:{bootId:currentBoot}}}})}
try {
  await prisma.systemConfig.upsert({where:{key:SECURITY_HARDENING_ENABLED_KEY},update:{value:'true'},create:{key:SECURITY_HARDENING_ENABLED_KEY,value:'true'}})
  const arm=await create('aarch64'),amd=await create('x86_64')
  const release=beginHostMutation(arm.id)
  await assert.rejects(prepareAutomaticHostMaintenance(arm.id,deps),/HARDENING_BUSY/)
  assert.equal((await state(arm.id)).maintenance,undefined,'active API work blocks maintenance registration')
  release();release()
  await withHostMaintenanceLane(arm.id,async()=>{
    assert.throws(()=>beginHostMutation(arm.id),/安全维护/)
    await assert.rejects(withHostMaintenanceLane(arm.id,async()=>{}),/HARDENING_BUSY/)
  })
  await prepareAutomaticHostMaintenance(arm.id,{...deps,accepted:()=>false})
  assert.equal(commands.length,0);assert.equal((await state(arm.id)).maintenance,undefined,'unvalidated recipes stay inactive')
  losePrepare=true
  await prepareAutomaticHostMaintenance(arm.id,deps)
  assert.equal((await state(arm.id)).maintenance.prepareHash,'0'.repeat(64));assert.equal(reboots,0)
  failBeforeDispatch=true
  await resumeAutomaticHostMaintenance(arm.id,deps)
  const requestId=(await state(arm.id)).maintenance.requestId
  assert.equal((await state(arm.id)).maintenance.phase,'reboot-intent');assert.equal(remotePhase,'prepared');assert.equal(reboots,0)
  loseReboot=true
  await resumeAutomaticHostMaintenance(arm.id,deps)
  assert.equal(reboots,1,'persisted intent safely closes a crash-before-dispatch window')
  assert.equal((await state(arm.id)).maintenance.requestId,requestId)
  await resumeAutomaticHostMaintenance(arm.id,deps);await resumeAutomaticHostMaintenance(arm.id,deps)
  assert.equal(reboots,1,'a committed remote reboot barrier prevents repeated execution after lost replies')
  await assert.rejects(prepareAutomaticHostMaintenance(amd.id,deps),/BATCH_PAUSED/)
  assert.equal((await state(amd.id)).maintenance,undefined)
  held=true;await arrive(arm.id);const beforeHeld=commands.length
  await resumeAutomaticHostMaintenance(arm.id,deps);assert.equal(commands.length,beforeHeld,'restore protection prevents remote calls');held=false
  await prisma.hostAgent.update({where:{hostId:arm.id},data:{lastSeenAt:new Date(0)}})
  await resumeAutomaticHostMaintenance(arm.id,deps)
  assert.equal((await state(arm.id)).maintenance.error,'HARDENING_RECONNECT_INCOMPLETE')
  assert.equal(hostMaintenanceBlocked(await state(arm.id)),true)
  await prisma.hostAgent.update({where:{hostId:arm.id},data:{lastSeenAt:new Date()}})
  await prisma.hostAgent.update({where:{hostId:arm.id},data:{lastReport:{metrics:{bootId:originalBoot}}}})
  await resumeAutomaticHostMaintenance(arm.id,deps)
  assert.equal((await state(arm.id)).maintenance.error,'HARDENING_RECONNECT_INCOMPLETE','a fresh heartbeat from the old boot is insufficient')
  await prisma.hostAgent.update({where:{hostId:arm.id},data:{lastReport:{metrics:{bootId:currentBoot}}}})
  mutateInventory=true;await resumeAutomaticHostMaintenance(arm.id,deps);mutateInventory=false
  assert.equal((await state(arm.id)).maintenance.phase,'blocked','unknown remote customers cannot be treated as empty')
  await reset(arm.id,'aarch64');await prepareAutomaticHostMaintenance(arm.id,deps);await arrive(arm.id)
  const intent=(await state(arm.id)).maintenance
  await prisma.host.update({where:{id:arm.id},data:{securityHardening:{...await state(arm.id),maintenance:{...intent,
    phase:'blocked',startedAt:new Date(Date.now()-21*60000).toISOString(),deadline:new Date(Date.now()-60000).toISOString(),error:'HARDENING_RECONNECT_TIMEOUT'}}}})
  await resumeAutomaticHostMaintenance(arm.id,deps)
  assert.equal((await state(arm.id)).maintenance.phase,'verified','late original-identity boot gets read-only verification')
  assert.equal((await state(arm.id)).maintenance.error,undefined);assert.equal(reboots,1)
  await reset(amd.id,'x86_64');await prepareAutomaticHostMaintenance(amd.id,deps)
  assert.equal((await state(amd.id)).maintenance.architecture,'x86_64');assert.equal((await state(amd.id)).maintenance.phase,'waiting-boot')
  await arrive(amd.id);reportApparmor=false
  await resumeAutomaticHostMaintenance(amd.id,deps);assert.equal((await state(amd.id)).maintenance.error,'HARDENING_RECONNECT_INCOMPLETE')
  reportApparmor=true;await resumeAutomaticHostMaintenance(amd.id,deps)
  assert.equal((await state(amd.id)).maintenance.phase,'verified')
  // Real READ COMMITTED race: the initial include sees the old node while a
  // writer holds its newer management address; authorization must re-read all
  // identity fields after acquiring the node lock, before remote dispatch.
  await reset(amd.id,'x86_64')
  let nodeLocked!:()=>void,releaseNode!:()=>void
  const nodeReady=new Promise<void>(resolve=>{nodeLocked=resolve}),nodeGate=new Promise<void>(resolve=>{releaseNode=resolve})
  const writer=prisma.$transaction(async tx=>{
    await tx.hostOnboardingNode.update({where:{hostId:amd.id},data:{managementIp:'10.253.212.250'}})
    nodeLocked();await nodeGate
  },{timeout:10000})
  await nodeReady
  const attempted=assert.rejects(prepareAutomaticHostMaintenance(amd.id,deps),/HARDENING_IDENTITY_CHANGED/)
  try {
    let waiting=false
    for(let i=0;i<60;i++) {
      const rows=await prisma.$queryRaw<Array<{waiting:boolean}>>`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%host_onboarding_nodes%FOR SHARE%') AS waiting`
      if(rows[0]?.waiting){waiting=true;break}
      await new Promise(resolve=>setTimeout(resolve,20))
    }
    assert.ok(waiting,'observed actual authorization node-row lock wait')
  }finally{releaseNode()}
  await writer;await attempted
  assert.equal(commands.length,0,'changed current node identity prevents preparation and reboot dispatch')
  assert.equal((await state(amd.id)).maintenance,undefined)
  await prisma.hostOnboardingNode.update({where:{hostId:amd.id},data:{managementIp:amd.managementSshHost}})
  await reset(amd.id,'x86_64');losePrepare=true;await prepareAutomaticHostMaintenance(amd.id,deps)
  const expired=(await state(amd.id)).maintenance
  await prisma.host.update({where:{id:amd.id},data:{securityHardening:{...await state(amd.id),maintenance:{...expired,
    startedAt:new Date(Date.now()-21*60000).toISOString(),deadline:new Date(Date.now()-60000).toISOString()}}}})
  loseRollback=true;await resumeAutomaticHostMaintenance(amd.id,deps)
  assert.equal(remotePhase,'rolled-back');assert.equal(reboots,0)
  await resumeAutomaticHostMaintenance(amd.id,deps)
  assert.equal((await state(amd.id)).maintenance.phase,'aborted','lost rollback reply resumes from the same remote journal')
  assert.equal(hostMaintenanceBlocked(await state(amd.id)),false)
  await reset(amd.id,'x86_64');failBeforeDispatch=true;await prepareAutomaticHostMaintenance(amd.id,deps)
  await prisma.user.update({where:{id:admin.id},data:{role:'user'}})
  const revoked=commands.length;await resumeAutomaticHostMaintenance(amd.id,deps)
  assert.equal(commands.length,revoked);assert.equal((await state(amd.id)).maintenance.error,'HARDENING_ADMIN_REQUIRED')
  await prisma.user.update({where:{id:admin.id},data:{role:'admin'}})
  await prisma.systemConfig.update({where:{key:SECURITY_HARDENING_ENABLED_KEY},data:{value:'false'}})
  await resumeAutomaticHostMaintenance(amd.id,deps);assert.equal(commands.length,revoked)
  await prisma.systemConfig.update({where:{key:SECURITY_HARDENING_ENABLED_KEY},data:{value:'true'}})
  await prisma.host.update({where:{id:amd.id},data:{serverFingerprint:'fixture-changed-pin'}})
  await resumeAutomaticHostMaintenance(amd.id,deps);assert.equal(commands.length,revoked)
  assert.equal((await state(amd.id)).maintenance.phase,'blocked')
  const after=await prisma.host.findUniqueOrThrow({where:{id:arm.id}})
  for(const key of ['url','userId','managementSshHost','managementSshPort','managementSshUser','serverCertificate','serverFingerprint'] as const)assert.equal(after[key],arm[key],key+' preserved')
  console.log('PASS isolated PostgreSQL maintenance: AMD64/ARM64, exact protocol, lost prepare/reboot replies, crash-before-dispatch, single reboot, durable global fence, late boot, stale Agent/unknown inventory, restore hold, revoked actor/policy/pin and unchanged host identity; no native reboot acceptance')
}finally{
  await prisma.host.deleteMany({where:{id:{in:hosts}}})
  await prisma.hostOnboardingBatch.delete({where:{id:batch.id}})
  await prisma.user.delete({where:{id:admin.id}})
  if(policy)await prisma.systemConfig.update({where:{key:policy.key},data:{value:policy.value}})
  else await prisma.systemConfig.deleteMany({where:{key:SECURITY_HARDENING_ENABLED_KEY}})
  await closePrismaDatabase()
}
