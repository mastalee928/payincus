import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { activeRecoveryBatch } from './platform-recovery-state.js'
import { recoveryOperator } from './platform-recovery-operator.js'
import { backupRoot, ensure, readJson, serializeBackupMutation, validateId } from './platform-backup-core.js'
import { activeBackupTask, enqueueBackupTask } from './platform-backup-scheduler.js'
import { pgQuery } from './platform-backup-database.js'
import { inspectRecoveryMapping, recoveryMappingEnvironment } from './platform-recovery-mapping.js'
import { recoveryHelperRetry, recoveryHelperErrorCode } from './platform-recovery-helper-policy.js'

const hash=(value:string)=>createHash('sha256').update(value).digest('hex')
interface MappingIntent {
  version:1; address:string; before:string; after:string; operator:string
  status:'pending'|'dispatched'|'retry'|'blocked'|'verified'; attempt:number; nextAt:string; taskId?:string; code?:string
}
const environment=()=>readFile('/opt/incudal/.env','utf8')
const operatorHash=async()=>hash(JSON.stringify(await recoveryOperator()))
async function latest(batchId:string) {
  const [row]=await pgQuery<{id:string;payload:MappingIntent}>(`SELECT id,payload FROM platform_recovery_evidence
    WHERE batch_id=$1 AND category='gateway-map-intent' ORDER BY created_at DESC,id DESC LIMIT 1`,[batchId])
  if(row){const value=row.payload;ensure(value?.version===1 && ['pending','dispatched','retry','blocked','verified'].includes(value.status) &&
    [value.before,value.after,value.operator].every(item=>/^[a-f0-9]{64}$/.test(item)) && Number.isSafeInteger(value.attempt) &&
    value.attempt>=0 && value.attempt<=8 && Number.isFinite(Date.parse(value.nextAt)),'OSS_RECOVERY_MAPPING_INTENT_INVALID',409)
    validateId(row.id);if(value.taskId)validateId(value.taskId)}
  return row
}
async function save(id:string,batchId:string,payload:MappingIntent) {
  const rows=await pgQuery(`UPDATE platform_recovery_evidence SET payload=$3::jsonb WHERE id=$1 AND batch_id=$2
    AND category='gateway-map-intent' RETURNING id`,[id,batchId,JSON.stringify(payload)])
  ensure(rows.length===1,'OSS_RECOVERY_MAPPING_INTENT_INVALID',409)
}
export async function recoveryMappingStatus(batchId:string) {
  const row=await latest(batchId)
  if(!row)return null
  const {address,status,attempt,nextAt,code}=row.payload
  return {address,status,attempt,nextAt,code:code||null}
}
// Save before any network request. A repeated submission for the same accepted
// address reads this receipt; it cannot create a second root job.
export async function authorizeRecoveryMapping(batch:Awaited<ReturnType<typeof activeRecoveryBatch>>,address:string,readEnvironment=environment) {
  ensure(batch.mode==='restore','OSS_RECOVERY_EXTERNAL_GATEWAY_REQUIRED',409)
  const source=await readEnvironment(),next=recoveryMappingEnvironment(source,address),operator=await operatorHash(),old=await latest(batch.id)
  if(old && old.payload.address===address && old.payload.operator===operator &&
    [old.payload.before,old.payload.after].includes(hash(source)) && old.payload.code!=='OSS_RECOVERY_MAPPING_AUTHORIZATION_CHANGED')
    return {id:old.id,queued:old.payload.status!=='verified'}
  ensure(!old || !['pending','dispatched','retry'].includes(old.payload.status),'OSS_RECOVERY_MAPPING_PENDING',409)
  const id=randomUUID(),payload:MappingIntent={version:1,address,before:hash(source),after:hash(next),operator,
    status:'pending',attempt:0,nextAt:new Date().toISOString()}
  await pgQuery(`INSERT INTO platform_recovery_evidence(id,batch_id,category,reference,evidence_hash,source_hash,observed_at,actor_id,payload)
    VALUES($1::uuid,$2,'gateway-map-intent',$1::text,$3,$3,NOW(),$4,$5::jsonb)`,[id,batch.id,hash(JSON.stringify(payload)),batch.operator_id,JSON.stringify(payload)])
  return {id,queued:true}
}
export async function assertRecoveryMappingIntent(batchId:string,intentId:string,taskId:string,address:string,source:string) {
  const batch=await activeRecoveryBatch(),entry=await latest(batchId)
  ensure(batch.id===batchId && entry?.id===intentId,'OSS_RECOVERY_CONTEXT_CHANGED',409)
  ensure(entry.payload.taskId===taskId && entry.payload.status==='dispatched' && entry.payload.address===address &&
    entry.payload.operator===await operatorHash() && hash(source)===entry.payload.before &&
    hash(recoveryMappingEnvironment(source,address))===entry.payload.after,'OSS_RECOVERY_MAPPING_AUTHORIZATION_CHANGED',409)
}
const defaultRuntime={active:activeBackupTask,enqueue:enqueueBackupTask,now:Date.now,environment,inspect:inspectRecoveryMapping}
export async function dispatchRecoveryMapping(runtime=defaultRuntime) {
  return serializeBackupMutation(async()=>{
    if(await runtime.active() || ['recovery-activation.json','recovery-mapping.json','recovery-supervisor.json'].some(name=>existsSync(join(backupRoot(),name))))return
    const batch=await activeRecoveryBatch(),entry=await latest(batch.id)
    if(!entry || entry.payload.status==='verified')return
    let intent=entry.payload
    if(Date.parse(intent.nextAt)>runtime.now() && intent.status!=='dispatched')return
    const source=await runtime.environment(),currentHash=hash(source)
    if(intent.operator!==await operatorHash() || ![intent.before,intent.after].includes(currentHash)){
      await save(entry.id,batch.id,{...intent,status:'blocked',code:'OSS_RECOVERY_MAPPING_AUTHORIZATION_CHANGED',nextAt:new Date(runtime.now()+1800000).toISOString()});return
    }
    const recorded=intent.taskId?await readJson<{status:string;error?:string}>(join(backupRoot(),'results',`${intent.taskId}.json`)):null
    if(recorded?.status==='success' && currentHash===intent.after){
      await save(entry.id,batch.id,{...intent,status:'verified',code:undefined,nextAt:new Date(runtime.now()).toISOString()});return
    }
    if(intent.status==='dispatched'){
      const result=recorded
      if(!result && Date.parse(intent.nextAt)>runtime.now())return
      // A committed WAL is completed by startup before this dispatcher runs.
      // Without its receipt, a changed environment cannot authorize a new write.
      const code=currentHash!==intent.before?'OSS_RECOVERY_MAPPING_RECEIPT_REQUIRED':result?.error || 'OSS_WORKER_STOPPED'
      const policy=recoveryHelperRetry(code,intent.attempt)
      await save(entry.id,batch.id,{...intent,status:policy.status,code,nextAt:new Date(runtime.now()+policy.delay).toISOString()});return
    }
    if(currentHash!==intent.before){
      await save(entry.id,batch.id,{...intent,status:'blocked',code:'OSS_RECOVERY_MAPPING_RECEIPT_REQUIRED',nextAt:new Date(runtime.now()+1800000).toISOString()});return
    }
    if(intent.status==='blocked'){
      // After bounded attempts only observe the original pinned endpoint. A
      // recovered connection permits another bounded sequence, never new trust.
      try {await runtime.inspect(source,intent.address)}catch{
        await save(entry.id,batch.id,{...intent,nextAt:new Date(runtime.now()+1800000).toISOString()});return
      }
      const retryable=recoveryHelperRetry(intent.code||'',1).status==='retry' ||
        ['SSH_HOST_KEY_CHANGED','SSH_IDENTITY_CHECK_FAILED','OSS_RECOVERY_GATEWAY_IDENTITY_CHANGED','OSS_RECOVERY_GATEWAY_CHANGED',
          'OSS_RECOVERY_MAPPING_AUTHORIZATION_CHANGED','OSS_RECOVERY_MAPPING_RECEIPT_REQUIRED'].includes(intent.code||'')
      if(!retryable){await save(entry.id,batch.id,{...intent,nextAt:new Date(runtime.now()+1800000).toISOString()});return}
      intent={...intent,attempt:0}
    }
    const taskId=randomUUID()
    intent={...intent,status:'dispatched',attempt:intent.attempt+1,taskId,code:undefined,nextAt:new Date(runtime.now()+90000).toISOString()}
    await save(entry.id,batch.id,intent)
    try {await runtime.enqueue('gateway-map',batch.operator_id,{recoveryBatchId:batch.id,gatewayAddress:intent.address,recoveryMappingId:entry.id},taskId)}
    catch(error){await pgQuery(`UPDATE platform_recovery_evidence SET payload=jsonb_set(payload,'{code}',to_jsonb($4::text))
      WHERE id=$1 AND batch_id=$2 AND payload->>'status'='dispatched' AND payload->>'taskId'=$3`,
      [entry.id,batch.id,taskId,recoveryHelperErrorCode(error)])}
  })
}
