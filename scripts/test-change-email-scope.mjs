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
const output = resolve(root, 'logs/change-email-scope'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
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
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(80); return result }
  const last = kind => page.eval(kind => window.emailHarness.pending.findLastIndex(item => item.kind === kind), kind)
  const accept = (index, data) => run(({ index, data }) => window.emailHarness.pending[index].resolve(data), { index, data })
  const reject = index => run(index => window.emailHarness.pending[index].reject(Error('fixture operation unavailable')), index)

  await run(()=>{const v=window.emailHarness.view();v.step='verifyNew';v.newEmail='first@example.test';void v.sendNewEmailCode()})
  const old=await last('new-send');await run(()=>window.emailHarness.view().newEmail='replacement@example.test');await accept(old,{message:'fixture sent'})
  assert.equal(await page.eval(()=>window.emailHarness.view().newCodeSent),false,'old email send response cannot mark replacement email verified/sent')

  const read = key => page.eval(key=>JSON.parse(JSON.stringify(window.emailHarness.view()[key])),key)
  const count = kind => page.eval(kind=>window.emailHarness.pending.filter(x=>x.kind===kind).length,kind)
  const methods={'current-send':'sendCurrentCode','current-verify':'verifyCurrentCode','new-send':'sendNewEmailCode',update:'submitEmailChange'}
  const prepare = action => run(action=>{const h=window.emailHarness,v=h.view();h.auth.user={id:1,username:'fixture',role:'user',email:'original@example.test'};h.session('a');h.state.show=false;h.state.show=true;v.step=action.startsWith('current')?'verifyCurrent':'verifyNew';v.currentEmailCode='123456';v.newEmail='first@example.test';v.newEmailCode='123456'},action)
  const response = action => action==='current-send'?{maskedTarget:'or***@example.test',message:'fixture sent'}:action==='current-verify'?{verified:true,message:'fixture verified'}:{message:'fixture success',expiresAt:'2099-01-01T00:00:00Z'}
  for(const[action,method]of Object.entries(methods)){
    await prepare(action);await run(method=>{void window.emailHarness.view()[method]()},method);const old=await last(action),before=await page.eval(()=>window.emailHarness.pending.length)
    await run(()=>{const v=window.emailHarness.view();void v.sendCurrentCode();void v.verifyCurrentCode();void v.sendNewEmailCode();void v.submitEmailChange();v.closeModal()})
    assert.equal(await page.eval(()=>window.emailHarness.pending.length),before,'all email operations share immediate busy');assert.equal(await page.eval(()=>window.emailHarness.state.closes),0)
    assert.equal(await page.eval(()=>[...document.querySelectorAll('.modal-content input')].every(el=>el.matches(':disabled'))),true)
    await reject(old);assert.equal(await read('busy'),false);assert.ok(await read(action.startsWith('current')?'currentStepError':'newStepError'))
    await run(method=>{void window.emailHarness.view()[method]()},method);await accept(await last(action),response(action));assert.equal(await read('busy'),false)
    if(action==='update'){assert.equal(await page.eval(()=>window.emailHarness.auth.user.email),'first@example.test');assert.equal(await page.eval(()=>window.emailHarness.state.updates.at(-1)),'first@example.test')}
  }
  const change = value => run(async value=>{const h=window.emailHarness,v=h.view();
    if(value==='email')v.newEmail='replacement@example.test';if(value==='email-aba'){v.newEmail='replacement@example.test';v.newEmail='first@example.test'}
    if(value==='session')h.session('b');if(value==='session-aba'){h.session('b');h.session('a')};if(value==='account')h.auth.user={...h.auth.user,id:2,email:'other@example.test'}
    if(value==='role')h.auth.user={...h.auth.user,role:'admin'};if(value==='logout')h.session(null);if(value==='close'){h.state.show=false;await new Promise(resolve=>setTimeout(resolve,0));h.state.show=true}
    if(value==='step')v.step=v.step==='verifyNew'?'verifyCurrent':'verifyNew';if(value==='code'){v.currentEmailCode='654321';v.newEmailCode='654321'}
  },value)
  for(const[action,method]of Object.entries(methods))for(const value of ['email','email-aba','session','session-aba','account','role','logout','close','step','code'])for(const failed of [false,true]){
    await prepare(action);await run(method=>{void window.emailHarness.view()[method]()},method);const old=await last(action);await change(value)
    const before=await page.eval(()=>({toasts:window.emailHarness.toasts.length,updates:window.emailHarness.state.updates.length,closes:window.emailHarness.state.closes,email:window.emailHarness.auth.user.email}))
    const requests=await page.eval(()=>window.emailHarness.pending.length);await run(method=>{void window.emailHarness.view()[method]()},method);assert.equal(await page.eval(()=>window.emailHarness.pending.length),requests,'old pending write still blocks replacement')
    if(failed)await reject(old);else await accept(old,response(action))
    assert.deepEqual(await page.eval(()=>({toasts:window.emailHarness.toasts.length,updates:window.emailHarness.state.updates.length,closes:window.emailHarness.state.closes,email:window.emailHarness.auth.user.email})),before,action+'/'+value+' stale receipt stays quiet')
    assert.equal(await read('currentStepError'),'');assert.equal(await read('newStepError'),'');assert.equal(await read('busy'),false);assert.equal(await read('currentCountdown'),0);assert.equal(await read('newCountdown'),0)
    if(value==='email')assert.equal(await read('newEmail'),'replacement@example.test')
  }
  for(const[action,method]of Object.entries(methods)){
    await prepare(action);await run(method=>{void window.emailHarness.view()[method]()},method);const old=await last(action);await run(()=>window.emailHarness.session('a',2));await accept(old,response(action));assert.equal(await read('busy'),false)
    assert.equal(await read(action==='current-send'?'currentCodeSent':action==='new-send'?'newCodeSent':'newStepError'),action.endsWith('send')?true:'')
  }
  for(const[locale,width,dark]of[['zh-CN',1440,false],['zh-TW',768,false],['en',390,true]]){
    await prepare('new-send');await run(()=>{void window.emailHarness.view().sendNewEmailCode()});await reject(await last('new-send'))
    await run(({locale,dark})=>{const h=window.emailHarness;h.setLocale(locale);h.theme.setTheme(dark?'dark':'light')},{locale,dark});await page.setViewport({width,height:1000,mobile:width===390});await sleep(300)
    assert.equal(await page.eval(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:resolve(output,locale+'-'+width+'.png'),format:'png'})
  }
  await prepare('new-send');await run(()=>{void window.emailHarness.view().sendNewEmailCode()});const unmount=await last('new-send');await run(()=>window.emailHarness.state.mounted=false);await accept(unmount,response('new-send'));assert.equal(await read('newCodeSent'),false);assert.equal(await read('newCountdown'),0)
  assert.equal(page.consoleErrors.length,0,page.consoleErrors.join('\n'))
  console.log('PASS actual email fixed target/session/draft/ABA receipts, four operation busy/fields/close gates, stale errors/timers, same sid refresh, success target and unmount')

} finally {if(browser)await browser.close();await server.close()}
