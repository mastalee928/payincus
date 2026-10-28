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
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/ticket-lifecycle/*.js']
const output = resolve(root, 'logs/ticket-actions'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const server = await createServer({ configFile: false, root: root + '/scripts/fixtures/ticket-lifecycle', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/ticket-lifecycle/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19671, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19671', { settleMs: 1500 })
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(70); return result }
  const last = kind => page.eval(kind => window.ticketHarness.pending.findLastIndex(item => item.kind === kind), kind)
  const count = kind => page.eval(kind => window.ticketHarness.pending.filter(item => item.kind === kind).length, kind)
  const accept = (index, data) => run(({ index, data }) => window.ticketHarness.pending[index].resolve(data), { index, data })
  const reject = index => run(index => window.ticketHarness.pending[index].reject(new Error('fixture failure')), index)
  const view = key => page.eval(key => JSON.parse(JSON.stringify(window.ticketHarness.view()[key])), key)
  const go = id => run(id => window.ticketHarness.router.push(id ? `/tickets?ticket=${id}` : '/tickets'), id)
  const ticket = id => ({ id, userId: 1, subject: `Ticket ${id}`, category: 'technical', priority: 'normal', status: 'open', createdAt: '2030-01-01T00:00:00Z', updatedAt: '2030-01-01T00:00:00Z', hostId: null, instanceId: null })
  const message = (id, ticketId, attachments = []) => ({ id, ticketId, senderId: 1, content: `Message ${id}`, isFromOwner: false, createdAt: '2030-01-01T00:00:00Z', attachments })
  const details = id => ({ ticket: ticket(id), isOwner: false, isCreator: true })
  const messages = (id, total = 1, items = [message(id * 10, id)]) => ({ messages: items, total, page: 1, pageSize: 100 })
  const ready = async (id, total = 1, items) => { await accept(await last('detail'), details(id)); await accept(await last('messages'), messages(id, total, items)) }
  await run(async () => {
    const { default: api } = await import('/api.js')
    const defer = (kind, id, data) => new Promise((resolve, reject) => window.ticketHarness.pending.push({ kind, id, data, resolve, reject }))
    Object.assign(api.tickets, {
      close: id => defer('close', id), updateStatus: (id, status) => defer('status', id, { status }),
      deleteMessage: (id, messageId) => defer('delete', id, { messageId }),
      createInternalNote: (id, content) => defer('note', id, { content }),
      notifyUser: (id, content) => defer('notify', id, { content }),
      linkObject: (id, objectType, objectId) => defer('link', id, { objectType, objectId }),
      create: data => defer('create', null, { ...data, attachments: data.attachments.map(file => file.name) }),
    })
    window.confirm = () => true
  })
  await ready(1)
  await run(() => { void window.ticketHarness.view().closeTicket() }); const close = await last('close')
  await go(2); await ready(2); await accept(close, {})
  assert.equal((await view('selectedTicket')).status, 'open', 'late close completion must not close another ticket')
  console.log('PASS late ticket close preserves current ticket status')
  const toasts = () => page.eval(() => window.ticketHarness.toasts.length)
  await run(() => { void window.ticketHarness.view().closeTicket() }); const currentClose = await last('close')
  await run(() => { void window.ticketHarness.view().closeTicket() }); assert.equal(await last('close'), currentClose)
  await accept(currentClose, {}); assert.equal((await view('selectedTicket')).status, 'closed')
  await run(() => { void window.ticketHarness.view().reopenTicket() }); const reopen = await last('status')
  await run(() => { void window.ticketHarness.view().reopenTicket() }); assert.equal(await last('status'), reopen)
  await accept(reopen, { status: 'open' }); assert.equal((await view('selectedTicket')).status, 'open')
  await run(() => { void window.ticketHarness.view().closeTicket() }); const failedClose = await last('close')
  await go(3); await ready(3); const staleToast = await toasts(); await reject(failedClose)
  assert.equal(await toasts(), staleToast)

  await run(() => window.ticketHarness.session('admin', 'admin')); await ready(3)
  await run(() => { window.ticketHarness.view().isOwner = true; void window.ticketHarness.view().updateStatus('resolved') })
  const status = await last('status'); await go(4); await ready(4); await accept(status, { status: 'resolved' })
  assert.equal((await view('selectedTicket')).status, 'open')
  await run(() => { const v = window.ticketHarness.view(); v.internalNoteContent = 'Saved note'; void v.submitInternalNote() })
  const note = await last('note'); await run(() => { void window.ticketHarness.view().submitInternalNote(); window.ticketHarness.view().internalNoteContent = 'Next note' })
  assert.equal(await last('note'), note); await accept(note, { note: { id: 1, ticketId: 4 } })
  assert.equal(await view('internalNoteContent'), 'Next note')
  await run(() => { const v = window.ticketHarness.view(); v.notifyContent = 'Saved notice'; void v.submitNotifyUser() })
  const notice = await last('notify'); await go(5); await ready(5)
  await run(() => { window.ticketHarness.view().notifyContent = 'Current notice' }); await accept(notice, {})
  assert.equal(await view('notifyContent'), 'Current notice')
  await run(() => { const v = window.ticketHarness.view(); v.linkForm = { objectType: 'instance', objectId: '20' }; void v.submitLinkObject() })
  const link = await last('link'); await run(() => { const v = window.ticketHarness.view(); v.linkForm = { objectType: 'host', objectId: '21' } })
  await accept(link, { link: { ticketId: 5 } }); assert.equal((await view('linkForm')).objectId, '21')
  assert.deepEqual(await page.eval(i => window.ticketHarness.pending[i].data, link), { objectType: 'instance', objectId: 20 })
  await run(() => { const v = window.ticketHarness.view(); void v.confirmDeleteMessage(v.messages[0]) }); const deletion = await last('delete')
  await go(6); await ready(6); await accept(deletion, {}); assert.equal((await view('messages')).length, 1); assert.equal(await view('messagesTotal'), 1)
  console.log('PASS current status actions, duplicate protection, fixed admin targets and later note/link/notice drafts')
  await run(() => { window.ticketHarness.view().isOwner = true; void window.ticketHarness.view().updateStatus('resolved') })
  await accept(await last('status'), { status: 'resolved' }); assert.equal((await view('selectedTicket')).status, 'resolved')
  const noteFailToast = await toasts()
  await run(() => { window.ticketHarness.view().internalNoteContent = 'Failure note'; void window.ticketHarness.view().submitInternalNote() })
  await reject(await last('note')); assert.equal(await view('internalNoteContent'), 'Failure note'); assert.equal(await toasts(), noteFailToast + 1)
  await run(() => { void window.ticketHarness.view().submitInternalNote() }); const hiddenNote = await last('note')
  await run(() => { window.ticketHarness.view().internalNoteContent = 'After failed note' }); await reject(hiddenNote)
  assert.equal(await toasts(), noteFailToast + 1)
  await run(() => { const v = window.ticketHarness.view(); v.notifyContent = 'Current notice'; void v.submitNotifyUser() })
  const currentNotice = await last('notify'); await run(() => { void window.ticketHarness.view().submitNotifyUser() }); assert.equal(await last('notify'), currentNotice)
  await accept(currentNotice, {}); assert.equal(await view('notifyContent'), '')
  const invalidLinkCount = await count('link')
  await run(() => { const v = window.ticketHarness.view(); v.linkForm.objectId = '1e2'; void v.submitLinkObject() }); assert.equal(await count('link'), invalidLinkCount)
  await run(() => { const v = window.ticketHarness.view(); v.linkForm = { objectType: 'instance', objectId: '8' }; void v.submitLinkObject() })
  const currentLink = await last('link'); await run(() => { void window.ticketHarness.view().submitLinkObject() }); assert.equal(await last('link'), currentLink)
  await accept(currentLink, { link: { ticketId: 6 } }); assert.equal((await view('linkForm')).objectId, '')
  await run(() => { const v = window.ticketHarness.view(); void v.confirmDeleteMessage(v.messages[0]) }); const currentDelete = await last('delete')
  await run(() => { const v = window.ticketHarness.view(); void v.confirmDeleteMessage(v.messages[0]); void v.loadMoreMessages() }); assert.equal(await last('delete'), currentDelete)
  await accept(currentDelete, {}); assert.equal((await view('messages')).length, 0); assert.equal(await view('messagesTotal'), 0)
  await run(() => { void window.ticketHarness.view().closeTicket() }); const closeDuringReload = await last('close')
  await go(7); await ready(7); await go(6); await accept(closeDuringReload, {}); await ready(6)
  await accept(await last('detail'), { ...details(6), ticket: { ...ticket(6), status: 'closed' } })
  assert.equal((await view('selectedTicket')).status, 'closed')
  const support = id => ({ ticket: ticket(id), userContext: null, recentOrders: [], recentOrderCases: [], recentInstances: [], links: [], internalNotes: [], timeline: [], knowledgeSuggestions: [], quickActions: { notifyUser: true, userPath: '/fixture', balanceAdjustmentPath: '/fixture', instancePath: null, hostPath: null } })
  await accept(await last('support'), support(6))
  for (const [locale, width, dark, mobile] of [['zh-CN', 1440, false, false], ['en', 390, true, true]]) {
    await page.setViewport({ width, height: 1050, mobile })
    await run(({ locale, dark }) => { window.ticketHarness.setLocale(locale); window.ticketHarness.theme.setTheme(dark ? 'dark' : 'light') }, { locale, dark })
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: resolve(output, `${locale}-${width}.png`), format: 'png' })
  }
  console.log('PASS current admin actions, failure drafts, invalid links, delete deduplication and same-ticket reload')

  await run(() => window.ticketHarness.session('user')); await ready(6)
  await run(() => window.ticketHarness.router.push('/tickets?compose=1'))
  await accept(await last('instances'), { instances: [] })
  const createDraft = content => run(content => { const v = window.ticketHarness.view(); v.createForm.subject = 'Fixture ticket'; v.createForm.content = content }, content)
  await createDraft('Original content text'); await run(() => { void window.ticketHarness.view().submitCreate() })
  const creation = await last('create'); await run(() => { void window.ticketHarness.view().submitCreate() }); assert.equal(await last('create'), creation)
  await createDraft('Edited content after submit'); await accept(creation, { ticket: { id: 20 } })
  assert.equal(await page.eval(() => window.ticketHarness.router.currentRoute.value.fullPath), '/tickets?compose=1')
  assert.equal((await view('createForm')).content, 'Edited content after submit')
  await run(() => { void window.ticketHarness.view().submitCreate() }); const currentCreate = await last('create')
  await accept(currentCreate, { ticket: { id: 21 } }); assert.equal(await page.eval(() => window.ticketHarness.router.currentRoute.value.fullPath), '/tickets?ticket=21')
  await ready(21)
  await run(() => window.ticketHarness.router.push('/tickets?compose=1')); await accept(await last('instances'), { instances: [] })
  await createDraft('Leave before completing'); await run(() => { void window.ticketHarness.view().submitCreate() }); const leaveCreate = await last('create')
  await run(() => window.ticketHarness.router.push('/other')); const beforeLeaveToast = await toasts()
  await accept(leaveCreate, { ticket: { id: 22 } }); assert.equal(await page.eval(() => window.ticketHarness.router.currentRoute.value.fullPath), '/other')
  assert.equal(await toasts(), beforeLeaveToast)
  await go(23); await ready(23)
  const forbidden = await count('note'); await run(() => { window.ticketHarness.view().internalNoteContent = 'Forbidden'; void window.ticketHarness.view().submitInternalNote() })
  assert.equal(await count('note'), forbidden)
  await run(() => { void window.ticketHarness.view().closeTicket() }); const logoutClose = await last('close'), logoutToast = await toasts()
  await run(() => window.ticketHarness.session(null)); await accept(logoutClose, {}); assert.equal(await view('selectedTicket'), null); assert.equal(await toasts(), logoutToast)
  await run(() => window.ticketHarness.session('again')); await ready(23)
  await run(() => { void window.ticketHarness.view().closeTicket() }); const unmountClose = await last('close')
  await run(() => { window.ticketHarness.state.mounted = false }); await reject(unmountClose); assert.equal(await toasts(), logoutToast)
  console.log('PASS create busy gate, later draft retention, current navigation and cached-page isolation')
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
} finally { if (browser) await browser.close(); await server.close() }
