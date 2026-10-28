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
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/host-create-instance/*.js']
const output = resolve(root, 'logs/host-create-instance-browser'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const server = await createServer({ configFile: false, root: root + '/scripts/fixtures/host-create-instance', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api(?:\/admin)?$/, replacement: root + '/scripts/fixtures/host-create-instance/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19660, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19660/', { settleMs: 1200 })
  const deadline = Date.now() + 15000
  while (!await page.eval(() => !!window.hostCreateHarness?.pending.some(item => item.kind === 'me'))) {
    if (Date.now() >= deadline) throw Error('Host create editor did not load within 15 seconds')
    await sleep(100)
  }
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(60); return result }
  const count = kind => page.eval(kind => window.hostCreateHarness.pending.filter(item => item.kind === kind).length, kind)
  const last = kind => page.eval(kind => window.hostCreateHarness.pending.findLastIndex(item => item.kind === kind), kind)
  const acceptAt = (index, data) => run(({ index, data }) => window.hostCreateHarness.pending[index].resolve(data), { index, data })
  const accept = async (kind, data) => acceptAt(await last(kind), data)
  const rejectAt = (index, message) => run(({ index, message }) => window.hostCreateHarness.pending[index].reject(new Error(message)), { index, message })
  const click = key => run(key => {
    const button = [...document.querySelectorAll('button')].find(el => el.checkVisibility() && el.textContent.trim() === window.hostCreateHarness.t(key))
    if (!button) throw Error('Missing button ' + key)
    button.click()
  }, key)
  const input = (key, value) => run(({ key, value }) => {
    const el = [...document.querySelectorAll('input')].find(el => el.placeholder === window.hostCreateHarness.t(key))
    if (!el) throw Error('Missing input ' + key)
    el.value = value; el.dispatchEvent(new Event('input', { bubbles: true }))
  }, { key, value })
  const username = value => input('admin.instanceCreate.usernamePlaceholder', value)
  const target = (username, id = 2) => ({ user: { id, username, status: 'active', hasSshKey: true } })
  const submitDisabled = () => page.eval(() => document.querySelector('button[type="submit"]').disabled)
  const pkg = { id: 20, name: 'Fixture package', active: 1, isOwn: true, ownerId: 1, host_ids: [10, 11], instance_type: 'container', cpu_max: 100, memory_max: 512, disk_max: 2048, network_mode: 'nat' }
  await accept('me', { user: { id: 1, role: 'admin' } }); await accept('packages', { packages: [pkg] })
  await accept('plans', { plans: [] }); await accept('images', { images: [{ remoteAlias: 'debian/12', name: 'Debian 12' }] })
  await input('instance.createPage.instanceNamePlaceholder', 'fixture-instance')
  await username('alice'); await click('admin.instanceCreate.checkUser'); await accept('lookup', target('alice'))
  assert.equal(await submitDisabled(), false)
  await username('bob')
  assert.equal(await submitDisabled(), true, 'editing the target must immediately invalidate the previous verified user')
  await run(() => document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  assert.equal(await count('gift'), 0, 'old target must not be submitted through the form')
  await click('admin.instanceCreate.checkUser'); const bobRequest = await last('lookup')
  await username('charlie'); await click('admin.instanceCreate.checkUser')
  await accept('lookup', target('charlie', 3)); await acceptAt(bobRequest, target('bob'))
  assert.equal(await submitDisabled(), false)
  assert.ok(await page.eval(() => document.querySelector('form').textContent.includes(window.hostCreateHarness.t('admin.instanceCreate.userFound', { id: 3 }))))
  await username('old-failure'); await click('admin.instanceCreate.checkUser'); const oldFailure = await last('lookup')
  await username('diana'); await click('admin.instanceCreate.checkUser'); await accept('lookup', target('diana', 4))
  await rejectAt(oldFailure, 'Stale lookup failure')
  assert.equal(await submitDisabled(), false)
  await username('wrong-response'); await click('admin.instanceCreate.checkUser'); await accept('lookup', target('another-user', 5))
  assert.equal(await submitDisabled(), true, 'mismatched response identity rejected')
  for (const change of [{ status: 'inactive' }, { hasSshKey: false }]) {
    await username('blocked-user'); await click('admin.instanceCreate.checkUser')
    const data = target('blocked-user', 5); Object.assign(data.user, change); await accept('lookup', data)
    assert.equal(await submitDisabled(), true)
  }
  await username('alice'); await click('admin.instanceCreate.checkUser'); await accept('lookup', target('alice'))
  await run(() => { window.hostCreateHarness.auth.token += '-rotated' })
  assert.equal(await submitDisabled(), false, 'same SID refresh preserves target validation')
  await run(() => { window.hostCreateHarness.session('b') })
  assert.equal(await submitDisabled(), true)
  await click('admin.instanceCreate.checkUser'); const oldSession = await last('lookup')
  await run(() => { window.hostCreateHarness.session('c') }); await acceptAt(oldSession, target('alice'))
  assert.equal(await submitDisabled(), true)
  await click('admin.instanceCreate.checkUser'); const oldHost = await last('lookup')
  await run(() => { window.hostCreateHarness.state.hostId = 11 }); await acceptAt(oldHost, target('alice'))
  assert.equal(await submitDisabled(), true)
  await click('admin.instanceCreate.checkUser'); await accept('lookup', target('alice'))
  assert.equal(await page.eval(() => window.hostCreateHarness.pending.findLast(item => item.kind === 'lookup').params.hostId), 11)
  await run(() => window.hostCreateHarness.router.push('/other'))
  await run(() => window.hostCreateHarness.router.push('/host'))
  assert.equal(await submitDisabled(), true, 'cached return requires fresh target validation')
  await click('admin.instanceCreate.checkUser'); await accept('lookup', target('alice'))
  await username('  diana  '); await click('admin.instanceCreate.checkUser'); await accept('lookup', target('diana', 4))
  await run(() => {
    for (let i = 0; i < 10; i++) document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
  assert.equal(await count('gift'), 1)
  assert.equal(await page.eval(() => window.hostCreateHarness.pending.findLast(item => item.kind === 'gift').params.data.username), 'diana')
  assert.equal(await page.eval(() => window.hostCreateHarness.pending.findLast(item => item.kind === 'gift').params.hostId), 11)
  await username('changed-during-request')
  await accept('gift', { success: true })
  assert.ok(await page.eval(() => window.hostCreateHarness.toastEvents.some(item => item.type === 'success' && item.message.includes('diana'))), 'confirmation uses submitted target after input invalidation')
  for (const locale of ['zh-CN', 'zh-TW', 'en-US']) for (const width of [1440, 390]) {
    await run(({ locale, width }) => { window.hostCreateHarness.setLocale(locale); window.hostCreateHarness.theme.setTheme(width === 390 ? 'dark' : 'light') }, { locale, width })
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width === 390 })
    await page.screenshot({ path: resolve(output, `${locale}-${width}.png`) })
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
  }
  console.log('PASS actual host gift form: immediate target invalidation, lookup ordering/errors/identity mismatch, inactive/no SSH rejection, session/SID/host/cache changes, normalized target and single submit payload; 3 locales desktop/mobile. Controlled API, no instance creation.')
} finally { if (browser) await browser.close(); await server.close() }
