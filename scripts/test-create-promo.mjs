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
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/create-promo/*.js']
const output = resolve(root, 'logs/create-promo-lifecycle'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const server = await createServer({ configFile: false, root: root + '/scripts/fixtures/create-promo', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/create-promo/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19674, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19674', { settleMs: 1500 })
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(80); return result }
  const last = kind => page.eval(kind => window.promoHarness.pending.findLastIndex(item => item.kind === kind), kind)
  const accept = (index, data) => run(({ index, data }) => window.promoHarness.pending[index].resolve(data), { index, data })
  const view = key => page.eval(key => JSON.parse(JSON.stringify(window.promoHarness.view()[key])), key)
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  assert.deepEqual(await page.eval(() => window.promoHarness.calls), [], 'source must wait for the initial zone list')
  await accept(await last('zones'), { zones: [{ id: 7, name: 'Fixture zone' }] })
  assert.deepEqual(await page.eval(() => window.promoHarness.calls), [{ kind: 'packages', source: { source: 'zone', zoneId: 7 } }, { kind: 'regions', source: { source: 'zone', zoneId: 7 } }])
  assert.equal(await view('packageSource'), 'zone:7')
  console.log('PASS existing initial zone link waits for zones and loads the correct source')
  await run(() => { window.promoHarness.seed(); const v = window.promoHarness.view(); v.form.promoCode = 'FIRST'; void v.verifyPromoCode() })
  const first = await last('promo')
  await run(() => { const v = window.promoHarness.view(); v.form.promoCode = 'SECOND'; void v.verifyPromoCode() })
  const second = await last('promo')
  await accept(second, { valid: true, discountRate: 0.2, commissionRate: 0.1 }); await accept(first, { valid: true, discountRate: 0.9, commissionRate: 0.1 })
  assert.equal(await view('promoCodeDiscount'), 0.2, 'old coupon response must not change the current code discount')
  console.log('PASS coupon validation ignores older code responses')
  const good = { valid: true, discountRate: 0.2, commissionRate: 0.1 }
  const count = kind => page.eval(kind => window.promoHarness.pending.filter(item => item.kind === kind).length, kind)
  const reject = index => run(index => window.promoHarness.pending[index].reject(new Error('Fixture rejected code')), index)
  const verify = async code => {
    await run(code => { const v = window.promoHarness.view(); v.form.promoCode = code; void v.verifyPromoCode() }, code)
    return last('promo')
  }
  await run(() => { window.promoHarness.view().form.promoCode = 'EDITED' })
  assert.equal(await view('promoCodeValid'), null); assert.equal(await view('promoCodeDiscount'), 0); assert.equal((await view('planPriceInfo')).finalPrice, 10)
  const a = await verify('A'), b = await verify('B'), newA = await verify('A')
  await accept(a, good); await reject(b)
  assert.equal(await view('promoCodeVerifying'), true); assert.equal(await view('promoCodeValid'), null); assert.equal(await view('promoCodeError'), '')
  await run(() => { void window.promoHarness.view().verifyPromoCode() }); assert.equal(await last('promo'), newA)
  await accept(newA, good); assert.equal((await view('planPriceInfo')).finalPrice, 8)
  await run(() => window.promoHarness.session('a', 3)); assert.equal(await view('promoCodeValid'), true)
  let request = await verify('PLAN-ONE'); await run(() => { window.promoHarness.view().form.planId = 2 }); await accept(request, good)
  assert.equal(await view('promoCodeValid'), null); assert.equal(await view('promoCodeVerifying'), false)
  request = await verify('PLAN-TWO'); assert.deepEqual(await page.eval(index => window.promoHarness.pending[index].data, request), { code: 'PLAN-TWO', planId: 2 })
  await accept(request, good); await run(() => { window.promoHarness.view().packagePlans[1].price = 2000 }); assert.equal(await view('promoCodeValid'), null)
  request = await verify('PLAN-PRICE'); await accept(request, good); await run(() => { window.promoHarness.view().packagePlans = [] }); assert.equal(await view('promoCodeValid'), null)
  await run(() => window.promoHarness.seed())
  request = await verify('BEFORE-RESET'); await run(() => window.promoHarness.view().resetPromoCode()); await accept(request, good)
  assert.equal(await view('promoCodeValid'), null); assert.equal((await view('form')).promoCode, '')
  console.log('PASS immediate input/plan/price invalidation, code ABA, repeated verification and same-session refresh')

  for (const invalid of [
    { valid: false, error: 'Fixture invalid' }, { valid: 'true', discountRate: 0.2, commissionRate: 0.1 },
    ...[null, '', '0.2', -0.1, 1.1, 'NaN'].map(discountRate => ({ ...good, discountRate })),
    { ...good, commissionRate: -1 }, { ...good, commissionRate: null },
  ]) {
    request = await verify('INVALID'); await accept(request, invalid)
    assert.equal(await view('promoCodeValid'), false); assert.equal(await view('promoCodeDiscount'), 0); assert.equal(await view('promoCodeCommissionRate'), 0)
  }
  request = await verify('FAILED'); await reject(request); assert.equal(await view('promoCodeValid'), false); assert.equal(await view('promoCodeVerifying'), false)
  request = await verify('FAILED'); await accept(request, good); assert.equal(await view('promoCodeValid'), true)
  request = await verify('SOURCE'); await run(() => { window.promoHarness.view().packageSource = 'market'; window.promoHarness.view().packages[0].sourceType = 'market' }); await accept(request, good)
  assert.equal(await view('promoCodeValid'), null); const hostedCount = await count('promo'); await verify('HOSTED'); assert.equal(await count('promo'), hostedCount)
  await run(() => window.promoHarness.seed())
  request = await verify('CACHED'); await run(() => window.promoHarness.router.push('/other')); await accept(request, good)
  assert.equal(await view('promoCodeValid'), null); const cacheCount = await count('promo'); await verify('INACTIVE'); assert.equal(await count('promo'), cacheCount)
  await run(() => window.promoHarness.router.push('/instances/create'))
  request = await verify('ROUTE'); await run(() => window.promoHarness.router.push('/instances/create?source=official')); await reject(request)
  assert.equal(await view('promoCodeValid'), null); assert.equal(await view('promoCodeError'), '')
  request = await verify('SESSION'); await run(() => window.promoHarness.session('b')); await accept(request, good); assert.equal(await view('promoCodeValid'), null)
  request = await verify('USER'); await run(() => { window.promoHarness.auth.user = { id: 2, username: 'fixture2', role: 'user' } }); await accept(request, good)
  assert.equal(await view('promoCodeValid'), null)
  request = await verify('LOGOUT'); await run(() => window.promoHarness.session(null)); await reject(request)
  const logoutCount = await count('promo'); await verify('ANONYMOUS'); assert.equal(await count('promo'), logoutCount)
  await run(() => window.promoHarness.session('c')); await run(() => window.promoHarness.seed())
  console.log('PASS invalid rates, current failure/retry, hosted-code gate, cache/route/session/account/logout isolation')

  // Real create handler against a controlled API, with no instance provisioned.
  await run(() => { const v = window.promoHarness.view(); v.form.hostId = 1; v.form.name = 'fixture-one' })
  await run(() => { const v = window.promoHarness.view(); v.availableImages = [{ value: 'debian/12', label: 'Debian 12', icon: 'debian' }]; v.form.image = 'debian/12'; v.form.sshKeyId = 1 })
  request = await verify('SUBMIT'); const creates = await count('create')
  await run(() => { void window.promoHarness.view().handleSubmit() }); assert.equal(await count('create'), creates)
  await accept(request, good); assert.equal(await view('canSubmit'), true)
  await run(() => { const v = window.promoHarness.view(); void v.handleSubmit(); v.form.promoCode = 'CHANGED-BEFORE-TURNSTILE-RETURN' })
  assert.equal(await count('create'), creates, 'changed coupon context must abort the pending submit continuation')
  request = await verify('FINAL'); await accept(request, good)
  for (const [locale, width, dark, mobile] of [['zh-CN', 1440, false, false], ['en', 390, true, true]]) {
    await page.setViewport({ width, height: 1000, mobile })
    await run(({ locale, dark }) => { window.promoHarness.setLocale(locale); window.promoHarness.theme.setTheme(dark ? 'dark' : 'light'); document.querySelector('input[placeholder]')?.scrollIntoView({ block: 'center' }) }, { locale, dark })
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: resolve(output, `${locale}-${width}.png`), format: 'png' })
  }
  await run(() => { void window.promoHarness.view().handleSubmit() }); const create = await last('create')
  assert.equal(await page.eval(index => window.promoHarness.pending[index].data.promoCode, create), 'FINAL')
  await run(() => { void window.promoHarness.view().handleSubmit() }); assert.equal(await last('create'), create)
  await reject(create); assert.equal(await view('submitting'), false)
  request = await verify('UNMOUNT'); await run(() => { window.promoHarness.state.mounted = false }); await accept(request, good)
  assert.equal(await view('promoCodeValid'), null); assert.equal(await view('promoCodeVerifying'), false)
  console.log('PASS submit waits for verification, fixed coupon after Turnstile, current create payload and unmount cleanup')
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
} finally { if (browser) await browser.close(); await server.close() }
