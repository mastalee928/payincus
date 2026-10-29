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
const output = resolve(root, 'logs/host-redeem-reads'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js')
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/host-redeem/*.js']
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/host-redeem', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/host-redeem/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19698, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19698', { settleMs: 1400 })
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await page.eval(() => !!window.redeemHarness?.pending.length)) break
    if (attempt === 199) throw Error('host redeem fixture did not mount: ' + page.consoleErrors.join('\n'))
    await sleep(150)
  }
  const run = async (fn, arg) => { const value = await page.eval(fn, arg); await sleep(90); return value }
  const last = kind => page.eval(kind => window.redeemHarness.pending.findLastIndex(item => item.kind === kind), kind)
  const accept = (index, data) => run(({ index, data }) => window.redeemHarness.pending[index].resolve(data), { index, data })
  const code = id => ({ id, code: `fixture-h-code-${id}`, codeType: 'c', codeValue: 10, maxUses: 1, usedCount: 0, expiresAt: null, enabled: true, remark: null, batchId: null, createdAt: '2026-10-29T00:00:00.000Z' })
  const first = await last('list')
  await run(() => { window.redeemHarness.state.id = 2 })
  await accept(await last('list'), { codes: [code(2)], total: 1 })
  await accept(first, { codes: [code(1)], total: 1 })
  assert.deepEqual(await page.eval(() => window.redeemHarness.view().codes.map(code => code.id)), [2], 'old host redeem codes cannot overwrite current host')
  console.log('PASS redeem list is bound to current host')
  const reject = index => run(index => window.redeemHarness.pending[index].reject(new Error('fixture redeem read failed')), index)
  const refresh = kind => run(kind => { const v = window.redeemHarness.view(); void v[kind === 'list' ? 'loadCodes' : kind === 'options' ? 'loadOptions' : 'loadUsages']() }, kind)
  const read = key => page.eval(key => JSON.parse(JSON.stringify(window.redeemHarness.view()[key])), key)
  const ids = () => page.eval(() => window.redeemHarness.view().codes.map(code => code.id))
  const requests = kind => page.eval(kind => window.redeemHarness.pending.filter(item => !kind || item.kind === kind).length, kind)
  const options = (minimum = 1) => ({ types: ['c', 'r', 'd', 't'].map(value => ({ value, label: { c: 'CPU', r: 'Memory', d: 'Disk', t: 'Traffic' }[value], unit: value === 'c' ? '%' : 'MB' })),
    ranges: Object.fromEntries(['c', 'r', 'd', 't'].map(type => [type, { min: type === 'c' ? minimum : 2, max: 100, unit: type === 'c' ? '%' : 'MB' }])) })
  const usage = id => ({ id, user: { id, username: `fixture-user-${id}` }, instance: { id, name: `fixture-instance-${id}` }, usedAt: '2026-10-29T02:00:00.000Z' })
  assert.equal(await requests('list'), 2, 'mounted and activated only read once')
  assert.equal(await requests('options'), 2)
  await accept(await last('options'), options())
  await refresh('list'); const oldList = await last('list'); await refresh('list'); const freshList = await last('list')
  await reject(oldList); assert.equal(await read('loading'), true)
  await accept(freshList, { codes: [code(3), code(4)], total: 21 })
  await run(() => { const v = window.redeemHarness.view(); v.toggleSelect(3); v.toggleSelect(999); v.goToNextPage() })
  assert.equal(await page.eval(() => window.redeemHarness.pending.findLast(item => item.kind === 'list').params.offset), 20)
  assert.deepEqual(await page.eval(() => [...window.redeemHarness.view().selectedIds]), [])
  const pageTwo = await last('list')
  await run(() => { window.redeemHarness.view().enabledFilter = 'false' }); const filtered = await last('list')
  await accept(pageTwo, { codes: [code(5)], total: 21 }); assert.equal(await read('loading'), true)
  await accept(filtered, { codes: [{ ...code(6), enabled: false }], total: 1 })
  assert.deepEqual(await ids(), [6]); assert.equal(await read('page'), 1)
  await run(() => { window.redeemHarness.view().enabledFilter = 'all' }); await accept(await last('list'), { codes: [code(7), code(8)], total: 21 })
  await run(() => { window.redeemHarness.view().goToNextPage() }); await accept(await last('list'), { codes: [], total: 1 })
  assert.equal(await read('page'), 1, 'removed last page returns to current final page'); assert.equal(await read('loading'), true)
  await accept(await last('list'), { codes: [code(8)], total: 1 })
  await run(() => { window.redeemHarness.view().toggleSelect(8) }); await refresh('list'); await accept(await last('list'), { codes: [code(8), code(9)], total: 2 })
  assert.deepEqual(await page.eval(() => [...window.redeemHarness.view().selectedIds]), [8], 'refresh retains valid selection')
  await refresh('list'); await accept(await last('list'), { codes: [code(9)], total: 1 }); assert.deepEqual(await page.eval(() => [...window.redeemHarness.view().selectedIds]), [])
  await refresh('list'); await reject(await last('list')); assert.deepEqual(await ids(), []); assert.match(await read('loadError'), /fixture redeem read failed/)
  await run(() => document.querySelector('[data-list-error] button').click()); await accept(await last('list'), { codes: [code(10), code(11)], total: 2 }); assert.equal(await read('loadError'), '')
  for (const malformed of [{}, { codes: null, total: 1 }, { codes: [code(1), code(1)], total: 2 }, { codes: [{ ...code(1), enabled: 'yes' }], total: 1 }, { codes: [{ ...code(1), codeValue: 0 }], total: 1 }, { codes: [{ ...code(1), createdAt: 'invalid' }], total: 1 }, { codes: [code(1)], total: -1 }]) {
    await refresh('list'); await accept(await last('list'), malformed); assert.notEqual(await read('loadError'), ''); assert.deepEqual(await ids(), [])
  }
  await refresh('list'); await accept(await last('list'), { codes: [code(10), code(11)], total: 2 })
  await refresh('list'); await accept(await last('list'), { codes: [{ ...code(12), codeType: 'p' }], total: 1 })
  assert.deepEqual(await ids(), [12], 'retired points codes remain readable without re-enabling their creation')
  await refresh('list'); await accept(await last('list'), { codes: [code(10), code(11)], total: 2 })
  console.log('PASS list ordering, filters, pagination, response validation, selection and retry')
  await refresh('options'); const oldOptions = await last('options'); await refresh('options'); const newOptions = await last('options')
  await accept(newOptions, options(3)); await accept(oldOptions, options(7)); assert.equal((await read('codeOptions')).ranges.c.min, 3)
  await run(() => { const v = window.redeemHarness.view(); v.openCreateModal(); v.createForm.codeType = 'r'; v.createForm.codeValue = 37; void v.loadOptions() })
  await accept(await last('options'), options(4)); assert.equal((await read('createForm')).codeValue, 37, 'options cannot erase a new draft')
  await run(() => { const v = window.redeemHarness.view(); v.showCreateModal = false; v.openCreateModal() }); assert.equal((await read('createForm')).codeValue, 4, 'opening CPU uses CPU range')
  await run(() => { window.redeemHarness.view().showCreateModal = false }); await refresh('options'); await reject(await last('options'))
  await run(() => { window.redeemHarness.view().openCreateModal() }); assert.equal(await read('showCreateModal'), false, 'failed options cannot open creation')
  assert.match(await read('optionsError'), /fixture redeem read failed/)
  await run(() => document.querySelector('[data-options-error] button').click()); await accept(await last('options'), options()); assert.equal(await read('optionsReady'), true)
  for (const malformed of [{}, { ...options(), types: [] }, { ...options(), ranges: {} }, { ...options(), ranges: { ...options().ranges, c: { min: 2, max: 1, unit: '%' } } }]) {
    await refresh('options'); await accept(await last('options'), malformed); assert.notEqual(await read('optionsError'), ''); assert.equal(await read('optionsReady'), false)
  }
  await refresh('options'); await accept(await last('options'), options())
  console.log('PASS current options, malformed responses, retry and draft preservation')
  await run(() => { const v = window.redeemHarness.view(); v.openUsages(v.codes[0]) }); const oldUsages = await last('usages')
  await run(() => { const v = window.redeemHarness.view(); v.openUsages(v.codes[1]) }); const newUsages = await last('usages')
  await accept(oldUsages, { usages: [usage(10)], total: 1 }); assert.equal(await read('usagesLoading'), true)
  await accept(newUsages, { usages: [usage(11)], total: 21 }); assert.equal((await read('usages'))[0].id, 11)
  await run(() => { window.redeemHarness.view().changeUsagesPage(1) }); assert.equal(await page.eval(() => window.redeemHarness.pending.findLast(item => item.kind === 'usages').params.offset), 20)
  await accept(await last('usages'), { usages: [usage(12)], total: 21 }); assert.equal(await read('usagesPage'), 2)
  await refresh('usages'); await accept(await last('usages'), { usages: [], total: 1 }); assert.equal(await read('usagesPage'), 1)
  await accept(await last('usages'), { usages: [usage(11)], total: 1 })
  await refresh('usages'); const closedUsages = await last('usages'); await run(() => { const v = window.redeemHarness.view(); v.showUsagesModal = false; v.openUsages(v.codes[1]) })
  await reject(closedUsages); assert.equal(await read('usagesLoading'), true); assert.equal(await read('usagesError'), '')
  await reject(await last('usages')); assert.match(await read('usagesError'), /fixture redeem read failed/)
  await run(() => document.querySelector('[data-usages-error] button').click()); await accept(await last('usages'), { usages: [usage(11)], total: 1 })
  for (const malformed of [{}, { usages: [usage(1), usage(1)], total: 2 }, { usages: [{ ...usage(1), user: null }], total: 1 }, { usages: [{ ...usage(1), usedAt: 'invalid' }], total: 1 }]) {
    await refresh('usages'); await accept(await last('usages'), malformed); assert.notEqual(await read('usagesError'), ''); assert.deepEqual(await read('usages'), [])
  }
  await run(() => { window.redeemHarness.view().showUsagesModal = false })
  console.log('PASS usage target, dialog generation, pagination, error retry and validation')
  for (const kind of ['hostABA', 'session', 'role', 'account', 'logout', 'cache', 'unmount']) {
    await refresh('list'); await accept(await last('list'), { codes: [code(20)], total: 1 })
    await run(() => { const v = window.redeemHarness.view(); v.openUsages(v.codes[0]); v.showCreateModal = true; v.showDeleteModal = true; v.showBatchResultModal = true; v.batchCreatedCodes = ['fixture-old']; void v.loadCodes(); void v.loadOptions() })
    const stale = { list: await last('list'), options: await last('options'), usages: await last('usages') }
    const toastCount = await page.eval(() => window.redeemHarness.toastEvents.length)
    await run(kind => { const h = window.redeemHarness
      if (kind === 'hostABA') h.state.id = 3
      if (kind === 'session') h.session('b')
      if (kind === 'role') h.auth.user = { ...h.auth.user, role: 'user' }
      if (kind === 'account') h.auth.user = { ...h.auth.user, id: 2 }
      if (kind === 'logout') h.session(null)
      if (kind === 'cache') h.state.active = false
      if (kind === 'unmount') h.state.mounted = false
    }, kind)
    if (kind === 'hostABA') await run(() => { window.redeemHarness.state.id = 2 })
    assert.deepEqual(await ids(), [], `${kind} clears codes`); assert.deepEqual(await read('batchCreatedCodes'), []); assert.deepEqual(await read('usages'), [])
    for (const modal of ['showCreateModal', 'showDeleteModal', 'showBatchResultModal', 'showUsagesModal']) assert.equal(await read(modal), false, `${kind} closes ${modal}`)
    await accept(stale.list, { codes: [code(99)], total: 1 }); await accept(stale.options, options(99)); await reject(stale.usages)
    assert.deepEqual(await ids(), []); assert.equal(await read('optionsReady'), false); assert.equal(await page.eval(() => window.redeemHarness.toastEvents.length), toastCount)
    await run(() => { const h = window.redeemHarness; h.auth.user = { id: 1, username: 'fixture', role: 'admin' }; h.session('a'); h.state.active = true; h.state.mounted = true })
    await accept(await last('list'), { codes: [code(20)], total: 1 }); await accept(await last('options'), options())
  }
  const beforeToken = await requests(); await run(() => window.redeemHarness.session('a', 2)); assert.equal(await requests(), beforeToken, 'same sid token refresh does not reset reads')
  for (const id of [0, -1, 1.5, 9007199254740992]) {
    const count = await requests(); await run(id => { window.redeemHarness.state.id = id }, id); await refresh('list'); await refresh('options'); await refresh('usages'); assert.equal(await requests(), count, 'invalid IDs never reach API')
  }
  await run(() => { window.redeemHarness.state.id = 4 }); await accept(await last('list'), { codes: [code(20), { ...code(21), remark: 'Fixture persistent usage record' }], total: 21 }); await accept(await last('options'), options())
  console.log('PASS host ABA, account, role, session, logout, cache, unmount and invalid IDs')
  for (const [locale, width, dark, mobile] of [['zh-CN', 1440, false, false], ['en', 390, true, true]]) {
    await page.setViewport({ width, height: 1000, mobile }); await run(({ locale, dark }) => { window.redeemHarness.setLocale(locale); window.redeemHarness.theme.setTheme(dark ? 'dark' : 'light') }, { locale, dark })
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
    assert.equal(await page.eval(() => [...document.querySelectorAll('.redeem-table td button')].every(button => { const rect = button.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth })), true, 'all row controls remain visible')
    assert.equal(await page.eval(() => document.body.innerText.includes('1/2')), true, 'pagination shows actual current and total pages')
    await page.screenshot({ path: resolve(output, `${locale}-${width}.png`), format: 'png' })
    await run(() => { const v = window.redeemHarness.view(); v.openUsages(v.codes[0]) }); await accept(await last('usages'), { usages: [usage(20)], total: 21 })
    assert.equal(await page.eval(() => document.activeElement?.getAttribute('role')), 'dialog')
    await run(() => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true })))
    assert.equal(await page.eval(() => document.activeElement?.textContent.trim()), locale === 'en' ? 'Next' : '下一步')
    await page.screenshot({ path: resolve(output, `${locale}-${width}-usages.png`), format: 'png' }); await run(() => { window.redeemHarness.view().showUsagesModal = false })
  }
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log('PASS redeem reads complete browser matrix and both viewports')
} finally { if (browser) await browser.close(); await server.close() }
