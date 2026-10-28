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
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/admin-pool-create/*.js']
const output = resolve(root, 'logs/admin-pool-create-browser'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const server = await createServer({ configFile: false, root: root + '/scripts/fixtures/admin-pool-create', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api(?:\/admin)?$/, replacement: root + '/scripts/fixtures/admin-pool-create/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19661, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19661/', { settleMs: 1200 })
  const deadline = Date.now() + 15000
  while (!await page.eval(() => !!window.poolHarness?.pending.some(item => item.kind === 'catalog'))) {
    if (Date.now() >= deadline) throw Error('Admin pool form did not load within 15 seconds')
    await sleep(100)
  }
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(60); return result }
  const count = kind => page.eval(kind => window.poolHarness.pending.filter(item => item.kind === kind).length, kind)
  const last = kind => page.eval(kind => window.poolHarness.pending.findLastIndex(item => item.kind === kind), kind)
  const acceptAt = (index, data) => run(({ index, data }) => window.poolHarness.pending[index].resolve(data), { index, data })
  const accept = async (kind, data) => acceptAt(await last(kind), data)
  const rejectAt = (index, message) => run(({ index, message }) => window.poolHarness.pending[index].reject(new Error(message)), { index, message })
  const click = key => run(key => {
    const button = [...document.querySelectorAll('button')].find(el => el.checkVisibility() && el.textContent.trim() === window.poolHarness.t(key))
    if (!button) throw Error('Missing button ' + key)
    button.click()
  }, key)
  const username = async value => {
    await run(value => {
      const el = document.querySelector('input[placeholder]')
      el.value = value; el.dispatchEvent(new Event('input', { bubbles: true }))
    }, value)
    await run(() => document.querySelector('input[placeholder]').dispatchEvent(new Event('blur')))
  }
  const name = value => run(value => {
    const el = document.querySelector('form input[autocomplete="off"]')
    el.value = value; el.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
  const target = username => ({ user: { id: username === 'alice' ? 2 : 3, username, status: 'active', balance: 100 } })
  const submit = () => run(() => document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  const submitDisabled = () => page.eval(() => document.querySelector('button[type="submit"]')?.disabled ?? true)
  const result = (id = 70, status = 'creating', refundPending = false) => ({ instances: [{ id, status, refundPending }] })
  const effects = () => page.eval(() => window.poolHarness.toastEvents.length)
  const product = { id: 20, resourcePreset: 'E2', diskGiB: 30, cpu: 200, memoryMiB: 768, monthlyPrice: 1000, setupFee: 200, idle: 3, total: 3 }
  const catalog = { regions: [{ id: 10, name: 'Fixture region', countryCode: 'us', products: [product] }] }
  const load = async () => {
    await accept('catalog', catalog)
    await accept('images', { images: [{ id: 1, name: 'Debian 12', remoteAlias: 'debian/12', architecture: 'x86_64', instanceType: 'container' }] })
  }
  await load()
  assert.equal(await page.eval(() => document.querySelector('button[aria-pressed="true"]').textContent.trim() === window.poolHarness.t('admin.instanceCreate.poolSource')), true, 'real admin page must default to machine-pool creation')
  await username('alice'); await accept('lookup', target('alice')); await name('pool-fixture')
  assert.equal(await submitDisabled(), false)
  await submit(); const oldTargetWrite = await last('create'), beforeOldTarget = await effects()
  await username('bob'); await accept('lookup', target('bob'))
  await acceptAt(oldTargetWrite, result())
  assert.equal(await page.eval(() => window.poolHarness.router.currentRoute.value.path), '/create', 'old target completion must not navigate the new target away')
  assert.equal(await effects(), beforeOldTarget, 'old target completion must not attribute success to the current username')
  const prepare = async (who = 'alice') => {
    await username(who); await accept('lookup', target(who)); await name('pool-fixture')
    assert.equal(await submitDisabled(), false)
  }
  const payload = () => page.eval(() => window.poolHarness.pending.findLast(item => item.kind === 'create').params)
  await prepare()
  await run(() => { for (let i = 0; i < 10; i++) document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
  assert.equal(await count('create'), 2, 'rapid submit must send exactly one additional pool order')
  assert.equal(await page.eval(() => document.querySelector('form fieldset').disabled), true, 'pool order fields are frozen in flight')
  const initialPayload = await payload()
  assert.equal(initialPayload.username, 'alice'); assert.equal(initialPayload.poolPriceId, 20)
  assert.equal(initialPayload.expectedTotal, 1200); assert.equal(initialPayload.billing, 'free')
  await rejectAt(await last('create'), 'Fixture request interrupted')
  assert.ok(await page.eval(() => document.querySelector('form [role="alert"]')?.textContent.includes('Fixture request interrupted')))
  await submit()
  assert.equal((await payload()).requestId, initialPayload.requestId, 'unknown failure retries the same order')
  await accept('create', result(71, 'error', true))
  await submit()
  assert.equal((await payload()).requestId, initialPayload.requestId, 'pending refund retries the same order')
  await accept('create', result(71, 'error', false))
  assert.ok(await page.eval(() => document.querySelector('form [role="alert"]')?.textContent.includes(window.poolHarness.t('admin.instanceCreate.createFailed'))))
  await submit()
  assert.notEqual((await payload()).requestId, initialPayload.requestId, 'confirmed failed and settled order can start a new intent')
  await rejectAt(await last('create'), 'Settled fixture failure')
  // Paid billing options and the existing expected quote are sent unchanged.
  await run(() => document.querySelector('form input[value="paid"]').click())
  await submit(); assert.equal((await payload()).billing, 'paid'); assert.equal((await payload()).chargeFirstMonth, true)
  await rejectAt(await last('create'), 'Paid fixture failure')
  await run(() => document.querySelector('form input[type="checkbox"]').click())
  await submit(); assert.equal((await payload()).chargeFirstMonth, false); assert.equal((await payload()).expectedTotal, 1200)
  await rejectAt(await last('create'), 'Waived fixture failure')
  const oldLookupEffects = await effects()
  await username('alice'); const staleLookup = await last('lookup')
  await run(() => { window.poolHarness.session('new-lookup-session') })
  await acceptAt(staleLookup, target('alice'))
  assert.equal(await submitDisabled(), true, 'old admin session must not revalidate the current pool target')
  await load()
  await username('alice'); await accept('lookup', target('bob'))
  assert.equal(await submitDisabled(), true, 'lookup response must match the requested username')
  await username('alice'); await accept('lookup', { user: { ...target('alice').user, status: 'inactive' } })
  assert.equal(await submitDisabled(), true)
  await prepare()
  await run(() => { window.poolHarness.auth.token += '-refreshed' })
  assert.equal(await submitDisabled(), false, 'same SID refresh preserves target validation')
  await submit(); const staleSessionWrite = await last('create')
  await run(() => { window.poolHarness.session('next-write-session') })
  assert.equal(await submitDisabled(), true)
  await rejectAt(staleSessionWrite, 'Stale session failure')
  assert.equal(await page.eval(() => document.body.textContent.includes('Stale session failure')), false)
  assert.equal(await effects(), oldLookupEffects)
  await load()
  await prepare(); await submit(); const cachedWrite = await last('create'), beforeCached = await effects()
  await run(() => window.poolHarness.router.push('/other'))
  await run(() => window.poolHarness.router.push('/create'))
  await username('bob'); await accept('lookup', target('bob'))
  assert.equal(await submitDisabled(), true, 'cached page retains in-flight write gate')
  await acceptAt(cachedWrite, result(72))
  assert.equal(await page.eval(() => window.poolHarness.router.currentRoute.value.path), '/create')
  assert.equal(await effects(), beforeCached)
  await load()
  // Changing away and back to the same target must not revive its old receipt.
  await prepare(); await submit(); const abaWrite = await last('create')
  await username('bob'); await accept('lookup', target('bob')); await username('alice'); await accept('lookup', target('alice'))
  await acceptAt(abaWrite, result(73))
  assert.equal(await page.eval(() => window.poolHarness.router.currentRoute.value.path), '/create')
  await prepare(); await submit(); const awayWrite = await last('create'), beforeAway = await effects()
  await run(() => window.poolHarness.router.push('/other')); await acceptAt(awayWrite, result(74))
  assert.equal(await page.eval(() => window.poolHarness.router.currentRoute.value.path), '/other')
  assert.equal(await effects(), beforeAway)
  await run(() => window.poolHarness.router.push('/create')); await load(); await prepare()
  await submit(); const sourceWrite = await last('create'), beforeSource = await effects()
  await click('admin.instanceCreate.packageSource')
  await acceptAt(sourceWrite, result(75))
  assert.equal(await page.eval(() => window.poolHarness.router.currentRoute.value.path), '/create')
  assert.equal(await effects(), beforeSource, 'unmounted pool branch completion must not navigate from package branch')
  await click('admin.instanceCreate.poolSource'); await load(); await prepare()
  for (const locale of ['zh-CN', 'zh-TW', 'en-US']) for (const width of [1440, 390]) {
    await run(({ locale, width }) => { window.poolHarness.setLocale(locale); window.poolHarness.theme.setTheme(width === 390 ? 'dark' : 'light') }, { locale, width })
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width === 390 })
    await page.screenshot({ path: resolve(output, `${locale}-${width}.png`) })
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
  }
  await submit(); const beforeSuccess = await effects(); await accept('create', result(76))
  assert.equal(await page.eval(() => window.poolHarness.router.currentRoute.value.path), '/admin/instances/76', 'current success retains original detail navigation')
  assert.equal(await effects(), beforeSuccess + 1)
  assert.ok(await page.eval(() => window.poolHarness.toastEvents.at(-1).message.includes('alice')))
  await run(() => window.poolHarness.router.push('/create')); await load(); await prepare(); await submit()
  const unmountedWrite = await last('create'), beforeUnmount = await effects()
  await run(() => { window.poolHarness.state.mounted = false }); await acceptAt(unmountedWrite, result(77))
  assert.equal(await effects(), beforeUnmount)
  assert.equal(await page.eval(() => window.poolHarness.router.currentRoute.value.path), '/create')
  await run(() => { window.poolHarness.state.mounted = true }); await load(); await prepare(); await submit()
  const loggedOutWrite = await last('create'), beforeLogout = await effects()
  await run(() => { window.poolHarness.auth.token = null; window.poolHarness.auth.user = null })
  await acceptAt(loggedOutWrite, result(78))
  assert.equal(await effects(), beforeLogout)
  assert.equal(await submitDisabled(), true)
  const ordersAfterLogout = await count('create')
  await submit(); assert.equal(await count('create'), ordersAfterLogout, 'direct form submission after logout must be rejected')
  console.log('PASS real admin page defaults to pool; target/session/SID/cache/route/source/unmount write isolation, lookup response checks, single submission, billing payloads, unknown failure/refund retry IDs and current success navigation; 3 locales desktop/mobile. Controlled API, no provisioning.')
} finally { if (browser) await browser.close(); await server.close() }
