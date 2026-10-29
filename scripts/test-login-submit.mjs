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
tailwind.content = [root + '/client/src/**/*.{vue,ts,js}', root + '/scripts/fixtures/login-submit/*.js']
const output = resolve(root, 'logs/login-submit'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const server = await createServer({ configFile: false, root: root + '/scripts/fixtures/login-submit', publicDir: root + '/client/public', plugins: [vue()], resolve: {
  alias: [{ find: /^@\/api(?:\/admin)?$/, replacement: root + '/scripts/fixtures/login-submit/api.js' }, { find: '@/components/TurnstileWidget.vue', replacement: root + '/scripts/fixtures/login-submit/TurnstileFixture.vue' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-router', 'vue-i18n'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-router', 'vue-i18n'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } }, server: { host: '127.0.0.1', port: 19649, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(40); return result }
  const check = async (fn, message) => { for (let i = 0; i < 100; i++) { if (await page.eval(fn)) return; await sleep(50) } assert.fail(message) }
  const latest = kind => page.eval(kind => window.loginHarness.pending.findLastIndex(item => item.kind === kind), kind)
  const settle = (index, data, fail = false) => run(({ index, data, fail }) => { const item = window.loginHarness.pending[index]; fail ? item.reject(new Error('Isolated login failure')) : item.resolve(data) }, { index, data, fail })
  const fresh = async admin => { await page.goto('http://127.0.0.1:19649' + (admin ? '?admin' : ''), { settleMs: 250 }); await check(() => !!window.loginHarness?.view(), 'actual login view available'); await run(() => { const v = window.loginHarness.view(); v.username = 'isolated'; v.password = 'fixture-password' }) }
  const submit = () => run(() => { void window.loginHarness.view().handleLogin() })
  for (const admin of [false, true]) {
    await fresh(admin); await run(() => { const v = window.loginHarness.view(); void v.handleLogin(); void v.handleLogin() })
    assert.equal(await page.eval(() => window.loginHarness.pending.filter(item => item.kind === 'login').length), 1, (admin ? 'admin' : 'user') + ' duplicate login gate')
    await run(() => { void window.loginHarness.view().loginWithDemoAccount() })
    assert.equal(await page.eval(() => window.loginHarness.view().username), 'isolated', 'demo action cannot overwrite active login input')
    assert.equal(await page.eval(() => window.loginHarness.pending.filter(item => item.kind === 'login').length), 1)
    const currentUrl = await page.eval(() => location.href)
    await run(() => { void window.loginHarness.view().loginWithOAuth('github') })
    assert.equal(await page.eval(() => location.href), currentUrl, 'OAuth cannot navigate during active login')
    await settle(await latest('login'), null, true); assert.equal(await page.eval(() => window.loginHarness.view().loading), false)
    await submit(); assert.equal(await page.eval(() => window.loginHarness.pending.filter(item => item.kind === 'login').length), 2)
    await settle(await latest('login'), { token: 'isolated-test-token', user: { id: 1, username: 'isolated', role: admin ? 'admin' : 'user' } })
    const target = admin ? '/admin/users' : '/dashboard'
    await check(() => ['/admin/users', '/dashboard'].includes(window.loginHarness.router.currentRoute.value.path), 'current login navigates to console')
    assert.equal(await page.eval(() => window.loginHarness.router.currentRoute.value.path), target)
    await fresh(admin); await run(() => { const v = window.loginHarness.view(); v.password = ''; void v.handleLogin() }); assert.equal(await page.eval(() => window.loginHarness.pending.length), 0, 'missing credentials do not submit')
    await fresh(admin); await run(() => { const v = window.loginHarness.view(); v.turnstileEnabled = true; v.turnstileSiteKey = 'fixture'; v.turnstileToken = ''; void v.handleLogin() }); assert.equal(await page.eval(() => window.loginHarness.pending.length), 0, 'required challenge missing does not submit')
    for (const recovery of [false, true]) {
      await fresh(admin); await run(recovery => { const v = window.loginHarness.view(); v.totpCode = '123456'; v.recoveryCode = 'FIXTURECODE'; v.useRecoveryCode = recovery; void v.handleLogin() }, recovery)
      const data = await page.eval(() => window.loginHarness.pending[0].data)
      assert.equal(data.totpCode, recovery ? undefined : '123456'); assert.equal(data.recoveryCode, recovery ? 'FIXTURECODE' : undefined)
    }
  }
  for (const [locale, width, admin] of [['zh-CN', 1440, false], ['zh-TW', 768, true], ['en', 390, false]]) {
    await fresh(admin); await run(locale => window.loginHarness.setLocale(locale), locale); await submit(); await settle(await latest('login'), null, true)
    await page.setViewport({ width, height: 1000, mobile: width === 390 }); await sleep(120); await page.screenshot({ path: resolve(output, locale + '-' + width + '.png'), format: 'png' })
  }
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log('PASS actual user/admin login duplicate/demo busy gates, failure retry, current console routing and credential/challenge validation; deferred API, no real sessions')
} finally { if (browser) await browser.close(); await server.close() }
