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
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js')
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/expiry-panel/*.js']
const output = resolve(root, 'logs/expiry-panel-browser')
mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const server = await createServer({ configFile: false, root: root + '/scripts/fixtures/expiry-panel',
  plugins: [vue()], resolve: { alias: [
    { find: /^@\/api(?:\/admin)?$/, replacement: root + '/scripts/fixtures/expiry-panel/api.js' },
    { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) })),
  ], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19645, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch()
  const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19645', { settleMs: 1200 })
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(35); return result }
  const latest = kind => page.eval(kind => window.expiryHarness.pending.findLastIndex(item => item.kind === kind), kind)
  const count = kind => page.eval(kind => window.expiryHarness.pending.filter(item => item.kind === kind).length, kind)
  const resolveRequest = (index, data) => run(({ index, data }) => window.expiryHarness.pending[index].resolve(data), { index, data })
  const rejectRequest = index => run(index => window.expiryHarness.pending[index].reject(new Error('isolated failure')), index)
  const tick = () => run(() => window.expiryHarness.tick())
  const timers = () => page.eval(() => [...window.expiryHarness.timers.values()].map(item => item.delay))
  const busy = () => page.eval(() => document.querySelector('.expiry-enforcement')?.getAttribute('aria-busy'))
  const alerts = () => page.eval(() => [...document.querySelectorAll('[role=alert]')].filter(el => el.checkVisibility()).map(el => el.textContent))
  const click = selector => run(selector => document.querySelector(selector).click(), selector)
  const route = path => run(path => window.expiryHarness.router.push(path), path)
  const tab = value => run(value => { window.expiryHarness.activeTab.value = value }, value)
  const visibility = value => run(value => window.expiryHarness.visibility(value), value)
  const status = (patch = {}) => ({ enabled: true, running: false, intervalMinutes: 5, retentionDays: 90,
    lastStartedAt: null, lastFinishedAt: null, nextRunAt: null, failureCount: 0, lastError: null, recoveryHeld: false, ...patch })
  const acceptStatus = async (patch = {}) => resolveRequest(await latest('status'), status(patch))
  const history = (page = 1) => ({ items: [], total: 60, page, pageSize: 20, totalPages: 3, retentionDays: 90 })
  const historyTab = '.expiry-enforcement button[aria-pressed]:last-child'
  const statusTab = '.expiry-enforcement button[aria-pressed]:first-child'
  const runButton = '.expiry-enforcement > .space-y-4 .flex.flex-wrap button:last-child'
  const refreshButton = '.expiry-enforcement > .flex > button'

  assert.equal(await count('status'), 1, 'mount and KeepAlive activation must start only one read')
  await acceptStatus(); assert.deepEqual(await timers(), [15000])
  await tick(); const oldRead = await latest('status')
  assert.deepEqual(await timers(), [], 'no overlapping read while the first request is pending')
  await tab('records'); await tick(); assert.deepEqual(await timers(), [])
  assert.equal(await page.eval(index => window.expiryHarness.pending[index].signal.aborted, oldRead), true)
  await tab('overview'); const newRead = await latest('status'); assert.notEqual(newRead, oldRead)
  await rejectRequest(oldRead); assert.equal(await busy(), 'true'); assert.deepEqual(await alerts(), [])
  await acceptStatus({ running: true }); assert.deepEqual(await timers(), [5000])
  await route('/other'); assert.deepEqual(await timers(), [])
  const beforeReturn = await count('status'); await tick(); assert.equal(await count('status'), beforeReturn)
  await route('/billing'); assert.equal(await count('status'), beforeReturn + 1)
  const oldPageRead = await latest('status')
  await visibility('hidden'); await visibility('visible'); const visibleRead = await latest('status')
  assert.notEqual(visibleRead, oldPageRead)
  await resolveRequest(oldPageRead, status({ failureCount: 997 })); assert.equal(await busy(), 'true')
  await acceptStatus(); assert.deepEqual(await timers(), [15000])
  const beforeRefreshToken = await count('status')
  await run(() => window.expiryHarness.session('a', 2)); assert.equal(await count('status'), beforeRefreshToken)
  await tick(); const previousSession = await latest('status')
  await run(() => window.expiryHarness.session('b'))
  await rejectRequest(previousSession); assert.deepEqual(await alerts(), []); assert.equal(await busy(), 'true')
  await acceptStatus({ recoveryHeld: true })
  await click(runButton); assert.equal(await count('run'), 0, 'held status cannot run a patrol')
  await click(refreshButton); await acceptStatus()
  await run(selector => { for (let i = 0; i < 10; i++) document.querySelector(selector).click() }, runButton)
  assert.equal(await count('run'), 1)
  const oldAction = await latest('run')
  await tab('records'); await tab('overview')
  assert.equal(await page.eval(selector => document.querySelector(selector) === null, runButton), true)
  assert.equal(await count('run'), 1, 'hiding must retain the pending action gate')
  const beforeActionComplete = await count('status')
  await resolveRequest(oldAction, status({ failureCount: 998 }))
  assert.equal(await count('status'), beforeActionComplete + 1, 'return after an action must fetch current status')
  assert.equal(await busy(), 'true'); await acceptStatus(); assert.deepEqual(await timers(), [15000])
  await click(runButton); await route('/other'); await rejectRequest(await latest('run'))
  assert.deepEqual(await alerts(), []); assert.deepEqual(await timers(), [])
  await route('/billing'); await acceptStatus()
  await click(runButton); await rejectRequest(await latest('run')); assert.equal((await alerts()).length, 1)
  await click(runButton); await resolveRequest(await latest('run'), status({ running: true })); assert.deepEqual(await timers(), [5000])
  await click(refreshButton); await acceptStatus({ enabled: false })
  await click('.expiry-enforcement > .space-y-4 .flex.flex-wrap button:first-child')
  assert.equal(await count('start'), 1); await resolveRequest(await latest('start'), status())

  await click(historyTab); assert.deepEqual(await timers(), [])
  const oldHistory = await latest('history'); await click(statusTab); await acceptStatus(); await click(historyTab)
  assert.equal(await page.eval(index => window.expiryHarness.pending[index].signal.aborted, oldHistory), true)
  const newHistory = await latest('history'); assert.notEqual(oldHistory, newHistory)
  await rejectRequest(oldHistory); assert.deepEqual(await alerts(), [])
  assert.equal(await page.eval(() => document.querySelector('.expiry-history').getAttribute('aria-busy')), 'true')
  await resolveRequest(newHistory, history())
  await run(() => { const input = document.querySelector('input[type=search]'); input.value = '续费失败'; input.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('.expiry-history form').requestSubmit() })
  assert.equal(await page.eval(() => window.expiryHarness.pending.at(-1).params.search), '续费失败')
  await resolveRequest(await latest('history'), history())
  await click('.expiry-history > .flex:last-child button:last-child')
  assert.equal(await page.eval(() => window.expiryHarness.pending.at(-1).params.page), 2)
  const oldHistoryPage = await latest('history'); await route('/other'); await route('/billing')
  assert.equal(await page.eval(() => window.expiryHarness.pending.at(-1).params.page), 2)
  assert.equal(await page.eval(() => window.expiryHarness.pending.at(-1).params.search), '续费失败')
  await resolveRequest(oldHistoryPage, history(1)); await resolveRequest(await latest('history'), history(2))
  await run(() => window.expiryHarness.session('c'))
  assert.equal(await page.eval(() => window.expiryHarness.pending.at(-1).params.search), undefined, 'another session must not retain history filters')
  await resolveRequest(await latest('history'), history())
  await click(statusTab); await acceptStatus()
  await click(runButton); const oldSessionAction = await latest('run')
  await run(() => window.expiryHarness.session('d'))
  const readsDuringAction = await count('status'); await tick(); assert.equal(await count('status'), readsDuringAction)
  await rejectRequest(oldSessionAction); assert.deepEqual(await alerts(), [])
  assert.equal(await count('status'), readsDuringAction + 1)
  await rejectRequest(await latest('status')); assert.equal((await alerts()).length, 1)
  assert.deepEqual(await timers(), [15000])
  await click(refreshButton); await acceptStatus()
  await tick(); const loggedOutRead = await latest('status')
  await run(() => { window.expiryHarness.auth.token = null })
  await rejectRequest(loggedOutRead); assert.deepEqual(await timers(), []); assert.deepEqual(await alerts(), [])
  await run(() => window.expiryHarness.session('e')); await acceptStatus()
  for (const locale of ['zh-CN', 'zh-TW', 'en-US']) {
    for (const width of [1440, 390]) {
      await run(({ locale, width }) => { window.expiryHarness.setLocale(locale); window.expiryHarness.theme.setTheme(width === 390 ? 'dark' : 'light') }, { locale, width })
      await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width === 390 })
      await page.screenshot({ path: resolve(output, `${locale}-${width}.png`), format: 'png' })
      assert.equal(await page.eval(() => document.documentElement.scrollWidth <= window.innerWidth), true)
    }
  }
  await tick(); const unmounted = await latest('status')
  await run(() => window.expiryHarness.unmount()); await rejectRequest(unmounted); await visibility('hidden'); await visibility('visible')
  assert.deepEqual(await timers(), [])
  console.log('Expiry panel: actual Vue/KeepAlive and controlled APIs, patrol timers and document visibility passed tab/cache/session/late-read/action/history/unmount races; no live patrol or account mutations.')
} finally { if (browser) await browser.close(); await server.close() }
