import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { Browser, sleep } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'
import { probe } from '../.agents/skills/design-taste-frontend/scripts/lib/probe.mjs'
import { judge, APP_SKIP } from '../.agents/skills/design-taste-frontend/scripts/lib/rules.mjs'
const root = fileURLToPath(new URL('..', import.meta.url)).replaceAll('\\', '/')
const require = createRequire(new URL('../client/package.json', import.meta.url))
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href)
const { default: vue } = await import(pathToFileURL(require.resolve('@vitejs/plugin-vue')).href)
const output = resolve(root, 'logs/two-factor-verification')
mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js')
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/two-factor/*.js']
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/two-factor',
  publicDir: root + '/client/public', plugins: [vue()], resolve: { alias: [
    { find: /^@\/api$/, replacement: root + '/scripts/fixtures/two-factor/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19760, strictPort: true, fs: { allow: [root] } } })
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19760', { settleMs: 1400 })
  for (let i = 0; !await page.eval(() => !!window.twoFactorHarness?.view()) ; i++) { assert.ok(i < 200, page.consoleErrors.join('\n')); await sleep(100) }
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(80); return result }
  const read = key => page.eval(key => JSON.parse(JSON.stringify(window.twoFactorHarness.view()[key])), key)
  const count = () => page.eval(() => window.twoFactorHarness.pending.filter(x => x.kind === 'disable').length)
  const accept = (kind, data) => run(({ kind, data }) => window.twoFactorHarness.pending.findLast(x => x.kind === kind).resolve(data), { kind, data })
  const requireVerification = () => run(() => window.twoFactorHarness.pending.findLast(x => x.kind === 'disable').reject({ code: 'VERIFICATION_REQUIRED' }))
  const prepare = async () => {
    await run(() => { const h = window.twoFactorHarness; h.state.mounted = true; h.state.active = true; h.auth.user = { id: 1, username: 'fixture', role: 'user' }; h.session('a'); h.view().closeDisableVerification(); void h.view().loadStatus() })
    await accept('status', { enabled: true }); await accept('codes-status', { total: 8, remaining: 8, used: 0 })
    await run(() => { const v = window.twoFactorHarness.view(); v.openDisable(); v.disablePassword = 'fixture-fixed-password'; v.disableCode = '123456'; void v.confirmDisable() })
    await requireVerification(); assert.equal(await read('showVerificationModal'), true)
  }
  const request = async (extra = {}) => {
    await run(() => { void window.twoFactorHarness.verification().requestCode() })
    assert.deepEqual(await page.eval(() => window.twoFactorHarness.pending.findLast(x => x.kind === 'verification-request').data), { operationType: 'disable_2fa' })
    await accept('verification-request', { success: true, required: true, channel: 'email', maskedTarget: 'fi***@example.test', expiresIn: 600, ...extra })
  }
  await prepare(); await request({ alreadySent: true, resendAfter: 30 })
  const countdown = await page.eval(() => window.twoFactorHarness.verification().countdown)
  assert.ok(countdown <= 30 && countdown >= 29, 'existing-code response uses actual remaining resend cooldown')
  const requestCount = await page.eval(() => window.twoFactorHarness.pending.filter(x => x.kind === 'verification-request').length)
  await run(() => { void window.twoFactorHarness.verification().requestCode() })
  assert.equal(await page.eval(() => window.twoFactorHarness.pending.filter(x => x.kind === 'verification-request').length), requestCount)
  assert.equal(await page.eval(() => window.twoFactorHarness.toast.toasts.value.at(-1).message), '验证码已发送，请查收邮箱')
  console.log('PASS existing-code response uses remaining cooldown, blocks resend and does not claim a fresh delivery')
  const startVerify = () => run(() => { const v = window.twoFactorHarness.verification(); v.verificationCode = '012345'; void v.verify() })
  await prepare(); const before = await count()
  await run(() => { const v = window.twoFactorHarness.view(); void v.confirmDisable(); void v.confirmEnable(); void v.confirmRegenerate(); void v.startSetup(); v.cancelDisable() })
  assert.equal(await count(), before); assert.equal(await read('disableMode'), true)
  assert.equal(await page.eval(() => [...document.querySelectorAll('main input, main button')].every(x => x.disabled)), true)
  await request(); await startVerify(); await accept('verification-verify', { success: true, verified: false })
  assert.equal(await count(), before, 'invalid verification cannot retry disable')
  await startVerify(); await accept('verification-verify', { success: true, verified: true })
  assert.equal(await count(), before + 1)
  assert.deepEqual(await page.eval(() => window.twoFactorHarness.pending.findLast(x => x.kind === 'disable').data), { password: 'fixture-fixed-password', code: '123456' })
  await run(() => { void window.twoFactorHarness.view().onDisableVerified() }); assert.equal(await count(), before + 1, 'duplicate emitted callback cannot resubmit')
  await accept('disable', { message: '2FA disabled' })
  assert.equal(await read('enabled'), false); assert.equal(await read('disablePassword'), ''); assert.equal(await read('disableCode'), '')
  // Both pending sends and pending verifications are fenced by draft, session, role, account, cache and unmount.
  for (const phase of ['request', 'verify']) for (const change of ['draft', 'session', 'account', 'role', 'cache', 'unmount', 'close']) {
    await prepare()
    if (phase === 'verify') { await request(); await startVerify() }
    else await run(() => { void window.twoFactorHarness.verification().requestCode() })
    const old = await page.eval(phase => window.twoFactorHarness.pending.findLastIndex(x => x.kind === (phase === 'verify' ? 'verification-verify' : 'verification-request')), phase)
    const currentCount = await count()
    await run(change => {
      const h = window.twoFactorHarness, v = h.view()
      if (change === 'draft') { v.disablePassword = 'replacement'; v.disablePassword = 'fixture-fixed-password' }
      if (change === 'session') { h.session('b'); h.session('a') }
      if (change === 'account') h.auth.user = { id: 2, username: 'other', role: 'user' }
      if (change === 'role') h.auth.user = { ...h.auth.user, role: 'admin' }
      if (change === 'cache') h.state.active = false
      if (change === 'unmount') h.state.mounted = false
      if (change === 'close') h.verification().close()
    }, change)
    await run(({ old, phase }) => window.twoFactorHarness.pending[old].resolve(phase === 'verify' ? { verified: true, success: true } : { success: true, required: true, channel: 'email', expiresIn: 600 }), { old, phase })
    await run(() => { void window.twoFactorHarness.view().onDisableVerified() })
    assert.equal(await count(), currentCount, `${phase}/${change} must not retry a stale disable`)
    assert.equal(await read('showVerificationModal'), false)
    if (change === 'close') { assert.equal(await read('disablePassword'), ''); assert.equal(await read('disableCode'), '') }
  }
  for (const invalid of [null, {}, { message: ' ' }]) {
    await prepare(); await run(() => { void window.twoFactorHarness.view().onDisableVerified() }); await accept('disable', invalid)
    assert.equal(await read('enabled'), true); assert.ok(await read('error')); assert.equal(await read('loading'), false)
  }
  await prepare(); await run(() => { void window.twoFactorHarness.view().onDisableVerified() }); await requireVerification()
  assert.equal(await read('showVerificationModal'), false, 'failed retry does not loop verification indefinitely')
  await page.send('Animation.enable')
  await page.send('Animation.setPlaybackRate', { playbackRate: 0 })
  for (const motion of ['reduce', 'no-preference']) for (const dark of [false, true]) for (const locale of ['zh-CN', 'zh-TW', 'en']) for (const width of [1440, 768, 390]) {
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: motion }] })
    await run(dark => window.twoFactorHarness.theme.setTheme(dark ? 'dark' : 'light'), dark)
    await prepare(); await run(locale => window.twoFactorHarness.setLocale(locale), locale)
    await page.setViewport({ width, height: 1000, mobile: width === 390 })
    assert.equal(await page.eval(() => [...document.querySelectorAll('[role="dialog"] button')].every(button => button.getBoundingClientRect().height >= 44)), true, 'touch geometry remains at least 44px while entrance animation is frozen')
    assert.equal(await page.eval(() => document.querySelector('[role="dialog"]').contains(document.activeElement)), true)
    await run(() => [...document.querySelectorAll('[role="dialog"] button:not(:disabled)')].at(-1).focus())
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
    assert.equal(await page.eval(() => document.activeElement === document.querySelector('[role="dialog"] button')), true, 'Tab wraps inside dialog')
    await request(); await sleep(150)
    assert.equal(await page.eval(() => document.querySelectorAll('[role="dialog"]').length), 1, 'only the current verification dialog remains')
    assert.equal(await page.eval(() => { const style = getComputedStyle(document.querySelector('[role="dialog"]')); return style.animationName === 'none' && style.transform === 'none' && !style.backgroundImage.includes('gradient') && style.backdropFilter === 'none' }), true)
    assert.equal(await page.eval(() => /profile\.|sensitiveVerification\./.test(document.querySelector('.modal-content').textContent)), false)
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
    if (motion === 'reduce') {
      await page.screenshot({ path: resolve(output, `${locale}-${width}-${dark ? 'dark' : 'light'}.png`) })
      // The modal is the edited surface; its background settings screen is a separate review scope.
      await page.eval(() => { window.inspectionBackground = document.querySelector('main'); window.inspectionBackground.remove() })
      const metrics = await page.eval(probe)
      const findings = judge(metrics, { width }).filter(finding => !APP_SKIP.has(finding.id))
      writeFileSync(resolve(output, `${locale}-${width}-${dark ? 'dark' : 'light'}-inspect.json`), JSON.stringify({ metrics, findings }, null, 2))
      await page.eval(() => { document.querySelector('#app').append(window.inspectionBackground); delete window.inspectionBackground })
      assert.deepEqual(findings.filter(finding => finding.level === 'FAIL'), [], 'edited verification dialog passes taste checks')
    }
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    assert.equal(await read('showVerificationModal'), false)
    assert.equal(await page.eval(() => document.querySelectorAll('[role="dialog"]').length), 0, 'closing clears the dialog even when browser animations are paused')
    assert.equal(await read('disablePassword'), '')
  }
  assert.deepEqual(page.consoleErrors, [])
  console.log('PASS actual 2FA disable verification modal, fixed retry, duplicate and invalid grants, 14 late child contexts, cancellation clears secrets, invalid retry receipts, 36 frozen-animation locale/width/theme/motion groups with touch, Tab and Escape. Controlled API; external delivery not validated.')
  if (process.argv.includes('--serve')) {
    await page.send('Animation.setPlaybackRate', { playbackRate: 1 })
    await prepare(); await request()
    console.log('Serving isolated 2FA verification fixture at http://127.0.0.1:19760')
    await new Promise(() => {})
  }
} finally { if (browser) await browser.close(); await server.close() }
