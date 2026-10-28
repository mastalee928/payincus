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
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/vip-reward-editor/*.js']
const output = resolve(root, 'logs/vip-reward-editor-browser'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const server = await createServer({ configFile: false, root: root + '/scripts/fixtures/vip-reward-editor', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api(?:\/admin)?$/, replacement: root + '/scripts/fixtures/vip-reward-editor/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19657, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19657/', { settleMs: 1200 })
  const deadline = Date.now() + 15000
  while (!await page.eval(() => !!window.vipHarness?.pending.some(item => item.kind === 'rewards'))) {
    if (Date.now() >= deadline) throw Error('VIP editor did not load within 15 seconds')
    await sleep(100)
  }
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(60); return result }
  const accept = (kind, data) => run(({ kind, data }) => window.vipHarness.pending.findLast(item => item.kind === kind).resolve(data), { kind, data })
  const count = kind => page.eval(kind => window.vipHarness.pending.filter(item => item.kind === kind).length, kind)
  const reject = (kind, message) => run(({ kind, message }) => window.vipHarness.pending.findLast(item => item.kind === kind).reject(new Error(message)), { kind, message })
  const effectCount = () => page.eval(() => window.vipHarness.toastEvents.length)
  const click = key => run(key => {
    const button = [...document.querySelectorAll('button')].find(el => el.checkVisibility() && el.textContent.trim() === window.vipHarness.t(key))
    if (!button) throw Error('Missing button ' + key)
    button.click()
  }, key)
  const amount = value => run(value => { const el = document.querySelector('article input[step="0.01"]'); el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })) }, value)
  const reward = { id: 1, level: 1, type: 'balance', title: 'Fixture reward', description: null, claimLimit: 1, sortOrder: 0, enabled: false, config: { amount: 12 } }
  const load = async (items = [reward], packages = []) => { await accept('rules', { rules: [{ level: 1, enabled: true }], userMetric: 'totalRecharge' }); await accept('packages', { packages }); await accept('rewards', { rewards: items }) }
  const reset = async (items = [reward], packages = []) => {
    await run(() => { window.vipHarness.state.editorVisible = false })
    await run(() => { window.vipHarness.state.editorVisible = true })
    await load(items, packages)
  }
  const titles = () => page.eval(() => [...document.querySelectorAll('article input[maxlength="80"]')].map(el => el.value))
  const setTitle = (index, title) => run(({ index, title }) => {
    const input = document.querySelectorAll('article input[maxlength="80"]')[index]
    input.value = title; input.dispatchEvent(new Event('input', { bubbles: true }))
  }, { index, title })
  await load()
  const beforeBurst = await count('update')
  await run(() => {
    const button = [...document.querySelectorAll('button')].find(el => el.textContent.trim() === window.vipHarness.t('admin.vipBenefits.save'))
    for (let i = 0; i < 10; i++) button.click()
  })
  assert.equal(await count('update'), beforeBurst + 1, 'synchronous repeated clicks must submit only once')
  assert.equal(await page.eval(() => [...document.querySelectorAll('fieldset input, fieldset select, fieldset textarea, fieldset button')].every(el => el.matches(':disabled'))), true, 'whole form freezes while saving')
  await accept('update', { reward }); await load()
  const beforeInvalidAmounts = await count('update')
  for (const value of ['0.0001', '0.004', '0', '-1', '100000000']) {
    await amount(value); await click('admin.vipBenefits.save'); assert.equal(await count('update'), beforeInvalidAmounts, `invalid normalized amount ${value}`)
  }
  for (const [value, expected] of [['0.005', 0.01], ['0.01', 0.01], ['12.345', 12.35], ['99999999.99', 99999999.99]]) {
    const before = await count('update'); await amount(value); await click('admin.vipBenefits.save')
    assert.equal(await count('update'), before + 1)
    assert.equal(await page.eval(() => window.vipHarness.pending.findLast(item => item.kind === 'update').params.data.config.amount), expected)
    await accept('update', { reward: { ...reward, config: { amount: expected } } }); await load()
  }

  // Deletion and creation are separate writes. A failed batch must not replay them blindly.
  await reset([reward, { ...reward, id: 2, title: 'Second existing' }])
  await click('common.delete')
  await click('admin.vipBenefits.addReward'); await click('admin.vipBenefits.addReward')
  await run(() => { for (const el of document.querySelectorAll('article input[step="0.01"]')) { el.value = '20'; el.dispatchEvent(new Event('input', { bubbles: true })) } })
  await setTitle(1, 'First new'); await setTitle(2, 'Second new snapshot')
  const beforeCreate = await count('create'), beforeDelete = await count('delete')
  await click('admin.vipBenefits.save')
  assert.equal(await count('delete'), beforeDelete + 1)
  await accept('delete', { success: true }); await accept('update', { reward: { ...reward, id: 2 } })
  assert.equal(await count('create'), beforeCreate + 1)
  await setTitle(2, 'Queued synthetic input must not change the snapshot')
  await accept('create', { reward: { ...reward, id: 30, title: 'First new' } })
  assert.equal(await count('create'), beforeCreate + 2)
  assert.equal(await page.eval(() => window.vipHarness.pending.findLast(item => item.kind === 'create').params.data.title), 'Second new snapshot')
  await reject('create', 'Fixture connection lost after possible write')
  assert.ok(await page.eval(() => document.querySelector('[role="alert"]').textContent.includes('Fixture connection lost')))
  await click('admin.vipBenefits.save')
  assert.equal(await count('create'), beforeCreate + 2, 'uncertain create cannot be resubmitted')
  assert.equal(await count('delete'), beforeDelete + 1, 'completed deletion cannot be resubmitted')
  await click('admin.vipBenefits.reloadSaved')
  const stored = [{ ...reward, id: 2 }, { ...reward, id: 30, title: 'First new' }, { ...reward, id: 31, title: 'Server saved second despite lost response' }]
  await load(stored)
  assert.deepEqual(await titles(), stored.map(item => item.title))
  await click('admin.vipBenefits.save')
  for (const item of stored) await accept('update', { reward: item })
  await load(stored)
  assert.equal(await count('create'), beforeCreate + 2, 'server-created rows are updated after recovery')
  assert.equal(await count('delete'), beforeDelete + 1)

  // All writes succeeded, but reloading failed: do not report complete success or send again.
  await reset(); const effectsBeforeReloadFailure = await effectCount()
  await click('admin.vipBenefits.save'); await accept('update', { reward })
  await reject('rewards', 'Fixture reload failed')
  await accept('rules', { rules: [], userMetric: 'totalRecharge' }); await accept('packages', { packages: [] })
  assert.equal(await effectCount(), effectsBeforeReloadFailure)
  const writesAfterFailure = await count('update'); await click('admin.vipBenefits.save')
  assert.equal(await count('update'), writesAfterFailure)
  await click('admin.vipBenefits.reloadSaved'); await load()

  // Initial errors are persistent and do not render a writable empty configuration.
  await run(() => { window.vipHarness.state.editorVisible = false })
  await run(() => { window.vipHarness.state.editorVisible = true })
  await reject('rules', 'Fixture initial read failed')
  assert.equal(await page.eval(() => document.querySelectorAll('article').length), 0)
  assert.ok(await page.eval(() => document.querySelector('[role="alert"]').textContent.includes('Fixture initial read failed')))
  await click('common.retry'); await load()

  // Same-session token rotation keeps the draft; a new session clears and reloads.
  await setTitle(0, 'Unsaved draft')
  const readsBeforeRotation = await count('rewards')
  await run(() => { window.vipHarness.auth.token += '-rotated' })
  assert.equal(await count('rewards'), readsBeforeRotation)
  assert.deepEqual(await titles(), ['Unsaved draft'])
  await run(() => { window.vipHarness.session('b') })
  assert.equal(await count('rewards'), readsBeforeRotation + 1)
  const oldReads = await page.eval(() => ['rules', 'rewards', 'packages'].map(kind => window.vipHarness.pending.findLastIndex(item => item.kind === kind)))
  await run(() => { window.vipHarness.session('c') }); await load([{ ...reward, title: 'New session' }])
  const beforeStale = await effectCount()
  await run(indices => {
    const pending = window.vipHarness.pending
    pending[indices[0]].reject(new Error('Stale session read'))
    pending[indices[1]].resolve({ rewards: [] }); pending[indices[2]].resolve({ packages: [] })
  }, oldReads)
  assert.deepEqual(await titles(), ['New session']); assert.equal(await effectCount(), beforeStale)

  // KeepAlive re-entry during a write must wait for its settlement and stop the old batch.
  await reset([reward, { ...reward, id: 2 }]); await click('admin.vipBenefits.save')
  const writesBeforeLeave = await count('update'), readsBeforeLeave = await count('rewards')
  await run(() => window.vipHarness.router.push('/other'))
  await run(() => window.vipHarness.router.push('/rewards'))
  assert.equal(await count('rewards'), readsBeforeLeave, 'no stale read while cached write is in flight')
  const beforeOldWrite = await effectCount()
  await accept('update', { reward })
  assert.equal(await count('update'), writesBeforeLeave, 'old batch stops before next reward')
  assert.equal(await count('rewards'), readsBeforeLeave + 1)
  await load([{ ...reward, title: 'Read after settled write' }])
  assert.deepEqual(await titles(), ['Read after settled write']); assert.equal(await effectCount(), beforeOldWrite)

  // A retired instance cannot toast, continue the batch, or reload its replacement.
  await reset([reward, { ...reward, id: 2 }]); await click('admin.vipBenefits.save')
  const retiredWrite = await page.eval(() => window.vipHarness.pending.findLastIndex(item => item.kind === 'update'))
  await reset([{ ...reward, title: 'Replacement editor' }])
  const replacementReads = await count('rewards'), replacementWrites = await count('update'), replacementEffects = await effectCount()
  await run(index => window.vipHarness.pending[index].resolve({ reward: { id: 1 } }), retiredWrite)
  assert.deepEqual(await titles(), ['Replacement editor'])
  assert.equal(await count('rewards'), replacementReads); assert.equal(await count('update'), replacementWrites); assert.equal(await effectCount(), replacementEffects)

  // Late package-plan success/error/finally cannot overwrite a new session's options or busy state.
  const instance = { ...reward, type: 'instance', config: { packageId: 10, planId: 101, days: 30, quantity: 1 } }
  const packageList = [{ id: 10, name: 'Fixture package', active: 1 }]
  await reset([instance], packageList)
  const stalePlan = await page.eval(() => window.vipHarness.pending.findLastIndex(item => item.kind === 'plans'))
  await run(() => window.vipHarness.session('plans')); await load([instance], packageList)
  await run(index => window.vipHarness.pending[index].reject(new Error('Stale plan error')), stalePlan)
  assert.equal(await page.eval(() => document.querySelectorAll('article').length), 0, 'stale finally cannot end new loading')
  await accept('plans', { plans: [{ id: 101, name: 'Current plan', price: 12 }] })
  assert.ok(await page.eval(() => [...document.querySelectorAll('option')].some(el => el.textContent.includes('Current plan'))))
  await run(() => { window.vipHarness.auth.token = ''; window.vipHarness.auth.user = null })
  assert.equal(await page.eval(() => document.querySelectorAll('article').length), 0)
  await run(() => { window.vipHarness.auth.user = { id: 1, role: 'admin' }; window.vipHarness.session('final') }); await load()
  for (const locale of ['zh-CN', 'zh-TW', 'en-US']) for (const width of [1440, 390]) {
    await run(({ locale, width }) => { window.vipHarness.setLocale(locale); window.vipHarness.theme.setTheme(width === 390 ? 'dark' : 'light') }, { locale, width })
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width === 390 })
    await page.screenshot({ path: resolve(output, `${locale}-${width}.png`) })
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
  }
  console.log('PASS actual VIP admin editor: amount boundaries, synchronous submission gate/frozen form/snapshots, partial create-delete recovery and lost response, reload failure, initial retry, session rotation/isolation, KeepAlive write settlement, unmount and plan races; 3 locales desktop/mobile. Controlled API, no reward claims.')
} finally { if (browser) await browser.close(); await server.close() }
