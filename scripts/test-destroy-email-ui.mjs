import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Browser, sleep } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'
const root = fileURLToPath(new URL('..', import.meta.url)).replaceAll('\\', '/')
const require = createRequire(new URL('../client/package.json', import.meta.url))
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href)
const { default: vue } = await import(pathToFileURL(require.resolve('@vitejs/plugin-vue')).href)
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js')
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/destroy-email/*.js']
const output = resolve(root, 'logs/destroy-email-ui'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const server = await createServer({ configFile: false, root: root + '/scripts/fixtures/destroy-email', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/destroy-email/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19651, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(70); return result }
  const fresh = async query => {
    await page.goto('http://127.0.0.1:19651' + (query || ''), { settleMs: 800 })
    const deadline = Date.now() + 15000
    while (!await page.eval(() => !!window.destroyHarness?.view())) {
      if (Date.now() > deadline) throw Error('Fixture did not mount: ' + page.consoleErrors.join('\n'))
      await sleep(100)
    }
  }
  const invokeSend = () => run(() => { void document.querySelector('[data-destroy-email]').__vueParentComponent.setupState.send() })
  const settle = (data, fail = false) => run(({ data, fail }) => {
    const item = window.destroyHarness.pending.at(-1); fail ? item.reject(Object.assign(new Error('Isolated delivery unavailable; submit a support ticket'), { code: 'SEND_FAILED' })) : item.resolve(data)
  }, { data, fail })
  const receipt = { success: true, channel: 'email', maskedTarget: 'is***@example.test', resendAfter: 60 }
  let copyCases = 0
  for (const [locale, width] of [['zh-CN', 1440], ['zh-TW', 768], ['en', 390]]) {
    for (const isFreeInstance of [false, true]) for (const isFirstTime of [true, false]) {
      await fresh(`?detail&locale=${locale}${isFreeInstance ? '' : '&paid'}${isFirstTime ? '&first' : ''}`)
      await page.setViewport({ width, height: 900, mobile: width === 390 })
      await run(() => { void window.destroyHarness.view().handleErrorDestroy() })
      const warning = await page.eval(() => document.querySelector('[role="dialog"] .text-red-700').textContent.trim())
      assert.match(warning, /无退款|無退款|no refund/, 'first/subsequent and free/paid confirmations all state no refund')
      assert.doesNotMatch(await page.eval(() => document.querySelector('[role="dialog"]').textContent), /全额退款|全額退款|full refund/i)
      await run(() => { const d = window.destroyHarness.dialog(); d.emailCode = '654321'; d.handleDestroy() })
      assert.deepEqual(await page.eval(() => JSON.parse(JSON.stringify(window.destroyHarness.pending.at(-1).data))), { id: 1, emailCode: '654321' })
      await settle({ success: true, isFreeInstance, isFirstTime, refundAmount: 0, feeAmount: 0 })
      const messages = await page.eval(() => window.destroyHarness.toast.toasts.value.filter(item => item.type === 'success').map(item => item.message))
      assert.deepEqual(messages, [{ 'zh-CN': '实例已销毁', 'zh-TW': '實例已銷毀', en: 'Instance destroyed' }[locale]], 'zero-refund deletion must never announce a refund')
      assert.equal(await page.eval(() => window.destroyHarness.router.currentRoute.value.path), '/instances')
      assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
      if (!isFreeInstance && isFirstTime) await page.screenshot({ path: resolve(output, `r278-${locale}-${width}.png`), format: 'png' })
      copyCases++
    }
  }
  console.log(`PASS R278 ${copyCases} first/subsequent free/paid confirmations and real detail success messages in three languages/widths`)
  if (!process.argv.includes('--copy-only')) {
  await fresh(); await run(() => window.destroyHarness.view().handleDestroy())
  assert.equal(await page.eval(() => window.destroyHarness.state.destroyed.length), 0, 'empty email code cannot destroy')
  assert.equal(await page.eval(() => document.querySelectorAll('[role="dialog"] input').length), 1, 'only email code input remains')
  assert.ok(await page.eval(() => document.querySelector('[role="dialog"] table').textContent.includes('大阪 / Osaka')))
  await invokeSend(); await invokeSend(); assert.equal(await page.eval(() => window.destroyHarness.pending.length), 1, 'immediate duplicate email send gate')
  await settle(null, true); assert.ok(await page.eval(() => document.querySelector('[data-destroy-email] [role="alert"]')?.textContent))
  await invokeSend(); await settle(receipt)
  assert.ok(await page.eval(() => document.querySelector('[data-destroy-email] [role="status"]')?.textContent.includes('is***@')))
  await invokeSend(); assert.equal(await page.eval(() => window.destroyHarness.pending.length), 2, 'cooldown blocks resend')
  for (const code of ['', 'abcdef', '12345', '1234567']) {
    await run(code => { const v = window.destroyHarness.view(); v.emailCode = code; v.handleDestroy() }, code)
    assert.equal(await page.eval(() => window.destroyHarness.state.destroyed.length), 0, 'invalid code rejects function action')
  }
  await run(() => { const v = window.destroyHarness.view(); v.emailCode = '654321'; v.handleDestroy() })
  assert.deepEqual(await page.eval(() => JSON.parse(JSON.stringify(window.destroyHarness.state.destroyed))), ['654321'], 'emit exact code with approved target')
  await run(() => { window.destroyHarness.state.loading = true })
  await run(() => { window.destroyHarness.view().handleDestroy(); window.destroyHarness.view().close() })
  assert.equal(await page.eval(() => window.destroyHarness.state.visible), true)
  assert.equal(await page.eval(() => window.destroyHarness.state.destroyed.length), 1)
  let stale = 0
  for (const change of ['target', 'session', 'email', 'close']) for (const fail of [false, true]) {
    await fresh(); await invokeSend()
    await run(change => {
      const h = window.destroyHarness
      if (change === 'target') h.state.info = { ...h.state.info, instance: { ...h.state.info.instance, id: 2, name: 'Sydney server' } }
      if (change === 'session') h.session('b')
      if (change === 'email') h.auth.user.email = 'changed@example.test'
      if (change === 'close') h.state.visible = false
    }, change)
    await settle(receipt, fail)
    assert.equal(await page.eval(() => document.querySelector('[data-destroy-email] [role="status"]') !== null), false)
    assert.equal(await page.eval(() => document.querySelector('[data-destroy-email] [role="alert"]') !== null), false)
    stale++
  }
  await fresh(); await run(() => { window.destroyHarness.auth.user.email = null }); await invokeSend()
  assert.equal(await page.eval(() => window.destroyHarness.pending.length), 0, 'missing email never sends')
  await fresh(); await run(() => { window.destroyHarness.state.visible = false })
  await run(() => { document.querySelector('#opener').focus(); document.querySelector('#opener').click() })
  assert.equal(await page.eval(() => document.querySelector('[role="dialog"]').contains(document.activeElement)), true)
  await run(() => { const buttons = document.querySelectorAll('[role="dialog"] button:not(:disabled)'); buttons[buttons.length - 1].focus(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })) })
  assert.equal(await page.eval(() => document.querySelector('[role="dialog"]').contains(document.activeElement)), true)
  await run(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })) })
  assert.equal(await page.eval(() => document.activeElement.id), 'opener', 'Escape closes and restores opener focus')
  for (const name of ['客户的很长实例名称'.repeat(10), 'LongInstanceNameWithoutSpaces'.repeat(8), '1234567890'.repeat(10)]) {
    await fresh(); await page.setViewport({ width: 390, height: 900, mobile: true })
    await run(name => { const h = window.destroyHarness; h.state.info = { ...h.state.info, instance: { ...h.state.info.instance, name } } }, name)
    assert.ok(await page.eval(name => document.querySelector('[role="dialog"] tbody td').textContent.includes(name), name), 'long name is fully retained')
    assert.equal(await page.eval(() => {
      const dialog = document.querySelector('[role="dialog"]'), table = dialog.querySelector('table')
      return dialog.scrollWidth <= dialog.clientWidth && table.scrollWidth <= table.clientWidth && document.documentElement.scrollWidth <= innerWidth
    }), true, 'long Chinese and unbroken English names wrap without widening the mobile dialog')
    await page.screenshot({ path: resolve(output, name.startsWith('客户') ? 'long-name-chinese.png' : /^\d/.test(name) ? 'long-name-numeric.png' : 'long-name-english.png'), format: 'png' })
  }
  for (const [locale, width, dark] of [['zh-CN', 1440, false], ['zh-TW', 768, true], ['en', 390, false]]) {
    await fresh(); await page.setViewport({ width, height: 900, mobile: width === 390 })
    await run(({ locale, dark }) => { window.destroyHarness.setLocale(locale); window.destroyHarness.theme.setTheme(dark ? 'dark' : 'light') }, { locale, dark })
    const numberLabel = await page.eval(() => document.querySelector('[role="dialog"] tbody td span').textContent.trim())
    assert.equal(numberLabel, { 'zh-CN': '实例编号：1', 'zh-TW': '實例編號：1', en: 'Instance ID: 1' }[locale], 'identify the instance record explicitly in each language')
    await invokeSend(); await settle(null, true)
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: resolve(output, `${locale}-${width}.png`), format: 'png' })
  }
  await fresh('?wallet'); await run(() => window.destroyHarness.view().openRechargeModal())
  for (const locale of ['zh-CN', 'zh-TW', 'en']) {
    await run(locale => window.destroyHarness.setLocale(locale), locale)
    const notice = await page.eval(() => document.querySelector('label[for="agree-recharge-notice"]').textContent)
    assert.ok(notice.includes('PUSH')); assert.ok(/不退款|no.*refund|does not issue a refund/.test(notice)); assert.equal(/PUSH.*免费|PUSH.*免費|PUSH is free/.test(notice), false)
    assert.equal(await page.eval(() => document.querySelector('.modal-footer .btn-primary').disabled), true)
    await run(() => { for (const id of ['agree-no-refund', 'agree-recharge-notice', 'agree-terms-recharge']) document.getElementById(id)?.click() })
    await run(() => { const v = window.destroyHarness.view(); v.agreedToNoRefund = true; v.agreedToRechargeNotice = true; v.agreedToTerms = true })
    assert.equal(await page.eval(() => document.querySelector('.modal-footer .btn-primary').disabled), false)
    await run(() => { window.destroyHarness.view().agreedToRechargeNotice = false })
  }
  assert.equal(await page.eval(() => window.destroyHarness.pending.filter(item => item.kind === 'recharge').length), 0, 'copy validation creates no recharge orders')
  await fresh('?detail')
  await run(() => { void window.destroyHarness.view().handleErrorDestroy() })
  assert.ok(await page.eval(() => !!window.destroyHarness.dialog()), 'error destroy opens the actual email dialog')
  assert.equal(await page.eval(() => window.destroyHarness.pending.length), 0, 'error shortcut cannot send a direct destroy')
  await run(() => window.destroyHarness.dialog().handleDestroy())
  assert.equal(await page.eval(() => window.destroyHarness.pending.length), 0, 'actual detail remains gated without email code')
  await invokeSend(); await settle(receipt)
  await run(() => { const d = window.destroyHarness.dialog(); d.emailCode = '654321'; d.handleDestroy(); d.handleDestroy() })
  assert.equal(await page.eval(() => window.destroyHarness.pending.filter(item => item.kind === 'destroy').length), 1, 'detail rejects immediate duplicate submissions')
  assert.deepEqual(await page.eval(() => JSON.parse(JSON.stringify(window.destroyHarness.pending.at(-1).data))), { id: 1, emailCode: '654321' })
  await settle(null, true)
  assert.ok(await page.eval(() => window.destroyHarness.view().destroyError), 'detail failure persists in the dialog')
  await run(() => { window.destroyHarness.dialog().handleDestroy() })
  await settle({ success: true, isFreeInstance: true, refundAmount: 0 })
  assert.equal(await page.eval(() => window.destroyHarness.router.currentRoute.value.path), '/instances')
  for (const change of ['target', 'session']) for (const fail of [false, true]) {
    await fresh('?detail'); await run(() => { void window.destroyHarness.view().handleErrorDestroy() })
    await run(() => { const d = window.destroyHarness.dialog(); d.emailCode = '654321'; d.handleDestroy() })
    await run(change => change === 'target' ? window.destroyHarness.router.push('/instances/2') : window.destroyHarness.session('b'), change)
    await settle({ success: true, isFreeInstance: true, refundAmount: 0 }, fail)
    assert.equal(await page.eval(() => window.destroyHarness.router.currentRoute.value.path), change === 'target' ? '/instances/2' : '/instances/1')
    assert.equal(await page.eval(() => window.destroyHarness.view().destroyError), '', 'obsolete destruction result cannot set current error')
  }
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log(`PASS actual destroy dialog: mandatory code/busy/send/retry/cooldown/missing email, ${stale} late email replies, keyboard focus, three widths/languages; actual Detail error shortcut, exact payload, duplicate/retry and four stale writes; Wallet copy and checkbox gates with zero recharge requests`)
  if (process.env.REVIEW_TASTE_INSPECT === '1') {
    const exec = promisify(execFile)
    // This is a real floating dialog: the backdrop intentionally covers the
    // underlying page and the capped dialog keeps equal margins on wide screens.
    const result = await exec(process.execPath, [root + '/.agents/skills/design-taste-frontend/scripts/inspect.mjs', 'http://127.0.0.1:19651/?inspect', '--app', '--allow', 'heavy-shadow,covered-text,hero-void,unused-canvas', '--out', output + '/taste'], { cwd: root, windowsHide: true, maxBuffer: 2 * 1024 * 1024 })
    console.log(result.stdout)
    const report = JSON.parse(readFileSync(output + '/taste/report.json', 'utf8'))
    assert.equal(report.findings.filter(item => item.level === 'FAIL').length, 0)
    const dark = await exec(process.execPath, [root + '/.agents/skills/design-taste-frontend/scripts/inspect.mjs', 'http://127.0.0.1:19651/?inspect&dark', '--app', '--allow', 'heavy-shadow,covered-text,hero-void,unused-canvas', '--out', output + '/taste-dark'], { cwd: root, windowsHide: true, maxBuffer: 2 * 1024 * 1024 })
    console.log(dark.stdout)
    const darkReport = JSON.parse(readFileSync(output + '/taste-dark/report.json', 'utf8'))
    assert.equal(darkReport.findings.filter(item => item.level === 'FAIL').length, 0)
  }
  }
} finally { if (browser) await browser.close(); await server.close() }
