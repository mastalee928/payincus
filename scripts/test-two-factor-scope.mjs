import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { Browser, sleep } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'
const root = fileURLToPath(new URL('..', import.meta.url)).replaceAll('\\', '/')
const require = createRequire(new URL('../client/package.json', import.meta.url))
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href)
const { default: vue } = await import(pathToFileURL(require.resolve('@vitejs/plugin-vue')).href)
const output = resolve(root, 'logs/two-factor-scope'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js')
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/two-factor/*.js']
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/two-factor', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/two-factor/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } }, server: { host: '127.0.0.1', port: 19718, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19718', { settleMs: 1400 })
  for (let attempt = 0; attempt < 200; attempt++) { if (await page.eval(() => !!window.twoFactorHarness?.pending.length)) break; if (attempt === 199) throw Error(page.consoleErrors.join('\n')); await sleep(100) }
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(80); return result }
  const last = kind => page.eval(kind => window.twoFactorHarness.pending.findLastIndex(item => item.kind === kind), kind)
  const accept = (index, data) => run(({ index, data }) => window.twoFactorHarness.pending[index].resolve(data), { index, data })
  const reject = index => run(index => window.twoFactorHarness.pending[index].reject(Error('fixture operation unavailable')), index)

  await reject(await last('status')); const before = await page.eval(()=>window.twoFactorHarness.pending.length)
  await run(()=>{void window.twoFactorHarness.view().startSetup()})
  assert.equal(await page.eval(()=>window.twoFactorHarness.pending.length),before,'failed status cannot be represented as disabled and start a new setup')

  const read = key => page.eval(key=>JSON.parse(JSON.stringify(window.twoFactorHarness.view()[key])),key)
  await run(()=>{void window.twoFactorHarness.view().loadStatus()}); await accept(await last('status'),{enabled:false})
  assert.equal(await read('statusReady'),true);assert.equal(await read('enabled'),false);assert.equal(await read('statusError'),'')
  await run(()=>{void window.twoFactorHarness.view().loadStatus()});let old=await last('status')
  await run(()=>{void window.twoFactorHarness.view().loadStatus()});let fresh=await last('status')
  await reject(old);assert.equal(await read('statusLoading'),true);assert.equal(await read('statusError'),'')
  await accept(fresh,{enabled:true});assert.equal(await read('enabled'),true);assert.equal(await read('statusLoading'),false)
  old=await last('codes-status');await run(()=>{void window.twoFactorHarness.view().loadRecoveryCodesStatus()});fresh=await last('codes-status')
  await reject(old);assert.equal(await read('recoveryStatusLoading'),true);await reject(fresh);assert.match(await read('recoveryStatusError'),/fixture operation unavailable/)
  await run(()=>{void window.twoFactorHarness.view().loadRecoveryCodesStatus()});await accept(await last('codes-status'),{total:8,remaining:0,used:8});assert.equal(await read('recoveryStatusError'),'');assert.equal((await read('recoveryCodesStatus')).remaining,0)
  for(const invalid of [{},{enabled:'false'},{enabled:null}]){
    await run(()=>{void window.twoFactorHarness.view().loadStatus()});await accept(await last('status'),invalid);assert.equal(await read('statusReady'),false);assert.ok(await read('statusError'))
  }
  await run(()=>{void window.twoFactorHarness.view().loadStatus()});await accept(await last('status'),{enabled:true})
  for(const invalid of [{},{total:8,remaining:1,used:8},{total:8,remaining:-1,used:9},{total:'8',remaining:8,used:0}]){
    await run(()=>{void window.twoFactorHarness.view().loadRecoveryCodesStatus()});await accept(await last('codes-status'),invalid);assert.ok(await read('recoveryStatusError'));assert.equal(await read('recoveryCodesStatus'),null)
  }
  await run(()=>{void window.twoFactorHarness.view().loadRecoveryCodesStatus()});old=await last('codes-status')
  await run(()=>{const v=window.twoFactorHarness.view();v.openDisable();v.disablePassword='fixture unusable';v.disableCode='123456';void v.confirmDisable()})
  await accept(await last('disable'),{message:'fixture disabled'});await accept(old,{total:8,remaining:8,used:0});assert.equal(await read('recoveryCodesStatus'),null,'old recovery count cannot refill a disabled account')
  await run(()=>{void window.twoFactorHarness.view().loadStatus()});old=await last('status')
  await run(()=>{void window.twoFactorHarness.view().loadStatus()});fresh=await last('status');await accept(fresh,{enabled:false});await accept(old,{enabled:true});assert.equal(await read('enabled'),false)
  for(const[locale,width,dark]of[['zh-CN',1440,false],['zh-TW',768,false],['en',390,true]]){
    await run(()=>{void window.twoFactorHarness.view().loadStatus()});await reject(await last('status'))
    assert.equal(await read('success'),'','new status read does not retain a previous success message')
    await run(({locale,dark})=>{const h=window.twoFactorHarness;h.setLocale(locale);h.theme.setTheme(dark?'dark':'light')},{locale,dark});await page.setViewport({width,height:900,mobile:width===390});await sleep(300)
    assert.equal(await page.eval(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:resolve(output,locale+'-'+width+'.png'),format:'png'})
  }
  assert.equal(page.consoleErrors.length,0,page.consoleErrors.join('\n'))
  console.log('PASS actual two-factor initial failure gate, strict status/count responses, latest loading/old receipts, persistent retry/zero counts and mutation count invalidation')

} finally { if(browser)await browser.close();await server.close() }
