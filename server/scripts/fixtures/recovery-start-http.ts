import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile, unlink } from 'node:fs/promises'
import * as path from 'node:path'
import Fastify from 'fastify'
import ts from 'typescript'
import * as core from '../../src/services/platform-backup-core.js'
import * as start from '../../src/services/platform-recovery-start.js'

// Real Fastify hooks, JSON schema and serialization, with only the external
// authentication/database/OS boundaries replaced. No production server.
export async function verifyAutomaticRestoreHttp(runtime:start.AutomaticRestoreRuntime) {
  const app=Fastify({logger:false,ajv:{customOptions:{removeAdditional:true}}})
  process.env.ADMIN_FRONTEND_URL='https://admin.example.test'
  app.decorate('authenticateAdmin',async(request:any)=>{
    const actor=request.headers['x-fixture-actor']
    core.ensure(actor==='admin' || actor==='other-admin','OSS_ADMIN_REQUIRED',403)
    request.user={id:actor==='admin'?1:2,username:actor==='admin'?'admin':'other-admin',role:'admin',
      sid:request.headers['x-fixture-session']==='no'?undefined:'fixture-session'}
  })
  let mutations=0,audits=0,hostChecks=0
  const code=ts.transpileModule(await readFile(new URL('../../src/routes/admin-aliyun-oss.ts',import.meta.url),'utf8'),{
    compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText
  const modules:Record<string,unknown>={
    'node:path':path,
    '../services/platform-backup-core.js':core,
    '../services/platform-recovery-start.js':{...start,beginAutomaticRestore:async(...args:Parameters<typeof start.beginAutomaticRestore>)=>{
      mutations++;return start.beginAutomaticRestore(args[0],args[1],runtime)}},
    '../services/platform-backup-scheduler.js':{activeBackupTask:async()=>null,backupRuntimeReady:()=>true},
    '../services/aliyun-oss-client.js':{sanitizedOssError:()=>new core.BackupError('OSS_NETWORK_FAILED',503)},
    '../lib/demo-safety.js':{isDemoRequest:()=>false},
    '../db/logs.js':{createLog:async()=>{audits++}},
    '../lib/origin-config.js':{normalizeOrigin:(value:string)=>value},
    '../services/platform-recovery-review.js':{RECOVERY_REVIEW_SECTIONS:['balances'],recoveryReview:async()=>({status:'restoring'})},
    '../services/platform-recovery-operator.js':{validateRecoverySession:async()=>true,recoveryOperator:async()=>({username:'admin'})},
    '../services/platform-recovery-queue.js':{runRecoveryHostCheck:async()=>{hostChecks++;return {queued:true}},retryBlockedRecoveryHosts:async()=>{hostChecks++;return {queued:true}}}
  }
  const exports:any={}
  new Function('require','exports',code)((name:string)=>modules[name]||{},exports)
  await app.register(exports.default,{prefix:'/api/admin/aliyun-oss'})
  const headers={authorization:'Bearer isolated-fixture-session',origin:process.env.ADMIN_FRONTEND_URL,
    'sec-fetch-site':'same-origin','x-fixture-actor':'admin'}
  const payload={id:randomUUID(),prefix:'backups/original/http-selected/'}
  const send=(body:unknown,override:Record<string,string>={})=>app.inject({method:'POST',url:'/api/admin/aliyun-oss/automatic-restores',headers:{...headers,...override},payload:body as any})
  try {
    for(const [override,status] of [[{'x-fixture-actor':'user'},403],[{'x-fixture-actor':'other-admin'},403],
      [{'x-fixture-session':'no'},403],[{origin:'https://foreign.example.test'},403],[{'sec-fetch-site':'cross-site'},403]] as const)
      assert.equal((await send(payload,override)).statusCode,status)
    for(const body of [{...payload,force:true},{...payload,id:'invalid'},{...payload,password:'short'},[],null])
      assert.equal((await send(body)).statusCode,400)
    assert.equal(mutations,0);assert.equal(audits,0,'invalid input cannot create an accepted task')
    const accepted=await send(payload)
    assert.equal(accepted.statusCode,202,accepted.body)
    const operation=accepted.json().operation
    const replay=await send(payload);assert.equal(replay.statusCode,202)
    assert.deepEqual(replay.json().operation,operation)
    assert.equal((await send({...payload,password:'different-password'})).statusCode,409)
    assert.equal((await send({...payload,id:randomUUID(),prefix:'backups/other/'})).statusCode,409)
    assert.ok(!/authorization|requestHash|password|backupPassword/.test(accepted.body))
    assert.equal((await start.readAutomaticRestore())?.id,payload.id)
    const holdFile=path.join(core.backupRoot(),'recovery-hold.json')
    assert.equal(await core.readJson(holdFile),null)
    await core.writeJson(holdFile,{taskId:randomUUID(),batchId:randomUUID(),restorePolicy:'snapshot-v1'})
    try {
      // onRequest must reject legacy edits before schema validation or any
      // database mutation, including when a caller bypasses the simplified UI.
      for(const route of ['reconcile','orders/resolve','orders/legacy-links','orders/billing-links','evidence','access',
        'gateway','gateway/map','gateway/helper','register','register-account','instance-evidence','register-recharge']){
        const response=await app.inject({method:'POST',url:'/api/admin/aliyun-oss/recovery-review/'+route,headers,payload:{}})
        assert.equal(response.statusCode,409,response.body)
        assert.equal(response.json().code,'OSS_RECOVERY_SNAPSHOT_READ_ONLY')
      }
      assert.equal((await app.inject({method:'GET',url:'/api/admin/aliyun-oss/recovery-review',headers})).statusCode,200)
      for(const [route,body] of [['hosts/1/probe',{}],['hosts/retry',{batchId:randomUUID()}]] as const)
        assert.equal((await app.inject({method:'POST',url:'/api/admin/aliyun-oss/recovery-review/'+route,headers,payload:body})).statusCode,200)
      assert.equal(hostChecks,2)
    } finally {await unlink(holdFile)}
    console.log('PASS snapshot recovery HTTP: thirteen legacy writes rejected, status and host connection checks available')
    console.log('PASS HTTP one-click acceptance/replay, same-origin admin session, strict payload and secret-free response')
  } finally {await app.close()}
}
