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
const output = resolve(root, 'logs/user-hosting-submit'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js')
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/user-dialogs/*.js']
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/user-dialogs', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api\/admin$/, replacement: root + '/scripts/fixtures/user-dialogs/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19711, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19711', { settleMs: 1400 })
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
  await run(() => {const v=window.userDialogsHarness.view();void v.openHostingBalanceModal(v.users[0]);v.switchHostingBalanceTab('adjust');v.adjustHostingBalanceForm={type:'available',operation:'add',amount:'10',reason:'fixture hosting adjustment'};void v.submitAdjustHostingBalance()})
  const old=await last('hosting-adjust');await run(()=>window.userDialogsHarness.session('b'));const before=await page.eval(()=>({toasts:window.userDialogsHarness.toasts.length,requests:window.userDialogsHarness.pending.length}))
  await accept(old,{success:true,available:20,frozen:0});assert.deepEqual(await page.eval(()=>({toasts:window.userDialogsHarness.toasts.length,requests:window.userDialogsHarness.pending.length})),before,'old hosting write must stay quiet in replacement session')
  const count = kind => page.eval(kind => window.userDialogsHarness.pending.filter(item => item.kind === kind).length, kind)
  const open = async () => run(() => {
    const h = window.userDialogsHarness, v = h.view()
    h.auth.user = { id: 1, role: 'admin', username: 'fixture' }; h.session('a'); v.activeTab = 'users'
    v.showHostingBalanceModal = false; void v.openHostingBalanceModal(v.users[0]); v.switchHostingBalanceTab('adjust')
    v.adjustHostingBalanceForm = { type: 'available', operation: 'add', amount: '10', reason: ' fixture hosting ' }
  })
  const start = async () => { await open(); await run(() => { void window.userDialogsHarness.view().submitAdjustHostingBalance() }); return last('hosting-adjust') }
  let pending = await start(), writes = await count('hosting-adjust')
  await run(() => { const v = window.userDialogsHarness.view(); void v.submitAdjustHostingBalance(); v.closeHostingBalanceModal(); v.switchHostingBalanceTab('logs'); void v.openHostingBalanceModal(v.users[1]) })
  assert.equal(await count('hosting-adjust'), writes)
  assert.equal(await read('showHostingBalanceModal'), true); assert.equal(await read('hostingBalanceTab'), 'adjust'); assert.equal((await read('hostingBalanceUser')).id, 1)
  assert.equal(await page.eval(() => [...document.querySelectorAll('[data-user-dialog="hosting"] input,[data-user-dialog="hosting"] textarea')].every(el => el.matches(':disabled'))), true)
  assert.deepEqual(await page.eval(i => window.userDialogsHarness.pending[i].data, pending), { id: 1, type: 'available', amount: 10, reason: 'fixture hosting' })
  await reject(pending); assert.match(await read('adjustHostingBalanceError'), /fixture read unavailable/)
  assert.equal((await read('adjustHostingBalanceForm')).amount, '10'); assert.equal(await read('adjustHostingBalanceLoading'), false)
  await run(() => { void window.userDialogsHarness.view().submitAdjustHostingBalance() })
  await accept(await last('hosting-adjust'), { success: true, available: 20, frozen: 0 })
  assert.equal(await read('hostingBalanceTab'), 'overview'); assert.equal((await read('hostingBalanceInfo')).available, 20); assert.equal((await read('adjustHostingBalanceForm')).amount, '')
  await reject(await last('users')); assert.equal(await read('adjustHostingBalanceError'), '', 'confirmed success is not reclassified by list failure')
  for (const change of ['target', 'target-aba', 'session', 'session-aba', 'account', 'role', 'logout', 'close', 'tab', 'draft', 'cache']) for (const failed of [false, true]) {
    pending = await start()
    await run(async change => {
      const h = window.userDialogsHarness, v = h.view()
      if (change === 'target') v.hostingBalanceUser = v.users[1]
      if (change === 'target-aba') { v.hostingBalanceUser = v.users[1]; v.hostingBalanceUser = v.users[0] }
      if (change === 'session') h.session('b')
      if (change === 'session-aba') { h.session('b'); h.session('a') }
      if (change === 'account') h.auth.user = { ...h.auth.user, id: 2 }
      if (change === 'role') h.auth.user = { ...h.auth.user, role: 'user' }
      if (change === 'logout') h.session(null)
      if (change === 'close') { v.showHostingBalanceModal = false; v.showHostingBalanceModal = true }
      if (change === 'tab') v.hostingBalanceTab = 'logs'
      if (change === 'draft') { v.adjustHostingBalanceForm.amount = '20'; v.adjustHostingBalanceForm.reason = 'replacement' }
      if (change === 'cache') { await h.router.push('/other'); await h.router.push('/admin/users') }
    }, change)
    const before = await page.eval(() => ({ toasts: window.userDialogsHarness.toasts.length, requests: window.userDialogsHarness.pending.length }))
    if (failed) await reject(pending); else await accept(pending, { success: true, available: 20, frozen: 0 })
    assert.deepEqual(await page.eval(() => ({ toasts: window.userDialogsHarness.toasts.length, requests: window.userDialogsHarness.pending.length })), before, `${change}/${failed} stale write stays quiet`)
    assert.equal(await read('adjustHostingBalanceError'), ''); assert.equal(await read('adjustHostingBalanceLoading'), false)
    if (change === 'draft') assert.equal((await read('adjustHostingBalanceForm')).amount, '20')
  }
  await open()
  for (const amount of ['', 0, '0', '-1', '10abc', 'Infinity', 'NaN', '1e2', '0x10', '0.001', '1.234', '100000000', null, false, [], {}]) {
    writes = await count('hosting-adjust')
    await run(amount => { const v = window.userDialogsHarness.view(); v.adjustHostingBalanceForm.amount = amount; void v.submitAdjustHostingBalance() }, amount)
    assert.equal(await read('canAdjustHostingBalance'), false); assert.equal(await count('hosting-adjust'), writes)
  }
  for (const change of [{ type: 'invalid' }, { operation: 'invalid' }, { reason: ' ' }, { reason: 'x'.repeat(201) }]) {
    await open(); writes = await count('hosting-adjust')
    await run(change => { const v = window.userDialogsHarness.view(); Object.assign(v.adjustHostingBalanceForm, change); void v.submitAdjustHostingBalance() }, change)
    assert.equal(await count('hosting-adjust'), writes)
  }
  for (const type of ['available', 'frozen']) for (const operation of ['add', 'deduct']) for (const amount of ['.01', '99999999.99', 0.29]) {
    await open()
    await run(({ type, operation, amount }) => { const v = window.userDialogsHarness.view(); Object.assign(v.adjustHostingBalanceForm, { type, operation, amount }); void v.submitAdjustHostingBalance() }, { type, operation, amount })
    pending = await last('hosting-adjust')
    assert.equal(await page.eval(i => window.userDialogsHarness.pending[i].data.amount, pending), (operation === 'add' ? 1 : -1) * Number(amount))
    await accept(pending, { success: true, available: 0, frozen: 0 }); assert.equal(await read('hostingBalanceTab'), 'overview'); assert.deepEqual(await read('hostingBalanceInfo'), { available: 0, frozen: 0 })
  }
  pending = await start(); await accept(pending, { success: true, available: -1, frozen: 0 }); assert.equal(await read('hostingBalanceTab'), 'overview'); assert.equal((await read('hostingBalanceInfo')).available, -1, 'existing hosting debt is a valid committed balance')
  for (const bad of [{}, { success: false, available: 20, frozen: 0 }, { success: true, available: '20', frozen: 0 }, { success: true, available: null, frozen: 0 }, { success: true, available: 20, frozen: -1 }]) {
    pending = await start(); await accept(pending, bad)
    assert.ok(await read('adjustHostingBalanceError')); assert.equal(await read('hostingBalanceTab'), 'adjust'); assert.equal((await read('adjustHostingBalanceForm')).amount, '10')
  }
  pending = await start(); await run(() => window.userDialogsHarness.session('a', 2)); await accept(pending, { success: true, available: 20, frozen: 0 }); assert.equal(await read('hostingBalanceTab'), 'overview')
  const oldList = await last('users'); await open(); await accept(oldList, { users: [user(2)], total: 1, totalPages: 1 }); assert.equal((await read('users')).length, 2)
  pending = await start(); const oldInfo = await last('hosting-read'); await accept(pending, { success: true, available: 20, frozen: 0 })
  await accept(oldInfo, { user: { id: 1 }, available: 10, frozen: 0, logs: [], total: 0, page: 1, pageSize: 1 }); assert.equal((await read('hostingBalanceInfo')).available, 20, 'pre-write read cannot replace committed balance')
  for (const [locale, width, dark, mobile] of [['zh-CN', 1440, false, false], ['zh-TW', 768, false, false], ['en', 390, true, true]]) {
    pending = await start(); await reject(pending)
    await run(({ locale, dark }) => { const h = window.userDialogsHarness; h.setLocale(locale); h.theme.setTheme(dark ? 'dark' : 'light') }, { locale, dark })
    await page.setViewport({ width, height: 1000, mobile }); await sleep(300)
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: resolve(output, `hosting-${locale}-${width}.png`), format: 'png' })
  }
  pending = await start(); const toasts = await page.eval(() => window.userDialogsHarness.toasts.length)
  await run(() => { window.userDialogsHarness.state.mounted = false }); await accept(pending, { success: true, available: 20, frozen: 0 }); assert.equal(await page.eval(() => window.userDialogsHarness.toasts.length), toasts)
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log('PASS hosting writes fixed inputs/target, strict decimals/type/reason, busy/fields/close, stale session/ABA/cache/draft receipts, confirmed zero, error retry and auxiliary read isolation')
} finally {if(browser)await browser.close();await server.close()}
