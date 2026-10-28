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
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/vip-reward-editor/*.js']
const output = resolve(root, 'logs/vip-reward-editor-browser'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const server = await createServer({ configFile: false, root: root + '/scripts/fixtures/vip-reward-editor', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api(?:\/admin)?$/, replacement: root + '/scripts/fixtures/vip-reward-editor/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19657, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19657/', { settleMs: 1200 })
  const deadline = Date.now() + 15000
  while (!await page.eval(() => !!window.vipHarness?.pending.some(item => item.kind === 'rewards'))) {
    if (Date.now() >= deadline) throw Error('VIP editor did not load within 15 seconds')
    await sleep(100)
  }
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(60); return result }
  const accept = (kind, data) => run(({ kind, data }) => window.vipHarness.pending.findLast(item => item.kind === kind).resolve(data), { kind, data })
  const count = kind => page.eval(kind => window.vipHarness.pending.filter(item => item.kind === kind).length, kind)
  const click = key => run(key => {
    const button = [...document.querySelectorAll('button')].find(el => el.checkVisibility() && el.textContent.trim() === window.vipHarness.t(key))
    if (!button) throw Error('Missing button ' + key)
    button.click()
  }, key)
  const amount = value => run(value => { const el = document.querySelector('article input[step="0.01"]'); el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })) }, value)
  const reward = { id: 1, level: 1, type: 'balance', title: 'Fixture reward', description: null, claimLimit: 1, sortOrder: 0, enabled: false, config: { amount: 12 } }
  const load = async () => { await accept('rules', { rules: [{ level: 1, enabled: true }], userMetric: 'totalRecharge' }); await accept('packages', { packages: [] }); await accept('rewards', { rewards: [reward] }) }
  await load()
  for (const value of ['0.0001', '0.004', '0', '-1', '100000000']) {
    await amount(value); await click('admin.vipBenefits.save'); assert.equal(await count('update'), 0, `invalid normalized amount ${value}`)
  }
  for (const [value, expected] of [['0.005', 0.01], ['0.01', 0.01], ['12.345', 12.35], ['99999999.99', 99999999.99]]) {
    const before = await count('update'); await amount(value); await click('admin.vipBenefits.save')
    assert.equal(await count('update'), before + 1)
    assert.equal(await page.eval(() => window.vipHarness.pending.findLast(item => item.kind === 'update').params.data.config.amount), expected)
    await accept('update', { reward: { ...reward, config: { amount: expected } } }); await load()
  }
  for (const locale of ['zh-CN', 'zh-TW', 'en-US']) for (const width of [1440, 390]) {
    await run(({ locale, width }) => { window.vipHarness.setLocale(locale); window.vipHarness.theme.setTheme(width === 390 ? 'dark' : 'light') }, { locale, width })
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width === 390 })
    await page.screenshot({ path: resolve(output, `${locale}-${width}.png`) })
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
  }
  console.log('PASS actual VIP admin editor: rejects amounts rounding to zero and above maximum, accepted rounding and exact normalized payloads; 3 locales desktop/mobile. Controlled API, no reward claims.')
} finally { if (browser) await browser.close(); await server.close() }
