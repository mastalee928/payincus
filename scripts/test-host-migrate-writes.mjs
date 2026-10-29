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
const output = resolve(root, 'logs/host-migrate-writes'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js')
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/host-migrate/*.js']
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/host-migrate', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/host-migrate/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19701, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19701', { settleMs: 1400 })
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await page.eval(() => !!window.migrateHarness)) break
    if (attempt === 199) throw Error('host migrate fixture did not mount: ' + page.consoleErrors.join('\n'))
    await sleep(150)
  }
  const run = async (fn, arg) => { const value = await page.eval(fn, arg); await sleep(90); return value }
  const last = kind => page.eval(kind => window.migrateHarness.pending.findLastIndex(item => item.kind === kind), kind)
  const accept = (index, data) => run(({ index, data }) => window.migrateHarness.pending[index].resolve(data), { index, data })
  const hosts = (items, page = 1, total = items.length) => ({ hosts: items, total, page, pageSize: 100, totalPages: Math.ceil(total / 100) })
  const open = async () => {
    await run(() => { window.migrateHarness.state.visible = true })
    await accept(await last('hosts'), hosts([{ id: 2, name: 'fixture-target', status: 'online' }]))
    await run(() => { window.migrateHarness.view().targetHostId = 2 })
    await accept(await last('images'), { success: true, images: [{ id: 1, name: 'fixture-image', remoteAlias: 'fixture/image', architecture: 'x86_64', instanceType: 'container', osType: 'ubuntu', icon: 'ubuntu' }] })
    await accept(await last('plans'), { plans: [{ id: 1, name: 'fixture-plan', packageId: 1, packageName: 'fixture-package', price: 100, billingCycle: 1 }] })
    await run(() => { window.migrateHarness.view().targetPlanId = 1 })
  }
  await open()
  await run(() => { void window.migrateHarness.view().handleSubmit() }); const old = await last('migrate')
  await run(() => { window.migrateHarness.state.id = 10 })
  await accept(await last('hosts'), hosts([{ id: 2, name: 'fixture-target', status: 'online' }]))
  await accept(old, { success: true, message: 'fixture migrated', successCount: 1, failedCount: 0, results: [{ id: 1, name: 'fixture-instance', success: true }] })
  assert.equal(await page.eval(() => window.migrateHarness.state.successCount), 0, 'old source migration cannot refresh a new source')
  assert.equal(await page.eval(() => window.migrateHarness.view().showResult), false, 'old migration result cannot show in a new source')
  console.log('PASS migrate write target isolation')
  const read = key => page.eval(key => JSON.parse(JSON.stringify(window.migrateHarness.view()[key])), key)
  const count = kind => page.eval(kind => window.migrateHarness.pending.filter(item => item.kind === kind).length, kind)
  const reject = index => run(index => window.migrateHarness.pending[index].reject(new Error('fixture migration failed')), index)
  const result = (id = 1) => ({ success: true, message: 'fixture migrated', successCount: 1, failedCount: 0, results: [{ id, name: 'fixture-instance', success: true }] })
  let visit = 100
  const fresh = async () => {
    await run(id => { const h = window.migrateHarness; h.state.visible = false; h.state.id = id; h.state.active = true; h.state.mounted = true; h.auth.user = { id: 1, username: 'fixture', role: 'admin' }; h.session('a'); h.state.selectedIds = [1]; h.state.instances = [{ id: 1, name: 'fixture-instance', packagePlanId: 1 }] }, visit++)
    await open()
  }
  await fresh()
  await run(() => { const h = window.migrateHarness; h.state.selectedIds = [2]; h.state.instances.push({ id: 2, name: 'later-instance', packagePlanId: null }); void h.view().handleSubmit() })
  assert.deepEqual(await page.eval(() => window.migrateHarness.pending.findLast(item => item.kind === 'migrate').params.ids), [1], 'opening selection is fixed')
  const before = await count('migrate')
  await run(() => { const v = window.migrateHarness.view(); void v.handleSubmit(); v.closeModal() })
  assert.equal(await count('migrate'), before); assert.equal(await page.eval(() => window.migrateHarness.state.visible), true, 'pending modal cannot close')
  await reject(await last('migrate')); assert.match(await read('submitError'), /fixture migration failed/)
  await run(() => { void window.migrateHarness.view().handleSubmit() }); await accept(await last('migrate'), result())
  assert.equal(await read('showResult'), true); assert.equal(await read('submitError'), '')
  for (const change of ['sourceABA', 'session', 'role', 'account', 'logout', 'cache', 'unmount', 'reopen']) {
    await fresh(); await run(() => { void window.migrateHarness.view().handleSubmit() }); const request = await last('migrate')
    const successes = await page.eval(() => window.migrateHarness.state.successCount), toasts = await page.eval(() => window.migrateHarness.toastEvents.length)
    const original = await page.eval(() => window.migrateHarness.state.id)
    await run(change => { const h = window.migrateHarness
      if (change === 'sourceABA') h.state.id++
      if (change === 'session') h.session('b')
      if (change === 'role') h.auth.user = { ...h.auth.user, role: 'user' }
      if (change === 'account') h.auth.user = { ...h.auth.user, id: 2 }
      if (change === 'logout') h.session(null)
      if (change === 'cache') h.state.active = false
      if (change === 'unmount') h.state.mounted = false
      if (change === 'reopen') h.state.visible = false
    }, change)
    if (change === 'sourceABA') await run(id => { window.migrateHarness.state.id = id }, original)
    if (change === 'reopen') await run(() => { window.migrateHarness.state.visible = true })
    if (['sourceABA', 'role', 'cache', 'reopen'].includes(change)) await accept(request, result()); else await reject(request)
    assert.equal(await page.eval(() => window.migrateHarness.state.successCount), successes, `${change} old completion cannot emit`)
    assert.equal(await page.eval(() => window.migrateHarness.toastEvents.length), toasts); assert.equal(await read('showResult'), false)
  }
  for (const malformed of [{}, { ...result(), successCount: 2 }, { ...result(), results: [{ id: 99, name: 'other', success: true }] }, { ...result(), failedCount: -1 }]) {
    await fresh(); await run(() => { void window.migrateHarness.view().handleSubmit() }); const successes = await page.eval(() => window.migrateHarness.state.successCount)
    await accept(await last('migrate'), malformed); assert.notEqual(await read('submitError'), ''); assert.equal(await read('showResult'), false)
    assert.equal(await page.eval(() => window.migrateHarness.state.successCount), successes)
  }
  await fresh(); await run(() => { window.migrateHarness.state.visible = false }); await run(() => {
    const h = window.migrateHarness; h.state.selectedIds = [1, 2]; h.state.instances.push({ id: 2, name: 'second', packagePlanId: 1 })
  }); await open()
  await run(() => { void window.migrateHarness.view().handleSubmit() }); await accept(await last('migrate'), { message: 'partial fixture result', successCount: 1, failedCount: 1,
    results: [{ id: 1, name: 'fixture-instance', success: true }, { id: 2, name: 'second', success: false, error: 'fixture target unavailable' }] })
  assert.equal(await read('showResult'), true); assert.equal((await read('result')).failedCount, 1)
  const afterResult = await count('migrate'); await run(() => { void window.migrateHarness.view().handleSubmit() }); assert.equal(await count('migrate'), afterResult, 'result page cannot replay successful IDs')
  await fresh(); await run(() => { void window.migrateHarness.view().handleSubmit() }); const sameSid = await last('migrate'); await run(() => window.migrateHarness.session('a', 2)); await accept(sameSid, result()); assert.equal(await read('showResult'), true)
  for (const [locale, width, dark, mobile] of [['zh-CN', 1440, false, false], ['en', 390, true, true]]) {
    await fresh(); await page.setViewport({ width, height: 1000, mobile }); await run(({ locale, dark }) => { window.migrateHarness.setLocale(locale); window.migrateHarness.theme.setTheme(dark ? 'dark' : 'light') }, { locale, dark })
    await run(() => document.querySelector('.modal-footer .btn-primary').click()); await reject(await last('migrate'))
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: resolve(output, `${locale}-${width}.png`), format: 'png' })
  }
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log('PASS migration writes target, session, dialog, validation, partial result and duplicate matrix')
} finally { if (browser) await browser.close(); await server.close() }
