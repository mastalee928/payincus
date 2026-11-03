import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, unlink, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { backupRoot, ensure, readJson, serializeBackupMutation, statePath, validateId, writeJson } from './platform-backup-core.js'
import { activeRecoveryBatch } from './platform-recovery-state.js'
import { recoveryOperator } from './platform-recovery-operator.js'
import { gatewayCommand, type OnboardingGateway } from './onboarding-ssh.js'
import { assertSavedRecoveryGateway, gatewayBaseline } from './platform-recovery-gateway-baseline.js'
import { encryptGatewayTaskSecret, decryptGatewayTaskSecret } from './gateway-admin-authorization.js'
import { refreshPinnedGatewayHelpers } from './gateway-dns-channel.js'
import { activeBackupTask, enqueueBackupTask } from './platform-backup-scheduler.js'
import { pgQuery } from './platform-backup-database.js'
import { recoveryHelperErrorCode, recoveryHelperRetry } from './platform-recovery-helper-policy.js'
export { recoveryHelperRetry } from './platform-recovery-helper-policy.js'

function canonical(value:unknown):unknown {
  if(Array.isArray(value))return value.map(canonical)
  if(value && typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)]))
  return value
}
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
interface HelperIntent {
  version:1; binding:string; secret:string|null; identity:ReturnType<typeof gatewayBaseline>
  status:'pending'|'dispatched'|'retry'|'blocked'|'verified';attempt:number;nextAt:string;taskId?:string;code?:string
}
async function helperBinding() {
  const operator=await recoveryOperator()
  return digest({operator,target:['ONBOARDING_GATEWAY_HOST','ONBOARDING_GATEWAY_PORT','ONBOARDING_GATEWAY_FINGERPRINT',
    'ONBOARDING_GATEWAY_KEY_PATH','ONBOARDING_WG_ENDPOINT'].map(key=>[key,process.env[key]||''])})
}
async function latestIntent(batchId:string) {
  const [row]=await pgQuery<{id:string;payload:HelperIntent;source_hash:string}>(`SELECT id,payload,source_hash FROM platform_recovery_evidence
    WHERE batch_id=$1 AND category='gateway-helper' AND payload->>'version'='1' ORDER BY created_at DESC,id DESC LIMIT 1`,[batchId])
  return row
}
function validateIntent(value:HelperIntent) {
  ensure(value && value.version===1 && /^[a-f0-9]{64}$/.test(value.binding) && ['pending','dispatched','retry','blocked','verified'].includes(value.status) &&
    Number.isSafeInteger(value.attempt) && value.attempt>=0 && value.attempt<=8 && Number.isFinite(Date.parse(value.nextAt)) &&
    (value.secret===null || typeof value.secret==='string' && /^[a-f0-9-]{36}$/.test(value.secret)),'OSS_RECOVERY_HELPER_INTENT_INVALID',409)
  if(value.secret)validateId(value.secret)
  if(value.taskId)validateId(value.taskId)
}
export async function recoveryHelperStatus(batchId:string) {
  const row=await latestIntent(batchId)
  if(!row)return null
  validateIntent(row.payload)
  const {status,attempt,nextAt,code}=row.payload
  return {status,attempt,nextAt,code:code||null}
}
// The explicit helper authorization persists across browser disconnects. Its
// ciphertext stays in the private local inbox, outside database snapshots.
const secretPath=(id:string)=>statePath('inbox',`helper-${validateId(id)}.secret.json`)
async function forgetSecret(intent:HelperIntent){if(intent.secret)await unlink(secretPath(intent.secret)).catch(error=>{if(error.code!=='ENOENT')throw error})}
// An interrupted insert can leave a local ciphertext without a DB receipt.
// Remove it only after a successful DB read proves no accepted intent uses it.
export async function pruneRecoveryHelperSecrets(now=Date.now()) {
  for(const name of await readdir(join(backupRoot(),'inbox'))){
    const id=/^helper-([a-f0-9-]{36})\.secret\.json$/.exec(name)?.[1]
    if(!id)continue
    const path=secretPath(id),info=await stat(path).catch(error=>{if(error.code!=='ENOENT')throw error;return null})
    if(!info || now-info.mtimeMs<300000)continue
    const rows=await pgQuery(`SELECT id FROM platform_recovery_evidence WHERE category='gateway-helper' AND payload->>'secret'=$1 LIMIT 1`,[id])
    if(!rows.length)await unlink(path).catch(error=>{if(error.code!=='ENOENT')throw error})
  }
}
export async function authorizeRecoveryHelper(batch:Awaited<ReturnType<typeof activeRecoveryBatch>>,current:OnboardingGateway,password:string) {
  await assertSavedRecoveryGateway(current)
  ensure(!['127.0.0.1','localhost','::1'].includes(process.env.ONBOARDING_GATEWAY_HOST||''),'OSS_RECOVERY_EXTERNAL_GATEWAY_REQUIRED',409)
  ensure(typeof password==='string' && password.length>0 && password.length<=1024,'OSS_RECOVERY_HELPER_PASSWORD_REQUIRED')
  const binding=await helperBinding(),identity=gatewayBaseline(current),previous=await latestIntent(batch.id)
  if(previous){validateIntent(previous.payload);if(['pending','dispatched','retry'].includes(previous.payload.status)){
    ensure(previous.payload.binding===binding && digest(previous.payload.identity)===digest(identity),'OSS_RECOVERY_HELPER_AUTHORIZATION_CHANGED',409)
    return {updated:false,queued:true,id:previous.id}
  }}
  const id=randomUUID(),payload:HelperIntent={version:1,binding,identity,secret:id,status:'pending',attempt:0,nextAt:new Date().toISOString()}
  await writeJson(secretPath(id),{intentId:id,batchId:batch.id,binding,identityHash:digest(identity),ciphertext:encryptGatewayTaskSecret(password)})
  try { await pgQuery(`INSERT INTO platform_recovery_evidence(id,batch_id,category,reference,evidence_hash,source_hash,observed_at,actor_id,payload)
    VALUES($1::uuid,$2,'gateway-helper',$1::text,$3,$3,NOW(),$4,$5::jsonb)`,[id,batch.id,digest({binding,identity}),batch.operator_id,JSON.stringify(payload)])
  } catch(error) {
    // A lost COMMIT response may still mean acceptance. Keep its credential if
    // the database cannot confirm absence; the next sweep resolves the orphan.
    const saved=await pgQuery('SELECT id FROM platform_recovery_evidence WHERE id=$1',[id]).catch(()=>null)
    if(saved?.length===0)await forgetSecret(payload)
    throw error
  }
  if(previous)await forgetSecret(previous.payload)
  return {updated:false,queued:true,id}
}
async function saveIntent(id:string,batchId:string,payload:HelperIntent,source?:string) {
  const rows=await pgQuery(`UPDATE platform_recovery_evidence SET payload=$3::jsonb,source_hash=COALESCE($4,source_hash)
    WHERE id=$1 AND batch_id=$2 AND category='gateway-helper' RETURNING id`,[id,batchId,JSON.stringify(payload),source||null])
  ensure(rows.length===1,'OSS_RECOVERY_HELPER_INTENT_INVALID',409)
}

// Run under the existing root maintenance flock. The helper performs bounded,
// atomic replacement of exactly three packaged files, never keys/peers/guests.
export async function executeRecoveryHelper(batchId:string,intentId:string,taskId:string,runtime={read:gatewayCommand,apply:refreshPinnedGatewayHelpers}) {
  validateId(intentId);validateId(taskId)
  const batch=await activeRecoveryBatch(),entry=await latestIntent(batchId)
  ensure(batch.id===batchId && entry?.id===intentId,'OSS_RECOVERY_CONTEXT_CHANGED',409)
  const intent=entry.payload;validateIntent(intent)
  ensure(intent.taskId===taskId && ['pending','dispatched','retry'].includes(intent.status),'OSS_RECOVERY_HELPER_INTENT_INVALID',409)
  ensure(intent.binding===await helperBinding(),'OSS_RECOVERY_HELPER_AUTHORIZATION_CHANGED',409)
  let current=await runtime.read()
  await assertSavedRecoveryGateway(current)
  ensure(digest(gatewayBaseline(current))===digest(intent.identity),'OSS_RECOVERY_GATEWAY_IDENTITY_CHANGED',409)
  if(current.recoveryProtocolVersion!==1){
    ensure(intent.secret,'OSS_RECOVERY_HELPER_PASSWORD_REQUIRED',409)
    ensure((await activeRecoveryBatch()).id===batch.id && intent.binding===await helperBinding(),'OSS_RECOVERY_HELPER_AUTHORIZATION_CHANGED',409)
    const secret=await readJson<{intentId:string;batchId:string;binding:string;identityHash:string;ciphertext:string}>(secretPath(intent.secret),8192)
    ensure(secret,'OSS_RECOVERY_HELPER_PASSWORD_REQUIRED',409)
    ensure(secret.intentId===intentId && secret.batchId===batchId && secret.binding===intent.binding && secret.identityHash===digest(intent.identity),
      'OSS_RECOVERY_HELPER_SECRET_INVALID',409)
    let password:string
    try { password=decryptGatewayTaskSecret(secret.ciphertext) } catch { ensure(false,'OSS_RECOVERY_HELPER_SECRET_INVALID',409) }
    await runtime.apply(current,password!)
    current=await runtime.read()
  }
  await assertSavedRecoveryGateway(current)
  ensure(current.recoveryProtocolVersion===1 && digest(gatewayBaseline(current))===digest(intent.identity),'OSS_RECOVERY_GATEWAY_HELPER_REQUIRED',409)
  ensure((await activeRecoveryBatch()).id===batch.id && intent.binding===await helperBinding(),'OSS_RECOVERY_HELPER_AUTHORIZATION_CHANGED',409)
  await forgetSecret(intent)
  await saveIntent(entry.id,batch.id,{...intent,secret:null,status:'verified',code:undefined,nextAt:new Date().toISOString()})
  // Clear only the old check schedule. The next tick must verify live peers and
  // revocations; installing files by itself cannot satisfy the recovery gate.
  await pgQuery(`UPDATE platform_recovery_evidence SET payload=jsonb_set(payload,'{nextAt}',to_jsonb($2::text))
    WHERE batch_id=$1 AND category='gateway-check'`,[batch.id,new Date().toISOString()])
}
const defaultRuntime={active:activeBackupTask,enqueue:enqueueBackupTask,now:Date.now,read:gatewayCommand}
export async function dispatchRecoveryHelper(runtime=defaultRuntime) {
  return serializeBackupMutation(async()=>{
    if(await runtime.active() || ['recovery-activation.json','recovery-mapping.json','recovery-supervisor.json'].some(name=>existsSync(join(backupRoot(),name))))return
    await pruneRecoveryHelperSecrets(runtime.now())
    const batch=await activeRecoveryBatch(),entry=await latestIntent(batch.id)
    if(!entry)return
    let intent=entry.payload;validateIntent(intent)
    if(intent.status==='verified')return
    if(intent.binding!==await helperBinding()){
      if(intent.code!=='OSS_RECOVERY_HELPER_AUTHORIZATION_CHANGED'){
        await forgetSecret(intent)
        await saveIntent(entry.id,batch.id,{...intent,status:'blocked',secret:null,code:'OSS_RECOVERY_HELPER_AUTHORIZATION_CHANGED'})
      }
      return
    }
    if(intent.taskId && intent.status==='dispatched'){
      const result=await readJson<{status:string;error?:string}>(join(backupRoot(),'results',`${intent.taskId}.json`))
      if(!result && Date.parse(intent.nextAt)>runtime.now())return
      const code=result?.error || intent.code || (result?.status==='success'?'OSS_RECOVERY_HELPER_RECEIPT_CONFLICT':'OSS_WORKER_STOPPED'),retry=recoveryHelperRetry(code,intent.attempt)
      intent={...intent,status:retry.status,code,nextAt:new Date(runtime.now()+retry.delay).toISOString()}
      await saveIntent(entry.id,batch.id,intent)
      return
    }
    if(Date.parse(intent.nextAt)>runtime.now())return
    const files=[]
    for(const name of ['onboarding-gateway.py','refresh-host-gateway-endpoint.py','install-host-gateway-dns.sh','upgrade-onboarding-gateway.py']){
      files.push([name,createHash('sha256').update(await readFile(fileURLToPath(new URL('../../../scripts/'+name,import.meta.url)))).digest('hex')])
    }
    const source=digest({binding:intent.binding,files})
    if(intent.status==='blocked'){
      let originalReturned=false
      // Read-only observation can recognize a response lost after installation,
      // but a failed password/pin never triggers repeated root writes.
      try {
        const current=await runtime.read();await assertSavedRecoveryGateway(current)
        originalReturned=digest(gatewayBaseline(current))===digest(intent.identity)
        if(current.recoveryProtocolVersion===1 && digest(gatewayBaseline(current))===digest(intent.identity)){
          await forgetSecret(intent);await saveIntent(entry.id,batch.id,{...intent,secret:null,status:'verified',code:undefined,nextAt:new Date(runtime.now()).toISOString()});return
        }
      }catch{/* Retain the exact earlier failure; this observation authorizes no write. */}
      const originalIdentityReturned=originalReturned && ['SSH_HOST_KEY_CHANGED','SSH_IDENTITY_CHECK_FAILED','GATEWAY_DNS_HOST_IDENTITY_CHANGED','OSS_RECOVERY_GATEWAY_IDENTITY_CHANGED'].includes(intent.code||'')
      const observeRetry=originalReturned && recoveryHelperRetry(intent.code||'',1).status==='retry'
      const needsCredential=['SSH_AUTH_FAILED','OSS_RECOVERY_HELPER_PASSWORD_REQUIRED','OSS_RECOVERY_HELPER_SECRET_INVALID'].includes(intent.code||'')
      if(!intent.secret || needsCredential || (!observeRetry && !originalIdentityReturned && (intent.attempt>=8 || source===entry.source_hash))){await saveIntent(entry.id,batch.id,{...intent,nextAt:new Date(runtime.now()+1800000).toISOString()});return}
    }
    const taskId=randomUUID()
    intent={...intent,status:'dispatched',attempt:Math.min(intent.attempt+1,8),taskId,code:undefined,nextAt:new Date(runtime.now()+90000).toISOString()}
    await saveIntent(entry.id,batch.id,intent,source)
    try {await runtime.enqueue('gateway-helper',batch.operator_id,{recoveryBatchId:batch.id,recoveryHelperId:entry.id},taskId)}
    catch(error){
      // The task ID remains dispatched: timeout can mean systemd accepted it.
      // A fast root worker may already have saved verified while systemctl's
      // reply was lost. Never overwrite that receipt with this older snapshot.
      await pgQuery(`UPDATE platform_recovery_evidence SET payload=jsonb_set(payload,'{code}',to_jsonb($4::text))
        WHERE id=$1 AND batch_id=$2 AND payload->>'status'='dispatched' AND payload->>'taskId'=$3`,
        [entry.id,batch.id,taskId,recoveryHelperErrorCode(error)])
    }
  })
}
