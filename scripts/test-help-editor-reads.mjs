import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { Browser, sleep } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'
const root=fileURLToPath(new URL('..',import.meta.url)).replaceAll('\\','/'),require=createRequire(new URL('../client/package.json',import.meta.url))
const {createServer}=await import(pathToFileURL(require.resolve('vite')).href),{default:vue}=await import(pathToFileURL(require.resolve('@vitejs/plugin-vue')).href)
const output=resolve(root,'logs/help-editor-reads');mkdirSync(output,{recursive:true});process.env.TASTE_SKILL_TMP=output
const tailwind=require('tailwindcss/loadConfig')(root+'/client/tailwind.config.js');tailwind.content=[root+'/client/src/**/*.{vue,js,ts}',root+'/scripts/fixtures/help-editor/*.js']
const server=await createServer({configFile:false,cacheDir:resolve(output,'vite-cache'),root:root+'/scripts/fixtures/help-editor',publicDir:root+'/client/public',plugins:[vue()],resolve:{alias:[{find:/^@\/api\/admin$/,replacement:root+'/scripts/fixtures/help-editor/api.js'},{find:'@',replacement:root+'/client/src'},...['vue','pinia','vue-i18n','vue-router'].map(name=>({find:name,replacement:require.resolve(name==='vue'?'vue/dist/vue.esm-bundler.js':name)}))],dedupe:['vue','pinia','vue-i18n','vue-router']},css:{postcss:{plugins:[require('tailwindcss')(tailwind),require('autoprefixer')()]}},server:{host:'127.0.0.1',port:19722,strictPort:true,fs:{allow:[root]}}})
let browser
try{
  await server.listen();browser=await Browser.launch();const page=await browser.newPage({reducedMotion:true});await page.goto('http://127.0.0.1:19722',{settleMs:1400})
  for(let attempt=0;attempt<200;attempt++){if(await page.eval(()=>!!window.helpHarness?.view()))break;if(attempt===199)throw Error(page.consoleErrors.join('\n'));await sleep(100)}
  const run=async(fn,arg)=>{const result=await page.eval(fn,arg);await sleep(65);return result},last=()=>page.eval(()=>window.helpHarness.pending.findLastIndex(x=>x.kind==='get'))
  const accept=(index,id)=>run(({index,id})=>window.helpHarness.pending[index].resolve({article:{id,title:'Article '+id,slug:'article-'+id,content:'# Content '+id,category:'general',sort_order:0,published:1,pinned:0}}),{index,id})
  const open=id=>run(id=>{void window.helpHarness.view().openEdit({id})},id)
  const read=key=>page.eval(key=>JSON.parse(JSON.stringify(window.helpHarness.view()[key])),key)
  await open(1);const old=await last();await open(2);await accept(await last(),2);await accept(old,1)
  assert.equal((await read('form')).title,'Article 2','A response cannot populate B editor')
  for(const failed of [false,true])for(const change of ['target','aba','create','close','session','account','role','logout']){
    await run(()=>{const h=window.helpHarness;h.auth.user={id:1,role:'admin',username:'fixture',email:'fixture@example.test'};h.session('a');h.view().showEditor=false});await open(1);const old=await last()
    if(change==='target'||change==='aba'){await open(2);if(change==='aba')await open(1);await accept(await last(),change==='aba'?1:2)}
    if(change==='create')await run(()=>window.helpHarness.view().openCreate());if(change==='close')await run(()=>window.helpHarness.view().showEditor=false)
    if(change==='session')await run(()=>window.helpHarness.session('b'));if(change==='account')await run(()=>window.helpHarness.auth.user={...window.helpHarness.auth.user,id:2})
    if(change==='role')await run(()=>window.helpHarness.auth.user={...window.helpHarness.auth.user,role:'user'});if(change==='logout')await run(()=>window.helpHarness.session(null))
    const before=await page.eval(()=>({form:JSON.parse(JSON.stringify(window.helpHarness.view().form)),show:window.helpHarness.view().showEditor,toasts:window.helpHarness.toasts.length}))
    if(failed)await run(index=>window.helpHarness.pending[index].reject(Error('fixture unavailable')),old);else await accept(old,1)
    assert.deepEqual(await page.eval(()=>({form:JSON.parse(JSON.stringify(window.helpHarness.view().form)),show:window.helpHarness.view().showEditor,toasts:window.helpHarness.toasts.length})),before,change+' old receipt does not overwrite/close/toast')
  }
  await run(()=>{const h=window.helpHarness;h.auth.user={id:1,role:'admin',username:'fixture'};h.session('a')});await open(1);await open(2);const newest=await last(),older=newest-1
  await accept(older,1);assert.equal(await read('formLoading'),true,'old finally cannot release current loading');assert.equal((await read('form')).title,'')
  const before=await page.eval(()=>window.helpHarness.pending.length);await run(()=>{void window.helpHarness.view().saveArticle()});assert.equal(await page.eval(()=>window.helpHarness.pending.length),before,'loading editor cannot save blank/stale content')
  await run(index=>window.helpHarness.pending[index].reject(Error('fixture unavailable')),newest);assert.equal(await read('showEditor'),true);assert.ok(await read('formError'));assert.equal(await read('formLoading'),false)
  await run(()=>document.querySelector('.fixed.inset-0.z-50 .btn-secondary').click());await accept(await last(),2);assert.equal((await read('form')).title,'Article 2');assert.equal(await read('formError'),'');assert.equal(await read('formLoading'),false)
  await open(2);await accept(await last(),1);assert.ok(await read('formError'),'mismatched response ID remains a load error');assert.equal((await read('form')).title,'')
  await open(2);const refresh=await last();await run(()=>window.helpHarness.session('a',2));assert.equal(await read('showEditor'),true);await accept(refresh,2);assert.equal((await read('form')).title,'Article 2','same sid token refresh preserves current editor')
  for(const[locale,width,dark]of[['zh-CN',1440,false],['zh-TW',768,false],['en',390,true]]){
    await run(({locale,dark})=>{const h=window.helpHarness;h.setLocale(locale);h.theme.setTheme(dark?'dark':'light')},{locale,dark});await open(2);await accept(await last(),2);await page.setViewport({width,height:1000,mobile:width===390});await sleep(250)
    assert.equal(await page.eval(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:resolve(output,locale+'-'+width+'.png'),format:'png'})
    assert.equal(await page.eval(()=>{const dialog=document.querySelector('.fixed.inset-0.z-50 > .relative'),bounds=dialog.getBoundingClientRect();return [...dialog.querySelectorAll('input,select,label')].every(el=>{const r=el.getBoundingClientRect();return r.left>=bounds.left&&r.right<=bounds.right})}),true,'editor fields and publish/pin controls fit the dialog')
  }
  await open(1);const pendingUnmount=await last();await run(()=>window.helpHarness.state.mounted=false);const form=await read('form');await accept(pendingUnmount,1);assert.deepEqual(await read('form'),form)
  assert.equal(page.consoleErrors.length,0,page.consoleErrors.join('\n'));console.log('PASS actual help editor target/ABA/create/close/session/account/role/logout/unmount reads, current loading, matching ID, persistent error and retry')
}finally{if(browser)await browser.close();await server.close()}
