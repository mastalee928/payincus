import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { Browser, sleep } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'
import { probe, layout, app as appProbe } from '../.agents/skills/design-taste-frontend/scripts/lib/probe.mjs'
import { judge, judgeLayout, judgeApp, APP_SKIP } from '../.agents/skills/design-taste-frontend/scripts/lib/rules.mjs'
const root = fileURLToPath(new URL('..', import.meta.url)).replaceAll('\\', '/')
const require = createRequire(new URL('../client/package.json', import.meta.url))
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href)
const { default: vue } = await import(pathToFileURL(require.resolve('@vitejs/plugin-vue')).href)
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js')
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/late-payments/*.js']
const output = resolve(root, 'logs/late-payment-browser'); mkdirSync(output, { recursive: true })
const server = await createServer({ configFile: false, root: root + '/scripts/fixtures/late-payments', plugins: [vue()],
  resolve: { alias: [ { find: /^@\/api\/admin$/, replacement: root + '/scripts/fixtures/late-payments/api.js' },
    { find: /^@\/api$/, replacement: root + '/scripts/fixtures/late-payments/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) })) ], dedupe: ['vue', 'pinia'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19816, strictPort: true, fs: { allow: [root] } } })
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19816', { settleMs: 1000 })
  const run = async (fn, arg) => { const value = await page.eval(fn, arg); await sleep(30); return value }
  const wait = async fn => { const until = Date.now() + 10000; while (!await page.eval(fn)) { assert.ok(Date.now() < until, await page.eval(() => document.body.innerText)); await sleep(30) } }
  await wait(() => window.lateHarness?.requests.length > 0)
  const rows = [{ id: 1, username: '首尔客户', orderNo: 'RC-20261031-183521', tradeNo: 'PAY-' + '1234567890'.repeat(8), provider: '易支付',
    receivedAmount: '10.00', currency: 'CNY', creditAmount: 9, reason: 'user', status: 'pending', canCredit: true },
    { id: 2, username: '悉尼客户', orderNo: 'RC-20261031-182000', tradeNo: 'REFUND-882601', provider: 'Heleket', receivedAmount: '30.00', currency: 'CNY', creditAmount: 30,
      reason: 'refunded', status: 'pending', canCredit: false }]
  await run(rows => window.lateHarness.requests.at(-1).resolve({ records: rows, total: 2 }), rows)
  await wait(() => document.querySelector('[data-payment-id="1"]'))
  await run(() => document.querySelector('[data-payment-id="1"] button').click())
  assert.equal(await page.eval(() => document.querySelector('form button').disabled), true)
  await run(() => { const el = document.querySelector('textarea'); el.value = '已核对到账及退款记录'; el.dispatchEvent(new Event('input', { bubbles: true })) })
  for (const width of [1440, 768, 390]) for (const dark of [false, true]) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false })
    await run(dark => window.lateHarness.theme.setTheme(dark ? 'dark' : 'light'), dark)
    await sleep(400)
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true, `overflow at ${width}`)
    const colors = await page.eval(() => ({ primary: getComputedStyle(document.querySelector('.btn-primary')).backgroundColor, ink: getComputedStyle(document.querySelector('h2')).color }))
    assert.equal(colors.primary, dark ? 'rgb(245, 245, 245)' : 'rgb(23, 23, 23)')
    assert.equal(colors.ink, dark ? 'rgb(245, 245, 245)' : 'rgb(23, 23, 23)')
    const metrics = await page.eval(probe), lay = await page.eval(layout), screen = await page.eval(appProbe)
    const findings = [...judge(metrics, { width, allow: [] }), ...judgeLayout(lay, { width, allow: [] })]
      .filter(f => !APP_SKIP.has(f.id) && f.id !== 'no-title' && f.id !== 'small-title')
      .concat(judgeApp(screen, metrics, { width, allow: [] }))
    writeFileSync(resolve(output, `${width}-${dark ? 'dark' : 'light'}-inspection.json`), JSON.stringify(findings, null, 2))
    assert.ok(!findings.some(f => f.level === 'FAIL'), JSON.stringify(findings.filter(f => f.level === 'FAIL')))
    const shot = await page.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(resolve(output, `${width}-${dark ? 'dark' : 'light'}.png`), Buffer.from(shot.data, 'base64'))
  }
  await run(() => { const button = document.querySelector('form button'); button.click(); button.click() })
  assert.equal(await page.eval(() => window.lateHarness.requests.filter(r => r.kind === 'resolve').length), 1)
  assert.equal(await page.eval(() => window.lateHarness.requests.at(-1).data.action), 'credit')
  await run(() => window.lateHarness.session('session-b'))
  await run(() => window.lateHarness.requests.find(r => r.kind === 'resolve').reject(Error('old session failure')))
  assert.ok(!await page.eval(() => document.body.innerText.includes('处理未确认')))
  await run(rows => window.lateHarness.requests.at(-1).resolve({ records: rows, total: 2 }), rows)
  await run(() => document.querySelector('[data-payment-id="2"] button').click())
  assert.equal(await page.eval(() => document.querySelector('form').innerText.includes('确认补入')), false)
  await run(() => { const el = document.querySelector('textarea'); el.value = '已核对平台退款完成'; el.dispatchEvent(new Event('input', { bubbles: true })) })
  await run(() => document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  assert.equal(await page.eval(() => window.lateHarness.requests.at(-1).data.action), 'resolve')
  await run(() => window.lateHarness.requests.at(-1).resolve({ message: 'saved' }))
  await run(() => window.lateHarness.requests.at(-1).resolve({ records: [], total: 0 }))
  assert.ok(await page.eval(() => document.body.innerText.includes('当前没有待核对')))
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log('PASS actual late payment UI: explicit credit/record-only, required notes, double click, stale session, empty state and three widths in light/dark')
} finally { if (browser) await browser.close(); await server.close() }
