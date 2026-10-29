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
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/ticket-uploader/*.js']
const output = resolve(root, 'logs/ticket-uploader-lifecycle'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const server = await createServer({ configFile: false, root: root + '/scripts/fixtures/ticket-uploader', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/ticket-uploader/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19678, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19678', { settleMs: 1500 })
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(80); return result }
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  await run(() => window.uploaderHarness.view().removeFile(0))
  assert.equal(await page.eval(() => window.uploaderHarness.state.files.length), 1, 'disabled uploader must not remove the existing attachment')
  console.log('PASS disabled uploader protects existing files')
  const length = () => page.eval(() => window.uploaderHarness.state.files.length)
  const urls = () => page.eval(() => window.uploaderHarness.liveUrls.size)
  const updates = () => page.eval(() => window.uploaderHarness.updates)
  const change = () => run(() => {
    const input = document.querySelector('input[type="file"]'), transfer = new DataTransfer()
    transfer.items.add(window.uploaderHarness.file('added.png')); input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  const initialUpdates = await updates(); assert.equal(await urls(), 1)
  assert.equal(await page.eval(() => document.querySelector('button[title]').disabled), true)
  await run(() => document.querySelector('button[title]').click()); await change()
  assert.equal(await length(), 1); assert.equal(await updates(), initialUpdates); assert.equal(await urls(), 1)
  await run(() => {
    const input = document.querySelector('input[type="file"]'); window.uploaderHarness.pickerClicks = 0
    input.click = () => window.uploaderHarness.pickerClicks++
    window.uploaderHarness.view().openPicker()
  })
  assert.equal(await page.eval(() => window.uploaderHarness.pickerClicks), 0)
  await run(() => { window.uploaderHarness.state.disabled = false }); await run(() => window.uploaderHarness.view().openPicker())
  assert.equal(await page.eval(() => window.uploaderHarness.pickerClicks), 1)
  await run(() => { window.uploaderHarness.state.disabled = true }); await change()
  assert.equal(await length(), 1); assert.equal(await updates(), initialUpdates)
  await run(() => { window.uploaderHarness.state.disabled = false }); await change()
  assert.equal(await length(), 2); assert.equal(await urls(), 2)
  const validUpdates = await updates()
  for (const index of [-1, 2, 0.5]) { await run(index => window.uploaderHarness.view().removeFile(index), index); assert.equal(await length(), 2); assert.equal(await updates(), validUpdates) }
  await run(() => window.uploaderHarness.view().removeFile(0)); assert.equal(await length(), 1); assert.equal(await urls(), 1)
  await run(() => { window.uploaderHarness.state.maxFiles = 1 }); await run(() => window.uploaderHarness.view().openPicker())
  assert.equal(await page.eval(() => window.uploaderHarness.pickerClicks), 1)
  await change(); assert.equal(await length(), 1)
  await run(() => { window.uploaderHarness.state.maxFiles = 3 })
  await run(() => {
    const input = document.querySelector('input[type="file"]'), transfer = new DataTransfer()
    transfer.items.add(window.uploaderHarness.file('wrong.txt', 'text/plain')); input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  assert.equal(await length(), 1)
  assert.equal(await page.eval(() => document.querySelector('input[type="file"]').value), '', 'rejected file selections can be selected again')
  await run(() => { window.uploaderHarness.state.files.push(window.uploaderHarness.file('in-place.png')) }); assert.equal(await urls(), 2)
  await run(() => { window.uploaderHarness.state.files.splice(0, 1) }); assert.equal(await urls(), 1)
  console.log('PASS disabled button/functions/late file events, normal add/remove, indices/capacity/type and preview URL lifecycle')
  for (const [locale, width, dark, mobile] of [['zh-CN', 1440, false, false], ['en', 390, true, true]]) {
    await page.setViewport({ width, height: 700, mobile })
    await run(({ locale, dark }) => { window.uploaderHarness.setLocale(locale); window.uploaderHarness.theme.setTheme(dark ? 'dark' : 'light') }, { locale, dark })
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
    await run(() => document.querySelector('button[title]').focus())
    await sleep(200)
    assert.equal(await page.eval(() => getComputedStyle(document.querySelector('button[title]')).opacity), '1', 'keyboard focus must reveal removal control')
    if (mobile) assert.equal(await page.eval(() => document.querySelector('button[title]').getBoundingClientRect().width >= 44), true)
    await page.screenshot({ path: resolve(output, `${locale}-${width}.png`), format: 'png' })
  }
  const endUpdates = await updates(); await run(() => { window.uploaderHarness.state.mounted = false })
  assert.equal(await urls(), 0)
  await run(() => window.uploaderHarness.view().removeFile(0)); assert.equal(await updates(), endUpdates)
  console.log('PASS desktop/mobile upload controls and unmount URL cleanup')
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
} finally { if (browser) await browser.close(); await server.close() }
