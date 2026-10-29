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
const output = resolve(root, 'logs/host-redeem-writes'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js')
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/host-redeem/*.js']
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/host-redeem', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/host-redeem/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19699, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19699', { settleMs: 1400 })
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
  await run(() => { const v = window.redeemHarness.view(); v.openCreateModal(); v.createForm.codeValue = 5; void v.handleCreate() })
  const old = await last('create')
  await run(() => { window.redeemHarness.state.id = 2 })
  await accept(await last('list'), { codes: [code(2)], total: 1 }); await accept(await last('options'), options)
  const before = await count()
  await accept(old, { message: 'created', code: 'fixture-created', id: 3 })
  assert.equal(await count(), before, 'old create must not refresh another host')
  console.log('PASS redeem create target isolation')
  const reject = (index, error = { message: 'fixture redeem write failed' }) => run(({ index, error }) => window.redeemHarness.pending[index].reject(error), { index, error })
  let visit = 100
  const fresh = async () => {
    await run(id => { const h = window.redeemHarness; h.state.id = id; h.state.active = true; h.state.mounted = true; h.auth.user = { id: 1, username: 'fixture', role: 'admin' }; h.session('a'); h.view().enabledFilter = 'all' }, visit++)
    await accept(await last('list'), { codes: [code(1), code(2)], total: 2 }); await accept(await last('options'), options)
  }
  const start = async kind => {
    await run(kind => {
      const v = window.redeemHarness.view()
      if (kind === 'create') { v.openCreateModal(); v.createForm.codeValue = 7; void v.handleCreate() }
      if (kind === 'toggle') void v.toggleEnabled(v.codes[0])
      if (kind === 'delete') { v.toggleSelect(1); v.openDeleteModal(); void v.confirmDelete() }
    }, kind)
    return last(kind)
  }
  const success = kind => kind === 'create' ? { message: 'created', code: 'fixture-new', id: 30 } : kind === 'delete' ? { message: 'deleted', count: 1 } : { message: 'updated' }
  for (const kind of ['create', 'toggle', 'delete']) {
    await fresh(); const request = await start(kind), before = await count(kind)
    await run(kind => {
      const v = window.redeemHarness.view()
      if (kind === 'create') { void v.handleCreate(); v.closeCreateModal() }
      if (kind === 'toggle') void v.toggleEnabled(v.codes[0])
      if (kind === 'delete') { void v.confirmDelete(); v.closeDeleteModal() }
    }, kind)
    assert.equal(await count(kind), before, `${kind} rejects duplicate writes`)
    if (kind !== 'toggle') assert.equal(await read(kind === 'create' ? 'showCreateModal' : 'showDeleteModal'), true, 'cannot close in-flight dialog')
    await reject(request); assert.match(await read(kind === 'create' ? 'createError' : 'actionError'), /fixture redeem write failed/)
    await run(kind => { const v = window.redeemHarness.view(); if (kind === 'create') void v.handleCreate(); if (kind === 'toggle') void v.toggleEnabled(v.codes[0]); if (kind === 'delete') void v.confirmDelete() }, kind)
    await accept(await last(kind), success(kind)); await reject(await last('list'))
    assert.notEqual(await read('loadError'), ''); assert.equal(await read(kind === 'create' ? 'createError' : 'actionError'), '', 'list failure does not rewrite accepted write')
  }
  for (const kind of ['create', 'toggle', 'delete']) {
    for (const change of ['host', 'session', 'role', 'account', 'logout', 'cache', 'unmount', 'filter']) {
      await fresh(); const request = await start(kind), toasts = await page.eval(() => window.redeemHarness.toastEvents.length)
      await run(change => {
        const h = window.redeemHarness
        if (change === 'host') h.state.id++
        if (change === 'session') h.session('b')
        if (change === 'role') h.auth.user = { ...h.auth.user, role: 'user' }
        if (change === 'account') h.auth.user = { ...h.auth.user, id: 2 }
        if (change === 'logout') h.session(null)
        if (change === 'cache') h.state.active = false
        if (change === 'unmount') h.state.mounted = false
        if (change === 'filter') h.view().enabledFilter = 'false'
      }, change)
      const reads = await count('list')
      if (['host', 'role', 'cache', 'filter'].includes(change)) await accept(request, success(kind)); else await reject(request)
      assert.equal(await count('list'), reads, `${kind}/${change} old response cannot refresh`)
      assert.equal(await page.eval(() => window.redeemHarness.toastEvents.length), toasts, `${kind}/${change} old response cannot toast`)
    }
  }
  await fresh()
  await run(() => { const v = window.redeemHarness.view(); v.enabledFilter = 'all' }); await accept(await last('list'), { codes: [code(1), code(2)], total: 2 })
  await run(() => { const v = window.redeemHarness.view(); v.toggleSelect(1); v.openDeleteModal(); v.toggleSelect(2); void v.confirmDelete() })
  assert.deepEqual(await page.eval(() => window.redeemHarness.pending.findLast(item => item.kind === 'delete').params.ids), [1], 'delete target fixed when dialog opens')
  await accept(await last('delete'), { message: 'deleted', count: 1 }); await accept(await last('list'), { codes: [code(2)], total: 1 })
  assert.deepEqual(await page.eval(() => [...window.redeemHarness.view().selectedIds]), [2], 'delete preserves later selection')
  await fresh(); const toggle = await start('toggle')
  assert.equal(await page.eval(() => window.redeemHarness.pending.findLast(item => item.kind === 'toggle').params.enabled), false)
  await run(() => { void window.redeemHarness.view().loadCodes() }); const oldRead = await last('list')
  await accept(oldRead, { codes: [code(1), code(2)], total: 2 }); await accept(toggle, success('toggle'))
  assert.equal((await read('codes'))[0].enabled, false, 'toggle updates current object when same-host read replaced list')
  await reject(await last('list')); assert.equal(await read('actionError'), '')
  await fresh(); await run(() => { const v = window.redeemHarness.view(); v.openCreateModal(); v.createForm.batchCount = 2; void v.handleCreate() })
  await accept(await last('create'), { message: 'created', codes: ['fixture-batch-a', 'fixture-batch-b'], batchId: 'fixture-batch', count: 2 })
  assert.equal(await read('showBatchResultModal'), true); assert.deepEqual(await read('batchCreatedCodes'), ['fixture-batch-a', 'fixture-batch-b'])
  await reject(await last('list')); assert.equal(await read('showBatchResultModal'), true)
  await fresh(); await start('delete'); await reject(await last('delete'), { code: 'REDEEM_CODE_USED', message: 'fixture used code disabled' })
  assert.notEqual(await read('actionError'), ''); await accept(await last('list'), { codes: [{ ...code(1), enabled: false }, code(2)], total: 2 })
  assert.equal((await read('codes'))[0].enabled, false, 'used-code delete refreshes actual disabled state')
  for (const kind of ['create', 'toggle', 'delete']) {
    await fresh(); await start(kind); await accept(await last(kind), {})
    assert.notEqual(await read(kind === 'create' ? 'createError' : 'actionError'), '', 'malformed write receipt is not a success')
  }
  for (const [key, value] of [['batchCount', 0], ['batchCount', 101], ['batchCount', 1.5], ['batchCount', ''], ['maxUses', 0], ['maxUses', 1001], ['maxUses', 1.5], ['maxUses', ''], ['codeType', 'p'], ['codeValue', 0], ['codeValue', 101], ['codeValue', 1.5], ['codeValue', '10wrong'], ['remark', 'x'.repeat(201)], ['remark', 'x\u0001y'], ['expiresAt', 'invalid']]) {
    await fresh(); const before = await count('create')
    await run(({ key, value }) => { const v = window.redeemHarness.view(); v.openCreateModal(); v.createForm[key] = value; void v.handleCreate() }, { key, value })
    assert.equal(await count('create'), before, `invalid ${key} never submitted`); assert.notEqual(await read('createError'), '')
  }
  await fresh(); await start('create')
  assert.equal(await page.eval(() => [...document.querySelectorAll('[role="dialog"] input,[role="dialog"] select')].every(input => input.matches(':disabled'))), true)
  await run(() => document.querySelector('[role="dialog"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  assert.equal(await read('showCreateModal'), true, 'Escape cannot close pending write')
  const forcedOld = await last('create')
  await run(() => { window.redeemHarness.view().showCreateModal = false }); await run(() => { window.redeemHarness.view().showCreateModal = true })
  await accept(forcedOld, success('create')); assert.equal(await read('showCreateModal'), true, 'old dialog receipt cannot close forced reopened dialog')
  await fresh(); await start('toggle'); const oldToggle = await last('toggle')
  await run(() => { void window.redeemHarness.view().loadCodes() }); const beforeWriteList = await last('list')
  await accept(oldToggle, success('toggle')); await accept(beforeWriteList, { codes: [code(1), code(2)], total: 2 })
  assert.equal((await read('codes'))[0].enabled, false, 'earlier pending read cannot overwrite accepted toggle')
  await accept(await last('list'), { codes: [{ ...code(1), enabled: false }, code(2)], total: 2 })
  await fresh(); await start('create'); const sameSid = await last('create')
  await run(() => { window.redeemHarness.session('a', 2) }); await accept(sameSid, success('create')); assert.equal(await read('showCreateModal'), false)
  await accept(await last('list'), { codes: [code(1)], total: 1 })
  for (const [locale, width, dark, mobile] of [['zh-CN', 1440, false, false], ['en', 390, true, true]]) {
    await fresh(); await page.setViewport({ width, height: 1000, mobile }); await run(({ locale, dark }) => { window.redeemHarness.setLocale(locale); window.redeemHarness.theme.setTheme(dark ? 'dark' : 'light') }, { locale, dark })
    await run(() => [...document.querySelectorAll('main > div > div:first-child > button')].find(button => !button.disabled).click())
    assert.equal(await read('showCreateModal'), true)
    assert.equal(await page.eval(() => document.activeElement?.getAttribute('role')), 'dialog')
    await run(() => { const v = window.redeemHarness.view(); v.createForm.batchCount = 0; void v.handleCreate() })
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: resolve(output, `${locale}-${width}.png`), format: 'png' })
    await run(() => document.querySelector('[role="dialog"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    assert.equal(await read('showCreateModal'), false)
    if (mobile) {
      await run(() => document.querySelector('main label input[type="checkbox"]').click())
      assert.deepEqual(await page.eval(() => [...window.redeemHarness.view().selectedIds]), [1, 2], 'mobile select-all remains available')
      assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
    }
  }
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log('PASS redeem writes target, duplicate, dialog, session, retry, selection and partial result matrix')
} finally {
  console.log('Closing redeem write browser')
  if (browser) await browser.close()
  console.log('Closing redeem write fixture server')
  await server.close()
  console.log('Redeem write fixture closed')
}
