import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { Browser, sleep } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'
const root=fileURLToPath(new URL('..',import.meta.url)).replaceAll('\\','/'),require=createRequire(new URL('../client/package.json',import.meta.url))
const {createServer}=await import(pathToFileURL(require.resolve('vite')).href),{default:vue}=await import(pathToFileURL(require.resolve('@vitejs/plugin-vue')).href)
const output=resolve(root,'logs/system-settings-drafts');mkdirSync(output,{recursive:true});process.env.TASTE_SKILL_TMP=output
const tailwind=require('tailwindcss/loadConfig')(root+'/client/tailwind.config.js');tailwind.content=[root+'/client/src/**/*.{vue,js,ts}',root+'/scripts/fixtures/system-settings/*.js']
const server=await createServer({configFile:false,cacheDir:resolve(output,'vite-cache'),root:root+'/scripts/fixtures/system-settings',publicDir:root+'/client/public',plugins:[vue()],resolve:{alias:[{find:/^@\/api(?:\/admin)?$/,replacement:root+'/scripts/fixtures/system-settings/api.js'},{find:'@',replacement:root+'/client/src'},...['vue','pinia','vue-i18n','vue-router'].map(name=>({find:name,replacement:require.resolve(name==='vue'?'vue/dist/vue.esm-bundler.js':name)}))],dedupe:['vue','pinia','vue-i18n','vue-router']},css:{postcss:{plugins:[require('tailwindcss')(tailwind),require('autoprefixer')()]}},server:{host:'127.0.0.1',port:19724,strictPort:true,fs:{allow:[root]}}})
let browser
try{
  await server.listen();browser=await Browser.launch();const page=await browser.newPage({reducedMotion:true});await page.goto('http://127.0.0.1:19724',{settleMs:1400})
  for(let attempt=0;attempt<200;attempt++){if(await page.eval(()=>!!window.settingsHarness?.view()))break;if(attempt===199)throw Error(page.consoleErrors.join('\n'));await sleep(100)}
  const run=async(fn,arg)=>{const r=await page.eval(fn,arg);await sleep(70);return r},last=kind=>page.eval(kind=>window.settingsHarness.pending.findLastIndex(x=>x.kind===kind),kind)
  const seed=await page.eval(()=>Object.entries(window.settingsHarness.view().form).map(([key,value],id)=>({id:id+1,key,value:typeof value==='object'?JSON.stringify(value):String(value),type:typeof value,label:null,description:null})))
  const resolveList=(index,configs)=>run(({index,configs})=>window.settingsHarness.pending[index].resolve({configs}),{index,configs})
  await resolveList(await last('list'),seed)
  await run(()=>{const v=window.settingsHarness.view();v.form.registration_enabled=false;v.form.brand_name='Unsaved brand';void v.saveRegistration()});await run(index=>window.settingsHarness.pending[index].resolve({message:'Configs updated'}),await last('update'))
  await resolveList(await last('list'),seed.map(c=>c.key==='registration_enabled'?{...c,value:'false'}:c))
  assert.equal(await page.eval(()=>window.settingsHarness.view().form.brand_name),'Unsaved brand','saving registration must preserve other groups drafts')
  const groups=[['saveRegistration','registration_enabled'],['saveInvitePricing','invite_default_expire_days'],['saveAffRates','aff_commission_rate'],['saveVipBenefits','vip_benefits_config'],['savePopupAnnouncement','popup_announcement'],['savePopupPromo','popup_promo_image_url'],['saveTransfer','transfer_fee'],['saveHostingFeature','hosting_notice'],['saveFooterLinks','footer_contact_email'],['saveBrand','brand_name'],['saveTicket','ticket_auto_close_hours'],['saveFreeSite','free_site_register_gift_points'],['saveTicketImages','ticket_image_lsky_target_id'],['savePlatformPermissions','system_update_allowed_admin_ids'],['saveQuota','default_quota_host'],['saveTurnstile','turnstile_site_key'],['saveAvatar','avatar_api_base'],['saveSmtp','smtp_host'],['saveEmailDomain','email_allowed_domains']]
  for(const[method,key]of groups){
    await run(({method,key})=>{const v=window.settingsHarness.view();v.form.brand_subtitle='Other unsaved draft';void v[method]()},{method,key});const write=await last('update'),payload=await page.eval(index=>window.settingsHarness.pending[index].data.configs,write)
    await run(key=>{const v=window.settingsHarness.view(),value=v.form[key];if(typeof value==='boolean')v.form[key]=!value;else if(typeof value==='number')v.form[key]=value+1;else if(typeof value==='object')value.levels['1'].orderDiscountPercent=8;else v.form[key]='Later draft'},key)
    const later=await page.eval(key=>JSON.parse(JSON.stringify(window.settingsHarness.view().form[key])),key)
    await run(index=>window.settingsHarness.pending[index].resolve({message:'Configs updated'}),write);await resolveList(await last('list'),seed.map(c=>{const p=payload.find(p=>p.key===c.key);return p?{...c,value:p.value}:c}))
    assert.deepEqual(await page.eval(key=>JSON.parse(JSON.stringify(window.settingsHarness.view().form[key])),key),later,method+' preserves edit while save awaits')
    assert.equal(await page.eval(()=>window.settingsHarness.view().form.brand_subtitle),'Other unsaved draft')
    await run(seed=>{const v=window.settingsHarness.view();for(const c of seed){const current=v.form[c.key];v.form[c.key]=typeof current==='object'?JSON.parse(c.value):typeof current==='boolean'?c.value==='true':typeof current==='number'?Number(c.value):c.value}},seed)
  }
  await run(()=>{const v=window.settingsHarness.view();v.form.registration_enabled=false;void v.saveRegistration()});const write=await last('update');await run(()=>{const v=window.settingsHarness.view();v.form.registration_enabled=true;v.form.registration_enabled=false});await run(index=>window.settingsHarness.pending[index].resolve({message:'Configs updated'}),write);await resolveList(await last('list'),seed);assert.equal(await page.eval(()=>window.settingsHarness.view().form.registration_enabled),false,'ABA draft edits remain unsaved');assert.equal(await page.eval(()=>window.settingsHarness.view().hasRegistrationChanges),true)
  // Concurrent groups keep their independent saved baselines and drafts regardless of read order.
  await run(()=>{const v=window.settingsHarness.view();v.form.registration_enabled=false;void v.saveRegistration();v.form.default_quota_host=4;void v.saveQuota()});const updates=await page.eval(()=>window.settingsHarness.pending.map((x,i)=>x.kind==='update'?i:-1).filter(i=>i>=0).slice(-2))
  await run(index=>window.settingsHarness.pending[index].resolve({message:'Configs updated'}),updates[0]);const readA=await last('list');await run(index=>window.settingsHarness.pending[index].resolve({message:'Configs updated'}),updates[1]);const readB=await last('list')
  await resolveList(readB,seed.map(c=>c.key==='default_quota_host'?{...c,value:'4'}:c));await resolveList(readA,seed.map(c=>c.key==='registration_enabled'?{...c,value:'false'}:c))
  assert.equal(await page.eval(()=>window.settingsHarness.view().form.default_quota_host),4);assert.equal(await page.eval(()=>window.settingsHarness.view().configs.find(c=>c.key==='default_quota_host').value),'4')
  // Inputs remain usable during the background refresh; even a revert remains a new draft.
  const beforeBrand=await page.eval(()=>window.settingsHarness.pending.filter(x=>x.kind==='update').length)
  await run(()=>{const v=window.settingsHarness.view();v.form.brand_name='Submitted brand';void v.saveBrand();void v.saveBrand()})
  const brandWrite=await last('update');assert.equal(await page.eval(()=>window.settingsHarness.pending.filter(x=>x.kind==='update').length),beforeBrand+1)
  await run(index=>window.settingsHarness.pending[index].resolve({message:'Config updated'}),brandWrite);const brandRead=await last('list')
  assert.equal(await page.eval(()=>window.settingsHarness.view().loading),false)
  await run(()=>{const v=window.settingsHarness.view();v.form.brand_name='Edited during refresh'})
  await resolveList(brandRead,seed.map(c=>c.key==='brand_name'?{...c,value:'Submitted brand'}:c))
  assert.equal(await page.eval(()=>window.settingsHarness.view().form.brand_name),'Edited during refresh');assert.equal(await page.eval(()=>window.settingsHarness.view().hasBrandChanges),true)
  // A confirmed unchanged secret is replaced by the server's mask, never copied from the submitted draft.
  await run(()=>{const v=window.settingsHarness.view();v.form.smtp_password='synthetic-only-password';void v.saveSmtp()});await run(index=>window.settingsHarness.pending[index].resolve({message:'Config updated'}),await last('update'))
  await resolveList(await last('list'),seed.map(c=>c.key==='smtp_password'?{...c,value:'********'}:c));assert.equal(await page.eval(()=>window.settingsHarness.view().form.smtp_password),'********')
  const baseline=await page.eval(()=>JSON.parse(JSON.stringify(window.settingsHarness.view().configs)))
  await run(()=>{const v=window.settingsHarness.view();v.form.brand_name='Draft after refresh failure';void v.saveBrand()});await run(index=>window.settingsHarness.pending[index].resolve({message:'Config updated'}),await last('update'))
  await run(index=>window.settingsHarness.pending[index].reject({message:'Synthetic refresh failure'}),await last('list'))
  assert.deepEqual(await page.eval(()=>JSON.parse(JSON.stringify(window.settingsHarness.view().configs))),baseline);assert.equal(await page.eval(()=>window.settingsHarness.view().form.brand_name),'Draft after refresh failure');assert.equal(await page.eval(()=>window.settingsHarness.view().savingBrand),false)
  // Initial reads protect edits made while loading and ignore an older same-key read.
  await run(()=>{void window.settingsHarness.view().loadConfigs()});const initialA=await last('list')
  await run(()=>{const v=window.settingsHarness.view();v.form.brand_name='Edited while initial load';void v.loadConfigs()});const initialB=await last('list')
  await run(()=>{window.settingsHarness.view().form.brand_name='Newest initial draft'})
  await resolveList(initialB,seed.map(c=>c.key==='brand_name'?{...c,value:'Newest baseline'}:c));await resolveList(initialA,seed)
  assert.equal(await page.eval(()=>window.settingsHarness.view().form.brand_name),'Newest initial draft');assert.equal(await page.eval(()=>window.settingsHarness.view().configs.find(c=>c.key==='brand_name').value),'Newest baseline')
  for(const[locale,width,dark]of[['zh-CN',1440,false],['zh-TW',768,false],['en',390,true]]){await run(({locale,dark})=>{const h=window.settingsHarness;h.setLocale(locale);h.theme.setTheme(dark?'dark':'light')},{locale,dark});await page.setViewport({width,height:1000,mobile:width===390});await sleep(200);assert.equal(await page.eval(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:resolve(output,locale+'-'+width+'.png'),format:'png'})}
  assert.equal(page.consoleErrors.length,0,page.consoleErrors.join('\n'));console.log('PASS actual 19 system settings save groups preserve other drafts and in-flight edits/ABA, concurrent group read order and saved baselines')
}finally{if(browser)await browser.close();await server.close()}
