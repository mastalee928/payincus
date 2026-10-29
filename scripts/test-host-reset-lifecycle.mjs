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
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/host-reset-lifecycle/*.js']
const output = resolve(root, 'logs/host-reset-lifecycle-lifecycle'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const server = await createServer({ configFile: false, root: root + '/scripts/fixtures/host-reset-lifecycle', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/host-reset-lifecycle/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19684, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19684', { settleMs: 1600 })
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(90); return result }
  const last = kind => page.eval(kind => window.hostReset.pending.findLastIndex(item => item.kind === kind), kind)
  const accept = (index, data) => run(({ index, data }) => window.hostReset.pending[index].resolve(data), { index, data })
  const row = (id, hostId = 1) => ({ id, name: `Fixture instance ${id}`, hostId, status: 'running', image: 'debian/12', cpu: 1, memory: 512, disk: 10240, username: 'Fixture user', packagePlanId: 1, billingPrice: 10 })
  const list = (ids, hostId = 1, status = 'running') => ({ instances: ids.map(id => ({ ...row(id, hostId), status })), total: ids.length, totalPages: 1 })
  const choose = ids => run(ids => { window.hostReset.view().selectedIds = new Set(ids) }, ids)
  const count = kind => page.eval(kind => window.hostReset.pending.filter(item => item.kind === kind).length, kind)
  await accept(await last('list'), list([1]))
  await run(() => { const v = window.hostReset.view(); v.openResetTrafficModal(v.instances[0]); void v.confirmResetTraffic() })
  const old = await last('reset')
  await run(() => { window.hostReset.state.id = 2 }); await accept(await last('list'), list([2], 2))
  await run(() => { const v = window.hostReset.view(); v.openResetTrafficModal(v.instances[0]) })
  const beforeOld = await count('traffic'); await accept(old, { success: true })
  assert.equal(await count('traffic'), beforeOld, 'old reset receipt must not initiate another host traffic read')
  console.log('PASS old traffic reset receipt stays with its original context')
  const view = key => page.eval(key => JSON.parse(JSON.stringify(window.hostReset.view()[key])), key)
  const reject = index => run(index => window.hostReset.pending[index].reject(new Error('Fixture traffic failure')), index)
  const call = method => run(method => { void window.hostReset.view()[method]() }, method)
  const open = () => run(() => { const v = window.hostReset.view(); v.openResetTrafficModal(v.instances[0]) })
  const traffic = value => ({ monthlyUsed: String(value), monthlyUsedFormatted: `${value} B`, monthlyLimit: null, monthlyLimitFormatted: null, percentage: 0 })
  const close = () => run(() => { window.hostReset.view().showResetTrafficModal = false })
  if (await view('showResetTrafficModal')) await close()
  const closed = await count('reset'); await call('confirmResetTraffic'); assert.equal(await count('reset'), closed)
  await open(); await call('confirmResetTraffic'); const current = await last('reset')
  await call('confirmResetTraffic'); assert.equal(await count('reset'), closed + 1)
  assert.deepEqual(await page.eval(index => window.hostReset.pending[index].params, current), { instanceId: 2 })
  await accept(current, { success: true }); assert.equal(await view('showResetTrafficModal'), false, 'successful reset closes before optional traffic refresh')
  await reject(await last('traffic')); assert.equal(await view('showResetTrafficModal'), false); assert.equal(await view('resetTrafficError'), '')
  await open(); await call('confirmResetTraffic'); await accept(await last('reset'), { success: false })
  assert.equal(await view('showResetTrafficModal'), true); assert.ok(await view('resetTrafficError'))
  await call('confirmResetTraffic'); await reject(await last('reset')); assert.ok(await view('resetTrafficError'))
  await call('confirmResetTraffic'); await accept(await last('reset'), { success: true }); await accept(await last('traffic'), traffic(0))
  assert.equal((await view('instances'))[0].trafficData.monthlyUsed, '0')
  // A traffic read begun before reset cannot restore stale usage after the post-reset read.
  await call('loadInstancesTraffic'); const staleTraffic = await last('traffic')
  await open(); await call('confirmResetTraffic'); await accept(await last('reset'), { success: true }); const freshTraffic = await last('traffic')
  await accept(freshTraffic, traffic(1)); await accept(staleTraffic, traffic(999)); assert.equal((await view('instances'))[0].trafficData.monthlyUsed, '1')
  await open(); await call('confirmResetTraffic'); const refreshing = await last('reset'); await call('loadInstances')
  await accept(await last('list'), list([2], 2)); const beforeRefreshTraffic = await last('traffic')
  await accept(refreshing, { success: true }); const afterRefreshTraffic = await last('traffic')
  assert.notEqual(afterRefreshTraffic, beforeRefreshTraffic); await accept(afterRefreshTraffic, traffic(0)); await accept(beforeRefreshTraffic, traffic(100))
  assert.equal((await view('instances'))[0].trafficData.monthlyUsed, '0'); assert.equal(await view('showResetTrafficModal'), false)
  await open(); await call('confirmResetTraffic'); const resetDuringList = await last('reset')
  await call('loadInstances'); const oldList = await last('list'); await accept(resetDuringList, { success: true })
  const freshList = await last('list'); assert.notEqual(freshList, oldList)
  await accept(oldList, list([2], 2)); assert.equal(await view('loading'), true)
  await accept(freshList, list([2], 2)); await accept(await last('traffic'), traffic(0))
  assert.equal((await view('instances'))[0].trafficData.monthlyUsed, '0')
  await open(); await run(() => window.hostReset.session('a', 2)); assert.equal(await view('showResetTrafficModal'), true)
  await call('confirmResetTraffic'); const oldSession = await last('reset'); await run(() => window.hostReset.session('b')); await accept(await last('list'), list([2], 2))
  const sessionTraffic = await count('traffic'); await reject(oldSession); assert.equal(await view('resetTrafficError'), ''); assert.equal(await count('traffic'), sessionTraffic)
  await open(); await call('confirmResetTraffic'); const oldCache = await last('reset'); await run(() => { window.hostReset.state.active = false })
  await run(() => { window.hostReset.state.active = true }); await accept(await last('list'), list([2], 2))
  const cacheTraffic = await count('traffic'); await accept(oldCache, { success: true }); assert.equal(await count('traffic'), cacheTraffic)
  await open(); await call('confirmResetTraffic'); const queryReset = await last('reset')
  await run(() => { window.hostReset.view().searchQuery = 'next'; void window.hostReset.view().handleSearch() }); await accept(await last('list'), list([3], 2))
  const queryTraffic = await count('traffic'); await accept(queryReset, { success: true }); assert.equal(await count('traffic'), queryTraffic)
  await open(); await call('confirmResetTraffic'); await reject(await last('reset'))
  for (const [locale, width, dark, mobile] of [['zh-CN', 1440, false, false], ['en', 390, true, true]]) {
    await page.setViewport({ width, height: 1000, mobile })
    await run(({ locale, dark }) => { window.hostReset.setLocale(locale); window.hostReset.theme.setTheme(dark ? 'dark' : 'light') }, { locale, dark })
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: resolve(output, `${locale}-${width}.png`), format: 'png' })
  }
  await run(() => {
    const dialog = document.querySelector('[role="dialog"]'), controls = dialog.querySelectorAll('button')
    controls[controls.length - 1].focus(); controls[controls.length - 1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    if (document.activeElement !== controls[0]) throw new Error('reset confirmation must retain focus')
  })
  await call('confirmResetTraffic'); const logout = await last('reset'); await run(() => window.hostReset.session(null)); await reject(logout)
  assert.equal(await view('resetTrafficError'), ''); const loggedOut = await count('reset'); await call('confirmResetTraffic'); assert.equal(await count('reset'), loggedOut)
  await run(() => window.hostReset.session('c')); await accept(await last('list'), list([3], 2)); await open(); await call('confirmResetTraffic')
  const unmounted = await last('reset'); await run(() => { window.hostReset.state.mounted = false }); await accept(unmounted, { success: true })
  assert.equal(await view('resettingTrafficId'), null); assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log('PASS fixed reset, duplicate/closed gates, failure retry, post-reset read failure, old traffic ordering, query/session/cache/logout/unmount and both viewports')
} finally { if (browser) await browser.close(); await server.close() }
