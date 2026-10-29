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
const output = resolve(root, 'logs/user-balance-submit'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js')
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/user-dialogs/*.js']
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/user-dialogs', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api\/admin$/, replacement: root + '/scripts/fixtures/user-dialogs/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19708, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19708', { settleMs: 1400 })
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
  const response = (kind, id = 1, value = 10) => kind === 'balance' ? { userId: id, username: `Account ${id}`, balance: value, totalRecharge: 0, totalConsume: 0, totalRefund: 0 } :
    { [kind === 'logs' ? 'logs' : 'records']: [{ id, userId: id, ip: `192.0.2.${id}`, amount: value, balanceBefore: 0, balanceAfter: value, type: 'recharge', status: 'completed', orderNo: `fixture-${id}`, createdAt: '2026-10-01T00:00:00Z' }], total: 150, totalPages: 3, page: 1, pageSize: 50 }
  await accept(await last('users'), { users: [user(1), user(2)], total: 2, totalPages: 1 })
  await run(() => { const v = window.userDialogsHarness.view(); void v.openBalanceModal(v.users[0]); v.switchBalanceTab('adjust'); v.adjustBalanceForm = { type: 'add', amount: '10', reason: 'fixture adjustment' }; void v.submitAdjustBalance() })
  const old = await last('adjust')
  await run(() => window.userDialogsHarness.session('b'))
  const toasts = await page.eval(() => window.userDialogsHarness.toasts.length)
  const requests = await page.eval(() => window.userDialogsHarness.pending.length)
  await accept(old, { newBalance: 20, balanceLog: { id: 1, type: 'admin_adjust', amount: 10, balanceBefore: 10, balanceAfter: 20 } })
  assert.equal(await page.eval(() => window.userDialogsHarness.toasts.length), toasts, 'old balance write cannot notify the replacement session')
  assert.equal(await page.eval(() => window.userDialogsHarness.pending.length), requests, 'old balance write cannot refresh the replacement session')
  const count = kind => page.eval(kind => window.userDialogsHarness.pending.filter(item => item.kind === kind).length, kind)
  const userList = { users: [user(1), user(2)], total: 2, totalPages: 1 }
  const receipt = (amount = 10, before = 10) => ({ newBalance: before + amount, balanceLog: { id: 1, type: 'admin_adjust', amount, balanceBefore: before, balanceAfter: before + amount } })
  const open = async () => {
    await run(() => { const h = window.userDialogsHarness, v = h.view(); h.auth.user = { id: 1, username: 'fixture', role: 'admin' }; h.session('a'); v.activeTab = 'users'; v.showBalanceModal = false; void v.openBalanceModal(v.users[0]); v.switchBalanceTab('adjust'); v.adjustBalanceForm = { type: 'add', amount: '10', reason: ' fixture adjustment ' } })
  }
  const start = async () => { await open(); await run(() => { void window.userDialogsHarness.view().submitAdjustBalance() }); return last('adjust') }
  let pending = await start(), writes = await count('adjust')
  await run(() => { const v = window.userDialogsHarness.view(); void v.submitAdjustBalance(); v.closeBalanceModal(); v.switchBalanceTab('logs'); void v.openBalanceModal(v.users[1]) })
  assert.equal(await count('adjust'), writes, 'immediate duplicate only sends one request')
  assert.equal(await read('showBalanceModal'), true); assert.equal(await read('balanceTab'), 'adjust'); assert.equal((await read('balanceUser')).id, 1)
  assert.equal(await page.eval(() => [...document.querySelectorAll('[data-user-dialog="balance"] input, [data-user-dialog="balance"] textarea')].every(el => el.matches(':disabled'))), true, 'busy fields are actually disabled')
  assert.equal(await page.eval(() => [...document.querySelectorAll('[data-user-dialog="balance"] button')].every(el => el.disabled)), true, 'busy tab, close and submit buttons are disabled')
  assert.deepEqual(await page.eval(index => window.userDialogsHarness.pending[index].data, pending), { id: 1, amount: 10, remark: 'fixture adjustment' })
  await reject(pending); assert.match(await read('adjustBalanceError'), /fixture read unavailable/); assert.equal((await read('adjustBalanceForm')).amount, '10'); assert.equal(await read('adjustBalanceLoading'), false)
  await run(() => { void window.userDialogsHarness.view().submitAdjustBalance() }); pending = await last('adjust'); await accept(pending, receipt())
  assert.equal(await read('balanceTab'), 'overview'); assert.equal((await read('adjustBalanceForm')).amount, ''); assert.equal(await read('adjustBalanceLoading'), false)
  await reject(await last('balance')); assert.match(await read('balanceInfoError'), /fixture read unavailable/)
  await reject(await last('users')); assert.equal(await read('adjustBalanceError'), '', 'auxiliary failures cannot reclassify a committed write')
  for (const change of ['target', 'target-aba', 'session', 'session-aba', 'account', 'role', 'logout', 'close', 'tab', 'draft', 'cache']) {
    for (const failed of [false, true]) {
      pending = await start()
      await run(async change => {
        const h = window.userDialogsHarness, v = h.view()
        if (change === 'target') v.balanceUser = v.users[1]
        if (change === 'target-aba') { v.balanceUser = v.users[1]; v.balanceUser = v.users[0] }
        if (change === 'session') h.session('b')
        if (change === 'session-aba') { h.session('b'); h.session('a') }
        if (change === 'account') h.auth.user = { ...h.auth.user, id: 2 }
        if (change === 'role') h.auth.user = { ...h.auth.user, role: 'user' }
        if (change === 'logout') h.session(null)
        if (change === 'close') { v.showBalanceModal = false; v.showBalanceModal = true }
        if (change === 'tab') v.activeTab = 'invites'
        if (change === 'draft') { v.adjustBalanceForm.amount = '20'; v.adjustBalanceForm.reason = 'replacement' }
        if (change === 'cache') { await h.router.push('/other'); await h.router.push('/admin/users') }
      }, change)
      const before = await page.eval(() => ({ toasts: window.userDialogsHarness.toasts.length, requests: window.userDialogsHarness.pending.length }))
      if (failed) await reject(pending); else await accept(pending, receipt())
      assert.deepEqual(await page.eval(() => ({ toasts: window.userDialogsHarness.toasts.length, requests: window.userDialogsHarness.pending.length })), before, `${change}/${failed} stale write stays quiet without refreshing`)
      assert.equal(await read('adjustBalanceError'), ''); assert.equal(await read('adjustBalanceLoading'), false)
      if (change === 'draft') assert.equal((await read('adjustBalanceForm')).amount, '20', 'new draft survives old receipt')
    }
  }
  await open()
  for (const amount of ['', '0', '-1', '10abc', 'Infinity', 'NaN', '1e2', '0x10', '0.001', '1.234', '100000000', null, false, [], {}]) {
    writes = await count('adjust'); await run(amount => { const v = window.userDialogsHarness.view(); v.adjustBalanceForm.amount = amount; void v.submitAdjustBalance() }, amount)
    assert.equal(await read('canAdjustBalance'), false); assert.equal(await count('adjust'), writes, `invalid amount ${JSON.stringify(amount)} sends zero writes`)
  }
  for (const field of [{ type: 'invalid', amount: '10', reason: 'valid' }, { type: 'add', amount: '10', reason: ' ' }, { type: 'add', amount: '10', reason: 'x'.repeat(501) }]) {
    writes = await count('adjust'); await run(field => { const v = window.userDialogsHarness.view(); v.adjustBalanceForm = field; void v.submitAdjustBalance() }, field)
    assert.equal(await read('canAdjustBalance'), false); assert.equal(await count('adjust'), writes)
  }
  for (const [type, amount, before] of [['add', '.01', 0], ['add', '99999999.99', 0], ['deduct', '10.00', 10], ['add', 0.29, 10.11]]) {
    await open(); await run(({ type, amount }) => { const v = window.userDialogsHarness.view(); v.adjustBalanceForm.type = type; v.adjustBalanceForm.amount = amount; void v.submitAdjustBalance() }, { type, amount })
    const signed = type === 'add' ? Number(amount) : -Number(amount)
    pending = await last('adjust'); await accept(pending, receipt(signed, before)); assert.equal(await read('balanceTab'), 'overview'); assert.equal(await read('adjustBalanceError'), '')
  }
  for (const invalid of [{ error: 'invalid' }, { newBalance: 20, balanceLog: null }, { ...receipt(), newBalance: '20' }, { ...receipt(), balanceLog: { ...receipt().balanceLog, amount: 9 } }, { ...receipt(), balanceLog: { ...receipt().balanceLog, balanceBefore: 9 } }, { ...receipt(), balanceLog: { ...receipt().balanceLog, id: 0 } }]) {
    pending = await start(); await accept(pending, invalid); assert.ok(await read('adjustBalanceError')); assert.equal(await read('balanceTab'), 'adjust'); assert.equal((await read('adjustBalanceForm')).amount, '10')
  }
  pending = await start(); await run(() => window.userDialogsHarness.session('a', 2)); await accept(pending, receipt()); assert.equal(await read('balanceTab'), 'overview', 'same-sid token refresh accepts receipt')
  // Refresh spawned by a write owns its scope even after the write lock has been released.
  pending = await start(); await accept(pending, receipt()); const oldUsers = await last('users'), oldOverview = await last('balance')
  await open(); await accept(oldUsers, { users: [user(2)], total: 1, totalPages: 1 }); await accept(oldOverview, { userId: 1, balance: 99, totalRecharge: 0, totalConsume: 0 })
  assert.equal((await read('users')).length, 2, 'previous write refresh does not replace the newly opened user scope'); assert.equal(await read('balanceTab'), 'adjust')
  await run(() => { const v = window.userDialogsHarness.view(); void v.loadUsers(); void v.loadUsers() }); const newer = await last('users'), older = newer - 1
  await accept(newer, userList); await accept(older, { users: [user(2)], total: 1, totalPages: 1 }); assert.equal((await read('users')).length, 2, 'latest list request wins')
  for (const [locale, width, dark, mobile] of [['zh-CN',1440,false,false],['zh-TW',768,false,false],['en',390,true,true]]) {
    await open(); await run(({ locale, dark }) => { const h = window.userDialogsHarness; h.setLocale(locale); h.theme.setTheme(dark ? 'dark' : 'light'); void h.view().submitAdjustBalance() }, { locale, dark }); await reject(await last('adjust'))
    await page.setViewport({ width, height: 1000, mobile }); await sleep(300)
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: resolve(output, `adjust-${locale}-${width}.png`), format: 'png' })
  }
  pending = await start(); const beforeUnmount = await page.eval(() => window.userDialogsHarness.toasts.length)
  await run(() => { window.userDialogsHarness.state.mounted = false }); await accept(pending, receipt()); assert.equal(await page.eval(() => window.userDialogsHarness.toasts.length), beforeUnmount)
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log('PASS balance writes strict amount/type/reason, fixed target, immediate busy, fields/close lock, session/ABA/cache/draft receipts, failure retry, valid ledger receipts, zero and scoped auxiliary reads')
} finally { if (browser) await browser.close(); await server.close() }
