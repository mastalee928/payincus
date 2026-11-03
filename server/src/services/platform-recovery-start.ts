import { createHash, createHmac, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { statfs } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { prisma } from '../db/prisma.js'
import { backupRoot, ensure, readBackupConfig, readJson, recoveryHeld, sealSecret, statePath, validateBucket, validateRegion, validateId, validateObjectPrefix, writeJson, type BackupTaskResult } from './platform-backup-core.js'
import { activeBackupTask, backupRuntimeReady, enqueueBackupTask, dispatchPreparedBackupTask, observeBackupTask } from './platform-backup-scheduler.js'

type Phase = 'preview' | 'restore' | 'verification' | 'complete' | 'blocked'
export interface AutomaticRestore {
  version: 1; id: string; actorId: number; authorization: string; prefix: string; password: string
  phase: Phase; taskId: string; previewId?: string; restoreId?: string
  attempts: number; nextAt: string; createdAt: string; updatedAt: string; code?: string; observation?: string
  waitingPhase?: 'preview' | 'restore'; conditionHash?: string; passwordSource?: 'saved' | 'supplied'
  target?: { region:string; bucket:string }
  requestHash?: string
  rollbackAttempts?: number
}
const intentPath=()=>statePath('inbox','automatic-restore.json')
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const exec=promisify(execFile)
async function authorization(actorId:number) {
  const user=await prisma.user.findUnique({where:{id:actorId},select:{id:true,username:true,role:true,status:true,passwordHash:true,twoFactorEnabled:true,twoFactorSecret:true}})
  const ids=process.env.PLATFORM_BACKUP_ALLOWED_ADMIN_IDS?.trim()
  ensure(user?.role==='admin' && user.status==='active' && (ids?ids.split(',').map(Number).includes(actorId):user.username==='admin'),'OSS_ADMIN_REQUIRED',403)
  return digest(user)
}
export async function readAutomaticRestore() {
  const value=await readJson<AutomaticRestore>(intentPath())
  if(!value)return null
  validateId(value.id);validateId(value.taskId)
  if(value.previewId)validateId(value.previewId)
  if(value.restoreId)validateId(value.restoreId)
  if(value.target){validateRegion(value.target.region);validateBucket(value.target.bucket)}
  ensure(value.requestHash===undefined || /^[a-f0-9]{64}$/.test(value.requestHash),'OSS_STATE_INVALID',503)
  ensure(value.rollbackAttempts===undefined || Number.isSafeInteger(value.rollbackAttempts) && value.rollbackAttempts>=0 && value.rollbackAttempts<=3,'OSS_STATE_INVALID',503)
  ensure(value.waitingPhase===undefined || ['preview','restore'].includes(value.waitingPhase),'OSS_STATE_INVALID',503)
  ensure(value.conditionHash===undefined || /^[a-f0-9]{64}$/.test(value.conditionHash),'OSS_STATE_INVALID',503)
  ensure(value.passwordSource===undefined || ['saved','supplied'].includes(value.passwordSource),'OSS_STATE_INVALID',503)
  ensure(value.version===1 && Number.isSafeInteger(value.actorId) && value.actorId>0 && /^[a-f0-9]{64}$/.test(value.authorization) &&
    ['preview','restore','verification','complete','blocked'].includes(value.phase) && Number.isSafeInteger(value.attempts) && value.attempts>0 &&
    Number.isFinite(Date.parse(value.nextAt)) && Number.isFinite(Date.parse(value.createdAt)) && Number.isFinite(Date.parse(value.updatedAt)) &&
    typeof value.password==='string','OSS_STATE_INVALID',503)
  validateObjectPrefix(value.prefix)
  return value
}
export function publicAutomaticRestore(value:AutomaticRestore|null) {
  if(!value)return null
  // Never expose the encrypted secret, authorization hash or private state.
  return {id:value.id,phase:value.phase,taskId:value.taskId,attempts:value.attempts,nextAt:value.nextAt,updatedAt:value.updatedAt,
    code:value.code && /^[A-Za-z0-9_]{1,100}$/.test(value.code)?value.code:null}
}
export const automaticRestorePending=(value:AutomaticRestore|null)=>!!value && !['complete','blocked'].includes(value.phase)
export const automaticRestoreReserved=(value:AutomaticRestore|null)=>automaticRestorePending(value) || !!value?.waitingPhase
// Read only the condition relevant to a refusal. Changing unrelated settings
// must not replay a bad archive or accept a different management identity.
async function condition(value:AutomaticRestore) {
  const config=await readBackupConfig()
  if(value.target && (config?.region!==value.target.region || config?.bucket!==value.target.bucket))return null
  if(['OSS_ARCHIVE_AUTH_FAILED','OSS_BACKUP_PASSWORD_REQUIRED','OSS_SECRET_DECRYPT_FAILED'].includes(value.code||''))
    return value.passwordSource==='saved'?digest(config?.backupPassword):null
  if(['OSS_AccessDenied','OSS_InvalidAccessKeyId','OSS_SignatureDoesNotMatch'].includes(value.code||''))
    return digest([config?.accessKeyId,config?.accessKeySecret])
  if(value.code==='OSS_RUNTIME_NOT_INSTALLED')return digest(backupRuntimeReady())
  if(['OSS_DISK_SPACE_LOW','OSS_STATE_DISK_FULL','OSS_DATABASE_STORAGE_FULL'].includes(value.code||'')){
    const space=await statfs(backupRoot())
    return digest(Math.floor(space.bavail*space.bsize/(64*1024**2)))
  }
  if(value.code==='OSS_GATEWAY_NETWORK_CONFLICT'){
    const results=await Promise.all([
      exec('/usr/sbin/ip',['-j','-4','route','show','table','all'],{timeout:10000,maxBuffer:1024*1024}),
      exec('/usr/sbin/ip',['-j','-4','address','show'],{timeout:10000,maxBuffer:1024*1024})])
    // lifetimes/counters are not configuration changes.
    return digest(results.map(result=>JSON.parse(result.stdout, (key,value)=>['valid_life_time','preferred_life_time','expires'].includes(key)?undefined:value)))
  }
  // A pre-switch expired plan is safe to replace, unlike an unacknowledged
  // restore. Its root receipt must explicitly attest that the WAL never began.
  if(value.code==='OSS_PREVIEW_EXPIRED')return digest('expired-plan')
  return null
}
export async function automaticRecoveryCompleted(batchId:string) {
  if (recoveryHeld() || existsSync(join(backupRoot(),'recovery-activation.json'))) return false
  const row=await prisma.platformRecoveryBatch.findUnique({where:{id:batchId},select:{completedAt:true}})
  if (!row?.completedAt) return false
  const activation=await prisma.platformRecoveryEvidence.findFirst({where:{batchId,category:'auto-resume'},orderBy:[{createdAt:'desc'},{id:'desc'}],select:{payload:true}})
  const taskId=(activation?.payload as {taskId?:string}|null)?.taskId
  if (!taskId) return false
  const result=await readJson<BackupTaskResult>(statePath('results',`${validateId(taskId)}.json`))
  return result?.id===taskId && result.kind==='resume' && result.status==='success' && result.stage==='resumed'
}
const defaultRuntime={now:Date.now,authorization,condition,observe:observeBackupTask,active:activeBackupTask,ready:backupRuntimeReady,enqueue:enqueueBackupTask,dispatch:dispatchPreparedBackupTask,
  completed:automaticRecoveryCompleted}
export type AutomaticRestoreRuntime=typeof defaultRuntime

// The authorized click is recorded before dispatch. Repeating its ID returns
// the same operation, including after a lost HTTP response or process restart.
export async function beginAutomaticRestore(input:{id:string;prefix:string;password?:string},actorId:number,runtime=defaultRuntime) {
  validateId(input.id);const prefix=validateObjectPrefix(input.prefix)
  const auth=await runtime.authorization(actorId),previous=await readAutomaticRestore()
  const requestHash=createHmac('sha256',auth).update(JSON.stringify([prefix,input.password??null])).digest('hex')
  const existing=previous?.id===input.id?previous:await readJson<AutomaticRestore>(statePath('inbox',`automatic-restore-${input.id}.json`))
  if(existing){
    ensure(existing.id===input.id && existing.actorId===actorId && existing.authorization===auth && existing.prefix===prefix &&
      (!existing.requestHash || existing.requestHash===requestHash),'OSS_RECOVERY_CONTEXT_CHANGED',409)
    return publicAutomaticRestore(existing)
  }
  if(automaticRestorePending(previous) && previous?.actorId===actorId && previous.authorization===auth && previous.prefix===prefix)
    return publicAutomaticRestore(previous)
  ensure(!automaticRestorePending(previous) && !recoveryHeld() && !await runtime.active(),'OSS_TASK_BUSY',409)
  ensure(runtime.ready(),'OSS_RUNTIME_NOT_INSTALLED',503)
  const config=await readBackupConfig();ensure(config?.bucket,'OSS_CONFIG_REQUIRED',409)
  ensure(input.password===undefined || typeof input.password==='string' && input.password.length>=12 && input.password.length<=256 &&
    !/[\x00-\x1f\x7f]/.test(input.password),'OSS_PASSWORD_INVALID')
  const password=input.password?sealSecret(input.password):config.backupPassword
  ensure(password,'OSS_BACKUP_PASSWORD_REQUIRED',409)
  const now=new Date(runtime.now()).toISOString()
  const value:AutomaticRestore={version:1,id:input.id,actorId,authorization:auth,prefix,password,phase:'preview',taskId:randomUUID(),
    attempts:1,nextAt:now,createdAt:now,updatedAt:now,passwordSource:input.password?'supplied':'saved',target:{region:config.region,bucket:config.bucket},requestHash}
  // A new explicit selection may supersede a preflight refusal. Preserve its
  // result without its password; scheduled backups cannot silently replace it.
  if(previous)await writeJson(statePath('inbox',`automatic-restore-${previous.id}.json`),{...previous,password:''})
  await writeJson(intentPath(),value)
  return publicAutomaticRestore(value)
}
function errorCode(error:unknown) {
  const raw=String((error as {code?:string})?.code||'OSS_RECOVERY_START_FAILED')
  return /^[A-Za-z0-9_]{1,100}$/.test(raw)?raw:'OSS_RECOVERY_START_FAILED'
}
const retryable=(code:string)=>['OSS_NETWORK_FAILED','OSS_DATABASE_UNAVAILABLE','OSS_DATABASE_ADMIN_TIMEOUT',
  'OSS_DATABASE_BUSY','OSS_WORKER_START_FAILED','OSS_WORKER_STOPPED',
  'OSS_ConnectionTimeoutError','OSS_RequestTimeout','OSS_ServiceUnavailable','ETIMEDOUT','ECONNRESET','ECONNREFUSED','EIO'].includes(code)

// Caller holds serializeBackupMutation. The root WAL owns recovery after the
// database switch; this dispatcher never starts a second restore over a hold.
export async function advanceAutomaticRestore(runtime=defaultRuntime) {
  const value=await readAutomaticRestore()
  if(!value || value.phase==='complete')return
  const save=async()=>{value.updatedAt=new Date(runtime.now()).toISOString();await writeJson(intentPath(),value)}
  try {
  if(value.restoreId && recoveryHeld()) {
    const hold=await readJson<{taskId:string;mode:string}>(join(backupRoot(),'recovery-hold.json'))
    if(hold?.taskId===value.restoreId && hold.mode==='rollback') {
      value.phase='verification';value.code='OSS_RESTORE_INTERRUPTED_ROLLED_BACK'
    } else if(hold?.taskId!==value.restoreId || hold.mode!=='restore') {
      value.phase='blocked';value.code=hold?.mode==='rollback'?'OSS_RESTORE_INTERRUPTED_ROLLED_BACK':'OSS_RECOVERY_CONTEXT_CHANGED'
    } else {
      if(value.phase==='verification' && !value.code)return
      // Keep B-encrypted input until completion. A proven rollback restores B's
      // key and can reuse a supplied password without asking the owner again.
      // It is never decrypted under A's restored key or exposed by the API.
      value.phase='verification';value.code=undefined
    }
    await save();return
  }
  if(Date.parse(value.nextAt)>runtime.now())return
  if(value.restoreId) {
    const rollback=await readJson<BackupTaskResult>(statePath('results',`${value.restoreId}.json`))
    if(rollback?.id===value.restoreId && rollback.kind==='restore' && rollback.rollbackVerified===true) {
      const code=rollback.error||'OSS_RESTORE_INTERRUPTED_ROLLED_BACK'
      if((value.rollbackAttempts||0)>=3 || !(retryable(code) || code==='OSS_RESTORE_INTERRUPTED_ROLLED_BACK')) {
        value.phase='blocked';value.code=(value.rollbackAttempts||0)>=3?'OSS_RECOVERY_RESTORE_RETRY_EXHAUSTED':code
        value.waitingPhase=undefined;await save();return
      }
      ensure(await runtime.authorization(value.actorId)===value.authorization,'OSS_RECOVERY_START_AUTHORIZATION_CHANGED',403)
      const config=await readBackupConfig()
      ensure(config && (!value.target || config.region===value.target.region && config.bucket===value.target.bucket),'OSS_RECOVERY_CONTEXT_CHANGED',409)
      if(!value.password && value.passwordSource==='saved')value.password=config.backupPassword
      ensure(value.password,'OSS_BACKUP_PASSWORD_REQUIRED',409)
      value.rollbackAttempts=(value.rollbackAttempts||0)+1
      value.phase='preview';value.restoreId=undefined;value.previewId=undefined;value.taskId=randomUUID();value.attempts=1
      value.code=undefined;value.observation=undefined;value.nextAt=new Date(runtime.now()+60000*2**(value.rollbackAttempts-1)).toISOString()
      await save();return
    }
  }
  if(value.restoreId && await runtime.completed(value.restoreId)) {value.phase='complete';value.password='';value.code=undefined;await save();return}
  if(value.phase==='verification') {
    // Committed activation opens business before the final live heartbeat check.
    // Its durable journal owns continuation; do not label this complete or lost.
    const activation=await readJson<{batchId:string;phase:string}>(join(backupRoot(),'recovery-activation.json'))
    if(activation && activation.batchId===value.restoreId && activation.phase==='committed') {
      value.nextAt=new Date(runtime.now()+5000).toISOString();await save();return
    }
    value.phase='blocked';value.code='OSS_RECOVERY_CONTEXT_CHANGED';await save()
    return
  }
  if(await runtime.active())return
    if(value.phase==='blocked') {
      if(!value.waitingPhase)return
      const current=await runtime.condition(value)
      if(!current || current===value.conditionHash){value.nextAt=new Date(runtime.now()+300000).toISOString();await save();return}
      ensure(await runtime.authorization(value.actorId)===value.authorization,'OSS_RECOVERY_START_AUTHORIZATION_CHANGED',403)
      const config=await readBackupConfig()
      ensure(config && (!value.target || config.region===value.target.region && config.bucket===value.target.bucket),'OSS_RECOVERY_CONTEXT_CHANGED',409)
      if(value.passwordSource==='saved')value.password=config.backupPassword
      value.phase='preview';value.waitingPhase=undefined;value.restoreId=undefined;value.previewId=undefined
      value.taskId=randomUUID();value.attempts=1;value.code=undefined;value.observation=undefined
      value.nextAt=new Date(runtime.now()).toISOString();await save();return
    }
    ensure(await runtime.authorization(value.actorId)===value.authorization,'OSS_RECOVERY_START_AUTHORIZATION_CHANGED',403)
    const config=await readBackupConfig()
    ensure(config && (!value.target || config.region===value.target.region && config.bucket===value.target.bucket),'OSS_RECOVERY_CONTEXT_CHANGED',409)
    const rootResult=await readJson<BackupTaskResult>(statePath('results',`${value.taskId}.json`))
    const reaped=await readJson<BackupTaskResult>(statePath('inbox','last-failure.json'))
    const result=rootResult && ['success','failed','warning'].includes(rootResult.status)?rootResult:
      reaped?.id===value.taskId?reaped:rootResult
    if(result && result.id!==value.taskId)ensure(false,'OSS_STATE_INVALID',503)
    if(result?.status==='success' && value.phase==='preview') {
      ensure(result.kind==='preview' && result.objectPrefix===value.prefix && result.preview,'OSS_STATE_INVALID',503)
      if(Date.parse(result.preview.expiresAt)<=runtime.now()) {
        value.taskId=randomUUID();value.attempts++;value.code='OSS_PREVIEW_EXPIRED'
      } else {
        value.previewId=value.taskId;value.taskId=randomUUID();value.restoreId=value.taskId;value.phase='restore';value.attempts=1;value.code=undefined
      }
      // Persist exact successor before enqueue. A crash resumes this same ID.
      value.nextAt=new Date(runtime.now()).toISOString();await save();return
    }
    if(result?.status==='failed') {
      const code=result.error||'OSS_WORKER_STOPPED'
      // A restore failure may have consumed its root-private plan or entered
      // rollback. It is never blindly repeated as a new overwrite operation.
      if(value.phase==='restore' || !retryable(code)){
        value.code=code
        const mayObserve=value.phase==='preview' || result.restoreNotStarted===true
        const observed=mayObserve?await runtime.condition(value):null
        if(value.phase==='restore' && result.restoreNotStarted===true && (code==='OSS_PREVIEW_EXPIRED' || retryable(code) && !observed)) {
          value.phase='preview';value.taskId=randomUUID();value.restoreId=undefined;value.previewId=undefined;value.attempts++
          value.nextAt=new Date(runtime.now()+Math.min(1800000,30000*2**Math.min(value.attempts-1,6))).toISOString();await save();return
        }
        value.waitingPhase=observed?value.phase:undefined;value.conditionHash=observed||undefined
        value.phase='blocked';value.nextAt=new Date(runtime.now()+300000).toISOString();await save();return
      }
      if(value.observation!==result.id) {
        value.observation=result.id;value.code=code;value.nextAt=new Date(runtime.now()+Math.min(1800000,30000*2**Math.min(value.attempts-1,6))).toISOString()
        await save();return
      }
      value.taskId=randomUUID();value.attempts++;value.nextAt=new Date(runtime.now()).toISOString();await save();return
    }
    if(result) {
      // Unresolved root result, with no active marker: do not assume failure
      // and submit another job. The fixed root supervisor/reaper owns it.
      if(!['success','failed','warning'].includes(result.status))await runtime.observe(result)
      value.nextAt=new Date(runtime.now()+30000).toISOString();value.code='OSS_RECOVERY_START_RESULT_PENDING';await save();return
    }
    ensure(runtime.ready(),'OSS_RUNTIME_NOT_INSTALLED',503)
    if(existsSync(statePath('inbox',`${value.taskId}.json`))) {
      // enqueue persists the inbox before its active marker. Finish that exact
      // dispatch after a backend crash, using the existing request unchanged.
      const request=await readJson<{id:string;kind:string;createdBy:number;sourcePrefix?:string;previewId?:string}>(statePath('inbox',`${value.taskId}.json`))
      ensure(request?.id===value.taskId && request.createdBy===value.actorId && request.kind===value.phase &&
        (value.phase==='preview'?request.sourcePrefix===value.prefix:request.previewId===value.previewId),'OSS_RECOVERY_CONTEXT_CHANGED',409)
      await runtime.dispatch(value.taskId)
    } else await runtime.enqueue(value.phase==='preview'?'preview':'restore',value.actorId,value.phase==='preview'?
      {sourcePrefix:value.prefix,password:value.password}:{previewId:value.previewId,confirmation:`RESTORE ${value.previewId}`,restorePolicy:'snapshot-v1'},value.taskId)
  } catch(error) {
    const code=errorCode(error);value.code=code
    value.attempts=Math.min(value.attempts+1,1000000)
    if(['OSS_ADMIN_REQUIRED','OSS_RECOVERY_START_AUTHORIZATION_CHANGED','OSS_RECOVERY_CONTEXT_CHANGED','OSS_STATE_INVALID'].includes(code)){
      value.phase='blocked';value.waitingPhase=undefined
    }
    // Dispatch timeout is ambiguous. The next pass observes the same task ID;
    // it cannot create a second overwrite simply because the response was lost.
    value.nextAt=new Date(runtime.now()+Math.min(1800000,30000*2**Math.min(value.attempts-1,6))).toISOString()
    await save()
  }
}
