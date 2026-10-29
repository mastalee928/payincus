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
const output = resolve(root, 'logs/billing-price-writes'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js')
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/billing-price/*.js']
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/billing-price', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api\/admin$/, replacement: root + '/scripts/fixtures/billing-price/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19705, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19705', { settleMs: 1400 })
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await page.eval(() => !!window.billingHarness?.pending.length)) break
    if (attempt === 199) throw Error('billing fixture did not mount: ' + page.consoleErrors.join('\n'))
    await sleep(150)
  }
  const run = async (fn, arg) => { const value = await page.eval(fn, arg); await sleep(60); return value }
  const last = kind => page.eval(kind => window.billingHarness.pending.findLastIndex(item => item.kind === kind), kind)
  const count = kind => page.eval(kind => window.billingHarness.pending.filter(item => item.kind === kind).length, kind)
  const accept = (index, data) => run(({ index, data }) => window.billingHarness.pending[index].resolve(data), { index, data })
  const single = (price = 20) => ({ oldPrice: 10, newPrice: price, billingCycle: 1, remainingDays: 15, priceDiff: 5, discountRate: 0, userBalance: 100, instanceVersion: 0 })
  await accept(await last('list'), { instances: [{ id: 1, name: 'Billing fixture', status: 'running', billingPrice: 10, billingCycle: 1, remainingDays: 15, user: { id: 1, username: 'fixture', balance: 100 } }], total: 1, hosts: [] })
  await run(() => { const v = window.billingHarness.view(); v.openPriceModal(v.instances[0]); v.priceForm.newPrice = 20 })
  await sleep(180); await accept(await last('single-preview'), single())
  const before = await count('single-save')
  // Same JS task: Vue's next render must not be needed to invalidate authorization to submit.
  await run(() => { const v = window.billingHarness.view(); v.priceForm.newPrice = 30; void v.submitUpdatePrice() })
  assert.equal(await count('single-save'), before, 'changing price invalidates the old preview before the debounce fires')
  assert.equal(await page.eval(() => window.billingHarness.view().pricePreview), null)
  const read = key => page.eval(key => JSON.parse(JSON.stringify(window.billingHarness.view()[key])), key)
  const reject = index => run(index => window.billingHarness.pending[index].reject(new Error('fixture preview unavailable')), index)
  const batch = (price = 20, ids = [1]) => ({ summary: { selectedCount: ids.length, validCount: ids.length, changedCount: ids.length, unchangedCount: 0, failedCount: 0,
    totalCharge: ids.length * 5, totalRefund: 0, netAmount: ids.length * 5 }, canSubmit: true,
    items: ids.map(id => ({ id, name: `Billing ${id}`, user: { id: 1, username: 'fixture', balance: 100 }, oldPrice: 10, newPrice: price, billingCycle: 1,
      remainingDays: 15, priceDiff: 5, discountRate: 0, instanceVersion: 0, status: 'ready' })), userImpacts: [] })
  const reset = async () => {
    await run(() => {
      const h = window.billingHarness, v = h.view(); v.showPriceModal = false; v.showBatchPriceModal = false
      h.auth.user = { id: 1, username: 'fixture', role: 'admin' }; h.session('a'); v.activeTab = 'instances'; v.selectedInstanceIds = [1]
    })
  }
  for (const kind of ['single', 'batch']) {
    const prefix = kind === 'single' ? 'price' : 'batchPrice', modal = kind === 'single' ? 'showPriceModal' : 'showBatchPriceModal'
    const submit = kind === 'single' ? 'submitUpdatePrice' : 'submitBatchUpdatePrice', load = kind === 'single' ? 'loadPricePreview' : 'loadBatchPricePreview'
    const readyKey = kind === 'single' ? 'canSubmitPrice' : 'canSubmitBatchPrice', response = kind === 'single' ? single : batch
    const open = async () => {
      await reset()
      await run(kind => { const v = window.billingHarness.view(); if (kind === 'single') v.openPriceModal(v.instances[0]); else v.openBatchPriceModal(); v[kind === 'single' ? 'priceForm' : 'batchPriceForm'].newPrice = 20 }, kind)
      const before = await count(`${kind}-save`)
      await run(submit => { void window.billingHarness.view()[submit]() }, submit)
      assert.equal(await count(`${kind}-save`), before, `${kind} requires a finished preview`)
      await sleep(180)
      return last(`${kind}-preview`)
    }
    for (const field of ['newPrice', 'settleBalance', ...(kind === 'batch' ? ['selection'] : ['target'])]) {
      await accept(await open(), response())
      assert.equal(await read(readyKey), true)
      const before = await count(`${kind}-save`)
      await run(({ prefix, field, submit }) => {
        const v = window.billingHarness.view()
        if (field === 'selection') v.selectedInstanceIds = [2]
        else if (field === 'target') v.priceTarget = { ...v.priceTarget, id: 2 }
        else v[prefix + 'Form'][field] = field === 'newPrice' ? 30 : false
        void v[submit]()
      }, { prefix, field, submit })
      assert.equal(await count(`${kind}-save`), before, `${kind}/${field} cannot use a previous quote`)
      assert.equal(await read(prefix + 'Preview'), null)
      assert.equal(await read(prefix + 'PreviewLoading'), true, 'debouncing is already loading')
      assert.equal(await page.eval(kind => document.querySelector(`[data-billing-price="${kind}"] .modal-footer .btn-primary`).disabled, kind), true)
    }
    const late = await open()
    await run(prefix => { window.billingHarness.view()[prefix + 'Form'].newPrice = 40 }, prefix)
    await accept(late, response())
    assert.equal(await read(prefix + 'Preview'), null, 'a previous response inside debounce cannot re-enable submit')
    await sleep(180)
    await accept(await last(`${kind}-preview`), response(40))
    assert.equal(await read(readyKey), true)
    for (const change of ['session', 'account', 'role', 'logout', 'close', 'tab', ...(kind === 'batch' ? ['empty-selection'] : [])]) {
      const pending = await open(), toasts = await page.eval(() => window.billingHarness.toasts.length)
      await run(({ change, modal }) => {
        const h = window.billingHarness, v = h.view()
        if (change === 'session') h.session('b')
        if (change === 'account') h.auth.user = { ...h.auth.user, id: 2 }
        if (change === 'role') h.auth.user = { ...h.auth.user, role: 'user' }
        if (change === 'logout') h.session(null)
        if (change === 'close') v[modal] = false
        if (change === 'tab') v.activeTab = 'records'
        if (change === 'empty-selection') v.selectedInstanceIds = []
      }, { change, modal })
      await reject(pending)
      assert.equal(await read(prefix + 'Preview'), null, `${kind}/${change} refuses old preview`)
      assert.equal(await read(readyKey), false)
      assert.equal(await page.eval(() => window.billingHarness.toasts.length), toasts)
    }
    const refreshed = await open()
    await run(() => { window.billingHarness.session('a', 2) })
    await accept(refreshed, response())
    assert.equal(await read(readyKey), true, 'same-session JWT refresh keeps the valid preview')
    const aba = await open()
    await run(prefix => { const v = window.billingHarness.view(); v[prefix + 'Form'].newPrice = 30; v[prefix + 'Form'].newPrice = 20 }, prefix)
    await accept(aba, response())
    assert.equal(await read(prefix + 'Preview'), null, 'changing away and back still invalidates the first request')
    for (const price of [-1, 100001, null, 'bad']) {
      const before = await count(`${kind}-preview`)
      await run(({ prefix, price, submit }) => { const v = window.billingHarness.view(); v[prefix + 'Form'].newPrice = price; void v[submit]() }, { prefix, price, submit })
      await sleep(180)
      assert.equal(await count(`${kind}-preview`), before, 'invalid price never reaches the preview API')
      assert.equal(await read(readyKey), false)
    }
    await open(); await reject(await last(`${kind}-preview`))
    assert.equal(await read(readyKey), false)
    assert.match(await read(prefix + 'PreviewError'), /fixture preview unavailable/)
    await run(load => { void window.billingHarness.view()[load]() }, load)
    await accept(await last(`${kind}-preview`), response())
    assert.equal(await read(readyKey), true, 'current failed preview can be retried')
    // Values/identities from a malformed or mismatched acknowledgement cannot authorize a write.
    for (const invalid of kind === 'single' ? [{ ...single(), instanceVersion: -1 }, { ...single(), newPrice: 99 }, { ...single(), userBalance: null }] :
      [batch(20, [2]), batch(20, []), { ...batch(), items: [{ ...batch().items[0], instanceVersion: null }] }]) {
      await run(load => { void window.billingHarness.view()[load]() }, load)
      await accept(await last(`${kind}-preview`), invalid)
      assert.equal(await read(readyKey), false)
    }
    await open()
    await run(prefix => { window.billingHarness.view()[prefix + 'Form'].newPrice = 0 }, prefix); await sleep(180)
    await accept(await last(`${kind}-preview`), response(0))
    assert.equal(await read(readyKey), true, 'zero price and version zero are valid')
    const beforeSave = await count(`${kind}-save`)
    await run(submit => { const v = window.billingHarness.view(); void v[submit](); void v[submit]() }, submit)
    assert.equal(await count(`${kind}-save`), beforeSave + 1, 'confirmed quote submits exactly once')
    assert.deepEqual(await page.eval(index => window.billingHarness.pending[index].data, await last(`${kind}-save`)), kind === 'single'
      ? { id: 1, price: 0, settle: true, version: 0 }
      : { ids: [1], price: 0, settle: true, expectations: [{ instanceId: 1, version: 0 }] })
    await reject(await last(`${kind}-save`))
    const cached = await open()
    await run(async () => { await window.billingHarness.router.push('/other') })
    await accept(cached, response())
    assert.equal(await read(readyKey), false, 'deactivated cached page cannot accept a preview')
    await run(async () => { await window.billingHarness.router.push('/admin/billing?tab=instances') })
    assert.equal(await read(modal), false, 'reactivation does not reopen an old preview')
  }
  await reset()
  await run(() => { const v = window.billingHarness.view(); v.openPriceModal(v.instances[0]); v.priceForm.newPrice = 20 })
  await sleep(180); await accept(await last('single-preview'), { ...single(), userBalance: 0 })
  assert.equal(await read('canSubmitPrice'), false, 'current zero balance cannot fall back to stale list balance')
  assert.equal(await page.eval(() => document.querySelector('[data-billing-price="single"]').textContent.includes('¥100.00')), false, 'displayed balance agrees with the quote')
  for (const [locale, width, dark, mobile] of [['zh-CN', 1440, false, false], ['zh-CN', 768, false, false], ['en', 390, true, true]]) {
    await page.setViewport({ width, height: 1000, mobile })
    await run(({ locale, dark }) => { const h = window.billingHarness; h.setLocale(locale); h.theme.setTheme(dark ? 'dark' : 'light') }, { locale, dark })
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: resolve(output, `${locale}-${width}.png`), format: 'png' })
  }
  await reset()
  await run(() => { const v = window.billingHarness.view(); v.openPriceModal(v.instances[0]) })
  const beforeLeave = await count('single-preview')
  await run(() => { window.billingHarness.state.mounted = false })
  await sleep(180)
  assert.equal(await count('single-preview'), beforeLeave, 'unmount cancels a queued debounce')
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log('PASS single/batch preview debounce, stale response, identities, invalid inputs, zero, errors/retry and unmount matrix')
} finally { if (browser) await browser.close(); await server.close() }
