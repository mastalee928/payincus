import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { Browser, sleep } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'
const root = fileURLToPath(new URL('..', import.meta.url)).replaceAll('\\', '/')
const require = createRequire(new URL('../client/package.json', import.meta.url))
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href), { default: vue } = await import(pathToFileURL(require.resolve('@vitejs/plugin-vue')).href)
const output = resolve(root, 'logs/ssh-key-submit'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js'); tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/ssh-keys/*.js']
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/ssh-keys', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/ssh-keys/api.js' }, { find: '@', replacement: root + '/client/src' }, ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } }, server: { host: '127.0.0.1', port: 19734, strictPort: true, fs: { allow: [root] } },
})
const key = id => ({ id, name: `Laptop ${id}`, fingerprint: `fixture-public-${id}`, publicKeyPreview: 'fixture public preview' })
// Display-only markers: no actual private material is generated or recorded.
const privateMarker = 'ISOLATED DISPLAY MARKER A'
let browser, stale = 0
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(35); return result }
  const fresh = async () => {
    await page.goto('http://127.0.0.1:19734', { settleMs: 250 })
    const deadline = Date.now() + 15000
    while (!await page.eval(() => !!window.sshHarness?.view())) { if (Date.now() > deadline) throw Error('SSH fixture did not mount'); await sleep(70) }
    await run(() => { window.sshHarness.pending[0].resolve({ keys: [1, 2].map(id => ({ id, name: 'Laptop', fingerprint: `fixture-public-${id}` })) }); window.confirm = () => true })
  }
  const count = kind => page.eval(kind => window.sshHarness.pending.filter(x => x.kind === kind).length, kind)
  const last = kind => page.eval(kind => window.sshHarness.pending.findLastIndex(x => x.kind === kind), kind)
  const settle = (index, data, fail = false) => run(({ index, data, fail }) => { const x = window.sshHarness.pending[index]; fail ? x.reject(Error('Fixture mutation unavailable')) : x.resolve(data) }, { index, data, fail })
  const action = kind => run(kind => { const v = window.sshHarness.view()
    if (kind === 'create') { v.showAddKey = true; v.newKey = { name: ' Laptop A ', content: 'ssh-ed25519 ' + 'A'.repeat(48) }; void v.addKey() }
    if (kind === 'delete') void v.deleteKey(1)
    if (kind === 'generate') void v.generateKey()
  }, kind)
  const receipt = kind => kind === 'delete' ? { message: 'SSH key deleted' } : { message: 'SSH key saved', key: key(3), ...(kind === 'generate' ? { privateKey: privateMarker } : {}) }
  for (const kind of ['create', 'delete', 'generate']) {
    await fresh(); await action(kind); await action(kind)
    assert.equal(await count(kind), 1, kind + ': duplicate calls cannot submit twice')
    const pending = await last(kind)
    for (const conflict of ['create', 'delete', 'generate']) { if (conflict !== kind) { const before = await count(conflict); await action(conflict); assert.equal(await count(conflict), before, 'shared SSH mutation gate') } }
    if (kind === 'create') assert.deepEqual(await page.eval(i => window.sshHarness.pending[i].data, pending), { name: 'Laptop A', publicKey: 'ssh-ed25519 ' + 'A'.repeat(48) })
    await settle(pending, receipt(kind))
    const list = await last('list'); await settle(list, { keys: [key(1), key(3)] })
    if (kind === 'generate') {
      assert.equal(await page.eval(() => window.sshHarness.view().generatedPrivateKey), privateMarker)
      await action('generate'); assert.equal(await count('generate'), 1, 'an open private result cannot be overwritten by another generation')
      await run(() => window.sshHarness.view().closePrivateKeyModal())
      assert.equal(await page.eval(() => window.sshHarness.view().generatedPrivateKey), '')
    }
    for (const mode of ['sid', 'account', 'role', 'logout', 'session-aba', 'cache', 'unmount']) for (const fail of [false, true]) {
      await fresh(); await action(kind); const index = await last(kind)
      await run(mode => { const h = window.sshHarness; window.oldSshView = h.view()
        if (mode === 'sid') h.session(1, 'other-session')
        if (mode === 'account') h.session(2)
        if (mode === 'role') h.session(1, 'ssh-session', 'admin')
        if (mode === 'logout') h.auth.clearLocalAuth()
        if (mode === 'session-aba') { h.session(2); h.session(1) }
        if (mode === 'cache') h.active.value = false
        if (mode === 'unmount') h.mounted.value = false
      }, mode)
      const before = await page.eval(() => ({ toasts: window.sshHarness.toast.toasts.value.length, list: window.sshHarness.pending.filter(x => x.kind === 'list').length }))
      await settle(index, receipt(kind), fail)
      assert.deepEqual(await page.eval(() => ({ toasts: window.sshHarness.toast.toasts.value.length, list: window.sshHarness.pending.filter(x => x.kind === 'list').length })), before, 'old mutation cannot notify or read a new account')
      assert.equal(await page.eval(() => window.oldSshView.generatedPrivateKey), '', 'old generated material is never displayed in another session')
      assert.equal(await page.eval(() => window.oldSshView.showPrivateKeyModal), false)
      stale++
    }
    for (const bad of [null, {}, { message: '' }, { message: ' ', key: key(3), privateKey: privateMarker }, ...(kind === 'delete' ? [] : [{ message: 'ok' }, { message: 'ok', key: { ...key(3), id: 0 }, privateKey: privateMarker }]), ...(kind === 'generate' ? [{ message: 'ok', key: key(3), privateKey: '' }] : [])]) {
      await fresh(); await action(kind); const before = await count('list'); await settle(await last(kind), bad)
      assert.equal(await count('list'), before, 'unconfirmed mutation must not start a success refresh')
      assert.ok(await page.eval(() => window.sshHarness.view().mutationError))
      assert.equal(await page.eval(() => window.sshHarness.view().generatedPrivateKey), '')
    }
    await fresh(); await action(kind); await settle(await last(kind), null, true)
    assert.ok(await page.eval(() => document.querySelector('[data-ssh-mutation-error]')?.textContent), 'current failure persists in the section')
    await action(kind); await settle(await last(kind), receipt(kind)); await settle(await last('list'), { keys: [key(1)] })
    await fresh(); await action(kind); const refresh = await last(kind)
    await run(() => { window.sshHarness.auth.token = 'fixture.' + btoa(JSON.stringify({ sid: 'ssh-session', revision: 2 })) + '.fixture' })
    await settle(refresh, receipt(kind)); assert.equal(await count('list'), 2, 'same sid preserves valid mutation completion')
    await settle(await last('list'), { keys: [key(1)] })
  }
  await fresh(); await action('create'); const draft = await last('create')
  await run(() => { const v = window.sshHarness.view(); v.newKey = { name: 'Later draft', content: 'Later content' } })
  await settle(draft, receipt('create')); await settle(await last('list'), { keys: [key(1)] })
  assert.deepEqual(await page.eval(() => JSON.parse(JSON.stringify(window.sshHarness.view().newKey))), { name: 'Later draft', content: 'Later content' }, 'completion must not erase a later draft')
  for (const mode of ['account', 'sid', 'cache', 'unmount']) {
    await fresh(); await action('generate'); await settle(await last('generate'), receipt('generate')); await settle(await last('list'), { keys: [key(1)] })
    await run(mode => { const h = window.sshHarness; window.oldSshView = h.view(); if (mode === 'account') h.session(2); if (mode === 'sid') h.session(1, 'other-session'); if (mode === 'cache') h.active.value = false; if (mode === 'unmount') h.mounted.value = false }, mode)
    assert.equal(await page.eval(() => window.oldSshView.generatedPrivateKey), '', 'a displayed result is cleared at every lifecycle boundary')
  }
  await fresh(); await action('generate'); await settle(await last('generate'), receipt('generate')); await settle(await last('list'), { keys: [key(1)] })
  await run(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => new Promise(resolve => { window.releaseCopy = resolve }) } }); void window.sshHarness.view().copyPrivateKey(); window.sshHarness.view().closePrivateKeyModal() })
  await action('generate'); await settle(await last('generate'), { ...receipt('generate'), privateKey: 'ISOLATED DISPLAY MARKER B' }); await settle(await last('list'), { keys: [key(1)] })
  await run(() => window.releaseCopy())
  assert.equal(await page.eval(() => window.sshHarness.view().privateKeyCopied), false, 'old clipboard completion cannot mark a later private result copied')
  for (const fallback of [false, true]) {
    await fresh(); await action('generate'); await settle(await last('generate'), receipt('generate')); await settle(await last('list'), { keys: [key(1)] })
    await run(fallback => {
      const original = HTMLAnchorElement.prototype.click
      window.downloadClicks = 0; window.releasedURLs = 0
      HTMLAnchorElement.prototype.click = function () { window.downloadClicks++ }
      URL.createObjectURL = () => { if (fallback) throw Error('Fixture Blob unavailable'); return 'blob:fixture-download' }
      URL.revokeObjectURL = () => { window.releasedURLs++ }
      const v = window.sshHarness.view(); v.downloadPrivateKey(); v.closePrivateKeyModal()
      window.originalAnchorClick = original
    }, fallback)
    await sleep(80)
    assert.equal(await page.eval(() => window.downloadClicks), 0, 'closing before deferred download cancels Blob and data URL clicks')
    assert.equal(await page.eval(() => document.querySelectorAll('a[download="id_rsa"]').length), 0)
    assert.equal(await page.eval(() => window.releasedURLs), fallback ? 0 : 1)
  }
  for (const kind of ['create', 'delete', 'generate']) {
    await fresh(); await action(kind); const oldWrite = await last(kind)
    await run(() => { window.sshHarness.active.value = false }); await run(() => { window.sshHarness.active.value = true })
    await settle(await last('list'), { keys: [key(1), key(2)] }); const before = await count(kind)
    await action(kind); assert.equal(await count(kind), before, 'returning to cached component cannot bypass an old in-flight mutation')
    await settle(oldWrite, receipt(kind)); await action(kind)
    assert.equal(await count(kind), before + 1, 'old work releases the operation gate once settled')
    await settle(await last(kind), receipt(kind)); await settle(await last('list'), { keys: [key(1)] })
  }
  await fresh()
  for (const id of [0, -1, 1.5, 999, Number.MAX_SAFE_INTEGER + 1]) await run(id => { void window.sshHarness.view().deleteKey(id) }, id)
  assert.equal(await count('delete'), 0, 'delete requires a valid key in the current inventory')
  for (const content of ['', 'short', 'ssh-ed25519 ' + 'A'.repeat(8200), 'ssh-ed25519 AAAA\nssh-rsa BBBB']) {
    await run(content => { const v = window.sshHarness.view(); v.newKey = { name: 'Laptop', content }; void v.addKey() }, content)
  }
  assert.equal(await count('create'), 0, 'invalid public key input never submits')
  await action('create')
  assert.equal(await page.eval(() => [...document.querySelectorAll('input, textarea')].every(input => input.disabled)), true, 'submitted form fields are disabled while pending')
  for (const [locale, width] of [['zh-CN', 1440], ['zh-TW', 768], ['en', 390]]) {
    await page.setViewport({ width, height: 1000, mobile: width === 390 }); await run(locale => { const h = window.sshHarness; h.setLocale(locale); h.theme.setTheme(innerWidth === 390 ? 'dark' : 'light') }, locale)
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: resolve(output, `${locale}-${width}.png`), format: 'png' })
  }
  await settle(await last('create'), null, true)
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log(`PASS actual SSH create/delete/generate duplicates and conflicts, ${stale} old mutations, strict receipts, retries, same sid, later drafts and private display/clipboard lifecycle; display markers only`)
} finally { if (browser) await browser.close(); await server.close() }
