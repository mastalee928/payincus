import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { Browser, sleep } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'
const root = fileURLToPath(new URL('..', import.meta.url)).replaceAll('\\', '/'), require = createRequire(new URL('../client/package.json', import.meta.url))
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href), { default: vue } = await import(pathToFileURL(require.resolve('@vitejs/plugin-vue')).href)
const output = resolve(root, 'logs/host-info-mutations'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js'); tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/host-info/*.js']
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/host-info', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/host-info/api.js' }, { find: '@', replacement: root + '/client/src' }, ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } }, server: { host: '127.0.0.1', port: 19742, strictPort: true, fs: { allow: [root] } }
})
const agent = (hostId = 11) => ({ id: 1, hostId, agentId: 'fixture-agent', enabled: true, status: 'online', version: 'v1.0.1', latestVersion: 'v1.0.2', versionStatus: 'outdated', capabilities: ['resources'], lastReport: {}, lastSeenAt: null, lastHeartbeatIp: null, createdAt: '2026-10-30T00:00:00.000Z', updatedAt: '2026-10-30T00:00:00.000Z' })
const result = kind => kind === 'upgrade' ? { requested: true, currentVersion: 'v1.0.1', latestVersion: 'v1.0.2', versionStatus: 'outdated', nextHeartbeatSeconds: 30, message: 'fixture accepted' }
  : kind === 'install' ? { host: { id: 11, name: 'fixture' }, agent: agent(), installCommand: 'DISPLAY-ONLY fixture install', installTokenExpiresAt: new Date(Date.now() + 60000).toISOString() }
    : kind === 'recalculate' ? { hasChanges: true, message: 'fixture recalculated' } : { status: 'synced', addresses: [], primary: null, error: null, checkedAt: '2026-10-30T00:00:00.000Z', changedAt: null }
const methods = { upgrade: 'requestAgentUpgrade', install: 'generateAgentInstallCommand', recalculate: 'recalculateResources', ipv6: 'syncIpv6' }
let browser, checked = 0
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  const run = async (fn, arg) => { const value = await page.eval(fn, arg); await sleep(40); return value }
  const fresh = async () => {
    await page.goto('http://127.0.0.1:19742', { settleMs: 250 }); const deadline = Date.now() + 15000
    while (!await page.eval(() => !!window.hostInfoHarness?.view())) { if (Date.now() > deadline) throw Error('Host info mutation fixture did not mount'); await sleep(70) }
    await run(agent => { const h = hostInfoHarness; window.confirm = () => true; h.host.value.natConfig = { publicIpv6: '2001:db8::11', publicIpv6Sync: { status: 'synced', addresses: [], primary: null, error: null, checkedAt: null, changedAt: null } }; h.view().agentStatus = agent; h.view().stopAgentStatusAutoRefresh() }, agent())
  }
  const submit = kind => run(method => { void hostInfoHarness.view()[method]() }, methods[kind])
  const receipt = (index, payload, fail = false) => run(({ index, payload, fail }) => { const p = hostInfoHarness.pending[index]; fail ? p.reject(Error('fixture failed')) : p.resolve(payload) }, { index, payload, fail })
  for (const kind of Object.keys(methods)) for (const mode of ['host', 'host-aba', 'account', 'sid', 'role', 'logout', 'session-aba', 'cache', 'unmount']) for (const fail of [false, true]) {
    await fresh(); await submit(kind)
    assert.equal(await page.eval(() => hostInfoHarness.pending[3].data.id), 11)
    await run(mode => { const h = hostInfoHarness
      if (mode === 'host') h.host.value = { ...h.host.value, id: 12 }
      if (mode === 'host-aba') { h.host.value = { ...h.host.value, id: 12 }; h.host.value = { ...h.host.value, id: 11 } }
      if (mode === 'account') h.session(2)
      if (mode === 'sid') h.session(1, 'other')
      if (mode === 'role') h.session(1, 'host-info-session', 'user')
      if (mode === 'logout') h.auth.clearLocalAuth()
      if (mode === 'session-aba') { h.session(2); h.session(1) }
      if (mode === 'cache') h.active.value = false
      if (mode === 'unmount') h.mounted.value = false
    }, mode)
    const before = await page.eval(() => JSON.stringify({ pending: hostInfoHarness.pending.length, refresh: hostInfoHarness.refreshes.value, agent: hostInfoHarness.view()?.agentStatus, command: hostInfoHarness.view()?.agentInstallCommand }))
    await receipt(3, result(kind), fail)
    assert.equal(await page.eval(() => hostInfoHarness.toast.toasts.value.length), 0, kind + ' ' + mode + ' discards obsolete toast')
    assert.equal(await page.eval(() => JSON.stringify({ pending: hostInfoHarness.pending.length, refresh: hostInfoHarness.refreshes.value, agent: hostInfoHarness.view()?.agentStatus, command: hostInfoHarness.view()?.agentInstallCommand })), before, kind + ' ' + mode + ' cannot refresh or replace the current host')
    checked++
  }
  for (const kind of Object.keys(methods)) {
    await fresh(); await submit(kind)
    for (const other of Object.keys(methods)) await submit(other)
    assert.equal(await page.eval(() => hostInfoHarness.pending.length), 4, 'four mutations share a pending-operation gate')
    await receipt(3, null, true)
    assert.ok(await page.eval(() => document.querySelector('[data-host-mutation-error]')), 'failed current mutation has a persistent error')
    await submit(kind); await receipt(4, result(kind))
    assert.equal(await page.eval(() => !!document.querySelector('[data-host-mutation-error]')), false)
    assert.equal(await page.eval(() => hostInfoHarness.pending[4].data.id), 11)
    if (kind === 'install') assert.equal(await page.eval(() => hostInfoHarness.view().agentInstallCommand), 'DISPLAY-ONLY fixture install')
    if (['recalculate', 'ipv6'].includes(kind)) assert.equal(await page.eval(() => hostInfoHarness.refreshes.value), 1)
    await fresh(); await run(() => { hostInfoHarness.auth.clearLocalAuth() }); await submit(kind)
    assert.equal(await page.eval(() => hostInfoHarness.pending.length), 3, 'unavailable context blocks submission')
    const malformed = kind === 'upgrade' ? [null, {}, { ...result(kind), requested: 'yes' }, { ...result(kind), message: '' }, { ...result(kind), nextHeartbeatSeconds: '30' }]
      : kind === 'install' ? [null, {}, { ...result(kind), host: { id: 12 } }, { ...result(kind), agent: agent(12) }, { ...result(kind), installCommand: '' }, { ...result(kind), installTokenExpiresAt: 'invalid' }]
        : kind === 'recalculate' ? [null, {}, { ...result(kind), hasChanges: 'yes' }, { ...result(kind), message: '' }] : [null, {}, { ...result(kind), status: 'bogus' }, { ...result(kind), addresses: null }]
    for (const payload of malformed) {
      await fresh(); await submit(kind); await receipt(3, payload)
      assert.ok(await page.eval(() => document.querySelector('[data-host-mutation-error]')), kind + ' invalid receipt is not success')
      assert.equal(await page.eval(() => hostInfoHarness.refreshes.value), 0)
      assert.equal(await page.eval(() => hostInfoHarness.pending.length), 4)
    }
  }
  await fresh(); await run(() => { window.confirm = () => false }); await submit('install')
  assert.equal(await page.eval(() => hostInfoHarness.pending.length), 3, 'cancelled install stays read-only')
  await fresh(); await submit('install'); await run(() => { hostInfoHarness.auth.token = 'fixture.' + btoa(JSON.stringify({ sid: 'host-info-session', revision: 2 })) + '.fixture' }); await receipt(3, result('install'))
  assert.equal(await page.eval(() => hostInfoHarness.view().agentInstallCommand), 'DISPLAY-ONLY fixture install')
  await fresh(); await submit('install'); await receipt(3, result('install')); await receipt(2, { host: { id: 11 }, agent: { ...agent(), version: 'old-status' } })
  assert.equal(await page.eval(() => hostInfoHarness.view().agentStatus.version), 'v1.0.1', 'old read cannot overwrite a successful install result')
  for (const kind of Object.keys(methods)) {
    await fresh(); await submit(kind); await run(() => { hostInfoHarness.active.value = false }); await run(() => { hostInfoHarness.active.value = true })
    const before = await page.eval(() => hostInfoHarness.pending.length)
    await submit(kind)
    assert.equal(await page.eval(() => hostInfoHarness.pending.length), before, 'cached return retains the pending write lock')
    await receipt(3, result(kind))
    assert.equal(await page.eval(() => hostInfoHarness.toast.toasts.value.length), 0)
    await run(agent => { hostInfoHarness.view().agentStatus = agent }, agent()); await submit(kind)
    assert.equal(await page.eval(() => hostInfoHarness.pending.length), before + 1, 'obsolete write finally releases its own lock')
    if (kind === 'install') assert.ok(await page.eval(() => hostInfoHarness.pending.filter(p => p.kind === 'agent').length >= 2), 'current reads on cached return are not blocked by an old install')
  }
  await fresh(); await run(() => { window.confirm = () => { hostInfoHarness.session(2); return true } }); await submit('install')
  assert.equal(await page.eval(() => hostInfoHarness.pending.filter(p => p.kind === 'install').length), 0, 'confirmation cannot submit for a replacement context')
  for (const kind of ['upgrade', 'recalculate']) {
    await fresh(); await submit(kind)
    await receipt(3, kind === 'upgrade' ? { ...result(kind), requested: false, versionStatus: 'latest' } : { ...result(kind), hasChanges: false })
    assert.equal(await page.eval(() => !!document.querySelector('[data-host-mutation-error]')), false, 'valid false response is preserved')
    assert.equal(await page.eval(() => hostInfoHarness.refreshes.value), 0)
  }
  for (const locale of ['zh-CN', 'zh-TW', 'en']) for (const width of [1440, 768, 390]) {
    await fresh(); await page.setViewport({ width, height: 1000, mobile: width === 390 })
    await run(locale => hostInfoHarness.setLocale(locale), locale)
    await run(() => { document.querySelector('button[title]').click() })
    assert.equal(await page.eval(() => hostInfoHarness.pending[3].kind), 'recalculate', 'actual recalculation control submits current host')
    await receipt(3, null, true)
    assert.ok(await page.eval(() => document.querySelector('[data-host-mutation-error]').textContent.includes(hostInfoHarness.t('admin.hosts.recalculateFailed'))))
    assert.ok(await page.eval(() => document.documentElement.scrollWidth <= innerWidth))
  }
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log(`PASS actual Vue four host mutations, ${checked} obsolete receipts, shared duplicate/conflict gate, failed retry, invalid receipts, current result and same sid; controlled API, no real host writes`)
  if (process.argv.includes('--serve')) { console.log('Host info mutation fixture ready at http://127.0.0.1:19742/?inspect&mutations'); await new Promise(() => {}) }
} finally { if (browser) await browser.close(); await server.close() }
