import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { Browser, sleep } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'
const root = fileURLToPath(new URL('..', import.meta.url)).replaceAll('\\', '/')
const require = createRequire(new URL('../client/package.json', import.meta.url))
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href), { default: vue } = await import(pathToFileURL(require.resolve('@vitejs/plugin-vue')).href)
const output = resolve(root, 'logs/notification-actions'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js'); tailwind.content = [root + '/client/src/**/*.{vue,ts,js}']
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/notification-reads', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/notification-reads/api.js' }, { find: '@', replacement: root + '/client/src' }, ...['vue', 'pinia', 'vue-i18n'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } }, server: { host: '127.0.0.1', port: 19771, strictPort: true, fs: { allow: [root] } } })
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  const run = async (fn, arg) => { const value = await page.eval(fn, arg); await sleep(40); return value }
  const fresh = async () => {
    await page.goto('http://127.0.0.1:19771', { settleMs: 180 }); const deadline = Date.now() + 10000
    while (!await page.eval(() => !!window.notificationHarness?.view() && window.notificationHarness.pending.length)) { if (Date.now() > deadline) throw Error('notification fixture unavailable'); await sleep(30) }
    await run(() => window.notificationHarness.pending[0].resolve({ channels: [{ id: 1, name: '实例到期通知', type: 'telegram', enabled: true, configPreview: '已配置' }] }))
  }
  const channel = { id: 1, name: '实例到期通知', type: 'telegram', enabled: true, configPreview: '已配置' }
  const createReply = { message: 'Notification channel added', channel: { id: 2, name: '提交的通知', type: 'telegram', enabled: true } }
  const resolveRequest = (index, value) => run(({ index, value }) => window.notificationHarness.pending[index].resolve(value), { index, value })
  const rejectRequest = index => run(index => window.notificationHarness.pending[index].reject(Error('controlled notification mutation failure')), index)
  const state = () => page.eval(() => { const v = window.notificationHarness.view(); return { busy: !!v.pendingMutation, failure: v.mutationFailure, canMutate: v.canMutate, visible: v.showAddNotification, draft: { type: v.notificationForm.type, name: v.notificationForm.name, config: { ...v.notificationForm.config } }, channels: v.notificationChannels.map(c => c.id), toasts: v.toast.toasts.value.map(t => ({ type: t.type, message: t.message })) } })
  const start = kind => run(kind => {
    const v = window.notificationHarness.view()
    if (kind === 'add') { v.showAddNotification = true; v.notificationForm = { type: 'telegram', name: '提交的通知', config: { botToken: 'controlled', chatId: '42' } }; void v.addNotificationChannel() }
    if (kind === 'delete') { window.confirm = () => true; void v.deleteNotificationChannel(1) }
    if (kind === 'toggle') void v.toggleNotificationChannel(v.notificationChannels[0])
    if (kind === 'test') void v.testNotificationChannel(1)
  }, kind)
  const reply = kind => kind === 'add' ? createReply : kind === 'toggle' ? { message: 'Notification channel enabled', enabled: true } : { message: 'Notification action completed' }
  await fresh(); await start('add')
  await run(() => { const v = window.notificationHarness.view(); void v.addNotificationChannel(); void v.toggleNotificationChannel(v.notificationChannels[0]); void v.testNotificationChannel(1); window.confirm = () => true; void v.deleteNotificationChannel(1) })
  assert.equal(await page.eval(() => window.notificationHarness.pending.length), 2, 'duplicate and overlapping writes must make one request')
  await run(() => { window.notificationHarness.view().notificationForm.name = '替换的新草稿'; window.notificationHarness.view().notificationForm.config.botToken = 'replacement' })
  assert.equal(await page.eval(() => window.notificationHarness.pending[1].data.config.botToken), 'controlled', 'submitted config is a detached snapshot')
  await resolveRequest(1, createReply); assert.equal((await state()).draft.name, '替换的新草稿'); assert.equal((await state()).visible, true)
  await resolveRequest(2, { channels: [channel] }); assert.equal((await state()).busy, false)
  console.log('PASS duplicate and overlapping writes blocked; submitted snapshot and replacement draft retained')
  await fresh(); await start('add'); await run(() => { const v = window.notificationHarness.view(); v.cancelNotificationForm(); v.showAddNotification = true; v.notificationForm = { type: 'telegram', name: '提交的通知', config: { botToken: 'controlled', chatId: '42' } } })
  await resolveRequest(1, createReply); assert.equal((await state()).visible, true, 'close/reopen equal draft has a new revision')
  await resolveRequest(2, { channels: [channel] })
  await fresh(); await start('add'); await resolveRequest(1, createReply); assert.equal((await state()).visible, false); assert.deepEqual((await state()).draft.config, {}); await resolveRequest(2, { channels: [channel] })
  console.log('PASS same-value replacement after cancel protected; only unchanged submitted draft clears on success')
  const transitions = {
    account: () => window.notificationHarness.session(2),
    sid: () => window.notificationHarness.session(1, 'replaced-notification-session'),
    role: () => window.notificationHarness.session(1, 'notification-session', 'admin'),
    aba: () => { window.notificationHarness.session(2); window.notificationHarness.session() },
    logout: () => { localStorage.removeItem('token'); window.notificationHarness.auth.syncToken() },
    cache: () => { window.notificationHarness.active.value = false },
    unmount: () => { window.notificationHarness.mounted.value = false },
    storage: () => { localStorage.setItem('token', 'fixture.' + btoa(JSON.stringify({ id: 2, sid: 'raw-new-session', role: 'user' })) + '.fixture') }
  }
  let cases = 0
  for (const kind of ['add', 'delete', 'toggle', 'test']) for (const [name, transition] of Object.entries(transitions)) for (const failed of [false, true]) {
    await fresh(); await start(kind); assert.equal((await state()).busy, true)
    await run(transition)
    if (name === 'cache') await run(() => { window.notificationHarness.active.value = true })
    if (!['unmount', 'logout', 'storage'].includes(name)) {
      const index = await page.eval(() => window.notificationHarness.pending.findLastIndex(r => r.kind === 'list'))
      await resolveRequest(index, { channels: [channel] }); assert.equal((await state()).canMutate, false, 'old write still holds lock across context reset')
      await run(() => { void window.notificationHarness.view().testNotificationChannel(1) })
    }
    const requestsBefore = await page.eval(() => window.notificationHarness.pending.length)
    if (failed) await rejectRequest(1); else await resolveRequest(1, reply(kind))
    assert.equal(await page.eval(() => window.notificationHarness.pending.length), requestsBefore, 'obsolete completion cannot reload new list')
    if (name !== 'unmount') { assert.equal((await state()).failure, '', name); assert.equal((await state()).busy, false); assert.deepEqual((await state()).toasts, [], name) }
    cases++
  }
  console.log(`PASS ${cases} obsolete mutation successes/failures across account, sid, role, ABA, logout, cache, unmount and unsynchronized storage`)
  for (const kind of ['delete', 'toggle', 'test']) {
    await fresh(); await start(kind); await start(kind); assert.equal(await page.eval(() => window.notificationHarness.pending.length), 2)
    await resolveRequest(1, reply(kind))
    if (kind !== 'test') { assert.equal((await state()).busy, true); await rejectRequest(2); assert.equal(await page.eval(() => window.notificationHarness.view().channelsError), true) }
    assert.equal((await state()).busy, false)
    if (kind === 'toggle') assert.ok((await state()).toasts[0].message.includes('启用'), 'toggle message follows returned enabled=true')
  }
  console.log('PASS each row operation remains single and toggle feedback uses authoritative enabled; reload failure stays visible')
  for (const kind of ['add', 'delete', 'toggle', 'test']) {
    await fresh(); await start(kind); await rejectRequest(1); assert.equal((await state()).failure, kind); assert.equal((await state()).busy, false)
    if (kind === 'add') assert.equal((await state()).draft.name, '提交的通知')
    await start(kind); await resolveRequest(2, reply(kind)); if (kind !== 'test') await resolveRequest(3, { channels: [channel] })
    assert.equal((await state()).failure, '')
  }
  console.log('PASS current failure preserves draft and unlocks real retry for each operation')
  const invalid = {
    add: [{}, { message: 'ok' }, { ...createReply, channel: { ...createReply.channel, id: 0 } }, { ...createReply, channel: { ...createReply.channel, enabled: 'true' } }, { ...createReply, channel: { ...createReply.channel, name: 'another draft' } }],
    toggle: [{}, { message: 'ok' }, { message: 'ok', enabled: 'false' }],
    delete: [{}, { message: '' }], test: [{}, { message: 1 }]
  }
  for (const [kind, values] of Object.entries(invalid)) for (const value of values) {
    await fresh(); await start(kind); await resolveRequest(1, value); assert.equal((await state()).failure, kind); assert.equal((await state()).busy, false); assert.deepEqual((await state()).toasts, [])
    assert.equal(await page.eval(() => window.notificationHarness.pending.length), 2)
  }
  console.log('PASS 12 malformed mutation receipts cannot report success, clear draft or trigger a reload')
  await fresh(); await run(() => { window.confirm = () => { window.notificationHarness.session(2); return true }; void window.notificationHarness.view().deleteNotificationChannel(1) })
  assert.equal(await page.eval(() => window.notificationHarness.pending.filter(r => r.kind === 'delete').length), 0, 'confirmation switch cannot delete new account channel')
  await fresh(); await run(() => { const v = window.notificationHarness.view(); void v.deleteNotificationChannel(0); void v.testNotificationChannel(99); void v.toggleNotificationChannel({ id: 1 }); v.showAddNotification = true; v.notificationForm.name = '   '; void v.addNotificationChannel() }); assert.equal(await page.eval(() => window.notificationHarness.pending.length), 1)
  await fresh(); await start('add'); await run(() => { window.notificationHarness.active.value = false }); await run(() => { window.notificationHarness.active.value = true })
  const listIndex = await page.eval(() => window.notificationHarness.pending.findLastIndex(r => r.kind === 'list')); await resolveRequest(listIndex, { channels: [channel] }); await rejectRequest(1)
  await start('test'); assert.equal((await state()).busy, true); await resolveRequest(listIndex + 1, reply('test')); assert.equal((await state()).busy, false)
  console.log('PASS invalid targets, confirmation identity switch and cache lock release')
  for (const locale of ['zh-CN', 'zh-TW', 'en']) for (const width of [1440, 768, 390]) {
    await page.setViewport({ width, height: 900 }); await fresh(); await run(locale => window.notificationHarness.setLocale(locale), locale)
    await run(() => document.querySelectorAll('.notification-heading button')[1].click())
    await run(() => {
      const fill = (id, value) => { const input = document.getElementById(id); input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })) }
      fill('notification-channel-name', '提交的通知'); fill('notification-bot-token', 'controlled'); fill('notification-chat-id', '42')
    })
    await run(() => { document.querySelector('.notification-section .btn-primary').click(); document.querySelector('.notification-section .btn-primary').click() })
    assert.equal(await page.eval(() => window.notificationHarness.pending.length), 2)
    await rejectRequest(1)
    assert.ok(await page.eval(() => !!document.querySelector('.notification-section [role="alert"]')))
    await run(() => document.querySelector('.notification-section .btn-primary').click()); await resolveRequest(2, createReply); await resolveRequest(3, { channels: [channel] })
    assert.equal((await state()).visible, false)
    await run(() => document.querySelector('.notification-section button[aria-label]')?.click()); await resolveRequest(4, reply('test'))
    await run(() => document.querySelector('.notification-channel-identity').parentElement.nextElementSibling.querySelectorAll('button')[1].click()); await resolveRequest(5, reply('toggle')); await resolveRequest(6, { channels: [channel] })
    await run(() => { window.confirm = () => true; document.querySelector('.notification-channel-identity').parentElement.nextElementSibling.querySelectorAll('button')[2].click() }); await resolveRequest(7, reply('delete')); await resolveRequest(8, { channels: [] })
    assert.deepEqual((await state()).channels, [])
  }
  console.log('PASS actual form inputs, duplicate save, visible failure/retry and all row buttons in three locales and widths')
  for (const locale of ['zh-CN', 'zh-TW', 'en']) for (const width of [1440, 768, 390]) for (const theme of ['light', 'dark']) {
    await page.setViewport({ width, height: 900 }); await fresh()
    await run(({ locale, theme }) => { window.notificationHarness.setLocale(locale); window.notificationHarness.theme.setTheme(theme); window.notificationHarness.view().showAddNotification = true }, { locale, theme })
    for (const type of ['telegram', 'discord', 'webhook']) {
      await run(type => { const v = window.notificationHarness.view(); v.notificationForm.type = type; v.notificationForm.config = {}; v.notificationForm.name = '通知'.repeat(25) }, type)
      const labels = await page.eval(() => [...document.querySelectorAll('.notification-section input,.notification-section select')].map(e => ({ id: e.id, label: !!document.querySelector(`label[for="${e.id}"]`), height: e.getBoundingClientRect().height })))
      assert.ok(labels.every(e => e.label && e.height >= 44), JSON.stringify({ locale, width, theme, type, labels }))
      assert.ok(await page.eval(() => document.documentElement.scrollWidth <= innerWidth))
    }
    if (locale === 'zh-CN') await page.screenshot({ path: resolve(output, `form-${theme}-${width}.png`), format: 'png' })
    await run(() => { const v = window.notificationHarness.view(); v.notificationForm.config.secret = 'controlled'; v.cancelNotificationForm() })
    assert.deepEqual((await state()).draft.config, {})
  }
  console.log('PASS 18 form locale/width/theme layouts, all three channel controls labelled and 44px, long name, secret clearing')
  assert.deepEqual(page.consoleErrors, [])
  if (process.argv.includes('--inspect')) {
    writeFileSync(resolve(output, 'direction.json'), JSON.stringify({ kind: 'app', style: { name: 'Achromatic ledger' }, seed: 242843060, input: { keep: ['palette', 'type'] } }))
    for (const theme of ['light', 'dark']) {
      const code = await new Promise((resolveCode, reject) => {
        const child = spawn(process.execPath, [root + '/.agents/skills/design-taste-frontend/scripts/inspect.mjs', `http://127.0.0.1:19771/?preview=form&theme=${theme}`, '--app', '--out', resolve(output, `inspect-${theme}`)], { cwd: root, stdio: 'inherit', env: process.env })
        child.on('error', reject); child.on('close', resolveCode)
      })
      assert.equal(code, 0, `taste form ${theme} inspector`)
    }
  }
} finally { if (browser) await browser.close(); await server.close() }
