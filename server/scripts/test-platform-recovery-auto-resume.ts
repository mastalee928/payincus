import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {mkdtemp,rm,unlink,mkdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import Fastify from 'fastify'
import {parse as parseEnv} from 'dotenv'
const url=new URL(process.env.DATABASE_URL||'')
assert.ok(url.hostname==='127.0.0.1' && url.port==='55449' && url.pathname.endsWith('_recovery_test'))
process.env.NODE_ENV='test';process.env.JWT_SECRET='isolated-recovery-auto-test-secret'
const folder=await mkdtemp(join(tmpdir(),'incudal-recovery-auto-'));process.env.PLATFORM_BACKUP_STATE_DIR=folder
const {prisma,closePrismaDatabase}=await import('../src/db/prisma.js')
const core=await import('../src/services/platform-backup-core.js')
const state=await import('../src/services/platform-recovery-state.js')
const {autoResumeRecovery,recoveryResumeSource}=await import('../src/services/platform-recovery-auto-resume.js')
const batchId=randomUUID(),createdAt=new Date(Date.now()-10000).toISOString()
let business:Awaited<ReturnType<typeof import('./fixtures/recovery-business.js').recoveryBusinessFixture>>|undefined
try{
  await core.initBackupState()
  const actor=await prisma.user.create({data:{username:'recovery-actor',passwordHash:'unusable-test-hash',role:'admin'}})
  const admin=await prisma.user.create({data:{username:'restored-admin',passwordHash:'unusable-test-hash',role:'admin'}})
  await prisma.platformRecoveryBatch.create({data:{id:batchId,holdTaskId:batchId,mode:'restore',operatorId:actor.id}})
  await (await import('./fixtures/recovery-delivery.js')).verifySnapshotDelivery(batchId,admin.id)
  const hold={taskId:batchId,batchId,createdAt,mode:'restore',autoResume:true}
  await core.writeJson(join(folder,'recovery-hold.json'),hold)
  const host=await prisma.host.create({data:{name:'original-host',userId:admin.id,url:'https://192.0.2.1:8443',poolFaulted:true}})
  const sourceHash=await state.recoveryHostSourceHash(host.id)
  await prisma.platformRecoveryHost.create({data:{batchId,hostId:host.id,status:'success',sourceHash,checkedAt:new Date()}})
  const {generateAgentId,generateAgentSecret,hashAgentSecret,createAgentBodyHash,createAgentSignature}=await import('../src/lib/agent-auth.js')
  const {encryptSensitiveData,decryptSensitiveData}=await import('../src/lib/security.js')
  const {mergeBackupEnvironment}=await import('../src/services/platform-backup-environment.js')
  process.env.ENCRYPTION_KEY='original-isolated-controller-key'
  const agentId=generateAgentId(),agentSecret=generateAgentSecret(),secretEncrypted=encryptSensitiveData(agentSecret)
  await prisma.hostAgent.create({data:{hostId:host.id,agentId,secretHash:hashAgentSecret(agentSecret),secretEncrypted,enabled:true,status:'offline'}})
  process.env.ENCRYPTION_KEY='new-isolated-controller-key'
  assert.notEqual(decryptSensitiveData(secretEncrypted),agentSecret,'fresh controller key cannot decrypt the original Agent secret')
  process.env.ENCRYPTION_KEY=parseEnv(mergeBackupEnvironment('ENCRYPTION_KEY=new-isolated-controller-key','ENCRYPTION_KEY=original-isolated-controller-key')).ENCRYPTION_KEY
  assert.equal(decryptSensitiveData(secretEncrypted),agentSecret,'restored original encryption key decrypts existing Agent credentials without rotation')
  business=await (await import('./fixtures/recovery-business.js')).recoveryBusinessFixture(host.id,admin.id)
  await business.held()
  await prisma.platformRecoveryHost.update({where:{batchId_hostId:{batchId,hostId:host.id}},data:{sourceHash:await state.recoveryHostSourceHash(host.id)}})
  const evidence=async(category:string,payload:object={},hash?:string)=>prisma.platformRecoveryEvidence.create({data:{
    batchId,category,reference:randomUUID(),sourceHash:hash||await state.recoveryDatasetHash(category as any),
    evidenceHash:'a'.repeat(64),observedAt:new Date(),actorId:actor.id,payload}})
  let now=Date.now(),calls:string[]=[],active=false,mode='ok'
  const runtime={now:()=>now,ready:()=>true,active:async()=>active?{id:calls.at(-1)!} as any:null,
    enqueue:async(_kind:unknown,_actor:unknown,_extras:unknown,id?:string)=>{
      assert.ok(id);calls.push(id);active=true
      if(mode==='timeout')throw Object.assign(new Error('not exposed'),{code:'OSS_WORKER_START_FAILED'})
      return {id} as any
    }}
  await autoResumeRecovery(runtime);assert.equal(calls.length,0,'missing evidence keeps billing held')
  const {saveRestoredSnapshot}=await import('../src/services/platform-recovery-snapshot.js')
  const snapshotHold={...hold,restorePolicy:'snapshot-v1',snapshot:{createdAt,version:'1.8.0'}}
  await core.writeJson(join(folder,'recovery-hold.json'),snapshotHold)
  assert.equal((await state.recoveryReadiness()).categories.find(row=>row.category==='finance')?.code,'OSS_RECOVERY_SNAPSHOT_RECEIPT_MISSING')
  await saveRestoredSnapshot(batchId,createdAt,url.pathname.slice(1))
  const restored=await state.recoveryReadiness()
  assert.equal(restored.categories.filter(row=>row.category!=='gateway').every(row=>row.verified),true,'selected snapshot restoration needs no manual post-snapshot evidence')
  assert.equal(restored.ready,false,'current gateway is still verified by the program')
  await prisma.user.update({where:{id:admin.id},data:{balance:1}})
  assert.equal((await state.recoveryReadiness()).categories.find(row=>row.category==='finance')?.code,'OSS_RECOVERY_SNAPSHOT_CHANGED')
  await prisma.user.update({where:{id:admin.id},data:{balance:0}})
  const snapshotPath=join(folder,'results',`snapshot-${batchId}.json`)
  const saved=await core.readJson<any>(snapshotPath)
  await core.writeJson(snapshotPath,{...saved,databaseOid:saved.databaseOid+1})
  assert.equal((await state.recoveryReadiness()).categories.find(row=>row.category==='finance')?.verified,false,'receipt for another database cannot release this restore')
  await core.writeJson(snapshotPath,saved)
  await evidence('gateway')
  assert.equal((await state.recoveryReadiness()).ready,true,'snapshot and automatic host/gateway checks require no human attestation')
  await prisma.platformRecoveryEvidence.deleteMany({where:{batchId,category:'gateway'}})
  await core.writeJson(join(folder,'recovery-hold.json'),hold)
  for(const category of state.RECOVERY_CATEGORIES)await evidence(category)
  assert.equal((await state.recoveryReadiness()).ready,true)
  const pendingMap=await evidence('gateway-map-intent',{status:'retry'},'a'.repeat(64))
  assert.equal((await state.recoveryReadiness()).ready,false,'accepted mapping must finish before recovery can release')
  await autoResumeRecovery(runtime);assert.equal(calls.length,0)
  await prisma.platformRecoveryEvidence.update({where:{id:pendingMap.id},data:{payload:{status:'verified'}}})
  assert.equal((await state.recoveryReadiness()).ready,true)
  await core.writeJson(join(folder,'recovery-hold.json'),{...hold,autoResume:false})
  await autoResumeRecovery(runtime);assert.equal(calls.length,0,'legacy holds do not acquire automatic authorization')
  await core.writeJson(join(folder,'recovery-hold.json'),hold)
  await Promise.all([autoResumeRecovery(runtime),autoResumeRecovery(runtime)])
  assert.equal(calls.length,1,'simultaneous ticks create one task')
  await autoResumeRecovery(runtime);assert.equal(calls.length,1)
  const firstHash=await recoveryResumeSource(batchId,await state.recoveryReadiness(),true)
  await evidence('host-check',{hostId:host.id,managementVerified:true,inventory:{inventoryMatched:true}},sourceHash)
  assert.equal(await recoveryResumeSource(batchId,await state.recoveryReadiness(),true),firstHash,'routine successes do not reset backoff')
  active=false
  await core.writeJson(join(folder,'results',`${calls[0]}.json`),{status:'failed',error:'OSS_RECOVERY_FINAL_HOST_CHECK_FAILED'})
  await autoResumeRecovery(runtime);now+=3600000;await autoResumeRecovery(runtime)
  assert.equal(calls.length,1,'an unchanged deterministic failure cannot restart the backend')
  await evidence('host-final-check',{hostId:host.id,managementVerified:false,code:'OSS_REVIEW_IDENTITY_CHANGED'},sourceHash)
  await prisma.platformRecoveryHost.update({where:{batchId_hostId:{batchId,hostId:host.id}},data:{status:'blocked'}})
  await autoResumeRecovery(runtime);assert.equal(calls.length,1)
  await prisma.platformRecoveryHost.update({where:{batchId_hostId:{batchId,hostId:host.id}},data:{status:'success'}})
  await autoResumeRecovery(runtime);assert.equal(calls.length,2,'original identity returning permits continuation')
  active=false
  await core.writeJson(join(folder,'results',`${calls[1]}.json`),{status:'failed',error:'OSS_WORKER_STOPPED'})
  await autoResumeRecovery(runtime);assert.equal(calls.length,2)
  now+=3600000;mode='timeout';await autoResumeRecovery(runtime);assert.equal(calls.length,3)
  await autoResumeRecovery(runtime);assert.equal(calls.length,3,'ambiguous dispatch retains the active task')
  const dispatched=await prisma.platformRecoveryEvidence.findFirstOrThrow({where:{batchId,category:'auto-resume'},orderBy:[{createdAt:'desc'},{id:'desc'}]})
  assert.equal((dispatched.payload as any).taskId,calls[2],'reserved task ID survives timeout')
  active=false;now+=3600000;mode='ok'
  await core.writeJson(join(folder,'recovery-activation.json'),{test:true})
  await autoResumeRecovery(runtime);assert.equal(calls.length,3,'WAL supervisor retains ownership')
  await unlink(join(folder,'recovery-activation.json'))
  await autoResumeRecovery(runtime);assert.equal(calls.length,4,'missing legacy result resumes after delay')
  active=false
  await evidence('gateway-check',{status:'blocked',code:'OSS_RECOVERY_GATEWAY_CHANGED'},await state.recoveryDatasetHash('gateway'))
  assert.equal((await state.recoveryReadiness()).categories.find(row=>row.category==='gateway')?.verified,false,'new gateway failure invalidates old success')
  await autoResumeRecovery(runtime);assert.equal(calls.length,4)
  // Explicit database time ordering avoids same-millisecond fixture ambiguity.
  await prisma.$executeRaw`UPDATE platform_recovery_evidence SET created_at=created_at-INTERVAL '1 second' WHERE batch_id=${batchId}::uuid AND category='gateway-check'`
  await evidence('gateway')
  assert.equal((await state.recoveryReadiness()).categories.find(row=>row.category==='gateway')?.verified,true)
  await core.writeJson(join(folder,'results',`${calls[3]}.json`),{status:'failed',error:'OSS_MANUAL_RECOVERY_REQUIRED'})
  await autoResumeRecovery(runtime);now+=3600000;await autoResumeRecovery(runtime)
  assert.equal(calls.length,5,'gateway evidence changed since dispatch permits one new verification')
  active=false
  await core.writeJson(join(folder,'results',`${calls[4]}.json`),{status:'failed',error:'OSS_MANUAL_RECOVERY_REQUIRED'})
  await autoResumeRecovery(runtime);now+=3600000;await autoResumeRecovery(runtime)
  assert.equal(calls.length,5,'unchanged missing journal does not relaunch resume')
  const journalDirectory=join(folder,'private',batchId);await mkdir(journalDirectory,{recursive:true})
  await core.writeJson(join(journalDirectory,'journal.json'),{stage:'awaiting_review'})
  await autoResumeRecovery(runtime);assert.equal(calls.length,6,'restored exact journal unblocks automatic continuation')
  active=false
  await core.writeJson(join(folder,'results',`${calls[5]}.json`),{status:'success'})
  await autoResumeRecovery(runtime);now+=3600000;await autoResumeRecovery(runtime)
  assert.equal(calls.length,6,'success receipt cannot silently bypass an incomplete held batch or repeat it')
  const conflict=await prisma.platformRecoveryEvidence.findFirstOrThrow({where:{batchId,category:'auto-resume'},orderBy:[{createdAt:'desc'},{id:'desc'}]})
  assert.equal((conflict.payload as any).code,'OSS_RECOVERY_RESUME_RECEIPT_CONFLICT')
  assert.equal((await state.recoveryReadiness()).automation.find(row=>row.category==='auto-resume')?.status,'blocked')
  await prisma.user.update({where:{id:admin.id},data:{status:'banned'}})
  await evidence('access')
  await assert.rejects(state.assertRecoveryReady(batchId),/ADMIN_REQUIRED/,'last active non-recovery admin is mandatory')
  assert.ok(core.recoveryHeld())
  // Use the real signed heartbeat route with the same protection hook as app.ts.
  const app=Fastify(),originalFetch=globalThis.fetch
  globalThis.fetch=async()=>new Response(JSON.stringify({tag_name:'agent-v1.0.4',assets:[]}),{status:200})
  try {
    for(const name of ['authenticate','authenticateAdmin'])app.decorate(name,async()=>{})
    app.addHook('onRequest',async(request,reply)=>{
      if(core.recoveryHeld() && !core.recoveryRequestAllowed(request.method,request.url))return reply.code(503).send({code:'PLATFORM_RECOVERY_HELD'})
    })
    await app.register((await import('../src/routes/agent.js')).default,{prefix:'/api/agent'})
    const payload={version:'v1.0.4',runtime:{goos:'linux',goarch:'amd64'},metrics:{heartbeatIntervalSeconds:30}}
    const heartbeat=(secret=agentSecret)=>{
      const timestamp=String(Date.now()),nonce=randomUUID(),bodyHash=createAgentBodyHash(payload)
      return app.inject({method:'POST',url:'/api/agent/heartbeat',payload,headers:{'x-incudal-agent-id':agentId,
        'x-incudal-timestamp':timestamp,'x-incudal-nonce':nonce,'x-incudal-body-sha256':bodyHash,
        'x-incudal-signature':createAgentSignature(secret,{method:'POST',path:'/api/agent/heartbeat',timestamp,nonce,bodyHash})}})
    }
    assert.equal((await heartbeat()).statusCode,503,'import protection pauses reports without rotating the original Agent')
    assert.equal((await prisma.hostAgent.findUniqueOrThrow({where:{hostId:host.id}})).lastSeenAt,null)
    await unlink(join(folder,'recovery-hold.json'))
    await prisma.platformRecoveryBatch.update({where:{id:batchId},data:{completedAt:new Date()}})
    const {automaticRecoveryCompleted}=await import('../src/services/platform-recovery-start.js')
    const {waitForRestoredAgentHeartbeats}=await import('../src/services/platform-backup-health.js')
    const {pgQuery}=await import('../src/services/platform-backup-database.js')
    let heartbeatTime=0
    await assert.rejects(waitForRestoredAgentHeartbeats(batchId,{query:pgQuery,now:()=>heartbeatTime,sleep:async()=>{heartbeatTime+=90000}}),/AGENT_HEARTBEAT_PENDING/)
    assert.equal(await automaticRecoveryCompleted(batchId),false,'committed database alone cannot report restore completion')
    assert.equal((await heartbeat(generateAgentSecret())).statusCode,401,'different Agent secret is still rejected')
    const signed=await heartbeat();assert.equal(signed.statusCode,200,signed.body)
    await waitForRestoredAgentHeartbeats(batchId)
    const agent=await prisma.hostAgent.findUniqueOrThrow({where:{hostId:host.id}})
    assert.equal(agent.agentId,agentId);assert.equal(agent.secretEncrypted,secretEncrypted)
    assert.equal(agent.secretHash,hashAgentSecret(agentSecret));assert.ok(agent.lastSeenAt)
    const taskId=(conflict.payload as any).taskId
    await core.writeJson(core.statePath('results',`${taskId}.json`),{id:taskId,kind:'resume',status:'success',stage:'resumed'})
    await core.writeJson(join(folder,'recovery-activation.json'),{batchId,phase:'committed'})
    assert.equal(await automaticRecoveryCompleted(batchId),false,'unfinished activation remains visible')
    await unlink(join(folder,'recovery-activation.json'))
    assert.equal(await automaticRecoveryCompleted(batchId),true)
    await business.restored()
    console.log('PASS original Agent after restored encryption key: hold pauses writes, same HMAC identity reconnects, wrong secret refused, completion waits for current heartbeat')
  }finally{globalThis.fetch=originalFetch;await app.close()}
  console.log('PASS automatic recovery: authorization, concurrent ticks, stable success refresh, final failure/recovery, lost dispatch, bounded retry, WAL ownership, gateway failure invalidation and admin gate')
}finally{await business?.close();await closePrismaDatabase();await rm(folder,{recursive:true,force:true})}
process.exit(0)
