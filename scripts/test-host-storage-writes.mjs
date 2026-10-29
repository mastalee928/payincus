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
const output = resolve(root, 'logs/host-storage-writes'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js')
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/host-storage/*.js']
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/host-storage', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/host-storage/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19697, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19697', { settleMs: 1400 })
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await page.eval(() => !!window.storageHarness?.pending.length)) break
    if (attempt === 199) throw Error('host storage fixture did not mount: ' + page.consoleErrors.join('\n'))
    await sleep(150)
  }
  const run = async (fn, arg) => { const value = await page.eval(fn, arg); await sleep(90); return value }
  const last = kind => page.eval(kind => window.storageHarness.pending.findLastIndex(item => item.kind === kind), kind)
  const accept = (index, data) => run(({ index, data }) => window.storageHarness.pending[index].resolve(data), { index, data })
  const pool = name => ({ name, driver: 'lvm', description: 'Fixture storage pool', status: 'Created', config: {}, usedBy: 0, purpose: 'instance_data', space: { used: 2 ** 30, total: 10 * 2 ** 30 } })
  await accept(await last('list'), { pools: [pool('fixture-pool')] })
  await run(() => {
    const v = window.storageHarness.view(); v.openCreateModal(); v.form.name = 'fixture-new'; v.form.source = '/fixture-disk'; void v.createPool()
  })
  const oldCreate = await last('create')
  await run(() => { window.storageHarness.state.id = 2 })
  await accept(await last('list'), { pools: [pool('current-pool')] })
  await run(() => { const v = window.storageHarness.view(); v.openCreateModal(); v.form.name = 'later-draft' })
  const before = await page.eval(() => window.storageHarness.pending.length)
  await accept(oldCreate, { message: 'created', name: 'fixture-new', driver: 'lvm' })
  assert.equal(await page.eval(() => window.storageHarness.pending.length), before, 'old create cannot refresh a different host')
  assert.equal(await page.eval(() => window.storageHarness.view().showCreateModal), false, 'cannot open another creation while a previous write remains pending')
  await run(() => { window.storageHarness.view().openCreateModal() })
  assert.equal(await page.eval(() => window.storageHarness.view().showCreateModal), true, 'new draft can open after old write settles')
  console.log('PASS storage write stays with original host')
  const reject = index => run(index => window.storageHarness.pending[index].reject(new Error('fixture storage write failed')), index)
  const read = key => page.eval(key => window.storageHarness.view()[key], key)
  const count = kind => page.eval(kind => window.storageHarness.pending.filter(item => item.kind === kind).length, kind)
  let visit = 100
  const fresh = async id => {
    await run(id => { const h = window.storageHarness; h.state.id = id; h.state.active = true; h.state.mounted = true; h.auth.user = { id: 1, username: 'fixture', role: 'admin' }; h.session('a') }, id + visit++)
    await accept(await last('list'), { pools: [pool('fixture-pool')] })
  }
  const start = async kind => {
    await run(kind => {
      const v = window.storageHarness.view()
      if (kind === 'create') { v.openCreateModal(); v.form.name = 'fixture-created'; v.form.source = '/fixture-disk'; void v.createPool() }
      if (kind === 'edit') { v.openEditModal(v.pools[0]); v.editForm.description = 'new description'; void v.submitEdit() }
      if (kind === 'delete') { window.confirm = () => true; void v.deletePool('fixture-pool') }
    }, kind)
    return last(kind)
  }
  const editPayload = () => page.eval(() => window.storageHarness.pending.findLast(item => item.kind === 'edit').data)
  await fresh(60)
  await run(() => { const v = window.storageHarness.view(); v.openEditModal(v.pools[0]) })
  await run(() => {
    document.querySelectorAll('[role="dialog"]').item(document.querySelectorAll('[role="dialog"]').length - 1).querySelector('input[value="instance_storage"]').click()
  })
  await run(() => { [...document.querySelectorAll('[role="dialog"]')].at(-1).querySelector('.modal-footer .btn-primary').click() })
  assert.deepEqual(await editPayload(), { purpose: 'instance_storage' }, 'purpose-only save reaches the local transaction without unchanged remote fields')
  await accept(await last('edit'), { message: 'saved' })
  await accept(await last('list'), { pools: [{ ...pool('fixture-pool'), purpose: 'instance_storage' }] })
  assert.equal(await read('showEditModal'), false)
  await run(() => {
    const v = window.storageHarness.view(); v.openEditModal(v.pools[0]); v.editForm.purpose = 'instance_data'; void v.submitEdit()
  })
  assert.deepEqual(await editPayload(), { purpose: 'instance_data' }, 'reopened editor captures the newly saved baseline')
  await reject(await last('edit'))
  await run(() => { void window.storageHarness.view().submitEdit() })
  assert.deepEqual(await editPayload(), { purpose: 'instance_data' }, 'failed writes retain the original change for retry')
  await reject(await last('edit'))
  const noOp = async change => {
    const pending = await page.eval(() => window.storageHarness.pending.length)
    const toasts = await page.eval(() => window.storageHarness.toastEvents.length)
    await run(change => { const v = window.storageHarness.view(); Object.assign(v.editForm, change); void v.submitEdit() }, change)
    assert.equal(await page.eval(() => window.storageHarness.pending.length), pending, 'unchanged form neither writes nor refreshes')
    assert.equal(await page.eval(() => window.storageHarness.toastEvents.length), toasts, 'no write means no saved notification')
    assert.equal(await read('showEditModal'), false, 'saving an unchanged form closes the settled editor')
  }
  await noOp({ purpose: 'instance_storage' })
  for (const [initial, change, expected] of [
    [{}, { description: '' }, { description: '' }],
    [{}, { description: 'new description' }, { description: 'new description' }],
    [{}, { newSizeValue: '20' }, { size: '20GiB' }],
    [{}, { newSizeValue: '2.5', newSizeUnit: 'TiB' }, { size: '2748779069440B' }],
    [{}, { description: '', purpose: 'instance_storage', newSizeValue: '20' }, { description: '', purpose: 'instance_storage', size: '20GiB' }],
    [{ purpose: null }, { description: 'new description' }, { description: 'new description' }],
    [{ purpose: null }, { purpose: 'instance_storage' }, { purpose: 'instance_storage' }],
  ]) {
    await fresh(61)
    await run(({ initial, change }) => {
      const v = window.storageHarness.view(); Object.assign(v.pools[0], initial); v.openEditModal(v.pools[0]); Object.assign(v.editForm, change); void v.submitEdit()
    }, { initial, change })
    assert.deepEqual(await editPayload(), expected, 'send exactly the edited fields, including explicit empty description')
    await reject(await last('edit'))
    assert.equal(await read('showEditModal'), true, 'failed save retains the draft')
  }
  for (const initial of [{}, { purpose: null }, { description: null }]) {
    await fresh(62)
    await run(initial => { const v = window.storageHarness.view(); Object.assign(v.pools[0], initial); v.openEditModal(v.pools[0]) }, initial)
    await noOp({})
  }
  // An asynchronous list refresh must not change what the user actually edited.
  for (const change of [{ purpose: 'instance_storage' }, { description: 'new description' }, {}]) {
    await fresh(63)
    await run(change => {
      const v = window.storageHarness.view(); v.openEditModal(v.pools[0]); Object.assign(v.editForm, change); void v.loadPools()
    }, change)
    await accept(await last('list'), { pools: [{ ...pool('fixture-pool'), description: 'new description', purpose: 'instance_storage' }] })
    if (!Object.keys(change).length) { await noOp({}); continue }
    await run(() => { void window.storageHarness.view().submitEdit() })
    assert.deepEqual(await editPayload(), change, 'compare against the opened snapshot, never a refreshed list')
    await reject(await last('edit'))
  }
  console.log('PASS storage edit changed-fields, local-purpose, explicit-clear, resize, no-op, retry and refreshed-baseline matrix')
  for (const kind of ['create', 'edit', 'delete']) {
    await fresh(10 + ['create', 'edit', 'delete'].indexOf(kind))
    const request = await start(kind), before = await count(kind)
    await run(kind => {
      const v = window.storageHarness.view()
      if (kind === 'create') { void v.createPool(); v.closeCreateModal() }
      if (kind === 'edit') { void v.submitEdit(); v.closeEditModal() }
      if (kind === 'delete') void v.deletePool('fixture-pool')
    }, kind)
    assert.equal(await count(kind), before, 'functions reject duplicate writes')
    if (kind !== 'delete') assert.equal(await read(kind === 'create' ? 'showCreateModal' : 'showEditModal'), true, 'in-flight dialog cannot close')
    await reject(request)
    assert.match(await read(kind === 'create' ? 'createError' : kind === 'edit' ? 'editError' : 'deleteError'), /fixture storage write failed/)
    await start(kind); await accept(await last(kind), { message: 'saved', name: 'fixture-created', driver: 'lvm' })
    await reject(await last('list'))
    assert.notEqual(await read('loadError'), '', 'refresh error is separate from accepted write')
    assert.equal(await read(kind === 'create' ? 'createError' : kind === 'edit' ? 'editError' : 'deleteError'), '')
  }
  for (const kind of ['create', 'edit', 'delete']) {
    for (const change of ['host', 'session', 'account', 'role', 'logout', 'cache', 'unmount']) {
      await fresh(20 + ['create', 'edit', 'delete'].indexOf(kind))
      const old = await start(kind), before = await page.eval(() => window.storageHarness.toastEvents.length)
      await run(change => {
        const h = window.storageHarness
        if (change === 'host') h.state.id++
        if (change === 'session') h.session('b')
        if (change === 'account') h.auth.user = { ...h.auth.user, id: 2 }
        if (change === 'role') h.auth.user = { ...h.auth.user, role: 'user' }
        if (change === 'logout') h.session(null)
        if (change === 'cache') h.state.active = false
        if (change === 'unmount') h.state.mounted = false
      }, change)
      const pending = await page.eval(() => window.storageHarness.pending.length)
      if (['host', 'role', 'cache'].includes(change)) await accept(old, { message: 'saved' }); else await reject(old)
      assert.equal(await page.eval(() => window.storageHarness.toastEvents.length), before, `${kind}/${change} old receipt is quiet`)
      assert.equal(await page.eval(() => window.storageHarness.pending.length), pending, `${kind}/${change} old receipt cannot refresh`)
    }
  }
  await fresh(50)
  await run(() => { const v = window.storageHarness.view(); v.openCreateModal(); v.createMode = 'import' })
  await run(() => { const v = window.storageHarness.view(); v.form.name = 'import-fixture'; v.importDriver = 'dir'; v.importSource = '/fixture-existing'; void v.createPool() })
  assert.deepEqual(await page.eval(index => window.storageHarness.pending[index].data, await last('create')), {
    name: 'import-fixture', driver: 'dir', existingSource: '/fixture-existing', purpose: 'instance_data', useExisting: true,
  })
  await accept(await last('create'), { message: 'imported', name: 'import-fixture', driver: 'dir', imported: true })
  await accept(await last('list'), { pools: [pool('fixture-pool')] })
  await run(() => { window.storageHarness.view().pools[0].usedBy = 1 })
  let beforeDelete = await count('delete'); await start('delete'); assert.equal(await count('delete'), beforeDelete, 'used pool cannot be deleted by direct call')
  await run(() => { window.storageHarness.view().pools[0].usedBy = 0; window.storageHarness.view().pools[0].status = 'Unavailable' })
  await start('delete'); assert.equal(await count('delete'), beforeDelete, 'fallback data does not prove a pool unused')
  await fresh(51); await start('edit'); await run(() => { window.storageHarness.session('a', 2) })
  await accept(await last('edit'), { message: 'updated' }); await accept(await last('list'), { pools: [pool('fixture-pool')] })
  assert.equal(await read('showEditModal'), false, 'token refresh within the same session retains valid write')
  await fresh(52)
  await run(() => { window.storageHarness.view().openEditModal(window.storageHarness.view().pools[0]) })
  await run(() => { const h = window.storageHarness; h.view().editForm.name = 'another-pool'; void h.view().submitEdit() })
  assert.notEqual(await page.eval(() => window.storageHarness.pending.at(-1).kind), 'edit', 'edit identity cannot be changed through draft')
  await run(() => { const h = window.storageHarness; h.view().editForm.name = 'fixture-pool'; h.view().editForm.description = 'retry text'; void h.view().submitEdit() })
  await reject(await last('edit'))
  for (const [locale, width, dark, mobile] of [['zh-CN', 1440, false, false], ['zh-CN', 768, false, false], ['en', 390, true, true]]) {
    await page.setViewport({ width, height: 1000, mobile })
    await run(({ locale, dark }) => { window.storageHarness.setLocale(locale); window.storageHarness.theme.setTheme(dark ? 'dark' : 'light') }, { locale, dark })
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: resolve(output, `${locale}-${width}.png`), format: 'png' })
  }
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' }); await sleep(100)
  assert.equal(await read('showEditModal'), false, 'Escape closes current settled dialog')
  await fresh(53)
  const currentSave = await start('create')
  const counts = await page.eval(() => window.storageHarness.pending.length)
  await run(() => {
    const v = window.storageHarness.view(); v.openEditModal(v.pools[0]); void v.submitEdit(); void v.deletePool('fixture-pool')
    v.openCreateModal()
  })
  assert.equal(await page.eval(() => window.storageHarness.pending.length), counts, 'all storage writes share the busy gate')
  await run(() => { void window.storageHarness.view().loadPools() }); const oldRead = await last('list')
  await accept(oldRead, { pools: [pool('fixture-pool')] })
  await accept(currentSave, { message: 'created', name: 'fixture-created' })
  await accept(await last('list'), { pools: [pool('fixture-created')] })
  assert.equal(await read('showCreateModal'), false, 'a same-host read does not invalidate a valid write')
  await fresh(54); await start('create'); await accept(await last('create'), {})
  assert.notEqual(await read('createError'), '', 'invalid acknowledgement cannot close the current form')
  assert.equal(await read('showCreateModal'), true)
  await run(() => {
    const v = window.storageHarness.view(); v.form.name = 'invalid/name'; void v.createPool()
  })
  assert.notEqual(await read('createError'), '')
  await run(() => { window.storageHarness.view().closeCreateModal() })
  await start('edit')
  await run(() => { window.storageHarness.view().showEditModal = false; window.storageHarness.view().showEditModal = true })
  const beforeOldDialog = await page.eval(() => window.storageHarness.toastEvents.length)
  await accept(await last('edit'), { message: 'saved' })
  assert.equal(await read('showEditModal'), true, 'forced close/reopen cannot reuse an old dialog receipt')
  assert.equal(await page.eval(() => window.storageHarness.toastEvents.length), beforeOldDialog)
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log('PASS storage writes complete target, duplicate, import, deletion, retry and lifecycle matrix')
} finally { if (browser) await browser.close(); await server.close() }
