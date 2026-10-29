import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { Browser, sleep } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'
import { status, sites } from './fixtures/host-caddy/data.js'
const root = fileURLToPath(new URL('..', import.meta.url)).replaceAll('\\', '/'), require = createRequire(new URL('../client/package.json', import.meta.url))
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href), { default: vue } = await import(pathToFileURL(require.resolve('@vitejs/plugin-vue')).href)
const output = resolve(root, 'logs/host-caddy-reads'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js'); tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/host-caddy/*.js']
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/host-caddy', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/host-caddy/api.js' }, { find: '@', replacement: root + '/client/src' }, ...['vue', 'pinia', 'vue-i18n'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } }, server: { host: '127.0.0.1', port: 19746, strictPort: true, fs: { allow: [root] } }
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  if (process.argv.includes('--inspect-only')) { console.log('Caddy read inspector ready http://127.0.0.1:19746/?inspect'); await new Promise(() => {}) }
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(40); return result }
  const fresh = async () => {
    await page.goto('http://127.0.0.1:19746', { settleMs: 250 }); const deadline = Date.now() + 15000
    while (!await page.eval(() => !!window.hostCaddyHarness?.view())) { if (Date.now() > deadline) throw Error('Host Caddy fixture did not mount'); await sleep(70) }
  }
  const settle = (index, result, fail = false) => run(({ index, result, fail }) => { const p = window.hostCaddyHarness.pending[index]; fail ? p.reject(Error('测试Caddy读取失败')) : p.resolve(result) }, { index, result, fail })
  await fresh(); await settle(0, status())
  const initialSites = await page.eval(() => window.hostCaddyHarness.pending.filter(p => p.kind === 'sites').length)
  assert.equal(initialSites, 1, 'enabling Caddy loads one site request rather than the watcher plus status-reader duplicate')
  await settle(1, sites())
  await run(() => { const v = window.hostCaddyHarness.view(); v.sitesPage = 2; void v.loadSites(); v.sitesPage = 1; void v.loadSites() })
  await settle(3, sites(1)); await settle(2, sites(2))
  assert.equal(await page.eval(() => window.hostCaddyHarness.view().sites[0].id), 1, 'old page response never replaces current page')
  console.log('PASS one initial list read and ordered current site pages')
  const initialize = async () => { await settle(0, status()); await settle(1, sites()) }
  let checked = 0
  for (const kind of ['status', 'sites']) for (const mode of ['host', 'host-aba', 'account', 'sid', 'role', 'logout', 'session-aba', 'cache', 'unmount']) for (const fail of [false, true]) {
    await fresh(); await initialize()
    await run(kind => { const v = window.hostCaddyHarness.view(); window.oldCaddy = v; void v[kind === 'status' ? 'loadCaddyStatus' : 'loadSites']() }, kind)
    await run(mode => { const h = window.hostCaddyHarness
      if (mode === 'host' || mode === 'host-aba') h.host.value = { ...h.host.value, id: 12 }
      if (mode === 'account') h.session(2)
      if (mode === 'sid') h.session(1, 'other-caddy-session')
      if (mode === 'role') h.session(1, 'host-caddy-session', 'user')
      if (mode === 'logout') h.auth.clearLocalAuth()
      if (mode === 'session-aba') { h.session(2); h.session(1) }
      if (mode === 'cache') h.active.value = false
      if (mode === 'unmount') h.mounted.value = false
    }, mode)
    if (mode === 'host-aba') await run(() => { const h = window.hostCaddyHarness; h.host.value = { ...h.host.value, id: 11 } })
    const before = await page.eval(() => JSON.stringify({ status: oldCaddy.caddyStatus, sites: [...oldCaddy.sites], ready: oldCaddy.statusReady, error: oldCaddy.statusError,
      sitesError: oldCaddy.sitesError, loading: oldCaddy.loading, sitesLoading: oldCaddy.sitesLoading, total: oldCaddy.sitesTotal, toasts: window.hostCaddyHarness.toast.toasts.value.map(t => t.message) }))
    const count = await page.eval(() => window.hostCaddyHarness.pending.length)
    await settle(2, kind === 'status' ? status() : sites(), fail)
    assert.equal(await page.eval(() => JSON.stringify({ status: oldCaddy.caddyStatus, sites: [...oldCaddy.sites], ready: oldCaddy.statusReady, error: oldCaddy.statusError,
      sitesError: oldCaddy.sitesError, loading: oldCaddy.loading, sitesLoading: oldCaddy.sitesLoading, total: oldCaddy.sitesTotal, toasts: window.hostCaddyHarness.toast.toasts.value.map(t => t.message) })), before, `${kind} ${mode} rejects obsolete replies and finally`)
    assert.equal(await page.eval(() => window.hostCaddyHarness.pending.length), count, 'obsolete status cannot request current sites')
    if (mode === 'cache') {
      await run(() => { window.hostCaddyHarness.active.value = true })
      assert.equal(await page.eval(() => window.hostCaddyHarness.pending.at(-1).kind), 'status')
    }
    checked++
  }
  console.log(`PASS ${checked} stale status/sites host/account/session/ABA/cache/unmount receipts; no old finally or dependent read`)

  for (const result of [null, {}, { ...status(), enabled: 'true' }, { ...status(), hasPassword: null }, { ...status(), port: 0 }, { ...status(), port: 65536 },
    { ...status(), sitesCount: -1 }, { ...status(), username: {} }, { ...status(), natPublicIp: false }]) {
    await fresh(); await settle(0, result)
    assert.ok(await page.eval(() => !!document.querySelector('[data-caddy-status-error]')))
    await run(() => { const v = window.hostCaddyHarness.view(); void v.loadSites(); void v.generateInstallCommand(); void v.resetCredentials(); void v.confirmInstallation(); void v.testConnection() })
    assert.equal(await page.eval(() => window.hostCaddyHarness.pending.length), 1, 'unknown state has no installation or connection actions')
    await run(() => { document.querySelector('[data-caddy-status-error] button').click() }); await settle(1, status()); await settle(2, sites())
    assert.equal(await page.eval(() => !!document.querySelector('[data-caddy-status-error]')), false)
  }
  for (const result of [null, {}, sites(2), { ...sites(), total: -1 }, { ...sites(), totalPages: 9 }, { ...sites(), pageSize: 10 },
    { ...sites(), sites: null }, { ...sites(), sites: [null] }, { ...sites(), sites: sites().sites.map((row, i) => i ? row : { ...row, domain: null }) },
    { ...sites(), sites: sites().sites.map((row, i) => i ? row : { ...row, targetPort: 0 }) },
    { ...sites(), sites: sites().sites.map((row, i) => i ? row : { ...row, enabled: 'true' }) },
    { ...sites(), sites: sites().sites.map((row, i) => i ? row : { ...row, createdAt: 'invalid' }) },
    { ...sites(), sites: sites().sites.map((row, i) => i ? row : { ...row, instance: {} }) }, { ...sites(), sites: [] }]) {
    await fresh(); await settle(0, status()); await settle(1, result)
    assert.ok(await page.eval(() => !!document.querySelector('[data-caddy-sites-error]')))
    assert.equal(await page.eval(() => !!document.querySelector('[data-caddy-sites-empty]')), false)
    await run(() => { document.querySelector('[data-caddy-sites-error] button').click() }); await settle(2, sites())
    assert.equal(await page.eval(() => !!document.querySelector('[data-caddy-sites-error]')), false)
  }
  console.log('PASS nine malformed statuses and fourteen malformed site pages with unknown-action gate and actual persistent retry')

  await fresh(); await initialize()
  await run(() => { const v = window.hostCaddyHarness.view(); void v.loadCaddyStatus(); void v.loadCaddyStatus() })
  await settle(3, { ...status(), sitesCount: 9 }); await settle(2, status(false))
  assert.equal(await page.eval(() => window.hostCaddyHarness.view().caddyStatus.sitesCount), 9)
  await settle(4, sites())
  await run(() => { const v = window.hostCaddyHarness.view(); void v.loadSites(); void v.loadCaddyStatus() })
  await settle(6, status(false)); await settle(5, sites())
  assert.equal(await page.eval(() => window.hostCaddyHarness.view().sites.length), 0)
  assert.equal(await page.eval(() => window.hostCaddyHarness.view().sitesLoading), false)
  assert.equal(await page.eval(() => !!document.querySelector('[data-caddy-sites-empty]')), false)
  await fresh(); await initialize()
  await run(() => { const v = window.hostCaddyHarness.view(); void v.loadSites() }); await settle(2, null, true)
  assert.equal(await page.eval(() => window.hostCaddyHarness.view().sites[0].id), 1, 'failed refresh retains last confirmed list')
  await run(() => { void window.hostCaddyHarness.view().loadCaddyStatus() }); await settle(3, null, true)
  assert.equal(await page.eval(() => window.hostCaddyHarness.view().caddyStatus.enabled), true, 'failed status refresh never claims disabled')
  assert.equal(await page.eval(() => window.hostCaddyHarness.view().actionsDisabled), true)
  console.log('PASS ordered status, disabling clears list/old read and errors preserve confirmed state')

  await fresh(); await initialize()
  await run(() => { const v = window.hostCaddyHarness.view(); v.sitesPage = 2; void v.loadSites(); v.sitesPage = 1; v.sitesPage = 2; void v.loadSites() })
  await settle(3, sites(2)); await settle(2, null, true)
  assert.equal(await page.eval(() => window.hostCaddyHarness.view().sitesError), '')
  assert.equal(await page.eval(() => window.hostCaddyHarness.view().sites[0].id), 6)
  await run(() => { void window.hostCaddyHarness.view().loadSites() }); await settle(4, sites(2, 4))
  assert.equal(await page.eval(() => window.hostCaddyHarness.view().sitesPage), 1)
  await settle(5, sites(1, 4))
  assert.equal(await page.eval(() => window.hostCaddyHarness.view().sitesTotal), 4)
  await run(() => { void window.hostCaddyHarness.view().loadSites() }); await settle(6, sites(1, 0))
  assert.equal(await page.eval(() => !!document.querySelector('[data-caddy-sites-empty]')), true)
  assert.equal(await page.eval(() => window.hostCaddyHarness.view().sitesTotal), 0)
  await fresh(); await initialize()
  await run(() => { const h = window.hostCaddyHarness; h.auth.token = 'fixture.' + btoa(JSON.stringify({ sid: 'host-caddy-session', revision: 2 })) + '.fixture' })
  assert.equal(await page.eval(() => window.hostCaddyHarness.pending.length), 2)
  console.log('PASS page ABA, shrinking-page reread, legitimate zero pages and same sid refresh')

  for (const locale of ['zh-CN', 'zh-TW', 'en']) for (const width of [1440, 768, 390]) {
    await page.setViewport({ width, height: 900 }); await fresh(); await initialize(); await run(locale => window.hostCaddyHarness.setLocale(locale), locale)
    await run(() => { [...document.querySelectorAll('button')].find(b => b.textContent.trim() === window.hostCaddyHarness.t('host.caddy.nextPage')).click() })
    assert.equal(await page.eval(() => window.hostCaddyHarness.pending[2].data.page), 2)
    assert.ok(await page.eval(() => [...document.querySelectorAll('button')].filter(b => b.textContent.includes(window.hostCaddyHarness.t('host.caddy.nextPage'))).every(b => b.disabled)))
    await settle(2, sites(2)); await run(() => { [...document.querySelectorAll('button')].find(b => b.textContent.trim() === window.hostCaddyHarness.t('host.caddy.prevPage')).click() }); await settle(3, sites())
    assert.equal(await page.eval(() => window.hostCaddyHarness.view().sitesPage), 1)
    assert.ok(await page.eval(() => document.documentElement.scrollWidth <= innerWidth + 1))
    if (width === 390) assert.ok(await page.eval(() => [...document.querySelectorAll('button')].every(b => b.getBoundingClientRect().height >= 44)))
    await page.screenshot({ path: resolve(output, `${locale}-${width}.jpg`), fullPage: true })
  }
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log('PASS actual previous/next controls, disabled pending page and three languages/widths, zero writes')
  if (process.argv.includes('--serve')) { console.log('Caddy read fixture ready http://127.0.0.1:19746/?inspect'); await new Promise(() => {}) }
} finally { if (browser) await browser.close(); await server.close() }
