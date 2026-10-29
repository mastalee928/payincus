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
const output = resolve(root, 'logs/user-points-submit'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js')
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/user-dialogs/*.js']
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/user-dialogs', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api\/admin$/, replacement: root + '/scripts/fixtures/user-dialogs/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19709, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19709', { settleMs: 1400 })
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
  await run(() => { const v = window.userDialogsHarness.view(); v.openPointsModal(v.users[0]); v.adjustPointsForm = { amount: '10', reason: 'fixture points adjustment' }; void v.submitAdjustPoints() })
  const old = await last('points-adjust')
  await run(() => window.userDialogsHarness.session('b'))
  const before = await page.eval(() => ({ toasts: window.userDialogsHarness.toasts.length, requests: window.userDialogsHarness.pending.length }))
  await accept(old, { success: true, newPoints: 20 })
  assert.deepEqual(await page.eval(() => ({ toasts: window.userDialogsHarness.toasts.length, requests: window.userDialogsHarness.pending.length })), before, 'old points write cannot notify or refresh the replacement session')
  const count = () => page.eval(() => window.userDialogsHarness.pending.filter(item => item.kind === 'points-adjust').length)
  const open = async () => run(() => { const h = window.userDialogsHarness, v = h.view(); h.auth.user = { id: 1, role: 'admin', username: 'fixture' }; h.session('a'); v.activeTab = 'users'; v.showPointsModal = false; v.openPointsModal(v.users[0]); v.adjustPointsForm = { amount: '10', reason: ' fixture points ' } })
  const start = async () => { await open(); await run(() => { void window.userDialogsHarness.view().submitAdjustPoints() }); return last('points-adjust') }
  let pending = await start(), writes = await count()
  await run(() => { const v = window.userDialogsHarness.view(); void v.submitAdjustPoints(); v.closePointsModal(); v.openPointsModal(v.users[1]) })
  assert.equal(await count(), writes); assert.equal(await read('showPointsModal'), true); assert.equal((await read('pointsUser')).id, 1)
  assert.equal(await page.eval(() => [...document.querySelectorAll('[data-user-dialog="points"] input, [data-user-dialog="points"] textarea, [data-user-dialog="points"] button')].every(el => el.matches(':disabled'))), true)
  assert.deepEqual(await page.eval(i => window.userDialogsHarness.pending[i].data, pending), { id: 1, amount: 10, remark: 'fixture points' })
  await reject(pending); assert.match(await read('adjustPointsError'), /fixture read unavailable/); assert.equal((await read('adjustPointsForm')).amount, '10'); assert.equal(await read('adjustPointsLoading'), false)
  await run(() => { void window.userDialogsHarness.view().submitAdjustPoints() }); await accept(await last('points-adjust'), { success: true, newPoints: 20 }); assert.equal(await read('showPointsModal'), false)
  for (const change of ['target', 'target-aba', 'session', 'session-aba', 'account', 'role', 'logout', 'close', 'tab', 'draft', 'cache']) for (const failed of [false, true]) {
    pending = await start()
    await run(async change => {
      const h = window.userDialogsHarness, v = h.view()
      if (change === 'target') v.pointsUser = v.users[1]
      if (change === 'target-aba') { v.pointsUser = v.users[1]; v.pointsUser = v.users[0] }
      if (change === 'session') h.session('b')
      if (change === 'session-aba') { h.session('b'); h.session('a') }
      if (change === 'account') h.auth.user = { ...h.auth.user, id: 2 }
      if (change === 'role') h.auth.user = { ...h.auth.user, role: 'user' }
      if (change === 'logout') h.session(null)
      if (change === 'close') { v.showPointsModal = false; v.showPointsModal = true }
      if (change === 'tab') v.activeTab = 'invites'
      if (change === 'draft') { v.adjustPointsForm.amount = '20'; v.adjustPointsForm.reason = 'new draft' }
      if (change === 'cache') { await h.router.push('/other'); await h.router.push('/admin/users') }
    }, change)
    const before = await page.eval(() => ({ toasts: window.userDialogsHarness.toasts.length, requests: window.userDialogsHarness.pending.length }))
    if (failed) await reject(pending); else await accept(pending, { success: true, newPoints: 20 })
    assert.deepEqual(await page.eval(() => ({ toasts: window.userDialogsHarness.toasts.length, requests: window.userDialogsHarness.pending.length })), before, `${change}/${failed} old receipt stays quiet`)
    assert.equal(await read('adjustPointsError'), ''); assert.equal(await read('adjustPointsLoading'), false)
    if (change === 'draft') assert.equal((await read('adjustPointsForm')).amount, '20')
  }
  await open()
  for (const amount of ['', '0', '10abc', '1.1', '1e2', '0x10', 'Infinity', 'NaN', '1000001', '-1000001', null, false, [], {}]) {
    writes = await count(); await run(amount => { const v = window.userDialogsHarness.view(); v.adjustPointsForm.amount = amount; void v.submitAdjustPoints() }, amount)
    assert.equal(await read('canAdjustPoints'), false); assert.equal(await count(), writes)
  }
  for (const reason of ['', ' ', 'x'.repeat(201)]) {
    writes = await count(); await run(reason => { const v = window.userDialogsHarness.view(); v.adjustPointsForm = { amount: '10', reason }; void v.submitAdjustPoints() }, reason); assert.equal(await count(), writes)
  }
  for (const amount of ['1', '-1', '1000000', '-1000000', 10]) {
    await open(); await run(amount => { const v = window.userDialogsHarness.view(); v.adjustPointsForm.amount = amount; void v.submitAdjustPoints() }, amount); pending = await last('points-adjust')
    assert.equal(await page.eval(i => window.userDialogsHarness.pending[i].data.amount, pending), Number(amount)); await accept(pending, { success: true, newPoints: 0 }); assert.equal(await read('showPointsModal'), false)
  }
  for (const bad of [{}, { success: false, newPoints: 20 }, { success: true, newPoints: '20' }, { success: true, newPoints: -1 }, { success: true, newPoints: 1.1 }, { success: true, newPoints: 2147483648 }]) {
    pending = await start(); await accept(pending, bad); assert.ok(await read('adjustPointsError')); assert.equal(await read('showPointsModal'), true); assert.equal((await read('adjustPointsForm')).amount, '10')
  }
  pending = await start(); await run(() => window.userDialogsHarness.session('a', 2)); await accept(pending, { success: true, newPoints: 20 }); assert.equal(await read('showPointsModal'), false)
  const oldUsers = await last('users'); await open(); await accept(oldUsers, { users: [user(2)], total: 1, totalPages: 1 }); assert.equal((await read('users')).length, 2, 'old points refresh cannot replace reopened scope')
  for (const [locale,width,dark,mobile] of [['zh-CN',1440,false,false],['zh-TW',768,false,false],['en',390,true,true]]) {
    pending = await start(); await reject(pending)
    await run(({ locale,dark }) => { const h = window.userDialogsHarness; h.setLocale(locale); h.theme.setTheme(dark?'dark':'light') }, { locale,dark })
    await page.setViewport({ width,height:1000,mobile }); await sleep(300); assert.equal(await page.eval(() => document.documentElement.scrollWidth<=innerWidth),true)
    await page.screenshot({ path:resolve(output,`points-${locale}-${width}.png`),format:'png' })
  }
  pending = await start(); const toasts = await page.eval(() => window.userDialogsHarness.toasts.length); await run(() => { window.userDialogsHarness.state.mounted = false }); await accept(pending,{ success:true,newPoints:20 }); assert.equal(await page.eval(() => window.userDialogsHarness.toasts.length),toasts)
  assert.equal(page.consoleErrors.length,0,page.consoleErrors.join('\n'))
  console.log('PASS points writes strict integer/reason, immediate busy/fields/close lock, fixed targets, stale session/ABA/cache/draft receipts, valid zero and error retry, scoped list refresh')
} finally { if (browser) await browser.close(); await server.close() }
