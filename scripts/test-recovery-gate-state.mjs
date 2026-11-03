import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import vm from 'node:vm'
const require=createRequire(new URL('../client/package.json',import.meta.url))
const vue=require('vue'),ts=require('typescript'),{parse,compileScript}=require('vue/compiler-sfc')
const source=readFileSync(new URL('../client/src/components/backup/OssRecoveryGate.vue',import.meta.url),'utf8')
const code=ts.transpileModule(compileScript(parse(source).descriptor,{id:'recovery-gate-test'}).content,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const scopes=[],tick=async()=>{for(let i=0;i<8;i++){await vue.nextTick();await Promise.resolve()}}
function fixture(){
  let now=1000000
  const requests=[],hooks={},timers=[],events=[]
  const auth=vue.reactive({token:'session-one',captureAuthentication(){const token=this.token;return {current:()=>auth.token===token,aligned:true}}})
  const api={aliyunOss:new Proxy({},{get:(_,name)=>(...args)=>new Promise((resolve,reject)=>requests.push({name,args,resolve,reject}))})}
  const modules={vue:{...vue,...Object.fromEntries(['onMounted','onUnmounted','onActivated','onDeactivated'].map(name=>[name,fn=>{hooks[name]=fn}]))},
    'vue-i18n':{useI18n:()=>({t:(key,args)=>key+JSON.stringify(args||{}),te:()=>true,locale:vue.ref('zh-CN')})},
    '@/api/admin':{default:api},'@/stores/auth':{useAuthStore:()=>auth}}
  const exports={}
  vm.runInNewContext(code,{exports,require:name=>{assert.ok(modules[name],name);return modules[name]},console,crypto:{randomUUID},structuredClone,
    Date:class extends Date{static now(){return now}},setInterval:fn=>{timers.push(fn);return timers.length},clearInterval(){}},{filename:'OssRecoveryGate.vue'})
  const scope=vue.effectScope();scopes.push(scope)
  const s=scope.run(()=>exports.default.setup({disabled:false},{expose(){},emit:(...args)=>events.push(args)}))
  return {s,requests,hooks,timers,auth,events,advance(ms){now+=ms},last(name){const row=requests.findLast(row=>row.name===name);assert.ok(row,name);return row}}
}
const readiness={ready:false,hosts:{total:2,passed:1,pending:1},categories:[]}
try{
  assert.ok(!parse(source).descriptor.template.content.includes('<form'),'automatic progress has no evidence entry forms')
  const f=fixture()
  const first=f.s.refresh();f.last('recoveryReadiness').resolve(readiness);await first
  assert.equal(f.s.state.value.hosts.pending,1)
  const checking=f.s.refresh(),count=f.requests.length;await f.s.refresh();assert.equal(f.requests.length,count)
  f.last('recoveryReadiness').reject({httpStatus:503,code:'UNAVAILABLE'});await checking
  assert.equal(f.s.state.value.hosts.pending,1,'failed polling retains confirmed progress')
  await f.s.refresh();assert.equal(f.requests.length,count)
  f.advance(15000);const retry=f.s.refresh();f.last('recoveryReadiness').reject({httpStatus:503});await retry
  const retryCount=f.requests.length;f.advance(29000);await f.s.refresh();assert.equal(f.requests.length,retryCount)
  f.advance(1000);const recovered=f.s.refresh();f.last('recoveryReadiness').resolve({...readiness,ready:true});await recovered
  assert.equal(f.s.state.value.ready,true)
  const forbidden=f.s.refresh();f.last('recoveryReadiness').reject({httpStatus:403});await forbidden
  const stopped=f.requests.length;f.advance(3600000);await f.s.refresh();assert.equal(f.requests.length,stopped)
  assert.ok(f.requests.every(row=>row.name==='recoveryReadiness'),'viewing recovery never submits manual verification or mutations')
  console.log('PASS automatic progress: no manual forms/writes, retained result, overlapping reads, 15/30s backoff and permission refusal')
  f.auth.token='new-session';await tick();assert.equal(f.s.state.value,undefined)
  const late=f.s.refresh();f.hooks.onDeactivated();f.last('recoveryReadiness').resolve(readiness);await late
  assert.equal(f.s.state.value,undefined)
  const inactive=f.requests.length;await f.s.refresh();assert.equal(f.requests.length,inactive)
  f.hooks.onActivated();f.last('recoveryReadiness').resolve(readiness);await tick()
  assert.equal(f.s.state.value.hosts.pending,1)
  f.hooks.onUnmounted();assert.equal(f.s.state.value,undefined)
  console.log('PASS account replacement, inactive/unmounted cleanup and late private-result rejection')
}finally{for(const scope of scopes)scope.stop()}
