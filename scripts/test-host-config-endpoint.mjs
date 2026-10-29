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
  const cases = [
    ['https://node.example.test',443], ['https://node.example.test:443/path?scope=fixture#host',443], ['http://node.example.test/path',80],
    ['http://node.example.test:80/incus/api?scope=fixture#host',80], ['https://node.example.test:8443/incus/api/',8443],
    ['http://node.example.test:8080/path?a=1&b=2#host',8080], ['https://[2001:db8::1]/incus/api',443], ['http://[2001:db8::1]:8080/path',8080]
  ]
  for (const [url,port] of cases) {
    await fresh();await run(url=>{const h=window.hostConfigHarness;h.host.value={...h.host.value,url}},url)
    assert.equal(await page.eval(()=>window.hostConfigHarness.view().form.apiPort),port,'display the saved effective HTTP(S) port')
    await run(()=>{const v=window.hostConfigHarness.view();v.form.location='changed description';void v.saveConfig()})
    assert.equal(await page.eval(()=>Object.hasOwn(window.hostConfigHarness.pending[0].data,'url')),false,'unrelated edits omit URL completely')
    await run(()=>{const h=window.hostConfigHarness;h.pending[0].resolve({message:'Fixture saved'})})
    assert.equal(await page.eval(()=>window.hostConfigHarness.saved.value),1)
  }
  console.log('PASS eight unchanged protocols/default and explicit ports/path/query/fragment/IPv6 endpoints omitted')
  for (const [url] of cases) for (const change of ['address','port','both']) {
    await fresh();await run(url=>{const h=window.hostConfigHarness;h.host.value={...h.host.value,url}},url)
    const original=new URL(url), address=change==='port'?original.hostname:'replacement.example.test', port=change==='address'?(Number(original.port)||(original.protocol==='http:'?80:443)):9443
    await run(({address,port})=>{const v=window.hostConfigHarness.view();v.form.hostAddress=address;v.form.apiPort=port;void v.saveConfig()}, {address,port})
    const updated=new URL(await page.eval(()=>window.hostConfigHarness.pending[0].data.url))
    assert.equal(updated.protocol,original.protocol);assert.equal(updated.pathname,original.pathname);assert.equal(updated.search,original.search);assert.equal(updated.hash,original.hash)
    assert.equal(updated.hostname,address);assert.equal(Number(updated.port)||(updated.protocol==='http:'?80:443),port)
  }
  await fresh();await run(()=>{const v=window.hostConfigHarness.view();v.form.hostAddress='[2001:db8::22]';v.form.apiPort=9443;void v.saveConfig()})
  assert.equal(new URL(await page.eval(()=>window.hostConfigHarness.pending[0].data.url)).hostname,'[2001:db8::22]')
  console.log('PASS address/port edits preserve 24 protocol/path/query/fragment combinations and IPv6 brackets')
  for(const port of [0,-1,1.5,65536,null,'8443']) {
    await fresh();await run(port=>{const v=window.hostConfigHarness.view();v.form.apiPort=port;void v.saveConfig()},port)
    assert.equal(await page.eval(()=>window.hostConfigHarness.pending.length),0,'invalid direct-call ports never write')
  }
  await fresh();await run(()=>{const h=window.hostConfigHarness;h.host.value={...h.host.value,url:'https://node.example.test:8443/path'}})
  await run(()=>{const v=window.hostConfigHarness.view();v.form.hostAddress='temporary.example.test';v.form.hostAddress='node.example.test';v.form.apiPort=9443;v.form.apiPort=8443;void v.saveConfig()})
  assert.equal(await page.eval(()=>Object.hasOwn(window.hostConfigHarness.pending[0].data,'url')),false,'restoring original endpoint remains unchanged')
  console.log('PASS six invalid direct-call ports and restored endpoint')
  for(const locale of ['zh-CN','zh-TW','en']) for(const width of [1440,768,390]) {
    await page.setViewport({width,height:1000});await fresh();await run(locale=>window.hostConfigHarness.setLocale(locale),locale)
    await run(()=>{const input=document.querySelector('input[type="number"][placeholder="8443"]');input.value='9443';input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('button[type="submit"]').click()})
    assert.equal(await page.eval(()=>new URL(window.hostConfigHarness.pending[0].data.url).port),'9443')
    assert.ok(await page.eval(()=>document.documentElement.scrollWidth<=innerWidth+1))
    await page.screenshot({path:resolve(output,`${locale}-${width}.jpg`),fullPage:true})
  }
  assert.equal(page.consoleErrors.length,0,page.consoleErrors.join('\n'))
  console.log('PASS actual port input/save controls in three languages/widths')
} finally { if (browser) await browser.close(); await server.close() }
