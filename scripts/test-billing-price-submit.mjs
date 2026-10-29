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
const output = resolve(root, 'logs/billing-price-submit'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js')
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/billing-price/*.js']
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/billing-price', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api\/admin$/, replacement: root + '/scripts/fixtures/billing-price/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19706, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19706', { settleMs: 1400 })
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await page.eval(() => !!window.billingHarness?.pending.length)) break
    if (attempt === 199) throw Error('billing fixture did not mount: ' + page.consoleErrors.join('\n'))
    await sleep(150)
  }
  const run = async (fn, arg) => { const value = await page.eval(fn, arg); await sleep(70); return value }
  const last = kind => page.eval(kind => window.billingHarness.pending.findLastIndex(item => item.kind === kind), kind)
  const count = kind => page.eval(kind => window.billingHarness.pending.filter(item => item.kind === kind).length, kind)
  const accept = (index, data) => run(({ index, data }) => window.billingHarness.pending[index].resolve(data), { index, data })
  const pool = id => ({ id, name: `Billing ${id}`, status: 'running', billingPrice: 10, billingCycle: 1, remainingDays: 15, user: { id: 1, username: 'fixture', balance: 100 } })
  const single = (price = 20) => ({ oldPrice: 10, newPrice: price, billingCycle: 1, remainingDays: 15, priceDiff: 5, discountRate: 0, userBalance: 100, instanceVersion: 0 })
  const batch = (price = 20, ids = [1]) => ({ summary: { selectedCount: ids.length, validCount: ids.length, changedCount: ids.length, unchangedCount: 0, failedCount: 0,
    totalCharge: ids.length * 5, totalRefund: 0, netAmount: ids.length * 5 }, canSubmit: true,
    items: ids.map(id => ({ id, name: `Billing ${id}`, user: { id: 1, username: 'fixture', balance: 100 }, oldPrice: 10, newPrice: price, billingCycle: 1,
      remainingDays: 15, priceDiff: 5, discountRate: 0, instanceVersion: 0, status: 'ready' })), userImpacts: [] })
  await accept(await last('list'), { instances: [pool(1), pool(2)], total: 2, hosts: [] })
  await run(() => { const v = window.billingHarness.view(); v.openPriceModal(v.instances[0]); v.priceForm.newPrice = 20 })
  await sleep(180); await accept(await last('single-preview'), single())
  await run(() => { void window.billingHarness.view().submitUpdatePrice() })
  const old = await last('single-save')
  await run(() => { window.billingHarness.session('b') })
  const requests = await page.eval(() => window.billingHarness.pending.length), toasts = await page.eval(() => window.billingHarness.toasts.length)
  await accept(old, { success: true, message: 'saved' })
  assert.equal(await page.eval(() => window.billingHarness.toasts.length), toasts, 'old write receipt cannot notify the replacement session')
  assert.equal(await page.eval(() => window.billingHarness.pending.length), requests, 'old write receipt cannot refresh the replacement session')
  const read = key => page.eval(key => JSON.parse(JSON.stringify(window.billingHarness.view()[key])), key)
  const reject = (index, preview) => run(({ index, preview }) => window.billingHarness.pending[index].reject(Object.assign(new Error('fixture write unavailable'), { preview })), { index, preview })
  const clear = async () => run(() => {
    const h = window.billingHarness, v = h.view(); v.showPriceModal = false; v.showBatchPriceModal = false
    h.auth.user = { id: 1, username: 'fixture', role: 'admin' }; h.session('a'); v.activeTab = 'instances'; v.selectedInstanceIds = [1]
  })
  for (const kind of ['single', 'batch']) {
    const prefix = kind === 'single' ? 'price' : 'batchPrice', modal = kind === 'single' ? 'showPriceModal' : 'showBatchPriceModal'
    const submit = kind === 'single' ? 'submitUpdatePrice' : 'submitBatchUpdatePrice', response = kind === 'single' ? single : batch
    const load = kind === 'single' ? 'loadPricePreview' : 'loadBatchPricePreview', ready = kind === 'single' ? 'canSubmitPrice' : 'canSubmitBatchPrice'
    const open = async () => {
      await clear()
      await run(kind => { const v = window.billingHarness.view(); if (kind === 'single') v.openPriceModal(v.instances[0]); else v.openBatchPriceModal(); v[kind === 'single' ? 'priceForm' : 'batchPriceForm'].newPrice = 20 }, kind)
      await sleep(180); await accept(await last(`${kind}-preview`), response())
    }
    const start = async () => { await open(); await run(submit => { void window.billingHarness.view()[submit]() }, submit); return last(`${kind}-save`) }
    const success = { success: true, message: 'saved', ...(kind === 'batch' ? { preview: batch() } : {}) }
    let pending = await start(), writes = await count(`${kind}-save`)
    await run(({ kind, submit }) => {
      const v = window.billingHarness.view(); void v[submit](); v.openPriceModal(v.instances[1]); v.openBatchPriceModal()
      const root = document.querySelector(`[data-billing-price="${kind}"]`)
      root.click(); root.querySelector('.modal-header button').click(); root.querySelector('.modal-footer button').click()
    }, { kind, submit })
    assert.equal(await count(`${kind}-save`), writes)
    assert.equal(await read(modal), true, 'close, cancel and backdrop cannot dismiss an in-flight write')
    assert.equal(await page.eval(kind => {
      const root = document.querySelector(`[data-billing-price="${kind}"]`)
      return [...root.querySelectorAll('input')].every(input => input.disabled)
    }, kind), true, 'the submitted draft is read-only while saving')
    await reject(pending, response(99))
    assert.equal(await read(ready), false, 'failure requires a fresh preview')
    assert.equal(await read(prefix + 'Preview'), null, 'error acknowledgement cannot smuggle in another preview')
    assert.equal(await read(prefix + 'Form').then(value => value.newPrice), 20, 'failed save retains the submitted draft')
    assert.match(await read(prefix + 'PreviewError'), /fixture write unavailable/)
    await run(submit => { void window.billingHarness.view()[submit]() }, submit)
    assert.equal(await count(`${kind}-save`), writes, 'failed write cannot retry with its old version')
    await run(load => { void window.billingHarness.view()[load]() }, load)
    await accept(await last(`${kind}-preview`), response())
    assert.equal(await read(ready), true)
    await run(submit => { void window.billingHarness.view()[submit]() }, submit)
    assert.equal(await count(`${kind}-save`), writes + 1, 'retry is possible after an explicitly refreshed preview')
    await reject(await last(`${kind}-save`))
    for (const change of ['session', 'session-aba', 'account', 'role', 'logout', 'tab', 'tab-aba', 'dialog', 'draft', 'draft-aba', 'target', 'selection', 'cache']) {
      pending = await start()
      const toasts = await page.eval(() => window.billingHarness.toasts.length)
      await run(async ({ change, prefix, modal, kind }) => {
        const h = window.billingHarness, v = h.view()
        if (change === 'session') h.session('b')
        if (change === 'session-aba') { h.session('b'); h.session('a'); v[modal] = true }
        if (change === 'account') h.auth.user = { ...h.auth.user, id: 2 }
        if (change === 'role') h.auth.user = { ...h.auth.user, role: 'user' }
        if (change === 'logout') h.session(null)
        if (change === 'tab') v.activeTab = 'records'
        if (change === 'tab-aba') { v.activeTab = 'records'; v.activeTab = 'instances'; v[modal] = true }
        if (change === 'dialog') { v[modal] = false; v[modal] = true }
        if (change === 'draft') v[prefix + 'Form'].newPrice = 40
        if (change === 'draft-aba') { v[prefix + 'Form'].newPrice = 40; v[prefix + 'Form'].newPrice = 20 }
        if (change === 'target') { if (kind === 'single') v.priceTarget = v.instances[1]; else v.selectedInstanceIds = [2] }
        if (change === 'selection') { if (kind === 'single') v.priceForm.settleBalance = false; else v.selectedInstanceIds = [2, 1] }
        if (change === 'cache') { await h.router.push('/other'); await h.router.push('/admin/billing?tab=instances'); v[modal] = true }
      }, { change, prefix, modal, kind })
      // Let any newly opened preview finish before checking for write-side refreshes.
      await sleep(180)
      const countBefore = await page.eval(() => window.billingHarness.pending.length)
      if (['session', 'session-aba', 'dialog', 'draft', 'draft-aba', 'cache'].includes(change)) await accept(pending, success); else await reject(pending, response(99))
      assert.equal(await page.eval(() => window.billingHarness.toasts.length), toasts, `${kind}/${change} old receipt stays quiet`)
      assert.equal(await page.eval(() => window.billingHarness.pending.length), countBefore, `${kind}/${change} no stale refresh`)
      if (change === 'draft') assert.equal((await read(prefix + 'Form')).newPrice, 40)
    }
    pending = await start()
    const previewsBefore = await count(`${kind}-preview`)
    await run(load => { void window.billingHarness.view()[load]() }, load)
    assert.equal(await count(`${kind}-preview`), previewsBefore, 'saving cannot start another preview request')
    await run(() => { window.billingHarness.session('a', 2) })
    await accept(pending, success)
    assert.equal(await read(modal), false, 'a valid write survives same-session refresh')
    await reject(await last('list')); await reject(await last('overview'))
    assert.equal(await read(prefix + 'PreviewError'), '', 'auxiliary refresh failure is not a price write failure')
    for (const change of ['session', 'draft', 'new-read']) {
      pending = await start(); await accept(pending, success)
      const oldList = await last('list'), oldOverview = await last('overview')
      const beforeToasts = await page.eval(() => window.billingHarness.toasts.length)
      await run(({ change, kind }) => {
        const h = window.billingHarness, v = h.view()
        if (change === 'session') h.session('b')
        if (change === 'draft') { if (kind === 'single') v.openPriceModal(v.instances[0]); else { v.selectedInstanceIds = [1]; v.openBatchPriceModal() } }
        if (change === 'new-read') { void v.loadInstances(); void v.loadOverview() }
      }, { change, kind })
      if (change === 'new-read') {
        await accept(await last('list'), { instances: [pool(1), pool(2)], total: 2, hosts: [] })
        await accept(await last('overview'), { overview: null })
      }
      await accept(oldList, { instances: [], total: 0, hosts: [] })
      await reject(oldOverview)
      assert.equal((await read('instances')).length, 2, `${kind}/${change} stale auxiliary read cannot replace the list`)
      assert.equal(await page.eval(() => window.billingHarness.toasts.length), beforeToasts, `${kind}/${change} stale auxiliary failure stays quiet`)
      if (change === 'draft') assert.equal(await read(modal), true)
    }
    pending = await start()
    await accept(pending, { success: false, message: 'not saved' })
    assert.equal(await read(modal), true, 'an invalid success receipt does not close the editor')
    assert.equal(await read(ready), false)
    for (const [locale, width, dark, mobile] of [['zh-CN', 1440, false, false], ['zh-CN', 768, false, false], ['en', 390, true, true]]) {
      await page.setViewport({ width, height: 1000, mobile })
      await run(({ locale, dark }) => { const h = window.billingHarness; h.setLocale(locale); h.theme.setTheme(dark ? 'dark' : 'light') }, { locale, dark })
      assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
      await page.screenshot({ path: resolve(output, `${kind}-${locale}-${width}.png`), format: 'png' })
    }
  }
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log('PASS single/batch price writes, busy controls, draft/session/dialog receipts, fresh retry and invalid acknowledgement matrix')
} finally { if (browser) await browser.close(); await server.close() }
