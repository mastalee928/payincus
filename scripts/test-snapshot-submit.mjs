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
const output = resolve(root, 'logs/snapshot-submit'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js')
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/snapshot-policy/*.js']
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/snapshot-policy', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/snapshot-policy/api.js' }, { find: '@', replacement: root + '/client/src' }, ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } }, server: { host: '127.0.0.1', port: 19729, strictPort: true, fs: { allow: [root] } },
})
let browser, stale = 0
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(40); return result }
  const fresh = async () => {
    await page.goto('http://127.0.0.1:19729', { settleMs: 300 })
    const deadline = Date.now() + 15000
    while (!await page.eval(() => !!window.snapshotHarness?.view())) { if (Date.now() > deadline) throw Error('Snapshot fixture did not mount: ' + page.consoleErrors.join('\n')); await sleep(70) }
    await run(() => {
      const h = window.snapshotHarness; window.confirm = () => true
      h.settleReads = () => { for (const x of h.pending) if (!x.done && ['snapshots', 'policy'].includes(x.kind)) {
        x.done = true; x.resolve(x.kind === 'snapshots' ? [] : { enabled: false, interval_minutes: 360, operation: null })
      } }; h.settleReads()
      h.source = { id: 11, name: 'source snapshot' }
      h.start = kind => {
        const v = h.view()
        if (kind === 'create') { v.createForm.name = 'submitted snapshot'; v.createForm.description = 'submitted description'; void v.createSnapshot() }
        if (kind === 'delete' || kind === 'restore') void v[kind + 'Snapshot'](h.source)
        if (kind === 'update') void v.updatePolicy({ enabled: true, intervalMinutes: 60 })
        if (kind === 'retry') { v.policy = { enabled: false, interval_minutes: 360, operation: { id: '00000000-0000-4000-8000-000000000017' } }; void v.retryOperation() }
      }
    })
  }
  const settle = reject => run(reject => {
    const h = window.snapshotHarness, x = h.pending.findLast(x => !['snapshots', 'policy'].includes(x.kind))
    if (reject) x.reject(Error('Current snapshot write failed'))
    else x.resolve({ message: 'Snapshot operation complete' })
  }, reject)
  const state = () => page.eval(() => {
    const h = window.snapshotHarness, v = h.view()
    return { create: JSON.stringify(v.createForm), policy: JSON.stringify(v.policyForm), showCreate: v.showCreateModal, showPolicy: v.showPolicyModal,
      error: v.pageError, toastCount: h.toast.toasts.value.length, reads: h.pending.filter(x => ['snapshots', 'policy'].includes(x.kind)).length }
  })
  const kinds = ['create', 'delete', 'restore', 'update', 'retry']
  for (const first of kinds) for (const second of kinds) {
    await fresh(); await run(first => window.snapshotHarness.start(first), first)
    await run(() => window.snapshotHarness.view().policy = { enabled: false, interval_minutes: 360, operation: null })
    await run(second => window.snapshotHarness.start(second), second)
    assert.equal(await page.eval(() => window.snapshotHarness.pending.filter(x => !['snapshots', 'policy'].includes(x.kind)).length), 1, first + '/' + second + ': shared busy rejects conflicting submission')
    await settle(true); await run(() => window.snapshotHarness.settleReads())
    assert.equal(await page.eval(() => window.snapshotHarness.view().createLoading || window.snapshotHarness.view().policyLoading || window.snapshotHarness.view().retryLoading || window.snapshotHarness.view().actionLoading), false, 'failure releases busy')
  }
  for (const kind of ['create', 'update']) for (const mode of ['edit', 'edit-aba', 'dialog-aba', 'other-dialog']) for (const reject of [false, true]) {
    await fresh()
    await run(kind => {
      const h = window.snapshotHarness, v = h.view()
      if (kind === 'create') { v.showCreateModal = true; h.start(kind) }
      else { v.showPolicyModal = true; v.policyForm = { enabled: true, intervalMinutes: 60 }; void v.savePolicy() }
    }, kind)
    await run(async ({ kind, mode }) => {
      const v = window.snapshotHarness.view()
      if (mode === 'edit' || mode === 'edit-aba') {
        if (kind === 'create') { v.createForm.name = 'new snapshot draft'; if (mode === 'edit-aba') v.createForm.name = 'submitted snapshot' }
        else { v.policyForm.intervalMinutes = 1440; if (mode === 'edit-aba') v.policyForm.intervalMinutes = 60 }
      }
      if (mode === 'dialog-aba') {
        if (kind === 'create') { v.showCreateModal = false; await Promise.resolve(); v.showCreateModal = true }
        else { v.showPolicyModal = false; await Promise.resolve(); v.showPolicyModal = true }
      }
      if (mode === 'other-dialog') { if (kind === 'create') v.showPolicyModal = true; else v.showCreateModal = true }
    }, { kind, mode })
    const before = await state(); await settle(reject)
    assert.deepEqual(await state(), before, `${kind}/${mode}/${reject}: stale receipt cannot discard draft, close dialog, notify or start reads`); stale++
  }
  await fresh()
  await run(() => { const h = window.snapshotHarness, v = h.view(); v.snapshots = [{ ...h.source }, { id: 12, name: 'other snapshot' }]; h.start('delete'); h.source.id = 12; h.source.name = 'changed source' })
  await settle(false)
  assert.deepEqual(await page.eval(() => window.snapshotHarness.view().snapshots.map(x => x.id)), [12], 'delete receipt uses submitted primitive snapshot ID')
  await fresh()
  await run(() => {
    const h = window.snapshotHarness
    h.submittedPolicy = { enabled: true, intervalMinutes: 60 }
    void h.view().updatePolicy(h.submittedPolicy)
    h.submittedPolicy.enabled = false; h.submittedPolicy.intervalMinutes = 1440
  })
  assert.deepEqual(await page.eval(() => window.snapshotHarness.pending.findLast(x => x.kind === 'update').data), { enabled: true, intervalMinutes: 60 }, 'submitted policy payload is frozen independently of caller')
  await settle(false); await run(() => window.snapshotHarness.settleReads())
  await fresh()
  await run(() => {
    const h = window.snapshotHarness
    h.view().showCreateModal = true; h.start('create'); void h.view().loadPolicy()
    h.pending.findLast(x => x.kind === 'policy').resolve({ enabled: true, interval_minutes: 1440, operation: null })
  })
  assert.deepEqual(await page.eval(() => ({ ...window.snapshotHarness.view().policyForm })), { enabled: false, intervalMinutes: 360 }, 'background policy read keeps busy draft untouched')
  await settle(false); await run(() => window.snapshotHarness.settleReads())
  assert.equal(await page.eval(() => window.snapshotHarness.view().showCreateModal), false, 'background policy read does not invalidate current create receipt')
  for (const kind of ['create', 'update']) {
    await fresh()
    await run(kind => {
      const h = window.snapshotHarness, v = h.view()
      if (kind === 'create') { v.showCreateModal = true; h.start(kind) }
      else { v.showPolicyModal = true; v.policyForm = { enabled: true, intervalMinutes: 60 }; void v.savePolicy() }
    }, kind)
    assert.equal(await page.eval(() => [...document.querySelectorAll('.modal-content input, .modal-content select')].every(x => x.disabled)), true, kind + ': draft fields disabled while pending')
    await run(kind => { const v = window.snapshotHarness.view(); if (kind === 'create') v.closeCreateModal(); else v.closePolicyModal() }, kind)
    assert.equal(await page.eval(kind => window.snapshotHarness.view()[kind === 'create' ? 'showCreateModal' : 'showPolicyModal'], kind), true, kind + ': close handler preserves submitted draft')
    await settle(true); await run(() => window.snapshotHarness.settleReads())
    assert.equal(await page.eval(kind => window.snapshotHarness.view()[kind === 'create' ? 'showCreateModal' : 'showPolicyModal'], kind), true, kind + ': failure preserves editor for retry')
    await run(kind => { const v = window.snapshotHarness.view(); if (kind === 'create') void v.createSnapshot(); else void v.savePolicy() }, kind)
    await settle(false); await run(() => window.snapshotHarness.settleReads())
    assert.equal(await page.eval(kind => window.snapshotHarness.view()[kind === 'create' ? 'showCreateModal' : 'showPolicyModal'], kind), false, kind + ': current successful retry closes editor')
  }
  for (const [locale, width] of [['zh-CN', 1440], ['zh-TW', 768], ['en', 390]]) {
    await fresh(); await page.setViewport({ width, height: 1000, mobile: width === 390 })
    await run(locale => { const h = window.snapshotHarness; h.setLocale(locale); h.theme.setTheme(innerWidth === 390 ? 'dark' : 'light'); h.view().showPolicyModal = true; h.view().policyForm = { enabled: true, intervalMinutes: 60 }; void h.view().savePolicy() }, locale)
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: resolve(output, locale + '-' + width + '.png'), format: 'png' })
  }
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log(`PASS SnapshotManager 25 conflicting mutation pairs, ${stale} stale draft receipts, fixed delete target, busy fields/close and current failed/successful retries; controlled API without Incus writes`)
} finally { if (browser) await browser.close(); await server.close() }
