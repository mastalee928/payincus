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
const output = resolve(root, 'logs/host-batch-config-inputs'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const server = await createServer({ configFile: false, root: root + '/scripts/fixtures/host-batch-config', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/host-batch-config/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19689, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19689', { settleMs: 1600 })
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
  await run(() => { const v = window.hostBatchConfig.view(); v.selectedIds = new Set([1]); v.openBatchConfigForSelection() })
  await run(() => { const c = window.hostBatchConfig.child(); c.enabledFields.cpu = true; c.form.cpu = '1e2'; void c.handleSubmit() })
  assert.equal(await page.eval(index => window.hostBatchConfig.pending[index].params.config.cpu, await last('batch')), 100, 'numeric input must not truncate scientific notation to 1')
  console.log('PASS batch config parses complete numeric inputs')
  const count = () => page.eval(() => window.hostBatchConfig.pending.filter(item => item.kind === 'batch').length)
  const view = key => page.eval(key => JSON.parse(JSON.stringify(window.hostBatchConfig.child()[key])), key)
  const result = { success: true, totalCount: 1, successCount: 1, failedCount: 0, failedItems: [] }
  const setup = (field, value) => run(({ field, value }) => {
    const child = window.hostBatchConfig.child(); child.resetForm(); child.enabledFields[field] = true; child.form[field] = value
  }, { field, value })
  const submit = () => run(() => { void window.hostBatchConfig.child().handleSubmit() })
  const complete = () => acceptLast(result)
  const acceptLast = async value => accept(await last('batch'), value)
  await complete()
  for (const [field, value] of [['cpu', '1abc'], ['cpu', '1.5'], ['cpu', ''], ['memory', '0'], ['memory', 'Infinity'], ['memory', '0x20'],
    ['disk', '-1'], ['disk', 'NaN'], ['swapSize', '-1'], ['swapSize', '1048577'], ['portLimit', '0'], ['portLimit', '1001'],
    ['snapshotLimit', '1.5'], ['snapshotLimit', '-1'], ['siteLimit', '1001'], ['limitsCpuPriority', '11'],
    ['bootAutostartPriority', '101'], ['bootAutostartDelay', '4'], ['bootAutostartDelay', '601'], ['bootHostShutdownTimeout', '29'],
    ['limitsProcesses', '12x'], ['monthlyTrafficLimit', 'Infinity'], ['monthlyTrafficLimit', '-1'], ['monthlyTrafficLimit', '8589934592'], ['monthlyTrafficLimit', '1e-20'],
    ['limitsIngress', -5], ['limitsRead', 'wrong'], ['limitsWrite', '-10MB'], ['swapEnabled', null]]) {
    await setup(field, value); const before = await count(); await submit(); assert.equal(await count(), before, `${field} rejects ${value}`)
  }
  for (const [field, value, key, expected] of [['memory', '1e3', 'memory', 1000], ['disk', '0.5', 'disk', 512],
    ['swapSize', '0', 'swapSize', 0], ['snapshotLimit', 0, 'snapshotLimit', 0], ['siteLimit', 0, 'siteLimit', 0],
    ['limitsCpuPriority', 0, 'limitsCpuPriority', 0], ['bootAutostartPriority', '0', 'bootAutostartPriority', 0],
    ['limitsProcesses', '', 'limitsProcesses', null], ['portLimit', '', 'portLimit', null], ['snapshotLimit', '', 'snapshotLimit', null],
    ['monthlyTrafficLimit', '', 'monthlyTrafficLimit', null], ['monthlyTrafficLimit', 0, 'monthlyTrafficLimit', null],
    ['monthlyTrafficLimit', '0.5', 'monthlyTrafficLimit', '536870912'], ['monthlyTrafficLimit', '8589934591', 'monthlyTrafficLimit', '9223372035781033984'],
    ['monthlyTrafficLimit', '1e-3', 'monthlyTrafficLimit', '1073742'], ['limitsIngress', 0, 'limitsIngress', null],
    ['limitsEgress', 10.5, 'limitsEgress', '10.5Mbit'], ['limitsRead', '25', 'limitsRead', '25MB'],
    ['limitsWrite', '10mb', 'limitsWrite', '10MB'], ['limitsRead', '100iops', 'limitsRead', '100iops'], ['swapEnabled', false, 'swapEnabled', false]]) {
    await setup(field, value); const before = await count(); await submit(); assert.equal(await count(), before + 1, `${field} accepts ${value}`)
    assert.equal(await page.eval(({ index, key }) => window.hostBatchConfig.pending[index].params.config[key], { index: await last('batch'), key }), expected)
    await complete()
  }
  await setup('cpu', '2.5'); await run(() => window.hostBatchConfig.child().handleCpuBlur()); assert.equal(await view('form').then(form => form.cpu), '2.5', 'blur must not silently round the requested value')
  assert.equal(await page.eval(() => document.body.innerText.includes('common.cpuPercent')), false)
  await setup('cpu', '100'); await run(() => {
    const input = [...document.querySelectorAll('input[type="number"]')].find(el => !el.disabled)
    input.value = '1.5'; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('blur', { bubbles: true }))
  })
  const fractionalCpu = await count(); await submit(); assert.equal(await count(), fractionalCpu, 'native decimal CPU cannot be silently truncated or rounded')
  await setup('snapshotLimit', ''); await run(() => {
    const child = window.hostBatchConfig.child(); child.expandedSections.quota = true
  })
  await run(() => {
    const input = [...document.querySelectorAll('input[type="number"]')].find(el => !el.disabled && el.min === '0')
    input.value = '0'; input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await submit(); assert.equal(await page.eval(index => window.hostBatchConfig.pending[index].params.config.snapshotLimit, await last('batch')), 0); await complete()
  await setup('memory', '12x'); await submit()
  for (const [locale, width, dark, mobile] of [['zh-CN', 1440, false, false], ['en', 390, true, true]]) {
    await page.setViewport({ width, height: 1000, mobile })
    await run(({ locale, dark }) => { window.hostBatchConfig.setLocale(locale); window.hostBatchConfig.theme.setTheme(dark ? 'dark' : 'light') }, { locale, dark })
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: resolve(output, `${locale}-${width}.png`), format: 'png' })
  }
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log('PASS numeric syntax, range, zero/null, finite values, exact traffic bytes, native zero input and both viewports')
} finally { if (browser) await browser.close(); await server.close() }
