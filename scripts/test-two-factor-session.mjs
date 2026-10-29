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
const output = resolve(root, 'logs/two-factor-session'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js')
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/two-factor/*.js']
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/two-factor', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/two-factor/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } }, server: { host: '127.0.0.1', port: 19719, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19719', { settleMs: 1400 })
  for (let attempt = 0; attempt < 200; attempt++) { if (await page.eval(() => !!window.twoFactorHarness?.pending.length)) break; if (attempt === 199) throw Error(page.consoleErrors.join('\n')); await sleep(100) }
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(80); return result }
  const last = kind => page.eval(kind => window.twoFactorHarness.pending.findLastIndex(item => item.kind === kind), kind)
  const accept = (index, data) => run(({ index, data }) => window.twoFactorHarness.pending[index].resolve(data), { index, data })
  const reject = index => run(index => window.twoFactorHarness.pending[index].reject(Error('fixture operation unavailable')), index)


  const read = key => page.eval(key=>JSON.parse(JSON.stringify(window.twoFactorHarness.view()[key])),key)
  const old = await last('status'); await run(()=>window.twoFactorHarness.session('b')); await accept(old,{enabled:true})
  assert.equal(await read('enabled'),false,'replacement session does not accept old two-factor status')

  const count = kind => page.eval(kind=>window.twoFactorHarness.pending.filter(item=>item.kind===kind).length,kind)
  const fresh = async (enabled=false) => {
    await run(()=>{const h=window.twoFactorHarness;h.auth.user={id:1,username:'fixture',role:'user'};h.session('a');h.state.active=true;void h.view().loadStatus()})
    await accept(await last('status'),{enabled});if(enabled)await accept(await last('codes-status'),{total:8,remaining:8,used:0})
  }
  const change = value => run(async value=>{const h=window.twoFactorHarness;
    if(value==='session')h.session('b');if(value==='session-aba'){h.session('b');h.session('a')}
    if(value==='account')h.auth.user={...h.auth.user,id:2};if(value==='role')h.auth.user={...h.auth.user,role:'admin'};if(value==='logout')h.session(null)
    if(value==='cache'){h.state.active=false;await new Promise(r=>setTimeout(r,0));h.state.active=true}
    if(value==='draft'){const v=h.view();v.verifyCode='654321';v.disableCode='654321';v.regenerateCode='654321'}
  },value)
  for(const kind of ['status','codes-status'])for(const value of ['session','session-aba','account','role','logout','cache'])for(const failed of [false,true]){
    await fresh(kind==='codes-status');await run(kind=>{void window.twoFactorHarness.view()[kind==='status'?'loadStatus':'loadRecoveryCodesStatus']()},kind);const old=await last(kind)
    await change(value);const status=await last('status')
    if(value!=='logout'){await accept(status,{enabled:false})}
    if(failed)await reject(old);else await accept(old,kind==='status'?{enabled:true}:{total:8,remaining:8,used:0})
    assert.equal(await read('enabled'),false,value+' does not accept stale status');assert.equal(await read('recoveryCodesStatus'),null);assert.equal(await read('statusError'),'');assert.equal(await read('recoveryStatusError'),'')
  }
  const methods={setup:'startSetup',enable:'confirmEnable',disable:'confirmDisable',regenerate:'confirmRegenerate'}
  const response=action=>action==='setup'?{secret:'fixture secret only',qrCode:'',recoveryCodes:['fixture-a','fixture-b']}:action==='regenerate'?{recoveryCodes:['fixture-a','fixture-b']}:{message:'fixture success'}
  for(const[action,method]of Object.entries(methods))for(const value of ['session','session-aba','account','role','logout','cache','draft'])for(const failed of [false,true]){
    await fresh(['disable','regenerate'].includes(action))
    await run(({action,method})=>{const v=window.twoFactorHarness.view();v.setupMode=action==='enable';v.disableMode=action==='disable';v.regenerateMode=action==='regenerate';v.verifyCode='123456';v.disableCode='123456';v.regenerateCode='123456';v.disablePassword='fixture unusable';v.regeneratePassword='fixture unusable';void v[method]()},{action,method})
    const old=await last(action),before=await count(action);await change(value)
    await run(method=>{void window.twoFactorHarness.view()[method]()},method);assert.equal(await count(action),before,'inflight old write retains global busy')
    if(failed)await reject(old);else await accept(old,response(action))
    assert.equal(await read('error'),'');assert.equal(await read('success'),'');assert.equal(await read('secret'),'');assert.equal((await read('newRecoveryCodes')).length,0);assert.equal(await read('loading'),false)
    if(value==='draft')assert.equal(await read('verifyCode'),'654321')
    else if(value!=='logout'){await accept(await last('status'),{enabled:false});assert.equal(await read('statusReady'),true)}
  }
  for(const action of ['setup','enable','disable','regenerate']){
    const method=methods[action];await fresh(['disable','regenerate'].includes(action));await run(({action,method})=>{const v=window.twoFactorHarness.view();v.setupMode=action==='enable';v.disableMode=action==='disable';v.regenerateMode=action==='regenerate';v.verifyCode='123456';v.disablePassword='fixture';v.disableCode='123456';v.regeneratePassword='fixture';v.regenerateCode='123456';void v[method]()},{action,method})
    const old=await last(action);await run(()=>window.twoFactorHarness.session('a',2));await accept(old,response(action));assert.equal(await read('loading'),false)
    if(action==='setup')assert.equal(await read('secret'),'fixture secret only');else assert.ok(await read('success'),'same sid token refresh accepts current success')
  }
  await fresh(false);await run(()=>{void window.twoFactorHarness.view().startSetup()});await accept(await last('setup'),response('setup'));assert.equal(await read('secret'),'fixture secret only')
  await change('session');assert.equal(await read('secret'),'');assert.deepEqual(await read('recoveryCodes'),[]);assert.equal(await read('setupMode'),false)
  await fresh(false);await run(()=>{const v=window.twoFactorHarness.view();v.setupMode=true;v.verifyCode='123456';void v.confirmEnable()});await accept(await last('enable'),response('enable'));assert.ok(await read('success'));await sleep(500)
  await change('session');await accept(await last('status'),{enabled:false});await run(()=>window.twoFactorHarness.view().success='replacement notice');await sleep(3200);assert.equal(await read('success'),'replacement notice','old success timer is removed across sessions')
  await fresh(false);await run(()=>{void window.twoFactorHarness.view().loadStatus()});const unmount=await last('status');await run(()=>window.twoFactorHarness.state.mounted=false);await accept(unmount,{enabled:true});assert.equal(await read('enabled'),false)
  assert.equal(page.consoleErrors.length,0,page.consoleErrors.join('\n'))
  console.log('PASS two-factor read/write session/account/role/logout/ABA/cache/draft isolation, inflight busy, same sid refresh, secret cleanup, timer cleanup and unmount')

} finally {if(browser)await browser.close();await server.close()}
