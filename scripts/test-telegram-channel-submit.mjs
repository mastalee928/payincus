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
const output = resolve(root, 'logs/telegram-channel-submit'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const server = await createServer({ configFile: false, root: root + '/scripts/fixtures/telegram-config', plugins: [vue()], resolve: {
  alias: [{ find: /^@\/api\/admin$/, replacement: root + '/scripts/fixtures/telegram-config/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-router', 'vue-i18n'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-router', 'vue-i18n'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } }, server: { host: '127.0.0.1', port: 19648, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(40); return result }
  const check = async (fn, message) => { for (let i = 0; i < 100; i++) { if (await page.eval(fn)) return; await sleep(50) } assert.fail(message) }
  const latest = kind => page.eval(kind => window.telegramHarness.pending.findLastIndex(item => item.kind === kind), kind)
  const settle = (index, data, fail = false) => run(({ index, data, fail }) => { const item = window.telegramHarness.pending[index]; fail ? item.reject(new Error('Isolated submit failure')) : item.resolve(data) }, { index, data, fail })
  const success = mode => mode === 'create' ? { message: 'Global notification channel created', channel: { id: 3, name: 'Current channel', type: 'telegram', enabled: true } } : { message: 'Channel updated' }
  const fresh = async mode => {
    await page.goto('http://127.0.0.1:19648', { settleMs: 250 }); await check(() => !!window.telegramHarness?.view(), 'actual Telegram setup')
    await run(() => { const group = { enabled: false, configured: false, joinMode: 'any', minRecharge: 0, minConsume: 0 }; for (const item of window.telegramHarness.pending) if (item.kind === 'configs') item.resolve({ configs: [] }); else if (item.kind === 'channels') item.resolve({ channels: [] }); else if (item.kind === 'bindings') item.resolve({ bindings: [], total: 0, page: 1, pageSize: 5, group, vipGroup: group }) })
    await run(mode => { const v = window.telegramHarness.view(); mode === 'create' ? v.openCreateChannelForm() : void v.openEditChannelForm({ id: 1 }) }, mode)
    if (mode === 'update') await settle(await latest('channel'), { channel: { id: 1, name: 'Current channel', type: 'telegram', enabled: true, config: { botToken: 'fixture...masked', chatId: '-1' } } })
    await run(() => { const v = window.telegramHarness.view(); v.channelForm = { name: 'Current channel', chatId: '-1', enabled: true, botToken: v.editingChannel ? 'fixture...masked' : '123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi' } })
  }
  const save = () => run(() => { void window.telegramHarness.view().saveChannel() })
  await fresh('create'); await save()
  assert.equal(await page.eval(() => { const inputs = Array.from(document.querySelectorAll('[data-channel-fields] input')); return inputs.length === 4 && inputs.every(el => el.disabled) }), true, 'fields frozen during save')
  let staleCases = 0
  for (const mode of ['create', 'update']) for (const change of ['session', 'session-aba', 'account', 'role', 'cache', 'cache-aba', 'unmount', 'draft', 'draft-aba']) for (const fail of [false, true]) {
    await fresh(mode); await save(); const index = await latest(mode)
    await run(async change => { const h = window.telegramHarness, v = h.view(); window.oldTelegramSubmit = v
      if (change === 'session') h.session('b')
      if (change === 'session-aba') { h.session('b'); h.session('a') }
      if (change === 'account') h.auth.user = { ...h.auth.user, id: 2 }
      if (change === 'role') h.auth.user = { ...h.auth.user, role: 'user' }
      if (change === 'cache') await h.router.push('/other')
      if (change === 'cache-aba') { await h.router.push('/other'); await h.nextTick(); await h.router.push('/settings/telegram') }
      if (change === 'unmount') h.shown.value = false
      if (change === 'draft') v.channelForm.name = 'New draft'
      if (change === 'draft-aba') { v.channelForm.name = 'New draft'; v.channelForm.name = 'Current channel' }
    }, change)
    const before = await page.eval(() => ({ toasts: window.telegramHarness.events.length, lists: window.telegramHarness.pending.filter(x => x.kind === 'channels').length }))
    await settle(index, success(mode), fail)
    assert.deepEqual(await page.eval(() => ({ toasts: window.telegramHarness.events.length, lists: window.telegramHarness.pending.filter(x => x.kind === 'channels').length })), before, mode + ' old receipt ' + change)
    assert.equal(await page.eval(() => window.oldTelegramSubmit.savingChannel), false); staleCases++
  }
  for (const mode of ['create', 'update']) {
    await fresh(mode); await save(); await save(); assert.equal(await page.eval(mode => window.telegramHarness.pending.filter(item => item.kind === mode).length, mode), 1)
    await run(() => { const v = window.telegramHarness.view(); v.closeChannelForm(); v.openCreateChannelForm(); void v.openEditChannelForm({ id: 2 }) })
    assert.equal(await page.eval(() => window.telegramHarness.view().showChannelForm), true)
    const payload = await page.eval(mode => window.telegramHarness.pending.findLast(item => item.kind === mode).data, mode)
    assert.equal(mode === 'create' ? payload.name : payload.data.name, 'Current channel')
    if (mode === 'update') assert.equal(Object.hasOwn(payload.data, 'botToken'), false, 'masked token omitted')
    await settle(await latest(mode), null, true); assert.equal(await page.eval(() => window.telegramHarness.view().channelForm.name), 'Current channel')
    await save(); const index = await latest(mode); await run(() => window.telegramHarness.session('a', 2)); await settle(index, success(mode))
    assert.equal(await page.eval(() => window.telegramHarness.view().showChannelForm), false, 'confirmed success closes current editor')
    assert.equal(await page.eval(() => window.telegramHarness.view().channelForm.botToken), '', 'confirmed success clears secret')
  }
  for (const mode of ['create', 'update']) for (const invalid of [null, {}, { message: '' }, { message: '   ' }, ...(mode === 'create' ? [{ message: 'Created', channel: null }, { message: 'Created', channel: { id: 0, name: 'Current channel', type: 'telegram', enabled: true } }] : [])]) {
    await fresh(mode); await save(); const lists = await page.eval(() => window.telegramHarness.pending.filter(x => x.kind === 'channels').length); await settle(await latest(mode), invalid)
    assert.equal(await page.eval(() => window.telegramHarness.view().showChannelForm), true)
    assert.equal(await page.eval(() => !!window.telegramHarness.view().channelFormError), true)
    assert.equal(await page.eval(() => window.telegramHarness.pending.filter(x => x.kind === 'channels').length), lists)
  }
  await fresh('update'); await run(() => { const v = window.telegramHarness.view(); v.channelForm.botToken = 'changed...masked'; void v.saveChannel() })
  assert.equal(await page.eval(() => window.telegramHarness.pending.findLast(x => x.kind === 'update').data.data.botToken), 'changed...masked', 'edited masked-looking token reaches server validation')
  await fresh('create'); await run(() => { void window.telegramHarness.view().loadChannels() }); const oldList = await latest('channels')
  await run(() => { window.telegramHarness.session('b'); window.telegramHarness.session('a') }); const currentList = await latest('channels')
  await settle(oldList, { channels: [{ id: 1, name: 'Obsolete channel' }] })
  assert.equal(await page.eval(() => window.telegramHarness.view().channelLoading), true, 'old list finally keeps new loader')
  await settle(currentList, { channels: [] }); assert.equal(await page.eval(() => window.telegramHarness.view().globalChannels.length), 0)
  for (const [locale, width, dark] of [['zh-CN', 1440, false], ['zh-TW', 768, false], ['en', 390, true]]) {
    await fresh('create'); await run(({ locale, dark }) => { const h = window.telegramHarness; h.setLocale(locale); h.theme.setTheme(dark ? 'dark' : 'light') }, { locale, dark }); await save(); await settle(await latest('create'), null, true)
    await page.setViewport({ width, height: 1000, mobile: width === 390 }); await run(() => document.querySelector('[data-channel-fields]').scrollIntoView({ block: 'center' })); await sleep(120)
    await page.screenshot({ path: resolve(output, locale + '-' + width + '.png'), format: 'png' })
  }
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log(`PASS actual Telegram channel create/update frozen fields, ${staleCases} stale receipts, busy/close gates, confirmed receipts, masked token and same sid; no real channel writes`)
} finally { if (browser) await browser.close(); await server.close() }
