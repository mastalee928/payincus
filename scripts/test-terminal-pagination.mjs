import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { Browser, sleep } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'
const root = fileURLToPath(new URL('..', import.meta.url)).replaceAll('\\', '/')
const require = createRequire(new URL('../client/package.json', import.meta.url))
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href), { default: vue } = await import(pathToFileURL(require.resolve('@vitejs/plugin-vue')).href)
const output = resolve(root, 'logs/terminal-pagination'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js'); tailwind.content = [root + '/client/src/**/*.{vue,js,ts}']
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/terminal-lifecycle', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/terminal-lifecycle/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } }, server: { host: '127.0.0.1', port: 19773, strictPort: true, fs: { allow: [root] } }
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(50); return result }
  const fresh = async () => {
    await page.goto('http://127.0.0.1:19773?session-test=1', { settleMs: 200 }); const deadline = Date.now() + 15000
    while (!await page.eval(() => !!window.terminalHarness?.view() && window.terminalHarness.pending.some(r => r.kind === 'instances'))) { if (Date.now() > deadline) throw Error('terminal fixture: ' + page.consoleErrors.join('\n')); await sleep(50) }
  }
  const last = () => page.eval(() => window.terminalHarness.pending.findLastIndex(r => r.kind === 'instances'))
  const count = () => page.eval(() => window.terminalHarness.pending.filter(r => r.kind === 'instances').length)
  const view = key => page.eval(key => JSON.parse(JSON.stringify(window.terminalHarness.view()[key])), key)
  const rows = Array.from({ length: 237 }, (_, index) => ({ id: index + 1, userId: 1, name: `Terminal machine ${index + 1}`,
    status: index < 100 ? 'stopped' : 'running', image: 'debian/13', hostCountryCode: 'de' }))
  const accept = (index, pageNumber, edits = {}) => run(({ index, pageNumber, rows, edits }) => {
    window.terminalHarness.pending[index].resolve({ instances: rows.slice((pageNumber - 1) * 100, pageNumber * 100),
      page: pageNumber, pageSize: 100, total: rows.length, totalPages: 3, ...edits })
  }, { index, pageNumber, rows, edits })
  await fresh()
  assert.deepEqual(await page.eval(() => window.terminalHarness.pending.find(r => r.kind === 'instances').data), { page: 1, pageSize: 100 }, 'terminal must send real paginated parameters instead of unsupported limit')
  await accept(await last(), 1); assert.equal(await count(), 2)
  assert.equal((await view('instances')).length, 0, 'incomplete terminal options cannot be selected')
  assert.equal(await view('loadingInstances'), true)
  await accept(await last(), 2); await accept(await last(), 3)
  assert.equal((await view('instances')).length, 237)
  assert.equal((await view('runningInstances')).length, 137, 'running instances beyond the first page remain available')
  await run(() => { const v = window.terminalHarness.view(); v.showInstanceSelector = true; v.instanceSearchQuery = 'Terminal machine 237' })
  assert.equal((await view('filteredRunningInstances'))[0].id, 237)
  await run(() => { window.terminalHarness.view().selectedInstanceId = 237 })
  assert.equal((await view('selectedInstance')).id, 237)
  console.log('PASS 237 sequential terminal options; 137 running machines beyond page one can be searched and selected')

  for (const edits of [{ page: 1 }, { total: 238 }, { totalPages: 4 }, { instances: rows.slice(100, 199) },
    { instances: [rows[0], ...rows.slice(101, 200)] }, { instances: [{ ...rows[100], userId: 2 }, ...rows.slice(101, 200)] },
    { instances: [{ ...rows[100], status: null }, ...rows.slice(101, 200)] }]) {
    await fresh(); await accept(await last(), 1); await accept(await last(), 2, edits)
    assert.equal(await count(), 2)
    assert.equal((await view('instances')).length, 0)
    assert.ok(await view('instancesError'))
    assert.equal(await view('loadingInstances'), false)
  }
  console.log('PASS invalid metadata, partial/duplicate/foreign rows and invalid status reject incomplete selectors')
  await fresh(); await accept(await last(), 1)
  await run(() => window.terminalHarness.pending.at(-1).reject(Error('controlled terminal page unavailable')))
  assert.ok(await view('instancesError'))
  await run(() => { window.terminalHarness.view().showInstanceSelector = true })
  await run(() => document.querySelector('[data-testid="terminal-instances-retry"]').click())
  assert.equal(await count(), 3)
  await accept(await last(), 1); await accept(await last(), 2); await accept(await last(), 3)
  assert.equal(await view('instancesError'), '')
  assert.equal((await view('instances')).length, 237)
  console.log('PASS persistent read error and actual retry reload all pages')

  let stale = 0
  for (const mode of ['account', 'sid', 'role', 'logout', 'session-aba', 'cache', 'cache-aba', 'unmount', 'supersede']) for (const fail of [false, true]) {
    await fresh(); await accept(await last(), 1); const old = await last()
    await run(async mode => {
      const h = window.terminalHarness
      if (mode === 'account') h.auth.user = { id: 2, username: 'fixture-b', role: 'user' }
      if (mode === 'sid') h.auth.token = `fixture.${btoa(JSON.stringify({ sid: 'b' }))}.fixture`
      if (mode === 'role') h.auth.user = { ...h.auth.user, role: 'admin' }
      if (mode === 'logout') h.auth.token = null
      if (mode === 'session-aba') { h.auth.user = { id: 2, role: 'user' }; h.auth.user = { id: 1, role: 'user' } }
      if (mode === 'cache' || mode === 'cache-aba') h.state.active = false
      if (mode === 'cache-aba') { await Promise.resolve(); await Promise.resolve(); h.state.active = true }
      if (mode === 'unmount') h.state.mounted = false
      if (mode === 'supersede') void h.view().loadInstances()
    }, mode)
    const newer = await count()
    const snapshot = () => page.eval(() => { const v = window.terminalHarness.view(); return JSON.stringify({ instances: v.instances, error: v.instancesError, loading: v.loadingInstances, selected: v.selectedInstanceId }) })
    const before = await snapshot()
    if (fail) await run(index => window.terminalHarness.pending[index].reject(Error('obsolete terminal page unavailable')), old)
    else await accept(old, 2)
    assert.equal(await count(), newer, `${mode}: obsolete second page cannot request a third`)
    assert.equal(await snapshot(), before, `${mode}: obsolete page cannot replace current inventory/error/loading`)
    stale++
  }
  console.log(`PASS ${stale} obsolete middle-page success/failure receipts across account/session/role/logout/ABA/cache/unmount/supersession`)
  await fresh(); await accept(await last(), 1, { instances: [], total: 0, totalPages: 0 })
  assert.equal(await view('instancesError'), ''); assert.equal((await view('instances')).length, 0); assert.equal(await count(), 1)
  for (const locale of ['zh-CN', 'zh-TW', 'en']) for (const width of [1440, 768, 390]) {
    await fresh(); await page.setViewport({ width, height: 1000 })
    await run(({ locale, width }) => { const h = window.terminalHarness; h.setLocale(locale); h.theme.setTheme(width === 390 ? 'dark' : 'light'); h.view().showInstanceSelector = true }, { locale, width })
    await run(() => window.terminalHarness.pending.findLast(r => r.kind === 'instances').reject({ message: 'The instance list could not be loaded.' }))
    assert.ok(await view('instancesError'))
    assert.equal(await page.eval(() => {
      const button = document.querySelector('[data-testid="terminal-instances-retry"]'), bounds = button.getBoundingClientRect()
      button.focus()
      return bounds.width >= 44 && bounds.height >= 44 && document.activeElement === button && button.closest('[role="alert"]') !== null && document.documentElement.scrollWidth <= innerWidth
    }), true)
    await page.screenshot({ path: resolve(output, `${locale}-${width}-error.png`), fullPage: true })
    await run(() => document.querySelector('[data-testid="terminal-instances-retry"]').click())
    await accept(await last(), 1); await accept(await last(), 2); await accept(await last(), 3)
    assert.equal(await view('instancesError'), ''); assert.equal((await view('runningInstances')).length, 137)
  }
  console.log('PASS actual error/retry in three locales and widths, 44px focusable control and no page overflow')
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log('PASS legitimate empty terminal inventory')
} finally { if (browser) await browser.close(); await server.close() }
