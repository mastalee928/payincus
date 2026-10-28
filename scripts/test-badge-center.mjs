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
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/badge-center/*.js']
const output = resolve(root, 'logs/badge-center-browser'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const server = await createServer({ configFile: false, root: root + '/scripts/fixtures/badge-center', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/badge-center/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19650, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19650', { settleMs: 1200 })
  const run = async (fn, arg) => { const value = await page.eval(fn, arg); await sleep(45); return value }
  const latest = kind => page.eval(kind => window.badgeCenterHarness.pending.findLastIndex(item => item.kind === kind), kind)
  const count = kind => page.eval(kind => window.badgeCenterHarness.pending.filter(item => item.kind === kind).length, kind)
  const accept = (index, data) => run(({ index, data }) => window.badgeCenterHarness.pending[index].resolve(data), { index, data })
  const reject = index => run(index => window.badgeCenterHarness.pending[index].reject(new Error('Isolated read failure')), index)
  const route = path => run(path => window.badgeCenterHarness.router.push(path), path)
  const click = (key, params, count = 1) => run(({ key, params, count }) => {
    const text = window.badgeCenterHarness.t(key, params || {})
    const button = [...document.querySelectorAll('button')].find(el => el.checkVisibility() && el.textContent.trim() === text)
    if (!button) throw Error('Missing button: ' + text)
    for (let i = 0; i < count; i++) button.click()
  }, { key, params, count })
  const catalog = { id: 'ignition', name: 'Fixture badge', nameEn: 'Fixture badge', fullLabel: 'Fixture badge', seriesId: 'fixture', seriesTitle: 'Fixture series', seriesNameZh: 'Fixture series', seriesDescription: '', assetUrl: '/badges/light/ignition.svg' }
  const ownership = { id: 1, badgeId: 'ignition', badgeName: 'Fixture badge', badgeNameEn: 'Fixture', badgeLabel: 'Fixture badge', seriesId: 'fixture', seriesTitle: 'Fixture series', assetUrl: catalog.assetUrl, source: 'draw', applicationTarget: 'avatar', appliedInstanceId: null, appliedInstanceName: null, appliedAt: null, createdAt: '2026-10-28T00:00:00Z' }
  const overview = (avatarBadgeId = 'ignition') => ({ costs: { randomDraw: 10, select: 20 }, currentPoints: 1000, avatarBadgeId, catalog: [catalog], ownerships: [ownership], instances: [{ id: 9, name: 'Fixture instance', status: 'running', iconBadgeId: null, packagePlanId: 1, instanceType: 'container', host: { id: 1, name: 'Fixture host', location: 'Fixture', countryCode: 'US' } }] })
  const acceptOverview = async avatar => accept(await latest('overview'), overview(avatar))
  const alerts = () => page.eval(() => [...document.querySelectorAll('[role=alert]')].filter(el => el.checkVisibility()).length)
  const avatar = () => page.eval(() => window.badgeCenterHarness.auth.user.avatarBadgeId)
  const effects = () => page.eval(() => ({ updates: window.badgeCenterHarness.updates.value, toasts: window.badgeCenterHarness.toastEvents.length }))
  assert.equal(await count('overview'), 1)
  const first = await latest('overview'); await route('/other')
  assert.equal(await page.eval(index => window.badgeCenterHarness.pending[index].signal.aborted, first), true)
  await route('/badges'); const second = await latest('overview'); assert.notEqual(first, second)
  await accept(second, overview('new-avatar')); await accept(first, overview('old-avatar')); assert.equal(await avatar(), 'new-avatar')
  await route('/other'); await route('/badges'); const oldRead = await latest('overview')
  await run(() => window.badgeCenterHarness.session('b')); await reject(oldRead)
  assert.equal(await alerts(), 0); await acceptOverview('session-b')
  const stableReads = await count('overview'); await run(() => window.badgeCenterHarness.session('b', 2)); assert.equal(await count('overview'), stableReads)
  await route('/other'); await route('/badges'); await reject(await latest('overview')); assert.equal(await alerts(), 1)
  await page.screenshot({ path: resolve(output, 'load-error-desktop.png'), format: 'png' })
  await click('common.retry'); await acceptOverview()
  const base = await effects()
  await click('entertainment.badges.randomButton', { points: 10 }, 10); assert.equal(await count('random'), 1)
  const oldDraw = await latest('random'); await route('/other'); await route('/badges'); await acceptOverview()
  assert.equal(await page.eval(() => [...document.querySelectorAll('button')].some(el => el.checkVisibility() && el.disabled && el.textContent.includes(window.badgeCenterHarness.t('common.processing')))), true)
  await accept(oldDraw, { ownership, currentPoints: 990 }); assert.deepEqual(await effects(), base)
  assert.equal(await page.eval(() => !!document.querySelector('.modal-overlay')), false)
  await acceptOverview()
  await click('entertainment.badges.randomButton', { points: 10 }); await reject(await latest('random'))
  assert.equal((await effects()).toasts, base.toasts + 1)
  await click('entertainment.badges.randomButton', { points: 10 }); await accept(await latest('random'), { ownership, currentPoints: 990 })
  assert.equal(await page.eval(() => !!document.querySelector('.modal-overlay')), true)
  const postDrawRead = await latest('overview'); await route('/other'); await reject(postDrawRead)
  assert.equal((await effects()).updates, base.updates, 'stale post-write refresh must not emit')
  await route('/badges'); await acceptOverview()
  await click('entertainment.badges.randomButton', { points: 10 }); await accept(await latest('random'), { ownership, currentPoints: 990 }); await acceptOverview()
  assert.equal((await effects()).updates, base.updates + 1)
  await run(() => window.badgeCenterHarness.session('c')); await acceptOverview()
  for (const kind of ['multi', 'select', 'avatar', 'unapply']) {
    await run(kind => { window.badgeCenterHarness.initialTab.value = ['avatar', 'unapply'].includes(kind) ? 'my' : 'draw' }, kind)
    const keys = { multi: 'entertainment.badges.randomMultiButton', select: 'entertainment.badges.selectButton', avatar: 'entertainment.badges.applyAvatar', unapply: 'entertainment.badges.unapply' }
    const params = kind === 'multi' ? { points: 100 } : kind === 'select' ? { points: 20 } : undefined
    const previous = await count(kind)
    await click(keys[kind], params, 10); assert.equal(await count(kind), previous + 1, kind + ' duplicate gate')
    const request = await latest(kind), before = await effects()
    await run(kind => window.badgeCenterHarness.session('session-' + kind), kind)
    await acceptOverview(); await reject(request); assert.deepEqual(await effects(), before)
    await acceptOverview()
  }
  await click('entertainment.badges.selectInstance')
  await run(() => [...document.querySelectorAll('button')].find(el => el.checkVisibility() && el.textContent.includes('Fixture instance')).click())
  await click('entertainment.badges.applyInstanceButton', undefined, 10)
  assert.equal(await count('instance'), 1)
  assert.deepEqual(await page.eval(() => window.badgeCenterHarness.pending.at(-1).params), { ownershipId: 1, instanceId: 9 })
  const instanceRequest = await latest('instance'), beforeInstance = await effects()
  await route('/other'); await accept(instanceRequest, { ownership }); assert.deepEqual(await effects(), beforeInstance)
  await route('/badges'); await acceptOverview()
  for (const locale of ['zh-CN', 'zh-TW', 'en-US']) for (const width of [1440, 390]) {
    await run(({ locale, width }) => { window.badgeCenterHarness.setLocale(locale); window.badgeCenterHarness.theme.setTheme(width === 390 ? 'dark' : 'light') }, { locale, width })
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width === 390 })
    await page.screenshot({ path: resolve(output, `${locale}-${width}.png`), format: 'png' })
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= window.innerWidth), true)
  }
  await route('/other'); await route('/badges'); const last = await latest('overview')
  await run(() => { window.badgeCenterHarness.shown.value = false })
  assert.equal(await page.eval(index => window.badgeCenterHarness.pending[index].signal.aborted, last), true)
  await accept(last, overview('unmounted')); assert.notEqual(await avatar(), 'unmounted')
  console.log('BadgeCenter passed actual Vue/KeepAlive, delayed APIs: current overview/avatar, cancellation, cache/session/unmount, same SID, retry, stale draw/apply/unapply callbacks and duplicate gates; no live points or ownership writes.')
} finally { if (browser) await browser.close(); await server.close() }
