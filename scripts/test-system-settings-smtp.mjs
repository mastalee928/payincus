import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { Browser, sleep } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'
const root=fileURLToPath(new URL('..',import.meta.url)).replaceAll('\\','/'),require=createRequire(new URL('../client/package.json',import.meta.url))
const {createServer}=await import(pathToFileURL(require.resolve('vite')).href),{default:vue}=await import(pathToFileURL(require.resolve('@vitejs/plugin-vue')).href)
const output=resolve(root,'logs/system-settings-smtp');mkdirSync(output,{recursive:true});process.env.TASTE_SKILL_TMP=output
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
  await resolveList(await last('list'),seed)
  const validSend={success:true,message:'Test email accepted',providerMessageId:'synthetic-only',acceptedRecipientCount:1,rejectedRecipientCount:0,pendingRecipientCount:0,providerResponse:'Synthetic accepted'}
  await run(()=>{const v=window.settingsHarness.view();v.form.smtp_host='smtp.example.com';v.form.smtp_username='fixture';v.testEmailTo='old@example.com';void v.sendTestEmail();void v.sendTestEmail()})
  assert.equal(await count('smtp-send'),1,'immediate duplicate send must be rejected')
  await reject(await last('smtp-send'))
  await run(()=>{void window.settingsHarness.view().testSmtpConnection();void window.settingsHarness.view().testSmtpConnection();void window.settingsHarness.view().sendTestEmail()});assert.equal(await count('smtp-test'),1);assert.equal(await count('smtp-send'),1);await accept(await last('smtp-test'),{success:true,message:'SMTP connection successful'})
  for(const kind of ['smtp-test','smtp-send'])for(const value of ['session','aba','account','role','logout','cache','smtp-draft','email-draft'])for(const failed of [false,true]){
    await run(()=>{const h=window.settingsHarness;h.auth.user={id:1,username:'fixture',role:'admin'};h.session('a');h.state.active=true;void h.view().loadConfigs()});await resolveList(await last('list'),seed)
    await run(kind=>{const v=window.settingsHarness.view();v.form.smtp_host='smtp.example.com';v.form.smtp_username='fixture';v.testEmailTo='old@example.com';void v[kind==='smtp-test'?'testSmtpConnection':'sendTestEmail']()},kind);const old=await last(kind)
    if(value==='smtp-draft')await run(()=>window.settingsHarness.view().form.smtp_host='new.example.com');else if(value==='email-draft')await run(()=>window.settingsHarness.view().testEmailTo='new@example.com');else await change(value)
    const notices=await page.eval(()=>window.settingsHarness.toasts.length)
    if(failed)await reject(old);else await accept(old,kind==='smtp-test'?{success:true,message:'SMTP connection successful'}:validSend)
    assert.equal(await page.eval(()=>window.settingsHarness.toasts.length),notices);assert.equal(await read('smtpTestError'),'');assert.equal(await read('smtpTestSuccess'),'')
    if(value==='email-draft')assert.equal(await read('testEmailTo'),'new@example.com')
  }
  await run(()=>{const h=window.settingsHarness;h.auth.user={id:1,username:'fixture',role:'admin'};h.session('a');h.state.active=true;void h.view().loadConfigs()});await resolveList(await last('list'),seed)
  const invalid=[null,{}, {success:1,message:'x'},{success:true,message:''}]
  for(const kind of ['smtp-test','smtp-send'])for(const data of invalid){await run(kind=>{const v=window.settingsHarness.view();v.testEmailTo='valid@example.com';void v[kind==='smtp-test'?'testSmtpConnection':'sendTestEmail']()},kind);await accept(await last(kind),data);assert.ok(await read('smtpTestError'));assert.equal(await read('smtpTestSuccess'),'');if(kind==='smtp-send')assert.equal(await read('testEmailTo'),'valid@example.com')}
  for(const data of [{...validSend,acceptedRecipientCount:0},{...validSend,acceptedRecipientCount:'1'},{...validSend,rejectedRecipientCount:1},{...validSend,pendingRecipientCount:1}]){await run(()=>{void window.settingsHarness.view().sendTestEmail()});await accept(await last('smtp-send'),data);assert.ok(await read('smtpTestError'));assert.equal(await read('smtpTestSuccess'),'')}
  for(const address of ['@','user@','user@localhost','a b@example.com']){const before=await count('smtp-send');await run(address=>{const v=window.settingsHarness.view();v.testEmailTo=address;void v.sendTestEmail()},address);assert.equal(await count('smtp-send'),before);assert.ok(await read('smtpTestError'))}
  await run(()=>{const v=window.settingsHarness.view();v.testEmailTo='current@example.com';void v.sendTestEmail()});assert.equal(await page.eval(index=>window.settingsHarness.pending[index].data.to,await last('smtp-send')),'current@example.com');await run(()=>window.settingsHarness.session('a',2));await accept(await last('smtp-send'),validSend);assert.equal(await read('testEmailTo'),'');assert.ok((await read('smtpTestSuccess')).includes('current@example.com'))
  for(const kind of ['smtp-test','smtp-send'])for(const failed of [false,true]){await run(kind=>{const v=window.settingsHarness.view();v.testEmailTo='unmount@example.com';void v[kind==='smtp-test'?'testSmtpConnection':'sendTestEmail']()},kind);const old=await last(kind);await run(()=>window.settingsHarness.state.mounted=false);if(failed)await reject(old);else await accept(old,kind==='smtp-test'?{success:true,message:'SMTP connection successful'}:validSend);assert.equal(await read('smtpTestError'),'');assert.equal(await read('smtpTestSuccess'),'');await run(()=>window.settingsHarness.state.mounted=true);await resolveList(await last('list'),seed)}
  await run(()=>{const h=window.settingsHarness;h.router.push('/admin/settings/mail');h.view().testEmailTo='error@example.com';void h.view().sendTestEmail()});await reject(await last('smtp-send'))
  for(const[locale,width,dark]of[['zh-CN',1440,false],['zh-TW',768,false],['en',390,true]]){await run(({locale,dark})=>{const h=window.settingsHarness;h.setLocale(locale);h.theme.setTheme(dark?'dark':'light');h.view().testEmailTo='screenshot@example.com';void h.view().sendTestEmail()},{locale,dark});await reject(await last('smtp-send'));await page.setViewport({width,height:1000,mobile:width===390});await run(()=>{document.querySelector('[role="alert"]').scrollIntoView({block:'center'})});await sleep(200);assert.equal(await page.eval(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:resolve(output,locale+'-'+width+'.png'),format:'png'})}
  assert.equal(page.consoleErrors.length,0,page.consoleErrors.join('\n'));console.log('PASS actual SMTP busy gates, 16 old receipts per operation (32 total), session/drafts/cache targets, strict receipt/count/email inputs, same sid and persistent result')
}finally{if(browser)await browser.close();await server.close()}
