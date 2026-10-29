import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { Browser, sleep } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'
const root = fileURLToPath(new URL('..', import.meta.url)).replaceAll('\\', '/'), require = createRequire(new URL('../client/package.json', import.meta.url))
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href), { default: vue } = await import(pathToFileURL(require.resolve('@vitejs/plugin-vue')).href)
const output = resolve(root, 'logs/host-info-copy'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js'); tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/host-info/*.js']
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/host-info', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/host-info/api.js' }, { find: '@', replacement: root + '/client/src' }, ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } }, server: { host: '127.0.0.1', port: 19741, strictPort: true, fs: { allow: [root] } }
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(35); return result }
  const fresh = async () => {
    await page.goto('http://127.0.0.1:19741', { settleMs: 250 }); const deadline = Date.now() + 15000
    while (!await page.eval(() => !!window.hostInfoHarness?.view())) { if (Date.now() > deadline) throw Error('Host info copy fixture did not mount'); await sleep(70) }
    await run(() => {
      const h = window.hostInfoHarness, v = h.view()
      v.stopAgentStatusAutoRefresh(); v.agentInstallCommand = 'DISPLAY-ONLY fixture command'; v.agentInstallTokenExpiresAt = new Date(Date.now() + 60000).toISOString()
      window.clipboardRequests = []; window.copyPromises = []
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: text => new Promise((resolve, reject) => clipboardRequests.push({ text, resolve, reject })) } })
      window.copyHostCommand = () => { const result = v.copyAgentInstallCommand(); copyPromises.push(result); if (result?.catch) result.catch(() => {}) }
    })
  }
  await fresh(); await run(() => copyHostCommand())
  assert.equal(await page.eval(() => hostInfoHarness.toast.toasts.value.length), 0, 'copy success must wait for actual clipboard completion')
  await run(() => { clipboardRequests[0].resolve() })
  assert.equal(await page.eval(() => hostInfoHarness.toast.toasts.value.at(-1).message), await page.eval(() => hostInfoHarness.t('admin.hosts.agentInstallCommandCopied')))
  await fresh(); await run(() => { copyHostCommand(); copyHostCommand() })
  assert.equal(await page.eval(() => clipboardRequests.length), 1, 'unfinished copy is not duplicated')
  assert.equal(await page.eval(() => document.querySelector('[data-host-command-copy]').disabled), true)
  await run(() => { clipboardRequests[0].reject(Error('clipboard denied')) })
  assert.equal(await page.eval(() => hostInfoHarness.toast.toasts.value.at(-1).message), await page.eval(() => hostInfoHarness.t('common.copyFailed')))
  assert.ok(await page.eval(() => document.querySelector('[data-host-command-copy-error]')))
  await run(() => { document.querySelector('[data-host-command-copy]').click() })
  assert.equal(await page.eval(() => clipboardRequests.length), 2)
  await run(() => { clipboardRequests[1].resolve() })
  assert.equal(await page.eval(() => !!document.querySelector('[data-host-command-copy-error]')), false)
  for (const mode of ['missing', 'throw']) {
    await fresh(); await run(mode => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: mode === 'missing' ? undefined : { writeText: () => { throw Error('clipboard unavailable') } } }); copyHostCommand() }, mode)
    assert.equal(await page.eval(() => hostInfoHarness.toast.toasts.value.at(-1).message), await page.eval(() => hostInfoHarness.t('common.copyFailed')), mode + ' gives an honest retryable error')
  }
  let obsolete = 0
  for (const mode of ['host', 'host-aba', 'account', 'sid', 'role', 'logout', 'session-aba', 'command', 'command-aba', 'expiry', 'cache', 'unmount']) for (const fail of [false, true]) {
    await fresh(); await run(() => copyHostCommand())
    await run(mode => { const h = hostInfoHarness, v = h.view()
      if (mode === 'host') h.host.value = { ...h.host.value, id: 12 }
      if (mode === 'host-aba') { h.host.value = { ...h.host.value, id: 12 }; h.host.value = { ...h.host.value, id: 11 } }
      if (mode === 'account') h.session(2)
      if (mode === 'sid') h.session(1, 'other')
      if (mode === 'role') h.session(1, 'host-info-session', 'user')
      if (mode === 'logout') h.auth.clearLocalAuth()
      if (mode === 'session-aba') { h.session(2); h.session(1) }
      if (mode === 'command') v.agentInstallCommand = 'DISPLAY-ONLY other command'
      if (mode === 'command-aba') { v.agentInstallCommand = 'DISPLAY-ONLY other command'; v.agentInstallCommand = 'DISPLAY-ONLY fixture command' }
      if (mode === 'expiry') v.agentInstallTokenExpiresAt = new Date(Date.now() + 120000).toISOString()
      if (mode === 'cache') h.active.value = false
      if (mode === 'unmount') h.mounted.value = false
    }, mode)
    await run(fail => { fail ? clipboardRequests[0].reject(Error('old clipboard failed')) : clipboardRequests[0].resolve() }, fail)
    assert.equal(await page.eval(() => hostInfoHarness.toast.toasts.value.length), 0, mode + ' discards obsolete copy feedback')
    assert.equal(await page.eval(() => !!document.querySelector('[data-host-command-copy-error]')), false)
    obsolete++
  }
  await fresh(); await run(() => { copyHostCommand(); hostInfoHarness.auth.token = 'fixture.' + btoa(JSON.stringify({ sid: 'host-info-session', revision: 2 })) + '.fixture'; clipboardRequests[0].resolve() })
  assert.equal(await page.eval(() => hostInfoHarness.toast.toasts.value.at(-1).message), await page.eval(() => hostInfoHarness.t('admin.hosts.agentInstallCommandCopied')))
  await fresh(); await run(() => { hostInfoHarness.view().agentInstallCommand = ''; copyHostCommand() })
  assert.equal(await page.eval(() => clipboardRequests.length), 0)
  assert.equal(await page.eval(() => hostInfoHarness.toast.toasts.value.length), 0)
  for (const locale of ['zh-CN', 'zh-TW', 'en']) for (const width of [1440, 768, 390]) {
    await fresh(); await page.setViewport({ width, height: 900, mobile: width === 390 })
    await run(locale => { hostInfoHarness.setLocale(locale); document.querySelector('[data-host-command-copy]').click(); clipboardRequests[0].reject(Error('fixture denial')) }, locale)
    assert.equal(await page.eval(() => document.querySelector('[data-host-command-copy-error]').textContent), await page.eval(() => hostInfoHarness.t('common.copyFailed')))
    assert.ok(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), 'copy error stays within viewport')
    if (width === 390) assert.ok(await page.eval(() => document.querySelector('[data-host-command-copy]').getBoundingClientRect().height >= 44), 'copy touch target remains usable')
  }
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log(`PASS actual Vue clipboard delayed success, duplicate lock, denial/unsupported/synchronous failure, DOM retry, ${obsolete} obsolete context/command receipts and same sid; display-only text, zero system clipboard writes`)
  if (process.argv.includes('--serve')) { console.log('Host info copy fixture ready at http://127.0.0.1:19741/?inspect&copy'); await new Promise(() => {}) }
} finally { if (browser) await browser.close(); await server.close() }
