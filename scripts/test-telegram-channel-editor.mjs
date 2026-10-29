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
const output = resolve(root, 'logs/telegram-channel-editor'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const server = await createServer({ configFile: false, root: root + '/scripts/fixtures/telegram-config', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api\/admin$/, replacement: root + '/scripts/fixtures/telegram-config/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-router', 'vue-i18n'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-router', 'vue-i18n'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } }, server: { host: '127.0.0.1', port: 19647, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(40); return result }
  const check = async (fn, message) => { for (let i = 0; i < 100; i++) { if (await page.eval(fn)) return; await sleep(50) } assert.fail(message) }
  const detail = (id, name = `Channel ${id}`) => ({ channel: { id, name, type: 'telegram', enabled: false, config: { botToken: 'fixture...masked', chatId: '-1' } } })
  const latest = () => page.eval(() => window.telegramHarness.pending.findLastIndex(item => item.kind === 'channel'))
  const settle = (index, data, fail = false) => run(({ index, data, fail }) => { const item = window.telegramHarness.pending[index]; fail ? item.reject(new Error('Isolated channel failure')) : item.resolve(data) }, { index, data, fail })
  const open = id => run(id => { void window.telegramHarness.view().openEditChannelForm({ id, name: `Channel ${id}`, type: 'telegram', enabled: false }) }, id)
  const fresh = async () => {
    await page.goto('http://127.0.0.1:19647', { settleMs: 250 }); await check(() => !!window.telegramHarness?.view(), 'actual Telegram setup')
    await run(() => { const group = { enabled: false, configured: false, joinMode: 'any', minRecharge: 0, minConsume: 0 }; for (const item of window.telegramHarness.pending) if (item.kind === 'configs') item.resolve({ configs: [] }); else if (item.kind === 'channels') item.resolve({ channels: [] }); else if (item.kind === 'bindings') item.resolve({ bindings: [], total: 0, page: 1, pageSize: 5, group, vipGroup: group }) })
  }
  await fresh(); await open(1); const old = await latest(); await open(2); const current = await latest()
  await settle(current, detail(2)); await settle(old, detail(1, 'Obsolete channel'))
  assert.equal(await page.eval(() => window.telegramHarness.view().editingChannel.id), 2, 'old detail cannot replace current editor')
  for (const fail of [false, true]) {
    await fresh(); await open(1); const old = await latest(); await open(2); const current = await latest()
    await settle(old, detail(1), fail); assert.equal(await page.eval(() => window.telegramHarness.view().channelDetailLoading), true)
    await settle(current, detail(2)); assert.equal(await page.eval(() => window.telegramHarness.view().channelFormReady), true)
  }
  let staleCases = 0
  for (const change of ['create', 'close', 'close-reopen', 'session', 'session-aba', 'account', 'role', 'cache', 'cache-aba', 'unmount']) for (const fail of [false, true]) {
    await fresh(); await open(1); const index = await latest()
    await run(async change => { const h = window.telegramHarness, v = h.view(); window.oldTelegramEditor = v
      if (change === 'create') v.openCreateChannelForm()
      if (change === 'close') v.closeChannelForm()
      if (change === 'close-reopen') { v.closeChannelForm(); void v.openEditChannelForm({ id: 1, name: 'Channel 1' }) }
      if (change === 'session') h.session('b')
      if (change === 'session-aba') { h.session('b'); h.session('a') }
      if (change === 'account') h.auth.user = { ...h.auth.user, id: 2 }
      if (change === 'role') h.auth.user = { ...h.auth.user, role: 'user' }
      if (change === 'cache') await h.router.push('/other')
      if (change === 'cache-aba') { await h.router.push('/other'); await h.nextTick(); await h.router.push('/settings/telegram') }
      if (change === 'unmount') h.shown.value = false
    }, change)
    const toasts = await page.eval(() => window.telegramHarness.events.length)
    await settle(index, detail(1, 'Obsolete channel'), fail)
    assert.equal(await page.eval(() => window.oldTelegramEditor.channelForm.name === 'Obsolete channel'), false)
    assert.equal(await page.eval(() => window.telegramHarness.events.length), toasts); staleCases++
  }
  await fresh(); await open(1); await run(() => { const v = window.telegramHarness.view(); v.channelForm.name = 'Premature draft'; v.channelForm.chatId = '-1'; void v.saveChannel() })
  assert.equal(await page.eval(() => window.telegramHarness.pending.some(item => ['create', 'update'].includes(item.kind))), false, 'no writes until current detail ready')
  for (const invalid of [null, {}, detail(2), { channel: null }, { channel: { ...detail(1).channel, enabled: 1 } }, { channel: { ...detail(1).channel, type: 'email' } }, { channel: { ...detail(1).channel, config: [] } }, { channel: { ...detail(1).channel, config: { botToken: 1, chatId: '-1' } } }]) {
    await fresh(); await open(1); await settle(await latest(), invalid)
    assert.equal(await page.eval(() => window.telegramHarness.view().channelFormReady), false)
    assert.equal(await page.eval(() => !!document.querySelector('[data-channel-retry]')), true)
  }
  await fresh(); await open(1); const same = await latest(); const before = await page.eval(() => window.telegramHarness.pending.length)
  await run(() => window.telegramHarness.session('a', 2)); assert.equal(await page.eval(() => window.telegramHarness.pending.length), before)
  await settle(same, detail(1)); assert.equal(await page.eval(() => window.telegramHarness.view().channelForm.enabled), false)
  await run(() => { const v = window.telegramHarness.view(); v.closeChannelForm() })
  assert.equal(await page.eval(() => window.telegramHarness.view().channelForm.botToken), '', 'closing clears secret draft')
  for (const [locale, width, dark] of [['zh-CN', 1440, false], ['zh-TW', 768, false], ['en', 390, true]]) {
    await run(({ locale, dark }) => { const h = window.telegramHarness; h.setLocale(locale); h.theme.setTheme(dark ? 'dark' : 'light') }, { locale, dark }); await open(1); await settle(await latest(), null, true)
    await page.setViewport({ width, height: 1000, mobile: width === 390 }); await run(() => document.querySelector('[data-channel-retry]').scrollIntoView({ block: 'center' })); await sleep(120)
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true); await page.screenshot({ path: resolve(output, locale + '-' + width + '.png'), format: 'png' })
    await run(() => document.querySelector('[data-channel-retry]').click()); await settle(await latest(), detail(1)); assert.equal(await page.eval(() => window.telegramHarness.view().channelFormReady), true)
    await run(() => window.telegramHarness.view().closeChannelForm())
  }
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log(`PASS actual Telegram channel editor order/loading, ${staleCases} stale reads, ready gate, eight invalid receipts, DOM retry, same sid and close cleanup; deferred API, no real channel writes`)
} finally { if (browser) await browser.close(); await server.close() }
