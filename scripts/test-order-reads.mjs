import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { Browser, sleep } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'
import { probe } from '../.agents/skills/design-taste-frontend/scripts/lib/probe.mjs'
import { judge, APP_SKIP } from '../.agents/skills/design-taste-frontend/scripts/lib/rules.mjs'
const root = fileURLToPath(new URL('..', import.meta.url)).replaceAll('\\', '/')
const require = createRequire(new URL('../client/package.json', import.meta.url))
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href)
const { default: vue } = await import(pathToFileURL(require.resolve('@vitejs/plugin-vue')).href)
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js')
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/order-reads/*.js']
const output = resolve(root, 'logs/order-reads'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const server = await createServer({ configFile: false, cacheDir: output + '/vite-cache', root: root + '/scripts/fixtures/order-reads', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/order-reads/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19761, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  const run = async (fn, arg) => { const value = await page.eval(fn, arg); await sleep(70); return value }
  const last = kind => page.eval(kind => window.orderReads?.pending.findLastIndex(item => item.kind === kind) ?? -1, kind)
  const read = key => page.eval(key => JSON.parse(JSON.stringify(window.orderReads.view()[key])), key)
  const accept = (index, data) => run(({ index, data }) => window.orderReads.pending[index].resolve(data), { index, data })
  const reject = index => run(index => window.orderReads.pending[index].reject(new Error('Isolated order read unavailable')), index)
  const row = (sourceId = 1, userId = 1, sourceType = 'instance_billing') => ({ id: `${sourceType}:${sourceId}`, sourceType, sourceId, userId,
    orderNo: `BILL-${sourceId}`, title: '实例续费', rawStatus: sourceType === 'recharge' ? 'completed' : 'renew', status: 'completed', amount: 10, actualAmount: 10, fee: 0,
    provider: null, paymentMethod: 'balance', tradeNo: null, failReason: null, instance: { id: 91, name: 'Osaka server' }, months: 1,
    periodStart: '2026-10-01T00:00:00Z', periodEnd: '2026-11-01T00:00:00Z', remark: null, createdAt: '2026-10-01T00:00:00Z', completedAt: null, expiredAt: null })
  const list = (orders = [row(1), row(2)], total = orders.length, pageNo = 1) => ({ orders, total, page: pageNo, pageSize: 10 })
  const fresh = async (loaded = true) => {
    await page.goto('http://127.0.0.1:19761', { settleMs: 800 })
    const until = Date.now() + 15000
    while (await last('list') < 0) { if (Date.now() > until) throw Error('Orders did not request data'); await sleep(100) }
    if (loaded) await accept(await last('list'), list())
  }
  const open = async (id = 1) => { await run(id => { const v = window.orderReads.view(); void v.openDetail(v.orders.find(item => item.sourceId === id)) }, id); return last('detail') }
  let request, staleCases = 0
  if (!process.argv.includes('--visual-only') && !process.argv.includes('--pagination-only')) {
  await fresh(); request = await open()
  await run(() => { window.orderReads.view().selectedOrder = null })
  await accept(request, { order: row() })
  assert.equal(await read('selectedOrder'), null, 'closed order drawer must not reopen on its old reply')
  console.log('PASS R205 closed detail stays closed')
  for (const change of ['close', 'reopen', 'sameTarget', 'target', 'targetABA', 'account', 'session', 'storage', 'role', 'logout', 'cache', 'route', 'unmount', 'filter', 'page']) {
    for (const failure of [false, true]) {
      await fresh(); request = await open()
      await run(change => {
        const h = window.orderReads, v = h.view()
        if (change === 'close') v.selectedOrder = null
        if (change === 'reopen') { v.selectedOrder = null; void v.openDetail(v.orders[0]) }
        if (change === 'sameTarget') void v.openDetail(v.orders[0])
        if (change === 'target' || change === 'targetABA') { void v.openDetail(v.orders[1]); if (change === 'targetABA') void v.openDetail(v.orders[0]) }
        if (change === 'account') h.session(2)
        if (change === 'session') h.session(1, 'new-session')
        if (change === 'storage') localStorage.setItem('token', 'other-tab-session')
        if (change === 'role') h.session(1, 'order-session', 'admin')
        if (change === 'logout') { h.auth.user = null; h.auth.token = null }
        if (change === 'cache') h.active.value = false
        if (change === 'route') void h.router.push('/dashboard')
        if (change === 'unmount') h.mounted.value = false
        if (change === 'filter') { v.type = 'recharge'; v.applyFilters() }
        if (change === 'page') v.page = 2
      }, change)
      const before = { selected: await read('selectedOrder'), loading: await read('detailLoading'), error: await read('detailError') }
      if (failure) await reject(request); else await accept(request, { order: { ...row(), remark: 'obsolete receipt' } })
      assert.deepEqual({ selected: await read('selectedOrder'), loading: await read('detailLoading'), error: await read('detailError') }, before, `${change} stale detail ${failure ? 'failure' : 'success'}`)
      staleCases++
    }
  }
  for (const change of ['account', 'session', 'storage', 'role', 'logout', 'cache', 'route', 'unmount', 'filter', 'page', 'refresh']) for (const failure of [false, true]) {
    await fresh(false); request = await last('list')
    await run(change => { const h = window.orderReads, v = h.view()
      if (change === 'account') h.session(2)
      if (change === 'session') h.session(1, 'new-session')
      if (change === 'storage') localStorage.setItem('token', 'other-tab-session')
      if (change === 'role') h.session(1, 'order-session', 'admin')
      if (change === 'logout') { h.auth.token = null; h.auth.user = null }
      if (change === 'cache') h.active.value = false
      if (change === 'route') void h.router.push('/dashboard')
      if (change === 'unmount') h.mounted.value = false
      if (change === 'filter') { v.type = 'recharge'; v.applyFilters() }
      if (change === 'page') v.page = 2
      if (change === 'refresh') void v.loadOrders()
    }, change)
    const before = { rows: await read('orders'), loading: await read('loading'), error: await read('error'), total: await read('total') }
    if (failure) await reject(request); else await accept(request, list([row(99)]))
    assert.deepEqual({ rows: await read('orders'), loading: await read('loading'), error: await read('error'), total: await read('total') }, before, `${change} stale list`)
    staleCases++
  }
  await fresh(); request = await open(); await reject(request)
  assert.ok(await read('detailError')); assert.equal(await read('detailLoading'), false)
  await run(() => document.querySelector('[data-order-detail-retry]').click())
  await accept(await last('detail'), { order: { ...row(), amount: 0, actualAmount: 0 } })
  assert.equal((await read('selectedOrder')).amount, 0); assert.equal(await read('detailError'), '')
  for (const invalid of [row(2), row(1, 2), { ...row(), sourceType: 'recharge' }, { ...row(), amount: '10' }, { ...row(), sourceId: 0 }]) {
    request = await open(); await accept(request, { order: invalid }); assert.ok(await read('detailError'), 'mismatched or malformed detail rejected')
  }
  for (const invalid of [list([row(1, 2)]), list([row(), row()]), { ...list(), page: 2 }, { ...list(), total: '2' }, { ...list(), pageSize: 100 }]) {
    await fresh(false); await accept(await last('list'), invalid); assert.ok(await read('error')); assert.equal((await read('orders')).length, 0)
  }
  await fresh(); request = await open(); await run(() => window.orderReads.session(1, 'order-session', 'user', 'refreshed'))
  await accept(request, { order: row() }); assert.equal((await read('selectedOrder')).sourceId, 1); assert.equal(await read('detailLoading'), false)
  await run(() => { window.orderReads.active.value = false }); const countBefore = await page.eval(() => window.orderReads.pending.length)
  await run(() => { window.orderReads.active.value = true }); assert.equal(await page.eval(() => window.orderReads.pending.length), countBefore + 1)
  await accept(await last('list'), list()); assert.equal(await read('selectedOrder'), null)
  console.log(`PASS R205 ${staleCases} obsolete success/failure replies, current error/retry, 10 invalid receipts, same-session refresh and cache reload`)
  }
  if (!process.argv.includes('--visual-only')) {
    await fresh(false); await accept(await last('list'), list([row()], 31))
    await run(() => window.orderReads.view().goPage(4)); request = await last('list')
    await accept(request, list([], 12, 4))
    assert.equal(await read('page'), 2, 'R206 removed rows move an out-of-range page to the final valid page')
    assert.equal(await read('loading'), true, 'correction remains visibly loading')
    assert.equal(await page.eval(() => window.orderReads.pending.at(-1).params.page), 2)
    await accept(await last('list'), list([row(12)], 12, 2))
    assert.equal((await read('orders'))[0].sourceId, 12); assert.equal(await read('loading'), false)
    await run(() => { void window.orderReads.view().loadOrders() }); await accept(await last('list'), list([], 0, 2))
    assert.equal(await read('page'), 1); await accept(await last('list'), list([], 0, 1))
    assert.equal(await read('error'), ''); assert.equal(await read('loading'), false)
    assert.equal(await read('totalPages'), 1)
    // A failing correction remains retryable on the corrected page.
    await fresh(false); await accept(await last('list'), list([row()], 31))
    await run(() => window.orderReads.view().goPage(4)); await accept(await last('list'), list([], 1, 4))
    await reject(await last('list')); assert.ok(await read('error')); assert.equal(await read('page'), 1)
    await run(() => { void window.orderReads.view().loadOrders() }); await accept(await last('list'), list([row()], 1, 1))
    assert.equal(await read('error'), ''); assert.equal((await read('orders')).length, 1)
    // A late correction cannot change a new filter or its page/loading state.
    await fresh(false); await accept(await last('list'), list([row()], 31))
    await run(() => window.orderReads.view().goPage(4)); await accept(await last('list'), list([], 12, 4))
    request = await last('list')
    await run(() => { const v = window.orderReads.view(); v.type = 'recharge'; v.applyFilters() })
    await accept(request, list([row(12)], 12, 2))
    assert.equal(await read('page'), 1); assert.equal((await read('orders')).length, 0); assert.equal(await read('loading'), true)
    await accept(await last('list'), list([row(4, 1, 'recharge')], 1))
    assert.equal((await read('orders'))[0].sourceType, 'recharge')
    console.log('PASS R206 shrinking totals, empty list, correction error/retry and obsolete correction preserve the current query')
  }
  if (!process.argv.includes('--pagination-only')) for (const locale of ['zh-CN', 'zh-TW', 'en']) for (const width of [1440, 768, 390]) for (const dark of [false, true]) {
    await fresh(); await page.setViewport({ width, height: 900, mobile: width === 390 })
    await run(({ locale, dark }) => { window.orderReads.setLocale(locale); window.orderReads.theme.setTheme(dark ? 'dark' : 'light') }, { locale, dark })
    await run(() => [...document.querySelectorAll('button')].find(el => el.getClientRects().length && el.textContent.trim() === window.orderReads.view().t('orders.detail')).click())
    request = await last('detail'); await reject(request)
    assert.ok(await page.eval(() => document.querySelector('[role="dialog"]').contains(document.activeElement)))
    assert.ok(await page.eval(() => document.querySelector('[data-order-detail-retry]').getBoundingClientRect().height >= 44))
    await run(() => document.querySelector('[data-order-detail-retry]').focus())
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
    assert.ok(await page.eval(() => document.querySelector('[role="dialog"] button') === document.activeElement))
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
    const inspect = async state => {
      await page.eval(() => { window.inspectionBackground = document.querySelector('main'); window.inspectionBackground.remove() })
      const metrics = await page.eval(probe), findings = judge(metrics, { width }).filter(item => !APP_SKIP.has(item.id))
      await page.eval(() => { document.querySelector('#app').append(window.inspectionBackground); delete window.inspectionBackground })
      writeFileSync(resolve(output, `${locale}-${width}-${dark ? 'dark' : 'light'}-${state}.json`), JSON.stringify({ metrics, findings }, null, 2))
      assert.deepEqual(findings, [], `${locale}/${width}/${dark}/${state} visual findings`)
    }
    await inspect('error')
    await page.screenshot({ path: resolve(output, `${locale}-${width}-${dark ? 'dark' : 'light'}-error.png`), format: 'png' })
    await run(() => document.querySelector('[data-order-detail-retry]').click())
    await accept(await last('detail'), { order: { ...row(), remark: 'LongUnbrokenRemark'.repeat(25), instance: { id: 91, name: 'LongInstanceName'.repeat(15) } } })
    assert.equal(await page.eval(() => { const d = document.querySelector('[role="dialog"]'); return d.scrollWidth <= d.clientWidth }), true)
    await inspect('detail')
    await page.screenshot({ path: resolve(output, `${locale}-${width}-${dark ? 'dark' : 'light'}-detail.png`), format: 'png' })
    await run(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    assert.equal(await read('selectedOrder'), null)
  }
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  if (!process.argv.includes('--pagination-only')) console.log('PASS R205 18 locale/width/theme keyboard/taste scenarios')
} finally { if (browser) await browser.close(); await server.close() }
