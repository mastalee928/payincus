import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { Browser, sleep } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'
const root = fileURLToPath(new URL('..', import.meta.url)).replaceAll('\\', '/'), require = createRequire(new URL('../client/package.json', import.meta.url))
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href), { default: vue } = await import(pathToFileURL(require.resolve('@vitejs/plugin-vue')).href)
const output = resolve(root, 'logs/inbox-receipts'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const port = process.argv.includes('--serve') ? 19765 : 19764
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js'); tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/inbox/*.js']
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/inbox', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/inbox/api.js' }, { find: '@', replacement: root + '/client/src' }, ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } }, server: { host: '127.0.0.1', port, strictPort: true, fs: { allow: [root] } }
})
const message = (id = 1, userId = 1, isRead = false) => ({ id, userId, isRead, eventType: 'system', title: `通知 ${id}`, content: '实际站内信组件，受控测试消息。', data: null, createdAt: '2026-10-29T00:00:00Z' })
const result = (page = 1, total = 1, messages = [message()]) => ({ messages, total, page, pageSize: 20, totalPages: Math.ceil(total / 20) })
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  const run = async (fn, arg) => { const value = await page.eval(fn, arg); await sleep(70); return value }
  const fresh = async () => {
    await page.goto(`http://127.0.0.1:${port}`, { settleMs: 300 }); const deadline = Date.now() + 15000
    while (!await page.eval(() => !!window.inboxHarness?.view() && window.inboxHarness.pending.length > 0)) { if (Date.now() > deadline) throw Error('inbox fixture did not mount: ' + page.consoleErrors.join('\n')); await sleep(70) }
  }
  const settle = (index, data, fail = false) => run(({ index, data, fail }) => { const request = window.inboxHarness.pending[index]; fail ? request.reject(Error('fixture inbox unavailable')) : request.resolve(data) }, { index, data, fail })
  const last = kind => page.eval(kind => window.inboxHarness.pending.findLastIndex(request => request.kind === kind), kind)
  const read = key => page.eval(key => JSON.parse(JSON.stringify(window.inboxHarness.view()[key])), key)
  if (process.argv.includes('--serve')) { console.log(`Inbox fixture http://127.0.0.1:${port}/?inspect`); await new Promise(() => {}) }
  if (!process.argv.includes('--controls-only')) {
  await fresh(); await run(() => { void window.inboxHarness.view().loadMessages() }); await settle(1, result(1, 1, [message(2)])); await settle(0, result())
  assert.equal((await read('messages'))[0].id, 2, 'obsolete list response cannot overwrite the newest list')
  console.log('PASS latest list response wins')
  await fresh(); await settle(0, result()); await run(() => { const v = window.inboxHarness.view(); v.setFilter('unread') }); await settle(await last('list'), result())
  await run(() => { const v = window.inboxHarness.view(); void v.markAsRead(v.messages[0]) }); await settle(await last('read'), { success: true })
  assert.equal((await read('messages')).length, 0, 'read message leaves unread filter immediately')
  await settle(await last('list'), result(1, 0, []))
  await fresh(); await settle(0, result(1, 21, [message()])); await run(() => window.inboxHarness.view().goToPage(2)); await settle(await last('list'), result(2, 21, [message(21)]))
  await run(() => { const v = window.inboxHarness.view(); void v.deleteMessage(v.messages[0]) }); await settle(await last('delete'), { success: true })
  assert.equal(await read('currentPage'), 1, 'deleting the final item on the final page returns to the valid previous page')
  assert.equal(await page.eval(index => window.inboxHarness.pending[index].data.page, await last('list')), 1)
  await settle(await last('list'), result(1, 20, [message()]))
  console.log('PASS unread filtering and final-page deletion')
  const snapshot = () => page.eval(() => JSON.stringify({ rows: window.oldInbox.messages, total: window.oldInbox.total, page: window.oldInbox.currentPage,
    error: window.oldInbox.readError, actionError: window.oldInbox.actionError, unread: window.inboxHarness.inbox.unreadCount,
    toasts: window.inboxHarness.toast.toasts.value.map(toast => toast.message) }))
  const change = mode => run(async mode => {
    const h = window.inboxHarness; window.oldInbox = h.view()
    if (mode === 'account') h.session(2)
    if (mode === 'sid') h.session(1, 'other-inbox')
    if (mode === 'role') h.session(1, 'inbox-session', 'admin')
    if (mode === 'logout') h.auth.clearLocalAuth()
    if (mode === 'session-aba') { h.session(2); h.session(1) }
    if (mode === 'cache') h.active.value = false
    if (mode === 'unmount') h.mounted.value = false
    if (mode === 'route') await h.router.push('/away')
    if (mode === 'filter-aba') { h.view().setFilter('unread'); h.view().setFilter('all') }
  }, mode)
  let stale = 0
  for (const kind of ['list', 'read', 'delete', 'readAll', 'deleteRead']) for (const mode of ['account', 'sid', 'role', 'logout', 'session-aba', 'cache', 'unmount', 'route', 'filter-aba']) for (const fail of [false, true]) {
    await fresh(); await settle(0, result()); await run(kind => { const h = window.inboxHarness, v = h.view(); h.inbox.unreadCount = 8
      if (kind === 'list') void v.loadMessages()
      if (kind === 'read') void v.markAsRead(v.messages[0])
      if (kind === 'delete') void v.deleteMessage(v.messages[0])
      if (kind === 'readAll') void v.markAllAsRead()
      if (kind === 'deleteRead') void v.deleteReadMessages()
    }, kind)
    const index = await last(kind)
    await change(mode); const before = await snapshot()
    await settle(index, kind === 'list' ? result() : { success: true, count: 8 }, fail)
    assert.equal(await snapshot(), before, `${mode} isolates obsolete ${kind} ${fail ? 'failure' : 'success'}`)
    if (mode !== 'filter-aba') assert.equal(await page.eval(() => window.oldInbox.messages.length), 0, 'old identity or view messages are cleared')
    stale++
  }
  console.log(`PASS ${stale} obsolete read/write account, sid, role, ABA, cache, unmount and route receipts`)
  await fresh(); await settle(0, result()); await run(() => { const h = window.inboxHarness; h.auth.token = 'fixture.' + btoa(JSON.stringify({ sid: 'inbox-session', revision: 2 })) + '.fixture' })
  assert.equal((await read('messages'))[0].id, 1, 'same session token refresh preserves current messages')
  for (const bad of [null, {}, { ...result(), total: -1 }, { ...result(), page: 2 }, { ...result(), totalPages: 20 },
    { ...result(), messages: [message(1, 2)] }, { ...result(), messages: [message(), message()] }, { ...result(), messages: [{ ...message(), isRead: 'false' }] }]) {
    await fresh(); await settle(0, bad)
    assert.equal(await read('loaded'), false); assert.equal(await read('readError'), true)
    const before = await page.eval(() => window.inboxHarness.pending.length)
    await run(() => { void window.inboxHarness.view().markAllAsRead() })
    assert.equal(await page.eval(() => window.inboxHarness.pending.length), before, 'unconfirmed reads prohibit mutations')
    await run(() => document.querySelector('[data-inbox-read-error] button').click()); await settle(await last('list'), result())
    assert.equal(await read('readError'), false)
  }
  for (const bad of [null, {}, { success: false }, { success: true }, { success: true, count: -1 }, { success: true, count: '1' }]) {
    await fresh(); await settle(0, result()); await run(() => { const v = window.inboxHarness.view(); void v.markAllAsRead(); void v.markAllAsRead(); void v.deleteReadMessages() })
    assert.equal(await page.eval(() => window.inboxHarness.pending.filter(request => request.kind === 'readAll').length), 1)
    assert.equal(await page.eval(() => window.inboxHarness.pending.filter(request => request.kind === 'deleteRead').length), 0)
    await settle(await last('readAll'), bad)
    assert.equal(await read('actionError'), true); assert.equal((await read('messages'))[0].isRead, false)
    await settle(await last('list'), result())
    await run(() => { void window.inboxHarness.view().markAllAsRead() }); await settle(await last('readAll'), { success: true, count: 0 })
    assert.equal(await read('actionError'), false); await settle(await last('list'), result(1, 0, []))
  }
  console.log('PASS malformed reads/retry, pending cross-operation gates, invalid write retry and valid zero count')
  await fresh(); await settle(0, result()); await run(() => { const v = window.inboxHarness.view(); void v.deleteMessage(v.messages[0]); v.setFilter('unread') })
  await settle(await last('list'), result()); const beforeMutation = await last('list')
  await settle(await last('delete'), { success: true })
  assert.ok(await last('list') > beforeMutation, 'same-session navigation resynchronizes its list when the pending delete finishes')
  await settle(await last('list'), result(1, 0, [])); assert.equal((await read('messages')).length, 0)
  await fresh(); await settle(0, result(1, 1, [{ ...message(), eventType: 'instance_created', data: { instanceId: 5 } }]))
  await run(() => { const v = window.inboxHarness.view(); void v.handleMessageClick(v.messages[0]); v.setFilter('unread'); v.setFilter('all') })
  await settle(await last('read'), null, true)
  assert.equal(await page.eval(() => window.inboxHarness.router.currentRoute.value.path), '/inbox', 'obsolete click completion cannot navigate a replacement view')
  }
  for (const locale of ['zh-CN', 'zh-TW', 'en']) for (const width of [1440, 768, 390]) {
    await fresh(); await page.setViewport({ width, height: 1000 }); await run(({ locale, width }) => { const h = window.inboxHarness; h.setLocale(locale); h.theme.setTheme(width === 390 ? 'dark' : 'light') }, { locale, width })
    await settle(0, result()); await run(() => { const h = window.inboxHarness; document.querySelector('button[aria-label="' + h.t('inbox.markRead') + '"]').click() })
    await settle(await last('read'), { success: true }); await settle(await last('list'), result(1, 1, [message(1, 1, true)]))
    await run(() => { const h = window.inboxHarness; document.querySelector('button[aria-label="' + h.t('common.delete') + '"]').click() })
    await settle(await last('delete'), { success: true }); await settle(await last('list'), result(1, 0, []))
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
    if (width === 390) assert.equal(await page.eval(() => [...document.querySelectorAll('button')].every(button => {
      const rect = button.getBoundingClientRect(); return rect.width >= 44 && rect.height >= 44
    })), true, 'phone controls keep actual 44px targets')
    await page.screenshot({ path: resolve(output, `${locale}-${width}.jpg`), fullPage: true })
  }
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log('PASS actual controls in three locales/widths and phone touch targets')
} finally { if (browser) await browser.close(); await server.close() }
