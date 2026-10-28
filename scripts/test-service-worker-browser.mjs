import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Browser, sleep } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'

const worker = readFileSync(new URL('../client/public/sw.js', import.meta.url))
const output = fileURLToPath(new URL('../logs/service-worker-browser/', import.meta.url))
mkdirSync(output, { recursive: true })
process.env.TASTE_SKILL_TMP = output
const fixtures = []
let browser
try {
  browser = await Browser.launch()
  // User/admin deploy on separate origins. Exercise an independent real registration for each.
  for (const entry of ['user', 'admin']) {
    let offline = false
    const server = createServer((req, res) => {
      const url = new URL(req.url, 'http://fixture.invalid')
      res.setHeader('Cache-Control', 'no-store')
      if (url.pathname === '/sw.js') {
        res.setHeader('Content-Type', 'text/javascript')
        res.end(worker)
      } else if (url.pathname.endsWith('.js')) {
        if (offline) { req.socket.destroy(); return }
        res.setHeader('Content-Type', 'text/javascript')
        res.end(`/* ${entry}: ${url.pathname} */`)
      } else {
        res.setHeader('Content-Type', 'text/html')
        res.end('<!doctype html><title>Isolated static cache verification</title><p>Local Service Worker test</p>')
      }
    })
    fixtures.push(server)
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const base = `http://127.0.0.1:${server.address().port}`
    const page = await browser.newPage()
    await page.goto(base, { settleMs: 100 })
    const cacheName = `incudal-cache-vreview-${entry}`
    await page.eval(async entry => {
      await caches.open('unrelated-cache')
      await caches.open('incudal-cache-vprevious')
      await navigator.serviceWorker.register(`/sw.js?v=review-${entry}`, { updateViaCache: 'none' })
      await navigator.serviceWorker.ready
    }, entry)
    async function check(fn, arg, message) {
      for (let attempt = 0; attempt < 500; attempt++) {
        if (await page.eval(fn, arg)) return
        await sleep(50)
      }
      const stored = await page.eval(async name => (await (await caches.open(name)).keys()).map(request => request.url), cacheName)
      assert.fail(`${entry}: ${message}; stored=${stored.length}; last=${stored.at(-1)}`)
    }
    await check(() => !!navigator.serviceWorker.controller, undefined, 'worker claims the page')
    await check(async () => !(await caches.keys()).includes('incudal-cache-vprevious'), undefined, 'old app cache deleted')
    assert.equal(await page.eval(async () => (await caches.keys()).includes('unrelated-cache')), true)

    assert.equal(await page.eval(async () => (await fetch('/assets/one.js')).text()), `/* ${entry}: /assets/one.js */`)
    await check(async name => !!(await (await caches.open(name)).match('/assets/one.js')), cacheName, 'response persisted')
    offline = true
    assert.equal(await page.eval(async () => (await fetch('/assets/one.js')).text()), `/* ${entry}: /assets/one.js */`)
    assert.equal(await page.eval(async () => { try { await fetch('/assets/missing.js'); return false } catch { return true } }), true)
    offline = false

    const bodies = await page.eval(async () => Promise.all(Array.from({ length: 280 }, async (_, i) => (await fetch(`/assets/concurrent-${i}.js`)).text())))
    assert.equal(bodies.length, 280)
    assert.ok(bodies.every(text => text.startsWith(`/* ${entry}: /assets/concurrent-`)))
    // A message queues behind all writes and acknowledges only after their background tasks drain.
    await page.eval(async () => new Promise(resolve => {
      const onMessage = event => {
        if (event.data?.type !== 'CACHE_CLEARED') return
        navigator.serviceWorker.removeEventListener('message', onMessage)
        resolve()
      }
      navigator.serviceWorker.addEventListener('message', onMessage)
      navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_CACHE' })
    }))
    assert.equal(await page.eval(async name => (await caches.keys()).includes(name), cacheName), false)
    offline = true
    assert.equal(await page.eval(async () => { try { await fetch('/assets/one.js'); return false } catch { return true } }), true)
    offline = false

    await page.eval(async () => Promise.all(Array.from({ length: 280 }, async (_, i) => (await fetch(`/assets/bound-${i}.js`)).text())))
    // A final request enters the write queue after all preceding downloads completed.
    await page.eval(async () => (await fetch('/assets/drained.js')).text())
    await check(async name => !!(await (await caches.open(name)).match('/assets/drained.js')), cacheName, 'last queued write persisted')
    await check(async name => (await (await caches.open(name)).keys()).length === 256, cacheName, 'bounded browser cache')
    assert.equal(await page.eval(async name => (await (await caches.open(name)).keys()).length, cacheName), 256)
    assert.equal(await page.eval(async () => (await caches.keys()).includes('unrelated-cache')), true)
    console.log(`PASS Chrome ${entry}: real worker registration, HTTP response, persisted body, network-disconnect fallback/miss, clear acknowledgement and 280 parallel resources capped at 256; unrelated cache retained.`)
  }
} finally {
  if (browser) await browser.close()
  for (const server of fixtures) {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
}
