import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { Browser, sleep } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'
const root = fileURLToPath(new URL('..', import.meta.url)).replaceAll('\\', '/'), require = createRequire(new URL('../client/package.json', import.meta.url))
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href), { default: vue } = await import(pathToFileURL(require.resolve('@vitejs/plugin-vue')).href)
const output = resolve(root, 'logs/host-detail-reads'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js'); tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/host-detail-copy/*.js']
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/host-detail-copy', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/host-detail-copy/api.js' }, { find: /^@\/components\/host\/.*\.vue$/, replacement: root + '/scripts/fixtures/host-detail-copy/empty.js' }, { find: '@', replacement: root + '/client/src' }, ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } }, server: { host: '127.0.0.1', port: 19744, strictPort: true, fs: { allow: [root] } }
})
const host = (id = 11, name = '当前宿主') => ({ id, name, status: 'online', countryCode: 'JP', url: 'https://host.example.test', certPath: '/fixture/cert', resources: { cpuUsed: 0, memoryUsed: 0, diskUsed: 0, diskTotal: 1000 } })
let browser, obsolete = 0
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  if (process.argv.includes('--inspect-only')) { console.log('Read error fixture http://127.0.0.1:19744/?inspect&read-error'); await new Promise(() => {}) }
  const run = async (fn, arg) => { const value = await page.eval(fn, arg); await sleep(40); return value }
  const fresh = async () => {
    await page.goto('http://127.0.0.1:19744', { settleMs: 250 }); const deadline = Date.now() + 15000
    while (!await page.eval(() => !!window.hostDetailHarness?.view() && hostDetailHarness.pending.length > 0)) { if (Date.now() > deadline) throw Error('Host detail reads did not mount: ' + page.consoleErrors.join('\n')); await sleep(70) }
  }
  const last = () => page.eval(() => hostDetailHarness.pending.length - 1)
  const finish = (index, payload, fail = false) => run(({ index, payload, fail }) => { const p = hostDetailHarness.pending[index]; fail ? p.reject(Error('fixture read failed')) : p.resolve(payload) }, { index, payload, fail })
  await fresh(); const old = await last(); await run(() => hostDetailHarness.router.push('/hosts/12')); const newer = await last()
  await finish(newer, { host: host(12) }); await finish(old, { host: host(11, '过期宿主') })
  assert.equal(await page.eval(() => hostDetailHarness.view().host.id), 12, 'old host read cannot replace current route target')
  await fresh(); const first = await last(); await run(() => { void hostDetailHarness.view().loadHost() }); const second = await last()
  await finish(first, { host: host(11, 'older') }); assert.equal(await page.eval(() => hostDetailHarness.view().loading), true)
  await finish(second, { host: host(11, 'newer') }); assert.equal(await page.eval(() => hostDetailHarness.view().host.name), 'newer')
  for (const mode of ['host', 'route', 'route-aba', 'account', 'sid', 'role', 'logout', 'session-aba', 'cache', 'unmount']) for (const fail of [false, true]) {
    await fresh(); const pending = await last()
    await run(async mode => { const h = hostDetailHarness
      if (mode === 'host') await h.router.push('/hosts/12')
      if (mode === 'route') await h.router.push('/elsewhere')
      if (mode === 'route-aba') { await h.router.push('/hosts/12'); await h.router.push('/hosts/11') }
      if (mode === 'account') h.session(2)
      if (mode === 'sid') h.session(1, 'other')
      if (mode === 'role') h.session(1, 'copy-session', 'user')
      if (mode === 'logout') h.auth.clearLocalAuth()
      if (mode === 'session-aba') { h.session(2); h.session(1) }
      if (mode === 'cache') h.active.value = false
      if (mode === 'unmount') h.mounted.value = false
    }, mode)
    const before = await page.eval(() => JSON.stringify({ host: hostDetailHarness.view()?.host, loading: hostDetailHarness.view()?.loading, error: hostDetailHarness.view()?.hostLoadError, route: hostDetailHarness.router.currentRoute.value.fullPath, pending: hostDetailHarness.pending.length }))
    await finish(pending, { host: host() }, fail)
    assert.equal(await page.eval(() => JSON.stringify({ host: hostDetailHarness.view()?.host, loading: hostDetailHarness.view()?.loading, error: hostDetailHarness.view()?.hostLoadError, route: hostDetailHarness.router.currentRoute.value.fullPath, pending: hostDetailHarness.pending.length })), before, mode + ' ignores stale read/finally')
    assert.equal(await page.eval(() => hostDetailHarness.toast.toasts.value.length), 0)
    obsolete++
  }
  for (const payload of [null, {}, 'bad', 42, { host: null }, { host: host(12) }, { host: { ...host(), id: '11' } }, { host: { ...host(), name: null } }, { host: { ...host(), status: 'bad' } }, { host: { ...host(), countryCode: null } }]) {
    await fresh(); await finish(await last(), payload)
    assert.equal(await page.eval(() => hostDetailHarness.view().host), null)
    assert.ok(await page.eval(() => document.querySelector('[data-host-detail-read-error]')))
    assert.equal(await page.eval(() => hostDetailHarness.router.currentRoute.value.fullPath), '/hosts/11')
    await run(() => document.querySelector('[data-host-detail-read-retry]').click()); await finish(await last(), { host: host() })
    assert.equal(await page.eval(() => hostDetailHarness.view().host.id), 11)
  }
  await fresh(); await finish(await last(), host()); await run(() => { void hostDetailHarness.view().loadHost() }); await finish(await last(), null, true)
  assert.equal(await page.eval(() => hostDetailHarness.view().host.id), 11, 'refresh failure preserves last good host')
  assert.ok(await page.eval(() => document.querySelector('[data-host-detail-read-error]')))
  await fresh(); await run(() => hostDetailHarness.session(1, 'copy-session', 'admin', 2)); await finish(await last(), { host: host() })
  assert.equal(await page.eval(() => hostDetailHarness.view().host.id), 11)
  await fresh(); await finish(await last(), { host: host() }); await run(() => { hostDetailHarness.active.value = false }); await run(() => { hostDetailHarness.active.value = true })
  assert.equal(await page.eval(() => hostDetailHarness.view().host), null); await finish(await last(), { host: host() })
  assert.equal(await page.eval(() => hostDetailHarness.view().host.id), 11)
  for (const badId of ['11abc', '0', '-1', '1.5', '9007199254740992']) {
    await fresh(); const count = await page.eval(() => hostDetailHarness.pending.length)
    await run(async id => { await hostDetailHarness.router.push('/hosts/' + id) }, badId)
    assert.equal(await page.eval(() => hostDetailHarness.pending.length), count, 'invalid route has no API read')
    assert.ok(await page.eval(() => document.querySelector('[data-host-detail-read-error]')))
  }
  for (const locale of ['zh-CN', 'zh-TW', 'en']) for (const width of [1440, 768, 390]) {
    await fresh(); await page.setViewport({ width, height: 900, mobile: width === 390 }); await run(locale => hostDetailHarness.setLocale(locale), locale); await finish(await last(), null, true)
    assert.ok(await page.eval(() => document.querySelector('[data-host-detail-read-error]').textContent.includes(hostDetailHarness.t('admin.hosts.loadFailed'))))
    assert.ok(await page.eval(() => document.documentElement.scrollWidth <= innerWidth))
    if (width === 390) assert.ok(await page.eval(() => document.querySelector('[data-host-detail-read-retry]').getBoundingClientRect().height >= 44))
    await page.screenshot({ path: resolve(output, `${locale}-${width}.png`), format: 'png' })
  }
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log(`PASS actual host detail current reads, ${obsolete} obsolete receipts, request ordering, malformed replies, route parsing, persistent retry, same sid and cache; no host writes`)
} finally { if (browser) await browser.close(); await server.close() }
