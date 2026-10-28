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
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/instance-detail/*.js']
const output = resolve(root, 'logs/instance-detail-reads'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const server = await createServer({ configFile: false, root: root + '/scripts/fixtures/instance-detail', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/instance-detail/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19665, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.fixtureIntervals = new Map();
    const originalSet = window.setInterval.bind(window), originalClear = window.clearInterval.bind(window);
    window.setInterval = (callback, delay, ...args) => {
      const id = originalSet(callback, delay, ...args); window.fixtureIntervals.set(id, { callback, delay }); return id;
    };
    window.clearInterval = id => { window.fixtureIntervals.delete(id); return originalClear(id); };
  ` })
  await page.goto('http://127.0.0.1:19665', { settleMs: 1200 })
  const check = async (fn, label) => {
    const end = Date.now() + 15000
    while (!await page.eval(fn)) { if (Date.now() >= end) throw Error(label + ': ' + await page.eval(() => document.body.innerText)); await sleep(60) }
  }
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(80); return result }
  const last = (kind, id) => page.eval(({ kind, id }) => window.detailHarness.pending.findLastIndex(item => item.kind === kind && (id === undefined || item.id === id)), { kind, id })
  const accept = (index, data) => run(({ index, data }) => window.detailHarness.pending[index].resolve(data), { index, data })
  const reject = index => run(index => window.detailHarness.pending[index].reject(new Error('404 obsolete fixture failure')), index)
  const goto = id => run(id => window.detailHarness.router.push(`/instances/${id}`), id)
  const instance = (id, name = `Fixture machine ${id}`, packageId = null) => ({ instance: {
    id, name, incus_id: `fixture-${id}`, host_id: 10, user_id: 1, status: 'stopped', image: 'debian/12',
    cpu: 100, memory: 512, disk: 2048, network_mode: 'nat', ipv4: '10.0.0.2', package_id: packageId,
    portLimit: 5, snapshotLimit: 5, remainingQuota: { port: 5, snapshot: 5 }, host: { name: 'Fixture host', user_id: 2 },
  } })
  const finish = async id => {
    const task = await last('task', id); if (task >= 0) await accept(task, { task: null })
    const traffic = await last('traffic', id); if (traffic >= 0) await accept(traffic, null)
  }
  await check(() => window.detailHarness?.pending.some(item => item.kind === 'instance'), 'detail starts')
  const a = await last('instance', 1)
  await goto(2); await accept(await last('instance', 2), instance(2)); await finish(2)
  await check(() => document.body.innerText.includes('Fixture machine 2'), 'new instance visible')
  await accept(a, instance(1)); await finish(1)
  assert.equal(await page.eval(() => document.body.innerText.includes('Fixture machine 1')), false, 'old route response cannot replace current instance')
  console.log('PASS instance detail old route response ignored')
  await check(() => !!window.detailHarness.view(), 'component state available for assertions')
  await goto(3); const oldThree = await last('instance', 3)
  await goto(4); const oldFour = await last('instance', 4)
  await goto(3); const newThree = await last('instance', 3)
  await accept(oldThree, instance(3, 'obsolete ABA'))
  await reject(oldFour)
  assert.equal(await page.eval(() => window.detailHarness.view().loading), true, 'obsolete success/error/finally cannot release current loading')
  assert.equal(await page.eval(() => window.detailHarness.toastEvents.length), 0, JSON.stringify(await page.eval(() => window.detailHarness.toastEvents)))
  assert.equal(await page.eval(() => window.detailHarness.router.currentRoute.value.path), '/instances/3')
  await accept(newThree, instance(3)); await finish(3)
  assert.equal(await page.eval(() => [...window.fixtureIntervals.values()].filter(timer => timer.delay === 5000).length), 1, 'late mount/route callbacks cannot create duplicate refresh intervals')
  await goto(5); await accept(await last('instance', 5), instance(5, 'Machine with package', 55))
  const oldPackage = await last('package', 55)
  await goto(6); await accept(await last('instance', 6), instance(6)); await finish(6)
  await accept(oldPackage, { package: { id: 55, name: 'Obsolete package', allowDelete: false } })
  assert.equal(await page.eval(() => window.detailHarness.view().instancePackage), null)
  assert.equal(await page.eval(() => window.detailHarness.view().instance.id), 6)

  // Read the same target twice, with the older poll completing last.
  await run(() => { void window.detailHarness.view().loadInstance() }); const firstPoll = await last('instance', 6)
  await run(() => { void window.detailHarness.view().loadInstance() }); const secondPoll = await last('instance', 6)
  await accept(secondPoll, instance(6, 'Latest poll')); await finish(6)
  await accept(firstPoll, instance(6, 'Obsolete poll'))
  assert.equal(await page.eval(() => window.detailHarness.view().instance.name), 'Latest poll')
  await run(() => { void window.detailHarness.view().loadInstance() }); const beforeAction = await last('instance', 6)
  await run(() => { window.detailHarness.view().actionLoading = 'start' })
  await accept(beforeAction, instance(6, 'Pre-action stale state'))
  assert.equal(await page.eval(() => window.detailHarness.view().instance.name), 'Latest poll', 'pre-action read cannot overwrite action state')
  await run(() => { window.detailHarness.view().actionLoading = '' })

  await goto(7); const sessionA = await last('instance', 7)
  await run(() => window.detailHarness.session('b')); const sessionB = await last('instance', 7)
  assert.notEqual(sessionA, sessionB)
  await accept(sessionA, instance(7, 'Old account'))
  assert.equal(await page.eval(() => window.detailHarness.view().instance), null)
  await accept(sessionB, instance(7)); await finish(7)
  const beforeRefresh = await last('instance', 7)
  await run(() => window.detailHarness.session('b', 2))
  assert.equal(await last('instance', 7), beforeRefresh, 'same-session JWT refresh does not reset the page')
  await run(() => { void window.detailHarness.view().loadInstance() }); const logoutRead = await last('instance', 7)
  await run(() => window.detailHarness.session(null))
  assert.equal(await page.eval(() => [...window.fixtureIntervals.values()].filter(timer => timer.delay === 5000).length), 0)
  await accept(logoutRead, instance(7, 'Logged out data'))
  assert.equal(await page.eval(() => window.detailHarness.view().instance), null)
  await run(() => window.detailHarness.session('c')); await accept(await last('instance', 7), instance(7)); await finish(7)
  console.log('PASS route ABA, obsolete failure/finally, package, overlapping polls, session refresh/change/logout')

  await goto(8); const running = instance(8); running.instance.status = 'running'
  await accept(await last('instance', 8), running)
  await check(() => window.detailHarness.pending.some(item => item.kind === 'stats' && item.id === 8), 'running stats start')
  const oldStats = await last('stats', 8), oldTask = await last('task', 8), oldCloud = await last('cloud-init', 8)
  await accept(oldTask, { task: null })
  const oldTraffic = await last('traffic', 8)
  await run(() => { void window.detailHarness.view().loadSnapshotsForQuota() }); const oldSnapshots = await last('snapshots', 8)
  await goto(9); await accept(await last('instance', 9), instance(9)); await finish(9)
  await accept(oldStats, { status: 'running', serviceFault: true, stats: { memory: { usage: 999, limit: 1000 }, disk: {}, network: {} } })
  if (oldTraffic >= 0) await accept(oldTraffic, { monthlyUsedFormatted: 'OBSOLETE TRAFFIC' })
  if (oldCloud >= 0) await accept(oldCloud, { ready: false, state: 'running' })
  await accept(oldSnapshots, [{ id: 888, name: 'obsolete snapshot' }])
  assert.deepEqual(await page.eval(() => {
    const view = window.detailHarness.view()
    return [view.instance.id, view.instance.status, view.instance.serviceFault || false, view.stats.memory.usage, view.snapshots.length,
      view.trafficLoading, view.statsLoading, view.cloudInitChecking, view.cloudInitReady]
  }), [9, 'stopped', false, 0, 0, false, false, false, true])

  await goto(10); await accept(await last('instance', 10), instance(10)); const staleTask = await last('task', 10)
  await goto(11); await accept(await last('instance', 11), instance(11)); await finish(11)
  await accept(staleTask, { task: { id: 999, status: 'PROCESSING', taskType: 'rebuild', queuePosition: 0 } })
  assert.equal(await page.eval(() => window.detailHarness.view().activeTask), null)
  await run(() => { window.detailHarness.view().startTaskPolling(1000) }); const pendingPoll = await last('task', 11)
  await goto(12); await accept(await last('instance', 12), instance(12)); await finish(12)
  await accept(pendingPoll, { task: { id: 1000, status: 'FAILED', error: 'obsolete failure', taskType: 'rebuild' } })
  assert.equal(await page.eval(() => window.detailHarness.toastEvents.length), 0)
  assert.equal(await page.eval(() => window.detailHarness.view().activeTask), null)
  console.log('PASS stale statistics, traffic, snapshots, cloud-init, task discovery and poll completion ignored')

  await goto(14); await accept(await last('instance', 14), instance(140, 'Wrong response target'))
  assert.equal(await page.eval(() => window.detailHarness.view().instance), null, 'mismatched API response target is rejected')
  assert.ok(await page.eval(() => window.detailHarness.view().loadError), 'current failure remains visible and retryable')
  await run(() => { void window.detailHarness.view().loadInstance() }); await accept(await last('instance', 14), instance(14)); await finish(14)

  for (const [locale, width, dark] of [['zh-CN', 1440, false], ['en', 390, true]]) {
    await page.setViewport({ width, height: 850, mobile: width === 390 })
    await run(({ locale, dark }) => { window.detailHarness.setLocale(locale); window.detailHarness.theme.setTheme(dark ? 'dark' : 'light') }, { locale, dark })
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true, 'page stays within viewport')
    await page.screenshot({ path: resolve(output, `${locale}-${width}.png`), format: 'png' })
  }
  await goto(13); const leaving = await last('instance', 13)
  await run(() => window.detailHarness.router.push('/other'))
  const requestsOnLeave = await page.eval(() => window.detailHarness.pending.length)
  await reject(leaving)
  await sleep(5200)
  assert.equal(await page.eval(() => window.detailHarness.router.currentRoute.value.path), '/other')
  assert.equal(await page.eval(() => window.detailHarness.toastEvents.length), 0)
  assert.equal(await page.eval(() => window.detailHarness.pending.length), requestsOnLeave, 'unmount leaves no request-producing poll timer')
  assert.equal(await page.eval(() => [...window.fixtureIntervals.values()].filter(timer => [2000, 3000, 5000].includes(timer.delay)).length), 0)
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log('PASS actual instance page in Chrome, desktop/mobile, unmount and late failure')
} finally { if (browser) await browser.close(); await server.close() }
