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
const output = resolve(root, 'logs/admin-package-options-browser'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
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
  const target = username => ({ user: { id: username === 'alice' ? 2 : 3, username, status: 'active', balance: 100 } })
  const submit = () => run(() => document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  const submitDisabled = () => page.eval(() => document.querySelector('button[type="submit"]')?.disabled ?? true)
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
  await run(() => {
    const el = document.querySelectorAll('input[type="range"]')[1]
    el.value = '128'; el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  assert.equal(await submitDisabled(), true, 'legacy image refresh must block submission of the old selected image')
  const beforeSubmit = await count('legacy-create'); await submit(); assert.equal(await count('legacy-create'), beforeSubmit)
  const oldImages = await last('images')
  await run(() => {
    const el = document.querySelectorAll('input[type="range"]')[1]
    el.value = '256'; el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const currentImages = await last('images')
  await rejectAt(oldImages, 'Old image selection failed')
  assert.equal(await submitDisabled(), true, 'old image finally cannot end a newer refresh')
  await acceptAt(currentImages, { images: [{ remoteAlias: 'debian/current', name: 'Current Debian' }] })
  assert.equal(await submitDisabled(), true, 'host refresh must also finish before submission')
  await accept('hosts', { hosts: [{ id: 10, name: 'Legacy host', resources: { cpuAvailable: 100, memoryAvailable: 512 } }] })
  assert.equal(await submitDisabled(), false)
  await submit()
  assert.equal(await page.eval(() => window.poolHarness.pending.findLast(item => item.kind === 'legacy-create').params.image), 'debian/current')
  await rejectAt(await last('legacy-create'), 'Fixture create failure')
  // A current image failure removes all valid options; it cannot silently use the prior image.
  await run(() => {
    const el = document.querySelectorAll('input[type="range"]')[1]
    el.value = '128'; el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await accept('hosts', { hosts: [{ id: 10, name: 'Legacy host', resources: { cpuAvailable: 100, memoryAvailable: 512 } }] })
  await rejectAt(await last('images'), 'Current images unavailable')
  assert.equal(await submitDisabled(), true)
  await run(() => {
    const el = document.querySelectorAll('input[type="range"]')[1]
    el.value = '256'; el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const staleSuccess = await last('images')
  await run(() => {
    const el = document.querySelectorAll('input[type="range"]')[1]
    el.value = '128'; el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await accept('images', { images: [{ remoteAlias: 'debian/low', name: 'Low memory Debian' }] })
  await accept('hosts', { hosts: [{ id: 10, name: 'Legacy host', resources: { cpuAvailable: 100, memoryAvailable: 512 } }] })
  await acceptAt(staleSuccess, { images: [{ remoteAlias: 'ubuntu/stale', name: 'Stale Ubuntu' }] })
  assert.equal(await page.eval(() => document.querySelector('form').textContent.includes('Stale Ubuntu')), false)
  assert.equal(await submitDisabled(), false)
  await submit(); assert.equal(await page.eval(() => window.poolHarness.pending.findLast(item => item.kind === 'legacy-create').params.image), 'debian/low')
  await rejectAt(await last('legacy-create'), 'Fixture final create failure')
  // Within the same memory threshold, a pending image response remains valid for the latest resources.
  const memory = value => run(value => {
    const el = document.querySelectorAll('input[type="range"]')[1]
    el.value = String(value); el.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
  await memory(256); const supersededHost = await last('hosts'), compatibleImages = await last('images')
  await memory(384); assert.equal(await last('images'), compatibleImages)
  await rejectAt(supersededHost, 'Old host request failed')
  assert.equal(await submitDisabled(), true)
  await accept('hosts', { hosts: [{ id: 10, name: 'Legacy host', resources: { cpuAvailable: 100, memoryAvailable: 512 } }] })
  assert.equal(await submitDisabled(), true)
  await acceptAt(compatibleImages, { images: [{ remoteAlias: 'ubuntu/new', name: 'New Ubuntu' }, { remoteAlias: 'debian/low', name: 'Compatible Debian' }] })
  assert.equal(await submitDisabled(), false)
  await submit()
  const latestPayload = await page.eval(() => window.poolHarness.pending.findLast(item => item.kind === 'legacy-create').params)
  assert.equal(latestPayload.memory, 384); assert.equal(latestPayload.image, 'debian/low')
  await rejectAt(await last('legacy-create'), 'Fixture compatibility failure')
  await memory(448); await rejectAt(await last('hosts'), 'Current hosts unavailable')
  assert.equal(await submitDisabled(), true)
  const beforeHostFailureSubmit = await count('legacy-create'); await submit()
  assert.equal(await count('legacy-create'), beforeHostFailureSubmit)
  console.log('PASS legacy image/host refresh gates, current payload, old success/error/finally isolation, failed reads, compatible selection and same-threshold memory changes; controlled API.')
} finally { if (browser) await browser.close(); await server.close() }
