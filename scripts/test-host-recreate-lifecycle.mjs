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
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/host-recreate-lifecycle/*.js']
const output = resolve(root, 'logs/host-recreate-lifecycle'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const server = await createServer({ configFile: false, root: root + '/scripts/fixtures/host-recreate-lifecycle', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/host-recreate-lifecycle/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19686, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19686', { settleMs: 1600 })
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(90); return result }
  const last = kind => page.eval(kind => window.hostRecreate.pending.findLastIndex(item => item.kind === kind), kind)
  const accept = (index, data) => run(({ index, data }) => window.hostRecreate.pending[index].resolve(data), { index, data })
  const row = (id, hostId = 1) => ({ id, name: `Fixture instance ${id}`, hostId, status: 'running', image: 'debian/12', cpu: 1, memory: 512, disk: 10240, username: 'Fixture user', userId: 1, packagePlanId: 1, billingPrice: 10 })
  const list = (ids, hostId = 1, status = 'running') => ({ instances: ids.map(id => ({ ...row(id, hostId), status })), total: ids.length, totalPages: 1 })
  await accept(await last('list'), list([1, 2]))
  await run(() => { void window.hostRecreate.view().openRecreateModal(window.hostRecreate.view().instances[0]) })
  const oldImages = await last('images'), oldKeys = await last('keys')
  await run(() => { window.hostRecreate.state.id = 2 }); await accept(await last('list'), list([3], 2))
  await accept(oldImages, { success: true, images: [{ remoteAlias: 'debian/12', name: 'Debian 12', icon: 'debian' }] })
  await accept(oldKeys, { keys: [{ id: 1, name: 'Fixture key' }] })
  assert.equal(await page.eval(() => window.hostRecreate.view().showRecreateModal), false, 'old image/key response must not reopen recreate on another host')
  console.log('PASS old recreate preparation cannot reopen another host')
  const view = key => page.eval(key => JSON.parse(JSON.stringify(window.hostRecreate.view()[key])), key)
  const count = kind => page.eval(kind => window.hostRecreate.pending.filter(item => item.kind === kind).length, kind)
  const reject = index => run(index => window.hostRecreate.pending[index].reject(new Error('Fixture recreate failure')), index)
  const call = method => run(method => { void window.hostRecreate.view()[method]() }, method)
  const open = id => run(id => { const v = window.hostRecreate.view(); void v.openRecreateModal(v.instances.find(row => row.id === id)) }, id)
  const close = () => run(() => window.hostRecreate.view().handleRecreateModalVisibleChange(false))
  const images = (alias = 'debian/12') => ({ success: true, images: [{ remoteAlias: alias, name: 'Debian 12', icon: 'debian' }] })
  const keys = (id = 1) => ({ keys: [{ id, name: `Fixture key ${id}` }] })
  const ready = async (id = 3) => { await open(id); await accept(await last('images'), images()); await accept(await last('keys'), keys()) }
  const data = { image: 'debian/12', sshKeyId: 1 }
  const submit = (payload = data) => run(payload => { void window.hostRecreate.view().doRecreate(payload) }, payload)
  const queued = { taskId: 1, status: 'PENDING' }
  await ready(); assert.equal(await view('showRecreateModal'), true)
  await close(); const closedWrites = await count('recreate'); await submit(); assert.equal(await count('recreate'), closedWrites)

  // Concurrent preparation A -> B -> A must not mix image/key lists or old failures.
  await call('loadInstances'); await accept(await last('list'), list([3, 4], 2))
  await open(3); const aImages = await last('images'), aKeys = await last('keys'), reads = await count('images')
  await open(3); assert.equal(await count('images'), reads)
  await open(4); const bImages = await last('images'), bKeys = await last('keys')
  await open(3); const latestImages = await last('images'), latestKeys = await last('keys')
  await accept(latestKeys, keys(2)); await accept(latestImages, images('alpine/3.20'))
  await accept(bImages, images('ubuntu/24.04')); await reject(bKeys)
  await accept(aImages, images()); await accept(aKeys, keys())
  assert.equal((await view('recreateTarget')).id, 3); assert.equal((await view('availableImages'))[0].incusAlias, 'alpine/3.20')
  assert.equal((await view('sshKeys'))[0].id, 2); assert.equal(await view('recreateError'), '')
  await close(); await open(3); const closingImages = await last('images'), closingKeys = await last('keys')
  await close(); await accept(closingImages, images()); await accept(closingKeys, keys()); assert.equal(await view('showRecreateModal'), false)

  await open(3); const failedSibling = await last('keys'); await reject(await last('images'))
  assert.ok(await view('recreateError')); assert.equal(await view('recreatePreparing'), false)
  await accept(failedSibling, keys(9)); assert.deepEqual(await view('sshKeys'), [])
  await open(3); await accept(await last('images'), { success: false, images: [] }); await accept(await last('keys'), keys())
  assert.equal(await view('showRecreateModal'), false); assert.ok(await view('recreateError'))
  await open(3); await accept(await last('images'), images()); await accept(await last('keys'), { keys: [] })
  const emptyCount = await count('recreate'); await submit(); assert.equal(await count('recreate'), emptyCount)
  assert.equal(await page.eval(() => document.querySelector('body > .fixed.inset-0 button.btn-danger').disabled), true); await close()
  await ready(); assert.equal(await view('recreateError'), '')

  const invalidCount = await count('recreate')
  for (const payload of [{ ...data, image: 'unknown' }, { ...data, sshKeyId: 999 }, { ...data, sshKeyId: 1.2 },
    { ...data, customInitCommandIds: [0] }, { ...data, customInitCommandIds: Array(21).fill(1) }]) {
    await submit(payload); assert.equal(await count('recreate'), invalidCount)
  }
  await run(() => {
    const payload = { image: 'debian/12', sshKeyId: 1, customInitCommandIds: [7] }
    void window.hostRecreate.view().doRecreate(payload); payload.customInitCommandIds.push(8)
  })
  const write = await last('recreate')
  assert.deepEqual(await page.eval(index => window.hostRecreate.pending[index].params, write), { id: 3, image: 'debian/12', sshKeyId: 1, customInitCommandIds: [7] })
  await submit(); assert.equal(await count('recreate'), invalidCount + 1)
  await accept(write, { taskId: 0, status: 'PENDING' }); assert.ok(await view('recreateError')); assert.equal(await view('showRecreateModal'), true)
  await submit(); await reject(await last('recreate')); assert.ok(await view('recreateError'))
  await submit(); const refreshing = await last('recreate')
  await call('loadInstances'); const oldList = await last('list'); await accept(refreshing, queued)
  assert.equal(await view('showRecreateModal'), false); const newList = await last('list'); assert.notEqual(newList, oldList)
  await accept(newList, list([3, 4], 2)); await accept(oldList, list([99], 2)); assert.deepEqual((await view('instances')).map(row => row.id), [3, 4])

  await ready(); await submit(); const hiddenWrite = await last('recreate'); await close(); await open(4)
  assert.equal(await view('showRecreateModal'), false); assert.equal(await view('recreatePreparing'), false)
  await reject(hiddenWrite); assert.equal(await view('recreateError'), ''); assert.equal(await view('recreateLoading'), false)
  await ready(); await call('loadInstances'); await accept(await last('list'), list([3, 4], 2, 'suspended'))
  const suspendedCount = await count('recreate'); await submit(); assert.equal(await count('recreate'), suspendedCount)
  assert.equal(await page.eval(() => document.querySelector('body > .fixed.inset-0 button.btn-danger').disabled), true)
  await close(); const suspendedReads = await count('images'); await open(3); assert.equal(await count('images'), suspendedReads)
  await call('loadInstances'); await accept(await last('list'), { ...list([3, 4], 2), instances: [ { ...row(3, 2), userId: 2 }, row(4, 2) ] })
  await open(3); assert.equal(await count('images'), suspendedReads)
  await call('loadInstances'); await accept(await last('list'), list([3, 4], 2))

  await open(3); const queryImages = await last('images'), queryKeys = await last('keys')
  await run(() => { window.hostRecreate.view().searchQuery = 'next'; void window.hostRecreate.view().handleSearch() })
  await accept(await last('list'), list([3, 4], 2)); await accept(queryImages, images()); await accept(queryKeys, keys())
  assert.equal(await view('showRecreateModal'), false)
  await ready(); await run(() => window.hostRecreate.session('a', 2)); assert.equal(await view('showRecreateModal'), true)
  await submit(); const sessionWrite = await last('recreate'); await run(() => window.hostRecreate.session('b')); await accept(await last('list'), list([3, 4], 2))
  await reject(sessionWrite); assert.equal(await view('recreateError'), '')
  await open(3); const sessionImages = await last('images'), sessionKeys = await last('keys'); await run(() => window.hostRecreate.session('c'))
  await accept(await last('list'), list([3, 4], 2)); await reject(sessionImages); await accept(sessionKeys, keys()); assert.equal(await view('recreateError'), '')
  await ready(); await submit(); const cachedWrite = await last('recreate')
  await run(() => { window.hostRecreate.state.active = false }); await run(() => { window.hostRecreate.state.active = true })
  await accept(await last('list'), list([3, 4], 2)); await accept(cachedWrite, queued); assert.equal(await view('showRecreateModal'), false)
  await open(3); const cacheImages = await last('images'), cacheKeys = await last('keys')
  await run(() => { window.hostRecreate.state.active = false }); await run(() => { window.hostRecreate.state.active = true })
  await accept(await last('list'), list([3, 4], 2)); await accept(cacheImages, images()); await accept(cacheKeys, keys())
  assert.equal(await view('showRecreateModal'), false)
  await ready(); await submit(); const hostWrite = await last('recreate'); await run(() => { window.hostRecreate.state.id = 1 })
  await accept(await last('list'), list([1, 2])); await accept(hostWrite, queued); assert.equal(await view('showRecreateModal'), false)

  await ready(1); await call('loadInstances'); await accept(await last('list'), list([1, 2]))
  await run(() => { document.querySelector('body > .fixed.inset-0 button.btn-danger').click(); document.querySelector('body > .fixed.inset-0 button.btn-danger').click() })
  await reject(await last('recreate')); assert.ok(await view('recreateError'))
  for (const [locale, width, dark, mobile] of [['zh-CN', 1440, false, false], ['en', 390, true, true]]) {
    await page.setViewport({ width, height: 1000, mobile })
    await run(({ locale, dark }) => { window.hostRecreate.setLocale(locale); window.hostRecreate.theme.setTheme(dark ? 'dark' : 'light') }, { locale, dark })
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: resolve(output, `${locale}-${width}.png`), format: 'png' })
  }
  await submit(); const logout = await last('recreate'); await run(() => window.hostRecreate.session(null)); await reject(logout)
  assert.equal(await view('recreateError'), ''); const loggedOut = await count('recreate'); await submit(); assert.equal(await count('recreate'), loggedOut)
  await run(() => window.hostRecreate.session('d')); await accept(await last('list'), list([1, 2])); await ready(1); await submit()
  const unmounted = await last('recreate'); await run(() => { window.hostRecreate.state.mounted = false }); await accept(unmounted, queued)
  assert.equal(await view('recreateLoading'), false); assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log('PASS preparation ABA, fixed target/options, duplicate gates, ownership/suspension, errors/retry, same-page refresh, host/query/session/cache/logout/unmount and both viewports')
} finally { if (browser) await browser.close(); await server.close() }
