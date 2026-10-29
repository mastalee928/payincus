import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { Browser, sleep } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'
const root = fileURLToPath(new URL('..', import.meta.url)).replaceAll('\\', '/'), require = createRequire(new URL('../client/package.json', import.meta.url))
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href), { default: vue } = await import(pathToFileURL(require.resolve('@vitejs/plugin-vue')).href)
const output = resolve(root, 'logs/login-history-devices'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js'); tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/login-history/*.js']
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/login-history', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/login-history/api.js' }, { find: '@', replacement: root + '/client/src' }, ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } }, server: { host: '127.0.0.1', port: 19735, strictPort: true, fs: { allow: [root] } },
})
const agents = [
  ['Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/119.0.0.0 Mobile Safari/537.36', 'Android', 'Chrome'],
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1', 'iOS', 'Safari'],
  ['Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1', 'iOS', 'Safari'],
  ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/119.0.0.0 Safari/537.36 OPR/105.0.0.0', 'Windows', 'Opera'],
  ['Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15', 'macOS', 'Safari'],
  ['Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/119.0.0.0 Safari/537.36', 'Linux', 'Chrome'],
  ['Mozilla/5.0 (Windows NT 10.0) Chrome/119.0.0.0 Safari/537.36 Edg/119.0.0.0', 'Windows', 'Edge'],
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/119.0.0.0 Mobile Safari/604.1', 'iOS', 'Chrome'],
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 FxiOS/119.0 Mobile Safari/604.1', 'iOS', 'Firefox'],
  ['Mozilla/5.0 (Linux; Android 13) Chrome/119.0.0.0 Mobile Safari/537.36 EdgA/119.0.0.0', 'Android', 'Edge'],
  [null, '-', '-'],
]
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19735', { settleMs: 300 })
  const deadline = Date.now() + 15000
  while (!await page.eval(() => !!window.historyHarness?.view())) { if (Date.now() > deadline) throw Error('History fixture did not mount'); await sleep(70) }
  for (const [userAgent, device, browserName] of agents) {
    const actual = await page.eval(userAgent => { const v = window.historyHarness.view(); return [v.formatDevice(userAgent), v.formatBrowser(userAgent)] }, userAgent)
    assert.deepEqual(actual, [device, browserName], 'recognize the most specific platform and browser before general engine tokens')
  }
  await page.eval(agents => { window.historyHarness.pending[0].resolve({ records: agents.slice(0, 3).map(([userAgent], index) => ({ id: index + 1, ip: '192.0.2.' + (index + 1), country: null, region: null, city: null, isp: null, timezone: null, userAgent, createdAt: '2026-10-29T04:05:06.000Z' })), total: 3, page: 1, pageSize: 3, totalPages: 1 }) }, agents)
  await sleep(70)
  for (const [locale, width] of [['zh-CN', 1440], ['zh-TW', 768], ['en', 390]]) {
    await page.setViewport({ width, height: 1000, mobile: width === 390 }); await page.eval(locale => { window.historyHarness.setLocale(locale); window.historyHarness.theme.setTheme(innerWidth === 390 ? 'dark' : 'light') }, locale); await sleep(60)
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
    assert.ok(await page.eval(() => document.querySelector('#app').textContent.includes('Android · Chrome')))
    assert.ok(await page.eval(() => document.querySelector('#app').textContent.includes('iOS · Safari')))
    await page.screenshot({ path: resolve(output, `${locale}-${width}.png`), format: 'png' })
  }
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log('PASS actual login-history Android/iPhone/iPad/Opera desktop and iOS browser recognition, 11 UA samples, three-width three-language DOM; read only')
} finally { if (browser) await browser.close(); await server.close() }
