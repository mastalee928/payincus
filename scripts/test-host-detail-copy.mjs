import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { Browser, sleep } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'
const root = fileURLToPath(new URL('..', import.meta.url)).replaceAll('\\', '/'), require = createRequire(new URL('../client/package.json', import.meta.url))
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href), { default: vue } = await import(pathToFileURL(require.resolve('@vitejs/plugin-vue')).href)
const output = resolve(root, 'logs/host-detail-copy'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js'); tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/host-detail-copy/*.js']
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/host-detail-copy', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/host-detail-copy/api.js' }, { find: /^@\/components\/host\/.*\.vue$/, replacement: root + '/scripts/fixtures/host-detail-copy/empty.js' }, { find: '@', replacement: root + '/client/src' }, ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } }, server: { host: '127.0.0.1', port: 19743, strictPort: true, fs: { allow: [root] } }
})
const host = (id = 11) => ({ id, name: '测试宿主', status: 'online', countryCode: 'JP', url: 'https://host.example.test', certPath: '/fixture/cert', resources: { cpuUsed: 0, memoryUsed: 0, diskUsed: 0, diskTotal: 1000 } })
let browser, obsolete = 0
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  const run = async (fn, arg) => { const value = await page.eval(fn, arg); await sleep(40); return value }
  const fresh = async () => {
    await page.goto('http://127.0.0.1:19743', { settleMs: 250 }); const deadline = Date.now() + 15000
    while (!await page.eval(() => !!window.hostDetailHarness?.view() && hostDetailHarness.pending.length > 0)) { if (Date.now() > deadline) throw Error('Host detail fixture did not mount: ' + page.consoleErrors.join('\n')); await sleep(70) }
    await run(host => { const h = hostDetailHarness; h.pending.forEach(p => p.resolve({ host })); }, host())
    await run(() => {
      const v = hostDetailHarness.view(); v.reinstallCommand = 'DISPLAY-ONLY reinstall command'; v.showReinstallModal = true
      window.clipboardRequests = []
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: text => new Promise((resolve, reject) => clipboardRequests.push({ text, resolve, reject })) } })
      window.copyReinstall = () => { const promise = v.copyReinstallCommand(); promise?.catch?.(() => {}) }
    })
  }
  const finish = (index = 0, fail = false) => run(({ index, fail }) => { fail ? clipboardRequests[index].reject(Error('fixture clipboard denied')) : clipboardRequests[index].resolve() }, { index, fail })
  if (process.argv.includes('--inspect-only')) { await fresh(); console.log('Copy dialog before http://127.0.0.1:19743/?inspect'); await new Promise(() => {}) }
  await fresh(); await run(() => copyReinstall())
  assert.equal(await page.eval(() => hostDetailHarness.toast.toasts.value.length), 0, 'copy waits for actual clipboard completion')
  await finish(); assert.equal(await page.eval(() => hostDetailHarness.toast.toasts.value.at(-1).message), await page.eval(() => hostDetailHarness.t('common.copied')))
  await fresh(); await run(() => { copyReinstall(); copyReinstall() })
  assert.equal(await page.eval(() => clipboardRequests.length), 1)
  assert.equal(await page.eval(() => document.querySelector('[data-host-reinstall-copy]').disabled), true)
  await finish(0, true); assert.ok(await page.eval(() => document.querySelector('[data-host-reinstall-copy-error]')))
  await run(() => document.querySelector('[data-host-reinstall-copy]').click()); await finish(1)
  assert.equal(await page.eval(() => !!document.querySelector('[data-host-reinstall-copy-error]')), false)
  for (const mode of ['missing', 'throw']) {
    await fresh(); await run(mode => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: mode === 'missing' ? undefined : { writeText: () => { throw Error('fixture unsupported') } } }); copyReinstall() }, mode)
    assert.equal(await page.eval(() => hostDetailHarness.toast.toasts.value.at(-1).message), await page.eval(() => hostDetailHarness.t('common.copyFailed')))
  }
  for (const mode of ['host', 'host-aba', 'route', 'route-aba', 'account', 'sid', 'role', 'logout', 'session-aba', 'command', 'command-aba', 'dialog', 'dialog-aba', 'cache', 'unmount']) for (const fail of [false, true]) {
    await fresh(); await run(() => copyReinstall())
    await run(async mode => { const h = hostDetailHarness, v = h.view()
      if (mode === 'host') { await h.router.push('/hosts/12'); v.host = { ...v.host, id: 12 } }
      if (mode === 'host-aba') { v.host = { ...v.host, id: 12 }; v.host = { ...v.host, id: 11 } }
      if (mode === 'route') await h.router.push('/elsewhere')
      if (mode === 'route-aba') { await h.router.push('/elsewhere'); await h.router.push('/hosts/11') }
      if (mode === 'account') h.session(2)
      if (mode === 'sid') h.session(1, 'other')
      if (mode === 'role') h.session(1, 'copy-session', 'user')
      if (mode === 'logout') h.auth.clearLocalAuth()
      if (mode === 'session-aba') { h.session(2); h.session(1) }
      if (mode === 'command') v.reinstallCommand = 'DISPLAY-ONLY changed command'
      if (mode === 'command-aba') { v.reinstallCommand = 'changed'; v.reinstallCommand = 'DISPLAY-ONLY reinstall command' }
      if (mode === 'dialog') v.showReinstallModal = false
      if (mode === 'dialog-aba') { v.showReinstallModal = false; v.showReinstallModal = true }
      if (mode === 'cache') h.active.value = false
      if (mode === 'unmount') h.mounted.value = false
    }, mode)
    await finish(0, fail)
    assert.equal(await page.eval(() => hostDetailHarness.toast.toasts.value.length), 0, mode + ' ignores obsolete feedback')
    assert.equal(await page.eval(() => !!document.querySelector('[data-host-reinstall-copy-error]')), false)
    obsolete++
  }
  await fresh(); await run(() => { copyReinstall(); hostDetailHarness.session(1, 'copy-session', 'admin', 2) }); await finish()
  assert.equal(await page.eval(() => hostDetailHarness.toast.toasts.value.at(-1).message), await page.eval(() => hostDetailHarness.t('common.copied')))
  await fresh(); await run(() => { hostDetailHarness.view().reinstallCommand = ''; copyReinstall() }); assert.equal(await page.eval(() => clipboardRequests.length), 0)
  await fresh(); await run(() => { copyReinstall(); hostDetailHarness.active.value = false }); await run(() => { hostDetailHarness.active.value = true });
  assert.equal(await page.eval(() => hostDetailHarness.view().reinstallCommand), '', 'cached leave clears the sensitive command')
  await run(() => { const v = hostDetailHarness.view(); v.reinstallCommand = 'DISPLAY-ONLY reinstall command'; v.showReinstallModal = true; copyReinstall() })
  assert.equal(await page.eval(() => clipboardRequests.length), 1, 'cached return keeps pending copy gate')
  await finish(); assert.equal(await page.eval(() => hostDetailHarness.toast.toasts.value.length), 0)
  await run(() => copyReinstall()); await finish(1)
  await fresh(); await run(async () => { await hostDetailHarness.router.push('/admin/hosts/11'); const v = hostDetailHarness.view(); v.reinstallCommand = 'DISPLAY-ONLY reinstall command'; v.showReinstallModal = true; copyReinstall() }); await finish()
  assert.equal(await page.eval(() => hostDetailHarness.toast.toasts.value.at(-1).message), await page.eval(() => hostDetailHarness.t('common.copied')), 'administrator detail route retains copy')
  for (const locale of ['zh-CN', 'zh-TW', 'en']) for (const width of [1440, 768, 390]) {
    await fresh(); await page.setViewport({ width, height: 900, mobile: width === 390 })
    await sleep(350)
    await run(locale => { hostDetailHarness.setLocale(locale); document.querySelector('[data-host-reinstall-copy]').click() }, locale); await finish(0, true)
    assert.equal(await page.eval(() => document.querySelector('[data-host-reinstall-copy-error]').textContent), await page.eval(() => hostDetailHarness.t('common.copyFailed')))
    assert.ok(await page.eval(() => document.documentElement.scrollWidth <= innerWidth))
    if (width === 390) {
      const dimensions = await page.eval(() => { const el = document.querySelector('[data-host-reinstall-copy]'), cs = getComputedStyle(el); return { height: el.getBoundingClientRect().height, innerWidth, minHeight: cs.minHeight, scoped: el.outerHTML } })
      assert.ok(dimensions.height >= 44, JSON.stringify(dimensions))
    }
    await page.screenshot({ path: resolve(output, `${locale}-${width}.png`), format: 'png' })
  }
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log(`PASS actual host detail copy waits, duplicate gate, failures/retry, ${obsolete} obsolete receipts, cached gate and same sid; display-only text, no system clipboard or host writes`)
  if (process.argv.includes('--serve')) { console.log('Host detail copy fixture ready http://127.0.0.1:19743'); await new Promise(() => {}) }
} finally { if (browser) await browser.close(); await server.close() }
