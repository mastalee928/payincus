import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { Browser, sleep } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'
const root = fileURLToPath(new URL('..', import.meta.url)).replaceAll('\\', '/'), require = createRequire(new URL('../client/package.json', import.meta.url))
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href), { default: vue } = await import(pathToFileURL(require.resolve('@vitejs/plugin-vue')).href)
const output = resolve(root, 'logs/package-host-pagination'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js'); tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/package-form/*.js']
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/package-form', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/package-form/api.js' }, { find: '@', replacement: root + '/client/src' }, ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } }, server: { host: '127.0.0.1', port: 19777, strictPort: true, fs: { allow: [root] } }
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(50); return result }
  const fresh = async (admin = true) => {
    await page.goto('http://127.0.0.1:19777', { settleMs: 250 }); const deadline = Date.now() + 15000
    while (!await page.eval(() => !!window.packageHarness?.view())) { if (Date.now() > deadline) throw Error('Package host fixture did not mount'); await sleep(50) }
    await run(async admin => { const h = window.packageHarness; h.auth.user = { id: 1, username: 'fixture', role: admin ? 'admin' : 'user' }; await h.nextTick(); h.pending.splice(0); await h.router.push('/plans') }, admin)
    while (!await page.eval(() => window.packageHarness.view()?.loadHosts)) { if (Date.now() > deadline) throw Error('Package inventory did not mount'); await sleep(50) }
  }
  const count = () => page.eval(() => packageHarness.pending.filter(r => r.kind === 'hosts').length)
  const last = () => page.eval(() => packageHarness.pending.findLastIndex(r => r.kind === 'hosts'))
  const rows = Array.from({ length: 237 }, (_, i) => ({ id: i + 1, name: `Dedicated host ${i + 1}`, status: 'online', owner: { id: 1 } }))
  const accept = (index, number, edits = {}) => run(({ index, number, rows, edits }) => packageHarness.pending[index].resolve({
    hosts: rows.slice((number - 1) * 100, number * 100), page: number, pageSize: 100, total: rows.length, totalPages: 3, ...edits
  }), { index, number, rows, edits })
  await fresh(); await accept(await last(), 1)
  assert.equal(await page.eval(() => packageHarness.view().hosts.length), 0, 'package host names are only published from a complete inventory')
  assert.equal(await count(), 2, 'package host names fetch the second page')
  await accept(await last(), 2); await accept(await last(), 3)
  assert.equal(await page.eval(() => packageHarness.view().getHostNames({ host_ids: [237] })), 'Dedicated host 237')
  await run(() => packageHarness.pending.findLast(r => r.kind === 'list').resolve({ packages: [{ id: 1, name: 'Package for third-page host', host_ids: [237], isOwn: true, active: 1 }] }))
  await run(() => { packageHarness.view().searchQuery = 'Dedicated host 237' })
  assert.equal(await page.eval(() => packageHarness.view().filteredPackages.length), 1)
  assert.equal(await page.eval(() => packageHarness.pending.filter(r => r.kind === 'hosts').every((r, index) => r.data.page === index + 1 && r.data.pageSize === 100 && !r.data.mine)), true)
  console.log('PASS complete package host names and search beyond page one; original administrator filter')
  for (const edits of [{ page: 1 }, { total: 238 }, { totalPages: 4 }, { hosts: rows.slice(100, 199) },
    { hosts: [rows[0], ...rows.slice(101, 200)] }, { hosts: [{ ...rows[100], name: null }, ...rows.slice(101, 200)] }]) {
    await fresh(); await accept(await last(), 1); await accept(await last(), 2, edits)
    assert.equal(await count(), 2); assert.equal(await page.eval(() => packageHarness.view().hosts.length), 0)
    assert.ok(await page.eval(() => packageHarness.view().hostsError)); assert.equal(await page.eval(() => packageHarness.view().hostsLoading), false)
  }
  await fresh(false); await accept(await last(), 1)
  assert.equal(await page.eval(() => packageHarness.pending.filter(r => r.kind === 'hosts').every(r => r.data.mine === 'true')), true)
  await accept(await last(), 2, { hosts: [{ ...rows[100], owner: { id: 2 } }, ...rows.slice(101, 200)] })
  assert.equal(await count(), 2); assert.ok(await page.eval(() => packageHarness.view().hostsError))
  console.log('PASS malformed pages and foreign ordinary-user owner are rejected without losing original mine filter')
  await fresh(); await accept(await last(), 1); await accept(await last(), 2); await accept(await last(), 3)
  await run(() => { void packageHarness.view().loadHosts() }); await accept(await last(), 1)
  await run(() => packageHarness.pending.findLast(r => r.kind === 'hosts').reject(Error('Host names unavailable')))
  assert.equal(await page.eval(() => packageHarness.view().hosts.length), 237)
  assert.ok(await page.eval(() => packageHarness.view().hostsError))
  await run(() => document.querySelector('[data-testid="package-hosts-retry"]').click())
  await accept(await last(), 1); await accept(await last(), 2); await accept(await last(), 3)
  assert.equal(await page.eval(() => packageHarness.view().hostsError), '')
  console.log('PASS last complete inventory survives failed refresh and real persistent retry recovers')
  let stale = 0
  for (const mode of ['account', 'sid', 'role', 'logout', 'session-aba', 'route', 'route-aba', 'supersede']) for (const fail of [false, true]) {
    await fresh(); await accept(await last(), 1); const old = await last()
    await run(async mode => {
      const h = packageHarness; window.oldPackageInventory = h.view()
      if (mode === 'account') h.auth.user = { ...h.auth.user, id: 2 }
      if (mode === 'sid') h.newSession('session-b')
      if (mode === 'role') h.auth.user = { ...h.auth.user, role: 'user' }
      if (mode === 'logout') h.auth.clearLocalAuth()
      if (mode === 'session-aba') { h.newSession('session-b'); h.newSession('session-a') }
      if (mode === 'route' || mode === 'route-aba') await h.router.push('/other')
      if (mode === 'route-aba') await h.router.push('/plans')
      if (mode === 'supersede') void h.view().loadHosts()
    }, mode)
    const newer = await count(), snapshot = () => page.eval(() => JSON.stringify({ hosts: oldPackageInventory.hosts,
      error: oldPackageInventory.hostsError, loading: oldPackageInventory.hostsLoading, toasts: packageHarness.toast.toasts.value }))
    const before = await snapshot()
    if (fail) await run(index => packageHarness.pending[index].reject(Error('obsolete host inventory')), old)
    else await accept(old, 2)
    assert.equal(await count(), newer, `${mode}: old second page stops dispatch`)
    assert.equal(await snapshot(), before, `${mode}: old inventory cannot replace current data/error/loading/toasts`)
    stale++
  }
  console.log(`PASS ${stale} old second-page success/failure receipts across session/route/cache/ABA/supersession`)
  await fresh(); await accept(await last(), 1, { hosts: [], total: 0, totalPages: 0 })
  assert.equal(await page.eval(() => packageHarness.view().hosts.length), 0); assert.equal(await page.eval(() => packageHarness.view().hostsError), '')
  for (const locale of ['zh-CN', 'zh-TW', 'en']) for (const width of [1440, 768, 390]) for (const dark of [false, true]) {
    await fresh(); await page.setViewport({ width, height: 1000 })
    await run(({ locale, dark }) => { const h = packageHarness; h.setLocale(locale); h.theme.setTheme(dark ? 'dark' : 'light') }, { locale, dark })
    await run(() => packageHarness.pending.findLast(r => r.kind === 'hosts').reject(Error('Host names unavailable')))
    assert.equal(await page.eval(() => { const button = document.querySelector('[data-testid="package-hosts-retry"]'), rect = button.getBoundingClientRect(); button.focus();
      return rect.width >= 44 && rect.height >= 44 && document.activeElement === button && !!button.closest('[role="alert"]') && document.documentElement.scrollWidth <= innerWidth }), true)
    const colors = await page.eval(() => { const style = getComputedStyle(document.querySelector('[data-testid="package-hosts-retry"]')); return [style.color, style.backgroundColor] })
    assert.deepEqual(colors, dark ? ['rgb(10, 10, 10)', 'rgb(255, 255, 255)'] : ['rgb(255, 255, 255)', 'rgb(10, 10, 10)'], 'retry maintains inverse high contrast colors in both themes')
    await page.screenshot({ path: resolve(output, `${locale}-${width}-${dark ? 'dark' : 'light'}-error.png`), fullPage: true })
  }
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log('PASS valid empty inventory and 18 locale/width/theme persistent 44px keyboard retries with inverse contrast and no horizontal overflow')
} finally { if (browser) await browser.close(); await server.close() }
