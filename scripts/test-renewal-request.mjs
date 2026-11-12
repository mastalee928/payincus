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
  await run(() => { window.renewalHarness.expectedAmount = 20; window.renewalHarness.send() })
  assert.equal(await page.eval(() => window.renewalHarness.requests.length), 1, 'a changed quote joins the in-flight renewal')
  await run(() => window.renewalHarness.requests[0].reject(Error('lost response')))
  await fresh(); await run(() => { window.renewalHarness.expectedAmount = 20; document.querySelector('#renew').click() })
  assert.equal(await page.eval(() => window.renewalHarness.requests[0].options.headers['Idempotency-Key']), key, 'reload and changed quote preserve the unknown-result key; a price change cannot charge a second renewal')
  await run(() => window.renewalHarness.requests[0].resolve({ amount: 10, months: 1, newExpiresAt: '2030-03-02T04:00:00.000Z' }))
  await run(() => document.querySelector('#renew').click())
  assert.notEqual(await page.eval(() => window.renewalHarness.requests[1].options.headers['Idempotency-Key']), key, 'acknowledged success permits a new renewal')
  const second = await page.eval(() => window.renewalHarness.requests[1].options.headers['Idempotency-Key'])
  await run(() => { const h = window.renewalHarness; h.session(2); h.send() })
  assert.notEqual(await page.eval(() => window.renewalHarness.requests[2].options.headers['Idempotency-Key']), second, 'accounts have separate intents')
  await run(() => { const h = window.renewalHarness; h.months = 2; h.send() })
  assert.notEqual(await page.eval(() => window.renewalHarness.requests[3].options.headers['Idempotency-Key']), second)
  await run(() => { const h = window.renewalHarness; const receipt = { newExpiresAt: '2030-03-02T04:00:00.000Z' };
    h.requests[1].resolve({ ...receipt, months: 1, amount: 10 }); h.requests[2].resolve({ ...receipt, months: 1, amount: 10 }); h.requests[3].resolve({ ...receipt, months: 2, amount: 20 }) })
  await run(() => { const h = window.renewalHarness; h.months = 1; h.send() })
  const staleKey = await page.eval(() => window.renewalHarness.requests.at(-1).options.headers['Idempotency-Key'])
  await run(() => window.renewalHarness.requests.at(-1).reject({ code: 'RENEWAL_PRICE_CHANGED' }))
  await run(() => { const h = window.renewalHarness; h.expectedAmount = 12.34; h.send() })
  assert.notEqual(await page.eval(() => window.renewalHarness.requests.at(-1).options.headers['Idempotency-Key']), staleKey, 'confirmed pre-debit price rejection allows a new quoted intent')
  await run(() => window.renewalHarness.requests.at(-1).resolve({ amount: 12.34, months: 1, newExpiresAt: '2030-03-02T04:00:00.000Z' }))
  await run(() => window.renewalHarness.batch())
  const batchKey = await page.eval(() => window.renewalHarness.requests.at(-1).options.headers['Idempotency-Key'])
  await run(() => window.renewalHarness.requests.at(-1).resolve({ successCount: 2, skippedCount: 0, failedCount: 0,
    results: [1, 1].map(id => ({ id, name: 'same-target', success: true, amount: 10, newExpiresAt: '2030-03-02T04:00:00.000Z' })) }))
  await run(() => window.renewalHarness.batch())
  assert.equal(await page.eval(() => window.renewalHarness.requests.at(-1).options.headers['Idempotency-Key']), batchKey, 'malformed duplicate-target batch response preserves original debit intent')
  await run(() => window.renewalHarness.requests.at(-1).resolve({ successCount: 1, skippedCount: 0, failedCount: 1,
    results: [{ id: 1, name: 'first', success: true, amount: 10, newExpiresAt: '2030-03-02T04:00:00.000Z' },
      { id: 2, name: 'second', success: false, reason: 'insufficient balance' }] }))
  await run(() => window.renewalHarness.send())
  const malformedKey = await page.eval(() => window.renewalHarness.requests.at(-1).options.headers['Idempotency-Key'])
  await run(() => window.renewalHarness.requests.at(-1).resolve({ amount: 12.34 }))
  await run(() => window.renewalHarness.send())
  assert.equal(await page.eval(() => window.renewalHarness.requests.at(-1).options.headers['Idempotency-Key']), malformedKey, 'malformed success cannot clear the unknown-result key')
  await run(() => window.renewalHarness.requests.at(-1).resolve({ amount: 12.34, months: 1, newExpiresAt: '2030-03-02T04:00:00.000Z' }))
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log('PASS browser renewal intent: double click, lost/malformed response, page reload, changed quote, acknowledged new intent, account and input isolation')
} finally { if (browser) await browser.close(); await server.close() }
