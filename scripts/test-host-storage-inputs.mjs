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
const output = resolve(root, 'logs/host-storage-inputs'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js')
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/host-storage/*.js']
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/host-storage', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/host-storage/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19704, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19704', { settleMs: 1400 })
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
  await run(() => { const v = window.storageHarness.view(); v.openCreateModal(); v.useLoop = true })
  await run(() => { const v = window.storageHarness.view(); v.form.name = 'fixture-new'; v.form.sizeValue = '-1'; void v.createPool() })
  assert.equal(await page.eval(() => window.storageHarness.pending.filter(item => item.kind === 'create').length), 0, 'negative loop capacity cannot reach the host')
  console.log('PASS storage rejects invalid capacity')
  const count = kind => page.eval(kind => window.storageHarness.pending.filter(item => item.kind === kind).length, kind)
  const read = key => page.eval(key => JSON.parse(JSON.stringify(window.storageHarness.view()[key])), key)
  const reject = index => run(index => window.storageHarness.pending[index].reject(new Error('fixture storage unavailable')), index)
  for (const value of ['', '0', 0, '-1', '1junk', '1e2', 'NaN', 'Infinity', '.5', '0.5', '1.1', '9999999999999999999999']) {
    const before = await count('create')
    await run(value => { const v = window.storageHarness.view(); v.form.sizeValue = value; void v.createPool() }, value)
    assert.equal(await count('create'), before, `invalid create size ${value} is rejected`); assert.notEqual(await read('createError'), '')
  }
  await run(() => { const v = window.storageHarness.view(); v.form.sizeValue = '10'; v.form.sizeUnit = 'invalid'; void v.createPool() })
  assert.equal(await count('create'), 0)
  for (const [value, unit, expected] of [['1', 'GiB', '1GiB'], [2, 'GiB', '2GiB'], ['1.5', 'TiB', '1649267441664B'], [' 10 ', 'GiB', '10GiB']]) {
    await run(({ value, unit }) => { const v = window.storageHarness.view(); v.form.sizeValue = value; v.form.sizeUnit = unit; void v.createPool() }, { value, unit })
    assert.equal(await page.eval(index => window.storageHarness.pending[index].data.size, await last('create')), expected)
    await reject(await last('create'))
  }
  await run(() => window.storageHarness.view().closeCreateModal())
  await run(() => { const v = window.storageHarness.view(); v.openEditModal(v.pools[0]) })
  for (const value of ['0', 0, '-1', '1junk', '1e2', 'NaN', 'Infinity', '.5', '0.5', '9999999999999999999999']) {
    const before = await count('edit')
    await run(value => { const v = window.storageHarness.view(); v.editForm.newSizeValue = value; void v.submitEdit() }, value)
    assert.equal(await count('edit'), before, `invalid edit size ${value} cannot silently become description-only update`)
    assert.notEqual(await read('editError'), '')
  }
  await run(() => { const v = window.storageHarness.view(); v.editForm.newSizeValue = ''; v.editForm.description = ''; void v.submitEdit() })
  assert.equal(await page.eval(index => Object.hasOwn(window.storageHarness.pending[index].data, 'size'), await last('edit')), false, 'empty size preserves description-only edits')
  await reject(await last('edit'))
  await run(() => { const v = window.storageHarness.view(); v.editForm.newSizeValue = '2.5'; v.editForm.newSizeUnit = 'TiB'; void v.submitEdit() })
  assert.equal(await page.eval(index => window.storageHarness.pending[index].data.size, await last('edit')), '2748779069440B')
  await reject(await last('edit'))
  await run(() => window.storageHarness.view().closeEditModal())
  await run(() => { const v = window.storageHarness.view(); v.openCreateModal(); v.form.name = 'fixture-new'; v.useLoop = true })
  for (const [locale, width, dark, mobile] of [['zh-CN', 1440, false, false], ['en', 390, true, true]]) {
    await page.setViewport({ width, height: 1000, mobile }); await run(({ locale, dark }) => { window.storageHarness.setLocale(locale); window.storageHarness.theme.setTheme(dark ? 'dark' : 'light') }, { locale, dark })
    const before = await count('create')
    await run(() => {
      const input = document.querySelector('[data-storage-size]'); input.value = '1e2'; input.dispatchEvent(new Event('input', { bubbles: true }))
      document.querySelector('[role="dialog"] .modal-footer .btn-primary').click()
    })
    assert.equal(await count('create'), before, 'native input preserves invalid notation for validation')
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
    assert.equal(await page.eval(() => {
      const dialog = document.querySelector('[role="dialog"]'), footer = dialog.querySelector('.modal-footer').getBoundingClientRect(), error = dialog.querySelector('[role="alert"]').getBoundingClientRect()
      const body = dialog.querySelector('.modal-body').getBoundingClientRect()
      return footer.top >= 0 && footer.bottom <= innerHeight && error.top >= body.bottom && error.bottom <= footer.top
    }), true, 'capacity error and submit controls stay visible')
    await page.screenshot({ path: resolve(output, `${locale}-${width}.png`), format: 'png' })
  }
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log('PASS storage numeric syntax, units, zero versus omission and real browser input matrix')
} finally { if (browser) await browser.close(); await server.close() }
