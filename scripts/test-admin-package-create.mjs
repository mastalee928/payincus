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
const output = resolve(root, 'logs/admin-package-create-browser'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const server = await createServer({ configFile: false, root: root + '/scripts/fixtures/admin-pool-create', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api(?:\/admin)?$/, replacement: root + '/scripts/fixtures/admin-pool-create/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19661, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19661/?slow-packages', { settleMs: 1200 })
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
  await load(); await click('admin.instanceCreate.packageSource')
  const pkg = { id: 20, name: 'Legacy fixture', active: 1, isOwn: true, ownerId: 1, host_ids: [10, 11], instance_type: 'container', cpu_max: 100, memory_max: 512, disk_max: 2048, network_mode: 'nat' }
  await accept('packages', { packages: [pkg] }); await accept('plans', { plans: [] })
  await accept('hosts', { hosts: [{ id: 10, name: 'Legacy host', resources: { cpuAvailable: 100, memoryAvailable: 512 } }] })
  await accept('images', { images: [{ remoteAlias: 'debian/12', name: 'Debian 12' }] })
  await username('alice'); await accept('lookup', target('alice'))
  const legacyName = value => run(value => {
    const el = document.querySelector('form input[placeholder]')
    el.value = value; el.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
  await legacyName('legacy-fixture'); assert.equal(await submitDisabled(), false)
  await submit(); await legacyName('new-legacy-draft')
  await accept('legacy-create', { instance: { id: 70 } })
  assert.equal(await page.eval(() => document.querySelector('form input[placeholder]').value), 'new-legacy-draft', 'legacy completion must preserve an edited draft')
  const prepare = async () => {
    await username('alice'); await accept('lookup', target('alice')); await legacyName('legacy-fixture')
    assert.equal(await submitDisabled(), false)
  }
  const legacyResult = () => ({ instance: { id: 70, sshPort: 2200, rootPassword: 'fixture-credential-sentinel' } })
  await prepare(); const rapidBefore = await count('legacy-create')
  await run(() => { for (let i = 0; i < 10; i++) document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
  assert.equal(await count('legacy-create'), rapidBefore + 1)
  const targetWrite = await last('legacy-create'), beforeTargetWrite = await effects()
  await username('bob'); await accept('lookup', target('bob')); await acceptAt(targetWrite, legacyResult())
  assert.equal(await effects(), beforeTargetWrite, 'old target credentials must not appear under a new target')
  assert.equal(await page.eval(() => document.querySelector('input[placeholder]').value), 'bob')
  await prepare(); await submit(); const awayWrite = await last('legacy-create'), beforeAway = await effects()
  await run(() => window.poolHarness.router.push('/other')); await acceptAt(awayWrite, legacyResult())
  assert.equal(await effects(), beforeAway)
  await run(() => window.poolHarness.router.push('/create')); await prepare()
  await submit(); const cachedWrite = await last('legacy-create'), beforeCache = await effects()
  await run(() => window.poolHarness.router.push('/other')); await run(() => window.poolHarness.router.push('/create'))
  await acceptAt(cachedWrite, legacyResult()); assert.equal(await effects(), beforeCache)
  await prepare(); await submit(); const sessionWrite = await last('legacy-create'), beforeSession = await effects()
  await run(() => { window.poolHarness.session('legacy-session') }); await acceptAt(sessionWrite, legacyResult())
  assert.equal(await effects(), beforeSession)
  await prepare(); await submit(); const sourceWrite = await last('legacy-create'), beforeSource = await effects()
  await click('admin.instanceCreate.poolSource'); await load(); await acceptAt(sourceWrite, legacyResult())
  assert.equal(await effects(), beforeSource)
  await click('admin.instanceCreate.packageSource'); await prepare(); await submit()
  await rejectAt(await last('legacy-create'), 'Current legacy create failed')
  assert.ok(await page.eval(() => document.querySelector('form').textContent.includes('Current legacy create failed')))
  assert.equal(await page.eval(() => document.querySelector('form input[placeholder]').value), 'legacy-fixture')
  await submit(); const staleError = await last('legacy-create')
  await legacyName('new-error-draft'); await rejectAt(staleError, 'Old draft error')
  assert.equal(await page.eval(() => document.querySelector('form').textContent.includes('Old draft error')), false)
  await prepare()
  for (const locale of ['zh-CN', 'zh-TW', 'en-US']) for (const width of [1440, 390]) {
    await run(({ locale, width }) => { window.poolHarness.setLocale(locale); window.poolHarness.theme.setTheme(width === 390 ? 'dark' : 'light') }, { locale, width })
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width === 390 })
    await page.screenshot({ path: resolve(output, `${locale}-${width}.png`) })
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
  }
  await submit(); const beforeNormal = await effects(); await accept('legacy-create', legacyResult())
  assert.equal(await effects(), beforeNormal + 2, 'current success preserves the existing success and credential display')
  assert.equal(await page.eval(() => document.querySelector('form input[placeholder]').value), '')
  await accept('plans', { plans: [] }); await accept('hosts', { hosts: [{ id: 10, name: 'Legacy host', resources: { cpuAvailable: 100, memoryAvailable: 512 } }] })
  await accept('images', { images: [{ remoteAlias: 'debian/12', name: 'Debian 12' }] })
  await prepare(); await submit(); const unmountedWrite = await last('legacy-create'), beforeUnmount = await effects()
  await run(() => { window.poolHarness.state.mounted = false }); await acceptAt(unmountedWrite, legacyResult())
  assert.equal(await effects(), beforeUnmount)
  console.log('PASS legacy package create: new draft/target preservation, single submit, old credential suppression on session/cache/route/source/unmount, current errors and normal success; 3 locales desktop/mobile. Controlled API, no real credentials or provisioning.')
} finally { if (browser) await browser.close(); await server.close() }
