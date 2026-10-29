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
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js')
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/host-batch-config/*.js']
const output = resolve(root, 'logs/host-batch-config'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const server = await createServer({ configFile: false, root: root + '/scripts/fixtures/host-batch-config', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/host-batch-config/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19688, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19688', { settleMs: 1600 })
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await page.eval(() => !!window.hostBatchConfig?.pending.some(item => item.kind === 'list'))) break
    if (attempt === 99) throw new Error('host single action fixture did not mount')
    await sleep(150)
  }
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(90); return result }
  const last = kind => page.eval(kind => window.hostBatchConfig.pending.findLastIndex(item => item.kind === kind), kind)
  const accept = (index, data) => run(({ index, data }) => window.hostBatchConfig.pending[index].resolve(data), { index, data })
  const row = (id, hostId = 1) => ({ id, name: `Fixture instance ${id}`, hostId, status: 'running', image: 'debian/12', cpu: 1, memory: 512, disk: 10240, username: 'Fixture user', userId: 1, packagePlanId: 1, billingPrice: 10 })
  const list = (ids, hostId = 1, status = 'running') => ({ instances: ids.map(id => ({ ...row(id, hostId), status })), total: ids.length, totalPages: 1 })
  await accept(await last('list'), list([1, 2]))
  await run(() => { const v = window.hostBatchConfig.view(); v.selectedIds = new Set([1]); v.openBatchConfigForSelection() })
  await run(() => { window.hostBatchConfig.view().selectedIds = new Set([2]) })
  await run(() => {
    const child = window.hostBatchConfig.child(); child.enabledFields.cpu = true; child.form.cpu = '100'; void child.handleSubmit()
  })
  assert.deepEqual(await page.eval(index => window.hostBatchConfig.pending[index].params.instanceIds, await last('batch')), [1], 'batch config must use the reviewed targets')
  console.log('PASS batch config fixes reviewed targets')
  const child = key => page.eval(key => JSON.parse(JSON.stringify(window.hostBatchConfig.child()[key])), key)
  const view = key => page.eval(key => JSON.parse(JSON.stringify(window.hostBatchConfig.view()[key])), key)
  const count = kind => page.eval(kind => window.hostBatchConfig.pending.filter(item => item.kind === kind).length, kind)
  const reject = index => run(index => window.hostBatchConfig.pending[index].reject(new Error('Fixture config failure')), index)
  const callChild = method => run(method => { void window.hostBatchConfig.child()[method]() }, method)
  const success = { success: true, totalCount: 1, successCount: 1, failedCount: 0, failedItems: [] }
  const open = async (ids = [1]) => {
    await run(ids => { const v = window.hostBatchConfig.view(); v.selectedIds = new Set(ids); v.openBatchConfigForSelection() }, ids)
    await run(() => { const c = window.hostBatchConfig.child(); c.enabledFields.cpu = true; c.form.cpu = '100' })
  }
  await callChild('handleSubmit'); assert.equal(await count('batch'), 1)
  await accept(await last('batch'), success)
  const beforeDone = await count('list'); await callChild('handleDone'); assert.equal(await count('list'), beforeDone + 1, 'Done must refresh successful results')
  await accept(await last('list'), list([1, 2]))
  const beforeEmpty = await count('batch'); await run(() => { const v = window.hostBatchConfig.view(); v.selectedIds = new Set(); v.openBatchConfigForSelection() })
  assert.equal(await view('showBatchConfigModal'), false); assert.equal(await count('batch'), beforeEmpty)

  await open([1, 2]); await callChild('handleSubmit'); const partial = await last('batch')
  await accept(partial, { success: false, totalCount: 2, successCount: 1, failedCount: 1,
    failedItems: [{ instanceId: 2, incusId: 'fixture-2', name: 'Fixture 2', error: 'Fixture failure' }],
    retryPayload: { instanceIds: [2], config: { cpu: 100 } } })
  await callChild('handleRetry'); const retry = await last('batch'); await callChild('handleRetry'); assert.equal(await last('batch'), retry)
  assert.deepEqual(await page.eval(index => window.hostBatchConfig.pending[index].params, retry), { hostId: 1, instanceIds: [2], config: { cpu: 100 } })
  await callChild('handleDone'); assert.equal(await view('showBatchConfigModal'), true)
  await accept(retry, success); await callChild('handleDone'); await accept(await last('list'), list([1, 2]))
  await run(() => { void window.hostBatchConfig.view().loadInstances() }); await accept(await last('list'), list([1, 2, 3]))
  await open([1, 2, 3]); await callChild('handleSubmit')
  await accept(await last('batch'), { success: false, totalCount: 3, successCount: 1, failedCount: 2,
    failedItems: [{ instanceId: 2, incusId: 'fixture-2', name: 'Review required', error: 'Unknown remote state', requiresReview: true },
      { instanceId: 3, incusId: 'fixture-3', name: 'Retryable', error: 'Connection refused' }],
    retryPayload: { instanceIds: [3], config: { cpu: 999 } } })
  await callChild('handleRetry'); assert.deepEqual(await page.eval(index => window.hostBatchConfig.pending[index].params, await last('batch')),
    { hostId: 1, instanceIds: [3], config: { cpu: 100 } })
  await accept(await last('batch'), success); assert.equal((await child('result')).successCount, 2)
  assert.deepEqual((await child('result')).failedItems.map(item => item.instanceId), [2]); assert.equal((await child('result')).retryPayload, undefined)
  await callChild('handleDone'); await accept(await last('list'), list([1, 2]))
  await open(); await callChild('handleSubmit'); await reject(await last('batch')); assert.ok(await child('submitError'))
  await callChild('handleSubmit'); await accept(await last('batch'), { ...success, totalCount: 9 }); assert.ok(await child('submitError')); assert.equal(await child('showResult'), false)
  await callChild('handleSubmit'); const oldHost = await last('batch')
  await run(() => { window.hostBatchConfig.state.id = 2 }); await accept(await last('list'), list([3], 2))
  await run(() => { const v = window.hostBatchConfig.view(); v.selectedIds = new Set([3]); v.openBatchConfigForSelection() })
  assert.equal(await view('showBatchConfigModal'), false, 'in-flight write blocks reopening')
  await accept(oldHost, success); assert.equal(await view('showBatchConfigModal'), false)
  await open([3]); await run(() => window.hostBatchConfig.session('a', 2)); assert.equal(await view('showBatchConfigModal'), true)
  await callChild('handleSubmit'); const sessionWrite = await last('batch'); await run(() => window.hostBatchConfig.session('b'))
  await accept(await last('list'), list([3], 2)); await reject(sessionWrite); assert.equal(await view('showBatchConfigModal'), false)
  await open([3]); await callChild('handleSubmit'); const cacheWrite = await last('batch')
  await run(() => { window.hostBatchConfig.state.active = false }); await run(() => { window.hostBatchConfig.state.active = true })
  await accept(await last('list'), list([3], 2)); await accept(cacheWrite, success); assert.equal(await view('showBatchConfigModal'), false)
  await open([3]); await callChild('handleSubmit'); const sameQuery = await last('batch')
  await run(() => { void window.hostBatchConfig.view().loadInstances() }); await accept(await last('list'), list([3], 2))
  await accept(sameQuery, success); assert.equal(await child('showResult'), true); await callChild('handleClose'); await accept(await last('list'), list([3], 2))
  await open([3]); await callChild('handleSubmit'); const queryWrite = await last('batch')
  await run(() => { const v = window.hostBatchConfig.view(); v.searchQuery = 'next'; void v.handleSearch() }); await accept(await last('list'), list([3], 2))
  await accept(queryWrite, success); assert.equal(await view('showBatchConfigModal'), false)
  await open([3]); await callChild('handleSubmit'); await reject(await last('batch'))
  await run(() => {
    const dialog = document.querySelector('[role="dialog"]'), controls = [...dialog.querySelectorAll('button, input, select')].filter(el => !el.matches(':disabled') && el.getClientRects().length)
    controls.at(-1).focus(); controls.at(-1).dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    if (document.activeElement !== controls[0]) throw new Error('batch config must retain keyboard focus')
  })
  for (const [locale, width, dark, mobile] of [['zh-CN', 1440, false, false], ['en', 390, true, true]]) {
    await page.setViewport({ width, height: 1000, mobile })
    await run(({ locale, dark }) => { window.hostBatchConfig.setLocale(locale); window.hostBatchConfig.theme.setTheme(dark ? 'dark' : 'light') }, { locale, dark })
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: resolve(output, `${locale}-${width}.png`), format: 'png' })
  }
  await callChild('handleSubmit'); const logout = await last('batch'); await run(() => window.hostBatchConfig.session(null)); await reject(logout)
  assert.equal(await view('showBatchConfigModal'), false)
  await run(() => window.hostBatchConfig.session('c')); await accept(await last('list'), list([3], 2)); await open([3]); await callChild('handleSubmit')
  const unmounted = await last('batch'); await run(() => { window.hostBatchConfig.state.mounted = false }); await accept(unmounted, success)
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log('PASS frozen targets, duplicate/empty gates, Done refresh, failed-only retry, malformed/error results, host/query/session/cache/logout/unmount and both viewports')
} finally { if (browser) await browser.close(); await server.close() }
