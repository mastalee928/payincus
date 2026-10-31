import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { Browser, sleep } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'
const root = fileURLToPath(new URL('..', import.meta.url)).replaceAll('\\', '/'), require = createRequire(new URL('../client/package.json', import.meta.url))
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href), { default: vue } = await import(pathToFileURL(require.resolve('@vitejs/plugin-vue')).href)
const output = resolve(root, 'logs/image-selector-lifecycle'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js'); tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/image-selector/*.js']
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/image-selector', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: '@', replacement: root + '/client/src' }, ...['vue', 'pinia', 'vue-i18n'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } }, server: { host: '127.0.0.1', port: 19762, strictPort: true, fs: { allow: [root] } }
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19762', { settleMs: 250 })
  const deadline = Date.now() + 15000
  while (!await page.eval(() => !!window.imageSelectorHarness)) { if (Date.now() > deadline) throw Error('Image selector did not mount'); await sleep(70) }
  const run = async (fn, arg) => { const value = await page.eval(fn, arg); await sleep(30); return value }
  const baseline = await page.eval(() => window.imageSelectorHarness.counts())
  assert.equal(baseline.active, 0)
  for (const embedded of [false, true]) for (let round = 0; round < 20; round++) {
    await run(embedded => { const h = window.imageSelectorHarness; h.embedded.value = embedded; h.mounted.value = true }, embedded)
    assert.deepEqual((await page.eval(() => window.imageSelectorHarness.counts())).kinds, ['document:click:false', 'window:resize:false', 'window:scroll:true'])
    await run(() => document.querySelector('.image-selector-container > button').click())
    assert.equal(await page.eval(() => document.querySelector('.image-selector-container > button').getAttribute('aria-expanded')), 'true')
    await run(() => { window.dispatchEvent(new Event('resize')); window.dispatchEvent(new Event('scroll')) })
    await run(() => document.querySelector('#outside').click())
    assert.equal(await page.eval(() => document.querySelector('.image-selector-container > button').getAttribute('aria-expanded')), 'false')
    await run(() => document.querySelector('.image-selector-container > button').click())
    if (round % 2 === 0) {
      await run(() => [...document.querySelectorAll('button[aria-pressed]')].find(button => button.textContent.includes('Ubuntu')).click())
      assert.equal(await page.eval(() => window.imageSelectorHarness.selected.value), 'ubuntu/24.04')
    }
    await run(() => { window.imageSelectorHarness.mounted.value = false })
    const after = await page.eval(() => window.imageSelectorHarness.counts())
    assert.equal(after.active, 0); assert.equal(after.unmatched, 0); assert.equal(after.added, after.removed)
    assert.equal(await page.eval(() => document.querySelectorAll('button[aria-pressed]').length), 0, 'teleported open menu is removed on unmount')
    await run(() => { document.querySelector('#outside').click(); window.dispatchEvent(new Event('resize')); window.dispatchEvent(new Event('scroll')) })
  }
  const final = await page.eval(() => window.imageSelectorHarness.counts())
  assert.equal(final.added - baseline.added, 120); assert.equal(final.removed - baseline.removed, 120)
  assert.deepEqual(page.consoleErrors, [])
  console.log('PASS 40 actual Vue mount/unmount cycles, normal and embedded: 120 exact callback/capture adds and removals; outside click, selection, resize/scroll and open-menu teleport cleanup; zero retained listeners or browser errors')
} finally { if (browser) await browser.close(); await server.close() }
