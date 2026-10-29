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
const output = resolve(root, 'logs/host-migrate-reads'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js')
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/host-migrate/*.js']
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/host-migrate', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/host-migrate/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19700, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19700', { settleMs: 1400 })
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await page.eval(() => !!window.migrateHarness)) break
    if (attempt === 199) throw Error('host migrate fixture did not mount: ' + page.consoleErrors.join('\n'))
    await sleep(150)
  }
  const run = async (fn, arg) => { const value = await page.eval(fn, arg); await sleep(90); return value }
  const last = kind => page.eval(kind => window.migrateHarness.pending.findLastIndex(item => item.kind === kind), kind)
  const accept = (index, data) => run(({ index, data }) => window.migrateHarness.pending[index].resolve(data), { index, data })
  const hosts = (items, page = 1, total = items.length) => ({ hosts: items, total, page, pageSize: 100, totalPages: Math.ceil(total / 100) })
  await run(() => { window.migrateHarness.state.visible = true })
  await accept(await last('hosts'), hosts([{ id: 2, name: 'target-two', status: 'online' }, { id: 3, name: 'target-three', status: 'online' }]))
  await run(() => { window.migrateHarness.view().targetHostId = 2 }); const oldImages = await last('images'), oldPlans = await last('plans')
  await run(() => { window.migrateHarness.view().targetHostId = 3 })
  await accept(await last('images'), { success: true, images: [{ id: 3, name: 'current-image', remoteAlias: 'fixture/current', architecture: 'x86_64', instanceType: 'container', osType: 'ubuntu', icon: 'ubuntu' }] })
  await accept(await last('plans'), { plans: [{ id: 3, name: 'current-plan', packageId: 3, packageName: 'current-package', price: 1, billingCycle: 1 }] })
  await accept(oldImages, { success: true, images: [{ id: 2, name: 'old-image', remoteAlias: 'fixture/old', architecture: 'x86_64', instanceType: 'container', osType: 'ubuntu', icon: 'ubuntu' }] })
  await accept(oldPlans, { plans: [{ id: 2, name: 'old-plan', packageId: 2, packageName: 'old-package', price: 1, billingCycle: 1 }] })
  assert.equal(await page.eval(() => window.migrateHarness.view().targetImage), 'fixture/current', 'old target images cannot overwrite selected destination')
  assert.deepEqual(await page.eval(() => window.migrateHarness.view().plans.map(plan => plan.id)), [3], 'old target plans cannot overwrite selected destination')
  console.log('PASS migrate destination reads')
  const read = key => page.eval(key => JSON.parse(JSON.stringify(window.migrateHarness.view()[key])), key)
  const count = kind => page.eval(kind => window.migrateHarness.pending.filter(item => !kind || item.kind === kind).length, kind)
  const reject = index => run(index => window.migrateHarness.pending[index].reject(new Error('fixture migrate read failed')), index)
  const host = id => ({ id, name: `fixture-host-${id}`, status: 'online' })
  const image = id => ({ id, name: `fixture-image-${id}`, remoteAlias: `fixture/image-${id}`, architecture: 'x86_64', instanceType: 'container', osType: 'ubuntu', icon: 'ubuntu' })
  const plan = id => ({ id, name: `fixture-plan-${id}`, packageId: id, packageName: `fixture-package-${id}`, price: 100, billingCycle: 1 })
  const refresh = kind => run(kind => { const v = window.migrateHarness.view(); void v[kind === 'hosts' ? 'loadHosts' : kind === 'images' ? 'loadImages' : 'loadPlans'](v.targetHostId) }, kind)
  assert.equal(await count('hosts'), 1, 'opening starts one host read')
  await refresh('hosts'); const paginated = await last('hosts')
  await accept(paginated, hosts(Array.from({ length: 100 }, (_, i) => host(i + 100)), 1, 101))
  assert.equal(await read('loadingHosts'), true); assert.equal(await page.eval(() => window.migrateHarness.pending.at(-1).params.page), 2)
  await accept(await last('hosts'), hosts([host(200)], 2, 101)); assert.equal((await read('hosts')).length, 101)
  await run(() => { window.migrateHarness.view().targetHostId = 200 }); await accept(await last('images'), { success: true, images: [image(1), image(2)] }); await accept(await last('plans'), { plans: [plan(1), plan(2)] })
  await run(() => { const v = window.migrateHarness.view(); v.targetImage = 'fixture/image-2'; v.targetPlanId = 2; void v.loadImages(200); void v.loadPlans(200) })
  await accept(await last('images'), { success: true, images: [image(1), image(2)] }); await accept(await last('plans'), { plans: [plan(1), plan(2)] })
  assert.equal(await read('targetImage'), 'fixture/image-2'); assert.equal(await read('targetPlanId'), 2)
  await refresh('images'); const firstImage = await last('images'); await refresh('images'); const currentImage = await last('images')
  await reject(firstImage); assert.equal(await read('loadingImages'), true)
  await accept(currentImage, { success: true, images: [image(3)] }); assert.equal(await read('targetImage'), 'fixture/image-3')
  await refresh('plans'); const firstPlan = await last('plans'); await refresh('plans'); await accept(await last('plans'), { plans: [plan(3)] }); await reject(firstPlan)
  assert.deepEqual((await read('plans')).map(plan => plan.id), [3]); assert.equal(await read('plansError'), '')
  await run(() => { window.migrateHarness.view().targetHostId = 100 }); const old100 = await last('images')
  await run(() => { window.migrateHarness.view().targetHostId = 101 }); const old101 = await last('images')
  await run(() => { window.migrateHarness.view().targetHostId = 100 }); const new100 = await last('images')
  await accept(old100, { success: true, images: [image(99)] }); await reject(old101); assert.equal(await read('loadingImages'), true)
  await accept(new100, { success: true, images: [image(4)] }); await accept(await last('plans'), { plans: [plan(4)] })
  for (const kind of ['images', 'plans', 'hosts']) {
    await refresh(kind); await reject(await last(kind)); assert.match(await read(`${kind}Error`), /fixture migrate read failed/)
    assert.equal(await read('canSubmit'), false)
    await run(kind => document.querySelector(`[data-${kind}-error] button`).click(), kind)
    await accept(await last(kind), kind === 'hosts' ? hosts([host(2), host(3)]) : kind === 'images' ? { success: true, images: [image(5)] } : { plans: [plan(5)] })
    assert.equal(await read(`${kind}Error`), '')
  }
  console.log('PASS multi-page hosts, target ABA, same-target ordering, selection preservation and persistent retry')
  await run(() => { window.migrateHarness.view().targetHostId = 2 }); await accept(await last('images'), { success: true, images: [image(1)] }); await accept(await last('plans'), { plans: [plan(1)] })
  for (const [kind, malformed] of [['hosts', {}], ['hosts', hosts([host(2), host(2)])], ['images', { success: false, images: [image(1)] }], ['images', { success: true, images: [image(1), image(1)] }], ['plans', { plans: [{ ...plan(1), price: -1 }] }], ['plans', { plans: [plan(1), plan(1)] }]]) {
    if (kind !== 'hosts') { await refresh('hosts'); await accept(await last('hosts'), hosts([host(2), host(3)])); await run(() => { window.migrateHarness.view().targetHostId = 2 }) }
    await refresh(kind); await accept(await last(kind), malformed); assert.notEqual(await read(`${kind}Error`), ''); assert.equal(await read('canSubmit'), false)
  }
  for (const change of ['source', 'session', 'role', 'account', 'logout', 'cache', 'unmount', 'close']) {
    await refresh('hosts'); await accept(await last('hosts'), hosts([host(2), host(3)])); await run(() => { window.migrateHarness.view().targetHostId = 2 })
    const stale = { hosts: -1, images: await last('images'), plans: await last('plans') }
    await refresh('hosts'); stale.hosts = await last('hosts')
    const toasts = await page.eval(() => window.migrateHarness.toastEvents.length)
    await run(change => { const h = window.migrateHarness
      if (change === 'source') h.state.id = 10
      if (change === 'session') h.session('b')
      if (change === 'role') h.auth.user = { ...h.auth.user, role: 'user' }
      if (change === 'account') h.auth.user = { ...h.auth.user, id: 2 }
      if (change === 'logout') h.session(null)
      if (change === 'cache') h.state.active = false
      if (change === 'unmount') h.state.mounted = false
      if (change === 'close') h.view().closeModal()
    }, change)
    await accept(stale.hosts, hosts([host(99)])); await accept(stale.images, { success: true, images: [image(99)] }); await reject(stale.plans)
    assert.deepEqual(await read('hosts'), [], `${change} old hosts rejected`); assert.deepEqual(await read('images'), []); assert.equal(await page.eval(() => window.migrateHarness.toastEvents.length), toasts)
    await run(() => { const h = window.migrateHarness; h.state.id = 1; h.auth.user = { id: 1, username: 'fixture', role: 'admin' }; h.session('a'); h.state.active = true; h.state.mounted = true; h.state.visible = true })
    await accept(await last('hosts'), hosts([host(2), host(3)]))
  }
  const beforeSid = await count(); await run(() => window.migrateHarness.session('a', 2)); assert.equal(await count(), beforeSid)
  await run(() => { const h = window.migrateHarness; h.view().closeModal() }); await run(() => { window.migrateHarness.state.visible = true })
  await accept(await last('hosts'), hosts([host(2), host(3)])); await run(() => { window.migrateHarness.view().targetHostId = 3 }); await accept(await last('images'), { success: true, images: [image(7)] }); await accept(await last('plans'), { plans: [plan(7)] })
  await sleep(400); assert.equal(await read('targetImage'), 'fixture/image-7', 'old close timer cannot clear reopened form')
  await run(() => { const h = window.migrateHarness; h.state.selectedIds = [2]; h.state.instances = [{ id: 2, name: 'later-selected', packagePlanId: null }] })
  assert.equal(await read('hasPaidInstances'), true, 'paid requirement stays with opening snapshot'); assert.deepEqual((await read('selectedSnapshot')).map(item => item.id), [1])
  await run(() => { const v = window.migrateHarness.view(); v.targetImage = 'unknown-image'; v.targetPlanId = 7; void v.handleSubmit() }); assert.equal(await count('migrate'), 0)
  for (const id of [0, -1, 1.5, 9007199254740992]) {
    const before = await count(); await run(id => { window.migrateHarness.state.id = id }, id); await refresh('hosts'); assert.equal(await count(), before)
  }
  await run(() => { window.migrateHarness.state.id = 1 }); await accept(await last('hosts'), hosts([host(2), host(3)])); await run(() => { window.migrateHarness.view().targetHostId = 2 }); await reject(await last('images'))
  for (const [locale, width, dark, mobile] of [['zh-CN', 1440, false, false], ['en', 390, true, true]]) {
    await page.setViewport({ width, height: 1000, mobile }); await run(({ locale, dark }) => { window.migrateHarness.setLocale(locale); window.migrateHarness.theme.setTheme(dark ? 'dark' : 'light') }, { locale, dark })
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: resolve(output, `${locale}-${width}.png`), format: 'png' })
  }
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log('PASS migrate read session, lifecycle, validation, fixed selection, close/reopen and viewport matrix')
} finally { if (browser) await browser.close(); await server.close() }
