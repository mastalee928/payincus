import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { Browser, sleep } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'
const root = fileURLToPath(new URL('..', import.meta.url)).replaceAll('\\', '/')
const require = createRequire(new URL('../client/package.json', import.meta.url))
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href), { default: vue } = await import(pathToFileURL(require.resolve('@vitejs/plugin-vue')).href)
const output = resolve(root, 'logs/dashboard-session'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js'); tailwind.content = [root + '/client/src/**/*.{vue,js,ts}']
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/dashboard', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/dashboard/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } }, server: { host: '127.0.0.1', port: 19767, strictPort: true, fs: { allow: [root] } }
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  const run = async (fn, arg) => { const value = await page.eval(fn, arg); await sleep(40); return value }
  const fresh = async () => {
    await page.goto('http://127.0.0.1:19767', { settleMs: 200 }); const deadline = Date.now() + 15000
    while (!await page.eval(() => !!window.dashboardHarness?.view() && window.dashboardHarness.pending.length >= 5)) { if (Date.now() > deadline) throw Error('dashboard fixture failed: ' + page.consoleErrors.join('\n')); await sleep(50) }
  }
  const count = () => page.eval(() => window.dashboardHarness.pending.length)
  const snapshot = () => page.eval(() => { const h = window.dashboardHarness, v = window.oldDashboard || h.view(); return JSON.stringify({
    auth: h.auth.user, instances: v.instances, balance: v.balanceOverview, vip: v.userVipLevel, progress: v.userVipProgress, points: v.userPoints, error: v.loadError, loading: v.loading, timers: h.timers.size }) })
  const settle = (start, end, id = 1, fail = false) => run(({ start, end, id, fail }) => {
    const h = window.dashboardHarness
    for (const request of h.pending.slice(start, end)) {
      if (fail) { request.reject(Error('controlled dashboard unavailable')); continue }
      const instance = { id, user_id: id, name: `Instance ${id}`, status: 'running', image: 'debian/13', instanceType: 'container', ipv4: '192.0.2.1', host: { name: 'Fixture host', country_code: 'us' } }
      const values = { instances: { instances: [instance], page: 1, pageSize: 1000, total: 1, totalPages: 1 },
        me: { user: { id, username: `fixture-account-${id}`, email: 'fixture@example.test', role: 'user' } },
        balance: { balance: { balance: id * 10, frozen: 0, totalRecharge: id * 20, totalConsume: id, destroyedValue: 0 } },
        vip: { userVipLevel: 0, userVipBadgeStyle: null, userVipProgress: null }, points: { points: id } }
      request.resolve(values[request.kind])
    }
  }, { start, end, id, fail })
  if (!process.argv.includes('--lifecycle-only')) {
    await fresh(); const initialOldEnd = await count()
    await run(() => { const h = window.dashboardHarness; h.session(2); void h.view().loadData() })
    const initialNewEnd = await count()
    await settle(initialOldEnd, initialNewEnd, 2); await settle(0, initialOldEnd, 1)
    assert.equal(await page.eval(() => window.dashboardHarness.auth.user.id), 2, 'a previous account dashboard response cannot overwrite the active account')
    assert.equal(await page.eval(() => window.dashboardHarness.view().balanceOverview.balance), 20)
    console.log('PASS obsolete account summary cannot overwrite the current account')
    let stale = 0
    for (const mode of ['account', 'sid', 'role', 'logout', 'session-aba', 'cache', 'cache-aba', 'route', 'route-aba', 'unmount']) for (const fail of [false, true]) {
      await fresh(); await settle(0, await count()); await run(() => { void window.dashboardHarness.view().loadData() }); const oldStart = 5, oldEnd = await count()
      await run(async mode => {
        const h = window.dashboardHarness; window.oldDashboard = h.view()
        if (mode === 'account') h.session(2)
        if (mode === 'sid') h.session(1, 'new-dashboard-session')
        if (mode === 'role') h.session(1, 'dashboard-session', 'admin')
        if (mode === 'logout') h.auth.clearLocalAuth()
        if (mode === 'session-aba') { h.session(2); h.session(1) }
        if (mode === 'cache' || mode === 'cache-aba') h.active.value = false
        if (mode === 'cache-aba') { await Promise.resolve(); await Promise.resolve(); h.active.value = true }
        if (mode === 'route' || mode === 'route-aba') await h.router.push('/away')
        if (mode === 'route-aba') await h.router.push('/dashboard')
        if (mode === 'unmount') h.mounted.value = false
      }, mode)
      assert.equal(await page.eval(() => window.oldDashboard.instances.length), 0, `${mode} immediately clears the previous summary`)
      const newerEnd = await count()
      if (newerEnd > oldEnd) await settle(oldEnd, newerEnd, mode === 'account' ? 2 : 1)
      const before = await snapshot(); await settle(oldStart, oldEnd, 1, fail)
      assert.equal(await snapshot(), before, `${mode} isolates all five old success/failure replies`); stale++
    }
    console.log(`PASS ${stale} obsolete account/sid/role/logout/ABA/cache/route/unmount five-request summaries`)
    await fresh(); assert.equal(await count(), 5, 'mounted and activated perform only one initial summary read')
    await run(() => { const h = window.dashboardHarness; for (let i = 0; i < 5; i++) { void h.view().loadData(); h.tick() } })
    assert.equal(await count(), 5, 'current ticks and refresh calls do not overlap')
    await settle(0, 5); await run(() => { const h = window.dashboardHarness; h.auth.token = 'fixture.' + btoa(JSON.stringify({ sid: 'dashboard-session', revision: 2 })) + '.fixture' })
    assert.equal(await count(), 5, 'same-sid token refresh preserves the summary')
    await run(() => { void window.dashboardHarness.view().loadData() }); const oldEnd = await count()
    await run(() => window.dashboardHarness.session(2)); const newEnd = await count()
    await settle(5, oldEnd); await run(() => { void window.dashboardHarness.view().loadData() }); assert.equal(await count(), newEnd, 'obsolete finally cannot release the current request gate')
    await settle(oldEnd, newEnd, 2)
    await run(() => { const h = window.dashboardHarness; void h.view().loadData() }); const failedEnd = await count()
    await settle(newEnd, failedEnd, 2, true)
    assert.ok(await page.eval(() => window.dashboardHarness.view().loadError), 'current failure is retained')
    assert.equal(await page.eval(() => window.dashboardHarness.view().balanceOverview.balance), 20, 'optional request failures preserve last confirmed current balance')
    await run(() => [...document.querySelectorAll('button')].find(button => button.textContent.includes('重试')).click()); const retriedEnd = await count()
    await settle(failedEnd, retriedEnd, 2); assert.equal(await page.eval(() => window.dashboardHarness.view().loadError), '')
    await run(() => { void window.dashboardHarness.view().loadData() }); const malformedEnd = await count()
    await run(({ start, end }) => { const h = window.dashboardHarness; for (const request of h.pending.slice(start, end)) if (request.kind === 'me') request.resolve({ user: { id: 1, role: 'user' } }) }, { start: retriedEnd, end: malformedEnd })
    await settle(retriedEnd, malformedEnd, 2)
    assert.equal(await page.eval(() => window.dashboardHarness.auth.user.id), 2, 'foreign identity response cannot replace the current user')
    assert.ok(await page.eval(() => window.dashboardHarness.view().loadError))
    console.log('PASS one initial/pending summary, same-sid refresh, current gate, failed read retry and foreign identity rejection')
    for (const bad of [null, {}, { instances: null }, { instances: [null] }, { instances: [{ id: 1, user_id: 2 }] }, { instances: [{ id: 1 }, { id: 1 }] }]) {
      await fresh(); const end = await count()
      await run(({ end, bad }) => { const h = window.dashboardHarness; for (const request of h.pending.slice(0, end)) if (request.kind === 'instances') request.resolve(bad) }, { end, bad })
      await settle(0, end)
      assert.ok(await page.eval(() => window.dashboardHarness.view().loadError), 'invalid or foreign inventory is a read failure')
      assert.equal(await page.eval(() => window.dashboardHarness.view().instances.length), 0)
    }
    await fresh(); await run(() => { const h = window.dashboardHarness; for (const request of h.pending) {
      if (request.kind === 'instances') request.resolve({ instances: [] })
      if (request.kind === 'balance') request.resolve({ balance: { balance: 0, frozen: 0, totalRecharge: 0, totalConsume: 0 } })
      if (request.kind === 'points') request.resolve({ points: 0 })
    } }); await settle(0, await count())
    assert.equal(await page.eval(() => window.dashboardHarness.view().loadError), '')
    assert.equal(await page.eval(() => window.dashboardHarness.view().instances.length), 0)
    assert.equal(await page.eval(() => window.dashboardHarness.view().balanceOverview.balance), 0)
    console.log('PASS malformed inventory rejection, legitimate empty list and zero balance/points')
    for (const locale of ['zh-CN', 'zh-TW', 'en']) for (const width of [1440, 768, 390]) {
      await fresh(); await page.setViewport({ width, height: 1000 }); await run(({ locale, width }) => { const h = window.dashboardHarness; h.setLocale(locale); h.theme.setTheme(width === 390 ? 'dark' : 'light') }, { locale, width })
      const failed = await count(); await settle(0, failed, 1, true)
      await run(locale => { const text = { 'zh-CN': '重试', 'zh-TW': '重試', en: 'Retry' }[locale]; const button = [...document.querySelectorAll('button')].find(button => button.textContent.includes(text)); if (!button) throw Error('Missing actual dashboard retry: ' + locale); button.click() }, locale)
      await settle(failed, await count())
      assert.equal(await page.eval(() => window.dashboardHarness.view().loadError), '')
      assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
      await page.screenshot({ path: resolve(output, `${locale}-${width}.jpg`), fullPage: true })
    }
    console.log('PASS actual retry controls in three locales and three widths')
  }
  await fresh(); const initial = await count(); await run(() => { const h = window.dashboardHarness; window.oldDashboard = h.view(); h.mounted.value = false })
  await settle(0, initial)
  assert.equal(await page.eval(() => window.dashboardHarness.timers.size), 0, 'late mount completion must not create polling after unmount')
  assert.equal(await page.eval(() => window.oldDashboard.instances.length), 0, 'unmounted view cannot receive the old summary')
  console.log('PASS late mount completion cannot restart polling or restore unmounted data')
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
} finally { if (browser) await browser.close(); await server.close() }
