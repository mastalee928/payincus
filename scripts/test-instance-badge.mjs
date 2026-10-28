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
const output = resolve(root, 'logs/instance-badge-browser'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const server = await createServer({ configFile: false, root: root + '/scripts/fixtures/badge-center', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/badge-center/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19651, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19651/?instance', { settleMs: 1200 })
  const run = async (fn, arg) => { const value = await page.eval(fn, arg); await sleep(45); return value }
  const latest = kind => page.eval(kind => window.badgeCenterHarness.pending.findLastIndex(item => item.kind === kind), kind)
  const count = kind => page.eval(kind => window.badgeCenterHarness.pending.filter(item => item.kind === kind).length, kind)
  const accept = (index, data) => run(({ index, data }) => window.badgeCenterHarness.pending[index].resolve(data), { index, data })
  const reject = index => run(index => window.badgeCenterHarness.pending[index].reject(new Error('Isolated modal failure')), index)
  const click = (key, count = 1) => run(({ key, count }) => {
    const text = window.badgeCenterHarness.t(key)
    const button = [...document.querySelectorAll('button')].find(el => el.checkVisibility() && el.textContent.trim() === text)
    if (!button) throw Error('Missing button: ' + text)
    for (let i = 0; i < count; i++) button.click()
  }, { key, count })
  const setId = id => run(id => { window.badgeCenterHarness.instanceId.value = id }, id)
  const visible = value => run(value => { window.badgeCenterHarness.modalVisible.value = value }, value)
  const route = path => run(path => window.badgeCenterHarness.router.push(path), path)
  const catalog = { id: 'ignition', name: 'Modal badge', nameEn: 'Modal badge', fullLabel: 'Modal badge', seriesId: 'fixture', seriesTitle: 'Fixture series', seriesDescription: '', assetUrl: '/badges/light/ignition.svg' }
  const owned = (appliedInstanceId = null) => ({ id: 1, badgeId: 'ignition', badgeName: 'Modal badge', badgeNameEn: 'Modal badge', badgeLabel: 'Modal badge', seriesId: 'fixture', seriesTitle: 'Fixture series', assetUrl: catalog.assetUrl, source: 'draw', applicationTarget: appliedInstanceId ? 'instance' : null, appliedInstanceId, appliedInstanceName: appliedInstanceId ? `Instance ${appliedInstanceId}` : null, appliedAt: null, createdAt: '2026-10-28T00:00:00Z' })
  const overview = (id, applied = null) => ({ costs: { randomDraw: 10, select: 20 }, currentPoints: 100, avatarBadgeId: null, catalog: [catalog], ownerships: [owned(applied)], instances: [{ id, name: `Instance ${id}`, iconBadgeId: applied === id ? 'ignition' : null, status: 'running', packagePlanId: 1, instanceType: 'container', host: { id: 1, name: 'Fixture host', location: 'Fixture', countryCode: 'US' } }] })
  const acceptOverview = async (id, applied = null) => accept(await latest('overview'), overview(id, applied))
  const effects = () => page.eval(() => ({ updates: window.badgeCenterHarness.badgeUpdates.value, toasts: window.badgeCenterHarness.toast.toasts.value.length }))
  const alerts = () => page.eval(() => [...document.querySelectorAll('[role=alert]')].filter(el => el.checkVisibility()).length)
  assert.equal(await count('overview'), 1, 'initially visible modal must load once')
  const first = await latest('overview'); await setId(2); const second = await latest('overview')
  assert.equal(await page.eval(index => window.badgeCenterHarness.pending[index].signal.aborted, first), true)
  await accept(second, overview(2)); await accept(first, overview(1, 1))
  assert.equal(await page.eval(() => document.body.innerText.includes('当前未设置实例徽章')), true)
  await visible(false); await visible(true); const oldOpen = await latest('overview')
  await visible(false); await visible(true); const newOpen = await latest('overview')
  await reject(oldOpen); assert.equal(await alerts(), 0)
  await accept(newOpen, overview(2)); await run(() => window.badgeCenterHarness.session('b'))
  const oldSession = await latest('overview'); await run(() => window.badgeCenterHarness.session('c'))
  await reject(oldSession); assert.equal(await alerts(), 0); await acceptOverview(2)
  const beforeToken = await count('overview'); await run(() => window.badgeCenterHarness.session('c', 2)); assert.equal(await count('overview'), beforeToken)
  await visible(false); await visible(true); await reject(await latest('overview')); assert.equal(await alerts(), 1)
  await click('common.retry'); await acceptOverview(2)
  await click('instance.badgeModal.ownedTab'); await click('instance.badgeModal.applyCurrent', 10)
  assert.equal(await count('instance'), 1)
  const applying = await latest('instance'), before = await effects()
  assert.deepEqual(await page.eval(index => window.badgeCenterHarness.pending[index].params, applying), { ownershipId: 1, instanceId: 2 })
  await setId(3); await acceptOverview(3); await click('instance.badgeModal.ownedTab')
  assert.equal(await page.eval(() => [...document.querySelectorAll('button')].some(el => el.disabled && el.textContent.includes(window.badgeCenterHarness.t('common.processing')))), true)
  await accept(applying, { ownership: owned(2) }); assert.deepEqual(await effects(), before); await acceptOverview(3)
  await click('instance.badgeModal.ownedTab'); await click('instance.badgeModal.applyCurrent')
  const oldWrite = await latest('instance'); await visible(false); await reject(oldWrite)
  assert.deepEqual(await effects(), before)
  await visible(true); await acceptOverview(3, 3)
  await click('instance.badgeModal.removeCurrent', 10); assert.equal(await count('unapply'), 1)
  const removing = await latest('unapply'); await run(() => window.badgeCenterHarness.session('d')); await acceptOverview(3)
  await accept(removing, { ownership: owned() }); assert.deepEqual(await effects(), before); await acceptOverview(3)
  await route('/other'); await route('/instance'); const cachedRead = await latest('overview')
  await route('/other'); await reject(cachedRead); assert.deepEqual(await effects(), before)
  await route('/instance'); await acceptOverview(3)
  for (const locale of ['zh-CN', 'zh-TW', 'en-US']) for (const width of [1440, 390]) {
    await run(({ locale, width }) => { window.badgeCenterHarness.setLocale(locale); window.badgeCenterHarness.theme.setTheme(width === 390 ? 'dark' : 'light') }, { locale, width })
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width === 390 })
    await page.screenshot({ path: resolve(output, `${locale}-${width}.png`), format: 'png' })
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= window.innerWidth), true)
  }
  await visible(false); await visible(true); const unmounted = await latest('overview')
  await run(() => { window.badgeCenterHarness.modalMounted.value = false }); await reject(unmounted)
  assert.deepEqual(await effects(), before)
  console.log('InstanceBadgeModal passed actual Vue: initially open, close/reopen, instance/session/cache/unmount changes, cancellation, old read/action effects, retry and pending-action duplicate gates. API is controlled; no live badge writes.')
} finally { if (browser) await browser.close(); await server.close() }
