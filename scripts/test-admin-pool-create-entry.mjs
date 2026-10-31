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
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/admin-pool-create/*.js']
const output = resolve(root, 'logs/admin-pool-create-browser'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const server = await createServer({ configFile: false, root: root + '/scripts/fixtures/admin-pool-create', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api(?:\/admin)?$/, replacement: root + '/scripts/fixtures/admin-pool-create/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19661, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19661/?slow-packages', { settleMs: 1200 })
  const deadline = Date.now() + 15000
  while (!await page.eval(() => !!window.poolHarness)) {
    if (Date.now() >= deadline) throw Error('Admin page did not initialize')
    await sleep(100)
  }
  await sleep(200)
  assert.equal(await page.eval(() => window.poolHarness.pending.filter(item => item.kind === 'packages').length), 0, 'default pool must not depend on an unrelated package request')
  assert.equal(await page.eval(() => window.poolHarness.pending.filter(item => item.kind === 'catalog').length), 1)
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(60); return result }
  const click = key => run(key => {
    const button = [...document.querySelectorAll('button')].find(el => el.checkVisibility() && el.textContent.trim() === window.poolHarness.t(key))
    if (!button) throw Error('Missing button ' + key)
    button.click()
  }, key)
  const count = kind => page.eval(kind => window.poolHarness.pending.filter(item => item.kind === kind).length, kind)
  const finishPool = () => run(() => {
    window.poolHarness.pending.findLast(item => item.kind === 'catalog').resolve({ regions: [] })
    window.poolHarness.pending.findLast(item => item.kind === 'images').resolve({ images: [] })
  })
  await finishPool()
  assert.equal(await page.eval(() => !!document.querySelector('input[placeholder]')), true)
  await click('admin.instanceCreate.packageSource')
  assert.equal(await count('packages'), 1, 'legacy package data loads only when its branch is requested')
  await click('admin.instanceCreate.poolSource')
  assert.equal(await count('catalog'), 2, 'slow package request must not prevent returning to the pool')
  await finishPool()
  await run(() => window.poolHarness.pending.findLast(item => item.kind === 'packages').reject(new Error('Delayed package failure')))
  assert.equal(await page.eval(() => document.querySelector('form').textContent.includes('Delayed package failure')), false)
  await click('admin.instanceCreate.packageSource')
  assert.equal(await count('packages'), 2, 'failed legacy load can retry by reopening the branch')
  await run(() => window.poolHarness.pending.findLast(item => item.kind === 'packages').resolve({ packages: [] }))
  await click('admin.instanceCreate.poolSource'); await finishPool(); await click('admin.instanceCreate.packageSource')
  assert.equal(await count('packages'), 2, 'successful empty legacy load is cached within the page')
  await click('admin.instanceCreate.poolSource'); await finishPool()
  for(const [locale,expected] of [['zh-CN',/免费.*付费/],['zh-TW',/免費.*付費/],['en',/free.*paid/i]]) {
    await run(locale=>window.poolHarness.setLocale(locale),locale)
    assert.match(await page.eval(()=>document.querySelector('.page-description')?.textContent||''),expected,'creation heading must describe both billing modes')
    await click('admin.instanceCreate.packageSource')
    assert.match(await page.eval(()=>document.querySelector('.page-description')?.textContent||''),expected)
    await click('admin.instanceCreate.poolSource');await finishPool()
    if(locale==='zh-TW')for(const width of [1440,390]){
      await page.setViewport({width,height:1000})
      assert.ok(await page.eval(()=>document.documentElement.scrollWidth<=innerWidth))
      await page.screenshot({path:resolve(output,`r322-tw-${width}.png`),format:'png'})
    }
  }
  await page.screenshot({ path: resolve(output, 'independent-pool-entry.png') })
  console.log('PASS real admin default pool has zero legacy package dependency; lazy package loading, slow/failed package return, retry and successful empty cache. Controlled API.')
} finally { if (browser) await browser.close(); await server.close() }
