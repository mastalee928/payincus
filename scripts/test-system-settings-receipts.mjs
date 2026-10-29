import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { Browser, sleep } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'
const root=fileURLToPath(new URL('..',import.meta.url)).replaceAll('\\','/'),require=createRequire(new URL('../client/package.json',import.meta.url))
const {createServer}=await import(pathToFileURL(require.resolve('vite')).href),{default:vue}=await import(pathToFileURL(require.resolve('@vitejs/plugin-vue')).href)
const output=resolve(root,'logs/system-settings-receipts');mkdirSync(output,{recursive:true});process.env.TASTE_SKILL_TMP=output
const tailwind=require('tailwindcss/loadConfig')(root+'/client/tailwind.config.js');tailwind.content=[root+'/client/src/**/*.{vue,js,ts}',root+'/scripts/fixtures/system-settings/*.js']
const server=await createServer({configFile:false,cacheDir:resolve(output,'vite-cache'),root:root+'/scripts/fixtures/system-settings',publicDir:root+'/client/public',plugins:[vue()],resolve:{alias:[{find:/^@\/api(?:\/admin)?$/,replacement:root+'/scripts/fixtures/system-settings/api.js'},{find:'@',replacement:root+'/client/src'},...['vue','pinia','vue-i18n','vue-router'].map(name=>({find:name,replacement:require.resolve(name==='vue'?'vue/dist/vue.esm-bundler.js':name)}))],dedupe:['vue','pinia','vue-i18n','vue-router']},css:{postcss:{plugins:[require('tailwindcss')(tailwind),require('autoprefixer')()]}},server:{host:'127.0.0.1',port:19724,strictPort:true,fs:{allow:[root]}}})
let browser
try{
  await server.listen();browser=await Browser.launch();const page=await browser.newPage({reducedMotion:true});await page.goto('http://127.0.0.1:19724',{settleMs:1400})
  for(let attempt=0;attempt<200;attempt++){if(await page.eval(()=>!!window.settingsHarness?.view()))break;if(attempt===199)throw Error(page.consoleErrors.join('\n'));await sleep(100)}
  const run=async(fn,arg)=>{const r=await page.eval(fn,arg);await sleep(70);return r},last=kind=>page.eval(kind=>window.settingsHarness.pending.findLastIndex(x=>x.kind===kind),kind)
  const seed=await page.eval(()=>Object.entries(window.settingsHarness.view().form).map(([key,value],id)=>({id:id+1,key,value:typeof value==='object'?JSON.stringify(value):String(value),type:typeof value,label:null,description:null})))
  const resolveList=(index,configs)=>run(({index,configs})=>window.settingsHarness.pending[index].resolve({configs}),{index,configs})
  const read=key=>page.eval(key=>JSON.parse(JSON.stringify(window.settingsHarness.view()[key])),key)
  const accept=(index,data)=>run(({index,data})=>window.settingsHarness.pending[index].resolve(data),{index,data})
  const reject=index=>run(index=>window.settingsHarness.pending[index].reject({message:'Synthetic settings failure'}),index)
  const count=kind=>page.eval(kind=>window.settingsHarness.pending.filter(x=>x.kind===kind).length,kind)
  await reject(await last('list'));const before=await count('update');await run(()=>{const v=window.settingsHarness.view();v.form.brand_name='Initial failure draft';void v.saveBrand()})
  assert.equal(await count('update'),before,'failed initial settings load must never save defaults')
  assert.equal(await read('configsReady'),false);assert.ok(await read('configLoadError'))
  await run(()=>{document.querySelector('[data-settings-load-retry]').click()});await resolveList(await last('list'),seed)
  assert.equal(await read('configsReady'),true);assert.equal(await read('configLoadError'),'')
  const baseline=await read('configs')
  const invalidLists=[null,{}, {configs:null},{configs:[]},{configs:[null]},{configs:[{...seed[0],value:null}]},{configs:[...seed,{...seed[0]}]},{configs:seed.map(c=>c.key==='registration_enabled'?{...c,value:'yes'}:c)},{configs:seed.map(c=>c.key==='smtp_port'?{...c,value:'587junk'}:c)},{configs:seed.map(c=>c.key==='aff_commission_rate'?{...c,value:'NaN'}:c)},{configs:seed.map(c=>c.key==='vip_benefits_config'?{...c,value:'{}'}:c)},{configs:seed.map(c=>c.key==='invite_generation_costs'?{...c,value:'{}'}:c)}]
  for(const data of invalidLists){await run(()=>{void window.settingsHarness.view().loadConfigs()});await accept(await last('list'),data);assert.equal(await read('configsReady'),false);assert.ok(await read('configLoadError'));assert.deepEqual(await read('configs'),baseline);const writes=await count('update');await run(()=>{void window.settingsHarness.view().saveRegistration()});assert.equal(await count('update'),writes)}
  await run(()=>{void window.settingsHarness.view().loadConfigs()});await resolveList(await last('list'),seed);assert.equal(await read('configsReady'),true)
  await run(()=>{void window.settingsHarness.view().loadConfigs()});await resolveList(await last('list'),seed.filter(c=>c.key!=='brand_subtitle'));const missingWrites=await count('update');await run(()=>{void window.settingsHarness.view().saveBrand()});assert.equal(await count('update'),missingWrites,'missing group keys cannot save defaults')
  await run(()=>{void window.settingsHarness.view().loadConfigs()});await resolveList(await last('list'),seed)
  for(const data of [null,{}, {message:''},{message:' '},{message:1}]){
    await run(()=>{const v=window.settingsHarness.view();v.form.brand_name='Receipt draft';void v.saveBrand()});const notices=await page.eval(()=>window.settingsHarness.toasts.length),reads=await count('list'),publicReads=await page.eval(()=>window.settingsHarness.controls.publicReads)
    await accept(await last('update'),data);assert.equal(await count('list'),reads);assert.equal(await page.eval(()=>window.settingsHarness.controls.publicReads),publicReads);assert.equal((await read('form')).brand_name,'Receipt draft');assert.ok((await read('configSaveErrors')).brand_name);assert.equal(await read('savingBrand'),false);assert.equal(await page.eval(()=>window.settingsHarness.toasts.length),notices,'invalid receipt must not show success toast')
  }
  await run(()=>{void window.settingsHarness.view().saveBrand()});await accept(await last('update'),{message:'Config updated'});await resolveList(await last('list'),seed.map(c=>c.key==='brand_name'?{...c,value:'Receipt draft'}:c));assert.equal((await read('configSaveErrors')).brand_name,undefined);assert.equal(await read('hasBrandChanges'),false)
  await run(()=>{const v=window.settingsHarness.view();v.form.registration_enabled=false;void v.saveRegistration()});await reject(await last('update'));assert.ok((await read('configSaveErrors')).registration_enabled);assert.equal((await read('form')).registration_enabled,false)
  await run(()=>{void window.settingsHarness.view().saveRegistration()});await accept(await last('update'),{message:'Config updated'});await resolveList(await last('list'),seed.map(c=>c.key==='registration_enabled'?{...c,value:'false'}:c));assert.equal((await read('configSaveErrors')).registration_enabled,undefined)
  for(const[locale,width,dark]of[['zh-CN',1440,false],['zh-TW',768,false],['en',390,true]]){await run(({locale,dark})=>{const h=window.settingsHarness;h.setLocale(locale);h.theme.setTheme(dark?'dark':'light');h.view().form.brand_name='Error draft';void h.view().saveBrand()},{locale,dark});await reject(await last('update'));await page.setViewport({width,height:1000,mobile:width===390});await sleep(200);assert.equal(await page.eval(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:resolve(output,locale+'-'+width+'.png'),format:'png'})}
  assert.equal(page.consoleErrors.length,0,page.consoleErrors.join('\n'));console.log('PASS actual settings failed/invalid initial reads gate writes and retry, 12 malformed lists preserve baseline, five invalid write receipts preserve drafts, valid retry and persistent errors')
}finally{if(browser)await browser.close();await server.close()}
