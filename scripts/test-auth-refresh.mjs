import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { Browser, sleep } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'
const root = fileURLToPath(new URL('..', import.meta.url)).replaceAll('\\', '/')
const require = createRequire(new URL('../client/package.json', import.meta.url))
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href)
const output = resolve(root, 'logs/auth-refresh'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/auth-refresh',
  resolve: { alias: [{ find: '@', replacement: root + '/client/src' }, ...['vue', 'pinia', 'axios'].map(name => ({ find: name, replacement: name === 'axios' ? resolve(require.resolve('axios/package.json'), '../dist/esm/axios.js') : require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'axios'] },
  server: { host: '127.0.0.1', port: 19769, strictPort: true, fs: { allow: [root] } } })
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  const run = async (fn, arg) => { const value = await page.eval(fn, arg); await sleep(50); return value }
  const fresh = async () => {
    await page.goto('http://127.0.0.1:19769', { settleMs: 200 }); const deadline = Date.now() + 10000
    while (!await page.eval(() => !!window.refreshHarness)) { if (Date.now() > deadline) throw Error('refresh fixture unavailable: ' + page.consoleErrors.join('\n')); await sleep(30) }
  }
  await fresh(); await run(() => { const h = window.refreshHarness; h.session(1, 'refresh-session', 'user', 60); h.start('user'); h.start('admin') })
  assert.equal(await page.eval(() => window.refreshHarness.refreshes.length), 1, 'user/admin API requests must share a single refresh for the current session')
  await run(() => { const h = window.refreshHarness; h.refreshes[0].resolve({ token: h.token(1, 'refresh-session', 'user', 7 * 86400, 'refreshed') }) })
  assert.equal(await page.eval(() => window.refreshHarness.pending.length), 2)
  await run(() => { const h = window.refreshHarness; for (const req of h.pending) req.resolve({ message: 'queued', taskId: 1, status: 'pending' }) })
  assert.equal(await page.eval(() => window.refreshHarness.results.length), 2)
  console.log('PASS both API wrappers share current-session refresh')
  let stale = 0
  for (const client of ['user', 'admin']) for (const mode of ['account', 'sid', 'role', 'clear', 'aba', 'storage', 'memory']) for (const failure of [false, true]) {
    await fresh(); await run(client => { const h = window.refreshHarness; h.session(1, 'refresh-session', 'user', 60); h.start(client) }, client)
    await run(mode => { const h = window.refreshHarness; if (mode === 'account') h.session(2); if (mode === 'sid') h.session(1, 'other-session'); if (mode === 'role') h.session(1, 'refresh-session', 'admin'); if (mode === 'clear') h.auth.clearLocalAuth(); if (mode === 'aba') { h.session(2); h.session(1) }; if (mode === 'storage') localStorage.setItem('token', h.token(2)); if (mode === 'memory') h.auth.clearInMemoryAuth() }, mode)
    const before = await page.eval(() => JSON.stringify({ stored: localStorage.getItem('token'), user: window.refreshHarness.auth.user }))
    await run(failure => { const h = window.refreshHarness; h.refreshes[0].resolve(failure ? {} : { token: h.token(1, 'refresh-session', 'user', 7 * 86400, 'old-refresh') }, failure ? 401 : 200) }, failure)
    assert.equal(await page.eval(() => JSON.stringify({ stored: localStorage.getItem('token'), user: window.refreshHarness.auth.user })), before, `${client}/${mode}/${failure} refresh preserves current identity`)
    assert.equal(await page.eval(() => window.refreshHarness.pending.length), 0, 'obsolete prepared write never reaches transport')
    stale++
  }
  console.log(`PASS ${stale} obsolete proactive refresh success/401 receipts never replay a prepared write`)
  for (const client of ['user', 'admin']) for (const failure of [false, true]) {
    await fresh(); await run(client => window.refreshHarness.start(client), client)
    await run(() => window.refreshHarness.session(2))
    await run(failure => { const req = window.refreshHarness.pending[0]; failure ? req.reject(401) : req.resolve({ message: 'queued', taskId: 1, status: 'pending' }) }, failure)
    assert.equal(await page.eval(() => window.refreshHarness.refreshes.length), 0, 'obsolete HTTP 401 does not refresh a replacement account')
    assert.equal(await page.eval(() => window.refreshHarness.pending.length), 1, 'obsolete response never retries')
    assert.equal(await page.eval(() => window.refreshHarness.results.length), 0, 'obsolete success never reaches the caller')
    assert.equal(await page.eval(() => window.refreshHarness.auth.user.id), 2)
  }
  console.log('PASS both wrappers reject stale HTTP success and 401 before any refresh or retry')
  await fresh(); await run(() => { const h = window.refreshHarness; localStorage.setItem('token', h.token(2)); h.start('user'); h.start('admin') })
  assert.equal(await page.eval(() => window.refreshHarness.pending.length), 0, 'requests before a queued storage event cannot borrow a replacement account token')
  assert.equal(await page.eval(() => window.refreshHarness.errors.length), 2)
  await fresh(); await run(() => { const h = window.refreshHarness; h.start('user'); h.start('admin') })
  await run(() => { const h = window.refreshHarness; h.pending[0].reject(401); h.pending[1].reject(401) })
  assert.equal(await page.eval(() => window.refreshHarness.refreshes.length), 1, 'reactive refresh queue is shared')
  await run(() => { const h = window.refreshHarness; h.refreshes[0].resolve({ token: h.token(1, 'refresh-session', 'user', 7 * 86400, 'renewed') }) })
  assert.equal(await page.eval(() => window.refreshHarness.pending.length), 4, 'each rejected request retries once')
  await run(() => { const h = window.refreshHarness; h.pending[2].resolve({ message: 'queued', taskId: 2, status: 'pending' }); h.pending[3].resolve({ message: 'queued', taskId: 3, status: 'pending' }) })
  assert.equal(await page.eval(() => window.refreshHarness.results.length), 2)
  for (const client of ['user', 'admin']) {
    await fresh(); await run(client => { history.replaceState({}, '', client === 'admin' ? '/admin/login' : '/login'); window.refreshHarness.start(client) }, client)
    await run(() => window.refreshHarness.pending[0].reject(401))
    await run(() => { const h = window.refreshHarness; h.refreshes[0].resolve({ token: h.token(1, 'refresh-session', 'user', 7 * 86400, 'renewed') }) })
    await run(() => window.refreshHarness.pending[1].reject(401))
    assert.equal(await page.eval(() => window.refreshHarness.pending.length), 2, 'second 401 ends retry')
    assert.equal(await page.eval(() => window.refreshHarness.refreshes.length), 1)
    assert.equal(await page.eval(() => window.refreshHarness.auth.token), null, 'second current 401 clears the expired session')
    await fresh(); await run(client => window.refreshHarness.start(client), client); await run(() => window.refreshHarness.pending[0].reject(401)); await run(() => window.refreshHarness.session(2))
    const before = await page.eval(() => localStorage.getItem('token'))
    await run(() => { const h = window.refreshHarness; h.refreshes[0].resolve({ token: h.token(1, 'refresh-session', 'user', 7 * 86400, 'old') }) })
    assert.equal(await page.eval(() => localStorage.getItem('token')), before)
    assert.equal(await page.eval(() => window.refreshHarness.pending.length), 1, 'queued obsolete 401 never sends a retry')
  }
  console.log('PASS shared reactive queue, both retry limits and obsolete queued-401 isolation')
  await fresh(); await run(() => window.refreshHarness.start('user'))
  await run(() => window.refreshHarness.session(1, 'refresh-session', 'user', 7 * 86400, 'already-refreshed'))
  await run(() => window.refreshHarness.pending[0].reject(401))
  assert.equal(await page.eval(() => window.refreshHarness.refreshes.length), 0, 'delayed old-token 401 uses the newer token in its same session without another refresh')
  assert.equal(await page.eval(() => window.refreshHarness.pending.length), 2)
  await run(() => window.refreshHarness.pending[1].resolve({ message: 'queued', taskId: 1, status: 'pending' }))
  await fresh(); await run(() => { const h = window.refreshHarness; h.session(1, 'refresh-session', 'user', 60); h.start('user'); h.session(2, 'new-session', 'user', 60); h.start('admin') })
  assert.equal(await page.eval(() => window.refreshHarness.refreshes.length), 2, 'replacement session starts its own refresh without waiting for an obsolete one')
  await run(() => { const h = window.refreshHarness; h.refreshes[0].resolve({ token: h.token(1) }); h.start('admin') })
  assert.equal(await page.eval(() => window.refreshHarness.refreshes.length), 2, 'old refresh finally cannot release the new-session lock')
  await run(() => { const h = window.refreshHarness; h.refreshes[1].resolve({ token: h.token(2, 'new-session', 'user', 7 * 86400, 'renewed') }) })
  assert.equal(await page.eval(() => window.refreshHarness.pending.length), 2)
  await run(() => { for (const req of window.refreshHarness.pending) req.resolve({ message: 'queued', taskId: 1, status: 'pending' }) })
  assert.equal(await page.eval(() => window.refreshHarness.auth.user.id), 2)
  for (const client of ['user', 'admin']) {
    await fresh(); await run(client => { const h = window.refreshHarness; h.session(1, 'refresh-session', 'user', 60); h.start(client) }, client)
    await run(() => window.refreshHarness.refreshes[0].resolve({}, 503))
    assert.equal(await page.eval(() => window.refreshHarness.pending.length), 1, 'temporary refresh 503 still sends the original-session request')
    await run(() => { const h = window.refreshHarness; h.pending[0].resolve({ message: 'queued', taskId: 1, status: 'pending' }) })
    assert.equal(await page.eval(() => window.refreshHarness.auth.user.id), 1)
    await fresh(); await run(client => { history.replaceState({}, '', client === 'admin' ? '/admin/login' : '/login'); const h = window.refreshHarness; h.session(1, 'refresh-session', 'user', 60); h.start(client) }, client)
    await run(() => window.refreshHarness.refreshes[0].resolve({}, 401))
    assert.equal(await page.eval(() => window.refreshHarness.auth.token), null, 'current invalid refresh clears local state')
    assert.equal(await page.eval(() => window.refreshHarness.pending.length), 0, 'expired proactive refresh never dispatches a write')
  }
  console.log('PASS replacement refresh lock isolation, temporary 503 preservation and current refresh-401 cleanup')
  for (const client of ['user', 'admin']) for (const mode of ['foreign', 'sid', 'missing', 'string', 'expired', 'role-change']) {
    await fresh(); await run(client => { const h = window.refreshHarness; h.session(1, 'refresh-session', 'user', 60); h.start(client) }, client)
    await run(mode => { const h = window.refreshHarness; const values = { foreign: h.token(2), sid: h.token(1, 'foreign-session'), missing: null, string: 1, expired: h.token(1, 'refresh-session', 'user', -10), 'role-change': h.token(1, 'refresh-session', 'admin') }; h.refreshes[0].resolve({ token: values[mode] }) }, mode)
    if (mode === 'role-change') {
      assert.equal(await page.eval(() => window.refreshHarness.pending.length), 0, 'changed role invalidates a prepared operation')
      assert.equal(await page.eval(() => window.refreshHarness.auth.user), null)
    } else {
      assert.equal(await page.eval(() => window.refreshHarness.auth.user.id), 1, 'malformed response does not overwrite current identity')
      assert.equal(await page.eval(() => window.refreshHarness.pending.length), 1, 'malformed refresh preserves current old-token request')
      await run(() => window.refreshHarness.pending[0].resolve({ message: 'queued', taskId: 1, status: 'pending' }))
    }
  }
  console.log('PASS malformed or foreign refresh identity rejection and legitimate role-change invalidation in both wrappers')
  await fresh(); await run(() => { const h = window.refreshHarness; h.auth.clearInMemoryAuth(); void h.auth.login('fixture', 'display-only').then(() => h.results.push('login')).catch(error => h.errors.push(error.code || error.message)) })
  assert.equal(await page.eval(() => window.refreshHarness.pending.length), 1, 'cross-entry memory clear still allows a fresh login with shared storage intact')
  await run(() => { const h = window.refreshHarness; h.pending[0].resolve({ token: h.token(2), user: { id: 2, username: 'fixture-account-2', role: 'user' } }) })
  assert.equal(await page.eval(() => window.refreshHarness.auth.user.id), 2)
  assert.equal(await page.eval(() => window.refreshHarness.results[0]), 'login')
  console.log('PASS current login remains possible after cross-entry memory-only logout')
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
} finally { if (browser) await browser.close(); await server.close() }
