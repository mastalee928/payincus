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
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/host-batch-config/*.js']
const output = resolve(root, 'logs/host-batch-config-roles'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const server = await createServer({ configFile: false, root: root + '/scripts/fixtures/host-batch-config', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/host-batch-config/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19690, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19690', { settleMs: 1600 })
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await page.eval(() => !!window.hostBatchConfig?.pending.some(item => item.kind === 'list'))) break
    if (attempt === 99) throw new Error('batch config inputs fixture did not mount')
    await sleep(150)
  }
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(90); return result }
  const last = kind => page.eval(kind => window.hostBatchConfig.pending.findLastIndex(item => item.kind === kind), kind)
  const accept = (index, data) => run(({ index, data }) => window.hostBatchConfig.pending[index].resolve(data), { index, data })
  const row = (id, hostId = 1) => ({ id, name: `Fixture instance ${id}`, hostId, status: 'running', image: 'debian/12', cpu: 1, memory: 512, disk: 10240, username: 'Fixture user', userId: 1, packagePlanId: 1, billingPrice: 10 })
  const list = (ids, hostId = 1, status = 'running') => ({ instances: ids.map(id => ({ ...row(id, hostId), status })), total: ids.length, totalPages: 1 })
  await accept(await last('list'), list([1, 2]))
  await run(() => { window.hostBatchConfig.auth.user = { id: 1, username: 'fixture', role: 'user' } })
  await accept(await last('list'), list([1, 2]))
  await run(() => { const v = window.hostBatchConfig.view(); v.selectedIds = new Set([1]); v.openBatchConfigForSelection() })
  await run(() => { const c = window.hostBatchConfig.child(); c.enabledFields.swapSize = true; c.form.swapSize = '512'; void c.handleSubmit() })
  assert.equal(await last('batch'), -1, 'host owners cannot submit admin-only advanced fields')
  console.log('PASS batch config advanced fields remain admin only')
  const advancedFields = ['swapEnabled', 'swapSize', 'limitsRead', 'limitsWrite', 'limitsIngress', 'limitsEgress',
    'limitsProcesses', 'limitsCpuPriority', 'bootAutostart', 'bootAutostartPriority', 'bootAutostartDelay', 'bootHostShutdownTimeout']
  const values = { swapEnabled: true, swapSize: '512', limitsRead: '10MB', limitsWrite: '10MB', limitsIngress: 10, limitsEgress: 10,
    limitsProcesses: '100', limitsCpuPriority: '5', bootAutostart: true, bootAutostartPriority: '1', bootAutostartDelay: '5', bootHostShutdownTimeout: '30' }
  const setup = (field, value) => run(({ field, value }) => { const c = window.hostBatchConfig.child(); c.resetForm(); c.enabledFields[field] = true; c.form[field] = value }, { field, value })
  const submit = () => run(() => { void window.hostBatchConfig.child().handleSubmit() })
  const count = () => page.eval(() => window.hostBatchConfig.pending.filter(item => item.kind === 'batch').length)
  const success = { success: true, totalCount: 1, successCount: 1, failedCount: 0, failedItems: [] }
  for (const field of advancedFields) { await setup(field, values[field]); await submit(); assert.equal(await count(), 0, `${field} remains admin only`) }
  for (const field of [...advancedFields, 'limitsReadIops', 'limitsWriteIops']) {
    await run(field => { void window.hostBatchConfig.child().submitBatch([1], { [field]: 10 }, false) }, field)
    assert.equal(await count(), 0, `${field} cannot bypass the form gate`)
  }
  await setup('cpu', '100'); await submit(); assert.equal(await count(), 1)
  await accept(await last('batch'), success)
  await run(() => window.hostBatchConfig.child().handleDone()); await accept(await last('list'), list([1, 2]))
  await run(() => { const v = window.hostBatchConfig.view(); v.selectedIds = new Set([1]); v.openBatchConfigForSelection() })
  await setup('siteLimit', 0); await submit(); await accept(await last('batch'), success)
  await run(() => window.hostBatchConfig.child().handleDone()); await accept(await last('list'), list([1, 2]))
  await run(() => { const v = window.hostBatchConfig.view(); v.selectedIds = new Set([1]); v.openBatchConfigForSelection() })
  assert.equal(await page.eval(() => {
    const text = document.querySelector('[role="dialog"]').innerText
    return text.includes('SWAP') || text.includes('存储 I/O') || text.includes('进程与调度') || text.includes('启动设置')
  }), false, 'host owner form shows only editable sections')
  assert.equal(await page.eval(() => document.querySelectorAll('[role="dialog"] fieldset button').length), 2, 'only resource and quota section controls remain')
  for (const [locale, width, dark, mobile] of [['zh-CN', 1440, false, false], ['en', 390, true, true]]) {
    await page.setViewport({ width, height: 1000, mobile })
    await run(({ locale, dark }) => { window.hostBatchConfig.setLocale(locale); window.hostBatchConfig.theme.setTheme(dark ? 'dark' : 'light') }, { locale, dark })
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: resolve(output, `owner-${locale}-${width}.png`), format: 'png' })
  }
  await run(() => { window.hostBatchConfig.auth.user = { id: 1, username: 'fixture', role: 'admin' } }); await accept(await last('list'), list([1, 2]))
  await run(() => { const v = window.hostBatchConfig.view(); v.selectedIds = new Set([1]); v.openBatchConfigForSelection() })
  assert.equal(await page.eval(() => document.querySelectorAll('[role="dialog"] fieldset button').length), 6, 'administrator retains all existing sections')
  for (const field of advancedFields) {
    await setup(field, values[field]); const before = await count(); await submit(); assert.equal(await count(), before + 1)
    await accept(await last('batch'), success)
  }
  await setup('swapSize', '512'); await submit(); const oldRole = await last('batch')
  await run(() => { window.hostBatchConfig.auth.user = { id: 1, username: 'fixture', role: 'user' } }); await accept(await last('list'), list([1, 2]))
  await accept(oldRole, success); assert.equal(await page.eval(() => window.hostBatchConfig.view().showBatchConfigModal), false)
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log('PASS admin field gating, host owner basic fields, role changes and both viewports')
} finally { if (browser) await browser.close(); await server.close() }
