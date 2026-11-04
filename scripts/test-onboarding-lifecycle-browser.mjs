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
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}']
const output = resolve(root, 'logs/onboarding-browser'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const server = await createServer({ configFile: false, root: root + '/scripts/fixtures/onboarding-lifecycle', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api(?:\/admin)?$/, replacement: root + '/scripts/fixtures/onboarding-lifecycle/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19664, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19664/', { settleMs: 1200 })
  const run = async (fn, arg) => { const value = await page.eval(fn, arg); await sleep(80); return value }
  const click = key => run(key => {
    const button = [...document.querySelectorAll('button')].find(el => el.checkVisibility() && el.textContent.trim() === window.onboardingHarness.t(key))
    if (!button) throw Error('Button missing: ' + key); button.click()
  }, key)
  const address = value => run(value => { const input = document.querySelector('input[aria-describedby="onboarding-address-result"]'); input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('blur')) }, value)
  const last = () => page.eval(() => window.onboardingHarness.pending.findLastIndex(item => item.kind === 'address'))
  const accept = (index, data) => run(({ index, data }) => window.onboardingHarness.pending[index].resolve(data), { index, data })
  const existing = { publicIp: '8.8.4.4', conflict: { code: 'HOST_IP_ALREADY_REGISTERED', publicIp: '8.8.4.4', host: { id: 10, name: 'san-jose-fixture', isInstalled: true, status: 'online' } } }
  await click('onboarding.newHost'); await address('8.8.4.4'); await accept(await last(), existing)
  assert.equal(await page.eval(() => document.querySelector('input[aria-describedby="onboarding-address-result"]').getAttribute('aria-invalid')), 'true')
  assert.ok(await page.eval(() => document.querySelector('#onboarding-address-result').textContent.includes('san-jose-fixture')))
  assert.equal(await page.eval(() => document.querySelector('form[role="dialog"] button[type="submit"]').disabled), true)
  for (const locale of ['zh-CN', 'zh-TW', 'en']) for (const width of [390, 768, 1440]) {
    await run(({ locale, width }) => { window.onboardingHarness.setLocale(locale); window.onboardingHarness.theme.setTheme(width === 390 ? 'dark' : 'light') }, { locale, width })
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width === 390 })
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: resolve(output, `${locale}-${width}.png`) })
  }
  await click('onboarding.viewExistingHost')
  assert.equal(await page.eval(() => window.onboardingHarness.pending.findLast(item => item.kind === 'inventory').params.search), 'san-jose-fixture')
  await click('onboarding.newHost'); await address('8.8.8.8'); const old = await last()
  await address('1.1.1.1'); const current = await last()
  await accept(old, existing)
  assert.equal(await page.eval(() => document.querySelector('#onboarding-address-result').textContent.includes('san-jose-fixture')), false, 'old address response cannot overwrite a new address')
  await accept(current, { publicIp: '1.1.1.1', conflict: null })
  assert.equal(await page.eval(() => document.querySelector('form[role="dialog"] button[type="submit"]').disabled), false)
  await address('8.8.8.8'); const closing = await last(); await click('common.close'); await accept(closing, existing)
  await click('onboarding.newHost')
  assert.equal(await page.eval(() => document.querySelector('#onboarding-address-result').textContent.includes('san-jose-fixture')), false)
  await address('8.8.4.4'); await accept(await last(), { publicIp: '8.8.4.4', conflict: { code: 'HOST_IP_ONBOARDING', publicIp: '8.8.4.4', node: { id: 'node-fixture', batchId: 'batch-fixture', status: 'running' } } })
  assert.equal(await page.eval(() => document.querySelector('form[role="dialog"] button[type="submit"]').disabled), true)
  await click('onboarding.viewExistingTask')
  assert.equal(await page.eval(() => document.querySelector('#pool-tab-tasks').getAttribute('aria-selected')), 'true')
  console.log('PASS actual Vue onboarding: duplicate IP immediate message, existing Host search, task navigation, stale address/closed modal isolation; 3 locales and 3 widths, light/dark (controlled API)')
} finally { if (browser) await browser.close(); await server.close() }
