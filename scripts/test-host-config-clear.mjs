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
    while (!await page.eval(() => !!window.hostConfigHarness?.view())) { if (Date.now() > deadline) throw Error('Host Caddy fixture did not mount'); await sleep(70) }
  }
  const load = async (mode = 2) => {
    await fresh();await run(mode=>{const h=window.hostConfigHarness;h.host.value={...h.host.value,location:'old description',ipv6Mode:mode,ipv6ParentInterface:'eth0',ipv6Subnet:'2001:db8::/64'}},mode)
  }
  for(const mode of [1,2,3,null]) {
    await fresh();await run(mode=>{const h=window.hostConfigHarness;h.host.value={...h.host.value,ipv6Mode:mode===null?undefined:mode,ipv6Subnet:'',ipv6ParentInterface:''}},mode)
    await run(()=>{const input=document.querySelector('input[placeholder="Hong Kong DC1"]');input.value='IPv4-only host';input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('button[type="submit"]').click()})
    assert.equal(await page.eval(()=>window.hostConfigHarness.pending.length),1,'empty IPv6 must permit an unrelated description edit')
    const payload=await page.eval(()=>window.hostConfigHarness.pending[0].data)
    assert.equal(payload.location,'IPv4-only host');assert.equal(payload.ipv6Subnet,'');assert.equal(payload.ipv6ParentInterface,'')
    await run(()=>window.hostConfigHarness.pending[0].resolve({message:'Fixture saved'}))
    assert.equal(await page.eval(()=>window.hostConfigHarness.saved.value),1)
  }
  for(const mode of [2,3]) for(const fields of [['location'],['ipv6Subnet'],['ipv6ParentInterface','ipv6Subnet'],['location','ipv6ParentInterface','ipv6Subnet']]) {
    await load(mode);await run(fields=>{const v=window.hostConfigHarness.view();for(const field of fields)v.form[field]='';void v.saveConfig()},fields)
    const payload=await page.eval(()=>window.hostConfigHarness.pending[0].data)
    for(const field of fields)assert.equal(payload[field],'',`${field} clearing must survive JSON serialization`)
    assert.equal(payload.url,undefined)
    await run(()=>{const h=window.hostConfigHarness;h.pending[0].resolve({message:'Fixture saved'})})
    assert.equal(await page.eval(()=>window.hostConfigHarness.saved.value),1)
  }
  await load(2);await run(()=>{const v=window.hostConfigHarness.view();v.form.ipv6ParentInterface='  ';v.form.ipv6Subnet='  ';void v.saveConfig()})
  assert.equal(await page.eval(()=>window.hostConfigHarness.pending[0].data.ipv6ParentInterface),'')
  assert.equal(await page.eval(()=>window.hostConfigHarness.pending[0].data.ipv6Subnet),'')
  for(const mode of [1,2,3,null]) {
    await load(mode===null?undefined:mode);await run(()=>{const v=window.hostConfigHarness.view();v.form.ipv6ParentInterface='';void v.saveConfig()})
    assert.equal(await page.eval(()=>window.hostConfigHarness.pending.length),0,'a remaining subnet always requires its parent interface')
  }
  await load(1);await run(()=>{const v=window.hostConfigHarness.view();v.form.ipv6ParentInterface='';v.form.ipv6Subnet='';void v.saveConfig()})
  assert.equal(await page.eval(()=>window.hostConfigHarness.pending.length),0,'route mode cannot clear required IPv6 configuration')
  console.log('PASS explicit description/subnet/interface clearing in modes 2/3, trim, subnet and route-mode guards')
  await load(2);await run(()=>{const v=window.hostConfigHarness.view();v.form.ipv6ParentInterface='';v.form.ipv6Subnet='';void v.saveConfig()})
  await run(()=>{const h=window.hostConfigHarness;h.pending[0].reject(Object.assign(Error('Route mode requires configuration'),{code:'HOST_IPV6_ROUTE_REQUIRES_CONFIG'}))})
  assert.equal(await page.eval(()=>window.hostConfigHarness.saved.value),0)
  assert.equal(await page.eval(()=>window.hostConfigHarness.view().form.ipv6Subnet),'','failure preserves the clearing draft')
  for(const locale of ['zh-CN','zh-TW','en']) for(const width of [1440,768,390]) {
    await page.setViewport({width,height:1000});await fresh();await run(locale=>{const h=window.hostConfigHarness;h.setLocale(locale);h.host.value={...h.host.value,ipv6Mode:1,ipv6ParentInterface:'',ipv6Subnet:''}},locale)
    await run(()=>{const input=document.querySelector('input[placeholder="Hong Kong DC1"]');input.value='IPv4-only host';input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('button[type="submit"]').click()})
    assert.equal(await page.eval(()=>window.hostConfigHarness.pending.length),1)
    assert.equal(await page.eval(()=>window.hostConfigHarness.pending[0].data.location),'IPv4-only host')
    await run(()=>window.hostConfigHarness.pending[0].resolve({message:'Fixture saved'}))
    assert.equal(await page.eval(()=>window.hostConfigHarness.saved.value),1)
    if(locale==='zh-CN')await page.screenshot({path:resolve(output,`r276-empty-${width}.png`),format:'png',fullPage:true})
    await page.setViewport({width,height:1000});await load(2);await run(locale=>window.hostConfigHarness.setLocale(locale),locale)
    await run(()=>{for(const selector of ['input[placeholder="Hong Kong DC1"]','input[placeholder="eth0"]','input[placeholder="2001:db8::/48"]']){const input=document.querySelector(selector);input.value='';input.dispatchEvent(new Event('input',{bubbles:true}))}document.querySelector('button[type="submit"]').click()})
    const payload=await page.eval(()=>window.hostConfigHarness.pending[0].data)
    for(const field of ['location','ipv6ParentInterface','ipv6Subnet'])assert.equal(payload[field],'')
    assert.ok(await page.eval(()=>document.documentElement.scrollWidth<=innerWidth+1))
  }
  assert.equal(page.consoleErrors.length,0,page.consoleErrors.join('\n'))
  console.log('PASS server failure keeps draft; initially empty IPv6 and explicit clearing use actual input/save controls in three languages and three widths')
} finally { if (browser) await browser.close(); await server.close() }
