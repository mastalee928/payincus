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
const output = resolve(root, 'logs/host-storage-reads'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js')
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/host-storage/*.js']
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/host-storage', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/host-storage/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19696, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19696', { settleMs: 1400 })
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await page.eval(() => !!window.storageHarness?.pending.length)) break
    if (attempt === 199) throw Error('host storage fixture did not mount: ' + page.consoleErrors.join('\n'))
    await sleep(150)
  }
  const run = async (fn, arg) => { const value = await page.eval(fn, arg); await sleep(90); return value }
  const last = () => page.eval(() => window.storageHarness.pending.length - 1)
  const accept = (index, data) => run(({ index, data }) => window.storageHarness.pending[index].resolve(data), { index, data })
  const pool = name => ({ name, driver: 'lvm', description: 'Fixture storage pool', status: 'Created', config: {}, usedBy: 0, purpose: 'instance_data', space: { used: 2 ** 30, total: 10 * 2 ** 30 } })
  const first = await last()
  await run(() => { window.storageHarness.state.id = 2 })
  await accept(await last(), { pools: [pool('current-host')] })
  await accept(first, { pools: [pool('obsolete-host')] })
  assert.deepEqual(await page.eval(() => window.storageHarness.view().pools.map(pool => pool.name)), ['current-host'], 'old host response cannot overwrite the selected host')
  console.log('PASS storage current host response stays visible')
  const reject = index => run(index => window.storageHarness.pending[index].reject(new Error('fixture storage read failed')), index)
  const refresh = () => run(() => { void window.storageHarness.view().loadPools() })
  const names = () => page.eval(() => window.storageHarness.view().pools.map(pool => pool.name))
  const read = key => page.eval(key => window.storageHarness.view()[key], key)
  const requests = () => page.eval(() => window.storageHarness.pending.length)
  assert.equal(await requests(), 2, 'mounted and activated only read once')
  await refresh(); const old = await last(); await refresh(); const current = await last()
  await accept(current, { pools: [pool('latest')] }); await reject(old)
  assert.deepEqual(await names(), ['latest']); assert.equal(await read('loadError'), ''); assert.equal(await read('loading'), false)
  await run(() => { window.storageHarness.state.id = 3 }); const firstThree = await last()
  await run(() => { window.storageHarness.state.id = 4 }); const four = await last()
  await run(() => { window.storageHarness.state.id = 3 }); const newThree = await last()
  await accept(firstThree, { pools: [pool('obsolete-ABA')] }); await reject(four)
  assert.equal(await read('loading'), true); assert.deepEqual(await names(), [])
  await accept(newThree, { pools: [pool('host-three')] })
  await refresh(); await reject(await last())
  assert.deepEqual(await names(), []); assert.match(await read('loadError'), /fixture storage read failed/)
  assert.equal(await page.eval(() => !!document.querySelector('[role="alert"] button')), true)
  await run(() => document.querySelector('[role="alert"] button').click())
  await accept(await last(), { pools: [pool('retry')] }); assert.equal(await read('loadError'), '')
  console.log('PASS same-host ordering, host ABA, error persistence and visible retry')
  for (const malformed of [{}, { pools: null }, { pools: [pool('duplicate'), pool('duplicate')] }, { pools: [{ ...pool('broken'), config: null }] }, { pools: [{ ...pool('broken'), usedBy: -1 }] }]) {
    await refresh(); await accept(await last(), malformed)
    assert.notEqual(await read('loadError'), ''); assert.deepEqual(await names(), [])
  }
  for (const kind of ['session', 'role', 'account', 'logout', 'cache', 'unmount']) {
    await refresh(); const old = await last(), before = await page.eval(() => window.storageHarness.toastEvents.length)
    await run(kind => {
      const h = window.storageHarness
      h.view().showCreateModal = true; h.view().showEditModal = true
      if (kind === 'session') h.session('b')
      if (kind === 'role') h.auth.user = { ...h.auth.user, role: 'user' }
      if (kind === 'account') h.auth.user = { ...h.auth.user, id: 2 }
      if (kind === 'logout') h.session(null)
      if (kind === 'cache') h.state.active = false
      if (kind === 'unmount') h.state.mounted = false
    }, kind)
    assert.deepEqual(await names(), [], `${kind} clears old list`)
    assert.equal(await read('showCreateModal'), false); assert.equal(await read('showEditModal'), false)
    if (['session', 'account', 'cache'].includes(kind)) await accept(old, { pools: [pool('obsolete')] }); else await reject(old)
    assert.deepEqual(await names(), []); assert.equal(await page.eval(() => window.storageHarness.toastEvents.length), before)
    await run(() => { const h = window.storageHarness; h.auth.user = { id: 1, username: 'fixture', role: 'admin' }; h.session('a'); h.state.active = true; h.state.mounted = true })
    await accept(await last(), { pools: [pool('restored')] })
  }
  const beforeToken = await requests()
  await run(() => { window.storageHarness.session('a', 2) }); assert.equal(await requests(), beforeToken, 'same session refresh does not reset list')
  for (const id of [0, -1, 1.5, 9007199254740992]) {
    const count = await requests(); await run(id => { window.storageHarness.state.id = id }, id); await refresh()
    assert.equal(await requests(), count, 'invalid host ID never reaches API')
  }
  await run(() => { window.storageHarness.state.id = 10 }); await accept(await last(), { pools: [], warning: 'Fixture registered data only' })
  assert.equal(await page.eval(() => document.body.innerText.includes('Fixture registered data only')), true, 'empty fallback still displays warning')
  await refresh(); await accept(await last(), { pools: [{ ...pool('current-storage'), status: 'Unavailable', space: null }], warning: 'Fixture: Incus unavailable. Showing registered storage pools.' })
  assert.equal(await page.eval(() => !!document.querySelector('[role="status"]')), true)
  console.log('PASS response validation, session/logout/cache/unmount, IDs and fallback warning')
  for (const [locale, width, dark, mobile] of [['zh-CN', 1440, false, false], ['en', 390, true, true]]) {
    await page.setViewport({ width, height: 1000, mobile })
    await run(({ locale, dark }) => { window.storageHarness.setLocale(locale); window.storageHarness.theme.setTheme(dark ? 'dark' : 'light') }, { locale, dark })
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: resolve(output, `${locale}-${width}.png`), format: 'png' })
  }
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log('PASS storage read browser matrix and both viewports')
} finally { if (browser) await browser.close(); await server.close() }
