import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { Browser, sleep } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'
const root = fileURLToPath(new URL('..', import.meta.url)).replaceAll('\\', '/'), require = createRequire(new URL('../client/package.json', import.meta.url))
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href), { default: vue } = await import(pathToFileURL(require.resolve('@vitejs/plugin-vue')).href)
const output = resolve(root, 'logs/login-history-reads'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js'); tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/login-history/*.js']
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/login-history', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/login-history/api.js' }, { find: '@', replacement: root + '/client/src' }, ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } }, server: { host: '127.0.0.1', port: 19736, strictPort: true, fs: { allow: [root] } },
})
const record = id => ({ id, ip: '192.0.2.' + id, country: null, region: null, city: null, isp: null, timezone: null, userAgent: 'Mozilla/5.0 (Linux; Android 13) Chrome/119.0.0.0', createdAt: '2026-10-29T04:05:06.000Z' })
const result = (page, total = 9) => ({ records: [record(page)], total, page, pageSize: 3, totalPages: Math.ceil(total / 3) })
let browser, stale = 0
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  const run = async (fn, arg) => { const value = await page.eval(fn, arg); await sleep(40); return value }
  const fresh = async () => {
    await page.goto('http://127.0.0.1:19736', { settleMs: 250 })
    const deadline = Date.now() + 15000
    while (!await page.eval(() => !!window.historyHarness?.view())) { if (Date.now() > deadline) throw Error('History fixture did not mount'); await sleep(70) }
  }
  const settle = (index, data, fail = false) => run(({ index, data, fail }) => { const x = window.historyHarness.pending[index]; fail ? x.reject(Error('Fixture history unavailable')) : x.resolve(data) }, { index, data, fail })
  await fresh(); await settle(0, result(1))
  await run(() => { const v = window.historyHarness.view(); v.goToPage(2); v.goToPage(3) })
  await settle(2, result(3)); await settle(1, result(2))
  assert.deepEqual(await page.eval(() => window.historyHarness.view().records.map(r => r.id)), [3], 'late page two must not overwrite the selected page three')
  assert.equal(await page.eval(() => window.historyHarness.view().page), 3)
  await fresh(); await settle(0, result(1)); await run(() => { const v = window.historyHarness.view(); void v.loadRecords(); void v.loadRecords() })
  await settle(2, { ...result(1), records: [record(8)] }); await settle(1, result(1))
  assert.equal(await page.eval(() => window.historyHarness.view().records[0].id), 8, 'newer same-page refresh wins')
  await fresh(); await settle(0, result(1)); await run(() => { window.historyHarness.view().goToPage(3) })
  await settle(1, { ...result(3, 1), records: [] })
  assert.equal(await page.eval(() => window.historyHarness.view().page), 1, 'contracted history changes the selected page to the current last page')
  assert.equal(await page.eval(() => window.historyHarness.pending.at(-1).data.page), 1, 'contraction reads the valid page rather than returning an empty result')
  await settle(2, result(1, 1)); assert.equal(await page.eval(() => window.historyHarness.view().records.length), 1)
  for (const mode of ['account', 'sid', 'role', 'logout', 'session-aba', 'cache', 'unmount']) for (const fail of [false, true]) {
    await fresh(); await settle(0, result(1)); await run(() => { void window.historyHarness.view().loadRecords() })
    await run(mode => { const h = window.historyHarness; window.oldHistoryView = h.view()
      if (mode === 'account') h.session(2)
      if (mode === 'sid') h.session(1, 'other-history')
      if (mode === 'role') h.session(1, 'history-session', 'admin')
      if (mode === 'logout') h.auth.clearLocalAuth()
      if (mode === 'session-aba') { h.session(2); h.session(1) }
      if (mode === 'cache') h.active.value = false
      if (mode === 'unmount') h.mounted.value = false
    }, mode)
    const before = await page.eval(() => JSON.stringify({ rows: window.oldHistoryView.records, total: window.oldHistoryView.total, error: window.oldHistoryView.loadError, page: window.oldHistoryView.page }))
    await settle(1, result(1), fail)
    assert.equal(await page.eval(() => JSON.stringify({ rows: window.oldHistoryView.records, total: window.oldHistoryView.total, error: window.oldHistoryView.loadError, page: window.oldHistoryView.page })), before)
    assert.equal(await page.eval(() => window.oldHistoryView.records.length), 0, 'lifecycle change clears login IP and device records')
    if (mode === 'cache') { await run(() => { window.historyHarness.active.value = true }); assert.equal(await page.eval(() => window.historyHarness.pending.length), 3); await settle(2, result(1)) }
    stale++
  }
  await fresh(); await run(() => { window.historyHarness.auth.token = 'fixture.' + btoa(JSON.stringify({ sid: 'history-session', revision: 2 })) + '.fixture' }); await settle(0, result(1))
  assert.equal(await page.eval(() => window.historyHarness.view().records.length), 1)
  for (const bad of [null, {}, { ...result(1), records: null }, { ...result(1), records: [null] }, { ...result(1), page: 2 }, { ...result(1), pageSize: 4 }, { ...result(1), total: -1 }, { ...result(1), totalPages: 99 }, { ...result(1), records: [record(1), record(1)] }, { ...result(1), records: [{ ...record(1), createdAt: 'invalid' }] }]) {
    await fresh(); await settle(0, bad)
    assert.ok(await page.eval(() => document.querySelector('[data-history-error]')?.textContent), 'unconfirmed read has a persistent retry error')
    assert.equal(await page.eval(() => document.querySelector('[data-history-empty]') !== null), false, 'failure cannot appear as empty history')
    await run(() => document.querySelector('[data-history-error] button').click()); await settle(1, result(1))
    assert.equal(await page.eval(() => window.historyHarness.view().records.length), 1)
  }
  await fresh(); await settle(0, result(1)); await run(() => { void window.historyHarness.view().loadRecords() }); await settle(1, null, true)
  assert.equal(await page.eval(() => window.historyHarness.view().records.length), 1, 'refresh failure preserves the current last good page')
  await run(() => { window.historyHarness.view().goToPage(2) })
  assert.equal(await page.eval(() => window.historyHarness.view().records.length), 0, 'old page records clear before selecting another page')
  await settle(2, null, true)
  for (const [locale, width] of [['zh-CN', 1440], ['zh-TW', 768], ['en', 390]]) {
    await page.setViewport({ width, height: 1000, mobile: width === 390 }); await run(locale => { window.historyHarness.setLocale(locale); window.historyHarness.theme.setTheme(innerWidth === 390 ? 'dark' : 'light') }, locale)
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: resolve(output, `${locale}-${width}.png`), format: 'png' })
  }
  await fresh(); await settle(0, { ...result(1), records: [{ ...record(1), ip: '已隐藏', country: null, region: null, city: null, isp: null, timezone: null, userAgent: null }] })
  assert.ok(await page.eval(() => document.querySelector('#app').textContent.includes('已隐藏')), 'redacted demo record stays hidden')
  assert.equal(await page.eval(() => document.querySelector('#app').textContent.includes('Android · Chrome')), false)
  await fresh(); await settle(0, { records: [], total: 0, page: 1, pageSize: 3, totalPages: 0 })
  assert.ok(await page.eval(() => document.querySelector('[data-history-empty]')), 'confirmed zero inventory uses the real empty state')
  await fresh(); await settle(0, result(1)); await run(() => { [...document.querySelectorAll('button')].find(button => button.textContent.trim() === window.historyHarness.t('common.next')).click() })
  assert.equal(await page.eval(() => window.historyHarness.pending.at(-1).data.page), 2, 'real next-page button requests its selected page')
  await settle(1, result(2))
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log(`PASS actual history pagination and same-page ordering, contraction, ${stale} old lifecycle receipts, strict failed reads/current retry and three-language layout; read only`)
} finally { if (browser) await browser.close(); await server.close() }
