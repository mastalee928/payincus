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
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/host-single-actions/*.js']
const output = resolve(root, 'logs/host-single-actions'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const server = await createServer({ configFile: false, root: root + '/scripts/fixtures/host-single-actions', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/host-single-actions/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19687, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19687', { settleMs: 1600 })
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await page.eval(() => !!window.hostSingle?.pending.some(item => item.kind === 'list'))) break
    if (attempt === 99) throw new Error('host single action fixture did not mount')
    await sleep(150)
  }
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(90); return result }
  const last = kind => page.eval(kind => window.hostSingle.pending.findLastIndex(item => item.kind === kind), kind)
  const accept = (index, data) => run(({ index, data }) => window.hostSingle.pending[index].resolve(data), { index, data })
  const row = (id, hostId = 1) => ({ id, name: `Fixture instance ${id}`, hostId, status: 'running', image: 'debian/12', cpu: 1, memory: 512, disk: 10240, username: 'Fixture user', userId: 1, packagePlanId: 1, billingPrice: 10 })
  const list = (ids, hostId = 1, status = 'running') => ({ instances: ids.map(id => ({ ...row(id, hostId), status })), total: ids.length, totalPages: 1 })
  await accept(await last('list'), list([1, 2]))
  await run(() => { void window.hostSingle.view().syncSingleInstance(window.hostSingle.view().instances[0]) })
  const oldSync = await last('sync')
  await run(() => { window.hostSingle.state.id = 2 }); await accept(await last('list'), list([3], 2))
  const lists = await page.eval(() => window.hostSingle.pending.filter(item => item.kind === 'list').length)
  await accept(oldSync, { success: true, statusChanged: true, currentStatus: 'running' })
  assert.equal(await page.eval(() => window.hostSingle.pending.filter(item => item.kind === 'list').length), lists, 'old single sync must not reload another host')
  console.log('PASS old single sync receipt isolated')
  const view = key => page.eval(key => JSON.parse(JSON.stringify(window.hostSingle.view()[key])), key)
  const count = kind => page.eval(kind => window.hostSingle.pending.filter(item => item.kind === kind).length, kind)
  const reject = index => run(index => window.hostSingle.pending[index].reject(new Error('Fixture action failure')), index)
  const sync = (id = 3) => run(id => { const v = window.hostSingle.view(); void v.syncSingleInstance(v.instances.find(row => row.id === id)) }, id)
  const swap = (id = 3) => run(id => { const v = window.hostSingle.view(); void v.toggleInstanceSwap(v.instances.find(row => row.id === id)) }, id)
  const call = method => run(method => { void window.hostSingle.view()[method]() }, method)
  const status = { success: true, statusChanged: true, currentStatus: 'running' }
  const config = enabled => ({ swap: { available: true, enabled, sizeMb: 512 }, config: {}, overrides: {}, packageDefaults: {}, ioLimitMode: 'throughput' })
  const detail = async (enabled = false, id = 3) => { await accept(await last('config'), config(enabled)); await accept(await last('detail'), row(id, 2)) }
  await run(() => { window.hostSingle.confirmations = []; window.confirm = text => { window.hostSingle.confirmations.push(text); return true } })
  await sync(); const fixed = await last('sync'), syncCount = await count('sync'); await sync(); assert.equal(await count('sync'), syncCount)
  await accept(fixed, { ...status, success: false }); assert.ok((await view('singleActionErrors'))[3])
  await sync(); await reject(await last('sync')); assert.ok((await view('singleActionErrors'))[3])
  await sync(); const currentSync = await last('sync'); await call('loadInstances'); const priorList = await last('list')
  await accept(currentSync, status); const currentList = await last('list'); assert.notEqual(currentList, priorList)
  await accept(currentList, list([3], 2)); await accept(priorList, list([99], 2)); assert.deepEqual((await view('instances')).map(row => row.id), [3])

  await swap(); const swapReads = await count('config'); await swap(); assert.equal(await count('config'), swapReads, 'busy begins before config read')
  await detail(false); const enabling = await last('swap-enable'); assert.ok(enabling >= 0)
  assert.deepEqual(await page.eval(index => window.hostSingle.pending[index].params, enabling), { id: 3 })
  await swap(); assert.equal(await count('swap-enable'), 1)
  await accept(enabling, { swapEnabled: true, swapSize: 512 }); assert.equal((await view('instances'))[0].swapEnabled, true)
  await reject(await last('config')); await accept(await last('detail'), { ...row(3, 2), swapEnabled: true }); assert.deepEqual(await view('singleActionErrors'), {})
  await swap(); await detail(true); assert.ok(await last('swap-disable') >= 0)
  await accept(await last('swap-disable'), { swapEnabled: true, swapSize: 512 }); assert.ok((await view('singleActionErrors'))[3])
  await swap(); await detail(true); await reject(await last('swap-disable')); assert.ok((await view('singleActionErrors'))[3])
  await swap(); await detail(true); await accept(await last('swap-disable'), { swapEnabled: false, swapSize: 512 }); await detail(false)

  // A rejected refresh cannot authorize a toggle using an earlier cached config.
  await swap(); const beforeFailedRead = await count('swap-enable'); await reject(await last('config')); await accept(await last('detail'), row(3, 2))
  assert.equal(await count('swap-enable'), beforeFailedRead)
  await run(() => { window.confirm = () => false }); await swap(); await detail(false); assert.equal(await count('swap-enable'), beforeFailedRead)
  assert.deepEqual(await view('swapActionLoadingIds'), {})
  await run(() => { window.confirm = () => true })
  await swap(); const oldConfig = await last('config'), oldDetail = await last('detail')
  await run(() => { window.hostSingle.view().searchQuery = 'next'; void window.hostSingle.view().handleSearch() }); await accept(await last('list'), list([3], 2))
  await accept(oldConfig, config(false)); await accept(oldDetail, row(3, 2)); assert.equal(await count('swap-enable'), beforeFailedRead)

  await swap(); await detail(false); const cacheSwap = await last('swap-enable')
  await run(() => { window.hostSingle.state.active = false }); await run(() => { window.hostSingle.state.active = true }); await accept(await last('list'), list([3], 2))
  await accept(cacheSwap, { swapEnabled: true, swapSize: 512 }); assert.equal((await view('instances'))[0].swapEnabled, undefined)
  await sync(); const oldSession = await last('sync'); await run(() => window.hostSingle.session('b')); await accept(await last('list'), list([3], 2))
  await reject(oldSession); assert.deepEqual(await view('singleActionErrors'), {})
  await run(() => window.hostSingle.session('b', 2)); await swap(); await detail(false); const sameSession = await last('swap-enable')
  await call('loadInstances'); await accept(await last('list'), list([3], 2)); await accept(sameSession, { swapEnabled: true, swapSize: 512 }); assert.equal((await view('instances'))[0].swapEnabled, true); await detail(true)
  await swap(); await detail(true); const listPendingSwap = await last('swap-disable')
  await call('loadInstances'); const obsoleteSwapList = await last('list'); await accept(listPendingSwap, { swapEnabled: false, swapSize: 512 })
  const freshSwapList = await last('list'); assert.notEqual(freshSwapList, obsoleteSwapList)
  await accept(freshSwapList, { ...list([3], 2), instances: [{ ...row(3, 2), swapEnabled: false }] })
  await accept(obsoleteSwapList, { ...list([3], 2), instances: [{ ...row(3, 2), swapEnabled: true }] }); assert.equal((await view('instances'))[0].swapEnabled, false)
  await sync(); const sessionRefresh = await last('sync'); await run(() => window.hostSingle.session('b', 3)); await accept(sessionRefresh, status)
  await accept(await last('list'), list([3], 2))
  await swap(); const obsoleteConfig = await last('config'), obsoleteDetail = await last('detail')
  await run(() => { void window.hostSingle.view().loadInstanceDetailConfig(3, true) }); await detail(true)
  const writesBeforeObsolete = await count('swap-enable'); await accept(obsoleteConfig, config(false)); await accept(obsoleteDetail, row(3, 2))
  assert.equal(await count('swap-enable'), writesBeforeObsolete)

  await call('loadInstances'); await accept(await last('list'), list([3], 2, 'suspended'))
  const gatedReads = await count('config'); await swap(); assert.equal(await count('config'), gatedReads)
  await call('loadInstances'); await accept(await last('list'), { ...list([3], 2), instances: [{ ...row(3, 2), instanceType: 'vm' }] })
  await swap(); assert.equal(await count('config'), gatedReads)
  await run(() => { window.hostSingle.auth.user = { id: 1, username: 'fixture', role: 'user' } }); await accept(await last('list'), list([3], 2))
  await swap(); assert.equal(await count('config'), gatedReads, 'advanced swap routes are admin only')
  await run(() => { window.hostSingle.auth.user = { id: 1, username: 'fixture', role: 'admin' } }); await accept(await last('list'), list([3], 2))
  await sync(); await reject(await last('sync'))
  for (const [locale, width, dark, mobile] of [['zh-CN', 1440, false, false], ['en', 390, true, true]]) {
    await page.setViewport({ width, height: 1000, mobile })
    await run(({ locale, dark }) => { window.hostSingle.setLocale(locale); window.hostSingle.theme.setTheme(dark ? 'dark' : 'light') }, { locale, dark })
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: resolve(output, `${locale}-${width}.png`), format: 'png' })
  }
  await sync(); const logout = await last('sync'); await run(() => window.hostSingle.session(null)); await accept(logout, status)
  const loggedOut = await count('sync'); await run(() => { void window.hostSingle.view().syncSingleInstance({ id: 3 }) }); assert.equal(await count('sync'), loggedOut)
  await run(() => window.hostSingle.session('c')); await accept(await last('list'), list([3], 2)); await swap(); await detail(false)
  const unmounted = await last('swap-enable'); await run(() => { window.hostSingle.state.mounted = false }); await reject(unmounted)
  assert.deepEqual(await view('singleActionErrors'), {}); assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log('PASS fixed sync/swap, pre-read busy, fresh config/failure/cancel, success and stale receipts, role/status gates, host/query/session/cache/logout/unmount and both viewports')
} finally { if (browser) await browser.close(); await server.close() }
