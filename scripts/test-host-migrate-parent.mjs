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
const output = resolve(root, 'logs/host-migrate-parent'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js')
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/host-migrate-parent/*.js']
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/host-migrate-parent', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/host-migrate-parent/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19702, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19702', { settleMs: 1400 })
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await page.eval(() => !!window.hostMigrateParent)) break
    if (attempt === 199) throw Error('host migrate fixture did not mount: ' + page.consoleErrors.join('\n'))
    await sleep(150)
  }
  const run = async (fn, arg) => { const value = await page.eval(fn, arg); await sleep(90); return value }
  const last = kind => page.eval(kind => window.hostMigrateParent.pending.findLastIndex(item => item.kind === kind), kind)
  const accept = (index, data) => run(({ index, data }) => window.hostMigrateParent.pending[index].resolve(data), { index, data })
  const hosts = (items, page = 1, total = items.length) => ({ hosts: items, total, page, pageSize: 100, totalPages: Math.ceil(total / 100) })
  const open = async () => {
    await run(() => { window.hostMigrateParent.view().selectedIds = new Set([1]) })
    await run(() => { document.querySelector('[data-migrate-open]').click() })
    await chooseDestination()
  }
  const chooseDestination = async () => {
    await accept(await last('hosts'), hosts([{ id: 2, name: 'fixture-target', status: 'online' }]))
    await run(() => { window.hostMigrateParent.child().targetHostId = 2 })
    await accept(await last('images'), { success: true, images: [{ id: 1, name: 'fixture-image', remoteAlias: 'fixture/image', architecture: 'x86_64', instanceType: 'container', osType: 'ubuntu', icon: 'ubuntu' }] })
    await accept(await last('plans'), { plans: [{ id: 1, name: 'fixture-plan', packageId: 1, packageName: 'fixture-package', price: 100, billingCycle: 1 }] })
    await run(() => { window.hostMigrateParent.child().targetPlanId = 1 })
  }
  const row = (id, hostId = 1) => ({ id, name: `Fixture instance ${id}`, hostId, incusId: `fixture-${id}`, status: 'running', image: 'debian/12', cpu: 1, memory: 512, disk: 10240, username: 'Fixture user', userId: 1, packagePlanId: 1, instanceType: 'container', billingPrice: 10 })
  const list = (ids = [1, 2], hostId = 1) => ({ instances: ids.map(id => row(id, hostId)), total: ids.length, totalPages: 1 })
  await accept(await last('list'), list())
  await run(() => { const v = window.hostMigrateParent.view(); v.selectedIds = new Set([1]) })
  await run(() => {
    const h = window.hostMigrateParent, buttons = [...document.querySelectorAll('button')]
    const button = buttons.find(button => button.textContent.trim() === '改节点')
    if (!button) throw Error('migration button missing')
    button.click(); h.view().selectedIds = new Set([2])
  })
  assert.deepEqual(await page.eval(() => JSON.parse(JSON.stringify(window.hostMigrateParent.child().selectedSnapshot.map(item => item.id)))), [1], 'parent must fix migration selection synchronously at click')
  console.log('PASS parent synchronously freezes migration targets')
  const view = key => page.eval(key => JSON.parse(JSON.stringify(window.hostMigrateParent.view()[key])), key)
  const child = key => page.eval(key => JSON.parse(JSON.stringify(window.hostMigrateParent.child()[key])), key)
  const count = kind => page.eval(kind => window.hostMigrateParent.pending.filter(item => item.kind === kind).length, kind)
  const callChild = method => run(method => { void window.hostMigrateParent.child()[method]() }, method)
  const reject = index => run(index => window.hostMigrateParent.pending[index].reject(new Error('Fixture request failed')), index)
  const success = { message: 'Fixture migrated', successCount: 1, failedCount: 0, results: [{ id: 1, name: 'Fixture 1', success: true }] }
  await chooseDestination(); await callChild('handleSubmit')
  assert.deepEqual(await page.eval(() => window.hostMigrateParent.pending.findLast(item => item.kind === 'migrate').params.ids), [1])
  assert.equal(await view('migrateBusy'), true)
  const beforeRepeat = await count('migrate'); await callChild('handleSubmit'); await callChild('closeModal')
  assert.equal(await count('migrate'), beforeRepeat); assert.equal(await view('showMigrateModal'), true)
  await reject(await last('migrate')); assert.notEqual(await child('submitError'), ''); assert.equal(await view('migrateBusy'), false)
  await callChild('handleSubmit'); await accept(await last('migrate'), success)
  assert.equal(await child('showResult'), true)
  await reject(await last('list'))
  assert.equal(await view('showMigrateModal'), true, 'auxiliary list failure must preserve completed migration result')
  assert.equal(await child('showResult'), true); assert.equal(await child('submitError'), '')
  await callChild('closeModal')
  let hostId = 1
  const refresh = async (data = list([1, 2], hostId)) => {
    await run(() => { void window.hostMigrateParent.view().loadInstances() }); await accept(await last('list'), data)
  }
  await refresh(); await open(); await refresh()
  assert.equal(await child('canSubmit'), true, 'same-page refresh with stable identity remains valid')
  for (const [field, value] of [['incusId', 'changed'], ['userId', 2], ['packagePlanId', 9], ['instanceType', 'vm'], ['dedicatedIpv4', true], ['status', 'deleted']]) {
    await refresh(); await callChild('closeModal'); await open()
    const changed = list([1, 2], hostId); changed.instances[0][field] = value; await refresh(changed)
    assert.equal(await child('canSubmit'), false, `${field} change rejects stale targets`)
    const before = await count('migrate'); await callChild('handleSubmit'); assert.equal(await count('migrate'), before)
  }
  await callChild('closeModal'); await refresh(); await open(); await refresh(list([2], hostId)); assert.equal(await child('canSubmit'), false)
  await callChild('closeModal'); await refresh()
  for (const ids of [[], [999], Array.from({ length: 31 }, (_, i) => i + 1)]) {
    await run(ids => { const v = window.hostMigrateParent.view(); v.selectedIds = new Set(ids); v.openMigrateForSelection() }, ids)
    assert.equal(await view('showMigrateModal'), false)
  }
  const dedicated = list(); dedicated.instances[0].dedicatedIpv4 = true; await refresh(dedicated)
  await run(() => { const v = window.hostMigrateParent.view(); v.selectedIds = new Set([1]); v.openMigrateForSelection() })
  assert.equal(await view('showMigrateModal'), false, 'dedicated machine does not enter legacy migration')
  await refresh()
  for (const change of ['query', 'host', 'session', 'role', 'cache']) {
    await open(); await callChild('handleSubmit'); const old = await last('migrate')
    await run(change => { const h = window.hostMigrateParent, v = h.view()
      if (change === 'query') { v.searchQuery = 'changed'; void v.handleSearch() }
      if (change === 'host') h.state.id = 3
      if (change === 'session') h.session('b')
      if (change === 'role') h.auth.user = { ...h.auth.user, role: 'user' }
      if (change === 'cache') h.state.active = false
    }, change)
    if (change === 'cache') await run(() => { window.hostMigrateParent.state.active = true })
    hostId = await page.eval(() => window.hostMigrateParent.state.id)
    await accept(await last('list'), list([1, 2], hostId))
    assert.equal(await view('showMigrateModal'), false)
    await run(() => { const v = window.hostMigrateParent.view(); v.selectedIds = new Set([1]); v.openMigrateForSelection() })
    assert.equal(await view('showMigrateModal'), false, `${change} in-flight operation prevents reopening`)
    const lists = await count('list'); await accept(old, success)
    assert.equal(await count('list'), lists, `${change} old completion cannot refresh another context`)
    assert.equal(await view('migrateBusy'), false)
  }
  await open(); await callChild('handleSubmit'); const sameSession = await last('migrate')
  await run(() => window.hostMigrateParent.session('b', 2)); await accept(sameSession, success)
  await accept(await last('list'), list([2], hostId)); assert.equal(await child('showResult'), true)
  await callChild('closeModal'); await refresh(); await open(); await callChild('handleSubmit'); await reject(await last('migrate'))
  await run(() => {
    const dialog = document.querySelector('[role="dialog"]'), controls = [...dialog.querySelectorAll('button,input,select')].filter(el => !el.matches(':disabled') && el.getClientRects().length)
    controls.at(-1).focus(); controls.at(-1).dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    if (document.activeElement !== controls[0]) throw Error('migration keyboard focus escaped')
  })
  for (const [locale, width, dark, mobile] of [['zh-CN', 1440, false, false], ['en', 390, true, true]]) {
    await page.setViewport({ width, height: 1000, mobile }); await run(({ locale, dark }) => { window.hostMigrateParent.setLocale(locale); window.hostMigrateParent.theme.setTheme(dark ? 'dark' : 'light') }, { locale, dark })
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: resolve(output, `${locale}-${width}.png`), format: 'png' })
  }
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log('PASS parent migration fixed selection, identity, dedicated boundary, busy, lifecycle and durable result matrix')
} finally { if (browser) await browser.close(); await server.close() }
