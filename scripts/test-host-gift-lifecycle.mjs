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
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/host-gift-lifecycle/*.js']
const output = resolve(root, 'logs/host-gift-lifecycle-lifecycle'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const server = await createServer({ configFile: false, root: root + '/scripts/fixtures/host-gift-lifecycle', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/host-gift-lifecycle/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19682, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19682', { settleMs: 1600 })
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(90); return result }
  const last = kind => page.eval(kind => window.hostGift.pending.findLastIndex(item => item.kind === kind), kind)
  const accept = (index, data) => run(({ index, data }) => window.hostGift.pending[index].resolve(data), { index, data })
  const row = (id, hostId = 1) => ({ id, name: `Fixture instance ${id}`, hostId, status: 'running', image: 'debian/12', cpu: 1, memory: 512, disk: 10240, username: 'Fixture user', packagePlanId: 1, billingPrice: 10 })
  const list = (ids, hostId = 1, status = 'running') => ({ instances: ids.map(id => ({ ...row(id, hostId), status })), total: ids.length, totalPages: 1 })
  const choose = ids => run(ids => { window.hostGift.view().selectedIds = new Set(ids) }, ids)
  await accept(await last('list'), list([1, 2]))
  await choose([1]); await run(() => window.hostGift.view().openGiftDaysModal())
  await choose([2]); await run(() => { void window.hostGift.view().confirmGiftDays() })
  assert.deepEqual(await page.eval(index => window.hostGift.pending[index].params.ids, await last('gift')), [1], 'gift uses reviewed targets, not later checkbox selection')
  console.log('PASS fixed host gift targets')
  const view = key => page.eval(key => JSON.parse(JSON.stringify(window.hostGift.view()[key])), key)
  const count = kind => page.eval(kind => window.hostGift.pending.filter(item => item.kind === kind).length, kind)
  const reject = index => run(index => window.hostGift.pending[index].reject(new Error('Fixture gift failure')), index)
  const selected = () => page.eval(() => [...window.hostGift.view().selectedIds])
  const result = (ids, failed = []) => ({ results: ids.map(id => ({ instanceId: id, instanceName: `Fixture instance ${id}`, success: !failed.includes(id), error: failed.includes(id) ? 'Fixture retained failure' : undefined })),
    successCount: ids.length - failed.length, failedCount: failed.length, skippedCount: 0 })
  const call = method => run(method => { void window.hostGift.view()[method]() }, method)
  await call('confirmGiftDays'); assert.equal(await count('gift'), 1)
  await accept(await last('gift'), result([1])); await accept(await last('list'), list([1, 2]))
  assert.deepEqual(await selected(), [2]); const closed = await count('gift'); await call('confirmGiftDays'); assert.equal(await count('gift'), closed)
  await call('openGiftDaysModal')
  for (const value of [0, -1, 366, 1.5, '', '7', null]) {
    await run(value => { window.hostGift.view().giftDays = value }, value)
    await call('confirmGiftDays'); assert.equal(await count('gift'), closed, `invalid days: ${value}`)
  }
  await run(() => { window.hostGift.view().giftDays = 365 }); await call('confirmGiftDays')
  assert.deepEqual(await page.eval(index => window.hostGift.pending[index].params, await last('gift')), { hostId: 1, ids: [2], days: 365 })
  await reject(await last('gift')); assert.ok(await view('giftError')); assert.equal(await view('isGifting'), false)
  await call('confirmGiftDays'); const oldHost = await last('gift')
  await run(() => { window.hostGift.state.id = 2 }); await accept(await last('list'), list([3, 4], 2)); await choose([3])
  await call('openGiftDaysModal'); assert.equal(await view('showGiftDaysModal'), false)
  const beforeOld = await count('list'); await accept(oldHost, result([2])); assert.equal(await count('list'), beforeOld); assert.deepEqual(await selected(), [3])
  // Free instances are excluded from the confirmation and payload, exactly as the paid count says.
  await run(() => { window.hostGift.view().instances[1].packagePlanId = null }); await choose([3, 4]); await call('openGiftDaysModal'); await call('confirmGiftDays')
  assert.deepEqual(await page.eval(index => window.hostGift.pending[index].params.ids, await last('gift')), [3])
  await accept(await last('gift'), result([3], [3])); await accept(await last('list'), list([3, 4], 2))
  assert.equal(await view('showGiftDaysModal'), true); assert.equal((await view('giftFailures'))[0].instanceId, 3); assert.deepEqual(await view('giftTargets'), [3])
  await call('confirmGiftDays'); await accept(await last('gift'), result([3])); await accept(await last('list'), list([3, 4], 2))
  assert.deepEqual(await selected(), [4]); assert.equal(await view('showGiftDaysModal'), false)
  await choose([3, 4]); await call('openGiftDaysModal'); await call('confirmGiftDays')
  await accept(await last('gift'), { ...result([3]), skippedCount: 1 }); await accept(await last('list'), list([3, 4], 2))
  assert.deepEqual(await selected(), [4], 'server-skipped target must not cause the successful gift to be retried')
  assert.equal(await view('showGiftDaysModal'), false)
  await choose([3]); await call('openGiftDaysModal'); await call('confirmGiftDays'); const refreshing = await last('gift')
  await call('loadInstances'); await accept(await last('list'), list([3, 4], 2))
  await accept(refreshing, result([3])); await accept(await last('list'), list([3, 4], 2))
  assert.equal(await view('showGiftDaysModal'), false, 'same-query refresh must not lose a successful gift receipt')
  await choose([3]); await call('openGiftDaysModal')
  for (const data of [result([999]), result([3, 3]), result([]), { ...result([3]), results: [{ instanceId: 3, success: 'true' }] }]) {
    await call('confirmGiftDays'); await accept(await last('gift'), data); assert.ok(await view('giftError')); assert.equal(await view('showGiftDaysModal'), true)
  }
  await run(() => window.hostGift.session('a', 2)); assert.equal(await view('showGiftDaysModal'), true)
  await call('confirmGiftDays'); const oldSession = await last('gift'); await run(() => window.hostGift.session('b')); await accept(await last('list'), list([3, 4], 2))
  await reject(oldSession); assert.equal(await view('giftError'), ''); assert.equal(await view('showGiftDaysModal'), false)
  await choose([4]); await call('openGiftDaysModal'); await call('confirmGiftDays'); const oldCache = await last('gift')
  await run(() => { window.hostGift.state.active = false }); await run(() => { window.hostGift.state.active = true }); await accept(await last('list'), list([3, 4], 2)); await choose([3])
  const cacheReads = await count('list'); await accept(oldCache, result([4])); assert.equal(await count('list'), cacheReads); assert.deepEqual(await selected(), [3])
  await call('openGiftDaysModal'); await call('confirmGiftDays'); await reject(await last('gift'))
  await run(() => {
    const dialog = document.querySelector('[role="dialog"]'), controls = dialog.querySelectorAll('button, input')
    controls[controls.length - 1].focus(); controls[controls.length - 1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    if (document.activeElement !== controls[0]) throw new Error('gift confirmation must retain focus')
  })
  for (const [locale, width, dark, mobile] of [['zh-CN', 1440, false, false], ['en', 390, true, true]]) {
    await page.setViewport({ width, height: 1000, mobile })
    await run(({ locale, dark }) => { window.hostGift.setLocale(locale); window.hostGift.theme.setTheme(dark ? 'dark' : 'light') }, { locale, dark })
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: resolve(output, `${locale}-${width}.png`), format: 'png' })
  }
  await call('confirmGiftDays'); const logout = await last('gift'); await run(() => window.hostGift.session(null)); await reject(logout)
  assert.equal(await view('giftError'), ''); const loggedOut = await count('gift'); await call('confirmGiftDays'); assert.equal(await count('gift'), loggedOut)
  await run(() => window.hostGift.session('c')); await accept(await last('list'), list([3], 2)); await choose([3]); await call('openGiftDaysModal'); await call('confirmGiftDays')
  const unmounted = await last('gift'); await run(() => { window.hostGift.state.mounted = false }); await accept(unmounted, result([3]))
  assert.equal(await view('isGifting'), false); assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log('PASS paid target snapshot, strict days, duplicate gates, partial failures/retry, invalid receipts, host/session/cache/logout/unmount and desktop/mobile')
} finally { if (browser) await browser.close(); await server.close() }
