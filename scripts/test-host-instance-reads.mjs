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
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/host-instance-reads/*.js']
const output = resolve(root, 'logs/host-instance-reads-lifecycle'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const server = await createServer({ configFile: false, root: root + '/scripts/fixtures/host-instance-reads', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/host-instance-reads/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19679, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19679', { settleMs: 1600 })
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(90); return result }
  const last = kind => page.eval(kind => window.hostReads.pending.findLastIndex(item => item.kind === kind), kind)
  const accept = (index, data) => run(({ index, data }) => window.hostReads.pending[index].resolve(data), { index, data })
  const reject = index => run(index => window.hostReads.pending[index].reject(new Error('Fixture read failure')), index)
  const view = key => page.eval(key => JSON.parse(JSON.stringify(window.hostReads.view()[key])), key)
  const row = (id, name, hostId = 1) => ({ id, name, hostId, status: 'running', image: 'debian/12', cpu: 1, memory: 512, disk: 10240, createdAt: '2030-01-01T00:00:00Z', username: 'Fixture user', networkMode: 'nat', packagePlanId: null })
  const reply = (id, name, hostId = 1, totalPages = 1) => ({ instances: [row(id, name, hostId)], total: totalPages * 10, totalPages })
  const traffic = label => ({ monthlyUsed: '1', monthlyUsedFormatted: label, monthlyLimit: null, monthlyLimitFormatted: null, percentage: 0 })
  const ready = async (index, data) => { const before = await last('traffic'); await accept(index, data); const now = await last('traffic'); if (now > before) await accept(now, traffic('1 B')) }
  const search = async text => { await run(text => { const v = window.hostReads.view(); v.searchQuery = text; void v.handleSearch() }, text); return last('list') }
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  await ready(await last('list'), reply(1, 'Initial'))
  const old = await search('old'), current = await search('new')
  await ready(current, reply(3, 'new')); await ready(old, reply(2, 'old'))
  assert.equal((await view('instances'))[0].name, 'new', 'older host list must not overwrite the latest search')
  console.log('PASS host instance list drops stale searches')
  const first = await search('A'), middle = await search('B'), final = await search('A')
  await accept(first, reply(4, 'stale A')); await reject(middle)
  assert.deepEqual(await view('instances'), []); assert.equal(await view('loading'), true)
  await ready(final, reply(5, 'current A', 1, 3))
  await run(() => window.hostReads.view().toggleSelect(5))
  assert.equal(await page.eval(() => window.hostReads.view().selectedIds.size), 1)
  await run(() => { window.hostReads.view().page = 2; void window.hostReads.view().loadInstances() }); const second = await last('list')
  assert.equal(await page.eval(() => window.hostReads.view().selectedIds.size), 0)
  await run(() => { window.hostReads.view().page = 3; void window.hostReads.view().loadInstances() }); const third = await last('list')
  await ready(third, reply(7, 'page 3', 1, 3)); await reject(second)
  assert.equal((await view('instances'))[0].name, 'page 3'); assert.equal(await view('page'), 3)
  await run(() => window.hostReads.view().toggleSelect(999)); assert.equal(await page.eval(() => window.hostReads.view().selectedIds.size), 0)
  await run(() => { window.hostReads.view().pageSize = 30; window.hostReads.view().handlePageSizeChange() })
  assert.equal(await view('page'), 1); await ready(await last('list'), reply(8, 'size 30'))
  await run(() => window.hostReads.view().toggleSelect(8)); await run(() => { void window.hostReads.view().loadInstances() })
  await ready(await last('list'), reply(8, 'same query'))
  assert.equal(await page.eval(() => window.hostReads.view().selectedIds.has(8)), true, 'same-query refresh keeps only existing selected IDs')
  await run(() => {
    const v = window.hostReads.view(); v.showDeleteModal = true; v.deleteSelectionOverride = [8]
    v.deleteFailures = [{ id: 8, name: 'same query', error: 'Fixture deletion failed' }]
    v.deletePreview = { instances: [], totalRefundAmount: 0 }
  })
  await run(() => { void window.hostReads.view().loadInstances() })
  assert.equal(await view('deletePreview'), null)
  await ready(await last('list'), reply(8, 'same-query failure retained'))
  assert.equal(await view('showDeleteModal'), true); assert.equal((await view('deleteFailures')).length, 1)
  const renewedPreview = await last('delete-preview')
  assert.deepEqual(await page.eval(index => window.hostReads.pending[index].params, renewedPreview), { hostId: 1, ids: [8] })
  await accept(renewedPreview, { instances: [{ id: 8, name: 'same query', refundAmount: 0 }], totalRefundAmount: 0 })
  await run(() => { void window.hostReads.view().loadInstances() }); await ready(await last('list'), reply(9, 'removed selected row'))
  assert.equal(await page.eval(() => window.hostReads.view().selectedIds.size), 0)
  assert.equal(await view('showDeleteModal'), false)
  let request = await search('failed'); await reject(request)
  assert.deepEqual(await view('instances'), []); assert.equal(await view('total'), 0); assert.ok(await view('loadError'))
  await run(() => document.querySelector('[role="alert"] button').click()); await ready(await last('list'), reply(10, 'retry'))
  assert.equal(await view('loadError'), '')
  await run(() => { window.hostReads.view().page = 5; void window.hostReads.view().loadInstances() }); const clamp = await last('list')
  await accept(clamp, { instances: [], total: 20, totalPages: 2 })
  assert.equal(await view('page'), 2); assert.ok(await last('list') > clamp)
  await ready(await last('list'), reply(11, 'clamped', 1, 2))
  for (const data of [{ instances: [row(12, 'wrong host', 2)], total: 1, totalPages: 1 }, { instances: [row(12, 'duplicate'), row(12, 'duplicate')], total: 2, totalPages: 1 }]) {
    request = await search('invalid response'); await accept(request, data)
    assert.deepEqual(await view('instances'), []); assert.ok(await view('loadError'))
  }
  await ready(await search('traffic old'), reply(13, 'traffic base'))
  await run(() => { void window.hostReads.view().loadInstancesTraffic() }); const oldTraffic = await last('traffic')
  await ready(await search('traffic new'), reply(13, 'traffic new'))
  await accept(oldTraffic, traffic('STALE'))
  assert.equal((await view('instances'))[0].trafficData.monthlyUsedFormatted, '1 B')
  await run(() => { void window.hostReads.view().loadInstancesTraffic() }); const earlierTraffic = await last('traffic')
  await run(() => { void window.hostReads.view().loadInstancesTraffic() }); const currentTraffic = await last('traffic')
  await accept(currentTraffic, traffic('new traffic')); await accept(earlierTraffic, traffic('old traffic'))
  assert.equal((await view('instances'))[0].trafficData.monthlyUsedFormatted, 'new traffic')
  const config = enabled => ({ swap: { available: true, enabled, sizeMb: 512 }, customConfig: {} })
  await run(() => { void window.hostReads.view().loadInstanceDetailConfig(13, true) }); const oldConfig = await last('config'), oldDetail = await last('detail')
  await run(() => { void window.hostReads.view().loadInstanceDetailConfig(13, true) }); const newConfig = await last('config'), newDetail = await last('detail')
  await accept(newConfig, config(true)); await accept(newDetail, row(13, 'current detail'))
  await accept(oldConfig, config(false)); await accept(oldDetail, row(13, 'stale detail'))
  assert.equal((await view('instances'))[0].name, 'current detail'); assert.equal((await view('detailConfigs'))[13].swap.enabled, true)
  await run(() => { void window.hostReads.view().loadInstanceDetailConfig(13, true) }); const obsoleteConfig = await last('config'), obsoleteDetail = await last('detail')
  await ready(await search('new detail query'), reply(13, 'fresh row'))
  await accept(obsoleteConfig, config(false)); await accept(obsoleteDetail, row(13, 'old detail query'))
  assert.deepEqual(await view('detailConfigs'), {}); assert.equal((await view('instances'))[0].name, 'fresh row')
  await run(() => { void window.hostReads.view().loadInstanceDetailConfig(13, true) })
  await reject(await last('config')); await accept(await last('detail'), row(13, 'detail with config failure'))
  assert.ok((await view('detailConfigErrors'))[13]); assert.equal(await page.eval(() => window.hostReads.view().detailLoadingIds.size), 0)
  console.log('PASS queries, pagination, selection, failure retry, invalid rows, traffic and detail ordering')
  await run(() => { void window.hostReads.view().loadInstances() }); const oldHost = await last('list')
  await run(() => { window.hostReads.state.id = 2 }); const otherHost = await last('list')
  await run(() => { window.hostReads.state.id = 1 }); const currentHost = await last('list')
  await accept(oldHost, reply(14, 'old host')); await reject(otherHost)
  assert.deepEqual(await view('instances'), []); assert.equal(await view('loading'), true)
  await ready(currentHost, reply(15, 'current host'))
  const beforeRefresh = await last('list'); await run(() => window.hostReads.session('a', 2)); assert.equal(await last('list'), beforeRefresh)
  await run(() => { void window.hostReads.view().loadInstances() }); const oldSession = await last('list')
  await run(() => window.hostReads.session('b')); await accept(oldSession, reply(16, 'old session'))
  assert.deepEqual(await view('instances'), []); await ready(await last('list'), reply(17, 'new session'))
  await run(() => { window.hostReads.auth.user = { id: 2, role: 'user', username: 'fixture2' } })
  assert.deepEqual(await view('instances'), []); await ready(await last('list'), reply(18, 'new user'))
  request = await search('cache'); await run(() => { window.hostReads.state.active = false }); await accept(request, reply(19, 'cached stale'))
  assert.deepEqual(await view('instances'), []); assert.equal(await view('loading'), false)
  const inactive = await last('list'); await run(() => { void window.hostReads.view().loadInstances() }); assert.equal(await last('list'), inactive)
  await run(() => { window.hostReads.state.active = true }); assert.equal(await last('list'), inactive + 1)
  await ready(await last('list'), reply(20, 'reactivated'))
  await run(() => { window.hostReads.state.id = 0 }); const invalidHost = await last('list')
  await run(() => { void window.hostReads.view().loadInstances() }); assert.equal(await last('list'), invalidHost)
  await run(() => { window.hostReads.state.id = 1 }); await ready(await last('list'), reply(21, 'valid again'))
  await run(() => window.hostReads.session(null)); const loggedOut = await last('list')
  await run(() => { void window.hostReads.view().loadInstances() }); assert.equal(await last('list'), loggedOut); assert.deepEqual(await view('instances'), [])
  await run(() => window.hostReads.session('c')); await ready(await last('list'), reply(22, 'Preview fixture instance'))
  for (const [locale, width, dark, mobile] of [['zh-CN', 1440, false, false], ['en', 390, true, true]]) {
    await page.setViewport({ width, height: 1000, mobile })
    await run(({ locale, dark }) => { window.hostReads.setLocale(locale); window.hostReads.theme.setTheme(dark ? 'dark' : 'light') }, { locale, dark })
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: resolve(output, `${locale}-${width}.png`), format: 'png' })
  }
  request = await search('unmount'); await run(() => { window.hostReads.state.mounted = false }); await accept(request, reply(23, 'unmounted'))
  assert.deepEqual(await view('instances'), []); const unmounted = await last('list')
  await run(() => { void window.hostReads.view().loadInstances() }); assert.equal(await last('list'), unmounted)
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log('PASS host/session/account/cache/logout/unmount lifecycle and desktop/mobile Chrome')
} finally { if (browser) await browser.close(); await server.close() }

