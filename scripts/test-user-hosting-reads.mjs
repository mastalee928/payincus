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
const output = resolve(root, 'logs/user-hosting-reads'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js')
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/user-dialogs/*.js']
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/user-dialogs', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api\/admin$/, replacement: root + '/scripts/fixtures/user-dialogs/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19710, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19710', { settleMs: 1400 })
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await page.eval(() => !!window.userDialogsHarness?.pending.length)) break
    if (attempt === 199) throw Error('user fixture did not mount: ' + page.consoleErrors.join('\n'))
    await sleep(150)
  }
  const run = async (fn, arg) => { const value = await page.eval(fn, arg); await sleep(70); return value }
  const last = kind => page.eval(kind => window.userDialogsHarness.pending.findLastIndex(item => item.kind === kind), kind)
  const accept = (index, data) => run(({ index, data }) => window.userDialogsHarness.pending[index].resolve(data), { index, data })
  const reject = index => run(index => window.userDialogsHarness.pending[index].reject(new Error('fixture read unavailable')), index)
  const read = key => page.eval(key => JSON.parse(JSON.stringify(window.userDialogsHarness.view()[key])), key)
  const user = id => ({ id, username: `Account ${id}`, balance: 10 * id, role: 'user', status: 'active', createdAt: '2026-10-01T00:00:00Z' })
  await accept(await last('users'), { users: [user(1), user(2)], total: 2, totalPages: 1 })
  await run(() => { void window.userDialogsHarness.view().openHostingBalanceModal(window.userDialogsHarness.view().users[0]) }); const old = await last('hosting-read')
  await run(() => { void window.userDialogsHarness.view().openHostingBalanceModal(window.userDialogsHarness.view().users[1]) })
  const res = (value,id=1) => ({ user:{id},available:value,frozen:0,logs:[],total:0,totalPages:1,page:1,pageSize:1 })
  await accept(await last('hosting-read'),res(20,2));await accept(old,res(10))
  assert.equal((await read('hostingBalanceInfo')).available,20,'old hosting balance cannot replace the current user')
  const response = (id=1,value=10,empty=false,page=1) => ({ user:{id},available:value,frozen:0,logs:empty?[]:[{id,userId:id,type:'income',actionType:'admin_adjust',amount:value,frozen:false,createdAt:'2026-10-01T00:00:00Z',description:'fixture hosting adjustment'}],total:empty?0:150,totalPages:3,page,pageSize:50 })
  const open = async (tab='overview',id=1) => run(({tab,id})=>{const h=window.userDialogsHarness,v=h.view();h.auth.user={id:1,role:'admin',username:'fixture'};h.session('a');v.activeTab='users';v.showHostingBalanceModal=false;void v.openHostingBalanceModal(v.users[id-1]);if(tab!=='overview')v.switchHostingBalanceTab(tab)},{tab,id})
  for(const tab of ['overview','logs','adjust']) {
    const load=tab==='logs'?'loadHostingBalanceLogs':'loadHostingBalanceInfo',error=tab==='logs'?'hostingBalanceLogsError':'hostingBalanceInfoError',loading=tab==='logs'?'hostingBalanceLogsLoading':'hostingBalanceInfoLoading'
    await open(tab);let old=await last('hosting-read');await open(tab,2);await accept(await last('hosting-read'),response(2,20));await accept(old,response(1,10));assert.equal((await read('hostingBalanceInfo')).available,20)
    for(const change of ['target-aba','session','session-aba','account','role','logout','close','tab','cache','page']) {
      await open(tab);old=await last('hosting-read')
      await run(async change=>{const h=window.userDialogsHarness,v=h.view();if(change==='target-aba'){v.hostingBalanceUser=v.users[1];v.hostingBalanceUser=v.users[0]};if(change==='session')h.session('b');if(change==='session-aba'){h.session('b');h.session('a')};if(change==='account')h.auth.user={...h.auth.user,id:2};if(change==='role')h.auth.user={...h.auth.user,role:'user'};if(change==='logout')h.session(null);if(change==='close'){v.showHostingBalanceModal=false;v.showHostingBalanceModal=true};if(change==='tab')v.hostingBalanceTab=v.hostingBalanceTab==='logs'?'overview':'logs';if(change==='page'){if(v.hostingBalanceTab==='logs')v.hostingBalanceLogsPage=2;else v.activeTab='invites'};if(change==='cache'){await h.router.push('/other');await h.router.push('/admin/users')}},change)
      const toasts=await page.eval(()=>window.userDialogsHarness.toasts.length);await reject(old);assert.equal(await read(error),'');assert.equal(await page.eval(()=>window.userDialogsHarness.toasts.length),toasts)
    }
    await open(tab);old=await last('hosting-read');await run(load=>{void window.userDialogsHarness.view()[load]()},load);const fresh=await last('hosting-read');await reject(old);assert.equal(await read(loading),true);await reject(fresh);assert.match(await read(error),/fixture read unavailable/)
    await run(load=>{void window.userDialogsHarness.view()[load]()},load);await accept(await last('hosting-read'),response(1,0,true));assert.equal(await read(error),'');assert.equal((await read('hostingBalanceInfo')).available,0)
    await open(tab);await accept(await last('hosting-read'),{...response(1,-1),logs:[{...response().logs[0],type:'deduction',actionType:'destroy',amount:-1}]});assert.equal(await read(error),'');assert.equal((await read('hostingBalanceInfo')).available,-1,'hosting debt and signed deduction logs remain valid')
    for(const bad of [{},response(2,10),{...response(),available:'10'},{...response(),frozen:-1},...(tab==='logs'?[{...response(),pageSize:0},{...response(),logs:[{id:1,amount:'10',frozen:false}]}]:[])]){
      await open(tab);await accept(await last('hosting-read'),bad);assert.ok(await read(error),'invalid hosting receipt stays error')
    }
    await open(tab);await run(()=>window.userDialogsHarness.session('a',2));await accept(await last('hosting-read'),response());assert.equal(await read(loading),false);assert.equal(await read(error),'')
    if(tab==='logs'){
      await open(tab);await accept(await last('hosting-read'),response());await run(()=>window.userDialogsHarness.view().changeHostingBalanceLogsPage(2));await accept(await last('hosting-read'),response(1,20,false,2));assert.equal(await read('hostingBalanceLogsPage'),2);assert.equal((await read('hostingBalanceLogs'))[0].amount,20)
    }
    for(const[locale,width,dark,mobile]of[['zh-CN',1440,false,false],['zh-TW',768,false,false],['en',390,true,true]]){
      await open(tab);await reject(await last('hosting-read'));await run(({locale,dark})=>{const h=window.userDialogsHarness;h.setLocale(locale);h.theme.setTheme(dark?'dark':'light')},{locale,dark});await page.setViewport({width,height:1000,mobile});await sleep(300)
      assert.equal(await page.eval(()=>document.documentElement.scrollWidth<=innerWidth),true)
      assert.equal(await page.eval(()=>[...document.querySelectorAll('[data-user-dialog="hosting"] button')].every(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth})),true,'hosting tabs and retry actions fit phone')
      await page.screenshot({path:resolve(output,`${tab}-${locale}-${width}.png`),format:'png'})
    }
  }
  await open();const pending=await last('hosting-read');await run(()=>{window.userDialogsHarness.state.mounted=false});await accept(pending,response());assert.equal(page.consoleErrors.length,0,page.consoleErrors.join('\n'))
  console.log('PASS hosting overview/logs/adjust reads current target/session/ABA/cache/page/tab, latest loading, errors/retry, strict receipts/zero and mobile tabs')
} finally { if (browser) await browser.close(); await server.close() }
