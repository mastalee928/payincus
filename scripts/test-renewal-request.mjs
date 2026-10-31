import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { Browser, sleep } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'
const root = fileURLToPath(new URL('..', import.meta.url)).replaceAll('\\', '/')
const require = createRequire(new URL('../client/package.json', import.meta.url))
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href)
const server = await createServer({ configFile: false, root: root + '/scripts/fixtures/renewal-request', cacheDir: resolve(root, 'logs/renewal-request-cache'),
  server: { host: '127.0.0.1', port: 19814, strictPort: true, fs: { allow: [root] } } })
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  const fresh = async () => {
    await page.goto('http://127.0.0.1:19814', { settleMs: 100 })
    for (const deadline = Date.now() + 10000; !await page.eval(() => !!window.renewalHarness);) { assert.ok(Date.now() < deadline); await sleep(20) }
  }
  const run = async fn => { await page.eval(fn); await sleep(20) }
  await fresh(); await run(() => { sessionStorage.clear(); document.querySelector('#renew').click(); document.querySelector('#renew').click() })
  assert.equal(await page.eval(() => window.renewalHarness.requests.length), 1, 'double click joins one request')
  const key = await page.eval(() => window.renewalHarness.requests[0].options.headers['Idempotency-Key'])
  await run(() => window.renewalHarness.requests[0].reject(Error('lost response')))
  await fresh(); await run(() => document.querySelector('#renew').click())
  assert.equal(await page.eval(() => window.renewalHarness.requests[0].options.headers['Idempotency-Key']), key, 'reload preserves unknown-result key')
  await run(() => window.renewalHarness.requests[0].resolve({ amount: 10 }))
  await run(() => document.querySelector('#renew').click())
  assert.notEqual(await page.eval(() => window.renewalHarness.requests[1].options.headers['Idempotency-Key']), key, 'acknowledged success permits a new renewal')
  const second = await page.eval(() => window.renewalHarness.requests[1].options.headers['Idempotency-Key'])
  await run(() => { const h = window.renewalHarness; h.session(2); h.send() })
  assert.notEqual(await page.eval(() => window.renewalHarness.requests[2].options.headers['Idempotency-Key']), second, 'accounts have separate intents')
  await run(() => { const h = window.renewalHarness; h.months = 2; h.send() })
  assert.notEqual(await page.eval(() => window.renewalHarness.requests[3].options.headers['Idempotency-Key']), second)
  await run(() => { const h = window.renewalHarness; h.requests[1].resolve({ amount: 10 }); h.requests[2].resolve({ amount: 10 }); h.requests[3].resolve({ amount: 20 }) })
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log('PASS browser renewal intent: double click, lost response, page reload, acknowledged new intent, account and input isolation')
} finally { if (browser) await browser.close(); await server.close() }
