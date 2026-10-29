import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { Browser, sleep } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'
const root=fileURLToPath(new URL('..',import.meta.url)).replaceAll('\\','/'),require=createRequire(new URL('../client/package.json',import.meta.url))
const {createServer}=await import(pathToFileURL(require.resolve('vite')).href),{default:vue}=await import(pathToFileURL(require.resolve('@vitejs/plugin-vue')).href)
const output=resolve(root,'logs/help-editor-writes');mkdirSync(output,{recursive:true});process.env.TASTE_SKILL_TMP=output
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
  const start=()=>run(()=>{void window.helpHarness.view().saveArticle()}),lastWrite=()=>page.eval(()=>window.helpHarness.pending.findLastIndex(x=>['create','update'].includes(x.kind)))
  const prepare=async mode=>{await run(()=>{const h=window.helpHarness;h.auth.user={id:1,role:'admin',username:'fixture'};h.session('a');h.view().showEditor=false});if(mode==='create')await run(()=>window.helpHarness.view().openCreate());else{await open(2);await accept(await last(),2)}await run(()=>{const v=window.helpHarness.view();v.form={title:'Fixed title',slug:'fixed-title',content:'# Fixed content',category:'general',sortOrder:0,published:true,pinned:false}})}
  const receipt=mode=>mode==='create'?{message:'Article created',article:{id:3,title:'Fixed title',slug:'fixed-title'}}:{message:'Article updated'}
  await prepare('edit');await start();const old=await lastWrite();await run(()=>{const h=window.helpHarness;h.session('b');h.view().openCreate();h.view().form.title='Replacement draft'})
  const before=await page.eval(()=>({show:window.helpHarness.view().showEditor,title:window.helpHarness.view().form.title,toasts:window.helpHarness.toasts.length}));await run(({old,response})=>window.helpHarness.pending[old].resolve(response),{old,response:receipt('edit')})
  assert.deepEqual(await page.eval(()=>({show:window.helpHarness.view().showEditor,title:window.helpHarness.view().form.title,toasts:window.helpHarness.toasts.length})),before,'old article save cannot close replacement editor or claim success')
  for(const mode of ['edit','create']){
    await prepare(mode);await start();const pending=await lastWrite(),requests=await page.eval(()=>window.helpHarness.pending.length)
    await run(()=>{const v=window.helpHarness.view();void v.saveArticle();v.openCreate();void v.openEdit({id:1});document.querySelector('.fixed.inset-0.z-50 .btn-secondary').click()})
    assert.equal(await page.eval(()=>window.helpHarness.pending.length),requests,'write busy blocks duplicate and replacement');assert.equal(await read('showEditor'),true)
    assert.equal(await page.eval(()=>[...document.querySelectorAll('.fixed.inset-0.z-50 input,.fixed.inset-0.z-50 textarea,.fixed.inset-0.z-50 select')].every(el=>el.matches(':disabled'))),true)
    await run(index=>window.helpHarness.pending[index].reject(Error('fixture unavailable')),pending);assert.ok(await read('formError'));assert.equal(await read('formSaving'),false);assert.equal((await read('form')).title,'Fixed title')
    await start();await run(({index,response})=>window.helpHarness.pending[index].resolve(response),{index:await lastWrite(),response:receipt(mode)});assert.equal(await read('showEditor'),false)
  }
  for(const mode of ['edit','create'])for(const change of ['session','session-aba','account','role','logout','close','draft','draft-aba'])for(const failed of [false,true]){
    await prepare(mode);await start();const old=await lastWrite();await run(change=>{const h=window.helpHarness,v=h.view();if(change==='session')h.session('b');if(change==='session-aba'){h.session('b');h.session('a')};if(change==='account')h.auth.user={...h.auth.user,id:2};if(change==='role')h.auth.user={...h.auth.user,role:'user'};if(change==='logout')h.session(null);if(change==='close')v.showEditor=false;if(change==='draft')v.form.content='# Replacement';if(change==='draft-aba'){v.form.content='# Replacement';v.form.content='# Fixed content'}},change)
    const before=await page.eval(()=>({show:window.helpHarness.view().showEditor,form:JSON.parse(JSON.stringify(window.helpHarness.view().form)),toasts:window.helpHarness.toasts.length,error:window.helpHarness.view().formError})),requests=await page.eval(()=>window.helpHarness.pending.length)
    await start();assert.equal(await page.eval(()=>window.helpHarness.pending.length),requests,'old pending write busy retained')
    if(failed)await run(index=>window.helpHarness.pending[index].reject(Error('fixture unavailable')),old);else await run(({index,response})=>window.helpHarness.pending[index].resolve(response),{index:old,response:receipt(mode)})
    assert.deepEqual(await page.eval(()=>({show:window.helpHarness.view().showEditor,form:JSON.parse(JSON.stringify(window.helpHarness.view().form)),toasts:window.helpHarness.toasts.length,error:window.helpHarness.view().formError})),before,mode+'/'+change+' old write stays silent');assert.equal(await read('formSaving'),false)
  }
  for(const mode of ['edit','create']){
    for(const response of [null,{}, {message:' '},...(mode==='create'?[{message:'Article created',article:{id:0,title:'Fixed title',slug:'fixed-title'}},{message:'Article created',article:{id:3,title:'Other title',slug:'other-slug'}}]:[])]){
      await prepare(mode);const toasts=await page.eval(()=>window.helpHarness.toasts.length);await start();await run(({index,response})=>window.helpHarness.pending[index].resolve(response),{index:await lastWrite(),response});assert.equal(await read('showEditor'),true);assert.ok(await read('formError'));assert.equal(await page.eval(()=>window.helpHarness.toasts.length),toasts);assert.equal((await read('form')).title,'Fixed title')
    }
    await start();const index=await lastWrite();await run(()=>window.helpHarness.session('a',3));await run(({index,response})=>window.helpHarness.pending[index].resolve(response),{index,response:receipt(mode)});assert.equal(await read('showEditor'),false,'same sid legitimate success remains accepted')
  }
  for(const[locale,width,dark]of[['zh-CN',1440,false],['zh-TW',768,false],['en',390,true]]){
    await run(({locale,dark})=>{const h=window.helpHarness;h.setLocale(locale);h.theme.setTheme(dark?'dark':'light')},{locale,dark});await prepare('edit');await start();await page.setViewport({width,height:1000,mobile:width===390});await sleep(250)
    assert.equal(await page.eval(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:resolve(output,locale+'-'+width+'-busy.png'),format:'png'})
    await run(index=>window.helpHarness.pending[index].reject(Error('fixture unavailable')),await lastWrite());await run(()=>document.querySelector('.fixed.inset-0.z-50 fieldset').scrollTop=10000);await sleep(150);await page.screenshot({path:resolve(output,locale+'-'+width+'-error.png'),format:'png'})
  }
  await prepare('edit');await start();const unmount=await lastWrite();await run(()=>window.helpHarness.state.mounted=false);const toasts=await page.eval(()=>window.helpHarness.toasts.length);await run(({index,response})=>window.helpHarness.pending[index].resolve(response),{index:unmount,response:receipt('edit')});assert.equal(await page.eval(()=>window.helpHarness.toasts.length),toasts)
  assert.equal(page.consoleErrors.length,0,page.consoleErrors.join('\n'));console.log('PASS actual help create/update fixed targets/drafts/session/ABA receipts, immediate write busy/fields/close, real response contracts, failure retry, same sid and unmount')
}finally{if(browser)await browser.close();await server.close()}
