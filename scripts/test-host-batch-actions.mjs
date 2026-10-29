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
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/host-batch-actions/*.js']
const output = resolve(root, 'logs/host-batch-actions-lifecycle'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const server = await createServer({ configFile: false, root: root + '/scripts/fixtures/host-batch-actions', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/host-batch-actions/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19681, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19681', { settleMs: 1600 })
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(90); return result }
  const last = kind => page.eval(kind => window.hostBatch.pending.findLastIndex(item => item.kind === kind), kind)
  const accept = (index, data) => run(({ index, data }) => window.hostBatch.pending[index].resolve(data), { index, data })
  const row = (id, hostId = 1) => ({ id, name: `Fixture instance ${id}`, hostId, status: 'running', image: 'debian/12', cpu: 1, memory: 512, disk: 10240, username: 'Fixture user', packagePlanId: 1, billingPrice: 10 })
  const list = (ids, hostId = 1, status = 'running') => ({ instances: ids.map(id => ({ ...row(id, hostId), status })), total: ids.length, totalPages: 1 })
  const choose = ids => run(ids => { window.hostBatch.view().selectedIds = new Set(ids) }, ids)
  await accept(await last('list'), list([1, 2]))
  await choose([1]); await run(() => window.hostBatch.view().openBatchSuspendModal())
  await choose([2]); await run(() => { void window.hostBatch.view().confirmBatchSuspend() })
  assert.deepEqual(await page.eval(index => window.hostBatch.pending[index].params.ids, await last('suspend')), [1], 'suspend uses confirmed targets, not later checkbox selection')
  console.log('PASS fixed host suspension targets')
  const view = key => page.eval(key => JSON.parse(JSON.stringify(window.hostBatch.view()[key])), key)
  const count = kind => page.eval(kind => window.hostBatch.pending.filter(item => item.kind === kind).length, kind)
  const reject = index => run(index => window.hostBatch.pending[index].reject(new Error('Fixture action failure')), index)
  const selected = () => page.eval(() => [...window.hostBatch.view().selectedIds])
  const result = (ids, failed = []) => ({ results: ids.map(id => ({ id, name: `Fixture instance ${id}`, success: !failed.includes(id), error: failed.includes(id) ? 'Fixture retained failure' : undefined })),
    successCount: ids.length - failed.length, failedCount: failed.length, syncedCount: ids.length - failed.length, changedCount: 0, ipv4ChangedCount: 0 })
  const call = method => run(method => { void window.hostBatch.view()[method]() }, method)
  await call('confirmBatchSuspend'); await call('confirmBatchUnsuspend'); await call('batchSyncStatus')
  assert.equal(await count('suspend'), 1); assert.equal(await count('unsuspend'), 0); assert.equal(await count('sync'), 0)
  await accept(await last('suspend'), result([1])); await accept(await last('list'), list([1, 2]))
  assert.deepEqual(await selected(), [2], 'later selection survives successful suspension')
  const closedCount = await count('suspend'); await call('confirmBatchSuspend'); assert.equal(await count('suspend'), closedCount)
  // Keep failures and skipped targets selected; the server legitimately skips already-suspended instances.
  await choose([1, 2]); await call('openBatchSuspendModal'); await call('confirmBatchSuspend')
  await accept(await last('suspend'), result([1], [1])); await accept(await last('list'), list([1, 2]))
  assert.deepEqual(await selected(), [1, 2]); assert.equal((await view('batchActionFailures'))[0].id, 1)
  assert.equal(await view('showSuspendModal'), false)
  await call('openBatchSuspendModal'); await call('confirmBatchSuspend'); await reject(await last('suspend'))
  assert.ok(await view('batchActionError')); assert.equal(await view('showSuspendModal'), true); assert.equal(await view('isSuspending'), false)
  await run(() => { window.hostBatch.view().suspendReason = '  reviewed reason  ' }); await call('confirmBatchSuspend')
  assert.deepEqual(await page.eval(index => window.hostBatch.pending[index].params, await last('suspend')), { hostId: 1, ids: [1, 2], reason: 'reviewed reason' })
  const oldSuspend = await last('suspend'); await run(() => { window.hostBatch.state.id = 2 }); await accept(await last('list'), list([3, 4], 2))
  await choose([3]); await call('openBatchSuspendModal'); assert.equal(await view('showSuspendModal'), false)
  const beforeOld = await count('list'); await accept(oldSuspend, result([1, 2]))
  assert.equal(await count('list'), beforeOld); assert.deepEqual(await selected(), [3]); assert.equal(await view('batchActionError'), '')
  // Every immediate batch operation holds its original host/targets, prevents duplicates and ignores old page results.
  for (const [method, kind, busy] of [['confirmBatchUnsuspend', 'unsuspend', 'isUnsuspending'], ['batchSyncStatus', 'sync', 'isSyncing']]) {
    await choose([3]); await call(method); const write = await last(kind), calls = await count(kind)
    await choose([4]); await call(method); assert.equal(await count(kind), calls)
    assert.deepEqual(await page.eval(index => window.hostBatch.pending[index].params, write), { hostId: 2, ids: [3] })
    await accept(write, result([3])); await accept(await last('list'), list([3, 4], 2)); assert.deepEqual(await selected(), [4])
    await call(method); await reject(await last(kind)); assert.ok(await view('batchActionError')); assert.equal(await view(busy), false)
    for (const data of [result([999]), result([4, 4]), { ...result([4]), results: [{ id: 4, success: 'true' }] }]) {
      await call(method); await accept(await last(kind), data); assert.ok(await view('batchActionError')); assert.deepEqual(await selected(), [4])
    }
    await choose([3, 4]); await call(method); await accept(await last(kind), result([3, 4], [4])); await accept(await last('list'), list([3, 4], 2))
    assert.deepEqual(await selected(), [4]); assert.equal((await view('batchActionFailures'))[0].id, 4)
    await call(method); const old = await last(kind); await run(() => { window.hostBatch.view().searchQuery = 'next'; void window.hostBatch.view().handleSearch() })
    await accept(await last('list'), list([5], 2)); await choose([5]); const reads = await count('list')
    await accept(old, result([4])); assert.equal(await count('list'), reads); assert.deepEqual(await selected(), [5])
    await run(() => { window.hostBatch.view().searchQuery = ''; void window.hostBatch.view().handleSearch() }); await accept(await last('list'), list([3, 4], 2))
  }
  // A token refresh with the same sid keeps the confirmation; a different session invalidates it.
  await choose([3]); await call('openBatchSuspendModal'); await run(() => window.hostBatch.session('a', 2))
  assert.equal(await view('showSuspendModal'), true); await call('confirmBatchSuspend'); const oldSession = await last('suspend')
  await run(() => window.hostBatch.session('b')); await accept(await last('list'), list([3, 4], 2)); await choose([4])
  const sessionReads = await count('list'); await reject(oldSession)
  assert.equal(await view('batchActionError'), ''); assert.equal(await count('list'), sessionReads); assert.deepEqual(await selected(), [4])
  await call('batchSyncStatus'); const oldCache = await last('sync'); await run(() => { window.hostBatch.state.active = false })
  await run(() => { window.hostBatch.state.active = true }); await accept(await last('list'), list([3, 4], 2)); await choose([3])
  const cacheReads = await count('list'); await accept(oldCache, result([4])); assert.equal(await count('list'), cacheReads); assert.deepEqual(await selected(), [3])
  await call('openBatchSuspendModal'); await run(() => { window.hostBatch.view().suspendReason = 'x'.repeat(501) })
  const beforeInvalid = await count('suspend'); await call('confirmBatchSuspend'); assert.equal(await count('suspend'), beforeInvalid)
  await run(() => { window.hostBatch.view().suspendReason = 'Fixture reason' })
  for (const [locale, width, dark, mobile] of [['zh-CN', 1440, false, false], ['en', 390, true, true]]) {
    await page.setViewport({ width, height: 1000, mobile })
    await run(({ locale, dark }) => { window.hostBatch.setLocale(locale); window.hostBatch.theme.setTheme(dark ? 'dark' : 'light') }, { locale, dark })
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: resolve(output, `${locale}-${width}.png`), format: 'png' })
  }
  await run(() => {
    const dialog = document.querySelector('[role="dialog"]'), controls = dialog.querySelectorAll('button, textarea')
    controls[controls.length - 1].focus(); controls[controls.length - 1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    if (document.activeElement !== controls[0]) throw new Error('focus must wrap within the suspension confirmation')
    controls[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  })
  assert.equal(await view('showSuspendModal'), false)
  await call('confirmBatchUnsuspend'); const logoutWrite = await last('unsuspend'); await run(() => window.hostBatch.session(null))
  await reject(logoutWrite); const loggedOut = await count('unsuspend'); await call('confirmBatchUnsuspend'); assert.equal(await count('unsuspend'), loggedOut)
  assert.equal(await view('batchActionError'), ''); assert.equal((await view('instances')).length, 0)
  await run(() => window.hostBatch.session('c')); await accept(await last('list'), list([3], 2)); await choose([3]); await call('batchSyncStatus')
  const unmounted = await last('sync'); await run(() => { window.hostBatch.state.mounted = false }); await accept(unmounted, result([3]))
  assert.equal(await view('isSyncing'), false); assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log('PASS suspension/unsuspension/sync targets, pending gates, partial failure/retry, invalid receipts, query/session/cache/logout/unmount and both viewports')
} finally { if (browser) await browser.close(); await server.close() }
