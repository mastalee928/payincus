import assert from 'node:assert/strict'
import { randomUUID, generateKeyPairSync } from 'node:crypto'
import { mkdtemp,rm,access,utimes } from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
const url=new URL(process.env.DATABASE_URL||'')
assert.ok(url.hostname==='127.0.0.1' && url.port==='55449' && url.pathname.endsWith('_recovery_test'))
process.env.NODE_ENV='test';process.env.JWT_SECRET='isolated-helper-operator-key';process.env.ENCRYPTION_KEY='isolated-helper-encryption-key'
const folder=await mkdtemp(join(tmpdir(),'incudal-recovery-helper-'));process.env.PLATFORM_BACKUP_STATE_DIR=folder
const {prisma,closePrismaDatabase}=await import('../src/db/prisma.js')
const core=await import('../src/services/platform-backup-core.js')
const {activeRecoveryBatch}=await import('../src/services/platform-recovery-state.js')
const helper=await import('../src/services/platform-recovery-helper.js')
const policy=await import('../src/services/platform-recovery-helper-policy.js')
const baseline=await import('../src/services/platform-recovery-gateway-baseline.js')
const batchId=randomUUID(),sshKey='ssh-ed25519 '+Buffer.concat([Buffer.from('0000000b7373682d6564323535313900000020','hex'),Buffer.alloc(32,4)]).toString('base64')
const wg=generateKeyPairSync('x25519').publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('base64')
const oldGateway={publicKey:wg,managementSshPublicKey:sshKey,controlIp:'10.253.240.1',network:'10.253.240.0/20',endpoint:'gateway.example.test:51820',sshHost:'192.0.2.20'} as any
Object.assign(process.env,{ONBOARDING_GATEWAY_HOST:'192.0.2.20',ONBOARDING_GATEWAY_PORT:'22',ONBOARDING_GATEWAY_FINGERPRINT:'SHA256:'+'A'.repeat(43),
  ONBOARDING_GATEWAY_KEY_PATH:'/opt/incudal/server/certs/original-gateway.key',ONBOARDING_WG_ENDPOINT:oldGateway.endpoint})
try {
  await core.initBackupState()
  const actor=await prisma.user.create({data:{username:'helper-recovery',role:'admin',passwordHash:'unusable-test-hash'}})
  await prisma.platformRecoveryBatch.create({data:{id:batchId,holdTaskId:batchId,mode:'restore',operatorId:actor.id}})
  await core.writeJson(join(folder,'recovery-operator.json'),{batchId,originalId:1,actorId:actor.id,username:'admin',passwordHash:'unusable-test-hash',mfa:null,synthetic:true})
  await core.writeJson(join(folder,'recovery-hold.json'),{taskId:batchId,batchId,mode:'restore',createdAt:new Date().toISOString(),gatewayBaseline:baseline.gatewayBaseline(oldGateway)})
  const batch=await activeRecoveryBatch(),password='isolated-gateway-password'
  const authorized=await helper.authorizeRecoveryHelper(batch,oldGateway,password)
  assert.equal((await helper.authorizeRecoveryHelper(batch,oldGateway,password)).id,authorized.id,'lost API response reuses pending intent')
  const row=()=>prisma.platformRecoveryEvidence.findUniqueOrThrow({where:{id:authorized.id}})
  assert.ok(!JSON.stringify(await row()).includes(password))
  assert.equal(((await row()).payload as {secret:string}).secret,authorized.id)
  let now=Date.now(),active=false,mode='ok',calls:any[]=[],installed=false,writes=0,observations=0
  const runtime={active:async()=>active?{id:calls.at(-1)?.id} as any:null,now:()=>now,
    read:async()=>{observations++;return {...oldGateway,recoveryProtocolVersion:installed?1:undefined}},
    enqueue:async(kind:unknown,_actor:unknown,extras:unknown,id?:string)=>{calls.push({kind,extras,id});active=true;if(mode==='lost')throw {code:'OSS_WORKER_START_FAILED'};return {id} as any}}
  const execution={read:async()=>({...oldGateway,recoveryProtocolVersion:installed?1:undefined}),apply:async(_gateway:unknown,secret:string)=>{assert.equal(secret,password);writes++;installed=true}}
  mode='lost';await Promise.all([helper.dispatchRecoveryHelper(runtime),helper.dispatchRecoveryHelper(runtime)])
  assert.equal(calls.length,1);assert.equal(calls[0].kind,'gateway-helper');assert.equal(calls[0].extras.recoveryHelperId,authorized.id)
  await helper.dispatchRecoveryHelper(runtime);assert.equal(calls.length,1)
  active=false
  await core.writeJson(join(folder,'results',`${calls[0].id}.json`),{status:'failed',error:'SSH_DISCONNECTED'})
  await helper.dispatchRecoveryHelper(runtime);assert.equal((await helper.recoveryHelperStatus(batch.id))?.status,'retry')
  now+=29000;await helper.dispatchRecoveryHelper(runtime);assert.equal(calls.length,1)
  now+=2000;mode='ok';await helper.dispatchRecoveryHelper(runtime);assert.equal(calls.length,2)
  await helper.executeRecoveryHelper(batch.id,authorized.id,calls[1].id,execution)
  assert.equal(writes,1);assert.equal((await helper.recoveryHelperStatus(batch.id))?.status,'verified')
  await assert.rejects(access(join(folder,'inbox',`helper-${authorized.id}.secret.json`)))
  active=false;await helper.dispatchRecoveryHelper(runtime);assert.equal(calls.length,2)
  assert.ok(!JSON.stringify(await helper.recoveryHelperStatus(batch.id)).includes('secret'))
  console.log('PASS helper intent: one task across lost replies, persisted 30s backoff, bound execution, secret erased, no duplicate install')

  installed=false
  const second=await helper.authorizeRecoveryHelper(batch,oldGateway,password)
  now+=1000;await helper.dispatchRecoveryHelper(runtime);const task=calls.at(-1)!
  // The helper was installed but the root response disappeared. A successor
  // checks version/identity and commits the receipt without another write.
  installed=true;await helper.executeRecoveryHelper(batch.id,second.id,task.id,execution)
  assert.equal(writes,1);assert.equal((await helper.recoveryHelperStatus(batch.id))?.status,'verified')
  console.log('PASS helper response lost after remote success: original identity is read and recorded without reinstall')

  active=false;installed=false
  const third=await helper.authorizeRecoveryHelper(batch,oldGateway,password);now+=1000;await helper.dispatchRecoveryHelper(runtime)
  await assert.rejects(helper.executeRecoveryHelper(batch.id,third.id,calls.at(-1)!.id,{...execution,read:async()=>({...oldGateway,publicKey:'B'.repeat(43)+'='})}),/IDENTITY_CHANGED/)
  assert.equal(writes,1)
  active=false;await core.writeJson(join(folder,'results',`${calls.at(-1)!.id}.json`),{status:'failed',error:'SSH_AUTH_FAILED'})
  await helper.dispatchRecoveryHelper(runtime);const failedCount=calls.length;now+=3600000;await helper.dispatchRecoveryHelper(runtime)
  assert.equal(calls.length,failedCount,'wrong password does not loop root login')
  assert.ok(observations>0);assert.equal((await helper.recoveryHelperStatus(batch.id))?.code,'SSH_AUTH_FAILED')
  process.env.ONBOARDING_GATEWAY_FINGERPRINT='SHA256:'+'B'.repeat(43)
  await helper.dispatchRecoveryHelper(runtime)
  assert.equal((await helper.recoveryHelperStatus(batch.id))?.code,'OSS_RECOVERY_HELPER_AUTHORIZATION_CHANGED')
  await assert.rejects(access(join(folder,'inbox',`helper-${third.id}.secret.json`)))
  assert.equal(calls.length,failedCount)
  console.log('PASS helper identity/credential rejection, low-frequency read-only observation and changed authority invalidation')
  process.env.ONBOARDING_GATEWAY_FINGERPRINT='SHA256:'+'A'.repeat(43)
  const fourth=await helper.authorizeRecoveryHelper(batch,oldGateway,password)
  now+=1000;await helper.dispatchRecoveryHelper(runtime)
  const fourthPath=join(folder,'inbox',`helper-${fourth.id}.secret.json`)
  const validSecret=await core.readJson<any>(fourthPath)
  await core.writeJson(fourthPath,{...validSecret,batchId:randomUUID()})
  await assert.rejects(helper.executeRecoveryHelper(batch.id,fourth.id,calls.at(-1)!.id,execution),/HELPER_SECRET_INVALID/)
  assert.equal(writes,1,'swapped secret metadata cannot reach remote writes')
  await core.writeJson(fourthPath,validSecret)
  active=false
  await core.writeJson(join(folder,'results',`${calls.at(-1)!.id}.json`),{status:'failed',error:'SSH_CONNECT_FAILED'})
  await helper.dispatchRecoveryHelper(runtime)
  for(let i=0;i<7;i++){
    now+=3600000;await helper.dispatchRecoveryHelper(runtime);active=false
    await core.writeJson(join(folder,'results',`${calls.at(-1)!.id}.json`),{status:'failed',error:'SSH_CONNECT_FAILED'})
    await helper.dispatchRecoveryHelper(runtime)
  }
  assert.equal((await helper.recoveryHelperStatus(batch.id))?.status,'blocked')
  const eightCalls=calls.length
  now+=3600000;await helper.dispatchRecoveryHelper({...runtime,read:async()=>{throw {code:'SSH_CONNECT_FAILED'}}})
  assert.equal(calls.length,eightCalls,'exhausted connection attempts do not keep launching writes')
  now+=3600000;await helper.dispatchRecoveryHelper(runtime)
  assert.equal(calls.length,eightCalls+1,'original gateway return resumes automatically after bounded attempts')
  await helper.executeRecoveryHelper(batch.id,fourth.id,calls.at(-1)!.id,execution)
  assert.equal(writes,2)
  const orphan=randomUUID(),orphanPath=join(folder,'inbox',`helper-${orphan}.secret.json`)
  await core.writeJson(orphanPath,{ciphertext:'isolated-orphan'})
  await utimes(orphanPath,new Date(0),new Date(0))
  await helper.pruneRecoveryHelperSecrets(Date.now())
  await assert.rejects(access(orphanPath))
  for(const code of ['SSH_AUTH_FAILED','SSH_HOST_KEY_CHANGED','SSH_DISCONNECTED','GATEWAY_DNS_SERVICE_BUSY'])assert.equal(policy.recoveryHelperErrorCode({code,message:password}),code)
  assert.equal(policy.recoveryHelperErrorCode({code:'SECRET_'+password,message:password}),'OSS_RECOVERY_HELPER_FAILED')
  assert.equal(policy.recoveryHelperRetry('GATEWAY_DNS_SERVICE_BUSY',1).status,'retry')
  console.log('PASS swapped credential rejected, eight-attempt boundary, automatic continuation when original gateway returns, orphan cleanup and allowlisted errors')
  active=false;installed=false
  const fast=await helper.authorizeRecoveryHelper(batch,oldGateway,password);now+=1000
  await helper.dispatchRecoveryHelper({...runtime,enqueue:async(_kind,_actor,_extras,id)=>{
    await helper.executeRecoveryHelper(batch.id,fast.id,id!,execution)
    throw {code:'OSS_WORKER_START_FAILED'}
  }})
  assert.equal((await helper.recoveryHelperStatus(batch.id))?.status,'verified','late dispatch failure cannot overwrite root success')
  await assert.rejects(access(join(folder,'inbox',`helper-${fast.id}.secret.json`)))
  console.log('PASS concurrent root success survives a later lost systemd dispatch reply')
  const mapping=await import('../src/services/platform-recovery-mapping-intent.js')
  const {recoveryMappingEnvironment}=await import('../src/services/platform-recovery-mapping.js')
  let source=Object.entries(process.env).filter(([key])=>key.startsWith('ONBOARDING_')).map(([key,value])=>`${key}='${value}'`).join('\n')+'\n'
  const originalSource=source,readEnvironment=async()=>source,address='192.0.2.30'
  active=false;calls=[];mode='lost'
  const mapped=await mapping.authorizeRecoveryMapping(batch,address,readEnvironment)
  assert.equal((await mapping.authorizeRecoveryMapping(batch,address,readEnvironment)).id,mapped.id)
  await assert.rejects(mapping.authorizeRecoveryMapping(batch,'192.0.2.31',readEnvironment),/MAPPING_PENDING/)
  const mappingRuntime={...runtime,environment:readEnvironment,inspect:async()=>({environment:source,state:oldGateway})}
  await Promise.all([mapping.dispatchRecoveryMapping(mappingRuntime),mapping.dispatchRecoveryMapping(mappingRuntime)])
  assert.equal(calls.length,1);assert.equal(calls[0].extras.recoveryMappingId,mapped.id)
  await mapping.assertRecoveryMappingIntent(batch.id,mapped.id,calls[0].id,address,source)
  await assert.rejects(mapping.assertRecoveryMappingIntent(batch.id,mapped.id,randomUUID(),address,source),/AUTHORIZATION_CHANGED/)
  active=false;await core.writeJson(join(folder,'results',`${calls[0].id}.json`),{status:'failed',error:'SSH_DISCONNECTED'})
  await mapping.dispatchRecoveryMapping(mappingRuntime)
  assert.equal((await mapping.recoveryMappingStatus(batch.id))?.status,'retry')
  now+=29000;await mapping.dispatchRecoveryMapping(mappingRuntime);assert.equal(calls.length,1)
  now+=2000;mode='ok';await mapping.dispatchRecoveryMapping(mappingRuntime);assert.equal(calls.length,2)
  source=recoveryMappingEnvironment(source,address);process.env.ONBOARDING_GATEWAY_HOST=address
  active=false;await core.writeJson(join(folder,'results',`${calls[1].id}.json`),{status:'success'})
  await mapping.dispatchRecoveryMapping(mappingRuntime)
  assert.equal((await mapping.recoveryMappingStatus(batch.id))?.status,'verified')
  assert.equal((await mapping.authorizeRecoveryMapping(batch,address,readEnvironment)).id,mapped.id)
  await mapping.dispatchRecoveryMapping(mappingRuntime);assert.equal(calls.length,2)
  console.log('PASS mapping intent persists before connection, deduplicates lost replies, binds root task, retries after 30s and survives backend address restart')
  const secondMapping=await mapping.authorizeRecoveryMapping(batch,'192.0.2.31',readEnvironment)
  now+=1000;await mapping.dispatchRecoveryMapping(mappingRuntime)
  active=false;await core.writeJson(join(folder,'results',`${calls.at(-1)!.id}.json`),{status:'failed',error:'SSH_CONNECT_FAILED'})
  await mapping.dispatchRecoveryMapping(mappingRuntime)
  for(let i=0;i<7;i++){
    now+=3600000;await mapping.dispatchRecoveryMapping(mappingRuntime);active=false
    await core.writeJson(join(folder,'results',`${calls.at(-1)!.id}.json`),{status:'failed',error:'SSH_CONNECT_FAILED'})
    await mapping.dispatchRecoveryMapping(mappingRuntime)
  }
  assert.equal((await mapping.recoveryMappingStatus(batch.id))?.status,'blocked')
  const stoppedMappings=calls.length
  now+=3600000;await mapping.dispatchRecoveryMapping({...mappingRuntime,inspect:async()=>{throw {code:'SSH_HOST_KEY_CHANGED'}}})
  assert.equal(calls.length,stoppedMappings,'untrusted or missing gateway does not start another root task')
  now+=3600000;await mapping.dispatchRecoveryMapping(mappingRuntime)
  assert.equal(calls.length,stoppedMappings+1,'original pinned gateway returning resumes the saved intent')
  const authorizedSource=source
  source+='UNRELATED_CONFIGURATION=changed\n';active=false
  await assert.rejects(mapping.assertRecoveryMappingIntent(batch.id,secondMapping.id,calls.at(-1)!.id,'192.0.2.31',source),/AUTHORIZATION_CHANGED/)
  await mapping.dispatchRecoveryMapping(mappingRuntime)
  assert.equal((await mapping.recoveryMappingStatus(batch.id))?.code,'OSS_RECOVERY_MAPPING_AUTHORIZATION_CHANGED')
  assert.ok(!JSON.stringify(await mapping.recoveryMappingStatus(batch.id)).includes('UNRELATED_CONFIGURATION'))
  const beforeRestored=calls.length
  source=authorizedSource;now+=3600000
  await mapping.dispatchRecoveryMapping(mappingRuntime)
  assert.equal(calls.length,beforeRestored+1,'original configuration returning resumes the accepted intent')
  active=false;source=recoveryMappingEnvironment(source,'192.0.2.31');now+=91000
  await mapping.dispatchRecoveryMapping(mappingRuntime)
  assert.equal((await mapping.recoveryMappingStatus(batch.id))?.code,'OSS_RECOVERY_MAPPING_RECEIPT_REQUIRED')
  const beforeReceipt=calls.length
  await core.writeJson(join(folder,'results',`${calls.at(-1)!.id}.json`),{status:'success'})
  now+=3600000;await mapping.dispatchRecoveryMapping(mappingRuntime)
  assert.equal((await mapping.recoveryMappingStatus(batch.id))?.status,'verified')
  assert.equal(calls.length,beforeReceipt,'late success receipt completes original intent without another write')
  source=originalSource;process.env.ONBOARDING_GATEWAY_HOST='192.0.2.20'
  console.log('PASS mapping bounded retry, pinned-only observation, automatic continuation, changed configuration refusal and public status redaction')
} finally {
  await closePrismaDatabase();assert.ok(folder.startsWith(join(tmpdir(),'incudal-recovery-helper-')));await rm(folder,{recursive:true,force:true})
}
process.exit(0)
