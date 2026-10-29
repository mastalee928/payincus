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
const output = resolve(root, 'logs/user-dialog-reads'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js')
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/user-dialogs/*.js']
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/user-dialogs', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api\/admin$/, replacement: root + '/scripts/fixtures/user-dialogs/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19707, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19707', { settleMs: 1400 })
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
  await run(() => { void window.userDialogsHarness.view().openBalanceModal(window.userDialogsHarness.view().users[0]) })
  const oldBalance = await last('balance')
  await run(() => { void window.userDialogsHarness.view().openBalanceModal(window.userDialogsHarness.view().users[1]) })
  await accept(await last('balance'), response('balance', 2, 20)); await accept(oldBalance, response('balance', 1, 10))
  assert.equal((await read('balanceInfo')).balance, 20, 'old balance cannot replace the newly selected user')
  for (const kind of ['balance', 'logs', 'recharge', 'login']) {
    const list = { balance: 'balanceInfo', logs: 'balanceLogs', recharge: 'rechargeRecords', login: 'loginRecords' }[kind]
    const loading = { balance: 'balanceInfoLoading', logs: 'balanceLogsLoading', recharge: 'rechargeRecordsLoading', login: 'loginRecordsLoading' }[kind]
    const error = { balance: 'balanceInfoError', logs: 'balanceLogsError', recharge: 'rechargeRecordsError', login: 'loginRecordsError' }[kind]
    const load = { balance: 'loadBalanceInfo', logs: 'loadBalanceLogs', recharge: 'loadRechargeRecords', login: 'loadLoginRecords' }[kind]
    const open = async (id = 1) => {
      await run(kind => {
        const h = window.userDialogsHarness, v = h.view(); h.auth.user = { id: 1, role: 'admin', username: 'fixture' }; h.session('a'); v.activeTab = 'users'
        v.showBalanceModal = false; v.showLoginRecordsModal = false
        if (kind === 'login') void v.openLoginRecordsModal(v.users[0])
        else { void v.openBalanceModal(v.users[0]); if (kind !== 'balance') v.switchBalanceTab(kind) }
      }, kind)
      if (id !== 1) await run(({ kind, id }) => {
        const v = window.userDialogsHarness.view()
        if (kind === 'login') void v.openLoginRecordsModal(v.users[id - 1]); else { void v.openBalanceModal(v.users[id - 1]); if (kind !== 'balance') v.switchBalanceTab(kind) }
      }, { kind, id })
      return last(kind)
    }
    let old = await open(), fresh = await open(2)
    await accept(fresh, response(kind, 2, 20)); await accept(old, response(kind))
    assert.equal(kind === 'balance' ? (await read(list)).balance : (await read(list))[0].id, kind === 'balance' ? 20 : 2)
    for (const change of ['target-aba', 'session', 'session-aba', 'account', 'role', 'logout', 'close', 'tab', 'cache', 'pagination', 'filter']) {
      old = await open()
      const before = await page.eval(() => window.userDialogsHarness.toasts.length)
      await run(async ({ change, kind }) => {
        const h = window.userDialogsHarness, v = h.view(), modal = kind === 'login' ? 'showLoginRecordsModal' : 'showBalanceModal'
        if (change === 'target-aba') { if (kind === 'login') { void v.openLoginRecordsModal(v.users[1]); void v.openLoginRecordsModal(v.users[0]) } else { void v.openBalanceModal(v.users[1]); void v.openBalanceModal(v.users[0]); if (kind !== 'balance') v.switchBalanceTab(kind) } }
        if (change === 'session') h.session('b')
        if (change === 'session-aba') { h.session('b'); h.session('a') }
        if (change === 'account') h.auth.user = { ...h.auth.user, id: 2 }
        if (change === 'role') h.auth.user = { ...h.auth.user, role: 'user' }
        if (change === 'logout') h.session(null)
        if (change === 'close') { v[modal] = false; v[modal] = true }
        if (change === 'tab') v.activeTab = 'invites'
        if (change === 'cache') { await h.router.push('/other'); await h.router.push('/admin/users') }
        if (change === 'pagination') { if (kind === 'login') v.loginRecordsPage = 2; else if (kind === 'logs') v.balanceLogsPage = 2; else if (kind === 'recharge') v.rechargeRecordsPage = 2; else v.balanceTab = 'logs' }
        if (change === 'filter') { if (kind === 'logs') v.balanceLogsShowLotteryGiftOnly = true; else if (kind === 'login') v.loginRecordsPageSize = 20; else if (kind === 'recharge') v.rechargeRecordsPageSize = 20; else v.balanceTab = 'adjust' }
      }, { change, kind })
      await reject(old)
      assert.equal(await page.eval(() => window.userDialogsHarness.toasts.length), before, `${kind}/${change} old failure stays quiet`)
      assert.equal(await read(error), '', `${kind}/${change} old failure cannot set current error`)
    }
    old = await open(); await run(load => { void window.userDialogsHarness.view()[load]() }, load); fresh = await last(kind)
    await reject(old); assert.equal(await read(loading), true, 'old finally cannot stop newer loading')
    await reject(fresh); assert.match(await read(error), /fixture read unavailable/)
    await run(load => { void window.userDialogsHarness.view()[load]() }, load)
    await accept(await last(kind), response(kind, 1, 0)); assert.equal(await read(error), '')
    assert.equal(await read(loading), false)
    if (kind === 'balance') assert.equal((await read(list)).balance, 0)
    old = await open(); await run(() => { window.userDialogsHarness.session('a', 2) }); await accept(old, response(kind))
    assert.equal(await read(loading), false, 'same sid refresh retains the current read')
    old = await open(); await accept(old, { error: 'invalid response' }); assert.ok(await read(error), 'invalid response is not a successful empty result')
    if (kind === 'balance' || kind === 'recharge') {
      old = await open(); await accept(old, response(kind, 2, 50))
      assert.ok(await read(error), 'a receipt with another user identity is rejected')
    }
    old = await open()
    const bad = response(kind)
    if (kind === 'balance') bad.balance = '10'
    else if (kind === 'logs') bad.logs[0].amount = '10'
    else if (kind === 'recharge') bad.records[0].amount = '10'
    else bad.records[0].id = 0
    await accept(old, bad); assert.ok(await read(error), 'invalid numeric row data is not displayed as valid')
    if (kind !== 'balance') {
      old = await open(); await accept(old, { [kind === 'logs' ? 'logs' : 'records']: [], total: 0, page: 1, pageSize: 50 })
      assert.equal(await read(error), ''); assert.deepEqual(await read(list), [], 'successful empty list has no error')
    }
    old = await open(); await reject(old)
    for (const [locale, width, dark, mobile] of [['zh-CN', 1440, false, false], ['zh-CN', 768, false, false], ['en', 390, true, true]]) {
      await page.setViewport({ width, height: 1000, mobile })
      await run(({ locale, dark }) => { const h = window.userDialogsHarness; h.setLocale(locale); h.theme.setTheme(dark ? 'dark' : 'light') }, { locale, dark })
      assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
      await page.screenshot({ path: resolve(output, `${kind}-${locale}-${width}.png`), format: 'png' })
      if (kind !== 'login') assert.equal(await page.eval(() => [...document.querySelectorAll('[data-user-dialog="balance"] button')].every(button => {
        const rect = button.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth
      })), true, 'all four balance tabs and actions fit the phone')
    }
    await run(load => { void window.userDialogsHarness.view()[load]() }, load)
    await accept(await last(kind), response(kind, 1, 0))
    await page.screenshot({ path: resolve(output, `${kind}-success-en-390.png`), format: 'png' })
  }
  await run(() => { const v = window.userDialogsHarness.view(); void v.openBalanceModal(v.users[0]) })
  const index = await last('balance')
  await run(() => { window.userDialogsHarness.state.mounted = false }); await accept(index, response('balance', 1, 99))
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log('PASS user balance/login dialogs current target/session/cache, latest reads, pages/filters, zero, persistent errors and retry')
} finally { if (browser) await browser.close(); await server.close() }
