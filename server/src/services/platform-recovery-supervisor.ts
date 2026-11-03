import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { lstat } from 'node:fs/promises'
import { backupRoot, ensure, readJson, writeJson, validateId, statePath } from './platform-backup-core.js'
import { hashFile } from './platform-backup-archive.js'
import { recoverInterruptedActivation, recoveryActivationPath, validateRecoveryActivation, durableUnlink, type RecoveryActivation } from './platform-recovery-activation.js'
import { recoverInterruptedMapping, recoveryMappingPath, validateRecoveryMappingJournal, type RecoveryMappingJournal } from './platform-recovery-mapping-journal.js'
import { waitForProtectedBackendHealth } from './platform-backup-health.js'
import { readHeldRestoreJournal, interruptedRestoreAction, restoreWorkerAlive, assertRestoreStartIdentity } from './platform-recovery-restore-journal.js'
import { pgQuery, localDatabaseAdmin } from './platform-backup-database.js'

async function prepareInterruptedRestoreRollback(directory: string) {
  const worker = await import('./platform-backup-worker.js')
  await worker.prepareInterruptedRestoreRollback(directory)
}
async function completeRestoredSnapshot(journal:NonNullable<Awaited<ReturnType<typeof readHeldRestoreJournal>>>['journal']) {
  const worker=await import('./platform-backup-worker.js')
  await worker.completeRestoredSnapshot(journal)
}
async function finishEmptyRecoveryRollback(directory:string) {
  const worker=await import('./platform-backup-worker.js')
  await worker.finishEmptyRecoveryRollback(directory)
}

interface SupervisorReceipt {
  version: 1; taskId: string; batchId: string; holdTaskId: string; mode: 'activation' | 'mapping' | 'restore'
  fingerprint: string; environmentHash: string; attempts: number; nextAt: number
  status: 'running' | 'retry' | 'blocked' | 'complete'; error?: string
}
export function recoverySupervisorRetry(code: string, attempts: number) {
  // Per-guest receipts own their backoff. This only resumes the bounded scan;
  // waiting guests are skipped and completed guests are never re-finalized.
  if(code==='OSS_RECOVERY_DELIVERY_CHECK_PENDING')return {status:'retry' as const,delayMs:15000}
  // A deterministic identity/context/file conflict is never fixed by restarting.
  const transient = ['OSS_BACKEND_SERVICE_FAILED','OSS_PROTECTED_START_FAILED','OSS_BACKEND_HEALTH_FAILED','OSS_HEALTH_FAILED',
    'OSS_BACKEND_NOT_READY','OSS_RECOVERY_AGENT_HEARTBEAT_PENDING','OSS_DATABASE_UNAVAILABLE','OSS_DATABASE_ADMIN_TIMEOUT','OSS_DATABASE_BUSY','OSS_DATABASE_STORAGE_FULL',
    'OSS_REVIEW_HOST_UNREACHABLE','OSS_REVIEW_TRANSPORT_TIMEOUT','OSS_REVIEW_RESOURCE_BUSY',
    'OSS_RECOVERY_EVIDENCE_STALE',
    'OSS_RECOVERY_DELIVERY_SSH_PENDING','OSS_RECOVERY_GUEST_ADDRESSES_MISSING','OSS_RECOVERY_IPV6_NETWORK_PENDING',
    'ECONNREFUSED','ECONNRESET','ETIMEDOUT','ENOSPC','EIO','57P01','57P02','57P03','53300','08006'].includes(code)
  return { status: transient ? 'retry' as const : 'blocked' as const,
    delayMs: Math.min(1800000, 60000 * 2 ** Math.min(Math.max(attempts-1,0),5)) }
}
export interface RecoverySupervisorRuntime {
  stop: () => Promise<void>; start: () => Promise<void>; prepare: () => Promise<void>
  ready: () => Promise<void>; health: () => Promise<void>
}
export async function resumeInterruptedRecovery(runtime: RecoverySupervisorRuntime, needsStop = true) {
  if (needsStop) await runtime.stop()
  await runtime.prepare()
  await runtime.start()
  await runtime.ready()
  await runtime.health()
}

function continuationError(error: unknown) {
  const raw=String((error as {code?:unknown})?.code||'OSS_RECOVERY_SUPERVISOR_FAILED')
  return /^[A-Z0-9_]{1,100}$/.test(raw)?raw:'OSS_RECOVERY_SUPERVISOR_FAILED'
}
// Observe only the saved task's dependencies. A changed file/catalog permits a
// new validation, never authorizes replacing an unknown identity.
export async function recoveryContinuationObservation(mapping: RecoveryMappingJournal | null,
  restore: Awaited<ReturnType<typeof readHeldRestoreJournal>>, batchId?: string) {
  const paths=restore ? restore.journal.files.flatMap(file=>file.saved?[file.saved,file.target]:[file.target]) :
    mapping ? ['before','next'].map(name=>join(statePath('private',mapping.taskId),`mapping-${name}.env`)) : []
  const files=[]
  for(const path of paths) {
    try { const stat=await lstat(path);files.push([path,stat.mode,stat.isSymbolicLink(),
      stat.isFile() && !stat.isSymbolicLink() ? await hashFile(path) : null]) }
    catch(error){files.push([path,continuationError(error)])}
  }
  try {
    if(!restore) {
      const database=batchId ? await pgQuery('SELECT id,hold_task_id,mode,operator_id,completed_at FROM platform_recovery_batches WHERE id=$1',[batchId]) : null
      return {files,database,error:undefined}
    }
    const names=[restore.journal.database,restore.journal.staging,restore.journal.rollback,`incudal_failed_${restore.journal.taskId.replace(/-/g,'')}`]
    const list=names.map(name=>`'${name.replace(/'/g,"''")}'`).join(',')
    const database=await localDatabaseAdmin(`SELECT COALESCE(json_agg(d ORDER BY d.datname),'[]') FROM (SELECT datname,oid,datallowconn FROM pg_database WHERE datname IN (${list})) d;`)
    return {files,database,error:undefined}
  }catch(error){return {files,database:null,error:continuationError(error)}}
}

// The fixed root service holds the same flock as OTA/backup. It never dispatches
// a second business backend or reads credentials from a browser request.
async function superviseRecoveryAttempt() {
  ensure(process.platform === 'linux' && process.getuid?.() === 0,'OSS_ROOT_HELPER_REQUIRED',503)
  const path=join(backupRoot(),'recovery-supervisor.json')
  const [activation,mapping,previous] = await Promise.all([
    readJson<RecoveryActivation>(recoveryActivationPath(),16*1024*1024),
    readJson<RecoveryMappingJournal>(recoveryMappingPath()),readJson<SupervisorReceipt>(path)
  ])
  ensure(!(activation && mapping),'OSS_RECOVERY_STATE_INVALID',503)
  if(activation)validateRecoveryActivation(activation)
  if(mapping)validateRecoveryMappingJournal(mapping)
  const restore = !activation && !mapping ? await readHeldRestoreJournal() : null
  if (restore && await restoreWorkerAlive(restore.journal)) return
  const restoreAction = restore ? interruptedRestoreAction(restore.journal) : 'none'
  const restorePending = restore && (restoreAction !== 'none' || previous?.mode === 'restore' ||
    restore.journal.emptyTarget && restore.journal.stage==='rolled_back_review') ? restore : null
  const journal=activation || mapping || restorePending?.journal
  if(!journal && (!previous || previous.status==='complete'))return
  if(previous) {
    ensure(previous.version===1 && ['activation','mapping','restore'].includes(previous.mode) && ['running','retry','blocked','complete'].includes(previous.status) &&
      Number.isSafeInteger(previous.attempts) && previous.attempts>=1 && Number.isFinite(previous.nextAt) &&
      /^[a-f0-9]{64}$/.test(previous.fingerprint) && /^[a-f0-9]{64}$/.test(previous.environmentHash),'OSS_RECOVERY_STATE_INVALID',503)
    validateId(previous.taskId);validateId(previous.batchId);validateId(previous.holdTaskId)
  }
  const taskId=journal?.taskId || previous!.taskId,batchId=activation?.batchId || mapping?.batchId || restorePending?.hold.batchId || previous!.batchId
  const hold=await readJson<{taskId:string;batchId:string}>(join(backupRoot(),'recovery-hold.json'))
  const environmentHash=await hashFile('/opt/incudal/.env')
  const holdTaskId=activation?.hold.taskId || hold?.taskId || previous?.holdTaskId
  ensure(holdTaskId,'OSS_RECOVERY_CONTEXT_CHANGED',503);validateId(holdTaskId)
  ensure(!hold || hold.batchId===batchId && hold.taskId===holdTaskId,'OSS_RECOVERY_CONTEXT_CHANGED',503)
  const observation=await recoveryContinuationObservation(mapping,restorePending,batchId)
  const fingerprint=createHash('sha256').update(JSON.stringify({journal:journal || null,environmentHash,observation})).digest('hex')
  const same=previous?.taskId===taskId && previous.fingerprint===fingerprint
  // A receipt may outlive the WAL when recovery finished but service start failed.
  // The recorded batch and unchanged environment must still identify that start.
  if(!journal)ensure(previous?.taskId===taskId && previous.environmentHash===environmentHash,'OSS_RECOVERY_MAPPING_FILES_CHANGED',503)
  if(previous && previous.nextAt>Date.now())return
  if(same && previous!.status==='blocked')return
  const resultPath=statePath('results',`${taskId}.json`)
  ensure(await readJson(resultPath),'OSS_RECOVERY_STATE_INVALID',503)
  const current:SupervisorReceipt={version:1,taskId,batchId,holdTaskId,mode:activation?'activation':mapping?'mapping':restorePending?'restore':previous!.mode,
    fingerprint,environmentHash,attempts:same?Math.min(previous!.attempts+1,1000000):1,nextAt:0,status:'running'}
  await writeJson(path,current,0o640)
  const system=async(action:'stop'|'start')=>{
    try{await promisify(execFile)('/usr/bin/systemctl',[action,'incudal-backend.service'],{timeout:120000})}
    catch{throw Object.assign(new Error('OSS_BACKEND_SERVICE_FAILED'),{code:'OSS_BACKEND_SERVICE_FAILED'})}
  }
  try {
    ensure(!observation.error,observation.error||'OSS_DATABASE_UNAVAILABLE',503)
    if(!journal) {
      const [batch]=await pgQuery<{hold_task_id:string;completed_at:Date|null}>('SELECT hold_task_id,completed_at FROM platform_recovery_batches WHERE id=$1',[batchId])
      ensure(batch && batch.hold_task_id===holdTaskId && (hold || batch.completed_at),'OSS_RECOVERY_CONTEXT_CHANGED',503)
    }
    if (mapping?.phase === 'prepared') {
      // The mapping recovery removes its WAL after restoring this exact file.
      // Persist the expected resulting hash first, so a crash between removal
      // and the next receipt write can still start the protected backend.
      current.environmentHash=mapping.previousHash
      await writeJson(path,current,0o640)
    }
    await resumeInterruptedRecovery({stop:()=>system('stop'),start:()=>system('start'),
      prepare:async()=>{
        if (restorePending && restoreAction === 'rollback') {
          await prepareInterruptedRestoreRollback(restorePending.directory)
          const restoredHold=await readJson<{batchId:string}>(join(backupRoot(),'recovery-hold.json'))
          ensure(restoredHold?.batchId,'OSS_RECOVERY_CONTEXT_CHANGED',503)
          current.batchId=restoredHold.batchId
        }
        if (restorePending) {
          const prepared=await readHeldRestoreJournal()
          ensure(prepared,'OSS_RECOVERY_CONTEXT_CHANGED',503)
          await assertRestoreStartIdentity(prepared.journal,prepared.hold.mode)
        }
        await recoverInterruptedMapping(false);await recoverInterruptedActivation(false)
        // Persist the actual restored env before start; a lost start response can
        // continue even if the startup hook has already removed the original WAL.
        current.environmentHash=await hashFile('/opt/incudal/.env')
        await writeJson(path,current,0o640)
      },
      ready:async()=>{
        await waitForProtectedBackendHealth(Boolean(await readJson(join(backupRoot(),'recovery-hold.json'))))
        if(restorePending){
          const prepared=await readHeldRestoreJournal()
          ensure(prepared,'OSS_RECOVERY_CONTEXT_CHANGED',503)
          if(prepared.hold.mode==='restore' && prepared.journal.snapshotAt)await completeRestoredSnapshot(prepared.journal)
        }
        await recoverInterruptedMapping(true);await recoverInterruptedActivation(true,true)
      },
      health:async()=>waitForProtectedBackendHealth(Boolean(await readJson(join(backupRoot(),'recovery-hold.json'))))
    }, restorePending ? restoreAction === 'rollback' : activation?.phase === 'prepared' || mapping?.phase === 'prepared')
    let restoredStage: string | undefined
    if (restorePending) {
      const completed=await readHeldRestoreJournal()
      ensure(completed?.journal.taskId===taskId,'OSS_RECOVERY_CONTEXT_CHANGED',503)
      restoredStage=completed.journal.stage==='rollback_prepared' || completed.journal.stage==='rolled_back_review' ? 'rolled_back_review' : 'awaiting_review'
      await writeJson(join(completed.directory,'journal.json'),{...completed.journal,stage:restoredStage})
    }
    const result=await readJson<Record<string,unknown>>(resultPath)
    ensure(result,'OSS_RECOVERY_STATE_INVALID',503)
    await writeJson(resultPath,{...result,...(restoredStage?{stage:restoredStage,status:restoredStage==='awaiting_review'?'success':'failed',
      error:restoredStage==='awaiting_review'?undefined:'OSS_RESTORE_INTERRUPTED_ROLLED_BACK'}:{}),
      continuation:{status:'complete',attempts:current.attempts,nextAt:null},updatedAt:new Date().toISOString()},0o640)
    if(restorePending?.journal.emptyTarget && restoredStage==='rolled_back_review')await finishEmptyRecoveryRollback(restorePending.directory)
    await durableUnlink(path)
  }catch(error){
    const code=continuationError(error)
    const retry=recoverySupervisorRetry(code,current.attempts)
    // Preparation can consume its WAL before health fails. Compare the next
    // observation with that resulting state, not the already completed WAL;
    // otherwise an unchanged conflict causes one extra service restart.
    if(!restorePending && !await readJson(recoveryActivationPath()) && !await readJson(recoveryMappingPath()))
      current.fingerprint=createHash('sha256').update(JSON.stringify({journal:null,environmentHash:current.environmentHash,observation})).digest('hex')
    await writeJson(path,{...current,status:retry.status,error:code,nextAt:Date.now()+retry.delayMs},0o640)
    const resultPath=statePath('results',`${taskId}.json`),result=await readJson<Record<string,unknown>>(resultPath)
    if(result)await writeJson(resultPath,{...result,stage:'recovery_continuation',status:'failed',error:code,
      continuation:{status:retry.status,attempts:current.attempts,nextAt:retry.status==='retry'?new Date(Date.now()+retry.delayMs).toISOString():null},updatedAt:new Date().toISOString()},0o640)
  }
}

export async function superviseRecovery() {
  try {
    await superviseRecoveryAttempt()
    await durableUnlink(join(backupRoot(),'recovery-supervisor-failure.json'))
  } catch(error) {
    const code=continuationError(error),path=join(backupRoot(),'recovery-supervisor-failure.json')
    const previous=await readJson<{error:string}>(path).catch(()=>null)
    if(previous?.error!==code)await writeJson(path,{error:code,stage:'saved-context',updatedAt:new Date().toISOString()},0o640)
    throw error
  }
}
