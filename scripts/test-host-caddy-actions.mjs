import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { Browser, sleep } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'
import { status, sites } from './fixtures/host-caddy/data.js'
const root = fileURLToPath(new URL('..', import.meta.url)).replaceAll('\\', '/'), require = createRequire(new URL('../client/package.json', import.meta.url))
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href), { default: vue } = await import(pathToFileURL(require.resolve('@vitejs/plugin-vue')).href)
const output = resolve(root, 'logs/host-caddy-actions'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js'); tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/host-caddy/*.js']
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/host-caddy', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/host-caddy/api.js' }, { find: '@', replacement: root + '/client/src' }, ...['vue', 'pinia', 'vue-i18n'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } }, server: { host: '127.0.0.1', port: 19746, strictPort: true, fs: { allow: [root] } }
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  if (process.argv.includes('--inspect-only')) { console.log('Caddy actions inspector ready http://127.0.0.1:19746/?inspect&modal'); await new Promise(() => {}) }
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(40); return result }
  const fresh = async () => {
    await page.goto('http://127.0.0.1:19746', { settleMs: 250 }); const deadline = Date.now() + 15000
    while (!await page.eval(() => !!window.hostCaddyHarness?.view())) { if (Date.now() > deadline) throw Error('Host Caddy fixture did not mount'); await sleep(70) }
  }
  const settle = (index, result, fail = false) => run(({ index, result, fail }) => { const p = window.hostCaddyHarness.pending[index]; fail ? p.reject(Error('测试Caddy读取失败')) : p.resolve(result) }, { index, result, fail })
  const credentials = (kind = 'generate') => ({ installCommand: 'echo fixture-display-only-command', username: 'fixture-display-only', password: 'fixture-display-only', port: 8444, ...(kind === 'generate' ? { isNewCredentials: false } : {}) })
  const result = kind => kind === 'test' ? { connected: true, sitesCount: 8, dnsRecordType: 'A', dnsRecordValue: '192.0.2.11' } : kind === 'confirm' ? { message: 'Fixture confirmed' } : credentials(kind)
  const methods = { generate: 'generateInstallCommand', reset: 'resetCredentials', confirm: 'confirmInstallation', test: 'testConnection' }
  const initialize = async (kind = 'test') => {
    await fresh(); await settle(0, status()); await settle(1, sites())
    await run(() => { window.confirm = () => true })
    if (kind === 'confirm') await run(value => { const v = window.hostCaddyHarness.view(); v.installInfo = { command: value.installCommand, username: value.username, password: value.password, port: value.port }; v.showInstallModal = true }, credentials())
  }
  const launch = kind => run(method => { void window.hostCaddyHarness.view()[method]() }, methods[kind])
  const snapshot = () => page.eval(() => JSON.stringify({ info: { ...oldCaddy.installInfo }, modal: oldCaddy.showInstallModal, error: oldCaddy.actionError,
    test: { ...oldCaddy.testResult }, status: { ...oldCaddy.caddyStatus }, sites: [...oldCaddy.sites], toasts: window.hostCaddyHarness.toast.toasts.value.map(t => t.message) }))
  for (const kind of Object.keys(methods)) {
    await initialize(kind); await launch(kind)
    const count = await page.eval(() => window.hostCaddyHarness.pending.length)
    await run(() => { const v = window.hostCaddyHarness.view(); void v.generateInstallCommand(); void v.resetCredentials(); void v.confirmInstallation(); void v.testConnection(); void v.loadCaddyStatus(); void v.loadSites(); v.closeInstallModal() })
    assert.equal(await page.eval(() => window.hostCaddyHarness.pending.length), count, 'all four operations and current reads share one pending gate')
    assert.equal(await page.eval(() => window.hostCaddyHarness.pending.at(-1).id), 11)
    await settle(2, result(kind))
    if (kind !== 'test') { await settle(3, status()); await settle(4, sites()) }
    assert.equal(await page.eval(() => window.hostCaddyHarness.view().actionBusy), false)
  }
  console.log('PASS duplicate/cross-operation/current-read gates and valid four receipts')
  let checked = 0
  for (const kind of Object.keys(methods)) for (const mode of ['host', 'host-aba', 'account', 'sid', 'role', 'logout', 'session-aba', 'cache', 'unmount']) for (const fail of [false, true]) {
    await initialize(kind); await run(() => { window.oldCaddy = window.hostCaddyHarness.view() }); await launch(kind)
    await run(mode => { const h = window.hostCaddyHarness
      if (mode === 'host' || mode === 'host-aba') h.host.value = { ...h.host.value, id: 12 }
      if (mode === 'account') h.session(2)
      if (mode === 'sid') h.session(1, 'other-caddy-session')
      if (mode === 'role') h.session(1, 'host-caddy-session', 'user')
      if (mode === 'logout') h.auth.clearLocalAuth()
      if (mode === 'session-aba') { h.session(2); h.session(1) }
      if (mode === 'cache') h.active.value = false
      if (mode === 'unmount') h.mounted.value = false
    }, mode)
    if (mode === 'host-aba') await run(() => { const h = window.hostCaddyHarness; h.host.value = { ...h.host.value, id: 11 } })
    const before = await snapshot(), count = await page.eval(() => window.hostCaddyHarness.pending.length)
    await settle(2, result(kind), fail)
    assert.equal(await snapshot(), before, `${kind}/${mode} never updates current data, credentials or toasts`)
    assert.equal(await page.eval(() => window.hostCaddyHarness.pending.length), count, 'obsolete operations never request a current refresh')
    assert.equal(await page.eval(() => oldCaddy.actionBusy), false, 'settled obsolete operation releases its lock')
    checked++
  }
  console.log(`PASS ${checked} obsolete operation host/account/session/ABA/cache/unmount success and failure receipts`)
  for (const kind of Object.keys(methods)) {
    await initialize(kind); await launch(kind)
    await run(() => { window.hostCaddyHarness.active.value = false }); await run(() => { window.hostCaddyHarness.active.value = true })
    const count = await page.eval(() => window.hostCaddyHarness.pending.length)
    assert.equal(await page.eval(() => window.hostCaddyHarness.pending.at(-1).kind), 'status', 'cache activation may read while old write lock remains')
    await settle(count - 1, status()); await settle(count, sites())
    await run(() => { void window.hostCaddyHarness.view().testConnection() })
    assert.equal(await page.eval(() => window.hostCaddyHarness.pending.length), count + 1, 'cache return cannot start another write until original settles')
    await settle(2, result(kind))
    await run(() => { void window.hostCaddyHarness.view().testConnection() })
    assert.equal(await page.eval(() => window.hostCaddyHarness.pending.at(-1).kind), 'test')
    await settle(count + 1, result('test'))
  }
  console.log('PASS cache return keeps original pending gate but reads new current status')
  for (const kind of Object.keys(methods)) {
    const valid = result(kind), invalid = [null, {}, ...(kind === 'test' ? [{ ...valid, connected: 'true' }, { ...valid, sitesCount: -1 }, { ...valid, dnsRecordType: 'TXT' }, { ...valid, dnsRecordValue: '' }]
      : kind === 'confirm' ? [{ message: '' }, { message: 1 }]
      : [{ ...valid, installCommand: '' }, { ...valid, password: null }, { ...valid, username: '' }, { ...valid, port: 0 }, { ...valid, port: 65536 }, ...(kind === 'generate' ? [{ ...valid, isNewCredentials: 'false' }] : [])])]
    for (const value of invalid) {
      await initialize(kind); await launch(kind); await settle(2, value)
      assert.ok(await page.eval(() => !!document.querySelector('[data-caddy-action-error]')), 'malformed receipt produces persistent failure')
      assert.equal(await page.eval(() => window.hostCaddyHarness.pending.length), 3, 'invalid receipt cannot start a dependent refresh')
      if (kind === 'generate' || kind === 'reset') assert.equal(await page.eval(() => window.hostCaddyHarness.view().installInfo.command), '')
      await launch(kind); await settle(3, valid)
      assert.equal(await page.eval(() => window.hostCaddyHarness.view().actionError), '')
    }
  }
  await initialize(); await launch('test'); await settle(2, { ...result('test'), connected: false, sitesCount: 0 })
  assert.equal(await page.eval(() => window.hostCaddyHarness.view().testResult.connected), false)
  assert.ok(await page.eval(() => !!document.querySelector('[data-caddy-action-error]')))
  for (const kind of Object.keys(methods)) {
    await initialize(kind); await launch(kind); await settle(2, null, true)
    assert.ok(await page.eval(() => !!document.querySelector('[data-caddy-action-error]')))
    if (kind === 'confirm') assert.ok(await page.eval(() => window.hostCaddyHarness.view().showInstallModal))
    await launch(kind); await settle(3, result(kind)); assert.equal(await page.eval(() => window.hostCaddyHarness.view().actionError), '')
  }
  console.log('PASS malformed/failed receipts stay visible and retry; legitimate disconnected zero stays failed')
  await initialize(); await run(() => { window.confirm = () => { window.hostCaddyHarness.session(2); return true }; void window.hostCaddyHarness.view().resetCredentials() })
  assert.equal(await page.eval(() => window.hostCaddyHarness.pending.filter(p => p.kind === 'reset').length), 0, 'confirmation cannot change its session target')
  await initialize('confirm'); await launch('confirm'); await run(() => { const v = window.hostCaddyHarness.view(); v.showInstallModal = false; v.showInstallModal = true })
  await settle(2, result('confirm')); assert.equal(await page.eval(() => window.hostCaddyHarness.view().showInstallModal), true)
  assert.equal(await page.eval(() => window.hostCaddyHarness.pending.length), 3, 'dialog ABA cannot close new modal or refresh')
  await initialize(); await run(() => { const h = window.hostCaddyHarness; h.auth.token = 'fixture.' + btoa(JSON.stringify({ sid: 'host-caddy-session', revision: 2 })) + '.fixture' })
  await launch('test'); await settle(2, result('test')); assert.equal(await page.eval(() => window.hostCaddyHarness.view().testResult.connected), true)
  await initialize(); await run(() => { void window.hostCaddyHarness.view().loadCaddyStatus() }); await launch('test')
  assert.equal(await page.eval(() => window.hostCaddyHarness.pending.filter(p => p.kind === 'test').length), 0, 'pending status blocks operations')
  await initialize(); await run(() => { void window.hostCaddyHarness.view().loadSites() }); await launch('reset'); await settle(2, sites(1, 4))
  assert.equal(await page.eval(() => window.hostCaddyHarness.view().sitesTotal), 8, 'earlier sites reply cannot replace pre-operation current data')
  await settle(3, result('reset')); await settle(4, status()); await settle(5, sites())
  console.log('PASS native confirm context, modal ABA, same sid and read/write ordering')

  const openCopy = async () => { await initialize('confirm'); await run(() => { window.copies = []; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: text => new Promise((resolve, reject) => window.copies.push({ text, resolve, reject })) } }) }) }
  await openCopy(); await run(() => { const v = window.hostCaddyHarness.view(); void v.copyCommand(); void v.copyCommand() })
  assert.equal(await page.eval(() => window.copies.length), 1)
  assert.equal(await page.eval(() => window.hostCaddyHarness.view().copied), false, 'copy awaits clipboard completion')
  await run(() => { window.copies[0].reject(Error('fixture denied')) })
  assert.ok(await page.eval(() => !!document.querySelector('[data-caddy-copy-error]')))
  await run(() => { document.querySelector('.caddy-copy').click() }); await run(() => { window.copies[1].resolve() })
  assert.equal(await page.eval(() => window.hostCaddyHarness.view().copied), true)
  await run(() => window.hostCaddyHarness.view().closeInstallModal())
  assert.equal(await page.eval(() => window.hostCaddyHarness.view().installInfo.password), '')
  assert.equal(await page.eval(() => window.hostCaddyHarness.view().copied), false)
  let copyCount = 0
  for (const mode of ['close', 'dialog-aba', 'credentials', 'credentials-aba', 'host', 'account', 'sid', 'role', 'logout', 'session-aba', 'cache', 'unmount']) for (const fail of [false, true]) {
    await openCopy(); await run(() => { window.oldCaddy = window.hostCaddyHarness.view(); void oldCaddy.copyCommand() })
    await run(mode => { const h = window.hostCaddyHarness, v = h.view()
      if (mode === 'close' || mode === 'dialog-aba') { v.showInstallModal = false; if (mode === 'dialog-aba') { v.installInfo = { command: 'echo fixture-display-only-command', username: 'fixture-display-only', password: 'fixture-display-only', port: 8444 }; v.showInstallModal = true } }
      if (mode === 'credentials' || mode === 'credentials-aba') { const original = { ...v.installInfo }; v.installInfo = { ...v.installInfo, command: 'echo fixture-later-command' }; if (mode === 'credentials-aba') v.installInfo = original }
      if (mode === 'host') h.host.value = { ...h.host.value, id: 12 }
      if (mode === 'account') h.session(2)
      if (mode === 'sid') h.session(1, 'other-caddy-session')
      if (mode === 'role') h.session(1, 'host-caddy-session', 'user')
      if (mode === 'logout') h.auth.clearLocalAuth()
      if (mode === 'session-aba') { h.session(2); h.session(1) }
      if (mode === 'cache') h.active.value = false
      if (mode === 'unmount') h.mounted.value = false
    }, mode)
    const before = await page.eval(() => JSON.stringify({ copied: oldCaddy.copied, error: oldCaddy.copyError, info: { ...oldCaddy.installInfo }, toasts: window.hostCaddyHarness.toast.toasts.value.map(t => t.message) }))
    await run(fail => fail ? window.copies[0].reject(Error('fixture denied')) : window.copies[0].resolve(), fail)
    assert.equal(await page.eval(() => JSON.stringify({ copied: oldCaddy.copied, error: oldCaddy.copyError, info: { ...oldCaddy.installInfo }, toasts: window.hostCaddyHarness.toast.toasts.value.map(t => t.message) })), before)
    assert.equal(await page.eval(() => oldCaddy.copying), false); copyCount++
  }
  for (const mode of ['unsupported', 'throw']) {
    await openCopy(); await run(mode => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: mode === 'unsupported' ? undefined : { writeText: () => { throw Error('fixture denied') } } }); void window.hostCaddyHarness.view().copyCommand() }, mode)
    assert.ok(await page.eval(() => !!document.querySelector('[data-caddy-copy-error]')))
  }
  console.log(`PASS clipboard await/retry/unsupported/throw and ${copyCount} obsolete copy receipts; sensitive fields clear on close`)

  for (const locale of ['zh-CN', 'zh-TW', 'en']) for (const width of [1440, 768, 390]) {
    await page.setViewport({ width, height: 1000 }); await fresh(); await settle(0, status(false)); await run(locale => window.hostCaddyHarness.setLocale(locale), locale)
    await run(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === window.hostCaddyHarness.t('host.caddy.generateCommand')).click())
    await settle(1, credentials()); await settle(2, status()); await settle(3, sites())
    assert.ok(await page.eval(() => !!document.querySelector('[role="dialog"]')))
    assert.ok(await page.eval(() => document.querySelector('[role="dialog"]').contains(document.activeElement)))
    await run(() => { [...document.querySelectorAll('[role="dialog"] button')].at(-1).focus() })
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }); await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
    assert.ok(await page.eval(() => document.activeElement === document.querySelector('[role="dialog"] button')), 'Tab stays in dialog')
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: 8 }); await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: 8 })
    assert.ok(await page.eval(() => document.activeElement === [...document.querySelectorAll('[role="dialog"] button')].at(-1)), 'Shift-Tab stays in dialog')
    assert.ok(await page.eval(() => document.documentElement.scrollWidth <= innerWidth + 1))
    if (width === 390) assert.ok(await page.eval(() => [...document.querySelectorAll('[role="dialog"] button')].every(b => b.getBoundingClientRect().height >= 44)))
    await run(() => { window.confirm = () => true; [...document.querySelectorAll('button')].find(b => b.textContent.trim() === window.hostCaddyHarness.t('host.caddy.confirmInstalled')).click() })
    assert.equal(await page.eval(() => window.hostCaddyHarness.pending[4].kind), 'confirm')
    await settle(4, null, true); assert.ok(await page.eval(() => !!document.querySelector('[role="dialog"] [data-caddy-action-error]')))
    await page.screenshot({ path: resolve(output, `${locale}-${width}.jpg`), fullPage: true })
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    assert.equal(await page.eval(() => !!document.querySelector('[role="dialog"]')), false, 'Escape closes settled dialog')
    assert.equal(await page.eval(() => window.hostCaddyHarness.view().installInfo.password), '')
  }
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log('PASS actual generate/confirm controls, modal focus, persistent failures and three languages/widths')
  if (process.argv.includes('--serve')) { console.log('Caddy actions fixture ready http://127.0.0.1:19746/?inspect&modal'); await new Promise(() => {}) }
} finally { if (browser) await browser.close(); await server.close() }
