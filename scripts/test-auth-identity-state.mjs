import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import vm from 'node:vm'

const require = createRequire(new URL('../client/package.json', import.meta.url))
const vue = require('vue'), pinia = require('pinia'), ts = require('typescript')
const source = process.argv.includes('--baseline')
  ? execFileSync('git', ['show', 'HEAD:client/src/stores/auth.ts'], { encoding: 'utf8' })
  : readFileSync(new URL('../client/src/stores/auth.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const token = (id = 1, sid = 'session-1', role = 'admin', marker = '') => 'fixture.' + btoa(JSON.stringify({ id, sid, role, marker })) + '.fixture'
const user = (id = 1, role = 'admin') => ({ id, username: `fixture-${id}`, role, quota: { hostLimit: 0 } })
function fixture() {
  const values = new Map([['token', token()]]), pending = [], timers = [], listeners = {}
  const storage = { getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,String(v)), removeItem: k => values.delete(k), clear: () => values.clear() }
  const request = kind => new Promise((resolve,reject) => pending.push({kind,resolve,reject}))
  const modules = { vue, pinia, '@/api': { default: { auth: { me: () => request('me'), logout: () => request('logout') } } } }
  const exports = {}
  vm.runInNewContext(compiled, { exports, require: name => { assert.ok(modules[name],name); return modules[name] },
    localStorage: storage, window: { addEventListener: (name,fn) => { listeners[name]=fn } }, atob,
    setTimeout: fn => timers.push(fn), console }, { filename: 'auth.ts' })
  const auth = exports.useAuthStore(pinia.createPinia())
  return { auth, storage, pending, timers, listeners, switch(id,sid,role,marker) { storage.setItem('token',token(id,sid,role,marker));auth.syncToken() } }
}
const unauthorized = { code:'UNAUTHORIZED', response:{status:401} }

// Reproduces a cold admin route: router waits first, then store initialization
// and a visibility event request the identity before the first response arrives.
{
  const f=fixture(), route=f.auth.fetchCurrentUser();f.timers[0]()
  const visibility=f.auth.checkSession()
  assert.equal(f.pending.length,1,'cold route/timer/visibility must share one identity request')
  f.pending[0].resolve({user:user()})
  assert.equal((await route).id,1);assert.equal(await visibility,true)
  assert.equal(f.auth.isAdmin,true);assert.equal(f.auth.quota.hostLimit,0)
  const again=f.auth.fetchCurrentUser();assert.equal(f.pending.length,2,'completed reads are not cached')
  f.pending[1].resolve({user:user()});await again
}
console.log('PASS cold admin route, initialization timer and visibility share one verified read; later reads remain fresh')
for(const mode of ['account','sid','role','aba','clear-local','clear-memory','storage','storage-event'])for(const failure of [false,true]) {
  const f=fixture(), old=f.auth.fetchCurrentUser()
  if(mode==='account')f.switch(2)
  if(mode==='sid')f.switch(1,'session-2')
  if(mode==='role')f.switch(1,'session-1','user')
  if(mode==='aba'){f.switch(2);f.switch(1)}
  if(mode==='clear-local')f.auth.clearLocalAuth()
  if(mode==='clear-memory')f.auth.clearInMemoryAuth()
  if(mode==='storage')f.storage.setItem('token',token(2))
  if(mode==='storage-event'){f.storage.setItem('token',token(2));f.listeners.storage({key:'token',oldValue:token(),newValue:token(2)})}
  const before=JSON.stringify({user:f.auth.user,stored:f.storage.getItem('token'),token:f.auth.token})
  failure?f.pending[0].reject(unauthorized):f.pending[0].resolve({user:user()})
  assert.equal(await old,null)
  assert.equal(JSON.stringify({user:f.auth.user,stored:f.storage.getItem('token'),token:f.auth.token}),before,`${mode}/${failure}`)
}
console.log('PASS 16 obsolete success/401 responses preserve account, session, role, ABA and storage changes')
{
  const f=fixture(),old=f.auth.fetchCurrentUser();f.switch(2)
  const next=f.auth.fetchCurrentUser();assert.equal(f.pending.length,2,'replacement session cannot share old identity request')
  f.pending[0].reject(unauthorized);await old
  const concurrent=f.auth.fetchCurrentUser();assert.equal(f.pending.length,2,'old cleanup cannot clear replacement in-flight read')
  f.pending[1].resolve({user:user(2)});await next;await concurrent
  assert.equal(f.auth.user.id,2)
}
{
  const f=fixture(),read=f.auth.fetchCurrentUser(),session=f.auth.checkSession()
  f.pending[0].reject(unauthorized);await assert.rejects(read,error=>error.code==='UNAUTHORIZED')
  assert.equal(await session,false);assert.equal(f.auth.token,null)
  f.switch(1);const retry=f.auth.fetchCurrentUser();f.pending[1].resolve({user:user()});await retry
  const failed=f.auth.fetchCurrentUser();f.pending[2].reject(Error('temporary transport failure'));await assert.rejects(failed,/transport/)
  assert.equal(f.auth.isAdmin,true)
  const fresh=f.auth.fetchCurrentUser();f.switch(1,'session-1','admin','refreshed');f.pending[3].resolve({user:user()});await fresh
  assert.equal(f.auth.isAdmin,true,'same-session token refresh preserves verified identity')
}
{
  const f=fixture(),read=f.auth.fetchCurrentUser(),logout=f.auth.logout()
  assert.equal(await f.auth.fetchCurrentUser(),null)
  f.pending[0].resolve({user:user()});await read;assert.equal(f.auth.user,null)
  f.switch(2);f.pending[1].resolve({});await logout;assert.notEqual(f.auth.token,null)
}
console.log('PASS replacement read isolation, shared current 401, retry after transport loss, token refresh and late logout')
