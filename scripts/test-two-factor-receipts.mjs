import { recoveryCodes, qrCode } from './fixtures/two-factor/responses.mjs'
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
const output = resolve(root, 'logs/two-factor-receipts'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js')
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/two-factor/*.js']
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/two-factor', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/two-factor/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } }, server: { host: '127.0.0.1', port: 19720, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19720', { settleMs: 1400 })
  for (let attempt = 0; attempt < 200; attempt++) { if (await page.eval(() => !!window.twoFactorHarness?.pending.length)) break; if (attempt === 199) throw Error(page.consoleErrors.join('\n')); await sleep(100) }
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(80); return result }
  const last = kind => page.eval(kind => window.twoFactorHarness.pending.findLastIndex(item => item.kind === kind), kind)
  const accept = (index, data) => run(({ index, data }) => window.twoFactorHarness.pending[index].resolve(data), { index, data })
  const reject = index => run(index => window.twoFactorHarness.pending[index].reject(Error('fixture operation unavailable')), index)

  await accept(await last('status'),{enabled:false})
  await run(()=>{const v=window.twoFactorHarness.view();v.setupMode=true;v.verifyCode='abcdef';void v.confirmEnable()})
  assert.equal(await page.eval(()=>window.twoFactorHarness.pending.filter(x=>x.kind==='enable').length),0,'non-digit six-character verification code never submits')

  const read=key=>page.eval(key=>JSON.parse(JSON.stringify(window.twoFactorHarness.view()[key])),key)
  const methods={enable:'confirmEnable',disable:'confirmDisable',regenerate:'confirmRegenerate'}
  for(const[action,method]of Object.entries(methods))for(const code of ['','12345','1234567','abcdef','12345x',' 12345','１２３４５６']){
    await run(({action,method,code})=>{const v=window.twoFactorHarness.view();v.setupMode=action==='enable';v.disableMode=action==='disable';v.regenerateMode=action==='regenerate';v.disablePassword='fixture';v.regeneratePassword='fixture';v.verifyCode=code;v.disableCode=code;v.regenerateCode=code;void v[method]()},{action,method,code})
    assert.equal(await page.eval(action=>window.twoFactorHarness.pending.filter(x=>x.kind===action).length,action),0,'invalid TOTP cannot submit '+action)
  }
  for(const bad of [{},{secret:'fixture',qrCode,recoveryCodes:[]},{secret:' ',qrCode,recoveryCodes},{secret:'fixture',qrCode:'https://invalid.example/qr',recoveryCodes},{secret:'fixture',qrCode,recoveryCodes:Array(8).fill('TEST-0000')}]){
    await run(()=>{const v=window.twoFactorHarness.view();v.setupMode=false;v.disableMode=false;v.regenerateMode=false;void v.startSetup()});await accept(await last('setup'),bad)
    assert.ok(await read('error'));assert.equal(await read('setupMode'),false);assert.equal(await read('secret'),'')
  }
  await run(()=>{void window.twoFactorHarness.view().startSetup()});await accept(await last('setup'),{secret:'fixture display only',qrCode,recoveryCodes});assert.equal(await read('setupMode'),true)
  for(const[action,method]of Object.entries(methods)){
    const invalid=action==='regenerate'?[{}, {recoveryCodes:[]},{recoveryCodes:Array(8).fill('TEST-0000')},{recoveryCodes:Array(8).fill(123)}]:[{}, {message:null},{message:''},{message:' '}]
    for(const bad of invalid){
      await run(({action,method})=>{const v=window.twoFactorHarness.view();v.enabled=action!=='enable';v.setupMode=action==='enable';v.disableMode=action==='disable';v.regenerateMode=action==='regenerate';v.verifyCode='123456';v.disableCode='123456';v.regenerateCode='123456';v.disablePassword='fixture';v.regeneratePassword='fixture';void v[method]()},{action,method})
      await accept(await last(action),bad);assert.ok(await read('error'));assert.equal(await read('success'),'');assert.equal(await read('loading'),false)
      assert.equal(await read(action==='enable'?'setupMode':action==='disable'?'disableMode':'regenerateMode'),true)
    }
    await run(({action,method})=>{const v=window.twoFactorHarness.view();v.verifyCode='123456';v.disableCode='123456';v.regenerateCode='123456';v.disablePassword='fixture';v.regeneratePassword='fixture';void v[method]()},{action,method})
    await accept(await last(action),action==='regenerate'?{recoveryCodes}:{message:'fixture success'});assert.ok(await read('success'));assert.equal(await read('loading'),false)
    if(action==='regenerate'){assert.equal(await read('regeneratePassword'),'');assert.equal(await read('regenerateCode'),'');await reject(await last('codes-status'));assert.ok(await read('success'),'count failure does not reclassify successful regeneration')}
  }
  assert.equal(page.consoleErrors.length,0,page.consoleErrors.join('\n'))
  console.log('PASS strict TOTP inputs, setup QR/secret/recovery codes, enable/disable receipts, regenerated code integrity, error retry and auxiliary count failure')

} finally {if(browser)await browser.close();await server.close()}
