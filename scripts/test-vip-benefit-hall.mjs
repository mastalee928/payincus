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
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/vip-benefit-hall/*.js']
const output = resolve(root, 'logs/vip-benefit-hall-browser'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const server = await createServer({ configFile: false, root: root + '/scripts/fixtures/vip-benefit-hall', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api(?:\/admin)?$/, replacement: root + '/scripts/fixtures/vip-benefit-hall/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19658, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19658/', { settleMs: 1200 })
  const deadline = Date.now() + 15000
  while (!await page.eval(() => !!window.vipHallHarness?.pending.some(item => item.kind === 'overview'))) {
    if (Date.now() >= deadline) throw Error('VIP hall did not load within 15 seconds')
    await sleep(100)
  }
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(60); return result }
  const count = kind => page.eval(kind => window.vipHallHarness.pending.filter(item => item.kind === kind).length, kind)
  const last = kind => page.eval(kind => window.vipHallHarness.pending.findLastIndex(item => item.kind === kind), kind)
  const acceptAt = (index, data) => run(({ index, data }) => window.vipHallHarness.pending[index].resolve(data), { index, data })
  const accept = async (kind, data) => acceptAt(await last(kind), data)
  const rejectAt = (index, message) => run(({ index, message }) => window.vipHallHarness.pending[index].reject(new Error(message)), { index, message })
  const click = key => run(key => {
    const button = [...document.querySelectorAll('button')].find(el => el.checkVisibility() && el.textContent.trim() === window.vipHallHarness.t(key))
    if (!button) throw Error('Missing button ' + key)
    button.click()
  }, key)
  const reward = { id: 1, level: 1, type: 'balance', title: 'Fixture balance reward', config: { amount: 12 }, enabled: true, state: 'claimable', sortOrder: 0, claimLimit: 2, claimedCount: 0, remainingClaims: 2, claims: [] }
  const overview = (title = reward.title, items = [{ ...reward, title }]) => ({ currentLevel: 1, rewards: items, summary: {
    totalRewards: items.length, unlockedRewards: items.length, claimableRewards: items.filter(item => item.state === 'claimable').length, claimedRewards: 0, pendingRewards: 0,
    entitlement: { balanceAmount: 24, pointsAmount: 0, instanceQuantity: 0 }, remaining: { balanceAmount: 12, pointsAmount: 0, instanceQuantity: 0 }
  } })
  const claim = { id: 11, rewardId: 1, level: 1, status: 'delivered', claimNo: 1, snapshot: { type: 'balance', title: reward.title, config: { amount: 12 } } }
  const titles = () => page.eval(() => [...document.querySelectorAll('h3')].map(el => el.textContent))
  const effects = () => page.eval(() => window.vipHallHarness.toastEvents.length)
  const feedbacks = () => page.eval(() => document.querySelectorAll('.vip-claim-pop-move').length || document.querySelectorAll('.fixed article').length)
  await accept('overview', overview())
  assert.equal(await count('overview'), 1, 'mounted and activated must not double load')
  await run(() => { window.vipHallHarness.state.active = false })
  await run(() => { window.vipHallHarness.state.active = true })
  assert.equal(await count('overview'), 2, 'returning from hidden tab must refresh')
  await accept('overview', overview('After tab return'))
  await run(() => { window.vipHallHarness.state.active = false })
  await run(() => { window.vipHallHarness.state.active = true })
  const oldRead = await last('overview')
  await run(() => { window.vipHallHarness.state.active = false })
  assert.equal(await page.eval(index => window.vipHallHarness.pending[index].aborted, oldRead), true)
  await run(() => { window.vipHallHarness.state.active = true })
  await accept('overview', overview('Newest overview'))
  await acceptAt(oldRead, overview('Stale overview'))
  assert.deepEqual(await titles(), ['Newest overview'])

  await run(() => window.vipHallHarness.router.push('/other'))
  const hiddenReads = await count('overview')
  await run(() => { window.vipHallHarness.session('b') })
  assert.equal(await count('overview'), hiddenReads, 'hidden session change does not read')
  await run(() => window.vipHallHarness.router.push('/benefits'))
  assert.equal(await count('overview'), hiddenReads + 1)
  const failedRead = await last('overview')
  await rejectAt(failedRead, 'Fixture overview read failed')
  assert.ok(await page.eval(() => document.querySelector('[role="alert"]').textContent.includes('Fixture overview read failed')))
  assert.equal(await page.eval(() => document.querySelectorAll('h3').length), 0)
  await click('common.retry'); await accept('overview', overview('Recovered overview'))
  const readsBeforeToken = await count('overview')
  await run(() => { window.vipHallHarness.auth.token += '-rotated' })
  assert.equal(await count('overview'), readsBeforeToken, 'same SID token refresh does not reload')

  await run(() => { window.vipHallHarness.session('c') })
  const oldError = await last('overview')
  await run(() => { window.vipHallHarness.session('d') })
  await accept('overview', overview('Current session'))
  const effectsBeforeOldError = await effects()
  await rejectAt(oldError, 'Stale error')
  assert.deepEqual(await titles(), ['Current session']); assert.equal(await effects(), effectsBeforeOldError)
  assert.equal(await page.eval(() => !!document.querySelector('[role="alert"]')), false)

  // In-flight writes cannot be cancelled safely. Re-entry waits, then reads the settled result.
  await click('vipBenefits.claim')
  const oldClaim = await last('claim'), beforeClaimRead = await count('overview')
  await run(() => { window.vipHallHarness.state.active = false })
  await run(() => { window.vipHallHarness.state.active = true })
  assert.equal(await count('overview'), beforeClaimRead)
  await acceptAt(oldClaim, { claim, overview: overview('Old claim response') })
  assert.equal(await count('overview'), beforeClaimRead + 1)
  assert.equal(await feedbacks(), 0)
  await accept('overview', overview('After claim settlement'))
  assert.deepEqual(await titles(), ['After claim settlement'])

  await click('vipBenefits.claimAll')
  const oldBulk = await last('claimAll'), beforeSessionWriteReads = await count('overview'), beforeSessionWriteEffects = await effects()
  await run(() => { window.vipHallHarness.session('e') })
  assert.equal(await count('overview'), beforeSessionWriteReads)
  await rejectAt(oldBulk, 'Retired bulk claim error')
  assert.equal(await count('overview'), beforeSessionWriteReads + 1)
  await accept('overview', overview('New account view'))
  assert.equal(await effects(), beforeSessionWriteEffects)

  // Current write errors trigger a fresh read; failed refresh stays visible until explicit retry.
  await click('vipBenefits.claim')
  await rejectAt(await last('claim'), 'Fixture claim failed')
  await rejectAt(await last('overview'), 'Fixture recovery read failed')
  assert.ok(await page.eval(() => document.querySelector('[role="alert"]').textContent.includes('Fixture recovery read failed')))
  assert.equal(await page.eval(() => [...document.querySelectorAll('article button')].filter(el => el.checkVisibility()).every(el => el.disabled)), true)
  await click('common.retry'); await accept('overview', overview())
  await click('vipBenefits.claim'); await accept('claim', { claim, overview: overview() })
  assert.equal(await feedbacks(), 1)
  await run(() => { window.vipHallHarness.state.active = false }); await sleep(320)
  assert.equal(await feedbacks(), 0, 'hiding clears feedback')
  await run(() => { window.vipHallHarness.state.active = true }); await accept('overview', overview())

  // Unmounted writes/reads must not affect the replacement component.
  await click('vipBenefits.claim')
  const retiredClaim = await last('claim')
  await run(() => { window.vipHallHarness.state.mounted = false })
  await run(() => { window.vipHallHarness.state.mounted = true }); await accept('overview', overview('Replacement'))
  const beforeRetiredEffects = await effects(), beforeRetiredReads = await count('overview')
  await acceptAt(retiredClaim, { claim, overview: overview('Retired') })
  assert.equal(await count('overview'), beforeRetiredReads); assert.equal(await effects(), beforeRetiredEffects)
  assert.deepEqual(await titles(), ['Replacement']); assert.equal(await feedbacks(), 0)
  await run(() => { window.vipHallHarness.session('f') }); const retiredRead = await last('overview')
  await run(() => { window.vipHallHarness.state.mounted = false })
  await run(() => { window.vipHallHarness.state.mounted = true }); await accept('overview', overview('Replacement after read'))
  await acceptAt(retiredRead, overview('Retired read'))
  assert.deepEqual(await titles(), ['Replacement after read'])
  await run(() => { window.vipHallHarness.auth.token = ''; window.vipHallHarness.auth.user = null })
  assert.deepEqual(await titles(), [])
  await run(() => { window.vipHallHarness.auth.user = { id: 2, role: 'user' }; window.vipHallHarness.session('g') }); await accept('overview', overview())

  for (const locale of ['zh-CN', 'zh-TW', 'en-US']) for (const width of [1440, 390]) {
    await run(({ locale, width }) => { window.vipHallHarness.setLocale(locale); window.vipHallHarness.theme.setTheme(width === 390 ? 'dark' : 'light') }, { locale, width })
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width === 390 })
    await page.screenshot({ path: resolve(output, `${locale}-${width}.png`) })
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
  }
  console.log('PASS actual VIP hall: v-show/KeepAlive/session lifecycle, read cancellation and stale results, initial/recovery retry, in-flight write settlement, old success/error isolation, feedback cleanup, logout and unmount; 3 locales desktop/mobile. Controlled API, no real claims.')
} finally { if (browser) await browser.close(); await server.close() }
