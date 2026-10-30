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
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/terminal-lifecycle/*.js']
const output = resolve(root, 'logs/terminal-session'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const server = await createServer({ configFile: false, root: root + '/scripts/fixtures/terminal-lifecycle', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/terminal-lifecycle/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19669, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19669?session-test=1', { settleMs: 1300 })
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(90); return result }
  const session = sid => run(sid => { window.terminalHarness.auth.token = sid ? `fixture.${btoa(JSON.stringify({ sid }))}.fixture` : null }, sid)
  const last = kind => page.eval(kind => window.terminalHarness.pending.findLastIndex(item => item.kind === kind), kind)
  const count = kind => page.eval(kind => window.terminalHarness.pending.filter(item => item.kind === kind).length, kind)
  const accept = (index, data) => run(({ index, data }) => window.terminalHarness.pending[index].resolve(data), { index, data })
  const reject = index => run(index => window.terminalHarness.pending[index].reject(new Error('obsolete fixture failure')), index)
  const seed = () => run(() => window.terminalHarness.seedTab())
  const cloud = () => run(() => { void window.terminalHarness.view().checkCloudInitAndConnect('fixture-tab') })
  const list = (id, name = `Fixture instance ${id}`) => ({ instances: [{ id, name, status: 'running', image: 'debian/12' }], total: 1, page: 1, pageSize: 100, totalPages: 1 })
  const connect = () => run(() => { window.terminalHarness.view().tabs[0].ws = null; void window.terminalHarness.view().connectTab('fixture-tab') })
  const firstList = await last('instances')
  await run(() => { window.terminalHarness.view(); window.terminalHarness.seedTab() })
  await run(() => { window.terminalHarness.auth.token = null })
  assert.equal(await page.eval(() => window.terminalHarness.view().tabs.length), 0, 'logout must dispose old authenticated terminal tabs')
  assert.deepEqual(await page.eval(() => window.terminalHarness.closed), ['close'])
  await accept(firstList, list(1)); assert.equal(await page.eval(() => window.terminalHarness.view().instances.length), 0)
  console.log('PASS logout disposes authenticated terminal state')
  await session('b'); await accept(await last('instances'), list(2))
  assert.equal(await page.eval(() => window.terminalHarness.view().instances[0].id), 2)
  const beforeRefresh = await count('instances')
  await run(() => { window.terminalHarness.auth.token = `fixture.${btoa(JSON.stringify({ sid: 'b', iat: 2 }))}.fixture` })
  assert.equal(await count('instances'), beforeRefresh)
  await run(() => { void window.terminalHarness.view().loadInstances() }); const oldList = await last('instances')
  await run(() => { void window.terminalHarness.view().loadInstances() }); const newList = await last('instances')
  await reject(oldList); assert.equal(await page.eval(() => window.terminalHarness.view().loadingInstances), true)
  await accept(newList, list(3)); assert.equal(await page.eval(() => window.terminalHarness.view().instances[0].id), 3)
  await run(() => { void window.terminalHarness.view().loadInstances() }); const cachedList = await last('instances')
  await run(() => { window.terminalHarness.state.active = false }); await accept(cachedList, list(99))
  assert.equal(await page.eval(() => window.terminalHarness.view().instances.length), 0)
  await run(() => { window.terminalHarness.state.active = true }); await accept(await last('instances'), list(4))
  await seed(); await cloud(); const closedCloud = await last('cloud')
  await run(() => window.terminalHarness.view().closeTab('fixture-tab'))
  await accept(closedCloud, { ready: true })
  assert.equal(await page.eval(() => window.terminalHarness.view().cloudInitStatus.size), 0)
  assert.equal(await count('ticket'), 0)
  await seed(); await cloud(); const firstCloud = await last('cloud'); await cloud(); const currentCloud = await last('cloud')
  await accept(firstCloud, { ready: true }); assert.equal(await page.eval(() => window.terminalHarness.view().cloudInitChecking.get('fixture-tab')), true)
  assert.equal(await page.eval(() => window.terminalHarness.view().cloudInitStatus.get('fixture-tab')), 'checking')
  await accept(currentCloud, { ready: false }); assert.equal(await page.eval(() => window.terminalHarness.view().cloudInitStatus.get('fixture-tab')), 'not_ready')
  await cloud(); const obsoleteSkip = await last('cloud'); await run(() => window.terminalHarness.view().skipCloudInitAndConnect('fixture-tab'))
  await accept(obsoleteSkip, { ready: false }); assert.equal(await page.eval(() => window.terminalHarness.view().cloudInitStatus.get('fixture-tab')), 'skipped')
  await cloud(); await session('c'); assert.equal(await page.eval(() => window.terminalHarness.view().tabs.length), 0)
  await seed(); await cloud(); const sessionCloud = await last('cloud'); await session('d'); await reject(sessionCloud)
  assert.equal(await page.eval(() => window.terminalHarness.view().cloudInitStatus.size), 0)
  console.log('PASS list ordering/cache/session and closed, superseded or skipped cloud-init reads')

  await seed(); await connect(); const staleTicket = await last('ticket')
  await session('e'); await accept(staleTicket, { ticket: 'fixture-obsolete-ticket' })
  assert.equal(await page.eval(() => window.terminalHarness.sockets.length), 0)
  await seed(); await connect(); const oldTicket = await last('ticket'); await connect(); const latestTicket = await last('ticket')
  await accept(oldTicket, { ticket: 'fixture-old-ticket' }); assert.equal(await page.eval(() => window.terminalHarness.sockets.length), 0)
  await accept(latestTicket, { ticket: 'fixture-current-ticket' }); assert.equal(await page.eval(() => window.terminalHarness.sockets.length), 1)
  await run(() => {
    const socket = window.terminalHarness.sockets[0]; socket.readyState = 1
    socket.onmessage({ data: JSON.stringify({ type: 'connected', mode: 'exec' }) })
  })
  assert.equal(await page.eval(() => window.terminalHarness.view().tabs[0].status), 'connected')
  await run(() => { window.terminalHarness.state.active = false })
  assert.equal(await page.eval(() => window.terminalHarness.view().tabs.length), 1, 'same-session cache retains the connection')
  await session('f'); assert.equal(await page.eval(() => window.terminalHarness.view().tabs.length), 0)
  const requestsBeforeLate = await page.eval(() => window.terminalHarness.pending.length)
  await run(() => { const socket = window.terminalHarness.sockets[0]; socket.onmessage({ data: JSON.stringify({ type: 'error', code: 'UNAUTHORIZED' }) }); socket.onerror({}); socket.onclose({ code: 1006 }) })
  await sleep(1200); assert.equal(await page.eval(() => window.terminalHarness.pending.length), requestsBeforeLate, 'old socket cannot reconnect after session change')
  await run(() => { window.terminalHarness.state.active = true }); await seed(); await connect(); const failingTicket = await last('ticket')
  await reject(failingTicket); assert.equal(await page.eval(() => window.terminalHarness.view().tabs[0].status), 'error')
  await connect(); await accept(await last('ticket'), { ticket: 'fixture-retry-ticket' })
  const latestSocket = await page.eval(() => window.terminalHarness.sockets.length - 1)
  await run(index => {
    const socket = window.terminalHarness.sockets[index]; socket.readyState = 1; socket.onmessage({ data: JSON.stringify({ type: 'connected' }) })
    socket.readyState = 3; socket.onclose({ code: 1006 })
  }, latestSocket)
  await sleep(1200)
  assert.equal(await page.eval(() => window.terminalHarness.pending.at(-1).kind), 'ticket', 'current unexpected close retries through a new ticket')
  const beforeUnmountTicket = await last('ticket')
  await run(() => { window.terminalHarness.state.mounted = false })
  const socketCount = await page.eval(() => window.terminalHarness.sockets.length)
  await accept(beforeUnmountTicket, { ticket: 'fixture-after-unmount' }); await sleep(1200)
  assert.equal(await page.eval(() => window.terminalHarness.sockets.length), socketCount)
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log('PASS ticket supersession, old socket isolation, current retry and unmount')
} finally { if (browser) await browser.close(); await server.close() }
