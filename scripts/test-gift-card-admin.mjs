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
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/gift-card-admin/*.js']
const output = resolve(root, 'logs/gift-card-admin'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const server = await createServer({ configFile: false, cacheDir: output + '/vite-cache', root: root + '/scripts/fixtures/gift-card-admin', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api(?:\/admin)?$/, replacement: root + '/scripts/fixtures/gift-card-admin/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19765, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  const run = async (fn, arg) => { const value = await page.eval(fn, arg); await sleep(60); return value }
  const last = kind => page.eval(kind => window.giftReview?.pending.findLastIndex(r => r.kind === kind) ?? -1, kind)
  const accept = (i, value) => run(({ i, value }) => giftReview.pending[i].resolve(value), { i, value })
  const row = { id: 11, code: 'REVIEW-GIFT', status: 'active', faceValue: 10, balanceValue: 10 }
  const fresh = async () => {
    await page.goto('http://127.0.0.1:19765', { settleMs: 500 }); const deadline = Date.now() + 15000
    while (await last('list') < 0) { if (Date.now() > deadline) throw Error('No package request'); await sleep(100) }
    await page.eval(() => { giftReview.view() })
  }
  const list = async (total = 101, rows = [row]) => {
    const i = await last('list'), pageNumber = await page.eval(i => giftReview.pending[i].params.page, i)
    await accept(i, { records: rows, total, page: pageNumber, pageSize: 100 })
    await accept(await last('stats'), { active: total, used: 0, outstandingValue: total * 10, totalRedeemedValue: 0 })
  }
  await fresh(); await list()
  assert.ok(await page.eval(() => document.querySelector('[data-gift-next]')), 'more than 100 cards need reachable pagination')
  await run(() => document.querySelector('[data-gift-next]').click())
  assert.equal(await page.eval(i => giftReview.pending[i].params.page, await last('list')), 2)
  await list(100, [])
  assert.equal(await page.eval(i => giftReview.pending[i].params.page, await last('list')), 1, 'shrunken last page reloads a valid page')
  await list(100)
  assert.equal(await page.eval(() => giftReview.view().records[0].id), row.id)
  for (const change of ['account', 'cache', 'filter', 'route']) for (const fail of [false, true]) {
    await fresh(); const old = await last('list'), oldStats = await last('stats')
    await run(change => { const h = giftReview; if (change === 'account') h.session(2)
      if (change === 'cache') h.active.value = false
      if (change === 'filter') h.view().statusFilter = 'used'
      if (change === 'route') void h.router.push('/other')
    }, change)
    const snapshot = () => page.eval(() => JSON.stringify({ rows: giftReview.view().records, stats: giftReview.view().stats, loading: giftReview.view().loading, error: giftReview.view().loadError, toasts: giftReview.toast.toasts.value }))
    const before = await snapshot()
    if (fail) await run(i => giftReview.pending[i].reject(Error('Old read')), old)
    else await accept(old, { records: [row], total: 101, page: 1, pageSize: 100 })
    await accept(oldStats, { active: 101 })
    assert.equal(await snapshot(), before, change + ': obsolete read must not change current UI')
  }
  for (const fail of [false, true]) {
    await fresh(); await list()
    await run(() => { void giftReview.view().createCards(); void giftReview.view().createCards() })
    assert.equal(await page.eval(() => giftReview.pending.filter(r => r.kind === 'generate').length), 1)
    const i = await last('generate'); await run(() => giftReview.session(2))
    const before = await page.eval(() => JSON.stringify(giftReview.toast.toasts.value))
    if (fail) await run(i => giftReview.pending[i].reject(Error('Old create')), i)
    else await accept(i, { giftCard: row })
    assert.equal(await page.eval(() => giftReview.view().batchResult), null)
    assert.equal(await page.eval(() => JSON.stringify(giftReview.toast.toasts.value)), before)
  }
  await fresh(); await list(101)
  await run(() => document.querySelector('[data-gift-next]').click()); await list(101)
  await run(() => { const v = giftReview.view(); void v.deleteCard(v.records[0]); void v.deleteCard(v.records[0]) })
  assert.equal(await page.eval(() => giftReview.pending.filter(r => r.kind === 'delete').length), 1)
  await accept(await last('delete'), {}); await list(100, []); await list(100)
  assert.equal(await page.eval(() => giftReview.view().pageNumber), 1)
  await run(() => { void giftReview.view().loadData() })
  await run(i => giftReview.pending[i].reject(Error('Current read failed')), await last('list'))
  assert.ok(await page.eval(() => document.querySelector('[data-gift-retry]')))
  await run(() => document.querySelector('[data-gift-retry]').click()); await list(100)
  assert.equal(await page.eval(() => giftReview.view().loadError), '')
  await run(() => { giftReview.active.value = false }); await run(() => { giftReview.active.value = true })
  assert.equal(await page.eval(() => giftReview.view().records.length), 0); await list(101)
  await run(() => { void giftReview.view().createCards() })
  const oldCreate = await last('generate')
  await run(() => document.querySelector('[data-gift-next]').click()); await list(101)
  await run(() => document.querySelector('[data-gift-prev]').click()); await list(101)
  await accept(oldCreate, { giftCard: row })
  assert.equal(await page.eval(() => giftReview.view().batchResult), null, 'returning to the same page must not revive old writes')
  for (const width of [390, 1440]) {
    await page.setViewport({ width, height: 900 })
    await page.screenshot({ path: resolve(output, `pagination-${width}.png`), format: 'png', fullPage: true })
    assert.ok(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), 'no page overflow')
    assert.ok(await page.eval(() => document.querySelector('[data-gift-next]').getBoundingClientRect().height >= 44), 'pagination touch target')
  }
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log('PASS gift cards: pagination/shrink, stale reads and creates, duplicate writes, deletion, errors and cache')
} finally { if (browser) await browser.close(); await server.close() }
