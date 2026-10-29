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
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/host-price-lifecycle/*.js']
const output = resolve(root, 'logs/host-price-lifecycle-lifecycle'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const server = await createServer({ configFile: false, root: root + '/scripts/fixtures/host-price-lifecycle', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/host-price-lifecycle/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19683, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19683', { settleMs: 1600 })
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(90); return result }
  const last = kind => page.eval(kind => window.hostPrice.pending.findLastIndex(item => item.kind === kind), kind)
  const accept = (index, data) => run(({ index, data }) => window.hostPrice.pending[index].resolve(data), { index, data })
  const row = (id, hostId = 1) => ({ id, name: `Fixture instance ${id}`, hostId, status: 'running', image: 'debian/12', cpu: 1, memory: 512, disk: 10240, username: 'Fixture user', packagePlanId: 1, billingPrice: 10 })
  const list = (ids, hostId = 1, status = 'running') => ({ instances: ids.map(id => ({ ...row(id, hostId), status })), total: ids.length, totalPages: 1 })
  const choose = ids => run(ids => { window.hostPrice.view().selectedIds = new Set(ids) }, ids)
  await accept(await last('list'), list([1]))
  await run(() => { const v = window.hostPrice.view(); v.openPriceModal(v.instances[0]); v.newPriceInput = 15; void v.updateRenewalPrice() })
  const old = await last('price')
  await run(() => { window.hostPrice.state.id = 2 }); await accept(await last('list'), list([2], 2))
  await run(() => { const v = window.hostPrice.view(); v.openPriceModal(v.instances[0]) })
  await accept(old, { instanceId: 1, oldPrice: 10, newPrice: 15 })
  assert.equal(await page.eval(() => window.hostPrice.view().instances[0].billingPrice), 10, 'old price receipt must not update a new host target')
  console.log('PASS old price receipt cannot update another instance')
  const view = key => page.eval(key => JSON.parse(JSON.stringify(window.hostPrice.view()[key])), key)
  const count = kind => page.eval(kind => window.hostPrice.pending.filter(item => item.kind === kind).length, kind)
  const reject = index => run(index => window.hostPrice.pending[index].reject(new Error('Fixture price failure')), index)
  const call = method => run(method => { void window.hostPrice.view()[method]() }, method)
  const open = () => run(() => { const v = window.hostPrice.view(); v.openPriceModal(v.instances[0]) })
  if (await view('showPriceModal')) await run(() => { window.hostPrice.view().showPriceModal = false })
  await open()
  const initial = await count('price')
  for (const value of [-1, 100000, '', '15', null, 10]) {
    await run(value => { window.hostPrice.view().newPriceInput = value }, value)
    await call('updateRenewalPrice'); assert.equal(await count('price'), initial, `invalid/unchanged price: ${value}`)
  }
  await run(() => { window.hostPrice.view().newPriceInput = Infinity }); await call('updateRenewalPrice'); assert.equal(await count('price'), initial)
  await run(() => { window.hostPrice.view().newPriceInput = 15 }); await call('updateRenewalPrice'); const current = await last('price')
  await call('updateRenewalPrice'); assert.equal(await count('price'), initial + 1)
  assert.deepEqual(await page.eval(index => window.hostPrice.pending[index].params, current), { hostId: 2, instanceId: 2, newPrice: 15 })
  // A price request may finish after the user has edited another value in the same draft.
  await run(() => { window.hostPrice.view().newPriceInput = 20 }); await accept(current, { instanceId: 2, oldPrice: 10, newPrice: 15 })
  assert.equal(await view('newPriceInput'), 20); assert.equal(await view('showPriceModal'), true)
  assert.equal((await view('instances'))[0].billingPrice, 15)
  await call('updateRenewalPrice'); await reject(await last('price')); assert.ok(await view('priceError')); assert.equal(await view('isUpdatingPrice'), false)
  for (const data of [{ instanceId: 999, newPrice: 20 }, { instanceId: 2, newPrice: -1 }, { instanceId: 2, newPrice: '20' }]) {
    await call('updateRenewalPrice'); await accept(await last('price'), data); assert.ok(await view('priceError')); assert.equal((await view('instances'))[0].billingPrice, 15)
  }
  await call('updateRenewalPrice'); await accept(await last('price'), { instanceId: 2, newPrice: 20 })
  assert.equal(await view('showPriceModal'), false); assert.equal((await view('instances'))[0].billingPrice, 20)
  const closed = await count('price'); await call('updateRenewalPrice'); assert.equal(await count('price'), closed)
  await open(); await run(() => { window.hostPrice.view().newPriceInput = 0 }); await call('updateRenewalPrice')
  await accept(await last('price'), { instanceId: 2, newPrice: 0 }); assert.equal((await view('instances'))[0].billingPrice, 0)
  await open(); await run(() => { window.hostPrice.view().newPriceInput = 99999 }); await call('updateRenewalPrice')
  await accept(await last('price'), { instanceId: 2, newPrice: 99999 }); assert.equal((await view('instances'))[0].billingPrice, 99999)
  await open(); await run(() => { window.hostPrice.view().newPriceInput = 15 }); await call('updateRenewalPrice'); const refreshing = await last('price')
  await call('loadInstances'); await accept(await last('list'), list([2], 2)); await accept(refreshing, { instanceId: 2, newPrice: 15 })
  assert.equal((await view('instances'))[0].billingPrice, 15); assert.equal(await view('showPriceModal'), false)
  await open(); await run(() => { window.hostPrice.view().newPriceInput = 20 }); await call('updateRenewalPrice'); const loadingWrite = await last('price')
  await call('loadInstances'); const staleList = await last('list'); await accept(loadingWrite, { instanceId: 2, newPrice: 20 })
  const freshList = await last('list'); assert.notEqual(freshList, staleList)
  await accept(staleList, list([2], 2)); assert.equal(await view('loading'), true)
  const currentList = list([2], 2); currentList.instances[0].billingPrice = 20; await accept(freshList, currentList)
  assert.equal((await view('instances'))[0].billingPrice, 20, 'list response started before the price write cannot restore old price')
  await open(); await run(() => window.hostPrice.session('a', 2)); assert.equal(await view('showPriceModal'), true)
  await run(() => { window.hostPrice.view().newPriceInput = 25 }); await call('updateRenewalPrice'); const oldSession = await last('price')
  await run(() => window.hostPrice.session('b')); await accept(await last('list'), list([2], 2)); await reject(oldSession)
  assert.equal(await view('priceError'), ''); assert.equal(await view('showPriceModal'), false)
  await open(); await run(() => { window.hostPrice.view().newPriceInput = 20 }); await call('updateRenewalPrice'); const oldCache = await last('price')
  await run(() => { window.hostPrice.state.active = false }); await run(() => { window.hostPrice.state.active = true }); await accept(await last('list'), list([2], 2))
  await accept(oldCache, { instanceId: 2, newPrice: 20 }); assert.equal((await view('instances'))[0].billingPrice, 10)
  await open(); await run(() => { window.hostPrice.view().newPriceInput = 20 }); await call('updateRenewalPrice'); await reject(await last('price'))
  await run(() => {
    const dialog = document.querySelector('[role="dialog"]'), controls = dialog.querySelectorAll('button, input')
    controls[controls.length - 1].focus(); controls[controls.length - 1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    if (document.activeElement !== controls[0]) throw new Error('price confirmation must retain focus')
  })
  for (const [locale, width, dark, mobile] of [['zh-CN', 1440, false, false], ['en', 390, true, true]]) {
    await page.setViewport({ width, height: 1000, mobile })
    await run(({ locale, dark }) => { window.hostPrice.setLocale(locale); window.hostPrice.theme.setTheme(dark ? 'dark' : 'light') }, { locale, dark })
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: resolve(output, `${locale}-${width}.png`), format: 'png' })
  }
  await call('updateRenewalPrice'); const logout = await last('price'); await run(() => window.hostPrice.session(null)); await reject(logout)
  assert.equal(await view('priceError'), ''); const loggedOut = await count('price'); await call('updateRenewalPrice'); assert.equal(await count('price'), loggedOut)
  await run(() => window.hostPrice.session('c')); await accept(await last('list'), list([2], 2))
  await run(() => { window.hostPrice.view().instances[0].packagePlanId = null }); await open(); assert.equal(await view('showPriceModal'), false)
  await run(() => { window.hostPrice.view().instances[0].packagePlanId = 1 }); await open(); await run(() => { window.hostPrice.view().newPriceInput = 20 }); await call('updateRenewalPrice')
  const unmounted = await last('price'); await run(() => { window.hostPrice.state.mounted = false }); await accept(unmounted, { instanceId: 2, newPrice: 20 })
  assert.equal(await view('isUpdatingPrice'), false); assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log('PASS fixed price target, strict bounds, duplicate gates, newer draft, current row after refresh, bad receipts, session/cache/logout/unmount and both viewports')
} finally { if (browser) await browser.close(); await server.close() }
