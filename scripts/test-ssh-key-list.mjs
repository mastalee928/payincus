import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { Browser, sleep } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'
const root = fileURLToPath(new URL('..', import.meta.url)).replaceAll('\\', '/')
const require = createRequire(new URL('../client/package.json', import.meta.url))
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href), { default: vue } = await import(pathToFileURL(require.resolve('@vitejs/plugin-vue')).href)
const output = resolve(root, 'logs/ssh-key-list'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js'); tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/ssh-keys/*.js']
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/ssh-keys', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/ssh-keys/api.js' }, { find: '@', replacement: root + '/client/src' }, ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } }, server: { host: '127.0.0.1', port: 19733, strictPort: true, fs: { allow: [root] } },
})
const key = id => ({ id, name: `Laptop ${id}`, fingerprint: `fixture-public-${id}`, createdAt: '2026-10-29T04:05:06.000Z' })
let browser, stale = 0
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(40); return result }
  const fresh = async () => {
    await page.goto('http://127.0.0.1:19733', { settleMs: 300 })
    const deadline = Date.now() + 15000
    while (!await page.eval(() => !!window.sshHarness?.view())) { if (Date.now() > deadline) throw Error('SSH fixture did not mount'); await sleep(70) }
  }
  const read = (index, data, fail = false) => run(({ index, data, fail }) => { const x = window.sshHarness.pending[index]; if (fail) x.reject(Error('Fixture read unavailable')); else x.resolve(data) }, { index, data, fail })
  await fresh(); await run(() => { void window.sshHarness.view().loadSSHKeys() })
  await read(1, { keys: [key(2)] }); await read(0, { keys: [key(1)] })
  assert.deepEqual(await page.eval(() => window.sshHarness.view().sshKeys.map(k => k.id)), [2], 'late original list must not replace the newer list')
  await fresh(); await read(0, { keys: Array.from({ length: 11 }, (_, i) => key(i + 1)) })
  await run(() => { const v = window.sshHarness.view(); v.goToNextPage(); v.goToNextPage(); void v.loadSSHKeys() })
  await read(1, { keys: [key(1)] })
  assert.equal(await page.eval(() => window.sshHarness.view().currentPage), 1, 'list shrink clamps the current page')
  assert.equal(await page.eval(() => window.sshHarness.view().paginatedKeys.length), 1)
  for (const mode of ['sid', 'account', 'role', 'logout', 'session-aba', 'cache', 'unmount']) for (const fail of [false, true]) {
    await fresh(); await read(0, { keys: [key(1)] }); await run(() => { void window.sshHarness.view().loadSSHKeys() })
    await run(async mode => { const h = window.sshHarness; window.oldSshView = h.view()
      if (mode === 'sid') h.session(1, 'other-session')
      if (mode === 'account') h.session(2)
      if (mode === 'role') h.session(1, 'ssh-session', 'admin')
      if (mode === 'logout') h.auth.clearLocalAuth()
      if (mode === 'session-aba') { h.session(2); h.session(1) }
      if (mode === 'cache') h.active.value = false
      if (mode === 'unmount') h.mounted.value = false
    }, mode)
    const before = await page.eval(() => JSON.stringify({ keys: window.oldSshView.sshKeys, error: window.oldSshView.listError, page: window.oldSshView.currentPage }))
    await read(1, { keys: [key(3)] }, fail)
    assert.equal(await page.eval(() => JSON.stringify({ keys: window.oldSshView.sshKeys, error: window.oldSshView.listError, page: window.oldSshView.currentPage })), before, mode + ': obsolete list cannot reveal keys or change current state'); stale++
    assert.equal(await page.eval(() => window.oldSshView.sshKeys.length), 0, 'clear keys at the lifecycle boundary')
    if (mode === 'cache') {
      await run(() => { window.sshHarness.active.value = true })
      assert.equal(await page.eval(() => window.sshHarness.pending.length), 3, 'cache return performs one current list read')
      await read(2, { keys: [key(2)] })
    }
  }
  await fresh(); await run(() => { const h = window.sshHarness; h.auth.token = 'fixture.' + btoa(JSON.stringify({ sid: 'ssh-session', revision: 2 })) + '.fixture' })
  await read(0, { keys: [key(1)] }); assert.equal(await page.eval(() => window.sshHarness.view().sshKeys.length), 1, 'same sid refresh preserves current list')
  for (const bad of [null, {}, { keys: null }, { keys: [null] }, { keys: [key(1), key(1)] }, { keys: [{ ...key(1), id: 0 }] }, { keys: [{ ...key(1), fingerprint: null }] }]) {
    await fresh(); await read(0, bad)
    assert.ok(await page.eval(() => document.querySelector('[data-ssh-list-error]')?.textContent), 'invalid list has a persistent error rather than an empty inventory')
    await run(() => document.querySelector('[data-ssh-list-error] button').click()); await read(1, { keys: [key(1)] })
    assert.equal(await page.eval(() => window.sshHarness.view().sshKeys.length), 1, 'actual retry button reads the current inventory')
  }
  await fresh(); await read(0, { keys: [key(1)] }); await run(() => { void window.sshHarness.view().loadSSHKeys() }); await read(1, null, true)
  assert.equal(await page.eval(() => window.sshHarness.view().sshKeys.length), 1, 'refresh failure preserves the last valid current inventory')
  for (const [locale, width] of [['zh-CN', 1440], ['zh-TW', 768], ['en', 390]]) {
    await page.setViewport({ width, height: 1000, mobile: width === 390 }); await run(locale => { const h = window.sshHarness; h.setLocale(locale); h.theme.setTheme(innerWidth === 390 ? 'dark' : 'light') }, locale)
    assert.ok(await page.eval(locale => document.querySelector('[data-ssh-list-error]').textContent.includes({ 'zh-CN': '加载失败', 'zh-TW': '載入失敗', en: 'Failed to load' }[locale]), locale), 'visible failure follows the current language')
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: resolve(output, `${locale}-${width}.png`), format: 'png' })
  }
  assert.equal(await page.eval(() => window.sshHarness.pending.every(x => x.kind === 'list')), true)
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log(`PASS actual SSH list ordering, page contraction, ${stale} obsolete session/cache/unmount responses, same sid and strict failed reads with real retry; no key writes`)
} finally { if (browser) await browser.close(); await server.close() }
