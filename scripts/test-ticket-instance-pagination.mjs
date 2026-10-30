import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { Browser, sleep } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'
import { probe } from '../.agents/skills/design-taste-frontend/scripts/lib/probe.mjs'
import { judge, APP_SKIP } from '../.agents/skills/design-taste-frontend/scripts/lib/rules.mjs'
const root = fileURLToPath(new URL('..', import.meta.url)).replaceAll('\\', '/')
const require = createRequire(new URL('../client/package.json', import.meta.url))
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href), { default: vue } = await import(pathToFileURL(require.resolve('@vitejs/plugin-vue')).href)
const output = resolve(root, 'logs/ticket-instance-pagination'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js'); tailwind.content = [root + '/client/src/**/*.{vue,js,ts}']
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/ticket-lifecycle', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/ticket-lifecycle/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } }, server: { host: '127.0.0.1', port: 19775, strictPort: true, fs: { allow: [root] } }
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(50); return result }
  const fresh = async () => {
    await page.goto('http://127.0.0.1:19775', { settleMs: 200 }); const deadline = Date.now() + 15000
    while (!await page.eval(() => !!window.ticketHarness?.view())) { if (Date.now() > deadline) throw Error('ticket fixture: ' + page.consoleErrors.join('\n')); await sleep(50) }
    await run(() => window.ticketHarness.router.push('/tickets?compose=1'))
    while (!await page.eval(() => window.ticketHarness.pending.some(r => r.kind === 'instances'))) { if (Date.now() > deadline) throw Error('compose inventory unavailable'); await sleep(50) }
  }
  const last = () => page.eval(() => window.ticketHarness.pending.findLastIndex(r => r.kind === 'instances'))
  const count = () => page.eval(() => window.ticketHarness.pending.filter(r => r.kind === 'instances').length)
  const view = key => page.eval(key => JSON.parse(JSON.stringify(window.ticketHarness.view()[key])), key)
  const rows = Array.from({ length: 237 }, (_, index) => ({ id: index + 1, userId: 1, name: `Support machine ${index + 1}`,
    status: index < 100 ? 'stopped' : 'running', image: 'debian/13', instanceType: 'container', host: { name: 'Dedicated fixture host', country_code: 'de' } }))
  const accept = (index, pageNumber, edits = {}) => run(({ index, pageNumber, rows, edits }) => {
    window.ticketHarness.pending[index].resolve({ instances: rows.slice((pageNumber - 1) * 100, pageNumber * 100),
      page: pageNumber, pageSize: 100, total: rows.length, totalPages: 3, ...edits })
  }, { index, pageNumber, rows, edits })
  await fresh(); await accept(await last(), 1)
  assert.equal((await view('availableInstances')).length, 0, 'a ticket cannot display a first-page-only inventory as complete')
  assert.equal(await count(), 2, 'ticket selector requests the second page')
  await accept(await last(), 2); await accept(await last(), 3)
  assert.equal((await view('formattedInstances')).length, 237)
  await run(() => document.querySelector('form button[type="button"]').click())
  await run(() => [...document.querySelectorAll('form button')].find(button => button.textContent.includes('Support machine 237')).click())
  assert.equal((await view('createForm')).instanceId, 237, 'third-page instance can be selected through the real dropdown')
  await run(async () => {
    const h = window.ticketHarness, { default: api } = await import('/api.js')
    api.tickets.create = data => new Promise((resolve, reject) => h.pending.push({ kind: 'create', data, resolve, reject }))
    h.view().createForm.subject = 'Third page machine'; h.view().createForm.content = 'Please check the third page machine.'
    void h.view().submitCreate()
  })
  assert.equal(await page.eval(() => window.ticketHarness.pending.findLast(r => r.kind === 'create').data.instanceId), 237)
  console.log('PASS 237 complete ticket instance choices, real dropdown third-page selection and original create payload')
  for (const edits of [{ page: 1 }, { total: 238 }, { totalPages: 4 }, { instances: rows.slice(100, 199) },
    { instances: [rows[0], ...rows.slice(101, 200)] }, { instances: [{ ...rows[100], userId: 2 }, ...rows.slice(101, 200)] },
    { instances: [{ ...rows[100], name: null }, ...rows.slice(101, 200)] }]) {
    await fresh(); await accept(await last(), 1); await accept(await last(), 2, edits)
    assert.equal(await count(), 2); assert.equal((await view('availableInstances')).length, 0)
    assert.ok(await view('instancesError')); assert.equal(await view('instancesLoading'), false)
  }
  console.log('PASS seven invalid middle pages reject incomplete/duplicate/foreign choices')
  await fresh(); await accept(await last(), 1)
  await run(() => window.ticketHarness.pending.findLast(r => r.kind === 'instances').reject({ message: 'The instance list could not be loaded.' }))
  assert.ok(await view('instancesError'))
  await run(() => document.querySelector('[data-testid="ticket-instances-retry"]').click())
  await accept(await last(), 1); await accept(await last(), 2); await accept(await last(), 3)
  assert.equal((await view('availableInstances')).length, 237); assert.equal(await view('instancesError'), '')
  console.log('PASS actual persistent error and retry complete the selector')
  let stale = 0
  for (const mode of ['account', 'sid', 'role', 'logout', 'session-aba', 'cache', 'cache-aba', 'route', 'route-aba', 'unmount', 'supersede']) for (const fail of [false, true]) {
    await fresh(); await accept(await last(), 1); const old = await last()
    await run(async mode => {
      const h = window.ticketHarness
      if (mode === 'account') h.auth.user = { id: 2, username: 'fixture-b', role: 'user' }
      if (mode === 'sid') h.session('b')
      if (mode === 'role') h.session('a', 'admin')
      if (mode === 'logout') h.session(null)
      if (mode === 'session-aba') { h.session('b'); h.session('a') }
      if (mode === 'cache' || mode === 'cache-aba' || mode === 'route' || mode === 'route-aba') await h.router.push(mode.startsWith('cache') ? '/other' : '/tickets')
      if (mode === 'cache-aba' || mode === 'route-aba') await h.router.push('/tickets?compose=1')
      if (mode === 'unmount') h.state.mounted = false
      if (mode === 'supersede') void h.view().loadAvailableInstances()
    }, mode)
    const newer = await count()
    const snapshot = () => page.eval(() => { const h = window.ticketHarness, v = h.view(); return JSON.stringify({ instances: v.availableInstances, error: v.instancesError, loading: v.instancesLoading, form: v.createForm, toasts: h.toasts }) })
    const before = await snapshot()
    if (fail) await run(index => window.ticketHarness.pending[index].reject(Error('obsolete ticket instance page')), old)
    else await accept(old, 2)
    assert.equal(await count(), newer, `${mode}: obsolete second page stops dispatch`)
    assert.equal(await snapshot(), before, `${mode}: obsolete second page preserves current data/error/loading/form/toasts`)
    stale++
  }
  console.log(`PASS ${stale} old middle-page success/failure receipts across session/route/cache/ABA/unmount/supersession`)
  await fresh(); await accept(await last(), 1, { instances: [], total: 0, totalPages: 0 })
  assert.equal(await view('instancesError'), ''); assert.equal((await view('availableInstances')).length, 0); assert.equal(await count(), 1)
  for (const locale of ['zh-CN', 'zh-TW', 'en']) for (const width of [1440, 768, 390]) for (const dark of [false, true]) {
    await fresh(); await page.setViewport({ width, height: 1000 })
    await run(({ locale, dark }) => { const h = window.ticketHarness; h.setLocale(locale); h.theme.setTheme(dark ? 'dark' : 'light') }, { locale, dark })
    await run(() => window.ticketHarness.pending.findLast(r => r.kind === 'instances').reject({ message: 'The instance list could not be loaded.' }))
    assert.equal(await page.eval(() => { const b = document.querySelector('[data-testid="ticket-instances-retry"]'), r = b.getBoundingClientRect(); b.focus(); return r.width >= 44 && r.height >= 44 && document.activeElement === b && !!b.closest('[role="alert"]') && document.documentElement.scrollWidth <= innerWidth }), true)
    const metrics = await page.eval(() => {
      const button = document.querySelector('[data-testid="ticket-instances-retry"]'), style = getComputedStyle(button), rect = button.getBoundingClientRect()
      const luminance = color => {
        const values = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => { value /= 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4 })
        return values[0] * .2126 + values[1] * .7152 + values[2] * .0722
      }
      const foreground = luminance(style.color), background = luminance(style.backgroundColor)
      return { text: button.textContent.trim(), color: style.color, background: style.backgroundColor,
        contrast: (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05), width: rect.width, height: rect.height }
    })
    const label = `${locale}-${width}-${dark ? 'dark' : 'light'}`
    writeFileSync(resolve(output, `${label}-retry.json`), JSON.stringify(metrics, null, 2))
    await page.screenshot({ path: resolve(output, `${label}-error.png`), fullPage: true })
    assert.ok(metrics.contrast >= 4.5, `${label}: actual retry text contrast ${metrics.contrast.toFixed(2)}:1 must reach 4.5:1`)
    assert.equal(metrics.background, dark ? 'rgb(255, 255, 255)' : 'rgb(10, 10, 10)', `${label}: inverse background follows the actual theme`)
    assert.equal(metrics.color, dark ? 'rgb(10, 10, 10)' : 'rgb(255, 255, 255)', `${label}: inverse text follows the actual theme`)
    const pageMetrics = await page.eval(probe)
    const findings = judge(pageMetrics, { width }).filter(finding => !APP_SKIP.has(finding.id))
    writeFileSync(resolve(output, `${label}-inspect.json`), JSON.stringify({ metrics: pageMetrics, findings,
      scope: 'Only the added instance inventory retry is edited; original full-form findings remain open.' }, null, 2))
    assert.equal(pageMetrics.color.lowContrast.some(item => item.text === metrics.text), false, `${label}: taste probe also accepts the actual retry`)
  }
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log('PASS real empty inventory and 18 locale/width/theme errors, 44px keyboard retry, text contrast and no page overflow')
} finally { if (browser) await browser.close(); await server.close() }
