import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { Browser, sleep } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'
const root = fileURLToPath(new URL('..', import.meta.url)).replaceAll('\\', '/')
const require = createRequire(new URL('../client/package.json', import.meta.url))
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href)
const output = resolve(root, 'logs/auth-session'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/auth-session',
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/auth-session/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia'] },
  server: { host: '127.0.0.1', port: 19768, strictPort: true, fs: { allow: [root] } }
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  const run = async (fn, arg) => { const value = await page.eval(fn, arg); await sleep(25); return value }
  const fresh = async () => {
    await page.goto('http://127.0.0.1:19768', { settleMs: 150 }); const deadline = Date.now() + 10000
    while (!await page.eval(() => !!window.authHarness)) { if (Date.now() > deadline) throw Error('auth fixture failed'); await sleep(30) }
  }
  const request = kind => run(kind => { const h = window.authHarness; void h.auth[kind]().then(value => h.results.push(value)).catch(error => h.errors.push(error.code || error.message)) }, kind)
  const settle = (index, id = 1, failure = false) => run(({ index, id, failure }) => {
    const h = window.authHarness, req = h.pending[index]
    failure ? req.reject({ code: 'UNAUTHORIZED', response: { status: 401 } }) : req.resolve({ user: h.user(id) })
  }, { index, id, failure })
  await fresh(); await request('fetchCurrentUser'); await run(() => window.authHarness.auth.clearLocalAuth()); await settle(0)
  assert.equal(await page.eval(() => window.authHarness.auth.user), null, 'late identity read must not restore signed-out user state')
  console.log('PASS late identity response cannot restore signed-out state')
  let obsolete = 0
  for (const kind of ['fetchCurrentUser', 'checkSession']) for (const mode of ['account', 'sid', 'role', 'clear-local', 'clear-memory', 'session-aba', 'storage-token', 'storage-clear', 'storage-queued', 'storage-aba', 'storage-before-event']) for (const failure of [false, true]) {
    await fresh(); await request(kind)
    await run(mode => {
      const h = window.authHarness
      if (mode === 'account') h.session(2)
      if (mode === 'sid') h.session(1, 'other-session')
      if (mode === 'role') h.session(1, 'auth-session', 'admin')
      if (mode === 'clear-local') h.auth.clearLocalAuth()
      if (mode === 'clear-memory') h.auth.clearInMemoryAuth()
      if (mode === 'session-aba') { h.session(2); h.session(1) }
      if (mode.startsWith('storage')) {
        const token = 'fixture.' + btoa(JSON.stringify({ id: 2, sid: 'other-session', role: 'user' })) + '.fixture'
        const original = h.auth.token
        if (mode === 'storage-clear') localStorage.clear(); else localStorage.setItem('token', mode === 'storage-aba' ? original : token)
        if (mode !== 'storage-before-event') window.dispatchEvent(new StorageEvent('storage', { key: mode === 'storage-clear' ? null : 'token', oldValue: original, newValue: mode === 'storage-queued' ? original : token }))
      }
    }, mode)
    const before = await page.eval(() => { const h = window.authHarness; return JSON.stringify({ user: h.auth.user, quota: h.auth.quota, token: h.auth.token, stored: localStorage.getItem('token') }) })
    await settle(0, 1, failure)
    assert.equal(await page.eval(() => { const h = window.authHarness; return JSON.stringify({ user: h.auth.user, quota: h.auth.quota, token: h.auth.token, stored: localStorage.getItem('token') }) }), before, `${kind}/${mode}/${failure} receipt must preserve current state`)
    if (mode === 'clear-memory') assert.notEqual(await page.eval(() => localStorage.getItem('token')), null, 'cross-entry memory clear preserves other tabs')
    if (mode === 'storage-queued') assert.equal(await page.eval(() => window.authHarness.auth.user), null, 'storage switch clears private identity')
    obsolete++
  }
  console.log(`PASS ${obsolete} obsolete identity success/401 receipts across accounts, sessions, roles, ABA and storage events`)
  await fresh(); await request('fetchCurrentUser'); await request('checkSession')
  await run(() => window.authHarness.pending[1].resolve({ user: { ...window.authHarness.user(), username: 'current-name', quota: { hostLimit: 0 } } }))
  await settle(0)
  assert.equal(await page.eval(() => window.authHarness.auth.user.username), 'current-name')
  assert.equal(await page.eval(() => window.authHarness.auth.quota.hostLimit), 0)
  await fresh(); await request('fetchCurrentUser'); await run(() => window.authHarness.session(1, 'auth-session', 'user', 'refreshed')); await settle(0)
  assert.equal(await page.eval(() => window.authHarness.auth.user.id), 1, 'same-session refresh accepts the current identity')
  for (const kind of ['fetchCurrentUser', 'checkSession']) {
    await fresh(); await request(kind); await settle(0, 1, true)
    assert.equal(await page.eval(() => window.authHarness.auth.token), null, 'current 401 signs out')
    await fresh(); await request(kind); await run(() => window.authHarness.pending[0].reject(Error('controlled network failure')))
    assert.equal(await page.eval(() => window.authHarness.auth.user.id), 1, 'temporary failure preserves confirmed identity')
    await request(kind); await settle(1)
    assert.equal(await page.eval(() => window.authHarness.auth.user.id), 1, 'current identity retries')
    for (const mode of ['foreign', 'missing', 'unsafe-id', 'bad-role', 'bad-name']) {
      await fresh(); await request(kind)
      await run(mode => {
        const h = window.authHarness, user = h.user(); user.username = 'must-not-apply'
        if (mode === 'foreign') user.id = 2
        if (mode === 'unsafe-id') user.id = 1.5
        if (mode === 'bad-role') user.role = 'owner'
        if (mode === 'bad-name') user.username = null
        h.pending[0].resolve(mode === 'missing' ? {} : { user })
      }, mode)
      assert.equal(await page.eval(() => window.authHarness.auth.user.username), 'fixture-account-1', `${kind}/${mode} does not corrupt the identity`)
    }
  }
  console.log('PASS latest read ordering, same-session refresh, zero quota, current 401, network retry and ten malformed identity responses')
  for (const mode of ['account', 'clear', 'aba', 'storage-before-event']) {
    await fresh(); await run(() => { const h = window.authHarness; void h.auth.login('fixture', 'display-only').catch(error => h.errors.push(error.code || error.message)) })
    await run(mode => { const h = window.authHarness; if (mode === 'account') h.session(2); if (mode === 'clear') h.auth.clearLocalAuth(); if (mode === 'aba') { h.session(2); h.session(1) }; if (mode === 'storage-before-event') localStorage.removeItem('token') }, mode)
    const before = await page.eval(() => JSON.stringify({ user: window.authHarness.auth.user, stored: localStorage.getItem('token') }))
    await run(() => { const h = window.authHarness; h.pending[0].resolve({ token: 'display-only-login-token', user: h.user() }) })
    assert.equal(await page.eval(() => JSON.stringify({ user: window.authHarness.auth.user, stored: localStorage.getItem('token') })), before, `obsolete login ${mode} does not restore an identity`)
    assert.equal(await page.eval(() => window.authHarness.errors[0]), 'AUTHENTICATION_STATE_CHANGED')
  }
  for (const failure of [false, true]) for (const mode of ['current', 'account', 'aba', 'storage-before-event', 'same-sid']) {
    await fresh(); await request('fetchCurrentUser'); await request('logout')
    assert.equal(await page.eval(() => window.authHarness.auth.user), null, 'logout immediately clears private user details')
    assert.equal(await page.eval(() => window.authHarness.auth.quota), null)
    await request('fetchCurrentUser'); assert.equal(await page.eval(() => window.authHarness.pending.length), 2, 'no identity reads during logout')
    await settle(0)
    assert.equal(await page.eval(() => window.authHarness.auth.user), null)
    await run(mode => { const h = window.authHarness; if (mode === 'account') h.session(2); if (mode === 'aba') { h.session(2); h.session(1) }; if (mode === 'storage-before-event') localStorage.setItem('token', 'replacement-local-token'); if (mode === 'same-sid') { const token = 'fixture.' + btoa(JSON.stringify({ id: 1, sid: 'auth-session', role: 'user', marker: 'refresh' })) + '.fixture'; localStorage.setItem('token', token); h.auth.syncToken() } }, mode)
    const before = await page.eval(() => localStorage.getItem('token'))
    await run(failure => { const h = window.authHarness; failure ? h.pending[1].reject(Error('controlled logout unavailable')) : h.pending[1].resolve({ message: 'signed out' }) }, failure)
    assert.equal(await page.eval(() => localStorage.getItem('token')), ['current', 'same-sid'].includes(mode) ? null : before, `logout ${mode}/${failure} clears only its session`)
  }
  console.log('PASS four obsolete logins and ten logout completions, immediate private cleanup and same-session versus replacement-session behavior')
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
} finally { if (browser) await browser.close(); await server.close() }
