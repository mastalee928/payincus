import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { Browser, sleep } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'
const root=fileURLToPath(new URL('..',import.meta.url)).replaceAll('\\','/'),require=createRequire(new URL('../client/package.json',import.meta.url))
const {createServer}=await import(pathToFileURL(require.resolve('vite')).href),{default:vue}=await import(pathToFileURL(require.resolve('@vitejs/plugin-vue')).href)
const output=resolve(root,'logs/password-receipts');mkdirSync(output,{recursive:true});process.env.TASTE_SKILL_TMP=output
const tailwind=require('tailwindcss/loadConfig')(root+'/client/tailwind.config.js');tailwind.content=[root+'/client/src/**/*.{vue,js,ts}',root+'/scripts/fixtures/password/*.js']
const server=await createServer({configFile:false,cacheDir:resolve(output,'vite-cache'),root:root+'/scripts/fixtures/password',publicDir:root+'/client/public',plugins:[vue()],resolve:{alias:[{find:/^@\/api$/,replacement:root+'/scripts/fixtures/password/api.js'},{find:'@',replacement:root+'/client/src'},...['vue','pinia','vue-i18n','vue-router'].map(name=>({find:name,replacement:require.resolve(name==='vue'?'vue/dist/vue.esm-bundler.js':name)}))],dedupe:['vue','pinia','vue-i18n','vue-router']},css:{postcss:{plugins:[require('tailwindcss')(tailwind),require('autoprefixer')()]}},server:{host:'127.0.0.1',port:19723,strictPort:true,fs:{allow:[root]}}})
let browser
try{
  await server.listen();browser=await Browser.launch();const page=await browser.newPage({reducedMotion:true});await page.goto('http://127.0.0.1:19723',{settleMs:1400})
  for(let attempt=0;attempt<200;attempt++){if(await page.eval(()=>!!window.passwordHarness?.view()))break;if(attempt===199)throw Error(page.consoleErrors.join('\n'));await sleep(100)}
  const run=async(fn,arg)=>{const result=await page.eval(fn,arg);await sleep(70);return result},last=kind=>page.eval(kind=>window.passwordHarness.pending.findLastIndex(x=>x.kind===kind),kind)
  const read=key=>page.eval(key=>JSON.parse(JSON.stringify(window.passwordHarness.view()[key])),key)
  const prepare=()=>run(()=>{const h=window.passwordHarness,v=h.view();h.auth.user={id:1,username:'fixture',role:'user',email:'fixture@example.test'};h.session('a');v.passwordForm={currentPassword:'fixture-current',newPassword:'fixture-new',confirmPassword:'fixture-new'}})
  const start=()=>run(()=>{void window.passwordHarness.view().updatePassword()}),accept=(kind,response)=>run(({kind,response})=>window.passwordHarness.pending.findLast(x=>x.kind===kind).resolve(response),{kind,response})
  await prepare();await start();await accept('update',{});assert.equal(await read('passwordSuccess'),false,'missing password confirmation never claims success');assert.ok(await read('passwordError'))
  for(const verified of [false,true])for(const response of [null,{}, {message:' '}, {message:'fixture'}, {message:'User info updated',reauthRequired:false}, {message:'User info updated',reauthRequired:'true'}]){
    await prepare();await start();if(verified){await run(index=>window.passwordHarness.pending[index].reject({code:'VERIFICATION_REQUIRED'}),await last('update'));await run(()=>{void window.passwordHarness.view().onVerificationSuccess()})}
    await accept('update',response);assert.equal(await read('passwordSuccess'),false);assert.equal(await read('reauthPending'),false);assert.ok(await read('passwordError'));assert.equal((await read('passwordForm')).newPassword,'fixture-new');assert.equal(await read('passwordLoading'),false);assert.equal(await read('pendingPassword'),'')
  }
  // Exercise the actual verification modal and its emitted verified callback, not a synthetic parent callback.
  await prepare();await start();await run(index=>window.passwordHarness.pending[index].reject({code:'VERIFICATION_REQUIRED'}),await last('update'));assert.equal(await read('showVerificationModal'),true)
  await run(()=>{void window.passwordHarness.verification().requestCode()});await accept('request',{success:true,required:true,channel:'email',maskedTarget:'fi***@example.test',expiresIn:600})
  assert.equal(await page.eval(()=>window.passwordHarness.verification().step),'verify')
  await run(()=>{const v=window.passwordHarness.verification();v.verificationCode='012345';void v.verify()});await accept('verify',{success:true,verified:true,message:'Verification successful'})
  const retry=await last('update');assert.deepEqual(await page.eval(index=>window.passwordHarness.pending[index].data,retry),{id:1,password:'fixture-new',currentPassword:'fixture-current'});assert.equal(await read('showVerificationModal'),false)
  await accept('update',{message:'User info updated',reauthRequired:true});assert.equal(await read('passwordSuccess'),true);assert.equal(await read('reauthPending'),true);assert.equal((await read('passwordForm')).newPassword,'');assert.equal(await read('pendingPassword'),'')
  await sleep(1200);assert.equal(await page.eval(()=>location.pathname),'/login');assert.ok(await page.eval(()=>Number(sessionStorage.getItem('fixture-password-clear-count')||0))>=1)
  await page.goto('http://127.0.0.1:19723',{settleMs:900});for(let attempt=0;attempt<100;attempt++){if(await page.eval(()=>!!window.passwordHarness?.view()))break;await sleep(100)}
  // An in-flight child verification becomes invalid when the parent password draft changes.
  await prepare();await start();await run(index=>window.passwordHarness.pending[index].reject({code:'VERIFICATION_REQUIRED'}),await last('update'));await run(()=>{void window.passwordHarness.verification().requestCode()});await accept('request',{success:true,required:true,channel:'email',maskedTarget:'fi***@example.test',expiresIn:600})
  await run(()=>{const v=window.passwordHarness.verification();v.verificationCode='012345';void v.verify()});const oldVerify=await last('verify'),count=await page.eval(()=>window.passwordHarness.pending.filter(x=>x.kind==='update').length)
  await run(()=>window.passwordHarness.view().passwordForm.newPassword='replacement-password');await run(index=>window.passwordHarness.pending[index].resolve({success:true,verified:true,message:'Verification successful'}),oldVerify)
  assert.equal(await page.eval(()=>window.passwordHarness.pending.filter(x=>x.kind==='update').length),count);assert.equal(await read('pendingPassword'),'');assert.equal(await read('showVerificationModal'),false)
  for(const[locale,width,dark]of[['zh-CN',1440,false],['zh-TW',768,false],['en',390,true]]){
    await run(({locale,dark})=>{const h=window.passwordHarness;h.setLocale(locale);h.theme.setTheme(dark?'dark':'light')},{locale,dark});await prepare();await start();await accept('update',{});await page.setViewport({width,height:1000,mobile:width===390});await sleep(200);assert.equal(await page.eval(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:resolve(output,locale+'-'+width+'.png'),format:'png'})
  }
  assert.equal(page.consoleErrors.length,0,page.consoleErrors.join('\n'));console.log('PASS actual password initial/verified confirmed receipts, invalid receipt retries, real verification modal request/verify/parent retry and same-session logout, old child draft receipt isolation')
}finally{if(browser)await browser.close();await server.close()}
