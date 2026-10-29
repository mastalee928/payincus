import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { Browser, sleep } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'
const root = fileURLToPath(new URL('..', import.meta.url)).replaceAll('\\', '/'), require = createRequire(new URL('../client/package.json', import.meta.url))
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href), { default: vue } = await import(pathToFileURL(require.resolve('@vitejs/plugin-vue')).href)
const output = resolve(root, 'logs/host-info-metrics'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js'); tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/host-info/*.js']
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/host-info', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/host-info/api.js' }, { find: '@', replacement: root + '/client/src' }, ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } }, server: { host: '127.0.0.1', port: 19739, strictPort: true, fs: { allow: [root] } }
})
const agent = { id: 1, hostId: 11, agentId: 'fixture-agent', enabled: true, status: 'online', version: 'v1.0.1', latestVersion: 'v1.0.1', versionStatus: 'latest', capabilities: ['resources'], lastReport: {}, lastSeenAt: null, lastHeartbeatIp: null, createdAt: '2026-10-30T00:00:00.000Z', updatedAt: '2026-10-30T00:00:00.000Z' }
const resources = ['cpuTotal', 'cpuUsagePercent', 'memoryTotalMb', 'memoryUsedMb', 'memoryAvailableMb', 'memoryUsagePercent', 'swapTotalMb', 'swapUsedMb', 'swapUsagePercent', 'diskTotalBytes', 'diskUsedBytes', 'diskAvailableBytes', 'diskUsagePercent', 'processCount']
const metrics = ['heartbeatIntervalSeconds', 'uptimeSeconds', 'load1', 'load5', 'load15']
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  const run = async (fn, arg) => { const value = await page.eval(fn, arg); await sleep(50); return value }
  await page.goto('http://127.0.0.1:19739', { settleMs: 350 })
  const deadline = Date.now() + 15000
  while (!await page.eval(() => !!window.hostInfoHarness?.view())) { if (Date.now() > deadline) throw Error('Host info fixture did not mount'); await sleep(70) }
  await run(agent => {
    const h = window.hostInfoHarness
    h.pending.find(p => p.kind === 'instances').resolve({ instances: [], total: 0 })
    h.pending.find(p => p.kind === 'traffic').resolve({ data: [], summary: { totalUsedFormatted: '0', totalLimitFormatted: '0' }, periodStart: '2026-10-01', periodEnd: '2026-10-31' })
    h.pending.find(p => p.kind === 'agent').resolve({ host: { id: 11, name: h.host.value.name }, agent })
    h.view().stopAgentStatusAutoRefresh()
  }, agent)
  await run(() => { window.hostInfoHarness.view().agentStatus.lastReport = { resources: { cpuUsagePercent: 'bad' }, metrics: { load1: {}, load5: 0, load15: 0 } } })
  assert.equal(page.consoleErrors.length, 0, 'malformed stored Agent metrics must not crash the actual Vue render: ' + page.consoleErrors.join('\n'))
  for (const bad of ['bad', '12.5', '', null, true, {}, [], -1]) {
    await run(({ bad, resources, metrics }) => { const v = window.hostInfoHarness.view(); v.agentStatus.lastReport = { resources: Object.fromEntries(resources.map(key => [key, bad])), metrics: Object.fromEntries(metrics.map(key => [key, bad])) } }, { bad, resources, metrics })
    assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
    assert.equal(await page.eval(() => /NaN|Infinity|\[object Object\]|bad/.test(document.querySelector('#app').textContent)), false, 'unvalidated numeric fields are missing values, never fake measurements')
    assert.equal(await page.eval(() => window.hostInfoHarness.view().formatPercent(window.hostInfoHarness.view().hostResources.cpuUsagePercent)), '-')
    assert.equal(await page.eval(() => window.hostInfoHarness.view().percentWidth(window.hostInfoHarness.view().hostResources.cpuUsagePercent)), '0%')
  }
  for (const mode of ['nan', 'positive-infinity', 'negative-infinity', 'undefined']) {
    await run(({ mode, resources, metrics }) => { const value = mode === 'nan' ? NaN : mode === 'positive-infinity' ? Infinity : mode === 'negative-infinity' ? -Infinity : undefined; window.hostInfoHarness.view().agentStatus.lastReport = { resources: Object.fromEntries(resources.map(key => [key, value])), metrics: Object.fromEntries(metrics.map(key => [key, value])) } }, { mode, resources, metrics })
    assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
    assert.equal(await page.eval(() => /NaN|Infinity/.test(document.querySelector('#app').textContent)), false)
  }
  for (const bad of [null, 'bad', [], { resources: null, metrics: [] }]) {
    await run(bad => { window.hostInfoHarness.view().agentStatus.lastReport = bad }, bad)
    assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  }
  await run(({ resources, metrics }) => { const v = window.hostInfoHarness.view(); v.agentStatus.lastReport = { resources: Object.fromEntries(resources.map(key => [key, 0])), metrics: Object.fromEntries(metrics.map(key => [key, 0])) } }, { resources, metrics })
  assert.equal(await page.eval(() => window.hostInfoHarness.view().formatPercent(0)), '0.0%')
  assert.equal(await page.eval(() => window.hostInfoHarness.view().formatLoadAverage(0, 0, 0)), '0.00 / 0.00 / 0.00')
  assert.equal(await page.eval(() => window.hostInfoHarness.view().formatUptime(0)), '0m')
  assert.equal(await page.eval(() => window.hostInfoHarness.view().formatMemoryPair(0, 0)), '0 / 0')
  assert.equal(await page.eval(() => window.hostInfoHarness.view().formatBytesPair(0, 0)), '0 / 0')
  assert.equal(await page.eval(() => window.hostInfoHarness.view().agentHeartbeatIntervalSeconds), 30)
  await run(() => { const v = window.hostInfoHarness.view(); v.agentStatus.lastReport = { incus: { available: true }, resources: { cpuTotal: 8, cpuUsagePercent: 12.5, memoryTotalMb: 8192, memoryUsedMb: 2048, memoryUsagePercent: 25, swapTotalMb: 0, swapUsedMb: 0, swapUsagePercent: 0, diskTotalBytes: 107374182400, diskUsedBytes: 10737418240, diskUsagePercent: 10, processCount: 24 }, metrics: { heartbeatIntervalSeconds: 120, uptimeSeconds: 86461, load1: 0.12, load5: 0.23, load15: 0.34 } }; v.stopAgentStatusAutoRefresh() })
  assert.equal(await page.eval(() => window.hostInfoHarness.view().agentHeartbeatIntervalSeconds), 120)
  assert.equal(await page.eval(() => window.hostInfoHarness.view().formatPercent(12.5)), '12.5%')
  assert.equal(await page.eval(() => window.hostInfoHarness.view().formatPercent(120)), '120.0%')
  assert.equal(await page.eval(() => window.hostInfoHarness.view().percentWidth(120)), '100%')
  assert.equal(await page.eval(() => window.hostInfoHarness.view().formatLoadAverage(0.12, 0.23, 0.34)), '0.12 / 0.23 / 0.34')
  for (const [locale, width] of [['zh-CN', 1440], ['zh-TW', 768], ['en', 390]]) {
    await page.setViewport({ width, height: 1000, mobile: width === 390 }); await run(locale => { window.hostInfoHarness.setLocale(locale); window.hostInfoHarness.theme.setTheme(innerWidth === 390 ? 'dark' : 'light') }, locale)
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: resolve(output, `${locale}-${width}.png`), format: 'png' })
  }
  assert.equal(await page.eval(() => window.hostInfoHarness.pending.every(p => ['instances', 'traffic', 'agent'].includes(p.kind))), true, 'metric rendering performs no mutations')
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log('PASS actual Vue malformed stored Agent resource/metric containers and 12 invalid scalar types, missing/zero/valid values, heartbeat interval guard and three-language responsive rendering; read only')
  if (process.argv.includes('--serve')) { console.log('Host info inspector fixture ready at http://127.0.0.1:19739/?inspect'); await new Promise(() => {}) }
} finally { if (browser) await browser.close(); await server.close() }
