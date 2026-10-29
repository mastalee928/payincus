import { recoveryCodes, qrCode } from './fixtures/two-factor/responses.mjs'
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
const output = resolve(root, 'logs/two-factor-busy'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js')
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/two-factor/*.js']
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/two-factor', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/two-factor/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } }, server: { host: '127.0.0.1', port: 19717, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19717', { settleMs: 1400 })
  for (let attempt = 0; attempt < 200; attempt++) { if (await page.eval(() => !!window.twoFactorHarness?.pending.length)) break; if (attempt === 199) throw Error(page.consoleErrors.join('\n')); await sleep(100) }
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(80); return result }
  const last = kind => page.eval(kind => window.twoFactorHarness.pending.findLastIndex(item => item.kind === kind), kind)
  const accept = (index, data) => run(({ index, data }) => window.twoFactorHarness.pending[index].resolve(data), { index, data })
  const reject = index => run(index => window.twoFactorHarness.pending[index].reject(Error('fixture operation unavailable')), index)
  await accept(await last('status'), { enabled: false })
  await run(() => { const v = window.twoFactorHarness.view(); void v.startSetup(); void v.startSetup() })
  assert.equal(await page.eval(() => window.twoFactorHarness.pending.filter(item => item.kind === 'setup').length), 1, 'setup function rejects immediate duplicate requests')
  await reject(await last('setup'))
  const prepare = action => run(action => {
    const v = window.twoFactorHarness.view(); v.setupMode = action === 'enable'; v.disableMode = action === 'disable'; v.regenerateMode = action === 'regenerate'; v.enabled = ['disable', 'regenerate'].includes(action)
    v.verifyCode = '123456'; v.disableCode = '123456'; v.regenerateCode = '123456'; v.disablePassword = 'fixture unusable password'; v.regeneratePassword = 'fixture unusable password'
  }, action)
  const methods = { setup: 'startSetup', enable: 'confirmEnable', disable: 'confirmDisable', regenerate: 'confirmRegenerate' }
  for (const [action, method] of Object.entries(methods)) {
    await prepare(action); await run(method => { void window.twoFactorHarness.view()[method]() }, method)
    const index = await last(action), before = await page.eval(() => window.twoFactorHarness.pending.length)
    await run(async () => { const v = window.twoFactorHarness.view(); void v.startSetup(); void v.confirmEnable(); void v.confirmDisable(); void v.confirmRegenerate(); v.cancelSetup(); v.cancelDisable(); v.cancelRegenerate(); if (v.openDisable) v.openDisable(); if (v.openRegenerate) v.openRegenerate() })
    assert.equal(await page.eval(() => window.twoFactorHarness.pending.length), before, `${action} blocks all other mutations immediately`)
    assert.equal(await page.eval(() => window.twoFactorHarness.view().loading), true)
    if (action !== 'setup') {
      assert.equal(await page.eval(action => window.twoFactorHarness.view()[{ enable: 'setupMode', disable: 'disableMode', regenerate: 'regenerateMode' }[action]], action), true)
      assert.equal(await page.eval(() => [...document.querySelectorAll('input')].every(el => el.disabled)), true, 'saving freezes verification/password inputs')
      assert.equal(await page.eval(() => [...document.querySelectorAll('button')].every(el => el.disabled)), true, 'saving freezes cancel and submit controls')
    }
    await reject(index); assert.equal(await page.eval(() => window.twoFactorHarness.view().loading), false); assert.match(await page.eval(() => window.twoFactorHarness.view().error), /fixture operation unavailable/)
    await run(method => { void window.twoFactorHarness.view()[method]() }, method)
    const response = action === 'setup' ? { secret: 'fixture setup text', qrCode, recoveryCodes } : action === 'regenerate' ? { recoveryCodes } : { message: 'fixture success' }
    await accept(await last(action), response)
    if (action === 'regenerate') await accept(await last('codes-status'), { total: 8, remaining: 8, used: 0 })
    assert.equal(await page.eval(() => window.twoFactorHarness.view().loading), false)
  }
  for (const [locale, width, dark] of [['zh-CN', 1440, false], ['zh-TW', 768, false], ['en', 390, true]]) {
    await prepare('disable'); await run(() => { void window.twoFactorHarness.view().confirmDisable() }); await reject(await last('disable'))
    await run(({ locale, dark }) => { const h = window.twoFactorHarness; h.setLocale(locale); h.theme.setTheme(dark ? 'dark' : 'light') }, { locale, dark })
    await page.setViewport({ width, height: 900, mobile: width === 390 }); await sleep(300)
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: resolve(output, `${locale}-${width}.png`), format: 'png' })
  }
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log('PASS actual two-factor setup/enable/disable/regenerate immediate duplicate and cross-mutation busy gates, cancellation/fields protection and retry')
} finally { if (browser) await browser.close(); await server.close() }
