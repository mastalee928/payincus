import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const source = readFileSync(new URL('../client/public/sw.js', import.meta.url), 'utf8')
const origin = 'https://static-fixture.invalid'
const cacheName = 'incudal-cache-vreview'
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const tick = () => new Promise(resolve => setImmediate(resolve))
function fixture() {
  const handlers = {}, stores = new Map(), network = [], warnings = [], deleted = []
  let putGate, openError = false, putError = false, trimError = false
  const key = request => typeof request === 'string' ? request : request.url
  const caches = {
    async keys() { return [...stores.keys()] },
    async delete(name) { deleted.push(name); return stores.delete(name) },
    async open(name) {
      if (openError) throw new Error('open failure')
      if (!stores.has(name)) stores.set(name, new Map())
      const entries = stores.get(name)
      return {
        async put(request, response) {
          if (putGate) await putGate.promise
          if (putError) throw new Error('quota failure')
          entries.set(key(request), response)
        },
        async keys() { return [...entries.keys()] },
        async delete(request) { if (trimError) throw new Error('trim failure'); return entries.delete(key(request)) },
        async match(request) { return entries.get(key(request))?.clone() },
      }
    },
  }
  runInNewContext(source, {
    URL, Response, caches, console: { log() {}, warn: message => warnings.push(message) },
    self: { location: new URL(`${origin}/sw.js?v=review`), addEventListener: (name, handler) => { handlers[name] = handler },
      skipWaiting: async () => {}, clients: { claim: async () => {} } },
    fetch(request) { const next = deferred(); network.push({ ...next, request }); return next.promise },
  })
  function dispatch(type, props = {}) {
    let dispatching = true
    const waits = [], event = { ...props, waits, response: undefined,
      waitUntil(promise) { assert.ok(dispatching, 'background work must be registered synchronously'); waits.push(promise) },
      respondWith(promise) { assert.ok(dispatching); event.response = promise },
    }
    handlers[type](event)
    dispatching = false
    return event
  }
  return { stores, network, warnings, deleted, dispatch,
    request(path, props = {}) { return dispatch('fetch', { request: { url: `${origin}${path}`, method: 'GET', mode: 'cors', ...props } }) },
    set putGate(value) { putGate = value }, set openError(value) { openError = value },
    set putError(value) { putError = value }, set trimError(value) { trimError = value },
  }
}

// Download completion must not wait for a slow Cache API write; event lifetime must.
const f = fixture(), gate = deferred()
f.putGate = gate
const event = f.request('/assets/one.js')
assert.equal(event.waits.length, 1)
f.network[0].resolve(new Response('network body'))
assert.equal(await (await event.response).text(), 'network body')
let done = false
const background = Promise.all(event.waits).then(() => { done = true })
await tick()
assert.equal(done, false, 'waitUntil must include unfinished cache.put')
gate.resolve(); await background
assert.equal(await f.stores.get(cacheName).get(`${origin}/assets/one.js`).text(), 'network body')

// Hundreds of concurrent writes must be trimmed AFTER each put, in one mutation queue.
const bulk = fixture(), writes = Array.from({ length: 280 }, (_, i) => bulk.request(`/assets/${i}.js`))
bulk.network.forEach((request, i) => request.resolve(new Response(String(i))))
await Promise.all(writes.map(item => item.response))
await Promise.all(writes.flatMap(item => item.waits))
assert.equal(bulk.stores.get(cacheName).size, 256)
assert.equal(bulk.stores.get(cacheName).has(`${origin}/assets/0.js`), false)
assert.equal(bulk.stores.get(cacheName).has(`${origin}/assets/279.js`), true)

// Storage failures are handled without losing the successful HTTP response or poisoning the queue.
for (const mode of ['openError', 'putError', 'trimError']) {
  bulk[mode] = true
  const failed = bulk.request(`/assets/failure-${mode}.js`)
  bulk.network.at(-1).resolve(new Response('available'))
  assert.equal(await (await failed.response).text(), 'available')
  await Promise.all(failed.waits)
  bulk[mode] = false
  assert.ok(bulk.warnings.length)
  const retry = bulk.request(`/assets/retry-${mode}.js`)
  bulk.network.at(-1).resolve(new Response('retry'))
  await Promise.all(retry.waits)
  assert.equal(bulk.stores.get(cacheName).size, 256)
  assert.equal(bulk.stores.get(cacheName).has(`${origin}/assets/retry-${mode}.js`), true)
}

// Clear must drain an in-progress write and ignore downloads that began before clear.
const clearing = fixture(), delayedPut = deferred(), messages = []
clearing.putGate = delayedPut
const inProgress = clearing.request('/assets/before.js')
clearing.network[0].resolve(new Response('old'))
await inProgress.response; await tick()
const late = clearing.request('/assets/late.js')
const clear = clearing.dispatch('message', { data: { type: 'CLEAR_CACHE' }, source: { postMessage: value => messages.push(value.type) } })
await tick(); assert.equal(messages.length, 0)
delayedPut.resolve(); await Promise.all([...inProgress.waits, ...clear.waits])
assert.deepEqual(messages, ['CACHE_CLEARED'])
assert.equal(clearing.stores.has(cacheName), false)
clearing.network[1].resolve(new Response('late'))
await Promise.all(late.waits)
assert.equal(clearing.stores.has(cacheName), false, 'late download cannot resurrect cleared data')
const fresh = clearing.request('/assets/fresh.js')
clearing.network[2].resolve(new Response('fresh'))
await Promise.all(fresh.waits)
assert.equal(clearing.stores.get(cacheName).size, 1)

const isolation = fixture()
isolation.stores.set('other-application', new Map())
isolation.stores.set('incudal-cache-vold', new Map())
isolation.stores.set(cacheName, new Map([[`${origin}/assets/offline.js`, new Response('current')]]))
await Promise.all(isolation.dispatch('activate').waits)
assert.deepEqual(isolation.deleted, ['incudal-cache-vold'])
const offline = isolation.request('/assets/offline.js')
isolation.network.at(-1).reject(new Error('offline'))
assert.equal(await (await offline.response).text(), 'current')
await Promise.all(offline.waits)
const miss = isolation.request('/assets/miss.js')
isolation.network.at(-1).reject(new Error('offline'))
assert.equal((await miss.response).type, 'error')
await Promise.all(miss.waits)
isolation.openError = true
const unavailable = isolation.request('/assets/unavailable.js')
isolation.network.at(-1).reject(new Error('offline'))
assert.equal((await unavailable.response).type, 'error')
await Promise.all(unavailable.waits)

for (const status of [204, 404, 500]) {
  const nonSuccess = isolation.request(`/assets/${status}.js`)
  isolation.network.at(-1).resolve(new Response(status === 204 ? null : 'error', { status }))
  assert.equal((await nonSuccess.response).status, status)
  await Promise.all(nonSuccess.waits)
}
for (const [path, props] of [
  ['/api/private.js', {}], ['/auth/callback.js', {}], ['/oauth/token.js', {}], ['/sw.js', {}],
  ['/page', { mode: 'navigate' }], ['/assets/mutate.js', { method: 'POST' }],
  ['/external.js', { url: 'https://other.invalid/external.js' }],
]) {
  const ignored = isolation.request(path, props)
  assert.equal(ignored.response, undefined)
  assert.equal(ignored.waits.length, 0)
}
console.log('PASS SW lifecycle: delayed writes, 280 concurrent requests/256 bound, storage failure recovery, clear races, cache isolation, offline fallback and request exclusions. Actual worker source in a controlled Cache API fixture.')
