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
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/lottery-draw/*.js']
const output = resolve(root, 'logs/lottery-draw')
mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const server = await createServer({ configFile: false, root: root + '/scripts/fixtures/lottery-draw',
  plugins: [vue()], resolve: { alias: [
    { find: /^@\/api$/, replacement: root + '/scripts/fixtures/lottery-draw/api.js' },
    ...['VipBenefitHall', 'BadgeCenter'].map(name => ({ find: '@/components/entertainment/' + name + '.vue', replacement: root + '/scripts/fixtures/lottery-draw/Empty.vue' })),
    { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) })),
  ], dedupe: ['vue', 'pinia', 'vue-router', 'vue-i18n'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19645, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch()
  const page = await browser.newPage({ reducedMotion: true })
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(40); return result }
  const check = async (fn, label) => { for (let i = 0; i < 100; i++) { if (await page.eval(fn)) return; await sleep(50) } assert.fail(label) }
  const lottery = { id: 1, name: 'Isolated lottery', costPoints: 1, prizes: [{ id: 1, name: 'Isolated prize', type: 'points', value: 1, displayOrder: 1 }] }
  const pointData = { points: 100, totalEarned: 100, totalSpent: 0, convertiblePoints: 0 }
  const prize = { id: 1, prizeId: 1, prizeType: 'points', prizeName: 'Isolated prize', prizeValue: 1, badgeOwnership: null, status: 'completed', pointsSpent: 1, createdAt: new Date(0).toISOString() }
  const singleResult = { success: true, currentPoints: 99, record: prize, action: null, message: 'Isolated result' }
  const multiResult = { success: true, records: [prize], totalDraws: 1, stoppedAt: 2, stopReason: 'Isolated partial result' }
  const fresh = async () => {
    await page.goto('http://127.0.0.1:19645', { settleMs: 250 })
    await check(() => !!window.lotteryHarness?.view(), 'actual lottery setup available')
    await run(({ pointData, lottery }) => { for (const item of window.lotteryHarness.pending) if (item.kind === 'points') item.resolve(pointData); else if (item.kind === 'lotteries') item.resolve({ lotteries: [lottery, { ...lottery, id: 2, name: 'Other lottery' }] }) }, { pointData, lottery })
    await check(() => window.lotteryHarness.view().selectedLottery?.id === 1, 'initial actual lottery loaded')
  }
  const invoke = async operation => run(operation => { void window.lotteryHarness.view()[operation]() }, operation)
  const count = kind => page.eval(kind => window.lotteryHarness.pending.filter(item => item.kind === kind).length, kind)
  const latest = kind => page.eval(kind => window.lotteryHarness.pending.findLastIndex(item => item.kind === kind), kind)
  const settle = async (index, data, fail = false) => run(({ index, data, fail }) => { const item = window.lotteryHarness.pending[index]; fail ? item.reject(new Error('Isolated failure')) : item.resolve(data) }, { index, data, fail })
  const leave = async change => run(async change => {
    const h = window.lotteryHarness, v = h.view(); window.oldLotteryView = v
    if (change === 'selection') v.selectLottery({ id: 2, name: 'Other lottery', costPoints: 1, prizes: [] })
    if (change === 'selection-aba') { v.selectedLottery = { id: 2 }; v.selectedLottery = { id: 1 } }
    if (change === 'session') h.session('b')
    if (change === 'session-aba') { h.session('b'); h.session('a') }
    if (change === 'account') h.auth.user = { ...h.auth.user, id: 2 }
    if (change === 'role') h.auth.user = { ...h.auth.user, role: 'admin' }
    if (change === 'tab') v.mainTab = 'vip'
    if (change === 'subtab') v.switchTab('records')
    if (change === 'cache') await h.router.push('/other')
    if (change === 'cache-aba') { await h.router.push('/other'); await h.nextTick(); await h.router.push('/entertainment?tab=lottery') }
    if (change === 'unmount') h.shown.value = false
  }, change)
  await fresh(); await invoke('multiDraw'); await invoke('multiDraw'); await invoke('spin')
  assert.equal(await count('multi'), 1, 'ten-draw duplicate gate')
  assert.equal(await count('draw'), 0, 'single draw cannot overlap ten-draw')
  assert.equal(await page.eval(() => Array.from(document.querySelectorAll('button')).filter(el => el.textContent.includes('Isolated lottery') || el.textContent.includes('Other lottery')).every(el => el.disabled)), true, 'activity buttons disabled during pending draw')
  await run(() => window.lotteryHarness.view().selectLottery({ id: 2 }))
  assert.equal(await page.eval(() => window.lotteryHarness.view().selectedLottery.id), 1, 'activity function cannot change pending draw target')
  await settle(await latest('multi'), multiResult)
  assert.equal(await page.eval(() => window.lotteryHarness.view().showMultiDrawModal), true)
  assert.equal(await page.eval(() => window.lotteryHarness.view().multiDrawError), multiResult.stopReason)
  for (const operation of ['spin', 'multiDraw']) {
    await fresh(); await invoke(operation); await invoke('spin'); await invoke('multiDraw')
    assert.equal(await count('draw'), operation === 'spin' ? 1 : 0)
    assert.equal(await count('multi'), operation === 'multiDraw' ? 1 : 0)
    const index = await latest(operation === 'spin' ? 'draw' : 'multi')
    await settle(index, null, true)
    await check(() => !window.lotteryHarness.view().isSpinning && !window.lotteryHarness.view().isMultiDrawing, 'failed draw releases busy for retry')
    await invoke(operation); assert.equal(await count(operation === 'spin' ? 'draw' : 'multi'), 2)
  }
  let staleReceiptCases = 0
  const changes = process.env.LOTTERY_DRAW_CHECK === 'current' ? [] : ['selection-aba', 'tab', 'subtab', 'cache', 'cache-aba', 'unmount', 'session', 'session-aba', 'account', 'role']
  for (const operation of ['spin', 'multiDraw']) for (const change of changes) for (const fail of [false, true]) {
    await fresh(); await invoke(operation); const index = await latest(operation === 'spin' ? 'draw' : 'multi')
    await leave(change); const before = await page.eval(() => ({ reads: window.lotteryHarness.pending.filter(item => ['points', 'lotteries'].includes(item.kind)).length, toasts: window.lotteryHarness.toastEvents.length }))
    await settle(index, operation === 'spin' ? singleResult : multiResult, fail); await sleep(2200)
    assert.deepEqual(await page.eval(() => ({ reads: window.lotteryHarness.pending.filter(item => ['points', 'lotteries'].includes(item.kind)).length, toasts: window.lotteryHarness.toastEvents.length })), before, operation + ' old receipt ' + change)
    assert.equal(await page.eval(() => !!window.oldLotteryView.showResultModal || !!window.oldLotteryView.lotteryBadgeRewardModal.visible || !!window.oldLotteryView.showMultiDrawModal || !!window.oldLotteryView.showMultiDrawBadgeModal), false, operation + ' no stale result ' + change)
    staleReceiptCases++
  }
  await fresh(); await invoke('multiDraw'); const sameSidWrite = await latest('multi')
  const sameSidReads = await page.eval(() => window.lotteryHarness.pending.length)
  await run(() => window.lotteryHarness.session('a', 2))
  assert.equal(await page.eval(() => window.lotteryHarness.pending.length), sameSidReads, 'same sid token refresh keeps active draw')
  await settle(sameSidWrite, multiResult)
  assert.equal(await page.eval(() => window.lotteryHarness.view().showMultiDrawModal), true)
  for (const kind of ['points', 'lotteries']) {
    await fresh(); await invoke(kind === 'points' ? 'loadPoints' : 'loadLotteries'); const oldRead = await latest(kind)
    await run(() => { window.lotteryHarness.session('b'); window.lotteryHarness.session('a') })
    const newRead = await latest(kind)
    await settle(oldRead, kind === 'points' ? { ...pointData, points: 999 } : { lotteries: [{ ...lottery, name: 'Obsolete lottery' }] })
    assert.equal(await page.eval(kind => window.lotteryHarness.view()[kind === 'points' ? 'pointsLoading' : 'lotteriesLoading'], kind), true, 'old read finally keeps current loader')
    await settle(newRead, kind === 'points' ? { ...pointData, points: 0 } : { lotteries: [lottery] })
    assert.equal(await page.eval(kind => kind === 'points' ? window.lotteryHarness.view().points.points : window.lotteryHarness.view().lotteries[0].name, kind), kind === 'points' ? 0 : lottery.name)
  }
  for (const change of ['tab', 'cache-aba', 'unmount']) {
    await fresh(); await invoke('spin'); await settle(await latest('draw'), singleResult)
    assert.equal(await page.eval(() => window.lotteryHarness.view().isSpinning), true, 'busy covers animation')
    await leave(change); const before = await page.eval(() => window.lotteryHarness.pending.length); await sleep(2200)
    assert.equal(await page.eval(() => window.lotteryHarness.pending.length), before, 'cancelled animation does not refresh')
    assert.equal(await page.eval(() => window.oldLotteryView.showResultModal), false)
  }
  await fresh(); await invoke('spin'); await settle(await latest('draw'), singleResult)
  await invoke('multiDraw'); await invoke('spin')
  assert.equal(await count('draw'), 1); assert.equal(await count('multi'), 0, 'animation keeps mutual exclusion')
  await check(() => window.lotteryHarness.view().showResultModal && !window.lotteryHarness.view().isSpinning, 'current single result shown after animation')
  await fresh(); await invoke('spin')
  await settle(await latest('draw'), { ...singleResult, record: { ...prize, prizeType: 'badge', badgeOwnership: { id: 1, badgeId: 'ignition', seriesId: 'system', nameZh: 'Isolated badge', nameEn: 'Isolated badge', imageUrl: '', status: 'available', rarity: 'common' } } })
  await check(() => window.lotteryHarness.view().lotteryBadgeRewardModal.visible, 'actual badge reward branch shown')
  assert.equal(await page.eval(() => window.lotteryHarness.view().lotteryBadgeRewardModal.remainingPoints), 99)
  await fresh(); await invoke('spin'); await settle(await latest('draw'), singleResult)
  await check(() => window.lotteryHarness.view().showResultModal && !window.lotteryHarness.view().isSpinning, 'fresh current result for screenshots')
  for (const [locale, width, dark] of [['zh-CN', 1440, false], ['zh-TW', 768, false], ['en', 390, true]]) {
    await run(({ locale, dark }) => { const h = window.lotteryHarness; h.setLocale(locale); h.theme.setTheme(dark ? 'dark' : 'light') }, { locale, dark })
    await page.setViewport({ width, height: 1000, mobile: width === 390 }); await sleep(120)
    await page.screenshot({ path: resolve(output, locale + '-' + width + '.png'), format: 'png' })
  }
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log(`PASS actual lottery single/ten-draw mutual exclusion, retry, ${staleReceiptCases} stale receipts, same sid refresh, scoped points/lottery reads, cancelled animation and current result; real Vue with deferred API, no real rewards or points writes`)
} finally { if (browser) await browser.close(); await server.close() }
