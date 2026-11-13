import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Browser, sleep } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'

const root = fileURLToPath(new URL('..', import.meta.url)).replaceAll('\\', '/').replace(/\/$/, '')
const require = createRequire(new URL('../client/package.json', import.meta.url))
const { createServer, build } = await import(pathToFileURL(require.resolve('vite')).href)
const requests = []
const backend = createHttpServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json')
  if (req.url === '/api/auth/me') {
    res.end(JSON.stringify({ user: { id: 1, username: 'admin-1', role: 'admin' } })); return
  }
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const body = Buffer.concat(chunks).toString()
  requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization,
    body: body ? JSON.parse(body) : null, done: false, reply(data, status = 200) {
      this.done = true; res.statusCode = status; res.end(JSON.stringify(data))
    } })
})
await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve))
const oldEntry = process.env.VITE_APP_ENTRY
process.env.VITE_APP_ENTRY = 'admin'
const fixtureRoot = root + '/scripts/fixtures/admin-refunds'
const options = {
  configFile: root + '/client/vite.config.ts', root: fixtureRoot, publicDir: false,
  resolve: { alias: [
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name,
      replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) })),
    { find: 'axios', replacement: fileURLToPath(new URL('./dist/esm/axios.js', pathToFileURL(require.resolve('axios/package.json')))) }
  ], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')({ ...require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js'), content: [root + '/client/src/**/*.vue'] }), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19823, strictPort: true, fs: { allow: [root] },
    proxy: { '/api': { target: `http://127.0.0.1:${backend.address().port}`, changeOrigin: true } } }
}
let server, browser
const sample = { id: 'refund/one', orderId: 'order-one', amountCents: 1100, reason: 'delivery failed', createdAt: new Date().toISOString(),
  order: { userId: 23 }, payment: { providerName: 'Fixture payment', method: 'alipay' }, receipt: { tradeNo: 'fixture-trade', amountCents: 1100, currency: 'CNY' } }
try {
  server = await createServer(options)
  const alias = server.config.resolve.alias.find(row => String(row.find) === String(/^@\/api$/))
  assert.equal(alias?.replacement.replaceAll('\\', '/'), root + '/client/src/api/admin.ts', 'the shipped admin Vite alias must be used')
  await server.listen(); browser = await Browser.launch()
  const page = await browser.newPage({ reducedMotion: true })
  const wait = async predicate => {
    const until = Date.now() + 12000
    while (!await predicate()) { assert.ok(Date.now() < until, 'refund browser condition timed out'); await sleep(25) }
  }
  const pending = async (method = 'GET') => {
    let value
    await wait(() => !!(value = requests.find(row => !row.done && row.method === method)))
    return value
  }
  const active = async value => { await page.eval(value => { window.refundHarness.state.active = value }, value); await sleep(40) }
  const enter = async () => { await active(false); await active(true); return pending() }
  const alert = () => page.eval(() => document.querySelector('[role="alert"]')?.textContent || '')
  const fill = value => page.eval(value => { const input = document.querySelector('input'); input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })) }, value)
  const click = () => page.eval(() => document.querySelector('button').click())
  await page.goto('http://127.0.0.1:19823', { settleMs: 500 })
  await wait(() => page.eval(() => !!window.refundHarness)).catch(async error => {
    console.error('Refund harness startup:', await page.eval(() => ({ text: document.body.innerText, resources: performance.getEntriesByType('resource').slice(-12).map(row => row.name) })), page.consoleErrors)
    throw error
  })
  assert.deepEqual(await page.eval(() => Object.keys(window.refundHarness.api.checkout).sort()), ['completeRefund', 'refunds'], 'admin API includes only its refund actions')
  let request = await pending()
  assert.equal(request.url, '/api/checkout-admin/refunds')
  assert.ok(request.authorization?.startsWith('Bearer fixture.'), 'actual admin session interceptor authenticates the HTTP request')
  request.reply({ refunds: [sample] })
  await wait(() => page.eval(() => document.querySelectorAll('article').length === 1))
  assert.ok(await page.eval(() => document.body.innerText.includes('11.00')))
  assert.equal(await alert(), '')
  for (const width of [1440, 390]) {
    await page.setViewport({ width, height: 900 })
    assert.equal(await page.eval(() => document.documentElement.scrollWidth > innerWidth), false)
  }
  await fill('   fixture-refund-receipt   '); await click(); await click()
  request = await pending('POST')
  assert.equal(request.url, '/api/checkout-admin/refunds/refund%2Fone/complete')
  assert.deepEqual(request.body, { receipt: 'fixture-refund-receipt' })
  assert.equal(requests.filter(row => row.method === 'POST').length, 1, 'double click sends one mutation')
  request.reply({ success: false })
  await wait(async () => !!await alert())
  assert.equal(await page.eval(() => document.querySelector('input').value), '   fixture-refund-receipt   ', 'invalid completion never clears the unsaved receipt')
  await click(); request = await pending('POST'); request.reply({ success: true })
  request = await pending(); request.reply({ refunds: [] })
  await wait(() => page.eval(() => !document.querySelector('.checkout-refunds')))
  request = await enter(); request.reply({ error: 'refund service temporarily unavailable' }, 503)
  await wait(async () => (await alert()).includes('temporarily unavailable'))
  request = await enter(); request.reply({})
  await wait(async () => !!await alert())
  assert.equal((await alert()).includes('undefined'), false, 'malformed data produces an explicit error, never an empty success or raw TypeError')
  const stale = await enter()
  await active(false); stale.reply({ refunds: [sample] }); await sleep(120)
  assert.equal(await page.eval(() => document.querySelectorAll('article').length), 0)
  await active(true); request = await pending()
  await page.eval(() => window.refundHarness.account(2))
  request.reply({ refunds: [sample] })
  await wait(() => requests.some(row => !row.done && row !== request))
  requests.find(row => !row.done && row !== request).reply({ refunds: [] })
  await sleep(150)
  assert.equal(await page.eval(() => document.querySelectorAll('article').length), 0, 'account change rejects the previous administrator reply')
  assert.equal(await alert(), '')
  console.log('PASS actual admin alias, authenticated refund HTTP, receipt completion, duplicate/error/empty data, desktop/mobile and stale account/tab replies')

  await server.close(); server = undefined
  const dist = root + '/logs/admin-refunds-dist'
  mkdirSync(dist, { recursive: true })
  await build({ ...options, mode: 'production', build: { outDir: dist, emptyOutDir: true, minify: false } })
  const staticServer = createHttpServer((req, res) => {
    if (req.url.startsWith('/api/')) { backend.emit('request', req, res); return }
    const path = req.url === '/' ? dist + '/index.html' : dist + req.url.split('?')[0]
    if (!existsSync(path)) { res.statusCode = 404; res.end(); return }
    res.setHeader('Content-Type', path.endsWith('.js') ? 'application/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html')
    res.end(readFileSync(path))
  })
  await new Promise(resolve => staticServer.listen(19823, '127.0.0.1', resolve))
  try {
    for (const row of requests) if (!row.done) row.reply({ refunds: [] })
    const firstProductionRequest = requests.length
    await page.goto('http://127.0.0.1:19823', { settleMs: 500 })
    await wait(() => requests.slice(firstProductionRequest).some(row => !row.done))
    await wait(async () => {
      for (const row of requests.slice(firstProductionRequest)) if (!row.done) row.reply({ refunds: [sample] })
      return page.eval(() => document.querySelectorAll('article').length === 1)
    }).catch(async error => {
      console.error('Production refund fixture:', await page.eval(() => ({ text: document.body.innerText, harness: !!window.refundHarness })), requests.map(row => ({ method: row.method, done: row.done })), page.consoleErrors)
      throw error
    })
    assert.equal(await alert(), '')
    console.log('PASS production admin bundle renders the refund list through actual admin.ts')
  } finally {
    for (const row of requests) if (!row.done) row.reply({ refunds: [] })
    staticServer.closeAllConnections()
    await new Promise(resolve => staticServer.close(resolve))
  }
} finally {
  if (browser) await browser.close()
  if (server) await server.close()
  for (const row of requests) if (!row.done) row.reply({ error: 'test closed' }, 503)
  await new Promise(resolve => backend.close(resolve))
  if (oldEntry === undefined) delete process.env.VITE_APP_ENTRY
  else process.env.VITE_APP_ENTRY = oldEntry
}
