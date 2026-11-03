import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import {randomUUID} from 'node:crypto'
const require=createRequire(new URL('../client/package.json',import.meta.url))
const vue=require('vue'),ts=require('typescript'),{parse,compileScript}=require('vue/compiler-sfc')
const source=readFileSync(new URL('../client/src/views/admin/AliyunOssView.vue',import.meta.url),'utf8')
const code=ts.transpileModule(compileScript(parse(source).descriptor,{id:'recovery-test'}).content,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const reviewSource=readFileSync(new URL('../client/src/components/backup/OssRecoveryReview.vue',import.meta.url),'utf8')
const reviewCode=ts.transpileModule(compileScript(parse(reviewSource).descriptor,{id:'recovery-review-test'}).content,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const scopes=[]
const tick=async()=>{await vue.nextTick();await Promise.resolve();await Promise.resolve()}
function fixture(review=false){
  let now=1000000
  const requests=[],hooks={},timers=[],notices=[]
  const auth=vue.reactive({token:'session-one',captureAuthentication(){const token=this.token;return {current:()=>auth.token===token,aligned:true}}})
  const request=(name,args)=>new Promise((resolve,reject)=>requests.push({name,args,resolve,reject}))
  const api={aliyunOss:new Proxy({},{get:(_,name)=>(...args)=>request(name,args)})}
  const modules={vue:{...vue,...Object.fromEntries(['onMounted','onUnmounted','onActivated','onDeactivated'].map(name=>[name,fn=>{hooks[name]=fn}]))},
    'vue-i18n':{useI18n:()=>({t:(key,args)=>key+JSON.stringify(args||{}),te:()=>true,locale:vue.ref('zh-CN')})},
    '@/api/admin':{default:api},'@/stores/toast':{useToast:()=>({error:text=>notices.push(text),success:text=>notices.push(text)})},
    '@/stores/auth':{useAuthStore:()=>auth},'@/components/backup/OssRecoveryReview.vue':{default:{}},
    './OssRecoveryGate.vue':{default:{}},'./OssRecoveryReconcile.vue':{default:{}}}
  const exports={}
  vm.runInNewContext(review?reviewCode:code,{exports,require:name=>{assert.ok(modules[name],name);return modules[name]},console,crypto:{randomUUID},
    Date:class extends Date{static now(){return now}},setInterval:fn=>{timers.push(fn);return timers.length},clearInterval(){}},{filename:'AliyunOssView.vue'})
  const scope=vue.effectScope();scopes.push(scope)
  const s=scope.run(()=>exports.default.setup({disabled:false}, {expose(){},emit(){}}))
  return {s,requests,hooks,timers,auth,notices,advance(ms){now+=ms},last(name){return requests.findLast(row=>row.name===name)}}
}
const state={config:null,runtimeReady:true,recoveryHeld:true}
const tasks={tasks:[{id:'retained-complete'}],activeTask:null,recoveryHeld:true,autoResume:true}
async function initialized(f){
  f.last('config').resolve(state);f.last('regions').resolve({regions:[]});await tick()
  f.last('tasks').resolve(tasks);await tick();await tick()
}
try {
  const autoList=fixture();autoList.hooks.onMounted()
  autoList.last('config').resolve({config:{bucket:'saved-backups',hasBackupPassword:true},runtimeReady:true,recoveryHeld:false})
  autoList.last('regions').resolve({regions:[]});await tick()
  autoList.last('tasks').resolve({...tasks,recoveryHeld:false});await tick();await tick()
  assert.ok(autoList.last('backups'),'saved OSS configuration automatically lists available backups')
  autoList.last('backups').resolve({backups:[],nextCursor:null});await tick()
  const f=fixture();f.hooks.onMounted()
  f.last('config').reject({code:'TEMPORARY_UNAVAILABLE',httpStatus:503});f.last('regions').resolve({regions:[]});await tick();await tick()
  assert.equal(f.s.nextReadAt.value,1015000)
  await f.s.pollState();assert.equal(f.requests.length,2)
  f.advance(15000);const retry=f.s.pollState()
  f.last('config').reject({httpStatus:503,code:'TEMPORARY_UNAVAILABLE'});f.last('regions').resolve({regions:[]});await retry
  assert.equal(f.s.nextReadAt.value,1045000)
  f.advance(30000);const success=f.s.pollState();await initialized(f);await success
  assert.equal(f.s.loadError.value,'');assert.equal(f.s.nextReadAt.value,0)
  const poll=f.s.pollState(),count=f.requests.length;await f.s.pollState();assert.equal(f.requests.length,count,'overlapping interval cannot duplicate reads')
  f.last('tasks').reject({httpStatus:503,code:'TEMPORARY_UNAVAILABLE'});await poll
  assert.equal(f.s.tasks.value[0].id,'retained-complete','temporary loss preserves confirmed progress')
  assert.ok(f.s.pollError.value);assert.equal(f.s.nextReadAt.value,1060000)
  f.advance(15000);const denied=f.s.pollState();f.last('tasks').reject({httpStatus:403,code:'FORBIDDEN'});await denied
  const afterDenied=f.requests.length;f.advance(3600000);await f.s.pollState();assert.equal(f.requests.length,afterDenied,'permission refusal does not loop')
  console.log('PASS initial 15/30 second retry, successful continuation, preserved progress, poll overlap and permission refusal')
  const g=fixture();g.hooks.onMounted();await initialized(g)
  const pending=g.s.pollState(),old=g.last('tasks')
  g.s.form.accessKeySecret='isolated-input';g.s.restorePassword.value='isolated-password';g.hooks.onDeactivated()
  assert.equal(g.s.form.accessKeySecret,'');assert.equal(g.s.restorePassword.value,'');assert.equal(g.s.tasks.value.length,0)
  const inactiveCount=g.requests.length;await g.s.pollState();assert.equal(g.requests.length,inactiveCount)
  g.hooks.onActivated();old.resolve({...tasks,tasks:[{id:'obsolete-receipt'}]});await pending
  assert.equal(g.s.tasks.value.length,0,'late receipt cannot restore deactivated state')
  const resumed=g.s.pollState();await initialized(g);await resumed
  assert.equal(g.s.tasks.value[0].id,'retained-complete')
  const beforeSwitch=g.s.pollState(),previousSession=g.last('tasks');g.auth.token='replacement-session';await tick()
  previousSession.resolve({...tasks,tasks:[{id:'another-account-private-task'}]});await beforeSwitch
  assert.equal(g.s.tasks.value.length,0)
  const switched=g.s.pollState();await initialized(g);await switched
  assert.equal(g.s.tasks.value[0].id,'retained-complete')
  console.log('PASS cached-page pause/resume, secret cleanup, late receipt rejection and replacement-session initialization')
  const saving=g.s.save(),save=g.last('save');g.auth.token='third-session';await tick()
  save.resolve({config:{...state,bucket:'private-previous-account'}});await saving
  assert.equal(g.s.config.value,null);assert.equal(g.notices.length,0,'obsolete success cannot publish config or notification')
  g.last('config').resolve(state);g.last('regions').resolve({regions:[]});await tick();g.last('tasks').resolve(tasks);await tick()
  const h=fixture();h.hooks.onMounted();h.hooks.onUnmounted()
  h.last('config').resolve(state);h.last('regions').resolve({regions:[]});await tick()
  assert.equal(h.requests.filter(row=>row.name==='tasks').length,0,'unmount stops dependent requests')
  assert.equal(h.s.runtimeReady.value,false)
  console.log('PASS obsolete save success and unmounted initialization cannot publish data or start dependent actions')
  const r=fixture(true),report={hostResults:[],rows:[{id:1}],total:1}
  const first=r.s.load();r.last('recoveryReview').resolve(report);await first
  const failure=r.s.load();r.last('recoveryReview').reject({httpStatus:503});await failure
  assert.equal(r.s.report.value.rows[0].id,1,'review retains confirmed progress on transient failure')
  const reviewCount=r.requests.length;await r.s.load();assert.equal(r.requests.length,reviewCount)
  r.advance(15000);const second=r.s.load();r.last('recoveryReview').reject({response:{status:503}});await second
  const count2=r.requests.length;r.advance(29000);await r.s.load();assert.equal(r.requests.length,count2)
  r.advance(1000);const recovered=r.s.load();r.last('recoveryReview').resolve(report);await recovered
  const refused=r.s.load();r.last('recoveryReview').reject({httpStatus:403});await refused
  const stopped=r.requests.length;r.advance(3600000);await r.s.load();assert.equal(r.requests.length,stopped)
  r.auth.token='review-new-session';await tick();const replaced=r.s.load();r.last('recoveryReview').resolve(report);await replaced
  assert.equal(r.s.report.value.rows[0].id,1)
  const lateReview=r.s.load();r.hooks.onDeactivated();r.last('recoveryReview').resolve({hostResults:[],rows:[{id:99}]});await lateReview
  assert.equal(r.s.report.value,undefined)
  console.log('PASS review child: preserved progress, 15/30s backoff, 403 read/write stop, new session and inactive late-response rejection')
  const single=fixture();single.hooks.onMounted();await initialized(single)
  single.s.held.value=false;single.s.config.value={hasBackupPassword:true,bucket:'private-bucket'}
  const restore=single.s.preview({prefix:'backups/original/selected/'})
  const firstRequest=single.last('automaticRestore');assert.ok(firstRequest)
  assert.equal('password' in firstRequest.args[0],false,'saved password is reused without prompting')
  firstRequest.reject({httpStatus:503});await tick()
  single.last('tasks').resolve({...tasks,recoveryHeld:false,automaticRestore:null});await restore
  assert.equal(single.s.automaticUncertain.value,true)
  await single.s.preview({prefix:'backups/original/another/'})
  assert.equal(single.requests.filter(row=>row.name==='automaticRestore').length,1,'ambiguous response blocks conflicting selection')
  single.advance(15000)
  const follow=single.s.pollState();single.last('tasks').resolve({...tasks,recoveryHeld:false,automaticRestore:null});await tick()
  const replay=single.last('automaticRestore')
  assert.deepEqual(replay.args,firstRequest.args,'retry reuses exact operation identity')
  replay.resolve({operation:{id:firstRequest.args[0].id,phase:'preview',taskId:'same-task'}});await follow
  assert.equal(single.s.automaticUncertain.value,false);assert.equal(single.s.automaticRestore.value.phase,'preview')
  assert.equal(single.requests.filter(row=>['restore','resume','preview'].includes(row.name)).length,0,'one-click flow never requests a second confirmation')
  console.log('PASS one-click restore with saved secret, ambiguous acceptance observation, same-ID retry and no second confirmation')
  const discovery=fixture();discovery.hooks.onMounted();await initialized(discovery)
  discovery.s.config.value={bucket:'private-bucket'}
  const discover=discovery.s.loadBackups()
  discovery.last('backups').resolve({backups:[{id:'older',prefix:'original-a/older/',createdAt:'2026-10-01'}],issues:[{prefix:'original-a/broken/',code:'OSS_INDEX_INVALID'}],nextCursor:'next'})
  await tick()
  assert.deepEqual(discovery.last('backups').args,[undefined,'next'])
  assert.equal(discovery.s.backups.value.length,1);assert.equal(discovery.s.discovering.value,true)
  discovery.last('backups').resolve({backups:[{id:'newer',prefix:'original-a/newer/',createdAt:'2026-10-02'}],nextCursor:null})
  await discover
  assert.equal(discovery.s.backups.value[0].id,'newer');assert.equal(discovery.s.backupIssues.value.length,1)
  assert.equal(discovery.s.discovering.value,false)
  const stale=discovery.s.loadBackups();discovery.hooks.onDeactivated()
  discovery.last('backups').resolve({backups:[{id:'stale',prefix:'private/',createdAt:'2026-10-03'}],nextCursor:'must-not-read'})
  await stale;assert.equal(discovery.s.backups.value.length,0)
  assert.equal(discovery.s.discovering.value,false)
  console.log('PASS automatic backup pagination, newest-first results, invalid marker disclosure and stale session cleanup')
  const settings=fixture();settings.hooks.onMounted();await initialized(settings)
  settings.s.held.value=false
  const settingsSave=settings.s.save();settings.last('save').resolve({config:{bucket:'saved-backups',hasBackupPassword:true}});await tick()
  assert.ok(settings.last('backups'),'saving OSS credentials immediately loads old backups without a page reload')
  settings.last('backups').resolve({backups:[{id:'saved',prefix:'backups/saved/',createdAt:'2026-11-03'}],nextCursor:null});await settingsSave
  assert.equal(settings.s.backups.value[0].id,'saved')
  settings.s.saveThenTest.value=true
  const testing=settings.s.submitSettings();await tick()
  assert.equal(settings.requests.at(-1).name,'test')
  settings.last('test').resolve({config:{bucket:'saved-backups',hasBackupPassword:true}})
  await tick();settings.last('backups').resolve({backups:[{id:'tested',prefix:'backups/tested/',createdAt:'2026-11-03'}],nextCursor:null});await testing
  assert.equal(settings.s.backups.value[0].id,'tested')
  console.log('PASS save and save/test immediately discover backups with the accepted OSS configuration')
  for(const fails of [false,true]) {
    const oldDiscovery=settings.s.loadBackups(),oldPage=settings.last('backups')
    const newSave=settings.s.save();settings.last('save').resolve({config:{bucket:'new-bucket',hasBackupPassword:true}});await tick()
    const newPage=settings.last('backups');assert.notEqual(newPage,oldPage)
    newPage.resolve({backups:[{id:'new-bucket-backup',prefix:'new/',createdAt:'2026-11-03'}],nextCursor:null});await newSave
    if(fails)oldPage.reject({code:'OSS_AccessDenied'})
    else oldPage.resolve({backups:[{id:'wrong-bucket',prefix:'old/',createdAt:'2026-11-04'}],nextCursor:'obsolete-page'})
    await oldDiscovery
    assert.equal(settings.s.backups.value.length,1)
    assert.equal(settings.s.backups.value[0].id,'new-bucket-backup')
    assert.equal(settings.last('backups'),newPage,'old pagination must stop at a changed configuration')
    assert.equal(settings.s.actionError.value,'','old credential errors cannot overwrite a successful save')
  }
  console.log('PASS saving during discovery rejects stale bucket results, pagination and errors')
}finally{for(const scope of scopes)scope.stop()}
