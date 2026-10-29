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
const output = resolve(root, 'logs/snapshot-session'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js')
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/snapshot-policy/*.js']
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/snapshot-policy', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/snapshot-policy/api.js' }, { find: '@', replacement: root + '/client/src' }, ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } }, server: { host: '127.0.0.1', port: 19728, strictPort: true, fs: { allow: [root] } },
})
let browser, reads = 0, writes = 0
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(35); return result }
  const fresh = async () => {
    await page.goto('http://127.0.0.1:19728', { settleMs: 250 })
    const deadline = Date.now() + 15000
    while (!await page.eval(() => !!window.snapshotHarness?.view())) { if (Date.now() > deadline) throw Error('Snapshot fixture did not mount: ' + page.consoleErrors.join('\n')); await sleep(70) }
  }
  const settleReads = () => run(() => {
    const h = window.snapshotHarness
    for (const x of h.pending) if (!x.done && ['snapshots', 'policy'].includes(x.kind)) {
      x.done = true; x.resolve(x.kind === 'snapshots' ? [] : { enabled: false, interval_minutes: 360, operation: null })
    }
  })
  const change = mode => run(async mode => {
    const h = window.snapshotHarness
    if (mode === 'sid') h.setSession(1, 'new-session')
    if (mode === 'account') h.setSession(2)
    if (mode === 'role') h.setSession(1, 'snapshot-session', 'admin')
    if (mode === 'logout') h.auth.clearLocalAuth()
    if (mode === 'target') h.instanceId.value = 2
    if (mode === 'target-aba') { h.instanceId.value = 2; await Promise.resolve(); h.instanceId.value = 1 }
    if (mode === 'session-aba') { h.setSession(2); await Promise.resolve(); h.setSession(1) }
    if (mode === 'cache') h.active.value = false
    if (mode === 'unmount') h.mounted.value = false
  }, mode)
  const state = () => page.eval(() => {
    const h = window.snapshotHarness, v = h.view()
    return { snapshots: JSON.stringify(v.snapshots), policy: JSON.stringify(v.policy), error: v.pageError,
      create: JSON.stringify(v.createForm), form: JSON.stringify(v.policyForm), showCreate: v.showCreateModal, showPolicy: v.showPolicyModal,
      loading: v.loading, toastCount: h.toast.toasts.value.length }
  })
  for (const kind of ['snapshots', 'policy']) for (const mode of ['sid', 'account', 'role', 'logout', 'target', 'target-aba', 'session-aba', 'cache', 'unmount']) for (const reject of [false, true]) {
    await fresh()
    await run(kind => {
      const h = window.snapshotHarness; h.held = h.pending.findLast(x => x.kind === kind)
      h.pending.forEach(x => { if (x !== h.held) { x.done = true; x.resolve(x.kind === 'snapshots' ? [] : { enabled: false, interval_minutes: 360, operation: null }) } })
      h.view().createForm = { name: 'private draft', description: 'private description' }; h.view().showCreateModal = true; h.view().showPolicyModal = true
    }, kind)
    await change(mode)
    const cleared = await state()
    assert.equal(cleared.create, JSON.stringify({ name: '', description: '' }), `${kind}/${mode}: invalidate private draft`)
    assert.equal(cleared.showCreate || cleared.showPolicy, false, `${kind}/${mode}: close private dialogs`)
    const before = await state()
    await run(({ kind, reject }) => {
      const x = window.snapshotHarness.held
      if (reject) x.reject(Error('stale read error'))
      else x.resolve(kind === 'snapshots' ? [{ id: 91, name: 'stale private snapshot', created_at: '2026-10-29T00:00:00Z' }] : { enabled: true, interval_minutes: 1440, operation: { id: 91, error: 'stale private recovery' } })
    }, { kind, reject })
    assert.deepEqual(await state(), before, `${kind}/${mode}/${reject}: old read cannot alter current data, draft, loading or errors`); reads++
    if (mode === 'cache') {
      const n = await page.eval(() => window.snapshotHarness.pending.length)
      await run(() => window.snapshotHarness.active.value = true)
      assert.equal(await page.eval(() => window.snapshotHarness.pending.length), n + 2, 'cache return reloads both resources once')
    }
    await settleReads()
  }
  for (const kind of ['create', 'delete', 'restore', 'update', 'retry']) for (const mode of ['sid', 'account', 'role', 'logout', 'target', 'target-aba', 'session-aba', 'cache', 'unmount']) for (const reject of [false, true]) {
    await fresh(); await settleReads()
    await run(kind => {
      const h = window.snapshotHarness, v = h.view(); window.confirm = () => true
      if (kind === 'create') { v.createForm = { name: 'submitted snapshot', description: 'submitted description' }; v.showCreateModal = true; void v.createSnapshot() }
      if (kind === 'delete' || kind === 'restore') void v[kind + 'Snapshot']({ id: 11, name: 'source snapshot' })
      if (kind === 'update') { v.showPolicyModal = true; v.policyForm = { enabled: true, intervalMinutes: 60 }; void v.savePolicy() }
      if (kind === 'retry') { v.policy = { enabled: false, interval_minutes: 360, operation: { id: 17, error: 'Recovery pending' } }; void v.retryOperation() }
      h.held = h.pending.findLast(x => x.kind === kind)
    }, kind)
    assert.equal(await page.eval(() => !!window.snapshotHarness.held), true, kind + ': actual request started')
    await change(mode); const before = await state()
    await run(reject => { const x = window.snapshotHarness.held; if (reject) x.reject(Error('stale write error')); else x.resolve({ message: 'Snapshot operation complete' }) }, reject)
    assert.deepEqual(await state(), before, `${kind}/${mode}/${reject}: old write cannot touch current context or notify`); writes++
    await settleReads()
  }
  await fresh(); await settleReads()
  await run(() => { const h = window.snapshotHarness; h.view().showPolicyModal = true; h.view().policyForm = { enabled: true, intervalMinutes: 60 }; void h.view().savePolicy(); h.setSession(1, 'snapshot-session', 'user', 2) })
  assert.equal(await page.eval(() => window.snapshotHarness.view().showPolicyModal), true, 'same sid token refresh preserves draft')
  await run(() => window.snapshotHarness.pending.findLast(x => x.kind === 'update').resolve({ message: 'Auto snapshot policy updated' })); await settleReads()
  assert.equal(await page.eval(() => window.snapshotHarness.view().showPolicyModal), false, 'same sid legitimate success closes editor')
  for (const kind of ['create', 'delete', 'restore', 'update', 'retry']) {
    await fresh(); await settleReads()
    await run(kind => {
      const h = window.snapshotHarness, v = h.view(); window.confirm = () => true
      h.startWrite = () => {
        if (kind === 'create') { v.createForm.name = 'busy snapshot'; void v.createSnapshot() }
        if (kind === 'delete' || kind === 'restore') void v[kind + 'Snapshot']({ id: 11, name: 'source snapshot' })
        if (kind === 'update') void v.updatePolicy({ enabled: false, intervalMinutes: 360 })
        if (kind === 'retry') { v.policy = { enabled: false, interval_minutes: 360, operation: { id: 17 } }; void v.retryOperation() }
      }; h.startWrite()
    }, kind)
    await change('target'); await settleReads()
    await run(() => window.snapshotHarness.startWrite())
    assert.equal(await page.eval(kind => window.snapshotHarness.pending.filter(x => x.kind === kind).length, kind), 1, kind + ': instance change does not release pending write busy')
    await run(kind => window.snapshotHarness.pending.find(x => x.kind === kind).resolve({ message: 'Snapshot operation complete' }), kind)
    await run(() => window.snapshotHarness.startWrite())
    assert.equal(await page.eval(kind => window.snapshotHarness.pending.filter(x => x.kind === kind).length, kind), 2, kind + ': finally releases own busy for retry')
  }
  for (const [locale, width] of [['zh-CN', 1440], ['zh-TW', 768], ['en', 390]]) {
    await fresh(); await settleReads(); await page.setViewport({ width, height: 1000, mobile: width === 390 })
    await run(locale => { const h = window.snapshotHarness; h.setLocale(locale); h.theme.setTheme(innerWidth === 390 ? 'dark' : 'light'); h.view().showPolicyModal = true }, locale)
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: resolve(output, locale + '-' + width + '.png'), format: 'png' })
  }
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log(`PASS SnapshotManager ${reads} stale read and ${writes} stale write receipts across sid/account/role/logout/target/ABA/KeepAlive/unmount; same-sid refresh, pending busy and reentry; controlled API without Incus writes`)
} finally { if (browser) await browser.close(); await server.close() }
