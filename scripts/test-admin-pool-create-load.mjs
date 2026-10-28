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
const output = resolve(root, 'logs/admin-pool-create-load-browser'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
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
  await load(); await username('alice'); await accept('lookup', target('alice')); await name('pool-read-fixture')
  assert.equal(await submitDisabled(), false)
  await click('common.refresh')
  await rejectAt(await last('catalog'), 'Fixture catalog refresh failed')
  await accept('images', { images: [] })
  assert.equal(await submitDisabled(), true, 'failed refresh must not authorize creation using stale pool stock and images')
  const beforeRejectedSubmit = await count('create'); await submit()
  assert.equal(await count('create'), beforeRejectedSubmit)
  assert.ok(await page.eval(() => document.querySelector('form [role="alert"]')?.textContent.includes('Fixture catalog refresh failed')))
  assert.equal(await page.eval(() => document.querySelector('form').textContent.includes(window.poolHarness.t('admin.instanceCreate.noPoolStock'))), false)
  await page.screenshot({ path: resolve(output, 'refresh-error-desktop.png') })
  await click('common.refresh'); await load()
  await username('alice'); await accept('lookup', target('alice'))
  await click('common.refresh')
  await accept('catalog', { regions: [{ ...catalog.regions[0], products: [product, { ...product, id: 21, resourcePreset: 'ARM2C' }] }] })
  await accept('images', { images: [
    { id: 1, name: 'x86 Debian', remoteAlias: 'debian/x86', architecture: 'x86_64', instanceType: 'container' },
    { id: 2, name: 'ARM Debian', remoteAlias: 'debian/arm', architecture: 'aarch64', instanceType: 'container' },
    { id: 3, name: 'VM only', remoteAlias: 'vm/arm', architecture: 'aarch64', instanceType: 'vm' }
  ] })
  await run(() => { const el = document.querySelector('form select'); el.value = '21'; el.dispatchEvent(new Event('change', { bubbles: true })) })
  assert.deepEqual(await page.eval(() => [...document.querySelectorAll('form select')[1].options].map(el => el.value)), ['', 'debian/arm'], 'pool image options must match machine architecture and exclude VM-only images')
  await submit()
  assert.equal(await page.eval(() => window.poolHarness.pending.findLast(item => item.kind === 'create').params.image), 'debian/arm')
  await rejectAt(await last('create'), 'Architecture fixture failure')
  await click('common.refresh'); await load()
  assert.equal(await submitDisabled(), false)
  assert.equal(await page.eval(() => document.querySelector('form input[autocomplete="off"]').value), 'pool-read-fixture', 'refresh preserves name draft')
  await submit(); const beforeRefreshRetry = await page.eval(() => window.poolHarness.pending.findLast(item => item.kind === 'create').params.requestId)
  await rejectAt(await last('create'), 'Unknown order result')
  await click('common.refresh'); await load(); await submit()
  assert.equal(await page.eval(() => window.poolHarness.pending.findLast(item => item.kind === 'create').params.requestId), beforeRefreshRetry, 'unchanged refreshed data must preserve an uncertain order intent')
  await rejectAt(await last('create'), 'Fixture completed')
  await click('common.refresh'); await accept('catalog', catalog); await rejectAt(await last('images'), 'Fixture image read failed')
  assert.equal(await submitDisabled(), true)
  assert.ok(await page.eval(() => document.querySelector('form [role="alert"]')?.textContent.includes('Fixture image read failed')))
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 1, mobile: true })
  await page.screenshot({ path: resolve(output, 'image-error-mobile.png') })
  await click('common.refresh')
  await accept('catalog', { regions: [] }); await accept('images', { images: [] })
  assert.equal(await page.eval(() => !!document.querySelector('form [role="alert"]')), false)
  assert.ok(await page.eval(() => document.querySelector('form').textContent.includes(window.poolHarness.t('admin.instanceCreate.noPoolStock'))))
  assert.equal(await submitDisabled(), true)
  await click('common.refresh'); await load()
  // A failed read may leave its sibling outstanding; neither may touch a later load.
  await click('common.refresh'); const oldImages = await last('images')
  await rejectAt(await last('catalog'), 'Old catalog failure'); await click('common.refresh')
  await acceptAt(oldImages, { images: [] })
  assert.equal(await submitDisabled(), true, 'late sibling cannot clear a newer loading state')
  await load(); assert.equal(await submitDisabled(), false)
  await click('common.refresh'); const oldCatalog = await last('catalog'), oldSessionImages = await last('images')
  await run(() => { window.poolHarness.session('read-new-session') })
  await load(); await username('alice'); await accept('lookup', target('alice'))
  await acceptAt(oldCatalog, { regions: [] }); await rejectAt(oldSessionImages, 'Old session read failed')
  assert.equal(await submitDisabled(), false)
  assert.equal(await page.eval(() => document.body.textContent.includes('Old session read failed')), false)
  const beforeSameSid = await count('catalog')
  await run(() => { window.poolHarness.auth.token += '-rotated' })
  assert.equal(await count('catalog'), beforeSameSid)
  await click('common.refresh'); const hiddenCatalog = await last('catalog'), hiddenImages = await last('images')
  await run(() => window.poolHarness.router.push('/other'))
  const beforeHiddenReads = await count('catalog')
  await run(() => { window.poolHarness.session('hidden-session') })
  await acceptAt(hiddenCatalog, { regions: [] }); await acceptAt(hiddenImages, { images: [] })
  assert.equal(await count('catalog'), beforeHiddenReads, 'hidden component does not read')
  await run(() => window.poolHarness.router.push('/create'))
  assert.equal(await count('catalog'), beforeHiddenReads + 1)
  await load(); await username('alice'); await accept('lookup', target('alice'))
  await submit(); const pendingOrder = await last('create'), beforePending = await count('catalog')
  await run(() => window.poolHarness.router.push('/other')); await run(() => window.poolHarness.router.push('/create'))
  assert.equal(await count('catalog'), beforePending, 'cached return must wait for in-flight order to settle')
  assert.equal(await submitDisabled(), true)
  await acceptAt(pendingOrder, result())
  assert.equal(await count('catalog'), beforePending + 1)
  await load(); await username('alice'); await accept('lookup', target('alice'))
  assert.equal(await submitDisabled(), false)
  await click('common.refresh'); const unmountedCatalog = await last('catalog'), unmountedImages = await last('images'), beforeUnmounted = await effects()
  await run(() => { window.poolHarness.state.mounted = false })
  await acceptAt(unmountedCatalog, catalog); await rejectAt(unmountedImages, 'Unmounted read failed')
  assert.equal(await effects(), beforeUnmounted)
  await run(() => { window.poolHarness.state.mounted = true })
  await rejectAt(await last('catalog'), 'Initial pool catalog unavailable')
  assert.equal(await submitDisabled(), true)
  assert.equal(await page.eval(() => document.querySelector('form').textContent.includes(window.poolHarness.t('admin.instanceCreate.noPoolStock'))), false, 'initial read failure is not sold-out inventory')
  await click('common.refresh'); await load()
  console.log('PASS actual admin pool page: initial/catalog/image failure gates, successful empty state, retry with preserved draft/order intent, stale sibling/session/hidden/unmounted reads, SID refresh and wait for write before cached reload. Controlled API, no provisioning.')
} finally { if (browser) await browser.close(); await server.close() }
