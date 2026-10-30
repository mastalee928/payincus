import assert from 'node:assert/strict'
import process from 'node:process'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { Browser, sleep } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'
const root = fileURLToPath(new URL('..', import.meta.url)).replaceAll('\\', '/')
const require = createRequire(new URL('../client/package.json', import.meta.url))
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href)
const { default: vue } = await import(pathToFileURL(require.resolve('@vitejs/plugin-vue')).href)
const output = resolve(root, 'logs/oauth-locales'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js')
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}']
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/oauth-locales',
  publicDir: root + '/client/public', plugins: [vue()], resolve: { alias: [
    { find: /^@\/api(?:\/admin)?$/, replacement: root + '/scripts/fixtures/oauth-locales/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } }, server: { host: '127.0.0.1', port: 19759, strictPort: true, fs: { allow: [root] } } })
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19759/', { settleMs: 1200 })
  const deadline = Date.now() + 20000
  while (!await page.eval(() => window.oauthLocaleHarness?.view()?.configs.github.configured)) {
    if (Date.now() > deadline) throw Error(page.consoleErrors.join('\n') || 'OAuth locale fixture did not load')
    await sleep(100)
  }
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(70); return result }
  for (const locale of ['zh-CN', 'zh-TW', 'en']) {
    await run(locale => window.oauthLocaleHarness.setLocale(locale), locale)
    for (const width of [1440, 768, 390]) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width === 390 })
      await run(width => window.oauthLocaleHarness.theme.setTheme(width === 390 ? 'dark' : 'light'), width)
      await run(() => window.oauthLocaleHarness.view().openEdit('github'))
      const result = await page.eval(() => {
        const h = window.oauthLocaleHarness, modal = document.querySelector('.modal-content'), body = modal.textContent
        return { title: document.querySelector('h1').textContent.trim(), expected: h.t('admin.oauth.title'),
          hint: body.includes(h.t('admin.oauth.leaveEmptyUnchanged')), rawKeys: /admin\.oauth\./.test(body),
          emptySecret: modal.querySelector('input[type="password"]').value === '',
          fit: modal.getBoundingClientRect().right <= innerWidth && modal.getBoundingClientRect().left >= 0 }
      })
      assert.equal(result.title, result.expected); assert.equal(result.hint, true); assert.equal(result.rawKeys, false)
      assert.equal(result.emptySecret, true); assert.equal(result.fit, true)
      if (locale === 'zh-TW') assert.equal(result.title, 'OAuth 設定')
      await page.screenshot({ path: resolve(output, `${locale}-${width}.png`) })
      await run(() => { const modal = document.querySelector('.modal-content'); modal.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
      assert.equal(await page.eval(() => window.oauthLocaleHarness.view().showModal), false)
    }
  }
  const calls = await page.eval(() => window.oauthLocaleHarness.calls)
  assert.equal(calls.length, 9)
  for (const call of calls) { assert.equal(call.provider, 'github'); assert.deepEqual(call.payload, { clientId: 'display-only-client', enabled: true }) }
  assert.deepEqual(page.consoleErrors, [])
  console.log('PASS actual OAuth settings: 3 locales × 3 widths, Traditional Chinese text, existing-secret empty input and omitted update field, actual submit, no raw keys and dialog fit. Controlled API only; external login/apps not validated.')
} finally { if (browser) await browser.close(); await server.close() }
