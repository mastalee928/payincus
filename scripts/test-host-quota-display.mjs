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
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/host-batch-config/*.js']
const output = resolve(root, 'logs/host-quota-display'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const server = await createServer({ configFile: false, root: root + '/scripts/fixtures/host-batch-config', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/host-batch-config/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19691, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19691', { settleMs: 1600 })
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await page.eval(() => !!window.hostBatchConfig?.pending.some(item => item.kind === 'list'))) break
    if (attempt === 99) throw new Error('host single action fixture did not mount')
    await sleep(150)
  }
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(90); return result }
  const last = kind => page.eval(kind => window.hostBatchConfig.pending.findLastIndex(item => item.kind === kind), kind)
  const accept = (index, data) => run(({ index, data }) => window.hostBatchConfig.pending[index].resolve(data), { index, data })
  const row = (id, hostId = 1) => ({ id, name: `Fixture instance ${id}`, hostId, status: 'running', image: 'debian/12', cpu: 1, memory: 512, disk: 10240, username: 'Fixture user', userId: 1, packagePlanId: 1, billingPrice: 10 })
  const list = (ids, hostId = 1, status = 'running') => ({ instances: ids.map(id => ({ ...row(id, hostId), status })), total: ids.length, totalPages: 1 })
  await accept(await last('list'), { ...list([1]), instances: [{ ...row(1),
    quota_usage: { port: 0, snapshot: 0, site: 2 }, effective_quota_limit: { port: 0, snapshot: 0, site: 0 } }] })
  const quota = await page.eval(() => { const v = window.hostBatchConfig.view(); return v.getQuotaItems(v.instances[0]) })
  assert.equal(quota[0].value, '0 / 0', 'zero port quota must not display unlimited')
  assert.equal(quota[1].value, '0 / 0', 'zero snapshot quota must not display unlimited')
  assert.equal(quota[2].value, '2 / ∞', 'zero site quota keeps its established unlimited meaning')
  for (const [data, expected] of [
    [{ quota_usage: { port: 2, snapshot: 1, site: 3 }, effective_quota_limit: { port: 0, snapshot: 0, site: 0 } }, ['2 / 0', '1 / 0', '3 / ∞']],
    [{ quota_usage: { port: 2, snapshot: 1, site: 3 }, effective_quota_limit: { port: 5, snapshot: 4, site: 10 } }, ['2 / 5', '1 / 4', '3 / 10']],
    [{ quota_usage: { port: 0, snapshot: 0, site: 2 }, port_limit: null, snapshot_limit: null, site_limit: null }, ['0 / 0', '0 / 0', '-']],
    [{ remaining_quota: { port: 3, snapshot: 3, site: 2 }, port_limit: 5, snapshot_limit: 4, site_limit: 5 }, ['2 / 5', '1 / 4', '3 / 5']],
    [{ remaining_quota: { port: 0, snapshot: 0, site: 0 }, port_limit: 0, snapshot_limit: 0, site_limit: 0 }, ['-', '-', '-']],
    [{}, ['-', '-', '-']],
  ]) {
    const values = await page.eval(data => { const v = window.hostBatchConfig.view(); return v.getQuotaItems(data).map(item => item.value) }, data)
    assert.deepEqual(values, expected, 'effective overrides, finite usage, null defaults and unknown usage stay distinct')
  }
  await run(() => { window.hostBatchConfig.view().expandedInstanceId = 1 })
  for (const [locale, width, dark, mobile] of [['zh-CN', 1440, false, false], ['en', 390, true, true]]) {
    await page.setViewport({ width, height: 1000, mobile })
    await run(({ locale, dark }) => { window.hostBatchConfig.setLocale(locale); window.hostBatchConfig.theme.setTheme(dark ? 'dark' : 'light') }, { locale, dark })
    if (mobile) await run(() => {
      const label = [...document.querySelectorAll('div')].find(element => element.textContent === 'Port Limit')
      label?.parentElement.scrollIntoView({ block: 'center' })
    })
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
    assert.equal(await page.eval(() => document.body.innerText.includes('0 / 0')), true)
    await page.screenshot({ path: resolve(output, `${locale}-${width}.png`), format: 'png' })
  }
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log('PASS resource-specific zero quota display')
} finally { if (browser) await browser.close(); await server.close() }
