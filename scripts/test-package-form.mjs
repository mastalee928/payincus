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
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/package-form/*.js']
const output = resolve(root, 'logs/package-form-browser')
mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const server = await createServer({ configFile: false, root: root + '/scripts/fixtures/package-form',
  plugins: [vue()], resolve: { alias: [
    { find: /^@\/api$/, replacement: root + '/scripts/fixtures/package-form/api.js' },
    { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) })),
  ], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19644, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch()
  const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19644', { settleMs: 1200 })
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(35); return result }
  const check = async (fn, label) => {
    for (let i = 0; i < 100; i++) { if (await page.eval(fn)) return; await sleep(50) }
    assert.fail(label + ': ' + await page.eval(() => document.body.innerText))
  }
  const latest = async kind => page.eval(kind => window.packageHarness.pending.findLastIndex(item => item.kind === kind), kind)
  const resolveRequest = async (index, data) => run(({ index, data }) => window.packageHarness.pending[index].resolve(data), { index, data })
  const rejectRequest = async index => run(index => window.packageHarness.pending[index].reject(new Error('isolated failure')), index)
  const routeTo = async path => run(path => window.packageHarness.router.push(path), path)
  const record = (id, name = `Package ${id}`, hostIds = []) => ({ package: { id, name, description: `Description ${id}`, host_ids: hostIds, ownerId: 1, active: true, instance_type: 'container' } })
  const name = () => page.eval(() => document.querySelector('form input[required]')?.value)
  const click = async selector => {
    const point = await page.eval(selector => { const el = document.querySelector(selector); el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } }, selector)
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 })
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 }); await sleep(50)
  }
  await check(() => window.packageHarness?.pending.some(item => item.kind === 'get'), 'detail starts without waiting for auxiliary lists')
  const first = await latest('get'), oldHosts = await latest('hosts'), oldList = await latest('list')
  await routeTo('/resources/packages/2/edit')
  const second = await latest('get')
  assert.equal(await page.eval(index => window.packageHarness.pending[index].signal.aborted, first), true)
  assert.equal(await page.eval(() => !!document.querySelector('form')), false)
  await resolveRequest(second, record(2)); assert.equal(await name(), 'Package 2')
  await resolveRequest(first, record(1)); assert.equal(await name(), 'Package 2')
  await resolveRequest(oldHosts, { hosts: [{ id: 9, name: 'Obsolete host' }] })
  await resolveRequest(oldList, { packages: [{ id: 9, name: 'Obsolete prerequisite', ownerId: 1 }] })
  assert.equal(await page.eval(() => document.body.innerText.includes('Obsolete')), false)

  await routeTo('/resources/packages/3/edit'); const third = await latest('get')
  await routeTo('/resources/packages/4/edit'); const fourth = await latest('get')
  await rejectRequest(third)
  assert.equal(await page.eval(() => window.packageHarness.router.currentRoute.value.params.id), '4')
  assert.equal(await page.eval(() => !!document.querySelector('form')), false, 'old finally must not remove current loading')
  await resolveRequest(fourth, record(4)); assert.equal(await name(), 'Package 4')
  await routeTo('/resources/packages/5/edit'); await rejectRequest(await latest('get'))
  assert.equal(await page.eval(() => window.packageHarness.router.currentRoute.value.params.id), '5')
  assert.equal(await page.eval(() => !!document.querySelector('[role=alert]')), true)
  assert.equal(await page.eval(() => !!document.querySelector('form')), false)
  await page.screenshot({ path: resolve(output, 'load-error-desktop.png'), format: 'png' })
  await click('[role=alert] button'); await resolveRequest(await latest('get'), record(5))
  assert.equal(await name(), 'Package 5')

  await routeTo('/resources/packages/6/edit'); const sixth = await latest('get')
  await run(() => window.packageHarness.newSession('session-b')); const newSession = await latest('get')
  await resolveRequest(sixth, record(6, 'Old session')); assert.equal(await page.eval(() => !!document.querySelector('form')), false)
  await resolveRequest(newSession, record(6, 'Current session'))
  await run(() => { const el = document.querySelector('input[required]'); el.value = 'Unsaved draft'; el.dispatchEvent(new Event('input', { bubbles: true })) })
  const countBefore = await page.eval(() => window.packageHarness.pending.length)
  await run(() => window.packageHarness.refreshSession('session-b'))
  assert.equal(await page.eval(() => window.packageHarness.pending.length), countBefore)
  assert.equal(await name(), 'Unsaved draft')

  await routeTo('/resources/packages/7/edit'); const seventh = await latest('get')
  await routeTo('/resources/packages/create'); await resolveRequest(seventh, record(7))
  assert.equal(await name(), '')
  await routeTo('/resources/packages/8/edit'); const eighth = await latest('get')
  await routeTo('/other'); await rejectRequest(eighth)
  assert.equal(await page.eval(() => window.packageHarness.router.currentRoute.value.path), '/other')
  await routeTo('/resources/packages/8/edit'); assert.notEqual(await latest('get'), eighth)
  await resolveRequest(await latest('get'), record(99, 'Wrong target'))
  assert.equal(await page.eval(() => !!document.querySelector('[role=alert]')), true)
  assert.equal(await page.eval(() => !!document.querySelector('form')), false)

  await routeTo('/resources/packages/9/edit'); await resolveRequest(await latest('get'), record(9, 'Pool old', [10]))
  const oldPool = await latest('pools')
  await routeTo('/resources/packages/10/edit'); await resolveRequest(await latest('get'), record(10, 'Pool new', [10]))
  const newPool = await latest('pools')
  await resolveRequest(newPool, { pools: [{ name: 'current-system', driver: 'dir', purpose: 'instance_data', status: 'Created', description: '' }] })
  await resolveRequest(oldPool, { pools: [{ name: 'obsolete-system', driver: 'dir', purpose: 'instance_data', status: 'Created', description: '' }] })
  assert.equal(await page.eval(() => document.body.innerText.includes('obsolete-system')), false)
  assert.equal(await name(), 'Pool new')
  await run(() => { window.packageHarness.auth.token = ''; window.packageHarness.auth.user = null })
  assert.equal(await page.eval(() => !!document.querySelector('form')), false)
  await run(() => { window.packageHarness.auth.user = { id: 1, username: 'fixture', role: 'admin' }; window.packageHarness.newSession('session-c') })
  await resolveRequest(await latest('get'), record(10, '可编辑套餐 / Editable package'))
  await resolveRequest(await latest('hosts'), { hosts: [] })
  await resolveRequest(await latest('list'), { packages: [] })
  const ready = async id => {
    await routeTo(`/resources/packages/${id}/edit`)
    await resolveRequest(await latest('get'), record(id, `Writable package ${id}`, [10]))
    await resolveRequest(await latest('pools'), { pools: [{ name: 'system', driver: 'dir', purpose: 'instance_data', status: 'Created', description: '' }] })
  }
  const submit = async (count = 1) => run(count => {
    const form = document.querySelector('form')
    for (let i = 0; i < count; i++) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  }, count)
  await ready(20)
  let beforeWrites = await page.eval(() => window.packageHarness.pending.filter(item => item.kind === 'update').length)
  await submit(10)
  assert.equal(await page.eval(() => window.packageHarness.pending.filter(item => item.kind === 'update').length), beforeWrites + 1)
  const failureSave = await latest('update')
  assert.equal(await page.eval(() => document.querySelector('input[required]').matches(':disabled')), true)
  assert.deepEqual(await page.eval(index => ({ id: window.packageHarness.pending[index].id, hostIds: [...window.packageHarness.pending[index].data.hostIds] }), failureSave), { id: 20, hostIds: [10] })
  await rejectRequest(failureSave)
  assert.equal(await name(), 'Writable package 20')
  assert.equal(await page.eval(() => document.querySelector('input[required]').matches(':disabled')), false)
  await submit(); const oldSave = await latest('update')
  await ready(21); await submit(); const currentSave = await latest('update')
  const toastCount = await page.eval(() => window.packageHarness.toast.toasts.value.length)
  await resolveRequest(oldSave, {})
  assert.equal(await page.eval(() => window.packageHarness.router.currentRoute.value.params.id), '21')
  assert.equal(await page.eval(() => window.packageHarness.toast.toasts.value.length), toastCount)
  assert.equal(await page.eval(() => document.querySelector('button[type=submit]').disabled), true, 'old finally cannot unlock new save')
  await rejectRequest(currentSave)
  assert.equal(await name(), 'Writable package 21')

  await submit(); const leavingSave = await latest('update')
  await routeTo('/other'); await resolveRequest(leavingSave, {})
  assert.equal(await page.eval(() => window.packageHarness.router.currentRoute.value.path), '/other')
  await ready(22); await submit(); const oldFailure = await latest('update')
  await ready(23); await submit(); const newerSave = await latest('update')
  await rejectRequest(oldFailure)
  assert.equal(await page.eval(() => !!document.querySelector('[role=alert]')), false)
  assert.equal(await page.eval(() => document.querySelector('button[type=submit]').disabled), true)
  await rejectRequest(newerSave)

  await submit(); const previousSessionSave = await latest('update')
  await run(() => window.packageHarness.newSession('session-d'))
  await resolveRequest(await latest('get'), record(23, 'New account session'))
  await resolveRequest(previousSessionSave, {})
  assert.equal(await name(), 'New account session')
  assert.equal(await page.eval(() => window.packageHarness.router.currentRoute.value.params.id), '23')
  await ready(24); await submit(); const normal = await latest('update')
  await run(() => window.packageHarness.refreshSession('session-d'))
  await resolveRequest(normal, {})
  assert.equal(await page.eval(() => window.packageHarness.router.currentRoute.value.path), '/resources/packages')

  await ready(25)
  await run(() => { window.packageHarness.removeGuard = window.packageHarness.router.beforeEach(to => to.name === 'my-packages' ? false : true) })
  await submit(); const latched = await latest('update')
  await resolveRequest(latched, {})
  beforeWrites = await page.eval(() => window.packageHarness.pending.filter(item => item.kind === 'update').length)
  await submit(10)
  assert.equal(await page.eval(() => window.packageHarness.pending.filter(item => item.kind === 'update').length), beforeWrites, 'confirmed save remains latched if navigation is aborted')
  await run(() => window.packageHarness.removeGuard())

  await routeTo('/resources/packages/create')
  await resolveRequest(await latest('hosts'), { hosts: [{ id: 10, name: 'Create fixture host', instanceType: 'container', status: 'online' }] })
  await resolveRequest(await latest('list'), { packages: [] })
  await run(() => {
    const el = document.querySelector('input[required]'); el.value = 'Created fixture'; el.dispatchEvent(new Event('input', { bubbles: true }))
    const host = [...document.querySelectorAll('button')].find(el => el.textContent.includes('Create fixture host')); host.click()
  })
  await resolveRequest(await latest('pools'), { pools: [{ name: 'system', driver: 'dir', purpose: 'instance_data', status: 'Created', description: '' }] })
  await submit(10)
  assert.equal(await page.eval(() => window.packageHarness.pending.filter(item => item.kind === 'create').length), 1)
  await resolveRequest(await latest('create'), {})
  assert.equal(await page.eval(() => window.packageHarness.router.currentRoute.value.path), '/resources/packages')

  await ready(26)
  await resolveRequest(await latest('hosts'), { hosts: [] })
  await resolveRequest(await latest('list'), { packages: [] })
  for (const [locale, width, dark] of [['zh-CN', 1440, false], ['zh-TW', 390, true], ['en', 390, false]]) {
    await page.setViewport({ width, height: 900 })
    await run(({ locale, dark }) => { window.packageHarness.setLocale(locale); window.packageHarness.theme.setTheme(dark ? 'dark' : 'light') }, { locale, dark })
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'form fits viewport')
    await page.screenshot({ path: resolve(output, `${locale}-${width}.png`), format: 'png' })
  }
  console.log('PASS real Chrome/Vue Router package form: read lifecycle matrix plus 10-submit gate, frozen inputs, target/host snapshot, failed-save retry, old success/error/finally vs new saves, leave/session changes, same-SID refresh, confirmed-save latch and normal create/edit navigation; three locales and desktop/mobile. API transport is a deferred fixture; no real host/package writes.')
} finally {
  if (browser) await browser.close()
  await server.close()
}
