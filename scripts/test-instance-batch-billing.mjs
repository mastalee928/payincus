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
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/instance-batch-billing/*.js']
const output = resolve(root, 'logs/instance-batch-billing-lifecycle'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const server = await createServer({ configFile: false, root: root + '/scripts/fixtures/instance-batch-billing', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/instance-batch-billing/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19673, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19673', { settleMs: 1500 })
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(70); return result }
  const last = kind => page.eval(kind => window.batchHarness.pending.findLastIndex(item => item.kind === kind), kind)
  const count = kind => page.eval(kind => window.batchHarness.pending.filter(item => item.kind === kind).length, kind)
  const accept = (index, data) => run(({ index, data }) => window.batchHarness.pending[index].resolve(data), { index, data })
  const reject = index => run(index => window.batchHarness.pending[index].reject(new Error('fixture failure')), index)
  const view = key => page.eval(key => JSON.parse(JSON.stringify(window.batchHarness.view()[key])), key)
  const preview = id => ({ id, name: `Fixture ${id}`, canRenew: true, autoRenew: false, isHostedInstance: false, daysUntilExpire: 5, options: [{ months: 1, price: 10, discountedPrice: 10, expiresAt: '2030-02-01T00:00:00Z' }] })
  await run(() => { const v = window.batchHarness.view(); v.selectedIds = new Set([1]); void v.openBatchRenewModal() })
  await accept(await last('renew-preview'), { items: [preview(1)] }); await accept(await last('balance'), { balance: { balance: 100, frozen: 0, totalRecharge: 100, totalConsume: 0 } })
  await run(() => { const v = window.batchHarness.view(); v.selectedIds = new Set([2]); void v.confirmBatchRenew() })
  const billed = await page.eval(() => window.batchHarness.pending.findLast(item => item.kind === 'renew')?.data.ids || [])
  assert.equal(billed.includes(2), false, 'confirmation must never bill an instance absent from the shown preview')
  assert.deepEqual(billed, [1])
  await accept(await last('renew'), { successCount: 1, skippedCount: 0, failedCount: 0 })
  console.log('PASS batch renew keeps the approved preview target')

  const destroyPreview = id => ({ id, name: `Fixture ${id}`, canDestroy: true, cannotDestroyReason: '', isFreeInstance: false,
    isFirstTime: false, feeWaiverEligible: false, refund: { remainingDays: 5, remainingValue: 0, feeRate: 0, feeAmount: 0, refundAmount: 0, destroyCount: 0, maxRefundable: 0 },
    instance: { id, name: `Fixture ${id}`, hostName: `Host ${id}`, planName: 'Fixture plan' } })
  const result = { successCount: 1, skippedCount: 0, failedCount: 0 }
  const toasts = () => page.eval(() => window.batchHarness.toasts.length)
  const selection = () => page.eval(() => [...window.batchHarness.view().selectedIds])
  for (const kind of ['renew', 'destroy']) {
    const cap = kind === 'renew' ? 'Renew' : 'Destroy', item = kind === 'renew' ? preview : destroyPreview
    const modal = `showBatch${cap}Modal`, loading = `batch${cap}Loading`, submitting = `batch${cap}Submitting`, canSubmit = `batch${cap}CanSubmit`
    const open = async (ids = [1]) => {
      await run(({ ids, cap }) => { const v = window.batchHarness.view(); v.selectedIds = new Set(ids); void v[`openBatch${cap}Modal`]() }, { ids, cap })
      return { preview: await last(`${kind}-preview`), balance: kind === 'renew' ? await last('balance') : null }
    }
    const ready = async (request, items = [item(1)], balance = 100) => {
      await accept(request.preview, { items })
      if (request.balance !== null) await accept(request.balance, { balance: { balance, frozen: 0, totalRecharge: 100, totalConsume: 0 } })
    }
    const close = () => run(cap => window.batchHarness.view()[`closeBatch${cap}Modal`](), cap)
    const confirm = () => run(cap => { void window.batchHarness.view()[`confirmBatch${cap}`]() }, cap)
    const phrase = () => run(() => { window.batchHarness.view().batchDestroyConfirm = 'DESTROY' })
    let request = await open([1, 2]); await phrase(); const beforeLoading = await count(kind); await confirm()
    assert.equal(await count(kind), beforeLoading, `${kind} cannot submit during preview`)
    const blocked = { ...item(2), [kind === 'renew' ? 'canRenew' : 'canDestroy']: false }
    await ready(request, [item(1), blocked]); await phrase()
    assert.equal(await view(canSubmit), true)
    await run(() => { window.batchHarness.view().selectedIds = new Set([2]) })
    await confirm(); const write = await last(kind)
    assert.deepEqual(await page.eval(index => window.batchHarness.pending[index].data.ids, write), [1])
    if (kind === 'renew') assert.equal(await page.eval(index => window.batchHarness.pending[index].data.months, write), 1)
    await confirm(); assert.equal(await last(kind), write, `${kind} duplicate confirmation`)
    await close(); assert.equal(await view(modal), true, `${kind} pending write blocks manual close`)
    await run(() => { window.batchHarness.view().selectedIds = new Set([1, 2]) })
    const writesToasts = await toasts(); await accept(write, result)
    assert.equal(await view(modal), false); assert.deepEqual(await selection(), [1, 2]); assert.equal(await toasts(), writesToasts + 1)

    // A -> B -> A and failures must not clear the current preview or its loading state.
    request = await open(); await close(); const middle = await open([2]); await close(); const latest = await open()
    const staleToasts = await toasts(); await ready(request); await reject(middle.preview)
    if (middle.balance !== null) await accept(middle.balance, { balance: { balance: 100 } })
    assert.equal(await view(loading), true); assert.equal(await view(modal), true); assert.equal(await toasts(), staleToasts)
    await ready(latest); await phrase(); assert.equal(await view(canSubmit), true)
    await run(() => window.batchHarness.session('a', 2)); assert.equal(await view(canSubmit), true, 'same sid refresh preserves preview')
    await close()

    for (const invalid of [[item(2)], [], [item(1), item(1)]]) {
      request = await open(invalid.length === 2 ? [1, 2] : [1]); const messages = await toasts()
      await ready(request, invalid); assert.equal(await view(canSubmit), false); assert.equal(await view(modal), false)
      assert.equal(await toasts(), messages + 1)
    }
    request = await open(); await ready(request, [{ ...item(1), [kind === 'renew' ? 'canRenew' : 'canDestroy']: false }]); await phrase()
    assert.equal(await view(canSubmit), false); await close()
    if (kind === 'renew') {
      for (const price of [null, '', '10', -1, 'NaN']) {
        request = await open(); const bad = preview(1); bad.options[0].discountedPrice = price
        await ready(request, [bad]); assert.equal(await view(modal), false); assert.equal(await view(canSubmit), false)
      }
      for (const balance of [null, '', 'NaN']) {
        request = await open(); await ready(request, [preview(1)], balance); assert.equal(await view(modal), false)
      }
      request = await open(); await ready(request, [preview(1)], 9); assert.equal(await view(canSubmit), false); await close()
      request = await open(); const quarterly = preview(1); quarterly.options[0].months = 3; await ready(request, [quarterly])
      assert.equal(await view(canSubmit), false); await close()
      request = await open(); const balanceToasts = await toasts(); await accept(request.preview, { items: [preview(1)] }); await reject(request.balance)
      assert.equal(await view(modal), false); assert.equal(await toasts(), balanceToasts + 1)
      request = await open(); await ready(request); await run(() => { window.batchHarness.view().batchRenewMonths = 3 })
      await confirm(); assert.equal(await view(canSubmit), false); await close()
    } else {
      request = await open(); await ready(request)
      assert.equal(await view(canSubmit), false)
      await run(() => { window.batchHarness.view().batchDestroyConfirm = 'destroy' }); assert.equal(await view(canSubmit), false)
      await phrase(); assert.equal(await view(canSubmit), true); assert.equal(await view('batchDestroyTotalRefund'), 0); assert.equal(await view('batchDestroyTotalFee'), 0); await close()
    }
    console.log(`PASS ${kind}: target/eligibility binding, current success, repeated submit, preview ABA, invalid IDs and billing gates`)

    // Old writes retain their busy flag across cache/session changes, then settle quietly.
    request = await open(); await ready(request); await phrase(); await confirm(); const oldWrite = await last(kind)
    await run(() => window.batchHarness.router.push('/other')); assert.equal(await view(modal), false)
    await run(() => window.batchHarness.router.push('/instances')); const previewCount = await count(`${kind}-preview`)
    await open([2]); assert.equal(await count(`${kind}-preview`), previewCount); assert.equal(await view(submitting), true)
    const oldWriteToasts = await toasts(); await accept(oldWrite, result)
    assert.equal(await view(submitting), false); assert.equal(await view(modal), false); assert.equal(await toasts(), oldWriteToasts); assert.deepEqual(await selection(), [2])

    request = await open(); await ready(request); await phrase(); await confirm(); const sessionWrite = await last(kind)
    await run(() => window.batchHarness.session('b')); assert.equal(await view(modal), false)
    const sessionMessages = await toasts(); await reject(sessionWrite); assert.equal(await toasts(), sessionMessages); assert.equal(await view(submitting), false)
    request = await open(); await run(() => window.batchHarness.session('c')); const sessionReads = await toasts(); await ready(request)
    assert.equal(await view(modal), false); assert.equal(await toasts(), sessionReads)

    request = await open(); await ready(request); await phrase(); await confirm(); const failedWrite = await last(kind), currentMessages = await toasts()
    await reject(failedWrite); assert.equal(await view(modal), true); assert.equal(await view(canSubmit), true); assert.equal(await toasts(), currentMessages + 1)
    await confirm(); await accept(await last(kind), { ...result, failedCount: 1 }); assert.equal(await view(modal), false); assert.deepEqual(await selection(), [])
    request = await open(); await ready(request); await phrase()
    await run(() => window.batchHarness.router.push('/instances?changed=1')); assert.equal(await view(modal), false)
    request = await open(); await run(() => window.batchHarness.session(null)); const logoutMessages = await toasts(); await reject(request.preview)
    if (request.balance !== null) await reject(request.balance)
    assert.equal(await view(modal), false); assert.equal(await toasts(), logoutMessages)
    const loggedOutCount = await count(`${kind}-preview`); await open(); assert.equal(await count(`${kind}-preview`), loggedOutCount)
    await run(() => window.batchHarness.session('a'))
    request = await open(); await ready(request); await phrase()
    await run(() => { window.batchHarness.auth.user = { id: 2, username: 'fixture-2', role: 'user' } }); assert.equal(await view(modal), false)
    await run(() => { window.batchHarness.auth.user = { id: 1, username: 'fixture', role: 'admin' }; window.batchHarness.view().filterUserId = 2 })
    const adminCount = await count(`${kind}-preview`); await open(); assert.equal(await count(`${kind}-preview`), adminCount)
    await run(() => { window.batchHarness.auth.user = { id: 1, username: 'fixture', role: 'user' }; window.batchHarness.view().filterUserId = null })
    for (const [locale, width, dark, mobile] of [['zh-CN', 1440, false, false], ['en', 390, true, true]]) {
      await page.setViewport({ width, height: 1000, mobile })
      await run(({ locale, dark }) => { window.batchHarness.setLocale(locale); window.batchHarness.theme.setTheme(dark ? 'dark' : 'light') }, { locale, dark })
      request = await open([1, 2]); await ready(request, [item(1), blocked]); await phrase()
      assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
      await page.screenshot({ path: resolve(output, `${kind}-${locale}-${width}.png`), format: 'png' }); await close()
    }
    request = await open(); await run(() => { window.batchHarness.state.mounted = false }); const unmountMessages = await toasts(); await ready(request)
    assert.equal(await view(modal), false); assert.equal(await toasts(), unmountMessages)
    await run(() => { window.batchHarness.state.mounted = true }); await run(() => window.batchHarness.session('a'))
    console.log(`PASS ${kind}: write/cache/session isolation, failure retry, permission/logout/unmount and desktop/mobile Chrome`)
  }
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
} finally { if (browser) await browser.close(); await server.close() }
