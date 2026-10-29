import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { Browser, sleep } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'
const root=fileURLToPath(new URL('..',import.meta.url)).replaceAll('\\','/'),require=createRequire(new URL('../client/package.json',import.meta.url))
const {createServer}=await import(pathToFileURL(require.resolve('vite')).href),{default:vue}=await import(pathToFileURL(require.resolve('@vitejs/plugin-vue')).href)
const output=resolve(root,'logs/system-settings-scope');mkdirSync(output,{recursive:true});process.env.TASTE_SKILL_TMP=output
const tailwind=require('tailwindcss/loadConfig')(root+'/client/tailwind.config.js');tailwind.content=[root+'/client/src/**/*.{vue,js,ts}',root+'/scripts/fixtures/system-settings/*.js']
const server=await createServer({configFile:false,cacheDir:resolve(output,'vite-cache'),root:root+'/scripts/fixtures/system-settings',publicDir:root+'/client/public',plugins:[vue()],resolve:{alias:[{find:/^@\/api(?:\/admin)?$/,replacement:root+'/scripts/fixtures/system-settings/api.js'},{find:'@',replacement:root+'/client/src'},...['vue','pinia','vue-i18n','vue-router'].map(name=>({find:name,replacement:require.resolve(name==='vue'?'vue/dist/vue.esm-bundler.js':name)}))],dedupe:['vue','pinia','vue-i18n','vue-router']},css:{postcss:{plugins:[require('tailwindcss')(tailwind),require('autoprefixer')()]}},server:{host:'127.0.0.1',port:19724,strictPort:true,fs:{allow:[root]}}})
let browser
try{
  await server.listen();browser=await Browser.launch();const page=await browser.newPage({reducedMotion:true});await page.goto('http://127.0.0.1:19724',{settleMs:1400})
  for(let attempt=0;attempt<200;attempt++){if(await page.eval(()=>!!window.settingsHarness?.view()))break;if(attempt===199)throw Error(page.consoleErrors.join('\n'));await sleep(100)}
  const run=async(fn,arg)=>{const r=await page.eval(fn,arg);await sleep(70);return r},last=kind=>page.eval(kind=>window.settingsHarness.pending.findLastIndex(x=>x.kind===kind),kind)
  const seed=await page.eval(()=>Object.entries(window.settingsHarness.view().form).map(([key,value],id)=>({id:id+1,key,value:typeof value==='object'?JSON.stringify(value):String(value),type:typeof value,label:null,description:null})))
  const resolveList=(index,configs)=>run(({index,configs})=>window.settingsHarness.pending[index].resolve({configs}),{index,configs})
  const count=kind=>page.eval(kind=>window.settingsHarness.pending.filter(x=>x.kind===kind).length,kind)
  const accept=(index,data)=>run(({index,data})=>window.settingsHarness.pending[index].resolve(data),{index,data})
  const reject=index=>run(index=>window.settingsHarness.pending[index].reject({message:'Synthetic failure'}),index)
  const read=key=>page.eval(key=>JSON.parse(JSON.stringify(window.settingsHarness.view()[key])),key)
  const change=value=>run(async value=>{const h=window.settingsHarness;if(value==='session')h.session('b');if(value==='aba'){h.session('b');h.session('a')};if(value==='account')h.auth.user={...h.auth.user,id:2};if(value==='role')h.auth.user={...h.auth.user,role:'user'};if(value==='logout')h.session(null);if(value==='cache'){h.state.active=false;await h.nextTick();h.state.active=true;await h.nextTick()}},value)
  const original=await last('list');await change('session');await resolveList(original,seed.map(c=>c.key==='brand_name'?{...c,value:'Old session brand'}:c))
  assert.notEqual(await read('form').then(f=>f.brand_name),'Old session brand','old admin session cannot fill current settings')
  const fresh=async()=>{await run(()=>{const h=window.settingsHarness;h.auth.user={id:1,username:'fixture',role:'admin'};h.session('a');h.state.active=true;void h.view().loadConfigs()});await resolveList(await last('list'),seed)}
  for(const value of ['session','aba','account','role','logout','cache'])for(const failed of [false,true]){
    await fresh();await run(()=>{const v=window.settingsHarness.view();v.form.smtp_password='synthetic-private-draft';void v.loadConfigs()});const old=await last('list');await change(value)
    assert.equal((await read('form')).smtp_password,'','scope changes clear private drafts synchronously')
    if(!['role','logout'].includes(value))await resolveList(await last('list'),seed.map(c=>c.key==='brand_name'?{...c,value:'Current brand'}:c))
    const state=await read('configs'),notices=await page.eval(()=>window.settingsHarness.toasts.length)
    if(failed)await reject(old);else await resolveList(old,seed.map(c=>c.key==='brand_name'?{...c,value:'Old brand'}:c))
    assert.deepEqual(await read('configs'),state);assert.equal(await page.eval(()=>window.settingsHarness.toasts.length),notices)
  }
  for(const value of ['session','aba','account','role','logout','cache'])for(const failed of [false,true]){
    await fresh();await run(()=>{const v=window.settingsHarness.view();v.form.brand_name='Submitted brand';void v.saveBrand()});const old=await last('update');await change(value)
    const writes=await count('update');await run(()=>{void window.settingsHarness.view().saveBrand()});assert.equal(await count('update'),writes,'old inflight write keeps same group busy')
    if(!['role','logout'].includes(value))await resolveList(await last('list'),seed)
    const reads=await count('list'),notices=await page.eval(()=>window.settingsHarness.toasts.length),publicReads=await page.eval(()=>window.settingsHarness.controls.publicReads)
    if(failed)await reject(old);else await accept(old,{message:'Config updated'})
    assert.equal(await count('list'),reads,'old write cannot schedule a current refresh');assert.equal(await page.eval(()=>window.settingsHarness.toasts.length),notices);assert.equal(await read('savingBrand'),false);assert.equal(await page.eval(()=>window.settingsHarness.controls.publicReads),publicReads,'old write cannot refresh public config')
  }
  await fresh();await run(()=>{const v=window.settingsHarness.view();v.form.brand_name='Current draft';void v.saveBrand()});const sameSid=await last('update');await run(()=>window.settingsHarness.session('a',2));await accept(sameSid,{message:'Config updated'});await resolveList(await last('list'),seed.map(c=>c.key==='brand_name'?{...c,value:'Current draft'}:c));assert.equal((await read('form')).brand_name,'Current draft')
  await fresh();await run(()=>{void window.settingsHarness.view().loadConfigs()});const first=await last('list');await run(()=>{void window.settingsHarness.view().loadConfigs()});const second=await last('list');await resolveList(first,seed);assert.equal(await read('loading'),true,'old finally cannot hide current loader');await resolveList(second,seed);assert.equal(await read('loading'),false)
  await fresh();await run(()=>{const h=window.settingsHarness;h.controls.deferPackages=true;h.view().popupPromoPackagesLoaded=false;void h.view().loadPopupPromoPackages()});const oldPackages=await page.eval(()=>window.settingsHarness.pending.map((x,i)=>x.kind==='packages'?i:-1).filter(i=>i>=0).slice(-2));await change('session')
  await run(()=>{void window.settingsHarness.view().loadPopupPromoPackages()});const newPackages=await page.eval(()=>window.settingsHarness.pending.map((x,i)=>x.kind==='packages'?i:-1).filter(i=>i>=0).slice(-2))
  for(const index of oldPackages)await accept(index,{packages:[{id:1,name:'Old package',active:1}]});assert.deepEqual(await read('popupPromoPackages'),[]);assert.equal(await read('popupPromoPackagesLoading'),true)
  for(const index of newPackages)await accept(index,{packages:[{id:2,name:'Current package',active:1}]});assert.ok((await read('popupPromoPackages')).every(p=>p.id===2));assert.equal(await read('popupPromoPackagesLoading'),false);await run(()=>window.settingsHarness.controls.deferPackages=false)
  for(const kind of ['list','update'])for(const failed of [false,true]){await fresh();const before=await count(kind);await run(kind=>{const v=window.settingsHarness.view();if(kind==='list')void v.loadConfigs();else{v.form.brand_name='Unmounted draft';void v.saveBrand()}},kind);assert.equal(await count(kind),before+1);const old=await last(kind);await run(()=>window.settingsHarness.state.mounted=false);const notices=await page.eval(()=>window.settingsHarness.toasts.length),reads=await count('list');if(failed)await reject(old);else if(kind==='list')await resolveList(old,seed);else await accept(old,{message:'Config updated'});assert.deepEqual(await read('configs'),[]);assert.equal(await count('list'),reads);assert.equal(await page.eval(()=>window.settingsHarness.toasts.length),notices);await run(()=>window.settingsHarness.state.mounted=true)}
  await fresh()
  for(const[locale,width,dark]of[['zh-CN',1440,false],['zh-TW',768,false],['en',390,true]]){await run(({locale,dark})=>{const h=window.settingsHarness;h.setLocale(locale);h.theme.setTheme(dark?'dark':'light')},{locale,dark});await page.setViewport({width,height:1000,mobile:width===390});await sleep(200);assert.equal(await page.eval(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:resolve(output,locale+'-'+width+'.png'),format:'png'})}
  assert.equal(page.consoleErrors.length,0,page.consoleErrors.join('\n'));console.log('PASS actual settings 12 stale reads and 12 stale writes, admin/session/ABA/cache/unmount cleanup, current loader, same sid and retained inflight busy')
}finally{if(browser)await browser.close();await server.close()}
