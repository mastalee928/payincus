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
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/instance-logs/*.js']
const output = resolve(root, 'logs/instance-logs-lifecycle'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const server = await createServer({ configFile: false, root: root + '/scripts/fixtures/instance-logs', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/instance-logs/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19675, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19675', { settleMs: 1500 })
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(80); return result }
  const last = () => page.eval(() => window.logsHarness.pending.length - 1)
  const accept = (index, data) => run(({ index, data }) => window.logsHarness.pending[index].resolve(data), { index, data })
  const view = key => page.eval(key => JSON.parse(JSON.stringify(window.logsHarness.view()[key])), key)
  const log = (id, content, instanceId = 1) => ({ id, instance_id: instanceId, action: 'Fixture action', content, result: 'success', created_at: '2030-01-01T00:00:00Z' })
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  assert.equal(await last(), 0, 'mount plus KeepAlive activation must load once')
  await accept(await last(), { logs: [log(1, 'Initial')], total: 1, totalPages: 1 })
  await run(() => { const v = window.logsHarness.view(); v.searchQuery = 'old'; v.handleSearch() }); const old = await last()
  await run(() => { const v = window.logsHarness.view(); v.searchQuery = 'new'; v.handleSearch() }); const current = await last()
  await accept(current, { logs: [log(3, 'new')], total: 1, totalPages: 1 }); await accept(old, { logs: [log(2, 'old')], total: 1, totalPages: 1 })
  assert.equal((await view('logs'))[0].content, 'new', 'old instance log search must not overwrite the latest result')
  console.log('PASS instance logs discard out-of-order searches')
  const reject = index => run(index => window.logsHarness.pending[index].reject(new Error('Fixture log failure')), index)
  const reply = (id, content, instanceId = 1, totalPages = 1) => ({ logs: [log(id, content, instanceId)], total: totalPages * 10, totalPages })
  const toasts = () => page.eval(() => window.logsHarness.toasts.length)
  const search = async text => { await run(text => { const v = window.logsHarness.view(); v.searchQuery = text; v.handleSearch() }, text); return last() }
  const firstA = await search('A'), middleB = await search('B'), finalA = await search('A')
  const messages = await toasts(); await accept(firstA, reply(4, 'old A')); await reject(middleB)
  assert.equal(await view('loading'), true); assert.equal(await view('refreshing'), true); assert.equal(await toasts(), messages)
  assert.deepEqual(await view('logs'), []); await accept(finalA, reply(5, 'current A', 1, 3))
  await run(() => { const v = window.logsHarness.view(); v.page = 2; void v.loadLogs(true) }); const pageTwo = await last()
  await run(() => { const v = window.logsHarness.view(); v.page = 3; void v.loadLogs(true) }); const pageThree = await last()
  await accept(pageThree, reply(7, 'page 3', 1, 3)); await reject(pageTwo)
  assert.equal(await view('page'), 3); assert.equal((await view('logs'))[0].content, 'page 3')
  await run(() => { const v = window.logsHarness.view(); v.pageSize = 30; v.handlePageSizeChange() })
  assert.equal(await view('page'), 1); assert.equal(await view('loading'), true)
  assert.deepEqual(await page.eval(index => window.logsHarness.pending[index].params, await last()), { page: 1, pageSize: 30, instanceId: 1, search: 'A' })
  await accept(await last(), reply(8, 'new size'))
  let request = await search('failure'); await reject(request)
  assert.deepEqual(await view('logs'), []); assert.equal(await view('total'), 0); assert.ok(await view('loadError'))
  assert.equal(await page.eval(() => !!document.querySelector('[role="alert"]')), true)
  await run(() => document.querySelector('[role="alert"] button').click()); await accept(await last(), reply(9, 'retry success'))
  assert.equal(await view('loadError'), ''); assert.equal((await view('logs'))[0].content, 'retry success')
  await run(() => { const v = window.logsHarness.view(); v.page = 4; void v.loadLogs(true) }); const beforeClamp = await last()
  await accept(beforeClamp, { logs: [], total: 20, totalPages: 2 })
  assert.equal(await view('page'), 2); assert.equal(await view('loading'), true); assert.equal(await last(), beforeClamp + 1)
  await accept(await last(), reply(10, 'clamped page', 1, 2)); assert.equal(await view('loading'), false)
  await run(() => window.logsHarness.view().resetFilters()); await accept(await last(), reply(11, 'A long content '.repeat(20)))
  await run(() => window.logsHarness.view().toggleContent(11)); assert.equal(await page.eval(() => window.logsHarness.view().expandedRows.has(11)), true)
  await run(() => { void window.logsHarness.view().loadLogs(true) }); await accept(await last(), reply(12, 'replaced row'))
  assert.equal(await page.eval(() => window.logsHarness.view().expandedRows.size), 0)
  console.log('PASS search ABA, old failure/finally, pagination races, size/reset, failed-list retry, page clamp and expanded rows')

  await run(() => { void window.logsHarness.view().loadLogs(true) }); const firstInstance = await last()
  await run(() => { window.logsHarness.state.id = 2 }); const secondInstance = await last()
  assert.deepEqual(await view('logs'), []); await run(() => { window.logsHarness.state.id = 1 }); const currentInstance = await last()
  await accept(firstInstance, reply(13, 'stale instance')); await reject(secondInstance)
  assert.equal(await view('loading'), true); await accept(currentInstance, reply(14, 'current instance'))
  await run(() => { void window.logsHarness.view().loadLogs(true) }); const priorName = await last()
  await run(() => { window.logsHarness.state.name = 'Renamed fixture' }); await accept(priorName, reply(15, 'prior name'))
  assert.deepEqual(await view('logs'), []); await accept(await last(), reply(16, 'renamed'))
  const beforeRefresh = await last(); await run(() => window.logsHarness.session('a', 2)); assert.equal(await last(), beforeRefresh)
  await run(() => { void window.logsHarness.view().loadLogs(true) }); const oldSession = await last()
  await run(() => window.logsHarness.session('b')); const newSession = await last(); await accept(oldSession, reply(17, 'old session'))
  assert.equal(await view('loading'), true); await accept(newSession, reply(18, 'new session'))
  await run(() => { window.logsHarness.auth.user = { id: 2, username: 'fixture2', role: 'user' } })
  assert.deepEqual(await view('logs'), []); await accept(await last(), reply(19, 'new user'))
  request = await search('cache'); await run(() => { window.logsHarness.state.active = false }); const cacheToasts = await toasts(); await reject(request)
  assert.equal(await toasts(), cacheToasts); assert.deepEqual(await view('logs'), []); assert.equal(await view('loading'), false)
  const inactiveCount = await last(); await run(() => { void window.logsHarness.view().loadLogs() }); assert.equal(await last(), inactiveCount)
  await run(() => { window.logsHarness.state.active = true }); assert.equal(await last(), inactiveCount + 1); await accept(await last(), reply(20, 'reactivated'))
  request = await search('logout'); await run(() => window.logsHarness.session(null)); const logoutCount = await last(); await accept(request, reply(21, 'late logout'))
  await run(() => { void window.logsHarness.view().loadLogs() }); assert.equal(await last(), logoutCount); assert.deepEqual(await view('logs'), [])
  await run(() => window.logsHarness.session('c')); await accept(await last(), reply(22, 'relogin'))
  await run(() => { window.logsHarness.state.id = 0 }); const invalidCount = await last(); await run(() => { void window.logsHarness.view().loadLogs() })
  assert.equal(await last(), invalidCount); assert.deepEqual(await view('logs'), [])
  await run(() => { window.logsHarness.state.id = 1 }); await accept(await last(), reply(23, 'wrong instance', 2))
  assert.ok(await view('loadError')); assert.deepEqual(await view('logs'), [])
  await run(() => { void window.logsHarness.view().loadLogs() }); await accept(await last(), reply(24, 'Fixture log details with a long explanation. '.repeat(6)))
  console.log('PASS instance/name/session/account ABA, same-sid refresh, cache/logout/invalid target and wrong-instance response')

  for (const [locale, width, dark, mobile] of [['zh-CN', 1440, false, false], ['en', 390, true, true]]) {
    await page.setViewport({ width, height: 1000, mobile })
    await run(({ locale, dark }) => { window.logsHarness.setLocale(locale); window.logsHarness.theme.setTheme(dark ? 'dark' : 'light'); window.logsHarness.view().expandedRows = new Set([24]) }, { locale, dark })
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: resolve(output, `${locale}-${width}.png`), format: 'png' })
  }
  request = await search('unmount'); await run(() => { window.logsHarness.state.mounted = false }); const finalToasts = await toasts(); await reject(request)
  assert.equal(await toasts(), finalToasts); assert.deepEqual(await view('logs'), []); assert.equal(await view('loading'), false)
  console.log('PASS desktop/mobile Chrome and unmounted log requests')
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
} finally { if (browser) await browser.close(); await server.close() }
