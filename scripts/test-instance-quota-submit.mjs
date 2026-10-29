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
const output = resolve(root, 'logs/instance-quota-submit'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js')
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/instance-detail/*.js']
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/instance-detail', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/instance-detail/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19695, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19695', { settleMs: 1400 })
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await page.eval(() => !!window.detailHarness?.pending.length)) break
    if (attempt === 199) throw Error('quota editor fixture did not mount: ' + page.consoleErrors.join('\n'))
    await sleep(150)
  }
  const run = async (fn, arg) => { const value = await page.eval(fn, arg); await sleep(90); return value }
  const last = kind => page.eval(kind => window.detailHarness.pending.findLastIndex(item => item.kind === kind), kind)
  const accept = (index, data) => run(({ index, data }) => window.detailHarness.pending[index].resolve(data), { index, data })
  const data = (id = 1, port = 5, snapshot = 3) => ({ id, name: 'Fixture quota editor', status: 'stopped', cpu: 100, memory: 512, disk: 2048,
    host_id: 10, user_id: 1, network_mode: 'nat', image: 'debian/12', ipv4: '10.0.0.2', package_id: null,
    isHostOwner: true, host: { name: 'Fixture host', user_id: 2 }, port_limit: port, snapshot_limit: snapshot,
    port_mappings: [{ id: 1 }, { id: 2 }], quota_usage: { port: 1, snapshot: 2 },
    remaining_quota: { port: (port ?? 0) - 1, snapshot: (snapshot ?? 0) - 2 } })
  const finish = async () => {
    for (const kind of ['task', 'traffic']) { const index = await last(kind); if (index >= 0) await accept(index, kind === 'task' ? { task: null } : null) }
  }
  const reject = index => run(index => window.detailHarness.pending[index].reject(new Error('fixture quota request failed')), index)
  let nextId = 1
  const mount = async (overrides = {}) => {
    const id = nextId++
    if (id !== 1) await run(id => window.detailHarness.router.push(`/instances/${id}`), id)
    const value = { ...data(id), quota_usage: { port: 0, snapshot: 0 }, ...overrides }
    await accept(await last('instance'), { instance: value }); await finish()
    await run(() => { window.detailHarness.view().activeTab = 'quota' })
    await accept(await last('instance'), { instance: value }); await accept(await last('snapshots'), []); await finish()
    return value
  }
  const saveCount = () => page.eval(() => window.detailHarness.pending.filter(item => item.kind === 'quota-save').length)
  const submit = form => run(form => {
    if (form) window.detailHarness.view().instanceQuotaForm = form
    void window.detailHarness.view().saveInstanceQuota()
  }, form)
  const form = () => page.eval(() => ({ ...window.detailHarness.view().instanceQuotaForm }))
  const error = () => page.eval(() => window.detailHarness.view().quotaError)
  const toastCount = () => page.eval(() => window.detailHarness.toastEvents.length)
  const payload = () => page.eval(() => window.detailHarness.pending.findLast(item => item.kind === 'quota-save').data)
  const succeed = async value => {
    await accept(await last('quota-save'), { message: 'Instance quota updated' })
    await accept(await last('instance'), { instance: value }); await accept(await last('snapshots'), []); await finish()
    assert.equal(await page.eval(() => window.detailHarness.view().quotaSaving), false)
  }
  let value = await mount()
  await submit({ portLimit: 5, snapshotLimit: 0 })
  assert.notEqual(await last('quota-save'), -1, 'zero snapshot quota must submit when no snapshots exist')
  assert.deepEqual(await payload(), { snapshotLimit: 0 }, 'only changed fields are submitted')
  await succeed({ ...value, snapshot_limit: 0 })
  assert.equal(await error(), '')
  console.log('PASS zero snapshot quota reaches the current quota API')

  for (const input of [null, '', '   ']) {
    value = await mount()
    await submit({ portLimit: input, snapshotLimit: input })
    assert.deepEqual(await payload(), { portLimit: null, snapshotLimit: null })
    await succeed({ ...value, port_limit: null, snapshot_limit: null })
    assert.deepEqual(await form(), { portLimit: null, snapshotLimit: null })
  }
  for (const [field, inputs] of [['portLimit', [0, -1, 1001, 1.5, '3x', '1e2', '0x10', '1.5', undefined]], ['snapshotLimit', [-1, 1001, 0.5, '2x', 'Infinity', undefined]]]) {
    await mount()
    for (const input of inputs) {
      const count = await saveCount()
      await submit({ portLimit: 5, snapshotLimit: 3, [field]: input })
      assert.equal(await saveCount(), count, `reject ${field}=${input}`)
      assert.notEqual(await error(), '')
    }
  }
  for (const expression of ['NaN', 'Infinity', '-Infinity']) {
    const count = await saveCount()
    await run(expression => {
      window.detailHarness.view().instanceQuotaForm = { portLimit: expression === 'NaN' ? NaN : expression === 'Infinity' ? Infinity : -Infinity, snapshotLimit: 3 }
      void window.detailHarness.view().saveInstanceQuota()
    }, expression)
    assert.equal(await saveCount(), count, `reject ${expression} without turning it into null`)
  }
  value = await mount({ quota_usage: { port: 2, snapshot: 2 } })
  for (const draft of [{ portLimit: null, snapshotLimit: 3 }, { portLimit: 1, snapshotLimit: 3 }, { portLimit: 5, snapshotLimit: null }, { portLimit: 5, snapshotLimit: 0 }, { portLimit: 5, snapshotLimit: 1 }]) {
    const count = await saveCount(); await submit(draft)
    assert.equal(await saveCount(), count, 'real quota usage prevents reductions despite empty snapshot list')
    assert.notEqual(await error(), '')
  }
  await submit({ portLimit: '1000', snapshotLimit: '1000' })
  assert.deepEqual(await payload(), { portLimit: 1000, snapshotLimit: 1000 })
  await succeed({ ...value, port_limit: 1000, snapshot_limit: 1000 })
  value = await mount({ port_limit: 0, dedicatedIpv4: true })
  await submit({ portLimit: 0, snapshotLimit: 0 })
  assert.deepEqual(await payload(), { snapshotLimit: 0 }, 'dedicated port zero remains untouched when editing snapshots')
  await succeed({ ...value, snapshot_limit: 0 })
  console.log('PASS null, empty, complete integers, range, actual usage and unchanged dedicated port quota')

  value = await mount()
  await run(() => { const input = document.querySelector('#instance-quota-port'); input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); input.focus() })
  await page.send('Input.insertText', { text: 'e' }); await sleep(90)
  assert.equal(await page.eval(() => Number.isNaN(window.detailHarness.view().instanceQuotaForm.portLimit)), true, 'real Chrome incomplete input is retained as invalid instead of null')
  const beforeBadInput = await saveCount(); await submit()
  assert.equal(await saveCount(), beforeBadInput, 'incomplete native number cannot clear quota')
  assert.notEqual(await error(), '')

  value = await mount()
  await run(() => {
    const port = document.querySelector('#instance-quota-port'), snapshot = document.querySelector('#instance-quota-snapshot')
    port.value = ''; port.dispatchEvent(new Event('input', { bubbles: true }))
    snapshot.value = '0'; snapshot.dispatchEvent(new Event('input', { bubbles: true }))
    document.querySelector('#instance-quota-help').parentElement.querySelector('button').click()
  })
  assert.deepEqual(await payload(), { portLimit: null, snapshotLimit: 0 }, 'native inputs and save button use the same validation')
  assert.equal(await page.eval(() => document.querySelector('#instance-quota-help').parentElement.querySelector('button').disabled), true)
  const savedIndex = await last('quota-save'), count = await saveCount()
  await run(() => { window.detailHarness.view().instanceQuotaForm = { portLimit: 9, snapshotLimit: 4 }; void window.detailHarness.view().saveInstanceQuota() })
  assert.equal(await saveCount(), count, 'duplicate direct calls cannot submit')
  assert.deepEqual(await payload(), { portLimit: null, snapshotLimit: 0 }, 'later draft cannot alter pending request')
  await run(() => { void window.detailHarness.view().loadInstance() }); const oldRead = await last('instance')
  await accept(savedIndex, { message: 'Instance quota updated' })
  await accept(await last('instance'), { instance: { ...value, port_limit: null, snapshot_limit: 0 } }); await accept(await last('snapshots'), []); await finish()
  await accept(oldRead, { instance: value })
  assert.deepEqual(await form(), { portLimit: 9, snapshotLimit: 4 }, 'new draft survives successful save and refresh')
  assert.equal(await page.eval(() => window.detailHarness.view().instance.snapshot_limit), 0, 'older poll cannot overwrite saved state')
  await submit(); await reject(await last('quota-save'))
  assert.notEqual(await error(), '', 'failure is persistent')
  assert.equal(await page.eval(() => document.querySelector('[role="alert"]')?.textContent.includes('fixture quota request failed')), true)
  assert.deepEqual(await form(), { portLimit: 9, snapshotLimit: 4 })
  await submit(); await succeed({ ...value, port_limit: 9, snapshot_limit: 4 })
  assert.equal(await error(), '')
  console.log('PASS native input, fixed payload, duplicate guard, later drafts, old reads and failure retry')

  value = await mount(); await submit({ portLimit: 6, snapshotLimit: 4 })
  const beforeSuccessToasts = await toastCount()
  await accept(await last('quota-save'), { message: 'Instance quota updated' })
  await reject(await last('instance')); await reject(await last('snapshots')); await finish()
  assert.equal(await error(), '', 'auxiliary refresh failure does not report a committed write as failed')
  assert.equal(await toastCount(), beforeSuccessToasts + 1)
  assert.equal(await page.eval(() => window.detailHarness.view().instance.port_limit), 6)
  assert.equal(await page.eval(() => window.detailHarness.view().quotaSaving), false)

  for (const change of ['route', 'session', 'role', 'account', 'logout', 'host', 'owner', 'incus', 'permission', 'unmount']) {
    value = await mount()
    await submit({ portLimit: 6, snapshotLimit: 4 })
    const oldSave = await last('quota-save'), before = await toastCount(), beforeCount = await saveCount()
    if (change === 'route') await mount()
    else await run(change => {
      const h = window.detailHarness
      if (change === 'session') h.session('b')
      if (change === 'role') h.auth.user = { ...h.auth.user, role: 'admin' }
      if (change === 'account') h.auth.user = { ...h.auth.user, id: 9 }
      if (change === 'logout') h.session(null)
      if (change === 'host') h.view().instance.host_id = 11
      if (change === 'owner') h.view().instance.user_id = 11
      if (change === 'incus') h.view().instance.incus_id = 'replacement'
      if (change === 'permission') h.view().instance.isHostOwner = false
      if (change === 'unmount') return h.router.push('/other')
    }, change)
    await run(() => { void window.detailHarness.view()?.saveInstanceQuota() })
    assert.equal(await saveCount(), beforeCount, `${change} does not permit duplicate in-flight writes`)
    const requests = await page.eval(() => window.detailHarness.pending.length)
    if (['route', 'role', 'host', 'incus', 'unmount'].includes(change)) await accept(oldSave, { message: 'Instance quota updated' })
    else await reject(oldSave)
    assert.equal(await toastCount(), before, `${change} ignores old success/failure`)
    assert.equal(await page.eval(() => window.detailHarness.pending.length), requests, `${change} old receipt cannot start new reads`)
    if (change !== 'unmount') assert.equal(await page.eval(() => window.detailHarness.view().quotaSaving), false)
    await run(() => { const h = window.detailHarness; h.auth.user = { id: 1, username: 'fixture', role: 'user' }; h.session('a') })
  }
  value = await mount(); await submit({ portLimit: 6, snapshotLimit: 4 })
  await run(() => { window.detailHarness.session('a', 2) })
  await succeed({ ...value, port_limit: 6, snapshot_limit: 4 })
  assert.equal(await error(), '', 'same session token refresh keeps write current')

  for (const change of ['host', 'permission', 'session']) {
    await mount(); await submit({ portLimit: 6, snapshotLimit: 4 })
    const oldSave = await last('quota-save'), before = await toastCount()
    await run(change => {
      const h = window.detailHarness
      if (change === 'host') { h.view().instance.host_id = 11; h.view().instance.host_id = 10 }
      if (change === 'permission') { h.view().instance.isHostOwner = false; h.view().instance.isHostOwner = true }
      if (change === 'session') h.session('b')
    }, change)
    if (change === 'session') await run(() => { window.detailHarness.session('a') })
    await accept(oldSave, { message: 'Instance quota updated' })
    assert.equal(await toastCount(), before, `${change} ABA cannot make an old write current again`)
  }
  await run(() => { window.detailHarness.auth.user = { id: 1, username: 'fixture', role: 'admin' } })
  value = await mount({ isHostOwner: false })
  await submit({ portLimit: 6, snapshotLimit: 4 })
  assert.deepEqual(await payload(), { portLimit: 6, snapshotLimit: 4 }, 'administrator can manage quotas without host ownership')
  await succeed({ ...value, port_limit: 6, snapshot_limit: 4 })
  await run(() => { window.detailHarness.auth.user = { id: 1, username: 'fixture', role: 'user' } })

  await mount({ isHostOwner: false, isInstanceOwner: true, dedicatedIpv4: true })
  let before = await saveCount(); await submit({ portLimit: 6, snapshotLimit: 4 })
  assert.equal(await saveCount(), before, 'ordinary instance owner cannot edit host quotas even by direct call')
  assert.equal(await page.eval(() => !!document.querySelector('#instance-quota-port')), false)
  await mount()
  await run(() => { window.detailHarness.view().activeTab = 'info' })
  before = await saveCount(); await submit({ portLimit: 6, snapshotLimit: 4 })
  assert.equal(await saveCount(), before, 'hidden form cannot submit')
  console.log('PASS current role, target, route, session, logout and unmount boundaries')

  value = await mount()
  await submit({ portLimit: 6, snapshotLimit: 4 }); await accept(await last('quota-save'), {})
  assert.notEqual(await error(), '', 'malformed acknowledgement does not show success')
  for (const [locale, width, dark, mobile] of [['zh-CN', 1440, false, false], ['en', 390, true, true]]) {
    await page.setViewport({ width, height: 1000, mobile })
    await run(({ locale, dark }) => { window.detailHarness.setLocale(locale); window.detailHarness.theme.setTheme(dark ? 'dark' : 'light') }, { locale, dark })
    await submit({ portLimit: 6, snapshotLimit: -1 })
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
    assert.equal(await page.eval(() => document.querySelector('label[for="instance-quota-port"]')?.control?.id), 'instance-quota-port')
    await page.screenshot({ path: resolve(output, `${locale}-${width}.png`), format: 'png' })
  }
  const unexpected = page.consoleErrors.filter(line => !line.includes('fixture quota request failed') && !line.includes('Failed to load instance:') && !line.includes('Failed to load snapshots:'))
  assert.equal(unexpected.length, 0, unexpected.join('\n'))
  console.log('PASS quota submit complete browser matrix and both viewports')
} finally { if (browser) await browser.close(); await server.close() }
