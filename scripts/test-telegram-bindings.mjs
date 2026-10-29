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
tailwind.content = [root + '/client/src/**/*.{vue,ts,js}', root + '/scripts/fixtures/telegram-config/*.js']
const output = resolve(root, 'logs/telegram-bindings'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const server = await createServer({ configFile: false, root: root + '/scripts/fixtures/telegram-config', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api\/admin$/, replacement: root + '/scripts/fixtures/telegram-config/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-router', 'vue-i18n'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-router', 'vue-i18n'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } }, server: { host: '127.0.0.1', port: 19646, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(35); return result }
  const check = async (fn, message) => { for (let i = 0; i < 100; i++) { if (await page.eval(fn)) return; await sleep(50) } assert.fail(message) }
  const group = { enabled: false, configured: false, joinMode: 'any', minRecharge: 0, minConsume: 0 }
  const response = (username, page = 1) => ({ bindings: username ? [{ id: 1, userId: 1, user: { id: 1, username, email: 'isolated@example.invalid', status: 'active' }, telegramUserId: '1', telegramUsername: null, firstName: null, lastName: null, boundAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(), stats: { totalRecharge: 0, totalConsume: 0, totalRefund: 0, totalDestroyedValue: 0 }, eligibility: { ...group, eligible: false, status: 'disabled', message: '' }, vipEligibility: { ...group, eligible: false, status: 'disabled', message: '' } }] : [], total: username ? 11 : 0, page, pageSize: 5, group, vipGroup: group })
  const latest = () => page.eval(() => window.telegramHarness.pending.findLastIndex(item => item.kind === 'bindings'))
  const settle = async (index, data, fail = false) => run(({ index, data, fail }) => { const item = window.telegramHarness.pending[index]; fail ? item.reject(new Error('Isolated binding failure')) : item.resolve(data) }, { index, data, fail })
  const fresh = async () => {
    await page.goto('http://127.0.0.1:19646', { settleMs: 250 }); await check(() => !!window.telegramHarness?.view(), 'actual Telegram setup')
    await run(() => { for (const item of window.telegramHarness.pending) if (item.kind === 'configs') item.resolve({ configs: [] }); else if (item.kind === 'channels') item.resolve({ channels: [] }) })
    await settle(await latest(), response('Initial user'))
  }
  const search = text => run(text => { const v = window.telegramHarness.view(); v.bindingSearch = text; void v.searchTelegramBindings() }, text)
  await fresh(); await search('old'); const old = await latest(); await search('current'); const current = await latest()
  await settle(current, response('Current user')); await settle(old, response('Obsolete user'))
  assert.equal(await page.eval(() => window.telegramHarness.view().telegramBindings[0].user.username), 'Current user', 'old search cannot overwrite current users')
  for (const fail of [false, true]) {
    await fresh(); await search('old'); const old = await latest(); await search('new'); const current = await latest()
    await settle(old, response('Obsolete user'), fail)
    assert.equal(await page.eval(() => window.telegramHarness.view().bindingLoading), true, 'old finally keeps current loader')
    await settle(current, response('New user')); assert.equal(await page.eval(() => window.telegramHarness.view().telegramBindings[0].user.username), 'New user')
  }
  let staleCases = 0
  for (const change of ['draft', 'draft-aba', 'session', 'session-aba', 'account', 'role', 'cache', 'cache-aba', 'unmount']) for (const fail of [false, true]) {
    await fresh(); await search('pending'); const index = await latest()
    await run(async change => { const h = window.telegramHarness, v = h.view(); window.oldTelegramView = v
      if (change === 'draft') v.bindingSearch = 'new draft'
      if (change === 'draft-aba') { v.bindingSearch = 'new draft'; v.bindingSearch = 'pending' }
      if (change === 'session') h.session('b')
      if (change === 'session-aba') { h.session('b'); h.session('a') }
      if (change === 'account') h.auth.user = { ...h.auth.user, id: 2 }
      if (change === 'role') h.auth.user = { ...h.auth.user, role: 'user' }
      if (change === 'cache') await h.router.push('/other')
      if (change === 'cache-aba') { await h.router.push('/other'); await h.nextTick(); await h.router.push('/settings/telegram') }
      if (change === 'unmount') h.shown.value = false
    }, change)
    const toasts = await page.eval(() => window.telegramHarness.events.length)
    await settle(index, response('Obsolete user'), fail)
    assert.equal(await page.eval(() => window.oldTelegramView.telegramBindings.some(item => item.user?.username === 'Obsolete user')), false)
    assert.equal(await page.eval(() => window.telegramHarness.events.length), toasts, 'old error remains silent'); staleCases++
  }
  await fresh(); await search('pending'); const same = await latest(); const before = await page.eval(() => window.telegramHarness.pending.length)
  await run(() => window.telegramHarness.session('a', 2)); assert.equal(await page.eval(() => window.telegramHarness.pending.length), before)
  await settle(same, response('Same sid user')); assert.equal(await page.eval(() => window.telegramHarness.view().telegramBindings[0].user.username), 'Same sid user')
  await fresh(); await run(() => { void window.telegramHarness.view().goTelegramBindingsPage(2) }); const oldPage = await latest()
  await run(() => { void window.telegramHarness.view().goTelegramBindingsPage(3) }); const newPage = await latest()
  await settle(oldPage, response('Obsolete page', 2)); assert.equal(await page.eval(() => window.telegramHarness.view().bindingLoading), true)
  await settle(newPage, response('Page three', 3)); assert.equal(await page.eval(() => window.telegramHarness.view().telegramBindingsPage), 3)
  assert.equal(await page.eval(() => window.telegramHarness.view().telegramBindings[0].user.username), 'Page three')
  for (const invalid of [null, {}, { ...response(null), bindings: null }, { ...response(null), total: -1 }, { ...response(null), page: 0 }, { ...response(null), page: 2 }, { ...response(null), pageSize: 0 }, { ...response(null), group: null }, { ...response('Invalid'), bindings: [{}] }]) {
    await fresh(); await search('invalid'); await settle(await latest(), invalid)
    assert.equal(await page.eval(() => !!window.telegramHarness.view().bindingError), true, 'invalid receipt stays error')
    assert.equal(await page.eval(() => !!document.querySelector('[data-binding-retry]')), true, 'persistent DOM retry')
  }
  await fresh(); await search('error'); await settle(await latest(), null, true)
  await run(() => document.querySelector('[data-binding-retry]').click()); await settle(await latest(), response(null))
  assert.equal(await page.eval(() => window.telegramHarness.view().telegramBindingsTotal), 0)
  assert.equal(await page.eval(() => window.telegramHarness.view().bindingError), '')
  for (const [locale, width, dark] of [['zh-CN', 1440, false], ['zh-TW', 768, false], ['en', 390, true]]) {
    await run(({ locale, dark }) => { const h = window.telegramHarness; h.setLocale(locale); h.theme.setTheme(dark ? 'dark' : 'light'); void h.view().loadTelegramBindings() }, { locale, dark })
    await settle(await latest(), null, true); await page.setViewport({ width, height: 1000, mobile: width === 390 }); await run(() => document.querySelector('[data-binding-retry]').scrollIntoView({ block: 'center' })); await sleep(120)
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: resolve(output, locale + '-' + width + '.png'), format: 'png' })
  }
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log(`PASS actual Telegram bindings search order/loading, ${staleCases} stale receipts, same sid, invalid receipts and persistent retry/zero; deferred API with no real Telegram requests`)
} finally { if (browser) await browser.close(); await server.close() }
