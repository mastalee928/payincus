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
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/payment-locales/*.js']
const output = resolve(root, 'logs/payment-locales-browser'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const server = await createServer({ configFile: false, root: root + '/scripts/fixtures/payment-locales', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api(?:\/admin)?$/, replacement: root + '/scripts/fixtures/payment-locales/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19681, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19681/', { settleMs: 1200 })
  const deadline = Date.now() + 15000
  while (!await page.eval(() => !!window.localeHarness?.calls.length)) {
    if (Date.now() >= deadline) throw Error('Payment locale fixture did not load within 15 seconds')
    await sleep(100)
  }
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(60); return result }
  await run(() => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === window.localeHarness.t('admin.paymentProviders.add')).click())
  const labelKeys = { yipay: 'yipay', heleket: 'heleket', upaypro: 'upaypro', antom: 'antom', manual: 'manual' }
  for (const locale of ['zh-CN', 'zh-TW', 'en']) {
    await run(locale => window.localeHarness.setLocale(locale), locale)
    assert.equal(await page.eval(() => window.localeHarness.t('admin.paymentProviders.config.heleketMethodsPlaceholder')), 'USDT@TRON\nUSDT@BSC\nBTC\nETH')
    for (const [type, key] of Object.entries(labelKeys)) {
      await run(type => {
        const input = document.querySelector('#payment-provider-type')
        input.value = type; input.dispatchEvent(new Event('change', { bubbles: true }))
      }, type)
      const result = await page.eval(({ type, key }) => {
        const modal = document.querySelector('form[role="dialog"]'), input = document.querySelector('#payment-provider-type')
        return { selected: input.value, label: input.selectedOptions[0].textContent.trim(), expected: window.localeHarness.t('admin.paymentProviders.providerTypes.' + key),
          rawKeys: /admin\.paymentProviders\./.test(modal.textContent + [...modal.querySelectorAll('[placeholder]')].map(el => el.getAttribute('placeholder')).join(' ')),
          passwordsEmpty: [...modal.querySelectorAll('input[type="password"]')].every(el => el.value === '') }
      }, { type, key })
      assert.equal(result.selected, type); assert.equal(result.label, result.expected)
      assert.equal(result.rawKeys, false); assert.equal(result.passwordsEmpty, true)
    }
    for (const width of [1440, 390]) {
      await run(width => window.localeHarness.theme.setTheme(width === 390 ? 'dark' : 'light'), width)
      await page.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width === 390 })
      await page.screenshot({ path: resolve(output, `${locale}-${width}.png`) })
      assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
    }
  }
  assert.deepEqual(await page.eval(() => window.localeHarness.calls), ['list'])
  console.log('PASS payment locale UI: 3 locales, 5 implemented provider types, labels/placeholders without raw keys, literal @ catalog string and desktop/mobile fit. Read-only controlled list; no config, credentials or payments written.')
} finally { if (browser) await browser.close(); await server.close() }
