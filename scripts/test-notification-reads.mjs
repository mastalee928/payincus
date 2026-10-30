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
const output = resolve(root, 'logs/notification-reads'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js'); tailwind.content = [root + '/client/src/**/*.{vue,ts,js}']
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/notification-reads', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/notification-reads/api.js' }, { find: '@', replacement: root + '/client/src' }, ...['vue', 'pinia', 'vue-i18n'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } }, server: { host: '127.0.0.1', port: 19770, strictPort: true, fs: { allow: [root] } } })
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  const run = async (fn, arg) => { const value = await page.eval(fn, arg); await sleep(40); return value }
  const fresh = async () => {
    await page.goto('http://127.0.0.1:19770', { settleMs: 180 }); const deadline = Date.now() + 10000
    while (!await page.eval(() => !!window.notificationHarness?.view() && window.notificationHarness.pending.length)) { if (Date.now() > deadline) throw Error('notification fixture unavailable'); await sleep(30) }
    await run(() => window.notificationHarness.pending[0].resolve({ channels: [] }))
  }
  const log = (id, status = 'sent') => ({ id, channelId: 1, channelName: '实例到期通知', channelType: 'telegram', eventType: 'instance.expiring', message: '实例即将到期，请及时续费。', status, error: status === 'failed' ? '专用测试通知发送失败' : null, createdAt: '2026-10-30T09:00:00.000Z' })
  const settle = (index, status = 'sent', id = 1) => run(({ index, value }) => window.notificationHarness.pending[index].resolve(value), { index, value: { logs: [log(id, status)], total: 1, page: 1, pageSize: 10 } })
  const resolveRead = (index, value) => run(({ index, value }) => window.notificationHarness.pending[index].resolve(value), { index, value })
  const rejectRead = index => run(index => window.notificationHarness.pending[index].reject(Error('controlled notification read failure')), index)
  const state = () => page.eval(() => { const v = window.notificationHarness.view(); return { channels: v.notificationChannels.map(c => c.id), logs: v.notificationLogs.map(l => l.id), stats: v.notificationStats ? { ...v.notificationStats } : null, loading: [v.channelsLoading, v.logsLoading, v.statsLoading], errors: [v.channelsError, v.logsError, v.statsError], ready: [v.channelsReady, v.logsReady], page: v.logsPage, pages: v.totalPages, history: v.showHistory } })
  const channel = { id: 1, name: '实例到期通知', type: 'telegram', enabled: true, configPreview: '已配置' }
  const stats = { stats: { total: 1, sent: 1, failed: 0, pending: 0 } }
  const history = { logs: [log(1)], total: 1, page: 1, pageSize: 10 }
  if (!process.argv.includes('--ui-only')) {
  await fresh(); await run(() => { void window.notificationHarness.view().openHistory() }); await run(() => { void window.notificationHarness.view().changeLogsFilter('failed') })
  await settle(3, 'failed', 2); await settle(1, 'sent', 1)
  assert.equal(await page.eval(() => window.notificationHarness.view().notificationLogs[0].id), 2, 'old unfiltered history cannot overwrite the selected failed filter')
  console.log('PASS history retains newest selected filter')
  const transitions = {
    account: () => window.notificationHarness.session(2),
    sid: () => window.notificationHarness.session(1, 'replaced-notification-session'),
    role: () => window.notificationHarness.session(1, 'notification-session', 'admin'),
    aba: () => { window.notificationHarness.session(2); window.notificationHarness.session() },
    logout: () => { localStorage.removeItem('token'); window.notificationHarness.auth.syncToken() },
    cache: () => { window.notificationHarness.active.value = false },
    unmount: () => { window.notificationHarness.mounted.value = false }
  }
  let staleCases = 0
  for (const [name, transition] of Object.entries(transitions)) for (const fail of [false, true]) {
    await fresh(); await run(() => { void window.notificationHarness.view().loadNotificationChannels(); void window.notificationHarness.view().openHistory() })
    // One list, history and stats request share the old session, then become obsolete together.
    await run(transition)
    for (const [index, value] of [[1, { channels: [channel] }], [2, history], [3, stats]]) {
      if (fail) await rejectRead(index); else await resolveRead(index, value)
    }
    if (!['cache', 'unmount'].includes(name)) {
      const s = await state(); assert.deepEqual(s.channels, [], name); assert.deepEqual(s.logs, [], name); assert.equal(s.stats, null, name); assert.deepEqual(s.errors, [false, false, false], name)
    } else {
      assert.equal(await page.eval(() => !!document.querySelector('[role="dialog"]') || document.body.textContent.includes('实例即将到期')), false, name)
      await run(name === 'cache' ? () => { window.notificationHarness.active.value = true } : () => { window.notificationHarness.mounted.value = true })
      const s = await state(); assert.deepEqual(s.channels, []); assert.deepEqual(s.logs, []); assert.equal(s.stats, null); assert.equal(s.loading[0], true)
    }
    staleCases += 3
  }
  console.log(`PASS ${staleCases} obsolete list/history/stats successes and failures across account, sid, role, ABA, logout, cache and unmount`)
  await fresh(); await run(() => { void window.notificationHarness.view().openHistory() }); await settle(1); await resolveRead(2, stats)
  await run(() => { window.notificationHarness.view().closeHistory(); void window.notificationHarness.view().openHistory() })
  await rejectRead(1); await rejectRead(2); assert.deepEqual((await state()).loading, [false, true, true]); assert.deepEqual((await state()).logs, [])
  await resolveRead(3, history); await resolveRead(4, stats)
  await run(() => { void window.notificationHarness.view().loadNotificationLogs(); void window.notificationHarness.view().loadNotificationLogs() })
  await rejectRead(5); assert.equal((await state()).loading[1], true); await rejectRead(6)
  assert.deepEqual((await state()).logs, [1]); assert.equal((await state()).errors[1], true)
  await run(() => { document.querySelector('.notification-history-list [role="alert"] button').click() }); await resolveRead(7, { ...history, logs: [], total: 0 })
  assert.deepEqual((await state()).logs, []); assert.equal((await state()).pages, 1); assert.equal((await state()).errors[1], false)
  console.log('PASS close/reopen, old finally, same-view failure retention, real retry and valid empty page')
  await fresh(); await run(() => { void window.notificationHarness.view().openHistory(); window.notificationHarness.view().closeHistory(); void window.notificationHarness.view().openHistory() })
  await resolveRead(1, history); await rejectRead(2); assert.deepEqual((await state()).loading, [false, true, true]); assert.deepEqual((await state()).logs, []); assert.equal((await state()).errors[2], false)
  await resolveRead(3, history); await resolveRead(4, stats)
  await run(() => { void window.notificationHarness.view().loadNotificationChannels() }); await rejectRead(5)
  assert.equal((await state()).errors[0], true)
  await run(() => { document.querySelector('.notification-section > [role="alert"] button').click() }); await resolveRead(6, { channels: [channel] })
  await run(() => { void window.notificationHarness.view().loadNotificationStats() }); await rejectRead(7)
  await run(() => { document.querySelector('.notification-history [role="alert"] button').click() }); await resolveRead(8, { stats: { total: 0, sent: 0, failed: 0, pending: 0 } })
  assert.deepEqual((await state()).errors, [false, false, false]); assert.equal((await state()).stats.total, 0)
  await run(() => { void window.notificationHarness.view().loadNotificationLogs(); localStorage.setItem('token', 'fresh.' + btoa(JSON.stringify({ id: 1, sid: 'notification-session', role: 'user' })) + '.fresh'); window.notificationHarness.auth.syncToken() })
  await settle(9, 'sent', 9); assert.deepEqual((await state()).logs, [9])
  console.log('PASS pending close/reopen receipts, channels/stats real retry, zero statistics and same-sid token refresh')
  await fresh(); await run(() => { void window.notificationHarness.view().openHistory() }); await resolveRead(1, { ...history, total: 21 }); await resolveRead(2, stats)
  await run(() => { void window.notificationHarness.view().changeLogsPage(3) }); await resolveRead(3, { ...history, logs: [], total: 1, page: 3 })
  assert.equal((await state()).page, 1); assert.equal(await page.eval(() => window.notificationHarness.pending[4].data.page), 1)
  await resolveRead(4, history); assert.deepEqual((await state()).logs, [1]); assert.equal((await state()).loading[1], false)
  await run(() => { void window.notificationHarness.view().changeLogsPage(0); void window.notificationHarness.view().changeLogsPage(2); void window.notificationHarness.view().changeLogsPage(NaN) })
  assert.equal(await page.eval(() => window.notificationHarness.pending.length), 5)
  console.log('PASS contracted pagination rereads the valid page; invalid pages make zero requests')
  const badLists = [{}, { channels: null }, { channels: [null] }, { channels: [{ ...channel, enabled: 'false' }] }, { channels: [{ ...channel, id: 0 }] }, { channels: [channel, channel] }, { channels: [{ ...channel, type: 'unknown' }] }]
  for (const value of badLists) {
    await fresh(); await run(() => { void window.notificationHarness.view().loadNotificationChannels() }); await resolveRead(1, { channels: [channel] })
    await run(() => { void window.notificationHarness.view().loadNotificationChannels() }); await resolveRead(2, value)
    assert.deepEqual((await state()).channels, [1]); assert.equal((await state()).errors[0], true); assert.equal((await state()).loading[0], false)
  }
  const badHistories = [{}, { ...history, logs: null }, { ...history, logs: [null] }, { ...history, logs: [log(1), log(1)] }, { ...history, total: -1 }, { ...history, total: '1' }, { ...history, page: 2 }, { ...history, pageSize: 20 }, { ...history, logs: [{ ...log(1), createdAt: 'invalid' }] }, { ...history, logs: [{ ...log(1), error: {} }] }]
  for (const value of badHistories) {
    await fresh(); await run(() => { void window.notificationHarness.view().openHistory() }); await resolveRead(1, history); await resolveRead(2, stats)
    await run(() => { void window.notificationHarness.view().loadNotificationLogs() }); await resolveRead(3, value)
    assert.deepEqual((await state()).logs, [1]); assert.equal((await state()).errors[1], true)
  }
  for (const value of [{}, { stats: null }, { stats: { ...stats.stats, pending: -1 } }, { stats: { ...stats.stats, total: '1' } }]) {
    await fresh(); await run(() => { void window.notificationHarness.view().openHistory() }); await resolveRead(1, history); await resolveRead(2, stats)
    await run(() => { void window.notificationHarness.view().loadNotificationStats() }); await resolveRead(3, value)
    assert.deepEqual((await state()).stats, stats.stats); assert.equal((await state()).errors[2], true)
  }
  // The backend performs independent counts and list/count queries; a concurrent arrival is legitimate.
  await run(() => { void window.notificationHarness.view().loadNotificationStats() }); await resolveRead(4, { stats: { total: 0, sent: 1, failed: 0, pending: 0 } })
  assert.equal((await state()).errors[2], false)
  console.log('PASS 21 malformed replies preserve confirmed data; independent DB count snapshots remain valid')
  await fresh(); await run(() => { void window.notificationHarness.view().openHistory() }); await run(() => { void window.notificationHarness.view().changeLogsFilter('failed'); void window.notificationHarness.view().changeLogsFilter('all') })
  await settle(4, 'sent', 4); await settle(1); await rejectRead(3); assert.deepEqual((await state()).logs, [4]); assert.equal((await state()).errors[1], false)
  await run(() => { void window.notificationHarness.view().loadNotificationChannels(); void window.notificationHarness.view().loadNotificationLogs(); void window.notificationHarness.view().loadNotificationStats(); localStorage.setItem('token', 'fixture.' + btoa(JSON.stringify({ id: 2, sid: 'raw-new-session', role: 'user' })) + '.fixture') })
  await resolveRead(5, { channels: [channel] }); await resolveRead(6, history); await resolveRead(7, stats)
  assert.deepEqual((await state()).channels, []); assert.deepEqual((await state()).logs, [4]); assert.equal((await state()).stats, null)
  const length = await page.eval(() => window.notificationHarness.pending.length)
  await run(() => { void window.notificationHarness.view().loadNotificationChannels(); void window.notificationHarness.view().loadNotificationLogs(); void window.notificationHarness.view().loadNotificationStats() })
  assert.equal(await page.eval(() => window.notificationHarness.pending.length), length)
  console.log('PASS filter ABA and unsynchronized storage cannot commit or dispatch reads')
  }
  for (const reduced of [false, true]) for (const locale of ['zh-CN', 'zh-TW', 'en']) for (const width of [1440, 768, 390]) for (const theme of ['light', 'dark']) {
    await page.setViewport({ width, height: 900 }); await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }] })
    await fresh(); await run(({ locale, theme }) => { window.notificationHarness.setLocale(locale); window.notificationHarness.theme.setTheme(theme) }, { locale, theme })
    await page.send('Animation.enable'); await page.send('Animation.setPlaybackRate', { playbackRate: 0 })
    await run(() => { document.querySelector('.notification-heading button').focus(); document.querySelector('.notification-heading button').click() })
    const dimensions = await page.eval(() => [...document.querySelectorAll('.notification-history button')].map(b => ({ label: b.getAttribute('aria-label') || b.textContent.trim(), height: b.getBoundingClientRect().height, width: b.getBoundingClientRect().width })))
    assert.ok(dimensions.length >= 4 && dimensions.every(b => b.height >= 44 && b.width >= 44), JSON.stringify({ width, locale, theme, reduced, dimensions }))
    await resolveRead(1, { ...history, logs: [log(1, 'failed'), log(2), log(3, 'pending')], total: 3 }); await resolveRead(2, { stats: { total: 3, failed: 1, sent: 1, pending: 1 } })
    assert.ok(await page.eval(() => document.querySelector('[role="dialog"]').contains(document.activeElement)), JSON.stringify(await page.eval(() => ({ active: document.activeElement.outerHTML.slice(0, 180), root: !!window.notificationHarness.view().historyRoot, style: getComputedStyle(document.querySelector('[role="dialog"]')).cssText }))))
    assert.ok(await page.eval(() => document.documentElement.scrollWidth <= innerWidth))
    await page.send('Animation.setPlaybackRate', { playbackRate: 1 })
    await page.eval(() => document.getAnimations().forEach(animation => animation.finish()))
    if (!reduced && locale === 'zh-CN') await page.screenshot({ path: resolve(output, `${theme}-${width}.png`), format: 'png' })
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(60)
    assert.equal((await state()).history, false); assert.equal(await page.eval(() => document.activeElement === document.querySelector('.notification-heading button')), true)
  }
  console.log('PASS 36 first-frame touch sizes, three locales and widths, both themes/motion modes, Escape and opener focus')
  assert.deepEqual(page.consoleErrors, [])
  if (process.argv.includes('--inspect')) {
    writeFileSync(resolve(output, 'direction.json'), JSON.stringify({ kind: 'app', style: { name: 'Achromatic ledger' }, seed: 242843060, input: { keep: ['palette', 'type'] } }))
    for (const theme of ['light', 'dark']) {
      const code = await new Promise((resolveCode, reject) => {
        const child = spawn(process.execPath, [root + '/.agents/skills/design-taste-frontend/scripts/inspect.mjs', `http://127.0.0.1:19770/?preview=history&theme=${theme}`, '--app', '--out', resolve(output, `inspect-${theme}`)], { cwd: root, stdio: 'inherit', env: process.env })
        child.on('error', reject); child.on('close', resolveCode)
      })
      assert.equal(code, 0, `taste ${theme} inspector`)
    }
  }
} finally { if (browser) await browser.close(); await server.close() }
