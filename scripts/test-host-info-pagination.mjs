import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { Browser, sleep } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'
const root = fileURLToPath(new URL('..', import.meta.url)).replaceAll('\\', '/'), require = createRequire(new URL('../client/package.json', import.meta.url))
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href), { default: vue } = await import(pathToFileURL(require.resolve('@vitejs/plugin-vue')).href)
const output = resolve(root, 'logs/host-info-pagination'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js'); tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/host-info/*.js']
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/host-info', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/host-info/api.js' }, { find: '@', replacement: root + '/client/src' }, ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } }, server: { host: '127.0.0.1', port: 19776, strictPort: true, fs: { allow: [root] } }
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  const run = async (fn, arg) => { const value = await page.eval(fn, arg); await sleep(50); return value }
  const fresh = async () => {
    await page.goto('http://127.0.0.1:19776', { settleMs: 250 }); const deadline = Date.now() + 15000
    while (!await page.eval(() => !!window.hostInfoHarness?.view())) { if (Date.now() > deadline) throw Error('Host pagination fixture did not mount'); await sleep(50) }
    await run(() => window.hostInfoHarness.view().stopAgentStatusAutoRefresh())
  }
  const requests = () => page.eval(() => window.hostInfoHarness.pending.filter(r => r.kind === 'instances').length)
  const last = () => page.eval(() => window.hostInfoHarness.pending.findLastIndex(r => r.kind === 'instances'))
  const stats = () => page.eval(() => JSON.parse(JSON.stringify(window.hostInfoHarness.view().instanceStats)))
  const rows = Array.from({ length: 237 }, (_, index) => ({ id: index + 1, hostId: 11, cpu: 2, memory: 512, disk: 1024 }))
  const accept = (index, pageNumber, edits = {}) => run(({ index, pageNumber, rows, edits }) => {
    window.hostInfoHarness.pending[index].resolve({ instances: rows.slice((pageNumber - 1) * 100, pageNumber * 100),
      page: pageNumber, pageSize: 100, total: rows.length, totalPages: 3, ...edits })
  }, { index, pageNumber, rows, edits })
  await fresh(); await accept(await last(), 1)
  assert.equal((await stats()).cpuUsed, 0, 'host resource totals must not publish a truncated first page')
  assert.equal(await requests(), 2, 'host resources fetch the second page')
  await accept(await last(), 2); await accept(await last(), 3)
  assert.deepEqual(await stats(), { count: 237, cpuUsed: 474, memoryUsed: 121344, diskUsed: 242688 })
  assert.equal(await page.eval(() => window.hostInfoHarness.pending.filter(r => r.kind === 'instances').every((r, index) =>
    r.data.hostId === 11 && r.data.pageSize === 100 && r.data.page === index + 1)), true)
  console.log('PASS full three-page host resource totals with fixed host filters and bounded page size')
  for (const edits of [{ page: 1 }, { total: 238 }, { totalPages: 4 }, { instances: rows.slice(100, 199) },
    { instances: [rows[0], ...rows.slice(101, 200)] }, { instances: [{ ...rows[100], hostId: 12 }, ...rows.slice(101, 200)] },
    { instances: [{ ...rows[100], host_id: 12 }, ...rows.slice(101, 200)] },
    { instances: [{ ...rows[100], cpu: '2' }, ...rows.slice(101, 200)] },
    { instances: [{ ...rows[100], memory: -1 }, ...rows.slice(101, 200)] },
    { instances: [{ ...rows[100], disk: {} }, ...rows.slice(101, 200)] }]) {
    await fresh(); await accept(await last(), 1); await accept(await last(), 2, edits)
    assert.equal(await requests(), 2); assert.deepEqual(await stats(), { count: 0, cpuUsed: 0, memoryUsed: 0, diskUsed: 0 })
    assert.equal(await page.eval(() => window.hostInfoHarness.view().statsError && !window.hostInfoHarness.view().statsLoading), true)
  }
  for (const value of ['nan', 'infinity', 'negative-infinity']) {
    await fresh(); await accept(await last(), 1)
    await run(value => { const h = window.hostInfoHarness, n = value === 'nan' ? NaN : value === 'infinity' ? Infinity : -Infinity
      h.pending.findLast(r => r.kind === 'instances').resolve({ page: 2, pageSize: 100, total: 237, totalPages: 3,
        instances: Array.from({ length: 100 }, (_, i) => ({ id: i + 101, hostId: 11, cpu: n, memory: 512, disk: 1024 })) }) }, value)
    assert.equal(await requests(), 2); assert.equal(await page.eval(() => window.hostInfoHarness.view().statsError), true)
  }
  console.log('PASS 13 malformed/duplicate/foreign and nonfinite middle pages reject partial totals')
  await fresh(); await accept(await last(), 1); await accept(await last(), 2); await accept(await last(), 3)
  const beforeRefresh = await stats()
  await run(() => { void window.hostInfoHarness.view().loadInstanceStats() }); await accept(await last(), 1)
  await run(() => window.hostInfoHarness.pending.findLast(r => r.kind === 'instances').reject(Error('middle page unavailable')))
  assert.deepEqual(await stats(), beforeRefresh); assert.equal(await page.eval(() => window.hostInfoHarness.view().statsError), true)
  await run(() => document.querySelector('[data-host-stats-error] button').click())
  await accept(await last(), 1); await accept(await last(), 2); await accept(await last(), 3)
  assert.deepEqual(await stats(), beforeRefresh); assert.equal(await page.eval(() => window.hostInfoHarness.view().statsError), false)
  console.log('PASS failed refresh preserves last complete totals and the real block retry recovers')
  let stale = 0
  for (const mode of ['host', 'host-aba', 'account', 'sid', 'role', 'logout', 'session-aba', 'cache', 'cache-aba', 'unmount', 'supersede']) for (const fail of [false, true]) {
    await fresh(); await accept(await last(), 1); const old = await last()
    await run(async mode => {
      const h = window.hostInfoHarness
      window.oldHostStats = h.view()
      if (mode === 'host') h.host.value = { ...h.host.value, id: 12 }
      if (mode === 'host-aba') { h.host.value = { ...h.host.value, id: 12 }; h.host.value = { ...h.host.value, id: 11 } }
      if (mode === 'account') h.session(2)
      if (mode === 'sid') h.session(1, 'other-host-session')
      if (mode === 'role') h.session(1, 'host-info-session', 'user')
      if (mode === 'logout') h.auth.clearLocalAuth()
      if (mode === 'session-aba') { h.session(2); h.session(1) }
      if (mode === 'cache' || mode === 'cache-aba') h.active.value = false
      if (mode === 'cache-aba') { await new Promise(resolve => setTimeout(resolve, 0)); h.active.value = true }
      if (mode === 'unmount') h.mounted.value = false
      if (mode === 'supersede') void h.view().loadInstanceStats()
    }, mode)
    const newer = await requests(), snapshot = () => page.eval(() => JSON.stringify({ stats: oldHostStats.instanceStats,
      ready: oldHostStats.statsReady, loading: oldHostStats.statsLoading, error: oldHostStats.statsError, toasts: hostInfoHarness.toast.toasts.value }))
    const before = await snapshot()
    if (fail) await run(index => window.hostInfoHarness.pending[index].reject(Error('obsolete middle page')), old)
    else await accept(old, 2)
    assert.equal(await requests(), newer, `${mode}: obsolete second page stops requesting`)
    assert.equal(await snapshot(), before, `${mode}: obsolete second page keeps current stats/error/loading/toasts`)
    stale++
  }
  console.log(`PASS ${stale} old middle-page success/failure receipts across host/session/cache/ABA/unmount/supersession`)
  await fresh(); await accept(await last(), 1, { instances: [], total: 0, totalPages: 0 })
  assert.deepEqual(await stats(), { count: 0, cpuUsed: 0, memoryUsed: 0, diskUsed: 0 })
  assert.equal(await page.eval(() => window.hostInfoHarness.view().statsReady && !window.hostInfoHarness.view().statsError), true)
  await fresh(); await accept(await last(), 1, { instances: [{ id: 1, hostId: 11, cpu: 1e308 }, { id: 2, hostId: 11, cpu: 1e308 }], total: 2, totalPages: 1 })
  assert.equal(await page.eval(() => window.hostInfoHarness.view().statsError && !window.hostInfoHarness.view().statsReady), true, 'finite rows cannot publish an overflowing aggregate')
  await fresh(); await accept(await last(), 1, { instances: [{ id: 1, hostId: 11, cpu: null, memory: 0 }], total: 1, totalPages: 1 })
  assert.deepEqual(await stats(), { count: 1, cpuUsed: 0, memoryUsed: 0, diskUsed: 0 }, 'nullable and missing legacy resource fields retain their original zero contribution')
  for (const locale of ['zh-CN', 'zh-TW', 'en']) for (const width of [1440, 768, 390]) {
    await fresh(); await page.setViewport({ width, height: 1000 }); await run(locale => window.hostInfoHarness.setLocale(locale), locale)
    await accept(await last(), 1); await accept(await last(), 2); await accept(await last(), 3)
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: resolve(output, `${locale}-${width}-totals.png`), fullPage: true })
  }
  assert.equal(await page.eval(() => hostInfoHarness.pending.every(r => ['instances', 'traffic', 'agent'].includes(r.kind))), true, 'statistics read performs no mutations')
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log('PASS true zero totals and three locale/width totals without overflow; read-only API')
} finally { if (browser) await browser.close(); await server.close() }
