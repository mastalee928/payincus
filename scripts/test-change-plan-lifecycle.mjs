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
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/change-plan/*.js']
const output = resolve(root, 'logs/change-plan-lifecycle'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const server = await createServer({ configFile: false, root: root + '/scripts/fixtures/change-plan', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/change-plan/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19667, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19667', { settleMs: 1200 })
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(70); return result }
  const last = kind => page.eval(kind => window.changePlanHarness.pending.findLastIndex(item => item.kind === kind), kind)
  const count = kind => page.eval(kind => window.changePlanHarness.pending.filter(item => item.kind === kind).length, kind)
  const accept = (index, data) => run(({ index, data }) => window.changePlanHarness.pending[index].resolve(data), { index, data })
  const reject = index => run(index => window.changePlanHarness.pending[index].reject(new Error('fixture error')), index)
  const view = key => page.eval(key => JSON.parse(JSON.stringify(window.changePlanHarness.view()[key])), key)
  const select = id => run(id => { window.changePlanHarness.view().selectedPlanId = id }, id)
  const toggle = show => run(show => { window.changePlanHarness.state.show = show }, show)
  const submit = () => run(() => { void window.changePlanHarness.view().handleChangePlan() })
  const plan = (id, price = id * 1000) => ({ id, name: `Plan ${id}`, description: null, price, billingCycle: 1, cpu: id * 100, memory: 1024, disk: 10240,
    portLimit: 5, snapshotLimit: 5, backupLimit: 5, siteLimit: 5, swapSize: 0, monthlyTrafficLimit: null, isActive: true, isSoldOut: false })
  const quote = (id, extra = {}) => ({ preview: { oldPlan: plan(1), newPlan: plan(id), remainingDays: 20, oldDailyPrice: 1, newDailyPrice: 2,
    remainingValue: 20, newPlanCost: 40, discountRate: 0, discountAmount: 0, priceDiff: 20, isUpgrade: true, newExpiresAt: '2030-01-01T00:00:00Z',
    newConfig: { cpu: 200, memory: 1024, disk: 10240 }, resourceWarnings: null, canChange: true, ...extra } })
  const finishPlans = async () => { await accept(await last('plans'), { plans: [plan(1), plan(2), plan(3)] }); await accept(await last('balance'), { balance: { balance: 1000 } }) }
  const reopen = async () => { await toggle(false); await toggle(true) }
  const quoted = async (id = 2) => { await select(null); await select(id); await accept(await last('preview'), quote(id)) }
  await toggle(true); await finishPlans()
  await select(2); await accept(await last('preview'), quote(2))
  await select(3); const newPreview = await last('preview')
  await submit()
  assert.equal(await count('change'), 0, 'changing the choice must not submit using the previous preview while new quote is loading')
  await select(2); const latestPreview = await last('preview')
  await accept(newPreview, quote(3))
  assert.equal(await view('preview'), null, 'old preview cannot replace the selected plan')
  assert.equal(await view('loadingPreview'), true)
  await accept(latestPreview, quote(2)); assert.equal((await view('preview')).newPlan.id, 2)
  assert.equal(await view('canSubmit'), true)
  await select(3); const staleError = await last('preview'); await select(2); const currentPreview = await last('preview')
  await reject(staleError); assert.equal(await view('loadingPreview'), true); assert.equal(await view('error'), '')
  assert.equal(await page.eval(() => [...document.querySelectorAll('button')].at(-1).disabled), true)
  await accept(currentPreview, quote(2))
  await select(3); const oldAba = await last('preview'); await select(2); await select(3)
  await accept(oldAba, quote(3)); assert.equal(await view('preview'), null); assert.equal(await view('loadingPreview'), true)
  await accept(await last('preview'), quote(3))
  await select(2); await accept(await last('preview'), quote(3)); assert.equal(await view('canSubmit'), false); assert.ok(await view('error'))
  await quoted(); assert.equal(await view('canSubmit'), true)
  console.log('PASS plan selection invalidates preview and stale response cannot enable submission')

  const beforeRefresh = await count('plans'); await run(() => window.changePlanHarness.refresh())
  assert.equal(await count('plans'), beforeRefresh); assert.equal(await view('canSubmit'), true)
  await reopen(); const oldPlans = await last('plans'), oldBalance = await last('balance')
  await reopen(); await accept(oldPlans, { plans: [plan(99)] }); await accept(oldBalance, { balance: { balance: 9999 } })
  assert.deepEqual(await view('plans'), []); assert.equal(await view('loading'), true); assert.equal(await view('userBalance'), 0)
  await finishPlans(); await select(2); const oldSession = await last('preview')
  await run(() => window.changePlanHarness.session('b')); await accept(oldSession, quote(2))
  assert.equal(await view('preview'), null); await finishPlans(); await quoted()
  await run(() => { window.changePlanHarness.state.instanceId = 11 }); assert.equal(await view('preview'), null)
  await finishPlans(); await quoted()
  await run(() => { window.changePlanHarness.state.packageId = 2 }); assert.equal(await view('preview'), null); await finishPlans()
  await run(() => { void window.changePlanHarness.view().loadPlans() }); const failedLoad = await last('plans')
  await reject(failedLoad); assert.deepEqual(await view('plans'), []); assert.equal(await view('canSubmit'), false); assert.ok(await view('error'))
  await run(() => { void window.changePlanHarness.view().loadPlans() }); await finishPlans(); await quoted()
  for (const override of [{ canChange: false }, { isUpgrade: false }, { priceDiff: 2000 }, { newPlan: { ...plan(2), isSoldOut: true } }, { newPlan: { ...plan(2), isActive: false } }]) {
    await select(null); await select(2); await accept(await last('preview'), quote(2, override)); await submit(); assert.equal(await count('change'), 0)
  }
  await select(3); const changingCurrentPlan = await last('preview')
  await run(() => { window.changePlanHarness.state.currentPlanId = 2 }); await accept(changingCurrentPlan, quote(3)); assert.equal(await view('preview'), null)
  await run(() => { window.changePlanHarness.state.currentPlanId = 1 }); await finishPlans(); await quoted()
  console.log('PASS modal/session/instance/package/current plan changes and failed reads invalidate confirmation')

  await submit(); const pendingChange = await last('change'); await submit(); assert.equal(await last('change'), pendingChange)
  assert.deepEqual(await page.eval(i => window.changePlanHarness.pending[i].data, pendingChange), { id: 11, planId: 2 })
  await reopen(); await finishPlans(); assert.equal(await view('changing'), true)
  await select(3); await submit(); assert.equal(await last('change'), pendingChange)
  await accept(pendingChange, { needRestart: true, restartMessage: 'obsolete restart message' }); await sleep(650)
  assert.equal(await view('changing'), false); assert.deepEqual(await page.eval(() => window.changePlanHarness.events), [])
  assert.deepEqual(await page.eval(() => window.changePlanHarness.toasts), [])
  await quoted(); await submit(); const staleWriteError = await last('change')
  await run(() => window.changePlanHarness.session('c')); await reject(staleWriteError)
  assert.equal(await view('error'), ''); await finishPlans(); await quoted(); await submit(); await reject(await last('change'))
  assert.equal(await view('changing'), false); assert.ok(await view('error'))
  await submit(); await accept(await last('change'), { needRestart: true, restartMessage: 'KVM_RESTART_REQUIRED' })
  assert.deepEqual(await page.eval(() => window.changePlanHarness.events), [['success'], ['show', false]])
  assert.equal(await page.eval(() => window.changePlanHarness.toasts.length), 1)
  console.log('PASS fixed preview submission, duplicate/busy guard and obsolete write success/error')

  await reopen(); await finishPlans(); await quoted()
  for (const [locale, width, dark] of [['zh-CN', 1440, false], ['en', 390, true]]) {
    await page.setViewport({ width, height: 850, mobile: width === 390 })
    await run(({ locale, dark }) => { window.changePlanHarness.setLocale(locale); window.changePlanHarness.theme.setTheme(dark ? 'dark' : 'light') }, { locale, dark })
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true, 'upgrade form stays within viewport')
    await page.screenshot({ path: resolve(output, `${locale}-${width}.png`), format: 'png' })
  }
  await select(3); const logoutPreview = await last('preview'); await run(() => window.changePlanHarness.session(null))
  const logoutCalls = await page.eval(() => window.changePlanHarness.pending.length)
  await accept(logoutPreview, quote(3)); await submit(); assert.equal(await page.eval(() => window.changePlanHarness.pending.length), logoutCalls)
  assert.equal(await view('preview'), null); assert.equal(await view('canSubmit'), false)
  await run(() => window.changePlanHarness.session('d')); await finishPlans(); await quoted(); await submit(); const leavingWrite = await last('change')
  await run(() => { window.changePlanHarness.state.mounted = false }); const leaveEvents = await page.eval(() => window.changePlanHarness.events.length)
  await accept(leavingWrite, { needRestart: true, restartMessage: 'obsolete after unmount' }); await sleep(650)
  assert.equal(await page.eval(() => window.changePlanHarness.events.length), leaveEvents)
  assert.equal(await page.eval(() => window.changePlanHarness.toasts.length), 1)
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log('PASS logout/unmount and desktop/mobile Chrome without late warnings')
} finally { if (browser) await browser.close(); await server.close() }
