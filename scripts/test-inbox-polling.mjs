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
const output = resolve(root, 'logs/inbox-polling'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js'); tailwind.content = [root + '/client/src/**/*.{vue,js,ts}']
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/inbox-polling', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/inbox-polling/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } }, server: { host: '127.0.0.1', port: 19766, strictPort: true, fs: { allow: [root] } }
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  const run = async (fn, arg) => { const value = await page.eval(fn, arg); await sleep(30); return value }
  const fresh = async () => {
    await page.goto('http://127.0.0.1:19766', { settleMs: 200 }); const deadline = Date.now() + 15000
    while (!await page.eval(() => !!window.pollingHarness)) { if (Date.now() > deadline) throw Error('polling fixture failed: ' + page.consoleErrors.join('\n')); await sleep(50) }
  }
  const settle = (index, value, fail = false) => run(({ index, value, fail }) => {
    const request = window.pollingHarness.pending[index]; fail ? request.reject(Error('controlled unread failure')) : request.resolve(value)
  }, { index, value, fail })
  const count = () => page.eval(() => window.pollingHarness.pending.length)
  const unread = () => page.eval(() => window.pollingHarness.inbox.unreadCount)
  if (!process.argv.includes('--layout-only')) {
  await fresh(); await run(() => window.pollingHarness.inbox.startPolling()); await settle(0, { count: 8 })
  await run(() => { const h = window.pollingHarness; h.inbox.refresh(); h.inbox.clearUnread() }); await settle(1, { count: 8 })
  assert.equal(await unread(), 0, 'an in-flight unread response must not restore a locally cleared count')
  console.log('PASS clearUnread invalidates obsolete response')
  await fresh(); await run(() => window.pollingHarness.inbox.startPolling()); await settle(0, { count: 8 })
  await run(() => { const h = window.pollingHarness; h.inbox.refresh(); h.inbox.decrementUnread(2) }); await settle(1, { count: 8 })
  assert.equal(await unread(), 6, 'decrementing unread also invalidates the older count')
  await run(() => { window.pollingHarness.inbox.refresh() }); await settle(2, { count: 7 }); assert.equal(await unread(), 7, 'a later current poll may report a newly received message')
  let stale = 0
  for (const mode of ['account', 'sid', 'role', 'logout', 'session-aba', 'stop', 'restart']) for (const fail of [false, true]) {
    await fresh(); await run(() => window.pollingHarness.inbox.startPolling()); await settle(0, { count: 8 })
    await run(() => window.pollingHarness.inbox.refresh()); const old = await count() - 1
    await run(mode => {
      const h = window.pollingHarness
      if (mode === 'account') h.session(2)
      if (mode === 'sid') h.session(1, 'new-session')
      if (mode === 'role') h.session(1, 'polling-session', 'admin')
      if (mode === 'logout') h.auth.clearLocalAuth()
      if (mode === 'session-aba') { h.session(2); h.session(1) }
      if (mode === 'stop' || mode === 'restart') h.inbox.stopPolling()
      if (mode === 'restart') h.inbox.startPolling()
    }, mode)
    assert.equal(await unread(), 0, `${mode} clears the previous identity count immediately`)
    const newer = await count() - 1
    if (newer > old) await settle(newer, { count: 3 })
    const before = await unread(); await settle(old, { count: 19 }, fail)
    assert.equal(await unread(), before, `${mode} isolates the previous success or failure`)
    stale++
  }
  console.log(`PASS ${stale} obsolete account/sid/role/logout/ABA/stop/restart receipts and decrement invalidation`)
  await fresh(); await run(() => window.pollingHarness.inbox.startPolling())
  await run(() => { const h = window.pollingHarness; for (let i = 0; i < 5; i++) { h.inbox.startPolling(); h.inbox.refresh(); h.tick(); document.dispatchEvent(new Event('visibilitychange')) } })
  assert.equal(await count(), 1, 'poll ticks, refreshes and visibility events share one pending current read')
  assert.deepEqual(await page.eval(() => [window.pollingHarness.timers.size, window.pollingHarness.listeners.size]), [1, 1])
  await settle(0, { count: 5 }); await run(() => { const h = window.pollingHarness; h.auth.token = 'fixture.' + btoa(JSON.stringify({ sid: 'polling-session', revision: 2 })) + '.fixture' })
  assert.equal(await count(), 1); assert.equal(await unread(), 5, 'refreshing the token within the same sid keeps the current count')
  await run(() => window.pollingHarness.inbox.refresh()); const old = await count() - 1
  await run(() => window.pollingHarness.session(2)); const newIndex = await count() - 1
  await settle(old, { count: 9 }); await run(() => window.pollingHarness.inbox.refresh())
  assert.equal(await count() - 1, newIndex, 'settling an obsolete read does not release the current request gate')
  await settle(newIndex, { count: 2 }); assert.equal(await unread(), 2)
  for (const bad of [null, {}, { count: '2' }, { count: -1 }, { count: 1.5 }, { count: Number.MAX_SAFE_INTEGER + 1 }]) {
    await run(() => window.pollingHarness.inbox.refresh()); await settle(await count() - 1, bad)
    assert.equal(await unread(), 2, 'invalid counts preserve the last confirmed count')
  }
  await run(() => window.pollingHarness.inbox.refresh()); await settle(await count() - 1, null, true); assert.equal(await unread(), 2)
  await run(() => window.pollingHarness.inbox.refresh()); await settle(await count() - 1, { count: 0 }); assert.equal(await unread(), 0, 'a legitimate zero remains zero')
  await run(() => { const h = window.pollingHarness; h.inbox.unreadCount = 4; for (const count of [NaN, Infinity, -1, 0, 0.5, '1']) h.inbox.decrementUnread(count) })
  assert.equal(await unread(), 4)
  console.log('PASS pending read gate, same-sid refresh, malformed counts, failure retry and legitimate zero')
  }
  await fresh(); await run(() => { window.pollingHarness.mounted.value = true }); assert.equal(await count(), 1)
  await run(() => { window.pollingHarness.mounted.value = false })
  assert.deepEqual(await page.eval(() => { const h = window.pollingHarness; return [h.inbox.initialized, h.timers.size, h.listeners.size] }), [false, 0, 0], 'actual layout unmount stops polling and removes its visibility listener')
  await settle(0, { count: 9 }); assert.equal(await unread(), 0)
  await run(() => { const h = window.pollingHarness; h.tick(); document.dispatchEvent(new Event('visibilitychange')); h.inbox.refresh() }); assert.equal(await count(), 1)
  console.log('PASS actual layout unmount clears timers/listeners and rejects late responses')
  await run(() => { window.pollingHarness.mounted.value = true }); assert.equal(await count(), 2)
  assert.deepEqual(await page.eval(() => [window.pollingHarness.timers.size, window.pollingHarness.listeners.size]), [1, 1])
  await settle(1, { count: 3 }); assert.equal(await unread(), 3)
  await run(() => { window.pollingHarness.mounted.value = false }); assert.equal(await unread(), 0)
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log('PASS actual layout remount starts exactly one clean polling cycle')
} finally { if (browser) await browser.close(); await server.close() }
