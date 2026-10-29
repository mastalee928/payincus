import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { Browser, sleep } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'
const root = fileURLToPath(new URL('..', import.meta.url)).replaceAll('\\', '/'), require = createRequire(new URL('../client/package.json', import.meta.url))
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href), { default: vue } = await import(pathToFileURL(require.resolve('@vitejs/plugin-vue')).href)
const output = resolve(root, 'logs/host-info-reads'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js'); tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/host-info/*.js']
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/host-info', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/host-info/api.js' }, { find: '@', replacement: root + '/client/src' }, ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } }, server: { host: '127.0.0.1', port: 19740, strictPort: true, fs: { allow: [root] } }
})
const agent = (hostId = 11, stamp = 1) => ({ host: { id: hostId, name: 'fixture' }, agent: { id: hostId, hostId, agentId: `fixture-${hostId}`, enabled: true, status: 'online', version: 'v1.0.1', latestVersion: 'v1.0.1', versionStatus: 'latest', capabilities: ['resources'], lastReport: { resources: { cpuUsagePercent: stamp }, metrics: { heartbeatIntervalSeconds: 5 } }, lastSeenAt: null, lastHeartbeatIp: null, createdAt: '2026-10-30T00:00:00.000Z', updatedAt: '2026-10-30T00:00:00.000Z' } })
const data = (kind, hostId = 11, stamp = 1) => kind === 'agent' ? agent(hostId, stamp) : kind === 'instances' ? { instances: [{ id: stamp, cpu: stamp, memory: stamp * 1024, disk: stamp * 1024 }], total: 1 } : { data: [{ date: '2026-10-01', rxTotal: String(stamp), txTotal: '0', total: String(stamp), rxFormatted: `${stamp} B`, txFormatted: '0 B', totalFormatted: `${stamp} B` }], summary: { totalUsed: String(stamp), totalUsedFormatted: `${stamp} B`, totalLimit: '1024', totalLimitFormatted: '1K' }, periodStart: '2026-10-01', periodEnd: '2026-10-31' }
let browser, checked = 0
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  const run = async (fn, arg) => { const value = await page.eval(fn, arg); await sleep(40); return value }
  const fresh = async () => {
    await page.goto('http://127.0.0.1:19740', { settleMs: 250 }); const deadline = Date.now() + 15000
    while (!await page.eval(() => !!window.hostInfoHarness?.view())) { if (Date.now() > deadline) throw Error('Host info read fixture did not mount'); await sleep(70) }
  }
  const settle = (index, result, fail = false) => run(({ index, result, fail }) => { const request = window.hostInfoHarness.pending[index]; fail ? request.reject(Error('fixture unavailable')) : request.resolve(result) }, { index, result, fail })
  const initialize = async () => { for (let index = 0; index < 3; index++) { const kind = await page.eval(index => window.hostInfoHarness.pending[index].kind, index); await settle(index, data(kind)) } }
  for (const kind of ['instances', 'traffic', 'agent']) {
    await fresh(); await initialize()
    await run(kind => { const view = window.hostInfoHarness.view(), method = kind === 'instances' ? 'loadInstanceStats' : kind === 'traffic' ? 'loadTrafficHistory' : 'loadAgentStatus'; void view[method](); void view[method]() }, kind)
    await settle(4, data(kind, 11, 3)); await settle(3, data(kind, 11, 2))
    assert.equal(await page.eval(kind => { const v = window.hostInfoHarness.view(); return kind === 'instances' ? v.instanceStats.cpuUsed : kind === 'traffic' ? Number(v.trafficHistory[0].total) : v.hostResources.cpuUsagePercent }, kind), 3, 'the older ' + kind + ' read must not overwrite the newest current read')
  }
  for (const mode of ['host', 'host-aba', 'account', 'sid', 'role', 'logout', 'session-aba', 'cache', 'unmount']) for (const fail of [false, true]) {
    await fresh(); await initialize()
    await run(() => { const h = window.hostInfoHarness, v = h.view(); void v.loadInstanceStats(); void v.loadTrafficHistory(); void v.loadAgentStatus(true); window.oldHostInfo = v; window.oldHostPoll = [...h.intervals.values()][0].callback })
    await run(mode => { const h = window.hostInfoHarness
      if (mode === 'host') h.host.value = { ...h.host.value, id: 12, name: '另一个宿主' }
      if (mode === 'host-aba') { h.host.value = { ...h.host.value, id: 12 }; h.host.value = { ...h.host.value, id: 11 } }
      if (mode === 'account') h.session(2)
      if (mode === 'sid') h.session(1, 'other-host-session')
      if (mode === 'role') h.session(1, 'host-info-session', 'user')
      if (mode === 'logout') h.auth.clearLocalAuth()
      if (mode === 'session-aba') { h.session(2); h.session(1) }
      if (mode === 'cache') h.active.value = false
      if (mode === 'unmount') h.mounted.value = false
    }, mode)
    const requestCount = await page.eval(() => window.hostInfoHarness.pending.length)
    await run(() => { window.oldHostPoll() })
    assert.equal(await page.eval(() => window.hostInfoHarness.pending.length), requestCount, mode + ' also rejects an already queued obsolete poll callback')
    const before = await page.eval(() => JSON.stringify({ stats: oldHostInfo.instanceStats, traffic: oldHostInfo.trafficHistory, summary: oldHostInfo.trafficSummary, agent: oldHostInfo.agentStatus, error: oldHostInfo.agentStatusError, toast: window.hostInfoHarness.toast.toasts.value.map(t => t.message) }))
    for (let index = 3; index < 6; index++) { const kind = await page.eval(index => window.hostInfoHarness.pending[index].kind, index); await settle(index, data(kind, 11, 8), fail) }
    assert.equal(await page.eval(() => JSON.stringify({ stats: oldHostInfo.instanceStats, traffic: oldHostInfo.trafficHistory, summary: oldHostInfo.trafficSummary, agent: oldHostInfo.agentStatus, error: oldHostInfo.agentStatusError, toast: window.hostInfoHarness.toast.toasts.value.map(t => t.message) })), before, mode + ' rejects old read success/failure and toast')
    if (['cache', 'unmount', 'logout'].includes(mode)) assert.equal(await page.eval(() => window.hostInfoHarness.intervals.size), 0, 'old completion cannot restart a hidden view poll')
    if (mode === 'cache') {
      await run(() => { window.hostInfoHarness.active.value = true })
      assert.equal(await page.eval(() => window.hostInfoHarness.pending.length), 9, 'return to cached info reloads the three current reads')
    }
    checked++
  }
  await fresh(); await initialize(); await run(() => { window.hostInfoHarness.auth.token = 'fixture.' + btoa(JSON.stringify({ sid: 'host-info-session', revision: 2 })) + '.fixture' })
  assert.equal(await page.eval(() => window.hostInfoHarness.pending.length), 3, 'same sid token refresh does not replace the read context')
  await run(() => { const v = window.hostInfoHarness.view(); void v.loadAgentStatus(); void v.loadAgentStatus() })
  await settle(4, data('agent', 11, 4)); await settle(3, null, true)
  assert.equal(await page.eval(() => window.hostInfoHarness.view().agentStatusError), '', 'old failures cannot hide successful newest polling')
  await run(() => { const h = window.hostInfoHarness; [...h.intervals.values()][0].callback() })
  assert.equal(await page.eval(() => window.hostInfoHarness.pending.at(-1).data.id), 11)
  const pollingCount = await page.eval(() => window.hostInfoHarness.pending.length)
  await run(() => { const h = window.hostInfoHarness; [...h.intervals.values()][0].callback() })
  assert.equal(await page.eval(() => window.hostInfoHarness.pending.length), pollingCount, 'automatic polling does not overlap an unfinished current read')
  const errors = { instances: 'data-host-stats-error', traffic: 'data-host-traffic-error', agent: 'data-host-agent-error' }
  for (const kind of ['instances', 'traffic', 'agent']) {
    const invalid = kind === 'instances' ? [null, {}, { instances: null, total: 0 }, { instances: [null], total: 1 }, { instances: [{ cpu: '5' }], total: 1 }, { instances: [], total: -1 }]
      : kind === 'traffic' ? [null, {}, { ...data(kind), data: null }, { ...data(kind), data: [{ ...data(kind).data[0], total: 'bad' }] }, { ...data(kind), periodStart: null }, { ...data(kind), summary: {} }]
      : [null, {}, { ...agent(), host: { id: 12 } }, { ...agent(), agent: { ...agent().agent, hostId: 12 } }, { ...agent(), agent: { ...agent().agent, enabled: 'yes' } }, { ...agent(), agent: { ...agent().agent, capabilities: null } }]
    for (const result of invalid) {
      await fresh()
      const index = await page.eval(kind => window.hostInfoHarness.pending.findIndex(p => p.kind === kind), kind)
      await settle(index, result)
      assert.ok(await page.eval(attr => document.querySelector('[' + attr + ']')?.textContent, errors[kind]), 'failed current ' + kind + ' has a persistent block-local retry')
      if (kind === 'traffic') assert.equal(await page.eval(() => !!document.querySelector('[data-host-traffic-empty]')), false)
      if (kind === 'agent') assert.equal(await page.eval(() => window.hostInfoHarness.view().agentStatus), null)
      await run(attr => { document.querySelector('[' + attr + '] button').click() }, errors[kind])
      const retry = await page.eval(() => window.hostInfoHarness.pending.length - 1)
      assert.equal(await page.eval(index => window.hostInfoHarness.pending[index].kind, retry), kind)
      await settle(retry, data(kind))
      assert.equal(await page.eval(attr => !!document.querySelector('[' + attr + ']'), errors[kind]), false, 'actual retry clears the current failed block')
    }
    await fresh(); await initialize()
    await run(kind => { const v = window.hostInfoHarness.view(); void v[kind === 'instances' ? 'loadInstanceStats' : kind === 'traffic' ? 'loadTrafficHistory' : 'loadAgentStatus']() }, kind)
    await settle(3, null, true)
    assert.ok(await page.eval(attr => document.querySelector('[' + attr + ']'), errors[kind]))
    assert.equal(await page.eval(kind => { const v = window.hostInfoHarness.view(); return kind === 'instances' ? v.instanceStats.cpuUsed : kind === 'traffic' ? Number(v.trafficHistory[0].total) : v.hostResources.cpuUsagePercent }, kind), 1, 'failed refresh retains last confirmed current values')
  }
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log(`PASS actual Vue host info three independent read orderings, ${checked} obsolete context receipts and queued polls, hidden poll shutdown/return, same sid, non-overlapping polling, 18 malformed reads/actual retry and last-good preservation; controlled read-only API`)
  if (process.argv.includes('--serve')) { console.log('Host info read inspector fixture ready at http://127.0.0.1:19740/?inspect'); await new Promise(() => {}) }
} finally { if (browser) await browser.close(); await server.close() }
