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
const output = resolve(root, 'logs/vip-level-rules-browser'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const server = await createServer({ configFile: false, root: root + '/scripts/fixtures/vip-reward-editor', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api(?:\/admin)?$/, replacement: root + '/scripts/fixtures/vip-reward-editor/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19659, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19659/?rules', { settleMs: 1200 })
  const deadline = Date.now() + 15000
  while (!await page.eval(() => !!window.vipHarness?.pending.some(item => item.kind === 'rules'))) {
    if (Date.now() >= deadline) throw Error('VIP rules editor did not load within 15 seconds')
    await sleep(100)
  }
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(60); return result }
  const count = kind => page.eval(kind => window.vipHarness.pending.filter(item => item.kind === kind).length, kind)
  const last = kind => page.eval(kind => window.vipHarness.pending.findLastIndex(item => item.kind === kind), kind)
  const acceptAt = (index, data) => run(({ index, data }) => window.vipHarness.pending[index].resolve(data), { index, data })
  const accept = async (kind, data) => acceptAt(await last(kind), data)
  const rejectAt = (index, message) => run(({ index, message }) => window.vipHarness.pending[index].reject(new Error(message)), { index, message })
  const click = key => run(key => {
    const button = [...document.querySelectorAll('button')].find(el => el.checkVisibility() && el.textContent.trim() === window.vipHarness.t(key))
    if (!button) throw Error('Missing button ' + key)
    button.click()
  }, key)
  await rejectAt(await last('rules'), 'Fixture initial read failed')
  await click('admin.vipRules.save')
  assert.equal(await count('saveRules'), 0, 'failed initial read must never send empty replacement rules')
  assert.ok(await page.eval(() => document.querySelector('[role="alert"]').textContent.includes('Fixture initial read failed')))
  const rule = { type: 'user', level: 1, enabled: true, conditionMode: 'any', minRecharge: 50, minConsume: null, minHostingIncome: null, minHostingInstances: null, benefits: {} }
  const response = (type = 'user', changes = {}) => ({ type, maxLevel: 10, userMetric: 'totalRecharge', rules: [{ ...rule, type, ...changes }] })
  const visibleInputs = () => page.eval(() => [...document.querySelectorAll('input[type="number"]')].filter(input => input.checkVisibility()).map(input => input.value))
  const effects = () => page.eval(() => window.vipHarness.toastEvents.length)
  await click('common.retry'); await accept('rules', response())
  assert.equal((await visibleInputs())[0], '50')
  await run(() => {
    const button = [...document.querySelectorAll('button')].find(el => el.textContent.trim() === window.vipHarness.t('admin.vipRules.save'))
    for (let i = 0; i < 10; i++) button.click()
  })
  assert.equal(await count('saveRules'), 1, 'synchronous duplicate saves are blocked')
  assert.equal(await page.eval(() => [...document.querySelectorAll('input, select')].every(el => el.matches(':disabled'))), true)
  assert.deepEqual(await page.eval(() => window.vipHarness.pending.findLast(item => item.kind === 'saveRules').params.options), { userMetric: 'totalRecharge' })
  await accept('saveRules', response('user', { minRecharge: 75 }))
  assert.equal((await visibleInputs())[0], '75')
  await click('admin.vipRules.save'); await rejectAt(await last('saveRules'), 'Fixture save failure')
  assert.equal((await visibleInputs())[0], '75', 'save error preserves current draft')
  await click('admin.vipRules.save'); await accept('saveRules', response('user', { minRecharge: 90 }))
  assert.equal((await visibleInputs())[0], '90')

  // User and hosting share a component: old reads and writes cannot cross the rule type.
  await run(() => { window.vipHarness.state.ruleType = 'hosting' }); const staleHosting = await last('rules')
  await run(() => { window.vipHarness.state.ruleType = 'user' }); await accept('rules', response('user', { minRecharge: 125 }))
  await acceptAt(staleHosting, response('hosting', { minHostingIncome: 999 }))
  assert.equal((await visibleInputs())[0], '125')
  const beforeTypeSaveEffects = await effects()
  await click('admin.vipRules.save'); const oldUserSave = await last('saveRules'), beforeTypeWriteReads = await count('rules')
  await run(() => { window.vipHarness.state.ruleType = 'hosting' })
  assert.equal(await count('rules'), beforeTypeWriteReads, 'type switch waits for in-flight write')
  await acceptAt(oldUserSave, response('user', { minRecharge: 150 }))
  assert.equal(await count('rules'), beforeTypeWriteReads + 1)
  await accept('rules', response('hosting', { minRecharge: null, minHostingIncome: 300, minHostingInstances: 2 }))
  assert.deepEqual((await visibleInputs()).slice(0, 2), ['300', '2'])
  assert.equal(await effects(), beforeTypeSaveEffects)
  await click('admin.vipRules.save')
  assert.equal(await page.eval(() => window.vipHarness.pending.findLast(item => item.kind === 'saveRules').params.type), 'hosting')
  assert.equal(await page.eval(() => window.vipHarness.pending.findLast(item => item.kind === 'saveRules').params.options), undefined)
  await accept('saveRules', response('hosting', { minHostingIncome: 325, minHostingInstances: 2 }))

  // Initial failure, retry, cached return, session rotation and stale replies are independent.
  const readsBeforeToken = await count('rules')
  await run(() => { window.vipHarness.auth.token += '-rotated' })
  assert.equal(await count('rules'), readsBeforeToken)
  await run(() => { window.vipHarness.session('b') }); const oldSessionRead = await last('rules')
  await run(() => { window.vipHarness.session('c') }); await accept('rules', response('hosting', { minHostingIncome: 400, minHostingInstances: 3 }))
  const beforeStaleEffects = await effects()
  await rejectAt(oldSessionRead, 'Retired session failure')
  assert.equal((await visibleInputs())[0], '400'); assert.equal(await effects(), beforeStaleEffects)
  await run(() => window.vipHarness.router.push('/other'))
  await run(() => window.vipHarness.router.push('/rewards')); await accept('rules', response('hosting', { minHostingIncome: 500, minHostingInstances: 4 }))
  assert.equal((await visibleInputs())[0], '500')
  await click('admin.vipRules.save'); const retiredSave = await last('saveRules')
  await run(() => { window.vipHarness.state.editorVisible = false })
  await run(() => { window.vipHarness.state.editorVisible = true }); await accept('rules', response('hosting', { minHostingIncome: 600, minHostingInstances: 5 }))
  const readsBeforeRetired = await count('rules'), effectsBeforeRetired = await effects()
  await acceptAt(retiredSave, response('hosting', { minHostingIncome: 1 }))
  assert.equal((await visibleInputs())[0], '600')
  assert.equal(await count('rules'), readsBeforeRetired); assert.equal(await effects(), effectsBeforeRetired)
  await run(() => { window.vipHarness.auth.token = ''; window.vipHarness.auth.user = null })
  assert.deepEqual(await visibleInputs(), [])
  await run(() => { window.vipHarness.auth.user = { id: 2, role: 'admin' }; window.vipHarness.session('d') })
  await accept('rules', response('hosting', { minHostingIncome: 700, minHostingInstances: 7 }))
  for (const locale of ['zh-CN', 'zh-TW', 'en-US']) for (const width of [1440, 390]) {
    await run(({ locale, width }) => { window.vipHarness.setLocale(locale); window.vipHarness.theme.setTheme(width === 390 ? 'dark' : 'light') }, { locale, width })
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width === 390 })
    await page.screenshot({ path: resolve(output, `${locale}-${width}.png`) })
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
  }
  console.log('PASS actual VIP rule editor: failed initial read cannot replace configuration, retry, duplicate gate/freeze, normalized save, error preserves draft, user/hosting type and session isolation, KeepAlive, old unmounted write, logout; 3 locales desktop/mobile. Controlled API, no rule changes on a server.')
} finally { if (browser) await browser.close(); await server.close() }
