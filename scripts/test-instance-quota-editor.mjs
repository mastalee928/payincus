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
const output = resolve(root, 'logs/instance-quota-editor'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js')
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/instance-detail/*.js']
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/instance-detail', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/instance-detail/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19694, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19694', { settleMs: 1400 })
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await page.eval(() => !!window.detailHarness?.pending.length)) break
    if (attempt === 199) throw Error('quota editor fixture did not mount: ' + page.consoleErrors.join('\n'))
    await sleep(150)
  }
  const run = async (fn, arg) => { const value = await page.eval(fn, arg); await sleep(90); return value }
  const last = kind => page.eval(kind => window.detailHarness.pending.findLastIndex(item => item.kind === kind), kind)
  const accept = (index, data) => run(({ index, data }) => window.detailHarness.pending[index].resolve(data), { index, data })
  const data = (id = 1, port = 5, snapshot = 3) => ({ id, name: 'Fixture quota editor', status: 'stopped', cpu: 100, memory: 512, disk: 2048,
    host_id: 10, user_id: 1, network_mode: 'nat', image: 'debian/12', ipv4: '10.0.0.2', package_id: null,
    isHostOwner: true, host: { name: 'Fixture host', user_id: 2 }, port_limit: port, snapshot_limit: snapshot,
    port_mappings: [{ id: 1 }, { id: 2 }], quota_usage: { port: 1, snapshot: 2 },
    remaining_quota: { port: (port ?? 0) - 1, snapshot: (snapshot ?? 0) - 2 } })
  const finish = async () => {
    for (const kind of ['task', 'traffic']) { const index = await last(kind); if (index >= 0) await accept(index, kind === 'task' ? { task: null } : null) }
  }
  await accept(await last('instance'), { instance: data() }); await finish()
  assert.deepEqual(await page.eval(() => ({ ...window.detailHarness.view().instanceQuotaForm })), { portLimit: 5, snapshotLimit: 3 }, 'editor must load actual snake_case quota fields')
  assert.equal(await page.eval(() => window.detailHarness.view().portMappingsCount), 1, 'automatic remote port is not user quota usage')
  assert.deepEqual(await page.eval(() => ({ ...window.detailHarness.view().remainingQuota })), { port: 4, snapshot: 1 })
  await run(() => { window.detailHarness.view().activeTab = 'quota' })
  await accept(await last('instance'), { instance: data() }); await accept(await last('snapshots'), []); await finish()
  await run(() => {
    window.quotaChild = () => {
      let current = document.querySelector('input[type="number"]')?.__vueParentComponent
      while (current && !current.setupState?.localForm) current = current.parent
      return current?.setupState
    }
  })
  assert.deepEqual(await page.eval(() => [...document.querySelectorAll('input[type="number"]')].map(input => input.value)), ['5', '3'])
  await run(() => { void window.detailHarness.view().loadInstance() })
  await accept(await last('instance'), { instance: data(1, 7, 4) }); await finish()
  assert.deepEqual(await page.eval(() => [...document.querySelectorAll('input[type="number"]')].map(input => input.value)), ['7', '4'], 'clean editor follows refreshed data')
  await run(() => { const input = document.querySelector('input[type="number"]'); input.value = '9'; input.dispatchEvent(new Event('input', { bubbles: true })) })
  await run(() => { void window.detailHarness.view().loadInstance() })
  await accept(await last('instance'), { instance: data(1, 8, 4) }); await finish()
  assert.deepEqual(await page.eval(() => ({ ...window.detailHarness.view().instanceQuotaForm })), { portLimit: 9, snapshotLimit: 4 }, 'polling preserves edited draft')
  assert.deepEqual(await page.eval(() => [...document.querySelectorAll('input[type="number"]')].map(input => input.value)), ['9', '4'])
  await run(() => window.detailHarness.router.push('/instances/2'))
  const zero = { ...data(2, null, 0), quota_usage: { port: 0, snapshot: 0 }, remaining_quota: { port: 0, snapshot: 0 } }
  await accept(await last('instance'), { instance: zero }); await finish()
  assert.deepEqual(await page.eval(() => ({ ...window.detailHarness.view().instanceQuotaForm })), { portLimit: null, snapshotLimit: 0 }, 'new instance starts with its own null and zero quotas')
  await run(() => { window.detailHarness.view().activeTab = 'quota' })
  await accept(await last('instance'), { instance: zero }); await accept(await last('snapshots'), []); await finish()
  assert.deepEqual(await page.eval(() => [...document.querySelectorAll('input[type="number"]')].map(input => input.value)), ['', '0'])
  for (const [locale, width, dark, mobile] of [['zh-CN', 1440, false, false], ['en', 390, true, true]]) {
    await page.setViewport({ width, height: 1000, mobile })
    await run(({ locale, dark }) => { window.detailHarness.setLocale(locale); window.detailHarness.theme.setTheme(dark ? 'dark' : 'light') }, { locale, dark })
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: resolve(output, `${locale}-${width}.png`), format: 'png' })
  }
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log('PASS quota editor loads actual fields, accurate usage, refreshed props, draft preservation, route changes and both viewports')
} finally { if (browser) await browser.close(); await server.close() }
