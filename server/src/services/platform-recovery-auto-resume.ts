import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { prisma } from '../db/prisma.js'
import { backupRoot, readJson, serializeBackupMutation, validateId } from './platform-backup-core.js'
import { activeBackupTask, backupRuntimeReady, enqueueBackupTask } from './platform-backup-scheduler.js'
import { activeRecoveryBatch, assertRecoveryReady, recoveryReadiness } from './platform-recovery-state.js'
import { automaticResumeDecision, automaticResumeRetry } from './platform-recovery-policy.js'

// Successful periodic refreshes must not reset the backoff. A new failure
// followed by an authenticated success must allow continuation even if the
// original host record has not changed. Failure receipts provide that epoch.
export async function recoveryResumeSource(batchId:string,ready:Awaited<ReturnType<typeof recoveryReadiness>>,runtimeReady:boolean) {
  const hold=await readJson<{taskId:string}>(join(backupRoot(),'recovery-hold.json'))
  validateId(hold?.taskId)
  const dependencies=[]
  // A missing/corrupt journal or restored file permissions can change without
  // changing database rows. Observe only the exact held task and fixed runtime
  // files; never leak their bytes into the receipt or retry on mtime alone.
  for(const [path,limit] of [[join(backupRoot(),'private',hold!.taskId,'journal.json'),4*1024*1024],
    [join(backupRoot(),'recovery-operator.json'),1024*1024],['/opt/incudal/.env',1024*1024]] as const) {
    try {
      const info=await lstat(path)
      const digest=info.isFile() && !info.isSymbolicLink() && info.size<=limit?
        createHash('sha256').update(await readFile(path)).digest('hex'):null
      dependencies.push([path,info.mode,info.size,info.isSymbolicLink(),digest])
    }catch(error){dependencies.push([path,String((error as {code?:string})?.code||'OSS_RECOVERY_STATE_INVALID')])}
  }
  const hosts=await prisma.platformRecoveryHost.findMany({where:{batchId},orderBy:{hostId:'asc'},
    select:{hostId:true,status:true,sourceHash:true}})
  const failures=await prisma.$queryRaw<Array<{target:string;id:string}>>`SELECT DISTINCT ON (target) target,id FROM
    (SELECT CASE WHEN category='gateway-check' THEN 'gateway' ELSE 'host-'||(payload->>'hostId') END target,id,created_at
      FROM platform_recovery_evidence WHERE batch_id=${batchId}::uuid AND
      ((category IN ('host-check','host-final-check') AND
        (payload->>'managementVerified' IS DISTINCT FROM 'true' OR payload->'inventory'->>'inventoryMatched' IS DISTINCT FROM 'true'))
       OR (category='gateway-check' AND payload->>'status' IS DISTINCT FROM 'success'))) failures
    ORDER BY target,created_at DESC,id DESC`
  const gateway=await prisma.platformRecoveryEvidence.findFirst({where:{batchId,category:'gateway'},orderBy:[{createdAt:'desc'},{id:'desc'}],select:{evidenceHash:true}})
  return createHash('sha256').update(JSON.stringify({batchId,categories:ready.categories,hosts,failures,gateway,runtimeReady,dependencies})).digest('hex')
}
type ResumeReceipt={attempt:number;nextAt:string;status:string;taskId:string;code?:string}
const defaultRuntime={active:activeBackupTask,enqueue:enqueueBackupTask,ready:backupRuntimeReady,now:Date.now}

// Restore is the durable authorization. Finance/access evidence is still
// mandatory; satisfying those gates does not require a second approval.
export async function autoResumeRecovery(runtime=defaultRuntime) {
  return serializeBackupMutation(async()=>{
    const hold=await readJson<{autoResume?:boolean}>(join(backupRoot(),'recovery-hold.json'))
    if(!hold?.autoResume || await runtime.active())return
    // The root supervisor owns interrupted work until its WAL has finished.
    if(['recovery-activation.json','recovery-mapping.json','recovery-supervisor.json'].some(name=>existsSync(join(backupRoot(),name))))return
    const batch=await activeRecoveryBatch(),ready=await recoveryReadiness()
    if(!ready.ready)return
    const sourceHash=await recoveryResumeSource(batch.id,ready,runtime.ready())
    const last=await prisma.platformRecoveryEvidence.findFirst({where:{batchId:batch.id,category:'auto-resume'},orderBy:[{createdAt:'desc'},{id:'desc'}]})
    let previous=last?.payload as ResumeReceipt|undefined
    if(previous?.taskId){
      validateId(previous.taskId)
      let result=await readJson<{status:string;error?:string}>(join(backupRoot(),'results',`${previous.taskId}.json`))
      // A completed resume must have committed the batch and removed its hold.
      // activeRecoveryBatch above proves neither happened. Persist this conflict
      // instead of silently leaving the operator with a permanent pending gate.
      if(result && ['success','warning'].includes(result.status))result={status:'failed',error:'OSS_RECOVERY_RESUME_RECEIPT_CONFLICT'}
      if(result?.status==='failed' && (previous.status!=='failed' || previous.code!==(result.error||'OSS_WORKER_STOPPED'))){
        const code=result.error||'OSS_WORKER_STOPPED',policy=automaticResumeRetry(code,previous.attempt)
        previous={...previous,status:'failed',code,nextAt:new Date(runtime.now()+policy.delayMs).toISOString()}
        await prisma.platformRecoveryEvidence.update({where:{id:last!.id},data:{payload:previous}})
      }else if(!result && ['pending','dispatched'].includes(previous.status)){
        if(Date.parse(previous.nextAt)>runtime.now())return
        // No active unit and no WAL: a pre-dispatch crash or legacy reaper
        // lost the receipt. Keep its task ID and record the bounded retry.
        previous={...previous,status:'failed',code:'OSS_WORKER_STOPPED'}
        await prisma.platformRecoveryEvidence.update({where:{id:last!.id},data:{payload:previous}})
      }else if(result && result.status!=='failed')return
    }
    const prior=previous && last ? {...previous,sourceHash:last.sourceHash,
      status:previous.code?automaticResumeRetry(previous.code,previous.attempt).status:previous.status} : null
    const attempt=automaticResumeDecision(prior,sourceHash,runtime.now())
    if(attempt===null)return
    const nextAt=new Date(runtime.now()+automaticResumeRetry('OSS_WORKER_START_FAILED',attempt).delayMs).toISOString()
    const taskId=randomUUID()
    const receipt:ResumeReceipt={attempt,nextAt,status:'pending',taskId}
    // Persist the exact ID before dispatch; a lost response cannot create an
    // untracked second task. The scheduler never reuses an existing ID.
    const entry=await prisma.platformRecoveryEvidence.create({data:{batchId:batch.id,category:'auto-resume',reference:`resume-${taskId}`,
      sourceHash,evidenceHash:sourceHash,observedAt:new Date(runtime.now()),actorId:batch.operator_id,payload:receipt}})
    try {
      await assertRecoveryReady(batch.id)
      await runtime.enqueue('resume',batch.operator_id,{confirmation:'RESUME AFTER RECONCILIATION',recoveryBatchId:batch.id},taskId)
      await prisma.platformRecoveryEvidence.update({where:{id:entry.id},data:{payload:{...receipt,status:'dispatched'}}})
    }catch(error){
      const raw=String((error as {code?:string})?.code||'OSS_RECOVERY_AUTO_RESUME_FAILED')
      const code=/^[A-Z0-9_]{1,100}$/.test(raw)?raw:'OSS_RECOVERY_AUTO_RESUME_FAILED'
      await prisma.platformRecoveryEvidence.update({where:{id:entry.id},data:{payload:{...receipt,status:'failed',code}}})
    }
  })
}
