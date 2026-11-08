import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { Browser, sleep } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'
const root = fileURLToPath(new URL('..', import.meta.url)).replaceAll('\\', '/'), require = createRequire(new URL('../client/package.json', import.meta.url))
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href), { default: vue } = await import(pathToFileURL(require.resolve('@vitejs/plugin-vue')).href)
const output = resolve(root, 'logs/gateway-recheck/browser'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js')
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/gateway-recheck/*.js']
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/gateway-recheck', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api\/admin$/, replacement: root + '/scripts/fixtures/gateway-recheck/api.js' },
    { find: '@fontsource-variable/inter', replacement: require.resolve('@fontsource-variable/inter') },
    { find: /^@\/utils\/app-paths$/, replacement: root + '/client/src/utils/app-paths-admin.ts' },
    { find: '@', replacement: root + '/client/src' }, ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } }, server: { host: '127.0.0.1', port: 19764, strictPort: true, fs: { allow: [root] } }
})
let browser
try {
  await server.listen()
  if (process.argv.includes('--inspect-only')) { console.log('Gateway inspector ready http://127.0.0.1:19764/'); await new Promise(() => {}) }
  browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  const waitFor = async fn => { for (let i = 0; i < 100; i++) { if (await page.eval(fn)) return; await sleep(100) } throw Error(await page.eval(() => document.body.innerText)) }
  const fresh = async (query = '') => { await page.goto('http://127.0.0.1:19764/' + query, { settleMs: 150 }); await waitFor(() => !!document.querySelector('fieldset button:not(:disabled)')) }
  const click = async selector => {
    const box = await page.eval(selector => { const el = document.querySelector(selector); el.scrollIntoView({ block: 'center', behavior: 'instant' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } }, selector)
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...box })
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...box }); await sleep(100)
  }
  for (const locale of ['zh-CN', 'zh-TW', 'en']) for (const width of [1440, 768, 390]) {
    await page.setViewport({ width, height: 900, mobile: width < 500 })
    await fresh(`?locale=${locale}${width === 768 ? '&dark' : ''}`)
    await click('fieldset button')
    assert.equal(await page.eval(() => !!document.querySelector('#gateway-configuration > details .btn-primary')), false, 'configured gateway has no install or confirm action')
    await click('.management-gateway > .card button')
    await waitFor(() => window.gatewayFixture.fixture.calls.includes('check'))
    const check = await page.eval(() => ({ calls: window.gatewayFixture.fixture.calls, text: document.body.innerText, width: document.documentElement.scrollWidth }))
    assert.ok(check.width <= width, 'no horizontal overflow'); assert.ok(!check.text.includes('gatewayEndpoint.setup.'))
    assert.equal(check.calls.filter(c => c === 'prepare' || c === 'confirm' || c === 'task').length, 0)
    await page.screenshot({ path: output + `/${locale}-${width}.png`, format: 'png', fullPage: true })
  }
  console.log('PASS real Vue/Chrome: three languages, desktop/tablet/mobile, old plans hidden, only GET check, no clipping')
  await fresh(); await page.eval(() => { window.gatewayFixture.fixture.delay = true })
  await click('.management-gateway > .card button'); await click('.management-gateway > .card button')
  assert.equal(await page.eval(() => window.gatewayFixture.fixture.calls.filter(c => c === 'check').length), 1)
  await page.eval(() => { window.gatewayFixture.fixture.delay = false; window.gatewayFixture.fixture.pending() })
  await waitFor(() => !document.querySelector('.management-gateway > .card button').disabled)
  await fresh('?mode=offline'); await click('fieldset button'); await click('.management-gateway > .card button')
  assert.equal(await page.eval(() => !!document.querySelector('#gateway-configuration > details .btn-primary')), false)
  await page.eval(() => { window.gatewayFixture.fixture.failCheck = true }); await click('.management-gateway > .card button')
  assert.ok(await page.eval(() => !!document.querySelector('#gateway-setup-error')))
  assert.equal(await page.eval(() => !!document.querySelector('#gateway-configuration > details .btn-primary')), false)
  await page.screenshot({ path: output + '/offline.png', format: 'png', fullPage: true })
  console.log('PASS duplicate checks coalesced; offline and transport failure remain read-only with visible errors')
  await fresh('?mode=fresh'); await click('fieldset button'); await click('#gateway-configuration .btn-primary')
  await waitFor(() => !!document.querySelector('#gateway-configuration input'))
  await page.eval(() => { const input = document.querySelector('#gateway-configuration input'); input.value = 'gateway.example.com'; input.dispatchEvent(new Event('input', { bubbles: true })); window.gatewayFixture.fixture.mode = 'ready' })
  await click('#gateway-configuration .rounded-lg button')
  assert.equal(await page.eval(() => window.gatewayFixture.fixture.calls.includes('confirm')), false, 'another administrator configured the gateway after planning')
  assert.equal(await page.eval(() => !!document.querySelector('#gateway-configuration input')), false)
  await fresh('?mode=fresh'); await click('fieldset button'); await click('#gateway-configuration .btn-primary')
  await waitFor(() => !!document.querySelector('#gateway-configuration input'))
  await page.eval(() => { const input = document.querySelector('#gateway-configuration input'); input.value = 'gateway.example.com'; input.dispatchEvent(new Event('input', { bubbles: true })) })
  await click('#gateway-configuration .rounded-lg button')
  assert.equal(await page.eval(() => window.gatewayFixture.fixture.calls.filter(c => c === 'confirm').length), 1)
  console.log('PASS fresh setup keeps explicit confirmation; stale plans recheck and never send apply after configuration changes')
  for (const phase of ['prepare', 'confirm']) {
    await fresh('?mode=fresh'); await click('fieldset button')
    if (phase === 'confirm') {
      await click('#gateway-configuration .btn-primary')
      await waitFor(() => !!document.querySelector('#gateway-configuration input'))
      await page.eval(() => { const input = document.querySelector('#gateway-configuration input'); input.value = 'gateway.example.com'; input.dispatchEvent(new Event('input', { bubbles: true })) })
    }
    await page.eval(() => { window.gatewayFixture.fixture.delay = true })
    await click(phase === 'prepare' ? '#gateway-configuration .btn-primary' : '#gateway-configuration .rounded-lg button')
    await page.eval(() => {
      const state = window.gatewayFixture
      state.auth.token = 'fixture.changed.fixture'; localStorage.setItem('token', state.auth.token)
      state.fixture.delay = false; state.fixture.pending()
    })
    await sleep(150)
    assert.equal(await page.eval(phase => window.gatewayFixture.fixture.calls.filter(c => c === phase).length, phase), 0)
  }
  console.log('PASS authentication changes during prechecks cannot dispatch prepare or confirm for another session')
} finally { if (browser) await browser.close(); await server.close() }
