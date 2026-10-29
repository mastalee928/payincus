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
const output = resolve(root, 'logs/change-email-receipts'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js')
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/change-email/*.js']
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/change-email', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/change-email/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } }, server: { host: '127.0.0.1', port: 19721, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19721', { settleMs: 1400 })
  for (let attempt = 0; attempt < 200; attempt++) { if (await page.eval(() => !!window.emailHarness?.view())) break; if (attempt === 199) throw Error(page.consoleErrors.join('\n')); await sleep(100) }
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(60); return result }
  const last = kind => page.eval(kind => window.emailHarness.pending.findLastIndex(item => item.kind === kind), kind)
  const accept = (index, data) => run(({ index, data }) => window.emailHarness.pending[index].resolve(data), { index, data })
  const read = key => page.eval(key => JSON.parse(JSON.stringify(window.emailHarness.view()[key])), key)
  const methods = { 'current-send': 'sendCurrentCode', 'current-verify': 'verifyCurrentCode', 'new-send': 'sendNewEmailCode', update: 'submitEmailChange' }
  const prepare = action => run(action => { const h=window.emailHarness,v=h.view();h.auth.user={id:1,username:'fixture',role:'user',email:'original@example.test'};h.session('a');v.resetState();v.step=action.startsWith('current')?'verifyCurrent':'verifyNew';v.newEmail='first@example.test';v.currentEmailCode='123456';v.newEmailCode='123456' },action)
  const start = method => run(method => { void window.emailHarness.view()[method]() },method)
  const valid = action => action==='current-send'?{success:true,required:true,channel:'email',maskedTarget:'or***@example.test',expiresIn:600}:action==='current-verify'?{success:true,verified:true,message:'Verification successful'}:action==='new-send'?{message:'Verification code sent',expiresAt:new Date(Date.now()+600000).toISOString()}:{message:'User info updated',reauthRequired:false}

  await prepare('current-verify');await run(()=>{const v=window.emailHarness.view();v.currentEmailCode='abcdef';void v.verifyCurrentCode()})
  assert.equal(await last('current-verify'),-1,'non-digit current verification code never submits')
  for(const[action,method]of Object.entries(methods).filter(([action])=>['current-verify','update'].includes(action)))for(const code of ['', '12345', '1234567', 'abcdef', '12345x', ' 12345', '123456 ', '１２３４５６']){
    await prepare(action);const before=await page.eval(()=>window.emailHarness.pending.length)
    await run(({action,method,code})=>{const v=window.emailHarness.view();v[action==='update'?'newEmailCode':'currentEmailCode']=code;void v[method]()},{action,method,code})
    assert.equal(await page.eval(()=>window.emailHarness.pending.length),before,action+' rejects invalid code');assert.ok(await read(action==='update'?'newStepError':'currentStepError'))
    assert.equal(await page.eval(()=>document.querySelector('.modal-footer .btn-primary').disabled),true)
  }
  const badReceipts = {
    'current-send': [null, {}, {success:false,channel:'email',maskedTarget:'or***@example.test',expiresIn:600}, {success:true,channel:'telegram',maskedTarget:'fixture',expiresIn:600}, {success:true,channel:'email',maskedTarget:' ',expiresIn:600}, {success:true,required:false,channel:'email',maskedTarget:'or***@example.test',expiresIn:600}, {success:true,channel:'email',maskedTarget:'or***@example.test',expiresIn:'600'}, {success:true,channel:'email',maskedTarget:'or***@example.test',expiresIn:0}],
    'current-verify': [null, {}, {success:true,verified:false,message:'fixture'}, {success:false,verified:true,message:'fixture'}, {success:true,verified:true,message:' '}],
    'new-send': [null, {}, {message:' ',expiresAt:new Date(Date.now()+600000).toISOString()}, {message:'fixture',expiresAt:'invalid date'}, {message:'fixture',expiresAt:'2000-01-01T00:00:00Z'}],
    update: [null, {}, {message:' '}, {message:'fixture',reauthRequired:'false'}, {message:'fixture',reauthRequired:true}],
  }
  for(const[action,method]of Object.entries(methods)){
    for(const bad of badReceipts[action]){
      await prepare(action);const before=await page.eval(()=>({toasts:window.emailHarness.toasts.length,updates:window.emailHarness.state.updates.length,closes:window.emailHarness.state.closes,email:window.emailHarness.auth.user.email}))
      await start(method);await accept(await last(action),bad);assert.ok(await read(action.startsWith('current')?'currentStepError':'newStepError'));assert.equal(await read('busy'),false)
      assert.deepEqual(await page.eval(()=>({toasts:window.emailHarness.toasts.length,updates:window.emailHarness.state.updates.length,closes:window.emailHarness.state.closes,email:window.emailHarness.auth.user.email})),before,action+' invalid receipt never claims success')
      assert.equal(await read('step'),action.startsWith('current')?'verifyCurrent':'verifyNew');assert.equal(await read('currentCountdown'),0);assert.equal(await read('newCountdown'),0)
    }
    await start(method);await accept(await last(action),valid(action));assert.equal(await read(action.startsWith('current')?'currentStepError':'newStepError'),'');assert.equal(await read('busy'),false)
    if(action==='update'){assert.equal(await page.eval(()=>window.emailHarness.auth.user.email),'first@example.test');assert.equal(await page.eval(()=>window.emailHarness.state.updates.at(-1)),'first@example.test')}
  }
  await prepare('current-send');await start(methods['current-send']);await accept(await last('current-send'),{success:true,channel:'email',maskedTarget:'or***@example.test',expiresIn:1});assert.ok(await read('currentCountdown')<=1);await sleep(1100);await start(methods['current-send']);await accept(await last('current-send'),valid('current-send'));assert.equal(await read('currentCodeSent'),true)
  for(const action of ['new-send','update']){
    await prepare(action);await run(()=>{const v=window.emailHarness.view();v.currentCodeSent=true;v.currentTarget='or***@example.test';v.newCodeSent=true;v.startCurrentCountdown(120);v.startNewCountdown(60)})
    // Allow the send action after its prior cooldown, retaining the new sent marker.
    if(action==='new-send')await run(()=>window.emailHarness.view().clearNewCountdown())
    await start(methods[action]);await run(index=>window.emailHarness.pending[index].reject({code:'VERIFICATION_REQUIRED'}),await last(action))
    assert.equal(await read('step'),'verifyCurrent');assert.ok(await read('currentStepError'));assert.equal(await read('newEmail'),'first@example.test')
    for(const key of ['currentTarget','currentEmailCode','newEmailCode','newStepError'])assert.equal(await read(key),'',key+' cleared after grant expiry')
    for(const key of ['currentCodeSent','newCodeSent'])assert.equal(await read(key),false)
    for(const key of ['currentCountdown','newCountdown'])assert.equal(await read(key),0)
    await run(()=>{const v=window.emailHarness.view();v.currentEmailCode='012345';void v.verifyCurrentCode()});await accept(await last('current-verify'),valid('current-verify'));assert.equal(await read('step'),'verifyNew');assert.equal(await read('newCodeSent'),false)
  }
  await prepare('new-send');await run(()=>{const h=window.emailHarness;h.auth.user={...h.auth.user,email:null};h.view().newEmail='first@example.test'});await start(methods['new-send']);await run(index=>window.emailHarness.pending[index].reject({code:'VERIFICATION_REQUIRED'}),await last('new-send'));assert.equal(await read('step'),'verifyNew');assert.ok(await read('newStepError'),'bind-email grant failure is visible')
  for(const[locale,width,dark]of[['zh-CN',1440,false],['zh-TW',768,false],['en',390,true]]){
    await run(({locale,dark})=>{const h=window.emailHarness;h.setLocale(locale);h.theme.setTheme(dark?'dark':'light')},{locale,dark})
    await prepare('new-send');await start(methods['new-send']);await accept(await last('new-send'),{})
    await page.setViewport({width,height:1000,mobile:width===390});await sleep(300)
    assert.equal(await page.eval(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:resolve(output,locale+'-'+width+'.png'),format:'png'})
  }
  assert.equal(page.consoleErrors.length,0,page.consoleErrors.join('\n'))
  console.log('PASS actual email strict numeric codes, all four real API receipt contracts, invalid receipt retry, resend expiry and verification-expired draft/timer cleanup')
} finally {if(browser)await browser.close();await server.close()}
