import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { Browser, sleep } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'
const root = fileURLToPath(new URL('..', import.meta.url)).replaceAll('\\', '/'), require = createRequire(new URL('../client/package.json', import.meta.url))
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href), { default: vue } = await import(pathToFileURL(require.resolve('@vitejs/plugin-vue')).href)
const output = resolve(root, 'logs/host-detail-extend'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js'); tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/host-detail-copy/*.js']
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/host-detail-copy', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/host-detail-copy/api.js' }, { find: /^@\/components\/host\/.*\.vue$/, replacement: root + '/scripts/fixtures/host-detail-copy/empty.js' }, { find: '@', replacement: root + '/client/src' }, ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } }, server: { host: '127.0.0.1', port: process.argv.includes('--serve-only') ? 19748 : 19747, strictPort: true, fs: { allow: [root] } }
})
const host = (id = 11) => ({ id, name: '测试宿主', status: 'online', countryCode: 'JP', url: 'https://host.example.test', certPath: '/fixture/cert' })

let browser, obsolete = 0
try {
 await server.listen()
 if(process.argv.includes('--serve-only')) {console.log('Extension fixture http://127.0.0.1:19748/?inspect&extend-error');await new Promise(()=>{})}
 browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
 const run = async (fn,arg) => { const result = await page.eval(fn,arg); await sleep(35); return result }
 const fresh = async () => {
  await page.goto('http://127.0.0.1:19747',{settleMs:250}); const deadline=Date.now()+15000
  while(!await page.eval(()=>!!window.hostDetailHarness?.view() && hostDetailHarness.pending.length>0)) { if(Date.now()>deadline) throw Error('fixture mount timeout');await sleep(70) }
  await run(host=>hostDetailHarness.pending.forEach(p=>p.resolve({host})),host())
  await run(()=>{ void hostDetailHarness.view().openExtendModal() })
 }
 const submit = days => run(days=>{ const v=hostDetailHarness.view();v.extendDays=days;void v.confirmExtendAll() },days)
 const finish = (i,value,fail=false) => run(({i,value,fail})=>{const p=hostDetailHarness.pending[i];fail?p.reject(Error('fixture extension failed')):p.resolve(value)},{i,value,fail})
 for(const days of [1.5,0,-1,366,'2',NaN,Infinity]) {
  await fresh();await submit(days)
  assert.equal(await page.eval(()=>hostDetailHarness.pending.filter(p=>p.kind==='extend').length),0,'invalid day count has no write')
 }
 await fresh();await submit(2);await submit(2)
 assert.equal(await page.eval(()=>hostDetailHarness.pending.filter(p=>p.kind==='extend').length),1)
 await run(()=>{const v=hostDetailHarness.view(); for(const name of ['testConnection','verifyHost','openDeleteModal','regenerateInstall','verifyAfterReinstall'])void v[name]()})
 assert.equal(await page.eval(()=>hostDetailHarness.pending.length),2,'extension shares the other action gate')
 for(const mode of ['host','route','route-aba','account','sid','role','logout','session-aba','cache','unmount','dialog-aba','draft-aba']) for(const fail of [false,true]) {
  await fresh();await submit(2);const i=await page.eval(()=>hostDetailHarness.pending.length-1)
  assert.equal(await page.eval(i=>hostDetailHarness.pending[i].days,i),2)
  await run(async mode=>{const h=hostDetailHarness,v=h.view()
   if(mode==='host')await h.router.push('/hosts/12')
   if(mode==='route')await h.router.push('/elsewhere')
   if(mode==='route-aba'){await h.router.push('/hosts/12');await h.router.push('/hosts/11')}
   if(mode==='account')h.session(2)
   if(mode==='sid')h.session(1,'other')
   if(mode==='role')h.session(1,'copy-session','user')
   if(mode==='logout')h.auth.clearLocalAuth()
   if(mode==='session-aba'){h.session(2);h.session(1)}
   if(mode==='cache')h.active.value=false
   if(mode==='unmount')h.mounted.value=false
   if(mode==='dialog-aba'){v.showExtendModal=false;v.showExtendModal=true}
   if(mode==='draft-aba'){v.extendDays=3;v.extendDays=2}
  },mode)
  await finish(i,{success:true,extendedCount:3,message:'fixture extension complete'},fail)
  assert.equal(await page.eval(()=>hostDetailHarness.toast.toasts.value.length),0,mode+' obsolete receipt ignored');obsolete++
 }
 for(const payload of [null,{}, {success:false},{success:true,extendedCount:'3'},{success:true,extendedCount:-1},{success:true,extendedCount:0.5},{success:true,extendedCount:2,message:''}]) {
  await fresh();await submit(2);await finish(await page.eval(()=>hostDetailHarness.pending.length-1),payload)
  assert.ok(await page.eval(()=>document.querySelector('[data-host-detail-action-error]')))
  assert.equal(await page.eval(()=>hostDetailHarness.view().showExtendModal),true)
 }
 await fresh();await submit(2);const same=await page.eval(()=>hostDetailHarness.pending.length-1);await run(()=>hostDetailHarness.session(1,'copy-session','admin',2))
 await finish(same,{success:true,extendedCount:3,message:'fixture extension complete'})
 assert.equal(await page.eval(()=>hostDetailHarness.toast.toasts.value.length),1)
 for(const locale of ['zh-CN','zh-TW','en'])for(const width of [1440,768,390]) {
  await fresh();await page.setViewport({width,height:900,mobile:width===390});await run(locale=>hostDetailHarness.setLocale(locale),locale);await sleep(350)
  await run(()=>{const input=document.querySelector('[data-host-extend-days]');input.value='1.5';input.dispatchEvent(new Event('input',{bubbles:true}))})
  assert.equal(await page.eval(()=>document.querySelector('[data-host-extend-confirm]').disabled),true)
  await run(()=>{const input=document.querySelector('[data-host-extend-days]');input.value='2';input.dispatchEvent(new Event('input',{bubbles:true}))})
  await run(()=>document.querySelector('[data-host-extend-confirm]').click());const i=await page.eval(()=>hostDetailHarness.pending.length-1)
  assert.equal(await page.eval(()=>document.querySelector('[data-host-extend-days]').disabled),true)
  await run(()=>hostDetailHarness.view().closeExtendModal());assert.equal(await page.eval(()=>hostDetailHarness.view().showExtendModal),true)
  await finish(i,null,true)
  assert.ok(await page.eval(()=>document.querySelector('[data-host-detail-action-error]')))
  await page.screenshot({path:resolve(output,`${locale}-${width}.png`),format:'png'})
  assert.ok(await page.eval(()=>document.documentElement.scrollWidth<=innerWidth))
  if(width===390)assert.ok(await page.eval(()=>document.querySelector('[data-host-extend-confirm]').getBoundingClientRect().height>=44))
  await run(()=>document.querySelector('[data-host-extend-confirm]').click());await finish(await page.eval(()=>hostDetailHarness.pending.length-1),{success:true,extendedCount:3,message:'fixture extension complete'})
  assert.equal(await page.eval(()=>hostDetailHarness.view().showExtendModal),false)
  assert.ok(await page.eval(()=>hostDetailHarness.toast.toasts.value.at(-1).message.includes('3')))
 }
 assert.equal(page.consoleErrors.length,0,page.consoleErrors.join('\n'))
 console.log(`PASS actual host detail extension integers, duplicate gate, ${obsolete} obsolete receipts, malformed replies, fixed days and actual controls in three languages/widths; no host or database writes`)
}finally{if(browser)await browser.close();await server.close()}
