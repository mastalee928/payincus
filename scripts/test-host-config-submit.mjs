import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { Browser, sleep } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'
const root = fileURLToPath(new URL('..', import.meta.url)).replaceAll('\\', '/'), require = createRequire(new URL('../client/package.json', import.meta.url))
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href), { default: vue } = await import(pathToFileURL(require.resolve('@vitejs/plugin-vue')).href)
const output = resolve(root, 'logs/host-config-reads'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js'); tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/host-config/*.js']
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/host-config', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/host-config/api.js' }, { find: '@', replacement: root + '/client/src' }, ...['vue', 'pinia', 'vue-i18n'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } }, server: { host: '127.0.0.1', port: 19747, strictPort: true, fs: { allow: [root] } }
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  if (process.argv.includes('--inspect-only')) { console.log('Host config inspector ready http://127.0.0.1:19747/?inspect'); await new Promise(() => {}) }
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(40); return result }
  const fresh = async () => {
    await page.goto('http://127.0.0.1:19747', { settleMs: 250 }); const deadline = Date.now() + 15000
    while (!await page.eval(() => !!window.hostConfigHarness?.view())) { if (Date.now() > deadline) throw Error('Host config fixture did not mount'); await sleep(70) }
  }
  const settle = async (index, value={message:'Fixture saved'}, fail=false) => run(({index,value,fail}) => {const h=window.hostConfigHarness;fail?h.pending[index].reject(Error('Fixture save failed')):h.pending[index].resolve(value)},{index,value,fail})
  if (process.argv.includes('--type-error-only')) {
    const expected={'zh-CN':'实例类型与宿主支持范围不兼容。请调整套餐类型或宿主绑定后重试。','zh-TW':'實例類型與宿主支援範圍不相容。請調整套餐類型或宿主綁定後重試。','en':'The instance type is incompatible with the host. Adjust the package type or host bindings, then try again.'}
    for(const locale of ['zh-CN','zh-TW','en'])for(const width of [1440,768,390]) {
      await page.setViewport({width,height:1000});await fresh();await run(locale=>window.hostConfigHarness.setLocale(locale),locale)
      await run(()=>{const h=window.hostConfigHarness,v=h.view();v.form.instanceType='vm';document.querySelector('button[type="submit"]').click();h.pending[0].reject({code:'HOST_INSTANCE_TYPE_MISMATCH',message:'Host instance type is incompatible with bound packages',details:null})})
      assert.equal(await page.eval(()=>document.querySelector('[data-host-config-error]').textContent.trim()),expected[locale],'current type refusal must use configured locale')
      assert.equal(await page.eval(()=>window.hostConfigHarness.saved.value),0)
      assert.equal(await page.eval(()=>window.hostConfigHarness.view().form.instanceType),'vm')
      assert.ok(await page.eval(()=>document.documentElement.scrollWidth<=innerWidth+1))
      await page.screenshot({path:resolve(output,`type-error-${locale}-${width}.jpg`),fullPage:true})
      await run(()=>document.querySelector('button[type="submit"]').click());await settle(1)
      assert.equal(await page.eval(()=>window.hostConfigHarness.saved.value),1)
    }
    await fresh();await run(()=>{const h=window.hostConfigHarness;void h.view().saveConfig();h.pending[0].reject({code:'FIXTURE_UNKNOWN_CODE',message:'Fixture unknown refusal'})})
    assert.equal(await page.eval(()=>document.querySelector('[data-host-config-error]').textContent.trim()),'Fixture unknown refusal')
    assert.equal(page.consoleErrors.length,0,page.consoleErrors.join('\n'))
    console.log('PASS real type error response shape in three locales/widths, persistent refusal, draft retention, retry and unknown-code fallback')
  } else {
  await fresh();await run(()=>{window.hostConfigHarness.view().form.location='unsaved description'})
  await run(()=>{const h=window.hostConfigHarness;h.host.value={...h.host.value,location:'refreshed description'}})
  assert.equal(await page.eval(()=>window.hostConfigHarness.view().form.location),'unsaved description','dirty parent refresh preserves draft')
  await fresh();await run(()=>{const h=window.hostConfigHarness;h.host.value={...h.host.value,location:'refreshed description'}})
  assert.equal(await page.eval(()=>window.hostConfigHarness.view().form.location),'refreshed description','clean form may receive refreshed values')
  await run(()=>{const v=window.hostConfigHarness.view();v.form.location='submitted';void v.saveConfig();void v.saveConfig()})
  assert.equal(await page.eval(()=>window.hostConfigHarness.pending.length),1)
  assert.ok(await page.eval(()=>document.querySelector('fieldset').disabled))
  await run(()=>{const h=window.hostConfigHarness;h.host.value={...h.host.value,location:'parent update during write'}})
  assert.equal(await page.eval(()=>window.hostConfigHarness.view().form.location),'submitted')
  await settle(0);assert.equal(await page.eval(()=>window.hostConfigHarness.saved.value),1)
  await run(()=>{const h=window.hostConfigHarness;h.host.value={...h.host.value,location:'parent after save'}})
  assert.equal(await page.eval(()=>window.hostConfigHarness.view().form.location),'parent after save')
  console.log('PASS dirty/clean parent refresh, fixed submitted payload and duplicate/fieldset gates')
  let checked=0
  for(const mode of ['host','host-aba','account','sid','role','logout','session-aba','cache','unmount','draft','draft-aba']) for(const fail of [false,true]) {
    await fresh();await run(()=>{const h=window.hostConfigHarness;window.oldConfig=h.view();oldConfig.form.location='submitted';void oldConfig.saveConfig()})
    const payload=await page.eval(()=>JSON.stringify(window.hostConfigHarness.pending[0].data))
    await run(mode=>{const h=window.hostConfigHarness,v=h.view()
      if(mode==='host'||mode==='host-aba')h.host.value={...h.host.value,id:12,name:'replacement-node'}
      if(mode==='account')h.session(2)
      if(mode==='sid')h.session(1,'other-config-session')
      if(mode==='role')h.session(1,'host-config-session','user')
      if(mode==='logout')h.auth.clearLocalAuth()
      if(mode==='session-aba'){h.session(2);h.session(1)}
      if(mode==='cache')h.active.value=false
      if(mode==='unmount')h.mounted.value=false
      if(mode==='draft'||mode==='draft-aba'){v.form.location='later draft';if(mode==='draft-aba')v.form.location='submitted'}
    },mode)
    if(mode==='host-aba')await run(()=>{const h=window.hostConfigHarness;h.host.value={...h.host.value,id:11,name:'fixture-node'}})
    const before=await page.eval(()=>JSON.stringify({form:JSON.parse(JSON.stringify(oldConfig.form)),error:oldConfig.saveError,saved:window.hostConfigHarness.saved.value,toasts:window.hostConfigHarness.toast.toasts.value.map(t=>t.message)}))
    await settle(0,{message:'Fixture saved'},fail)
    assert.equal(await page.eval(()=>JSON.stringify({form:JSON.parse(JSON.stringify(oldConfig.form)),error:oldConfig.saveError,saved:window.hostConfigHarness.saved.value,toasts:window.hostConfigHarness.toast.toasts.value.map(t=>t.message)})),before,'obsolete write cannot mutate current draft/status/toasts')
    assert.equal(await page.eval(()=>JSON.stringify(window.hostConfigHarness.pending[0].data)),payload)
    assert.equal(await page.eval(()=>oldConfig.saving),false)
    checked++
  }
  console.log(`PASS ${checked} obsolete host/account/session/draft ABA/cache/unmount save receipts`)
  await fresh();await run(()=>{void window.hostConfigHarness.view().saveConfig()})
  await run(()=>{window.hostConfigHarness.active.value=false});await run(()=>{window.hostConfigHarness.active.value=true})
  await run(()=>{void window.hostConfigHarness.view().saveConfig()})
  assert.equal(await page.eval(()=>window.hostConfigHarness.pending.length),1,'cache return retains original in-flight lock')
  await settle(0);await run(()=>{void window.hostConfigHarness.view().saveConfig()});assert.equal(await page.eval(()=>window.hostConfigHarness.pending.length),2);await settle(1)
  for(const value of [null,{}, {message:''},{message:123}]) {
    await fresh();await run(()=>{const v=window.hostConfigHarness.view();v.form.location='draft';void v.saveConfig()});await settle(0,value)
    assert.ok(await page.eval(()=>!!document.querySelector('[data-host-config-error]')));assert.equal(await page.eval(()=>window.hostConfigHarness.saved.value),0)
    assert.equal(await page.eval(()=>window.hostConfigHarness.view().form.location),'draft')
    await run(()=>document.querySelector('button[type="submit"]').click());await settle(1);assert.equal(await page.eval(()=>window.hostConfigHarness.saved.value),1)
  }
  await fresh();await run(()=>{void window.hostConfigHarness.view().saveConfig()});await settle(0,null,true)
  assert.ok(await page.eval(()=>!!document.querySelector('[data-host-config-error]')))
  await run(()=>document.querySelector('button[type="submit"]').click());await settle(1)
  await fresh();await run(()=>{const h=window.hostConfigHarness;h.auth.token='fixture.'+btoa(JSON.stringify({sid:'host-config-session',revision:2}))+'.fixture';void h.view().saveConfig()});await settle(0)
  assert.equal(await page.eval(()=>window.hostConfigHarness.saved.value),1)
  await fresh();await run(()=>{const h=window.hostConfigHarness;h.host.value={...h.host.value,name:'PEER1-node'};h.session(1,'host-config-session','user')})
  assert.equal(await page.eval(()=>window.hostConfigHarness.view().form.nameSuffix),'node')
  await run(()=>{const v=window.hostConfigHarness.view();v.form.nameSuffix='changed';void v.saveConfig()})
  assert.equal(await page.eval(()=>window.hostConfigHarness.pending[0].data.name),'PEER1-changed');await settle(0)
  await page.setViewport({width:390,height:1000});await fresh();await run(()=>{const h=window.hostConfigHarness;h.host.value={...h.host.value,name:'PEER1-node'};h.session(1,'host-config-session','user')})
  const switches=await page.eval(()=>[...document.querySelectorAll('[role="switch"]')].map(e=>({name:e.getAttribute('aria-label'),checked:e.getAttribute('aria-checked'),width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height,knob:e.firstElementChild?.getBoundingClientRect().height})))
  assert.equal(switches.length,5)
  assert.ok(switches.every(s=>s.name && ['true','false'].includes(s.checked) && s.width>=44 && s.height>=44 && s.knob===20),'switches expose names/status, 44px hit areas and unscaled knobs')
  await run(()=>document.querySelector('[role="switch"]').click());assert.equal(await page.eval(()=>document.querySelector('[role="switch"]').getAttribute('aria-checked')),'false')
  await run(()=>{void window.hostConfigHarness.view().saveConfig();document.querySelector('[role="switch"]').click()})
  assert.equal(await page.eval(()=>window.hostConfigHarness.view().form.transferEnabled),false,'pending fieldset disables switches');await settle(0)
  console.log('PASS cache locks, malformed/current failure retry, same sid and user prefix')
  for(const locale of ['zh-CN','zh-TW','en'])for(const width of [1440,768,390]){
    await page.setViewport({width,height:1000});await fresh();await run(locale=>window.hostConfigHarness.setLocale(locale),locale)
    await run(()=>{document.querySelector('button[type="submit"]').click();document.querySelector('button[type="submit"]').click()})
    assert.equal(await page.eval(()=>window.hostConfigHarness.pending.length),1)
    assert.ok(await page.eval(()=>document.querySelector('fieldset').disabled))
    await settle(0,null,true);assert.ok(await page.eval(()=>!!document.querySelector('[data-host-config-error]')))
    assert.ok(await page.eval(()=>document.documentElement.scrollWidth<=innerWidth+1))
    if(width===390)assert.ok(await page.eval(()=>[...document.querySelectorAll('button,input:not([type="checkbox"]),select,textarea')].every(e=>e.getBoundingClientRect().height>=44)))
    await page.screenshot({path:resolve(output,`submit-${locale}-${width}.jpg`),fullPage:true})
    await run(()=>document.querySelector('button[type="submit"]').click());await settle(1)
  }
  assert.equal(page.consoleErrors.length,0,page.consoleErrors.join('\n'))
  console.log('PASS three-language actual save/failure/retry and pending controls/44px')
  }
} finally { if (browser) await browser.close(); await server.close() }
