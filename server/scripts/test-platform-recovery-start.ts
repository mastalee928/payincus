import assert from 'node:assert/strict'
import {mkdtemp,rm,unlink} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {randomUUID} from 'node:crypto'
import type { BackupTaskResult, BackupTaskRequest } from '../src/services/platform-backup-core.js'
import type { AutomaticRestoreRuntime } from '../src/services/platform-recovery-start.js'
const folder=await mkdtemp(join(tmpdir(),'incudal-automatic-restore-'))
process.env.NODE_ENV='test';process.env.PLATFORM_BACKUP_STATE_DIR=folder
process.env.ENCRYPTION_KEY='isolated-recovery-start-key'
process.env.DATABASE_URL||='postgresql://recovery_test@127.0.0.1:55449/unused_recovery_test'
const core=await import('../src/services/platform-backup-core.js')
const start=await import('../src/services/platform-recovery-start.js')
const {closePrismaDatabase}=await import('../src/db/prisma.js')
let now=Date.now(),auth='a'.repeat(64),active:BackupTaskResult|null=null,completed=false,lostResponse=false,conditionHash='c'.repeat(64)
const calls:Array<{kind:string;id:string;extras:any}>=[]
const runtime:AutomaticRestoreRuntime={now:()=>now,authorization:async()=>auth,condition:async()=>conditionHash,observe:async value=>{active=value;return value},ready:()=>true,active:async()=>active,completed:async()=>completed,
  dispatch:async id=>{const request=await core.readJson<BackupTaskRequest>(core.statePath('inbox',`${id}.json`));assert.ok(request);active={id,kind:request.kind,status:'pending',stage:'queued',createdAt:request.createdAt,updatedAt:request.createdAt};calls.push({kind:'dispatch',id,extras:{}});return active},
  enqueue:async(kind,_actor,extras,id)=>{
    assert.ok(id);assert.equal(active,null);calls.push({kind,id,extras})
    active={id,kind,status:'pending',stage:'queued',createdAt:new Date(now).toISOString(),updatedAt:new Date(now).toISOString()}
    if(lostResponse)throw new core.BackupError('OSS_WORKER_START_FAILED',503)
    return active
  }}
const source={id:randomUUID(),prefix:'backups/original/selected/'}
const result=async(status:'success'|'failed',error?:string)=>{
  assert.ok(active);const value={...active,status,stage:status==='success'?'preview_ready':'failed',error,objectPrefix:source.prefix,
    ...(status==='success'?{preview:{version:'1.8.0',createdAt:new Date(now).toISOString(),files:4,expiresAt:new Date(now+900000).toISOString()}}:{})}
  await core.writeJson(core.statePath('results',`${active.id}.json`),value);active=null;return value
}
try {
  await core.initBackupState()
  await core.writeBackupConfig(core.normalizeConfig({enabled:false,region:'oss-cn-hangzhou',bucket:'isolated-backup',prefix:'backups/',accessKeyId:'TestAccessKey',accessKeySecret:'isolated-secret',backupPassword:'isolated-password',intervalHours:24,retention:3}))
  const pending=await start.beginAutomaticRestore(source,1,runtime)
  assert.equal(pending?.phase,'preview');assert.equal(calls.length,0)
  const stored=await start.readAutomaticRestore();assert.ok(stored)
  assert.equal(core.openSecret(stored.password),'isolated-password')
  assert.ok(!JSON.stringify(pending).includes(stored.password));assert.ok(!JSON.stringify(pending).includes(auth))
  assert.equal((await start.beginAutomaticRestore(source,1,runtime))?.taskId,pending!.taskId)
  await assert.rejects(start.beginAutomaticRestore({...source,password:'changed-password'},1,runtime),/CONTEXT_CHANGED/)
  assert.equal((await start.beginAutomaticRestore({...source,id:randomUUID()},1,runtime))?.taskId,pending!.taskId)
  await assert.rejects(start.beginAutomaticRestore({...source,id:randomUUID(),prefix:'backups/different/'},1,runtime),/TASK_BUSY/)
  lostResponse=true;await start.advanceAutomaticRestore(runtime);lostResponse=false
  assert.equal(calls.length,1);now+=3600000;await start.advanceAutomaticRestore(runtime);assert.equal(calls.length,1,'lost response cannot duplicate active preview')
  const preview=await result('success');await start.advanceAutomaticRestore(runtime)
  const restore=await start.readAutomaticRestore();assert.equal(restore?.previewId,preview.id);assert.equal(restore?.phase,'restore')
  await start.advanceAutomaticRestore(runtime);assert.equal(calls.length,2);assert.equal(calls[1].kind,'restore')
  assert.equal(calls[1].extras.confirmation,`RESTORE ${preview.id}`)
  assert.equal(calls[1].extras.restorePolicy,'snapshot-v1','one-click restore selects the snapshot contract without an extra form')
  await core.writeJson(join(folder,'recovery-hold.json'),{taskId:restore!.restoreId,mode:'restore'})
  await start.advanceAutomaticRestore(runtime)
  assert.equal((await start.readAutomaticRestore())?.password,stored.password);assert.equal((await start.readAutomaticRestore())?.phase,'verification')
  await start.advanceAutomaticRestore(runtime);assert.equal(calls.length,2)
  await unlink(join(folder,'recovery-hold.json'));active=null
  await core.writeJson(join(folder,'recovery-activation.json'),{batchId:restore!.restoreId,phase:'committed'})
  await start.advanceAutomaticRestore(runtime)
  assert.equal((await start.readAutomaticRestore())?.phase,'verification','final heartbeat wait does not become a context failure')
  await unlink(join(folder,'recovery-activation.json'));completed=true;now+=5001
  await start.advanceAutomaticRestore(runtime);assert.equal((await start.readAutomaticRestore())?.phase,'complete')
  console.log('PASS durable one-click preview -> restore -> held verification -> completion; saved secret reuse, replay and lost response')

  completed=false;const second={...source,id:randomUUID()};await start.beginAutomaticRestore(second,1,runtime)
  await start.advanceAutomaticRestore(runtime);const failed=await result('failed','OSS_NETWORK_FAILED')
  await start.advanceAutomaticRestore(runtime);const retry=await start.readAutomaticRestore();assert.equal(retry?.observation,failed.id)
  const count=calls.length;await start.advanceAutomaticRestore(runtime);assert.equal(calls.length,count)
  now=Date.parse(retry!.nextAt);await start.advanceAutomaticRestore(runtime)
  const retrying=await start.readAutomaticRestore();assert.notEqual(retrying?.taskId,failed.id)
  await start.advanceAutomaticRestore(runtime);assert.equal(calls.length,count+1)
  await result('failed','OSS_ARCHIVE_AUTH_FAILED');await start.advanceAutomaticRestore(runtime)
  assert.equal((await start.readAutomaticRestore())?.phase,'blocked')
  now+=3600000;await start.advanceAutomaticRestore(runtime);assert.equal(calls.length,count+1,'unchanged password/integrity conflict does not loop')
  conditionHash='d'.repeat(64);now+=3600000;await start.advanceAutomaticRestore(runtime)
  assert.equal((await start.readAutomaticRestore())?.phase,'preview','changed relevant condition resumes without a second click')
  await start.advanceAutomaticRestore(runtime);assert.equal(calls.length,count+2)
  await result('failed','OSS_ARCHIVE_AUTH_FAILED');await start.advanceAutomaticRestore(runtime)
  console.log('PASS persisted exponential retry for transient preflight; deterministic archive rejection stops repeated work')

  await start.beginAutomaticRestore({...source,id:randomUUID()},1,runtime)
  auth='b'.repeat(64);await start.advanceAutomaticRestore(runtime)
  assert.equal((await start.readAutomaticRestore())?.code,'OSS_RECOVERY_START_AUTHORIZATION_CHANGED');assert.equal(calls.length,count+2)
  console.log('PASS authority is rechecked before delayed dispatch')

  await start.beginAutomaticRestore({...source,id:randomUUID()},1,runtime)
  const orphan=await start.readAutomaticRestore();assert.ok(orphan)
  await core.writeJson(core.statePath('inbox',`${orphan.taskId}.json`),{id:orphan.taskId,kind:'preview',createdBy:1,createdAt:new Date(now).toISOString(),sourcePrefix:source.prefix})
  await start.advanceAutomaticRestore(runtime)
  assert.equal(calls.at(-1)?.kind,'dispatch');assert.equal(calls.at(-1)?.id,orphan.taskId)
  console.log('PASS crash between request and active marker resumes the exact prepared request')
  active=null
  await core.writeJson(core.statePath('results',`${orphan.taskId}.json`),{id:orphan.taskId,kind:'preview',status:'failed',stage:'failed',error:'OSS_ARCHIVE_AUTH_FAILED'})
  await start.advanceAutomaticRestore(runtime)
  const originalConfig=await core.readBackupConfig();assert.ok(originalConfig)
  await start.beginAutomaticRestore({...source,id:randomUUID()},1,runtime)
  const bounded=await start.readAutomaticRestore();assert.ok(bounded)
  await core.writeBackupConfig({...originalConfig,bucket:'different-bucket'})
  const beforeTarget=calls.length;await start.advanceAutomaticRestore(runtime)
  assert.equal((await start.readAutomaticRestore())?.code,'OSS_RECOVERY_CONTEXT_CHANGED');assert.equal(calls.length,beforeTarget)
  await core.writeBackupConfig(originalConfig)
  const createRestore=async()=>{
    await start.beginAutomaticRestore({...source,id:randomUUID()},1,runtime)
    await start.advanceAutomaticRestore(runtime);await result('success');await start.advanceAutomaticRestore(runtime);await start.advanceAutomaticRestore(runtime)
    const value=await start.readAutomaticRestore();assert.equal(value?.phase,'restore');assert.ok(active);return value!
  }
  const expired=await createRestore()
  await core.writeJson(core.statePath('results',`${expired.taskId}.json`),{...active,status:'failed',stage:'failed',error:'OSS_PREVIEW_EXPIRED',restoreNotStarted:true})
  active=null;await start.advanceAutomaticRestore(runtime)
  assert.equal((await start.readAutomaticRestore())?.phase,'preview','root proof of no side effects allows an automatic new preflight')
  now+=3600000;await start.advanceAutomaticRestore(runtime);await result('failed','OSS_ARCHIVE_AUTH_FAILED');await start.advanceAutomaticRestore(runtime)
  const ambiguous=await createRestore()
  await core.writeJson(core.statePath('inbox','last-failure.json'),{...active,status:'failed',stage:'failed',error:'OSS_WORKER_STOPPED'})
  active=null;await start.advanceAutomaticRestore(runtime)
  assert.equal((await start.readAutomaticRestore())?.phase,'blocked')
  const beforeAmbiguous=calls.length;now+=3600000;await start.advanceAutomaticRestore(runtime)
  assert.equal(calls.length,beforeAmbiguous,'API worker-stop observation is never proof permitting another restore')
  assert.equal((await start.readAutomaticRestore())?.taskId,ambiguous.taskId)
  console.log('PASS bucket identity preserved, root pre-switch receipt permits re-preflight, ambiguous stop never overwrites again')
  const disk={...source,id:randomUUID()};await start.beginAutomaticRestore(disk,1,runtime)
  const selected=await start.readAutomaticRestore()
  const historical=await start.beginAutomaticRestore({...source,id:ambiguous.id},1,runtime)
  assert.equal(historical?.taskId,ambiguous.taskId,'replaying a superseded request returns its saved result')
  assert.equal((await start.readAutomaticRestore())?.id,selected?.id,'a delayed old request cannot replace the new recovery selection')
  await assert.rejects(start.beginAutomaticRestore({...source,id:ambiguous.id,password:'different-password'},1,runtime),/CONTEXT_CHANGED/)
  await start.advanceAutomaticRestore(runtime);await result('failed','OSS_DISK_SPACE_LOW');await start.advanceAutomaticRestore(runtime)
  assert.equal((await start.readAutomaticRestore())?.waitingPhase,'preview')
  assert.equal(start.automaticRestoreReserved(await start.readAutomaticRestore()),true)
  const beforeDisk=calls.length;now+=3600000;await start.advanceAutomaticRestore(runtime)
  assert.equal(calls.length,beforeDisk,'unchanged disk capacity cannot redownload the archive')
  conditionHash='e'.repeat(64);now+=3600000;await start.advanceAutomaticRestore(runtime)
  assert.equal((await start.readAutomaticRestore())?.phase,'preview')
  await start.advanceAutomaticRestore(runtime);await result('success');await start.advanceAutomaticRestore(runtime)
  const beforeDatabase=calls.length
  await start.advanceAutomaticRestore({...runtime,completed:async()=>{throw new Error('database temporarily unavailable')}})
  const delayed=await start.readAutomaticRestore();assert.ok(Date.parse(delayed!.nextAt)>now)
  assert.equal(calls.length,beforeDatabase,'completion lookup failure cannot dispatch a new restore')
  await start.advanceAutomaticRestore(runtime);assert.equal(calls.length,beforeDatabase,'persisted completion lookup backoff survives scheduler ticks')
  now=Date.parse(delayed!.nextAt);await start.advanceAutomaticRestore(runtime)
  assert.equal(calls.length,beforeDatabase+1)
  console.log('PASS disk condition observation, request payload identity and durable completion lookup backoff')
  active=null;await core.writeJson(core.statePath('inbox','automatic-restore.json'),{...await start.readAutomaticRestore(),phase:'blocked',waitingPhase:undefined})
  const fixedFailure=await start.beginAutomaticRestore({...source,id:randomUUID()},1,runtime)
  await start.advanceAutomaticRestore(runtime);await result('failed','OSS_DATABASE_TOOL_FAILED');await start.advanceAutomaticRestore(runtime)
  const callsBeforeFatal=calls.length;now+=3600000;await start.advanceAutomaticRestore(runtime)
  assert.equal(calls.length,callsBeforeFatal,'unknown SQL/archive failure cannot repeatedly download and restore the same archive')
  assert.equal((await start.readAutomaticRestore())?.phase,'blocked')
  assert.equal((await start.readAutomaticRestore())?.taskId,fixedFailure?.taskId)
  console.log('PASS deterministic database utility failure is retained without blind retry')
  const supplied='separately-supplied-archive-password'
  await start.beginAutomaticRestore({...source,id:randomUUID(),password:supplied},1,runtime)
  for(let attempt=0;attempt<4;attempt++){
    now+=3600000
    await start.advanceAutomaticRestore(runtime);await result('success');await start.advanceAutomaticRestore(runtime);await start.advanceAutomaticRestore(runtime)
    const restoring=await start.readAutomaticRestore();assert.equal(restoring?.phase,'restore')
    await core.writeJson(join(folder,'recovery-hold.json'),{taskId:restoring!.restoreId,mode:'restore'})
    await start.advanceAutomaticRestore(runtime)
    assert.equal(core.openSecret((await start.readAutomaticRestore())!.password),supplied)
    await core.writeJson(join(folder,'recovery-hold.json'),{taskId:restoring!.restoreId,mode:'rollback'})
    await start.advanceAutomaticRestore(runtime)
    await core.writeJson(core.statePath('results',`${restoring!.restoreId}.json`),{...active,status:'failed',stage:'rolled_back',rollbackVerified:true,error:'OSS_DATABASE_UNAVAILABLE'})
    const beforeRollback=calls.length;await start.advanceAutomaticRestore(runtime)
    assert.equal(calls.length,beforeRollback,'root rollback receipt cannot override an existing hold')
    await unlink(join(folder,'recovery-hold.json'));active=null
    await start.advanceAutomaticRestore(runtime)
    const resumed=await start.readAutomaticRestore()
    if(attempt<3){assert.equal(resumed?.phase,'preview');assert.equal(resumed.rollbackAttempts,attempt+1);assert.equal(core.openSecret(resumed.password),supplied)}
    else{assert.equal(resumed?.phase,'blocked');assert.equal(resumed.code,'OSS_RECOVERY_RESTORE_RETRY_EXHAUSTED')}
  }
  const exhausted=calls.length;now+=3600000;await start.advanceAutomaticRestore(runtime);assert.equal(calls.length,exhausted)
  console.log('PASS verified empty-target rollback retains supplied secret, waits for hold removal, retries at most three times and stops')
  const {verifyAutomaticRestoreHttp}=await import('./fixtures/recovery-start-http.js')
  await verifyAutomaticRestoreHttp(runtime)
}finally {
  await closePrismaDatabase();assert.ok(resolve(folder).startsWith(resolve(tmpdir(),'incudal-automatic-restore-')));await rm(folder,{recursive:true,force:true})
}
