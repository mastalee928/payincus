import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { Browser, sleep } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'
import { probe, app, layout } from '../.agents/skills/design-taste-frontend/scripts/lib/probe.mjs'
import { judge, judgeApp, judgeLayout, APP_SKIP } from '../.agents/skills/design-taste-frontend/scripts/lib/rules.mjs'
const root = fileURLToPath(new URL('..', import.meta.url)).replaceAll('\\', '/'), require = createRequire(new URL('../client/package.json', import.meta.url))
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href), { default: vue } = await import(pathToFileURL(require.resolve('@vitejs/plugin-vue')).href)
const output = resolve(root, 'logs/my-host-calibration'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js'); tailwind.content = [root + '/client/src/**/*.{vue,js,ts}']
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/my-host-calibration', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/my-host-calibration/api.js' }, { find: '@', replacement: root + '/client/src' }, ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } }, server: { host: '127.0.0.1', port: 19778, strictPort: true, fs: { allow: [root] } }
})
const rows = Array.from({ length: 237 }, (_, i) => ({ id: i + 1, name: `Dedicated host ${i + 1}`, status: i < 100 ? 'offline' : 'online', owner: { id: 1 } }))
const values = { cpuUsed: 100, memoryUsed: 512, diskUsed: 2048, natPortsUsedCount: 2, cpuAllowanceMax: 100, memoryMax: 512 }
const receipt = { message: '资源校对完成，无差异', hasChanges: false, before: values, after: values, diff: Object.fromEntries(Object.keys(values).map(key => [key, 0])) }
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(35); return result }
  const fresh = async (admin = true) => {
    await page.goto('http://127.0.0.1:19778', { settleMs: 200 }); const deadline = Date.now() + 15000
    while (!await page.eval(() => !!window.hostCalibrationHarness?.view()?.calibrateAll)) { if (Date.now() > deadline) throw Error('MyHosts fixture did not mount'); await sleep(50) }
    await run(async admin => { const h = hostCalibrationHarness; h.auth.user = { ...h.auth.user, role: admin ? 'admin' : 'user' }; await h.nextTick()
      h.pending.splice(0); void h.view().loadHosts() }, admin)
    await run(() => hostCalibrationHarness.pending.findLast(r => r.kind === 'list').resolve({ hosts: [], page: 1, pageSize: 100, total: 237, totalPages: 3 }))
  }
  const count = kind => page.eval(kind => hostCalibrationHarness.pending.filter(r => r.kind === kind).length, kind)
  const last = kind => page.eval(kind => hostCalibrationHarness.pending.findLastIndex(r => r.kind === kind), kind)
  const accept = (index, number, edits = {}) => run(({ index, number, rows, edits }) => hostCalibrationHarness.pending[index].resolve({
    hosts: rows.slice((number - 1) * 100, number * 100), page: number, pageSize: 100, total: rows.length, totalPages: 3, ...edits
  }), { index, number, rows, edits })
  const start = () => run(() => { void hostCalibrationHarness.view().calibrateAll() })
  const single = async () => {
    await start(); await accept(await last('list'), 1, { hosts: [rows[236]], total: 1, totalPages: 1 })
  }
  if (!process.argv.includes('--visual-only')) {
  await fresh(); await start(); await accept(await last('list'), 1)
  assert.equal(await count('write'), 0, 'calibration cannot write from a truncated first page')
  assert.equal(await page.eval(() => hostCalibrationHarness.pending.findLast(r => r.kind === 'list').data.page), 2, 'calibration requests page two before selecting targets')
  await accept(await last('list'), 2); await accept(await last('list'), 3)
  assert.equal(await count('write'), 1, 'batch dispatches one host at a time')
  await start(); assert.equal(await count('write'), 1, 'repeated click does not dispatch another write')
  for (let i = 0; i < 137; i++) await run(({ receipt, fail }) => {
    const request = hostCalibrationHarness.pending.findLast(r => r.kind === 'write')
    fail ? request.reject(Error('Gateway busy')) : request.resolve(receipt)
  }, { receipt, fail: i === 0 })
  assert.equal(await count('write'), 137)
  assert.equal(await page.eval(() => hostCalibrationHarness.pending.filter(r => r.kind === 'write').every((r, i) => r.id === i + 101)), true)
  await run(() => hostCalibrationHarness.pending.findLast(r => r.kind === 'list').resolve({ hosts: [], page: 1, pageSize: 100, total: 237, totalPages: 3 }))
  assert.equal(await page.eval(() => hostCalibrationHarness.view().calibrationResults.filter(r => r.status === 'failed').length), 1)
  assert.equal(await page.eval(() => hostCalibrationHarness.pending.filter(r => r.kind === 'list' && r.data.page).slice(1, 4).every(r => r.data.scope === 'mine' && !r.data.search)), true)
  console.log('PASS 237 complete owned hosts, offline first page, 137 sequential writes, duplicate gate and persistent individual failure')
  await run(() => document.querySelector('[data-testid="calibration-retry"]').click())
  assert.equal(await page.eval(() => hostCalibrationHarness.pending.findLast(r => r.kind === 'write').id), 101)
  await run(receipt => hostCalibrationHarness.pending.findLast(r => r.kind === 'write').resolve(receipt), receipt)
  await run(() => hostCalibrationHarness.pending.findLast(r => r.kind === 'list').resolve({ hosts: [], total: 0, totalPages: 0 }))
  assert.equal(await page.eval(() => hostCalibrationHarness.view().calibrationResults.filter(r => r.status === 'failed').length), 0)
  console.log('PASS actual retry writes only failed fixed target')
  for (const edits of [{ page: 1 }, { total: 238 }, { totalPages: 4 }, { hosts: rows.slice(100, 199) },
    { hosts: [rows[0], ...rows.slice(101, 200)] }, { hosts: [{ ...rows[100], owner: { id: 2 } }, ...rows.slice(101, 200)] }]) {
    await fresh(); await start(); await accept(await last('list'), 1); await accept(await last('list'), 2, edits)
    assert.equal(await count('write'), 0); assert.ok(await page.eval(() => hostCalibrationHarness.view().calibrationError)); assert.equal(await count('list'), 3)
  }
  await fresh(false); await single()
  assert.equal(await page.eval(() => hostCalibrationHarness.pending.findLast(r => r.kind === 'list').data.mine), 'true')
  await run(receipt => hostCalibrationHarness.pending.findLast(r => r.kind === 'write').resolve(receipt), receipt)
  console.log('PASS malformed/duplicate/foreign host pages stop all writes and ordinary owner retains mine filter')
  let stale = 0
  for (const stage of ['list', 'write']) for (const mode of ['account', 'sid', 'role', 'logout', 'session-aba', 'scope', 'scope-aba', 'route', 'route-aba', 'unmount']) for (const fail of [false, true]) {
    await fresh(); await start(); if (stage === 'write') await accept(await last('list'), 1, { hosts: rows.slice(100, 102), total: 2, totalPages: 1 })
    else await accept(await last('list'), 1)
    const old = await last(stage)
    await run(async mode => {
      const h = hostCalibrationHarness; window.oldCalibration = h.view()
      if (mode === 'account') h.auth.user = { ...h.auth.user, id: 2 }
      if (mode === 'sid') h.newSession('session-b')
      if (mode === 'role') h.auth.user = { ...h.auth.user, role: 'user' }
      if (mode === 'logout') h.auth.clearLocalAuth()
      if (mode === 'session-aba') { h.newSession('session-b'); h.newSession('session-a') }
      if (mode === 'scope' || mode === 'scope-aba') h.view().scope = 'hosted'
      if (mode === 'scope-aba') h.view().scope = 'mine'
      if (mode === 'route' || mode === 'route-aba') await h.router.push('/other')
      if (mode === 'route-aba') await h.router.push('/hosts')
      if (mode === 'unmount') h.unmount()
    }, mode)
    const n = await count('write'), lists = await count('list'), before = await page.eval(() => JSON.stringify({ results: oldCalibration.calibrationResults, error: oldCalibration.calibrationError, toasts: hostCalibrationHarness.toast.toasts.value }))
    if (fail) await run(index => hostCalibrationHarness.pending[index].reject(Error('obsolete calibration')), old)
    else if (stage === 'list') await accept(old, 2)
    else await run(({ index, receipt }) => hostCalibrationHarness.pending[index].resolve(receipt), { index: old, receipt })
    assert.equal(await count('write'), n, mode + ': no subsequent stale dispatch')
    assert.equal(await count('list'), lists, mode + ': no old refresh')
    assert.equal(await page.eval(() => JSON.stringify({ results: oldCalibration.calibrationResults, error: oldCalibration.calibrationError, toasts: hostCalibrationHarness.toast.toasts.value })), before)
    stale++
  }
  console.log(`PASS ${stale} old list/write success/failure receipts across authorization/scope/route/cache/ABA/unmount`)
  for (const invalid of [{}, { ...receipt, hasChanges: 'false' }, { ...receipt, hasChanges: true }, { ...receipt, after: { ...values, cpuUsed: -1 } },
    { ...receipt, diff: { ...receipt.diff, cpuUsed: 1 } }, { ...receipt, after: { ...values, memoryUsed: null } }]) {
    await fresh(); await single(); await run(receipt => hostCalibrationHarness.pending.findLast(r => r.kind === 'write').resolve(receipt), invalid)
    assert.equal(await page.eval(() => hostCalibrationHarness.view().calibrationResults[0].status), 'failed')
  }
  console.log('PASS malformed write receipts never count as success')
  }
  for (const locale of ['zh-CN', 'zh-TW', 'en']) for (const width of [1440, 768, 390]) for (const dark of [false, true]) {
    await fresh(); await page.setViewport({ width, height: 1000 })
    await run(({ locale, dark }) => { const h = hostCalibrationHarness; h.setLocale(locale); h.theme.setTheme(dark ? 'dark' : 'light') }, { locale, dark })
    await single(); await run(() => hostCalibrationHarness.pending.findLast(r => r.kind === 'write').reject(Error('Gateway busy')))
    await run(() => hostCalibrationHarness.pending.findLast(r => r.kind === 'list').resolve({ hosts: [], page: 1, pageSize: 100, total: 0, totalPages: 0 }))
    const dimensions = await page.eval(() => {
      const button = document.querySelector('[data-testid="calibration-retry"]'), rect = button.getBoundingClientRect(); button.focus()
      return { width: rect.width, height: rect.height, focus: document.activeElement === button, scrollWidth: document.documentElement.scrollWidth, viewport: innerWidth }
    })
    if (dimensions.width < 44 || dimensions.height < 44 || !dimensions.focus || dimensions.scrollWidth > dimensions.viewport) {
      await page.screenshot({ path: resolve(output, 'dimensions-failed.png'), fullPage: true })
      console.log(locale, width, dark, dimensions)
    }
    assert.ok(dimensions.width >= 44 && dimensions.height >= 44 && dimensions.focus && dimensions.scrollWidth <= dimensions.viewport)
    const colors = await page.eval(() => { const style = getComputedStyle(document.querySelector('[data-testid="calibration-retry"]')); return [style.color, style.backgroundColor] })
    assert.deepEqual(colors, dark ? ['rgb(10, 10, 10)', 'rgb(255, 255, 255)'] : ['rgb(255, 255, 255)', 'rgb(10, 10, 10)'])
    const metrics = await page.eval(probe); writeFileSync(resolve(output, `${locale}-${width}-${dark ? 'dark' : 'light'}.json`), JSON.stringify(metrics, null, 2))
    const panelText = await page.eval(() => document.querySelector('[data-testid="calibration-panel"]').textContent)
    assert.equal(metrics.color.lowContrast.filter(item => panelText.includes(item.text)).length, 0)
    const appMetrics = await page.eval(app), layoutMetrics = await page.eval(layout)
    const findings = [...judge(metrics, { width, allow: [] }).filter(f => !APP_SKIP.has(f.id) && !['no-title', 'small-title'].includes(f.id)),
      ...judgeApp(appMetrics, metrics, { width, allow: [] }), ...judgeLayout(layoutMetrics, { width, allow: [] })]
    writeFileSync(resolve(output, `${locale}-${width}-${dark ? 'dark' : 'light'}-findings.json`), JSON.stringify({ findings, appMetrics, layoutMetrics }, null, 2))
    await page.screenshot({ path: resolve(output, `${locale}-${width}-${dark ? 'dark' : 'light'}-error.png`), fullPage: true })
  }
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log('PASS 18 locale/width/theme screenshots with persistent errors, 44px keyboard retries, inverse contrast and no page overflow')
} finally { if (browser) await browser.close(); await server.close() }
