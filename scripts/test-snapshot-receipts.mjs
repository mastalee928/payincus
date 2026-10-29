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
const output = resolve(root, 'logs/snapshot-receipts'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js')
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/snapshot-policy/*.js']
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/snapshot-policy', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/snapshot-policy/api.js' }, { find: '@', replacement: root + '/client/src' }, ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } }, server: { host: '127.0.0.1', port: 19730, strictPort: true, fs: { allow: [root] } },
})
const snapshot = { id: 11, name: 'source snapshot', incusName: 'source-snapshot', description: null, stateful: false, size: 0, created_at: '2026-10-29T00:00:00.000Z' }
const policy = { enabled: false, interval_minutes: 360, last_run_at: null, next_run_at: null, operation: null }
const operation = { id: '00000000-0000-4000-8000-000000000017', state: 'retry', stage: 'create', error: 'Retry original operation', nextRetryAt: null, snapshotName: 'original snapshot' }
let browser, reads = 0, receipts = 0
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(45); return result }
  const fresh = async (ready = true) => {
    await page.goto('http://127.0.0.1:19730', { settleMs: 300 })
    const deadline = Date.now() + 15000
    while (!await page.eval(() => !!window.snapshotHarness?.view())) { if (Date.now() > deadline) throw Error('Snapshot fixture did not mount: ' + page.consoleErrors.join('\n')); await sleep(70) }
    await run(({ snapshot, policy, operation }) => {
      const h = window.snapshotHarness; h.snapshot = snapshot; h.policy = policy; h.operation = operation; window.confirm = () => true
      h.reads = () => { for (const x of h.pending) if (!x.done && ['snapshots', 'policy'].includes(x.kind)) { x.done = true; x.resolve(x.kind === 'snapshots' ? [h.snapshot] : h.policy) } }
      h.start = kind => { const v = h.view()
        if (kind === 'create') { v.showCreateModal = true; v.createForm = { name: 'created snapshot', description: 'description' }; void v.createSnapshot() }
        if (kind === 'delete' || kind === 'restore') void v[kind + 'Snapshot'](h.snapshot)
        if (kind === 'update') { v.showPolicyModal = true; v.policyForm = { enabled: true, intervalMinutes: 60 }; void v.savePolicy() }
        if (kind === 'retry') { v.policy = { ...h.policy, operation: h.operation }; void v.retryOperation() }
      }
      h.validReceipt = kind => kind === 'retry' ? { operation: null } : kind === 'create' ? { message: 'Snapshot created', snapshot: { id: 12, name: 'created snapshot', description: 'description', incusName: 'created-snapshot', stateful: false } } : { message: 'Snapshot operation complete' }
    }, { snapshot, policy, operation })
    if (ready) await run(() => window.snapshotHarness.reads())
  }
  await fresh(false)
  await run(() => window.snapshotHarness.start('create'))
  assert.equal(await page.eval(() => window.snapshotHarness.pending.filter(x => x.kind === 'create').length), 0, 'initial snapshot and policy reads must complete before create')
  const badSnapshots = [null, {}, [{ ...snapshot, id: 0 }], [{ ...snapshot, stateful: 1 }], [{ ...snapshot, incusName: '' }], [{ ...snapshot, size: -1 }], [{ ...snapshot, created_at: 'invalid' }], [snapshot, snapshot]]
  const badPolicies = [null, {}, { ...policy, enabled: 1 }, { ...policy, interval_minutes: 0 }, { ...policy, interval_minutes: 15 }, { ...policy, last_run_at: 'invalid' }, { ...policy, operation: {} }, { ...policy, operation: { ...operation, state: 'complete' } }]
  for (const kind of ['snapshots', 'policy']) for (const bad of kind === 'snapshots' ? badSnapshots : badPolicies) {
    await fresh(false)
    await run(({ kind, bad }) => {
      const h = window.snapshotHarness
      for (const x of h.pending) { x.done = true; x.resolve(x.kind === kind ? bad : x.kind === 'snapshots' ? [h.snapshot] : h.policy) }
    }, { kind, bad })
    assert.equal(await page.eval(() => !!document.querySelector('[role="alert"]')), true, kind + ': malformed current read shows persistent error')
    if (kind === 'snapshots') assert.equal(await page.eval(() => document.querySelector('#app').textContent.includes(window.snapshotHarness.t('snapshot.noSnapshots'))), false, 'failed list does not claim there are no snapshots')
    await run(() => window.snapshotHarness.start('create'))
    assert.equal(await page.eval(() => window.snapshotHarness.pending.filter(x => x.kind === 'create').length), 0, kind + ': malformed reads cannot authorize mutation')
    await run(() => [...document.querySelectorAll('[role="alert"] button')].find(x => x.textContent.trim() === window.snapshotHarness.t('snapshot.refresh')).click())
    await run(() => window.snapshotHarness.reads())
    assert.equal(await page.eval(() => !!document.querySelector('[role="alert"]')), false, kind + ': real retry accepts valid resources and clears read error')
    assert.equal(await page.eval(() => window.snapshotHarness.view().snapshots[0].stateful), false, 'server Boolean state remains false')
    reads++
  }
  for (const kind of ['create', 'delete', 'restore', 'update', 'retry']) {
    const invalid = kind === 'retry' ? [null, {}, { operation: {} }, { operation: { ...operation, id: '00000000-0000-4000-8000-000000000099' } }] : [null, {}, { message: '' }, { message: '   ' }]
    if (kind === 'create') invalid.push({ message: 'Snapshot created' }, { message: 'Snapshot created', snapshot: { id: 12, name: 'other snapshot', incusName: 'created-snapshot', stateful: false } })
    for (const bad of invalid) {
      await fresh(); await run(kind => window.snapshotHarness.start(kind), kind)
      const before = await page.eval(() => ({ snapshots: JSON.stringify(window.snapshotHarness.view().snapshots), successes: window.snapshotHarness.toast.toasts.value.filter(x => x.type === 'success').length }))
      await run(({ kind, bad }) => window.snapshotHarness.pending.findLast(x => x.kind === kind).resolve(bad), { kind, bad })
      await run(() => window.snapshotHarness.reads())
      assert.equal(await page.eval(() => window.snapshotHarness.toast.toasts.value.filter(x => x.type === 'success').length), before.successes, kind + ': invalid receipt never reports success')
      assert.equal(await page.eval(() => !!window.snapshotHarness.view().pageError), true, kind + ': invalid receipt preserves persistent error')
      if (kind === 'create' || kind === 'update') assert.equal(await page.eval(kind => window.snapshotHarness.view()[kind === 'create' ? 'showCreateModal' : 'showPolicyModal'], kind), true, kind + ': malformed receipt keeps draft editor')
      if (kind === 'delete') assert.equal(await page.eval(() => JSON.stringify(window.snapshotHarness.view().snapshots)), before.snapshots, 'malformed delete receipt cannot remove local snapshot')
      await run(kind => { const h = window.snapshotHarness; if (kind !== 'retry') h.view().policy = h.policy; h.start(kind) }, kind)
      await run(kind => { const h = window.snapshotHarness; h.pending.findLast(x => x.kind === kind).resolve(h.validReceipt(kind)) }, kind)
      await run(() => window.snapshotHarness.reads())
      assert.equal(await page.eval(() => window.snapshotHarness.toast.toasts.value.some(x => x.type === 'success')), true, kind + ': valid current retry confirms success')
      receipts++
    }
  }
  await fresh(); await run(() => window.snapshotHarness.start('retry'))
  await run(() => window.snapshotHarness.pending.findLast(x => x.kind === 'retry').resolve({ operation: null }))
  await run(() => { const h = window.snapshotHarness; for (const x of h.pending) if (!x.done && ['snapshots', 'policy'].includes(x.kind)) { x.done = true; if (x.kind === 'policy') x.reject(Error('Current read failed')); else x.resolve([h.snapshot]) } })
  assert.equal(await page.eval(() => window.snapshotHarness.toast.toasts.value.some(x => x.type === 'success')), false, 'failed confirmation read cannot claim recovery completed')
  assert.equal(await page.eval(() => !!document.querySelector('[role="alert"]')), true)
  for (const [locale, width] of [['zh-CN', 1440], ['zh-TW', 768], ['en', 390]]) {
    await fresh(false); await page.setViewport({ width, height: 1000, mobile: width === 390 })
    await run(locale => { const h = window.snapshotHarness; h.setLocale(locale); h.theme.setTheme(innerWidth === 390 ? 'dark' : 'light'); for (const x of h.pending) x.reject(Error('Fixture connection unavailable')) }, locale)
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: resolve(output, locale + '-' + width + '.png'), format: 'png' })
  }
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log(`PASS SnapshotManager ${reads} malformed reads, ${receipts} invalid write receipts and valid retries, pending ready gate, persistent DOM retry and recovery confirmation; controlled API without Incus writes`)
} finally { if (browser) await browser.close(); await server.close() }
