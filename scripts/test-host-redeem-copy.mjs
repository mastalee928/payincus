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
const output = resolve(root, 'logs/host-redeem-copy'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js')
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/host-redeem/*.js']
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/host-redeem', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/host-redeem/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19703, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19703', { settleMs: 1400 })
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await page.eval(() => !!window.redeemHarness?.pending.length)) break
    if (attempt === 199) throw Error('host redeem fixture did not mount: ' + page.consoleErrors.join('\n'))
    await sleep(150)
  }
  const run = async (fn, arg) => { const value = await page.eval(fn, arg); await sleep(90); return value }
  const last = kind => page.eval(kind => window.redeemHarness.pending.findLastIndex(item => item.kind === kind), kind)
  const accept = (index, data) => run(({ index, data }) => window.redeemHarness.pending[index].resolve(data), { index, data })
  const code = id => ({ id, code: `fixture-h-code-${id}`, codeType: 'c', codeValue: 10, maxUses: 1, usedCount: 0, expiresAt: null, enabled: true, remark: null, batchId: null, createdAt: '2026-10-29T00:00:00.000Z' })
  const options = { types: ['c', 'r', 'd', 't'].map(value => ({ value, label: value, unit: '%' })), ranges: Object.fromEntries(['c', 'r', 'd', 't'].map(type => [type, { min: 1, max: 100, unit: '%' }])) }
  const read = key => page.eval(key => JSON.parse(JSON.stringify(window.redeemHarness.view()[key])), key)
  const count = kind => page.eval(kind => window.redeemHarness.pending.filter(item => !kind || item.kind === kind).length, kind)
  await accept(await last('list'), { codes: [code(1)], total: 1 }); await accept(await last('options'), options)
  await run(() => {
    window.copyRequests = []
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: text => new Promise((resolve, reject) => window.copyRequests.push({ text, resolve, reject })) } })
    window.redeemHarness.view().copyCode('fixture-h-code-1', 1)
  })
  await run(() => { window.redeemHarness.state.id = 2 })
  await accept(await last('list'), { codes: [code(2)], total: 1 }); await accept(await last('options'), options)
  await run(() => window.copyRequests[0].resolve())
  assert.equal(await read('copiedCode'), null, 'old clipboard completion cannot mark a code in another host')
  console.log('PASS redeem clipboard host isolation')
  let visit = 100
  const fresh = async () => {
    await run(id => { const h = window.redeemHarness; h.state.id = id; h.state.active = true; h.state.mounted = true; h.auth.user = { id: 1, username: 'fixture', role: 'admin' }; h.session('a'); h.view().enabledFilter = 'all' }, visit++)
    await accept(await last('list'), { codes: [code(1), code(2)], total: 2 }); await accept(await last('options'), options)
  }
  const copy = async (id = 1) => {
    await run(id => { void window.redeemHarness.view().copyCode(`fixture-h-code-${id}`, id) }, id)
    return page.eval(() => window.copyRequests.length - 1)
  }
  const finish = (index, fail = false) => run(({ index, fail }) => {
    if (fail) window.copyRequests[index].reject(new Error('fixture clipboard refused'))
    else window.copyRequests[index].resolve()
  }, { index, fail })
  await fresh(); const first = await copy(), second = await copy(2)
  await finish(second); await finish(first); assert.equal(await read('copiedCode'), 2, 'latest requested copy owns its feedback')
  await finish(await copy(), true); assert.equal(await read('copiedCode'), null); assert.notEqual(await read('copyError'), '')
  await finish(await copy()); assert.equal(await read('copyError'), '')
  await sleep(1100); await finish(await copy(2)); await sleep(1100)
  assert.equal(await read('copiedCode'), 2, 'earlier timer cannot clear newer copy feedback')
  await sleep(1100); assert.equal(await read('copiedCode'), null)
  await fresh(); const beforeInvalid = await page.eval(() => window.copyRequests.length)
  await run(() => { window.redeemHarness.view().copyCode('wrong-code', 1); window.redeemHarness.view().copyCode('fixture-h-code-999', 999) })
  assert.equal(await page.eval(() => window.copyRequests.length), beforeInvalid)
  for (const change of ['hostABA', 'session', 'account', 'role', 'logout', 'filter', 'cache', 'unmount']) {
    await fresh(); const request = await copy(), original = await page.eval(() => window.redeemHarness.state.id)
    await run(change => { const h = window.redeemHarness
      if (change === 'hostABA') h.state.id++
      if (change === 'session') h.session('b')
      if (change === 'account') h.auth.user = { ...h.auth.user, id: 2 }
      if (change === 'role') h.auth.user = { ...h.auth.user, role: 'user' }
      if (change === 'logout') h.session(null)
      if (change === 'filter') h.view().enabledFilter = 'false'
      if (change === 'cache') h.state.active = false
      if (change === 'unmount') h.state.mounted = false
    }, change)
    if (change === 'hostABA') await run(id => { window.redeemHarness.state.id = id }, original)
    await finish(request, ['session', 'account', 'unmount'].includes(change))
    assert.equal(await read('copiedCode'), null, `${change} old copy must not update`)
    assert.equal(await read('copyError'), '', `${change} old failure must not update`)
  }
  await fresh(); const sameSid = await copy(); await run(() => window.redeemHarness.session('a', 2)); await finish(sameSid); assert.equal(await read('copiedCode'), 1)
  await fresh(); const replaced = await copy(); await run(() => { window.redeemHarness.view().codes[0].code = 'changed' }); await finish(replaced); assert.equal(await read('copiedCode'), null)
  const openBatch = async () => {
    await run(() => { const v = window.redeemHarness.view(); v.openCreateModal(); v.createForm.codeValue = 5; v.createForm.batchCount = 2; void v.handleCreate() })
    await accept(await last('create'), { message: 'created', codes: ['fixture-batch-1', 'fixture-batch-2'], count: 2, batchId: 'fixture-batch' })
    await accept(await last('list'), { codes: [code(1), code(2)], total: 2 })
    assert.equal(await read('showBatchResultModal'), true)
  }
  const copyBatch = async () => {
    await run(() => { void window.redeemHarness.view().copyBatchCodes() })
    return page.eval(() => window.copyRequests.length - 1)
  }
  await fresh(); await openBatch(); const batch = await copyBatch()
  assert.equal(await page.eval(index => window.copyRequests[index].text, batch), 'fixture-batch-1\nfixture-batch-2')
  await finish(batch, true); assert.equal(await read('copiedBatch'), false); assert.notEqual(await read('batchCopyError'), '')
  await finish(await copyBatch()); assert.equal(await read('copiedBatch'), true); assert.equal(await read('batchCopyError'), '')
  const oldBatch = await copyBatch(); await run(() => { window.redeemHarness.view().showBatchResultModal = false })
  await openBatch(); await finish(oldBatch); assert.equal(await read('copiedBatch'), false, 'old batch response cannot mark a reopened dialog')
  await run(() => {
    const dialog = document.querySelector('[data-batch-result]'), controls = [...dialog.querySelectorAll('button')].filter(el => !el.matches(':disabled') && el.getClientRects().length)
    if (!dialog || dialog.getAttribute('role') !== 'dialog') throw Error('batch dialog semantics missing')
    controls.at(-1).focus(); controls.at(-1).dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    if (document.activeElement !== controls[0]) throw Error('batch result keyboard focus escaped')
  })
  for (const [locale, width, dark, mobile] of [['zh-CN', 1440, false, false], ['en', 390, true, true]]) {
    await page.setViewport({ width, height: 740, mobile }); await run(({ locale, dark }) => { window.redeemHarness.setLocale(locale); window.redeemHarness.theme.setTheme(dark ? 'dark' : 'light'); window.redeemHarness.view().batchCreatedCodes = Array.from({ length: 100 }, (_, i) => `fixture-batch-${i}`) }, { locale, dark })
    await finish(await copyBatch(), true)
    assert.equal(await page.eval(() => {
      const dialog = document.querySelector('[data-batch-result]'), buttons = [...dialog.querySelectorAll('button')]
      return document.documentElement.scrollWidth <= innerWidth && buttons.every(el => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight })
    }), true)
    await page.screenshot({ path: resolve(output, `${locale}-${width}.png`), format: 'png' })
  }
  await run(() => document.querySelector('[data-batch-result]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
  assert.equal(await read('showBatchResultModal'), false)
  await fresh(); await run(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }); void window.redeemHarness.view().copyCode('fixture-h-code-1', 1) })
  assert.notEqual(await read('copyError'), '')
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log('PASS copy ordering, timer, failure, session/lifecycle, batch dialog and keyboard/mobile matrix')
} finally { if (browser) await browser.close(); await server.close() }
