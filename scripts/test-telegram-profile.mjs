import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { Browser, sleep } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'
const root = fileURLToPath(new URL('..', import.meta.url)).replaceAll('\\', '/'), require = createRequire(new URL('../client/package.json', import.meta.url))
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href), { default: vue } = await import(pathToFileURL(require.resolve('@vitejs/plugin-vue')).href)
const output = resolve(root, 'logs/telegram-profile'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js'); tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/telegram-profile/*.js']
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/telegram-profile', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/telegram-profile/api.js' }, { find: '@', replacement: root + '/client/src' }, ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } }, server: { host: '127.0.0.1', port: 19737, strictPort: true, fs: { allow: [root] } },
})
const unbound = { enabled: true, configured: true, botUsername: 'FixtureBot', binding: null }
const bound = { ...unbound, binding: { telegramUserId: '101', telegramUsername: 'fixture', firstName: null, lastName: null, notifyEnabled: true, notifyLastError: null, notifyLastErrorAt: null, boundAt: '2026-10-29T04:05:06.000Z' } }
const tokenReceipt = () => ({ bindUrl: 'https://t.me/FixtureBot?start=bind_' + 'A'.repeat(43), expiresAt: new Date(Date.now() + 600000).toISOString() })
let browser, stale = 0
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(35); return result }
  const fresh = async (isBound = false) => {
    await page.goto('http://127.0.0.1:19737', { settleMs: 250 })
    const deadline = Date.now() + 15000
    while (!await page.eval(() => !!window.tgHarness?.view())) { if (Date.now() > deadline) throw Error('TG fixture did not mount'); await sleep(70) }
    await run(data => { window.tgHarness.pending[0].resolve(data); window.confirm = () => true }, isBound ? bound : unbound)
  }
  const settle = (index, data, fail = false) => run(({ index, data, fail }) => { const x = window.tgHarness.pending[index]; fail ? x.reject(Error('Fixture unavailable')) : x.resolve(data) }, { index, data, fail })
  const count = kind => page.eval(kind => window.tgHarness.pending.filter(x => x.kind === kind).length, kind)
  const last = kind => page.eval(kind => window.tgHarness.pending.findLastIndex(x => x.kind === kind), kind)
  const action = kind => run(kind => { const v = window.tgHarness.view(); if (kind === 'generate') void v.createBindToken(); if (kind === 'unlink') void v.unlinkTelegram(); if (kind === 'notify') void v.toggleNotify(false) }, kind)
  await fresh(true)
  await run(() => document.querySelector('input[type="checkbox"]').click())
  assert.equal(await count('notify'), 1, 'actual notification control submits once')
  await settle(await last('notify'), null, true)
  assert.equal(await page.eval(() => document.querySelector('input[type="checkbox"]').checked), true, 'failed notification save restores the verified checkbox state')
  await run(() => document.querySelector('input[type="checkbox"]').click())
  await settle(await last('notify'), { message: 'saved', notifyEnabled: false })
  assert.equal(await page.eval(() => document.querySelector('input[type="checkbox"]').checked), false, 'retry updates the checkbox only on confirmed success')
  await run(() => document.querySelector('input[type="checkbox"]').click())
  await settle(await last('notify'), { message: 'saved', notifyEnabled: true })
  assert.equal(await page.eval(() => document.querySelector('input[type="checkbox"]').checked), true)
  await fresh(true); await action('notify'); const lateReadWrite = await last('notify')
  await run(() => { void window.tgHarness.view().loadBinding() }); const lateRead = await last('read')
  await settle(lateReadWrite, { message: 'saved', notifyEnabled: false }); await settle(lateRead, bound)
  assert.equal(await page.eval(() => window.tgHarness.view().status.binding.notifyEnabled), false, 'read started before a successful save cannot undo its confirmed setting')
  for (const kind of ['generate', 'unlink', 'notify']) {
    await fresh(kind !== 'generate'); await action(kind); const index = await last(kind)
    await run(() => { void window.tgHarness.view().loadBinding() })
    await settle(await last('read'), { ...bound, botUsername: 'OtherFixtureBot', binding: { ...bound.binding, telegramUserId: '202' } })
    await run(() => { void window.tgHarness.view().loadBinding() })
    await settle(await last('read'), kind === 'generate' ? unbound : bound)
    const before = await page.eval(() => ({ state: JSON.stringify(window.tgHarness.view().status), url: window.tgHarness.view().bindUrl, toasts: window.tgHarness.toast.toasts.value.length, reads: window.tgHarness.pending.filter(x => x.kind === 'read').length }))
    await settle(index, kind === 'generate' ? tokenReceipt() : kind === 'unlink' ? { message: 'removed' } : { message: 'ok', notifyEnabled: false })
    assert.deepEqual(await page.eval(() => ({ state: JSON.stringify(window.tgHarness.view().status), url: window.tgHarness.view().bindUrl, toasts: window.tgHarness.toast.toasts.value.length, reads: window.tgHarness.pending.filter(x => x.kind === 'read').length })), before, 'target A → B → A must never revalidate an old completion')
  }
  await fresh(); await action('generate'); await action('generate')
  assert.equal(await count('generate'), 1, 'same-turn generation must not issue duplicate links')
  await settle(await last('generate'), tokenReceipt())
  for (const kind of ['generate', 'unlink', 'notify']) {
    await fresh(kind !== 'generate'); await action(kind); await action(kind); assert.equal(await count(kind), 1)
    const receipt = kind === 'generate' ? tokenReceipt() : kind === 'unlink' ? { message: 'Telegram binding removed' } : { message: 'Notifications disabled', notifyEnabled: false }
    await settle(await last(kind), receipt)
    if (kind === 'unlink') await settle(await last('read'), unbound)
    if (kind === 'generate') assert.ok(await page.eval(() => window.tgHarness.view().bindUrl))
    if (kind === 'notify') assert.equal(await page.eval(() => window.tgHarness.view().status.binding.notifyEnabled), false)
    for (const mode of ['account', 'sid', 'role', 'logout', 'session-aba', 'cache', 'unmount']) for (const fail of [false, true]) {
      await fresh(kind !== 'generate'); await action(kind); const index = await last(kind)
      await run(mode => { const h = window.tgHarness; window.oldTg = h.view()
        if (mode === 'account') h.session(2)
        if (mode === 'sid') h.session(1, 'other-tg')
        if (mode === 'role') h.session(1, 'tg-session', 'admin')
        if (mode === 'logout') h.auth.clearLocalAuth()
        if (mode === 'session-aba') { h.session(2); h.session(1) }
        if (mode === 'cache') h.active.value = false
        if (mode === 'unmount') h.mounted.value = false
      }, mode)
      const before = await page.eval(() => ({ state: JSON.stringify(window.oldTg.status), url: window.oldTg.bindUrl, toasts: window.tgHarness.toast.toasts.value.length, reads: window.tgHarness.pending.filter(x => x.kind === 'read').length }))
      await settle(index, receipt, fail)
      assert.deepEqual(await page.eval(() => ({ state: JSON.stringify(window.oldTg.status), url: window.oldTg.bindUrl, toasts: window.tgHarness.toast.toasts.value.length, reads: window.tgHarness.pending.filter(x => x.kind === 'read').length })), before, 'old binding response never changes another session')
      assert.equal(await page.eval(() => window.oldTg.bindUrl), ''); stale++
    }
    await fresh(kind !== 'generate'); await action(kind); await settle(await last(kind), null, true)
    assert.ok(await page.eval(() => document.querySelector('[data-tg-operation-error]')?.textContent))
    await action(kind); await settle(await last(kind), receipt)
    if (kind === 'unlink') await settle(await last('read'), unbound)
  }
  await fresh(); await run(() => { void window.tgHarness.view().loadBinding(); void window.tgHarness.view().loadBinding() })
  await settle(2, bound); await settle(1, unbound)
  assert.equal(await page.eval(() => window.tgHarness.view().status.binding.telegramUserId), '101', 'late unbound read cannot replace a newer binding')
  for (const mode of ['account', 'sid', 'role', 'logout', 'session-aba', 'cache', 'unmount']) for (const fail of [false, true]) {
    await fresh(); await run(() => { void window.tgHarness.view().loadBinding() })
    await run(mode => { const h = window.tgHarness; window.oldTg = h.view(); if (mode === 'account') h.session(2); if (mode === 'sid') h.session(1, 'other-tg'); if (mode === 'role') h.session(1, 'tg-session', 'admin'); if (mode === 'logout') h.auth.clearLocalAuth(); if (mode === 'session-aba') { h.session(2); h.session(1) }; if (mode === 'cache') h.active.value = false; if (mode === 'unmount') h.mounted.value = false }, mode)
    const before = await page.eval(() => JSON.stringify(window.oldTg.status)); await settle(1, bound, fail)
    assert.equal(await page.eval(() => JSON.stringify(window.oldTg.status)), before); stale++
  }
  for (const bad of [null, {}, { ...unbound, enabled: 'true' }, { ...unbound, binding: {} }, { ...bound, binding: { ...bound.binding, notifyEnabled: 'false' } }]) {
    await fresh(); await run(() => { void window.tgHarness.view().loadBinding() }); await settle(await last('read'), bad)
    assert.ok(await page.eval(() => document.querySelector('[data-tg-read-error]')?.textContent))
    await run(() => document.querySelector('[data-tg-read-error] button').click()); await settle(await last('read'), unbound)
  }
  for (const bad of [null, {}, { ...tokenReceipt(), bindUrl: 'https://example.test/' }, { ...tokenReceipt(), expiresAt: 'invalid' }, { ...tokenReceipt(), expiresAt: new Date(Date.now() - 1000).toISOString() }, { ...tokenReceipt(), bindUrl: 'https://t.me/OtherBot?start=bind_' + 'A'.repeat(43) }]) {
    await fresh(); await action('generate'); await settle(await last('generate'), bad)
    assert.equal(await page.eval(() => window.tgHarness.view().bindUrl), '')
    assert.ok(await page.eval(() => document.querySelector('[data-tg-operation-error]')?.textContent))
  }
  for (const kind of ['unlink', 'notify']) {
    await fresh(true); await action(kind); const index = await last(kind)
    await run(() => { void window.tgHarness.view().loadBinding() }); await settle(await last('read'), { ...bound, binding: { ...bound.binding, telegramUserId: '202', boundAt: '2026-10-30T04:05:06.000Z' } })
    await settle(index, kind === 'unlink' ? { message: 'removed' } : { message: 'ok', notifyEnabled: false })
    assert.equal(await page.eval(() => window.tgHarness.view().status.binding.telegramUserId), '202')
    assert.equal(await page.eval(() => window.tgHarness.view().status.binding.notifyEnabled), true, 'old target completion must not alter replacement binding')
  }
  for (const kind of ['generate', 'unlink', 'notify']) {
    await fresh(kind !== 'generate'); await action(kind)
    await run(() => { window.tgHarness.active.value = false }); await run(() => { window.tgHarness.active.value = true })
    await settle(await last('read'), kind === 'generate' ? unbound : bound)
    await action(kind); assert.equal(await count(kind), 1, 'cache return retains the old in-flight lock until its request settles')
    await settle(await last(kind), kind === 'generate' ? tokenReceipt() : kind === 'unlink' ? { message: 'removed' } : { message: 'ok', notifyEnabled: false })
    await action(kind); assert.equal(await count(kind), 2, 'cache return releases the lock after the obsolete request settles')
  }
  await fresh(true); await action('notify'); await action('unlink'); assert.equal(await count('unlink'), 0)
  assert.equal(await page.eval(() => document.querySelector('input[type="checkbox"]').disabled), true)
  assert.equal(await page.eval(() => [...document.querySelectorAll('button')].find(x => x.textContent.trim() === window.tgHarness.t('profile.telegramBinding.unlink')).disabled), true)
  await fresh(true); await action('unlink'); await action('notify'); assert.equal(await count('notify'), 0)
  for (const kind of ['unlink', 'notify']) for (const bad of [null, {}, { message: '' }, { message: ' ', notifyEnabled: false }, ...(kind === 'notify' ? [{ message: 'ok' }, { message: 'ok', notifyEnabled: 'false' }, { message: 'ok', notifyEnabled: true }] : [])]) {
    await fresh(true); await action(kind); const before = await count('read'); await settle(await last(kind), bad)
    assert.equal(await count('read'), before, 'unconfirmed writes never issue a success refresh')
    assert.equal(await page.eval(() => window.tgHarness.view().status.binding.notifyEnabled), true)
    assert.ok(await page.eval(() => document.querySelector('[data-tg-operation-error]')?.textContent))
  }
  await fresh(); await run(() => { window.confirm = () => false; void window.tgHarness.view().unlinkTelegram(); void window.tgHarness.view().toggleNotify(false) })
  assert.equal(await count('unlink'), 0); assert.equal(await count('notify'), 0)
  await fresh(true); await run(() => { window.confirm = () => false; void window.tgHarness.view().unlinkTelegram() }); assert.equal(await count('unlink'), 0)
  await fresh(true); await action('notify'); const index = await last('notify')
  await run(() => { window.tgHarness.auth.token = 'fixture.' + btoa(JSON.stringify({ sid: 'tg-session', revision: 2 })) + '.fixture' })
  await settle(index, { message: 'ok', notifyEnabled: false }); assert.equal(await page.eval(() => window.tgHarness.view().status.binding.notifyEnabled), false)
  await fresh(); await action('generate'); await settle(await last('generate'), tokenReceipt())
  await run(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => new Promise(resolve => { window.releaseTgCopy = resolve }) } }); void window.tgHarness.view().copyBindUrl(); window.tgHarness.session(2) })
  const before = await page.eval(() => window.tgHarness.toast.toasts.value.length); await run(() => window.releaseTgCopy()); assert.equal(await page.eval(() => window.tgHarness.toast.toasts.value.length), before)
  await fresh(); await action('generate'); await settle(await last('generate'), { ...tokenReceipt(), expiresAt: new Date(Date.now() + 1200).toISOString() }); await sleep(1600)
  assert.equal(await page.eval(() => window.tgHarness.view().bindUrl), '', 'expired binding link disappears and cannot be copied')
  await fresh(true)
  for (const [locale, width] of [['zh-CN', 1440], ['zh-TW', 768], ['en', 390]]) {
    await page.setViewport({ width, height: 1000, mobile: width === 390 }); await run(locale => { window.tgHarness.setLocale(locale); window.tgHarness.theme.setTheme(innerWidth === 390 ? 'dark' : 'light') }, locale)
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: resolve(output, `${locale}-${width}.png`), format: 'png' })
  }
  await run(() => document.querySelector('input[type="checkbox"]').click())
  await page.screenshot({ path: resolve(output, 'en-390-busy.png'), format: 'png' })
  await settle(await last('notify'), null, true)
  await page.screenshot({ path: resolve(output, 'en-390-error.png'), format: 'png' })
  await run(() => [...document.querySelectorAll('button')].find(x => x.textContent.trim() === window.tgHarness.t('profile.telegramBinding.unlink')).click())
  assert.equal(await count('unlink'), 1, 'actual unlink button uses the guarded mutation')
  await settle(await last('unlink'), { message: 'removed' }); await settle(await last('read'), unbound)
  await run(() => [...document.querySelectorAll('button')].find(x => x.textContent.trim() === window.tgHarness.t('profile.telegramBinding.generate')).click())
  assert.equal(await count('generate'), 1, 'actual generate button uses the guarded mutation')
  await settle(await last('generate'), tokenReceipt())
  await page.screenshot({ path: resolve(output, 'en-390-link.png'), format: 'png' })
  if (process.argv.includes('--inspect')) {
    const exec = promisify(execFile)
    for (const theme of ['light', 'dark']) {
      const result = await exec(process.execPath, [root + '/.agents/skills/design-taste-frontend/scripts/inspect.mjs', `http://127.0.0.1:19737/?inspect${theme === 'dark' ? '&dark' : ''}`, '--app', '--allow', 'no-title,no-hero,unused-canvas,hero-void', '--out', resolve(output, `taste-${theme}`)], { cwd: root, windowsHide: true, maxBuffer: 2 * 1024 * 1024 })
      writeFileSync(resolve(output, `taste-${theme}.log`), result.stdout)
      console.log(result.stdout)
    }
  }
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log(`PASS Telegram profile duplicates, ${stale} obsolete read/write responses, current target/receipts/retry/same sid/copy/expiry; local display link markers only, no external requests`)
} finally { if (browser) await browser.close(); await server.close() }
