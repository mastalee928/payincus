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
const output = resolve(root, 'logs/avatar-submit'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js')
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/avatar/*.js']
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/avatar', publicDir: root + '/client/public',
  plugins: [vue(), { name: 'isolated-avatar-pictures', configureServer(server) { server.middlewares.use('/avatar', (_request, response) => { response.setHeader('Content-Type', 'image/svg+xml'); response.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#eee"/><text x="32" y="40" text-anchor="middle" font-size="24">A</text></svg>') }) } }],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/avatar/api.js' }, { find: '@', replacement: root + '/client/src' }, ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } }, server: { host: '127.0.0.1', port: 19731, strictPort: true, fs: { allow: [root] } },
})
let browser, stale = 0
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  const run = async (fn, arg) => { const value = await page.eval(fn, arg); await sleep(45); return value }
  const fresh = async (settleRead = true) => {
    await page.goto('http://127.0.0.1:19731', { settleMs: 300 })
    const deadline = Date.now() + 15000
    while (!await page.eval(() => !!window.avatarHarness?.view())) { if (Date.now() > deadline) throw Error('Avatar fixture did not mount: ' + page.consoleErrors.join('\n')); await sleep(70) }
    if (settleRead) await run(() => { const h = window.avatarHarness; for (const x of h.pending) if (x.kind === 'read') x.resolve({ user: { ...h.auth.user } }) })
  }
  await fresh()
  await run(() => { const v = window.avatarHarness.view(); v.selectedAvatarStyle = 'identicon'; void v.saveAvatarStyle(); v.selectedAvatarStyle = 'rings' })
  assert.deepEqual(await page.eval(() => window.avatarHarness.pending.findLast(x => x.kind === 'update').data), { avatarStyle: 'identicon' })
  await run(() => window.avatarHarness.pending.findLast(x => x.kind === 'update').resolve({ message: 'User updated successfully' }))
  assert.equal(await page.eval(() => window.avatarHarness.auth.user.avatarStyle), 'identicon', 'actual completion persists submitted style rather than later unsaved selection')
  assert.equal(await page.eval(() => window.avatarHarness.view().selectedAvatarStyle), 'rings', 'later selection remains unsaved draft')
  assert.equal(await page.eval(() => window.avatarHarness.view().hasAvatarChanged), true)
  await fresh()
  await run(() => { const v = window.avatarHarness.view(); v.selectedAvatarStyle = 'identicon'; void v.saveAvatarStyle(); void v.saveAvatarStyle() })
  assert.equal(await page.eval(() => window.avatarHarness.pending.filter(x => x.kind === 'update').length), 1, 'same-turn duplicate save rejected')
  assert.equal(await page.eval(() => [...document.querySelectorAll('button[title]')].every(x => x.disabled)), true, 'style selection disabled while request is pending')
  await run(() => window.avatarHarness.pending.findLast(x => x.kind === 'update').reject(Error('Fixture unavailable')))
  assert.equal(await page.eval(() => window.avatarHarness.view().savingAvatar), false)
  await run(() => { void window.avatarHarness.view().saveAvatarStyle() })
  await run(() => window.avatarHarness.pending.findLast(x => x.kind === 'update').resolve({ message: 'User updated successfully' }))
  assert.equal(await page.eval(() => window.avatarHarness.auth.user.avatarStyle), 'identicon')
  for (const mode of ['sid', 'account', 'role', 'logout', 'session-aba', 'cache', 'unmount']) for (const reject of [false, true]) {
    await fresh()
    await run(() => { const v = window.avatarHarness.view(); v.selectedAvatarStyle = 'identicon'; void v.saveAvatarStyle() })
    await run(async mode => { const h = window.avatarHarness
      if (mode === 'sid') h.session(1, 'other-session')
      if (mode === 'account') h.session(2)
      if (mode === 'role') h.session(1, 'avatar-session', 'admin')
      if (mode === 'logout') h.auth.clearLocalAuth()
      if (mode === 'session-aba') { h.session(2); await Promise.resolve(); h.session(1) }
      if (mode === 'cache') h.active.value = false
      if (mode === 'unmount') h.mounted.value = false
    }, mode)
    const before = await page.eval(() => ({ user: JSON.stringify(window.avatarHarness.auth.user), toasts: window.avatarHarness.toast.toasts.value.length, selected: window.avatarHarness.view().selectedAvatarStyle }))
    await run(reject => { const x = window.avatarHarness.pending.findLast(x => x.kind === 'update'); if (reject) x.reject(Error('stale write')); else x.resolve({ message: 'User updated successfully' }) }, reject)
    assert.deepEqual(await page.eval(() => ({ user: JSON.stringify(window.avatarHarness.auth.user), toasts: window.avatarHarness.toast.toasts.value.length, selected: window.avatarHarness.view().selectedAvatarStyle })), before, mode + ': stale avatar receipt cannot update current user/draft or notify'); stale++
  }
  await fresh(); await run(() => { const h = window.avatarHarness, v = h.view(); v.selectedAvatarStyle = 'identicon'; void v.saveAvatarStyle(); h.auth.token = 'fixture.' + btoa(JSON.stringify({ sid: 'avatar-session', revision: 2 })) + '.fixture' })
  await run(() => window.avatarHarness.pending.findLast(x => x.kind === 'update').resolve({ message: 'User updated successfully' }))
  assert.equal(await page.eval(() => window.avatarHarness.auth.user.avatarStyle), 'identicon', 'same sid token refresh preserves valid completion')
  for (const bad of [null, {}, { message: '' }, { message: ' ' }]) {
    await fresh(); await run(() => { const v = window.avatarHarness.view(); v.selectedAvatarStyle = 'identicon'; void v.saveAvatarStyle() })
    await run(bad => window.avatarHarness.pending.findLast(x => x.kind === 'update').resolve(bad), bad)
    assert.equal(await page.eval(() => window.avatarHarness.auth.user.avatarStyle), 'initials', 'malformed receipt cannot persist avatar')
    assert.equal(await page.eval(() => window.avatarHarness.view().hasAvatarChanged), true)
    assert.equal(await page.eval(() => !!window.avatarHarness.view().avatarError), true)
  }
  for (const mode of ['sid', 'account', 'role', 'logout', 'session-aba', 'cache', 'unmount']) for (const reject of [false, true]) {
    await fresh(false)
    await run(async mode => { const h = window.avatarHarness; h.oldRead = h.pending.findLast(x => x.kind === 'read')
      if (mode === 'sid') h.session(1, 'other-session')
      if (mode === 'account') h.session(2)
      if (mode === 'role') h.session(1, 'avatar-session', 'admin')
      if (mode === 'logout') h.auth.clearLocalAuth()
      if (mode === 'session-aba') { h.session(2); await Promise.resolve(); h.session(1) }
      if (mode === 'cache') h.active.value = false
      if (mode === 'unmount') h.mounted.value = false
    }, mode)
    const before = await page.eval(() => ({ user: JSON.stringify(window.avatarHarness.view().userDetails), loading: window.avatarHarness.view().loading, error: window.avatarHarness.view().detailError }))
    await run(reject => { const h = window.avatarHarness; if (reject) h.oldRead.reject(Error('stale read')); else h.oldRead.resolve({ user: { id: 1, username: 'stale details' } }) }, reject)
    assert.deepEqual(await page.eval(() => ({ user: JSON.stringify(window.avatarHarness.view().userDetails), loading: window.avatarHarness.view().loading, error: window.avatarHarness.view().detailError })), before, mode + ': stale account details do not alter current data or loader')
    if (mode === 'cache') {
      const n = await page.eval(() => window.avatarHarness.pending.length)
      await run(() => { window.avatarHarness.active.value = true })
      assert.equal(await page.eval(() => window.avatarHarness.pending.length), n + 1, 'cache activation reloads details once')
    }
  }
  await fresh(false)
  await run(() => { void window.avatarHarness.view().loadUserDetails() })
  await run(() => window.avatarHarness.pending.findLast(x => x.kind === 'read').resolve({ user: { id: 1, username: 'newest detail' } }))
  await run(() => window.avatarHarness.pending.find(x => x.kind === 'read').resolve({ user: { id: 1, username: 'older detail' } }))
  assert.equal(await page.eval(() => window.avatarHarness.view().userDetails.username), 'newest detail', 'last requested detail wins out of order')
  for (const bad of [null, {}, { user: { id: 2 } }]) {
    await fresh(false); await run(bad => window.avatarHarness.pending.findLast(x => x.kind === 'read').resolve(bad), bad)
    assert.equal(await page.eval(() => !!window.avatarHarness.view().detailError), true)
    await run(() => [...document.querySelectorAll('[role="alert"] button')].find(x => x.textContent.trim() === window.avatarHarness.t('common.retry')).click())
    await run(() => { const h = window.avatarHarness; h.pending.findLast(x => x.kind === 'read').resolve({ user: { ...h.auth.user } }) })
    assert.equal(await page.eval(() => window.avatarHarness.view().detailError), '', 'actual detail retry clears error')
  }
  for (const [locale, width] of [['zh-CN', 1440], ['zh-TW', 768], ['en', 390]]) {
    await fresh(); await page.setViewport({ width, height: 1000, mobile: width === 390 })
    await run(locale => { const h = window.avatarHarness; h.setLocale(locale); h.theme.setTheme(innerWidth === 390 ? 'dark' : 'light'); h.view().avatarExpanded = true; h.view().selectedAvatarStyle = 'identicon' }, locale)
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: resolve(output, locale + '-' + width + '.png'), format: 'png' })
  }
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log(`PASS actual AccountSection submitted avatar persistence, duplicate busy, ${stale} stale write and 14 stale read session/cache/unmount receipts, same sid, malformed receipts and detail DOM retries; actual avatar component uses isolated local image boundary`)
} finally { if (browser) await browser.close(); await server.close() }
