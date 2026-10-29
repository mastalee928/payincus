import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { Browser, sleep } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'
const root=fileURLToPath(new URL('..',import.meta.url)).replaceAll('\\','/'),require=createRequire(new URL('../client/package.json',import.meta.url))
const {createServer}=await import(pathToFileURL(require.resolve('vite')).href),{default:vue}=await import(pathToFileURL(require.resolve('@vitejs/plugin-vue')).href)
const output=resolve(root,'logs/password-scope');mkdirSync(output,{recursive:true});process.env.TASTE_SKILL_TMP=output
const tailwind=require('tailwindcss/loadConfig')(root+'/client/tailwind.config.js');tailwind.content=[root+'/client/src/**/*.{vue,js,ts}',root+'/scripts/fixtures/password/*.js']
const server=await createServer({configFile:false,cacheDir:resolve(output,'vite-cache'),root:root+'/scripts/fixtures/password',publicDir:root+'/client/public',plugins:[vue()],resolve:{alias:[{find:/^@\/api$/,replacement:root+'/scripts/fixtures/password/api.js'},{find:'@',replacement:root+'/client/src'},...['vue','pinia','vue-i18n','vue-router'].map(name=>({find:name,replacement:require.resolve(name==='vue'?'vue/dist/vue.esm-bundler.js':name)}))],dedupe:['vue','pinia','vue-i18n','vue-router']},css:{postcss:{plugins:[require('tailwindcss')(tailwind),require('autoprefixer')()]}},server:{host:'127.0.0.1',port:19723,strictPort:true,fs:{allow:[root]}}})
let browser
try{
  await server.listen();browser=await Browser.launch();const page=await browser.newPage({reducedMotion:true});await page.goto('http://127.0.0.1:19723',{settleMs:1400})
  for(let attempt=0;attempt<200;attempt++){if(await page.eval(()=>!!window.passwordHarness?.view()))break;if(attempt===199)throw Error(page.consoleErrors.join('\n'));await sleep(100)}
  const run=async(fn,arg)=>{const result=await page.eval(fn,arg);await sleep(70);return result},last=()=>page.eval(()=>window.passwordHarness.pending.findLastIndex(x=>x.kind==='update'))
  const read=key=>page.eval(key=>JSON.parse(JSON.stringify(window.passwordHarness.view()[key])),key)
  const start=()=>run(()=>{void window.passwordHarness.view().updatePassword()})
  const prepare=()=>run(()=>{const h=window.passwordHarness,v=h.view();h.auth.user={id:1,username:'fixture',role:'user',email:'fixture@example.test'};h.session('a');v.passwordForm={currentPassword:'fixture-current',newPassword:'Fixture-new1',confirmPassword:'Fixture-new1'}})
  const reject=(index,code='VERIFICATION_REQUIRED')=>run(({index,code})=>window.passwordHarness.pending[index].reject({code,message:'fixture unavailable'}),{index,code})
  await prepare();await start();const old=await last();await run(()=>window.passwordHarness.view().passwordForm.newPassword='replacement-password');await reject(old)
  assert.equal(await read('pendingPassword'),'','old verification-required response cannot capture replacement password draft')
  assert.equal(await read('showVerificationModal'),false)
  await prepare();await start();const busy=await last(),requests=await page.eval(()=>window.passwordHarness.pending.length);await start();assert.equal(await page.eval(()=>window.passwordHarness.pending.length),requests,'immediate password write busy prevents duplicate')
  assert.equal(await page.eval(()=>[...document.querySelectorAll('#app input')].every(el=>el.matches(':disabled'))),true)
  await reject(busy,'INVALID_CREDENTIALS');assert.ok(await read('passwordError'));assert.equal(await read('passwordLoading'),false)
  await start();await reject(await last());assert.equal(await read('showVerificationModal'),true);assert.equal(await read('pendingPassword'),'Fixture-new1');assert.equal(await read('pendingCurrentPassword'),'fixture-current')
  const blocked=await page.eval(()=>window.passwordHarness.pending.length);await start();assert.equal(await page.eval(()=>window.passwordHarness.pending.length),blocked,'open verification blocks additional password submit')
  await run(()=>{void window.passwordHarness.view().onVerificationSuccess();void window.passwordHarness.view().onVerificationSuccess()});assert.equal(await page.eval(()=>window.passwordHarness.pending.length),blocked+1,'verification callback submits exactly once')
  assert.deepEqual(await page.eval(index=>window.passwordHarness.pending[index].data,await last()),{id:1,password:'Fixture-new1',currentPassword:'fixture-current'})
  await reject(await last(),'INVALID_CREDENTIALS');assert.ok(await read('passwordError'));assert.equal(await read('pendingPassword'),'');assert.equal(await read('passwordLoading'),false)
  for(const stage of ['initial','verified'])for(const change of ['session','session-aba','account','role','logout','draft','draft-aba','cache'])for(const failed of [false,true]){
    await prepare();await start();if(stage==='verified'){await reject(await last());await run(()=>{void window.passwordHarness.view().onVerificationSuccess()})}const old=await last()
    await run(async change=>{const h=window.passwordHarness,v=h.view();if(change==='session')h.session('b');if(change==='session-aba'){h.session('b');h.session('a')};if(change==='account')h.auth.user={...h.auth.user,id:2};if(change==='role')h.auth.user={...h.auth.user,role:'admin'};if(change==='logout')h.session(null);if(change==='draft')v.passwordForm.newPassword='replacement-password';if(change==='draft-aba'){v.passwordForm.newPassword='replacement-password';v.passwordForm.newPassword='Fixture-new1'};if(change==='cache'){h.state.active=false;await new Promise(r=>setTimeout(r,0));h.state.active=true}},change)
    const before=await page.eval(()=>({form:JSON.parse(JSON.stringify(window.passwordHarness.view().passwordForm)),error:window.passwordHarness.view().passwordError,success:window.passwordHarness.view().passwordSuccess,modal:window.passwordHarness.view().showVerificationModal})),requests=await page.eval(()=>window.passwordHarness.pending.length);await start();assert.equal(await page.eval(()=>window.passwordHarness.pending.length),requests,'old password request retains busy')
    if(failed)await reject(old);else await run(index=>window.passwordHarness.pending[index].resolve({message:'User info updated',reauthRequired:true}),old)
    assert.deepEqual(await page.eval(()=>({form:JSON.parse(JSON.stringify(window.passwordHarness.view().passwordForm)),error:window.passwordHarness.view().passwordError,success:window.passwordHarness.view().passwordSuccess,modal:window.passwordHarness.view().showVerificationModal})),before,stage+'/'+change+' stale write stays silent');assert.equal(await read('passwordLoading'),false);assert.equal(await read('pendingPassword'),'')
  }
  for(const change of ['session','account','draft','cancel']){
    await prepare();await start();await reject(await last());const before=await page.eval(()=>window.passwordHarness.pending.length)
    await run(change=>{const h=window.passwordHarness,v=h.view();if(change==='session')h.session('b');if(change==='account')h.auth.user={...h.auth.user,id:2};if(change==='draft')v.passwordForm.newPassword='replacement-password';if(change==='cancel')v.closeVerification()},change)
    await run(()=>{void window.passwordHarness.view().onVerificationSuccess()});assert.equal(await page.eval(()=>window.passwordHarness.pending.length),before,'old verification callback cannot submit '+change);assert.equal(await read('pendingPassword'),'')
  }
  await prepare();await start();await run(index=>window.passwordHarness.pending[index].resolve({message:'User info updated',reauthRequired:false}),await last());assert.equal(await read('passwordSuccess'),false,'self password changes require actual reauthentication confirmation')
  await prepare();await start();await run(index=>window.passwordHarness.pending[index].resolve({message:'User info updated',reauthRequired:true}),await last());assert.equal(await read('reauthPending'),true)
  const beforeReauth=await page.eval(()=>window.passwordHarness.pending.length);await start();assert.equal(await page.eval(()=>window.passwordHarness.pending.length),beforeReauth,'confirmed password reauthentication blocks another write')
  await run(()=>window.passwordHarness.session('b'));await sleep(1200);assert.equal(await page.eval(()=>window.passwordHarness.auth.user.id),1);assert.ok(await page.eval(()=>window.passwordHarness.auth.token));assert.equal(await page.eval(()=>location.pathname),'/','old reauth timer cannot log out or redirect replacement session')
  const clears=await page.eval(()=>Number(sessionStorage.getItem('fixture-password-clear-count')||0));await prepare();await start();await run(index=>window.passwordHarness.pending[index].resolve({message:'User info updated',reauthRequired:true}),await last());await run(()=>window.passwordHarness.session('a',2));assert.equal(await read('reauthPending'),true,'same sid refresh preserves required reauthentication')
  await sleep(1200);assert.equal(await page.eval(()=>location.pathname),'/login');assert.equal(await page.eval(()=>Number(sessionStorage.getItem('fixture-password-clear-count')||0)),clears+1,'current session actually clears auth and redirects');await page.goto('http://127.0.0.1:19723',{settleMs:900});for(let attempt=0;attempt<100;attempt++){if(await page.eval(()=>!!window.passwordHarness?.view()))break;await sleep(100)}
  for(const[locale,width,dark]of[['zh-CN',1440,false],['zh-TW',768,false],['en',390,true]]){
    await run(({locale,dark})=>{const h=window.passwordHarness;h.setLocale(locale);h.theme.setTheme(dark?'dark':'light')},{locale,dark});await prepare();await start();await reject(await last(),'INVALID_CREDENTIALS');await page.setViewport({width,height:1000,mobile:width===390});await sleep(200);assert.equal(await page.eval(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:resolve(output,locale+'-'+width+'.png'),format:'png'})
  }
  await prepare();await start();const unmount=await last();await run(()=>window.passwordHarness.state.mounted=false);const form=await read('passwordForm');await reject(unmount);assert.deepEqual(await read('passwordForm'),form);assert.equal(await read('pendingPassword'),'')
  assert.equal(page.consoleErrors.length,0,page.consoleErrors.join('\n'));console.log('PASS actual password fixed initial/verified drafts, immediate busy/fields, 32 old session/account/role/logout/draft/ABA/cache receipts, cancelled grants and unmount')
}finally{if(browser)await browser.close();await server.close()}
