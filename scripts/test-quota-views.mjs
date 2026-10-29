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
const output = resolve(root, 'logs/quota-views'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
for (const mode of process.argv.includes('--detail') ? ['detail'] : ['ticket', 'detail']) {
  const fixture = mode === 'ticket' ? 'ticket-instance-card' : 'instance-detail'
  const port = mode === 'ticket' ? 19692 : 19693
  const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js')
  tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', `${root}/scripts/fixtures/${fixture}/*.js`]
  const server = await createServer({ configFile: false, cacheDir: resolve(output, mode, 'vite-cache'), root: `${root}/scripts/fixtures/${fixture}`, publicDir: root + '/client/public', plugins: [vue()],
    resolve: { alias: [{ find: /^@\/api$/, replacement: `${root}/scripts/fixtures/${fixture}/api.js` }, { find: '@', replacement: root + '/client/src' },
      ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
    css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
    server: { host: '127.0.0.1', port, strictPort: true, fs: { allow: [root] } },
  })
  let browser
  try {
    await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
    await page.goto(`http://127.0.0.1:${port}`, { settleMs: 1400 })
    for (let attempt = 0; attempt < 200; attempt++) {
      if (await page.eval(mode => !!(mode === 'ticket' ? window.cardHarness : window.detailHarness)?.pending.length, mode)) break
      if (attempt === 199) throw Error('quota view fixture did not mount: ' + page.consoleErrors.join('\n'))
      await sleep(150)
    }
    await page.eval(mode => { window.quotaHarness = mode === 'ticket' ? window.cardHarness : window.detailHarness }, mode)
    const run = async (fn, arg) => { const value = await page.eval(fn, arg); await sleep(90); return value }
    const data = { id: 1, name: 'Fixture quota instance', status: 'stopped', cpu: 100, memory: 512, disk: 2048,
      host_id: 10, user_id: 1, network_mode: 'nat', image: 'debian/12', ipv4: '10.0.0.2', package_id: null,
      isHostOwner: true, host: { name: 'Fixture host', user_id: 2 },
      quota_usage: { port: 0, snapshot: 0, backup: 0, site: 2 }, effective_quota_limit: { port: 0, snapshot: 0, backup: 0, site: 0 } }
    await run(({ mode, data }) => {
      const h = window.quotaHarness
      h.pending.find(item => item.kind === (mode === 'ticket' ? 'detail' : 'instance')).resolve({ instance: data })
      if (mode === 'ticket') {
        h.pending.find(item => item.kind === 'config').resolve({ swap: { available: false }, config: {} })
        h.pending.find(item => item.kind === 'task').resolve({ task: null })
      }
    }, { mode, data })
    if (mode === 'detail') {
      for (const kind of ['task', 'traffic']) {
        await run(kind => {
          const request = window.quotaHarness.pending.findLast(item => item.kind === kind)
          if (request) request.resolve(kind === 'task' ? { task: null } : null)
        }, kind)
      }
      assert.equal(await page.eval(() => window.quotaHarness.view().loading), false, 'detail preparation completed before checking visible UI')
    }
    if (mode === 'ticket') {
      assert.deepEqual(await page.eval(() => window.quotaHarness.view().quotaCards.map(item => item.value)), ['0 / 0', '0 / 0', '2 / ∞', '0 / 0'])
      for (const [overrides, expected] of [
        [{ effective_quota_limit: null, port_limit: null, snapshot_limit: null, backup_limit: null, site_limit: null }, ['0 / 0', '0 / 0', '-', '0 / 0']],
        [{ quota_usage: { port: 2, snapshot: 1, backup: 3, site: 2 }, effective_quota_limit: { port: 5, snapshot: 5, backup: 5, site: 10 } }, ['2 / 5', '1 / 5', '2 / 10', '3 / 5']],
        [{ quota_usage: null, remaining_quota: { port: 0, snapshot: 0, backup: 0, site: 0 } }, ['-', '-', '-', '-']],
        [{ quota_usage: null, effective_quota_limit: { port: 5, snapshot: 5, backup: 5, site: 10 }, remaining_quota: { port: 3, snapshot: 4, backup: 2, site: 8 } }, ['2 / 5', '1 / 5', '2 / 10', '3 / 5']],
      ]) {
        await run(({ data, overrides }) => { window.quotaHarness.view().instance = { ...data, ...overrides } }, { data, overrides })
        assert.deepEqual(await page.eval(() => window.quotaHarness.view().quotaCards.map(item => item.value)), expected)
      }
      await run(data => { window.quotaHarness.view().instance = data; window.quotaHarness.view().showDetails = true }, data)
    } else {
      assert.equal(await page.eval(() => window.quotaHarness.view().visibleTabs.some(tab => tab.key === 'sites')), true, 'unlimited sites must keep the sites tab')
      assert.equal(await page.eval(() => window.quotaHarness.view().visibleTabs.some(tab => tab.key === 'snapshots')), false)
      for (const limit of [0, 1, null]) {
        await run(({ data, limit }) => { window.quotaHarness.view().instance = { ...data, effective_quota_limit: { site: limit, snapshot: limit }, site_limit: limit, snapshot_limit: limit } }, { data, limit })
        assert.equal(await page.eval(() => window.quotaHarness.view().visibleTabs.some(tab => tab.key === 'sites')), true)
        assert.equal(await page.eval(() => window.quotaHarness.view().visibleTabs.some(tab => tab.key === 'snapshots')), limit === 1)
      }
      await run(data => { window.quotaHarness.view().instance = data }, data)
    }
    for (const [locale, width, dark, mobile] of [['zh-CN', 1440, false, false], ['en', 390, true, true]]) {
      await page.setViewport({ width, height: 1000, mobile })
      await run(({ locale, dark }) => { window.quotaHarness.setLocale(locale); window.quotaHarness.theme.setTheme(dark ? 'dark' : 'light') }, { locale, dark })
      assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
      assert.equal(await page.eval(() => document.body.innerText.includes('Fixture quota instance')), true)
      await page.screenshot({ path: resolve(output, `${mode}-${locale}-${width}.png`), format: 'png' })
    }
    if (mode === 'detail') {
      await run(data => {
        window.quotaHarness.view().instance = { ...data, dedicatedIpv4: true, dedicatedNetworkReady: true,
          nat_public_ip: '203.0.113.8', isHostOwner: false, isInstanceOwner: true, port_limit: 0, port_mappings: [] }
        window.quotaHarness.view().activeTab = 'network'
      }, data)
      assert.equal(await page.eval(() => window.quotaHarness.view().visibleTabs.some(tab => tab.key === 'quota')), false, 'dedicated customer does not see host quota settings')
      for (const [locale, width] of [['zh-CN', 1440], ['en', 390]]) {
        await page.setViewport({ width, height: 1000, mobile: width < 500 })
        await run(locale => window.quotaHarness.setLocale(locale), locale)
        assert.equal(await page.eval(() => document.body.innerText.includes('203.0.113.8')), true)
        assert.equal(await page.eval(() => /端口映射|端口转发|Port Mappings|Add Port/i.test(document.body.innerText)), false, 'dedicated customer network hides manual forwarding')
        assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
        await page.screenshot({ path: resolve(output, `dedicated-${locale}-${width}.png`), format: 'png' })
      }
      console.log('PASS dedicated customer network retains public IP and hides manual port forwarding and quota settings')
    }
    assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
    console.log(`PASS ${mode} resource-specific zero/null/finite quota, unknown usage and both viewports`)
  } finally { if (browser) await browser.close(); await server.close() }
}
