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
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/prize-editor/*.js']
const output = resolve(root, 'logs/prize-editor-browser'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const server = await createServer({ configFile: false, root: root + '/scripts/fixtures/prize-editor', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api(?:\/admin)?$/, replacement: root + '/scripts/fixtures/prize-editor/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19655, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19655/', { settleMs: 1200 })
  const readyDeadline = Date.now() + 15000
  while (!await page.eval(() => !!window.prizeHarness?.pending.some(item => item.kind === 'list'))) {
    if (Date.now() >= readyDeadline) throw new Error('Prize editor did not mount or request its initial list within 15 seconds')
    await sleep(100)
  }
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(60); return result }
  const latest = kind => page.eval(kind => window.prizeHarness.pending.findLastIndex(item => item.kind === kind), kind)
  const count = kind => page.eval(kind => window.prizeHarness.pending.filter(item => item.kind === kind).length, kind)
  const accept = (index, data) => run(({ index, data }) => window.prizeHarness.pending[index].resolve(data), { index, data })
  const reject = index => run(index => window.prizeHarness.pending[index].reject(new Error('Controlled save failure')), index)
  const click = (key, count = 1) => run(({ key, count }) => {
    const text = window.prizeHarness.t(key)
    const button = [...document.querySelectorAll('button')].find(el => el.checkVisibility() && (el.textContent.trim() === text || el.title === text))
    if (!button) throw Error('Missing button: ' + text)
    for (let i = 0; i < count; i++) button.click()
  }, { key, count })
  const field = (key, value, row = 0) => run(({ key, value, row }) => {
    const label = [...document.querySelectorAll('fieldset label')].filter(el => el.textContent.trim().startsWith(window.prizeHarness.t(key)))[row]
    const input = label?.parentElement.querySelector('input,select')
    if (!input) throw Error('Missing input: ' + key)
    input.value = value; input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
  }, { key, value, row })
  const prize = (id, revision = 0, remainQuantity = 10) => ({ id, revision, name: `Prize ${id}`, type: 'instance', value: 0, probability: 50, totalQuantity: 10, remainQuantity, displayOrder: id, instanceDesc: '' })
  const lottery = (id = 1, items = [prize(1), prize(2)]) => ({ id, name: `Lottery ${id}`, costPoints: 100, prizes: items, totalDraws: 0, isActive: true, createdAt: '2026-10-29T00:00:00Z' })
  const list = () => acceptLatest('list', { lotteries: [lottery(1), lottery(2, [prize(3)])], total: 2 })
  const acceptLatest = async (kind, data) => accept(await latest(kind), data)
  const payload = () => page.eval(() => window.prizeHarness.pending.findLast(item => item.kind === 'update').params)
  const alerts = () => page.eval(() => [...document.querySelectorAll('[role=alert]')].filter(el => el.checkVisibility()).length)
  const toasts = () => page.eval(() => window.prizeHarness.toastEvents.length)
  await list()
  await click('entertainment.admin.managePrizes')
  await click('common.save'); assert.equal(await count('update'), 0, 'cannot save before detail')
  await acceptLatest('detail', { lottery: lottery() })
  await field('entertainment.admin.replenish', 5)
  await click('common.save', 10)
  assert.equal(await count('update'), 1)
  assert.deepEqual(await payload(), { id: 1, data: { name: 'Prize 1', type: 'instance', value: 0, probability: 50, displayOrder: 0, instanceDesc: '', totalQuantity: 10, expectedRevision: 0, replenishAmount: 5 } })
  assert.equal(await page.eval(() => [...document.querySelectorAll('fieldset input,fieldset select,fieldset button')].every(el => el.matches(':disabled'))), true)
  await click('common.cancel'); assert.equal(await page.eval(() => !!document.querySelector('fieldset')), true)
  await acceptLatest('update', { success: true })
  assert.equal(await count('update'), 2)
  assert.equal((await payload()).id, 2)
  assert.equal('remainQuantity' in (await payload()).data, false)
  await reject(await latest('update'))
  assert.equal(await alerts(), 1)
  const failedCount = await count('update')
  await click('common.save', 10); assert.equal(await count('update'), failedCount)
  await click('common.retry'); await acceptLatest('detail', { lottery: lottery(1, [prize(1, 1, 14), prize(2)]) })
  assert.equal(await page.eval(() => [...document.querySelectorAll('fieldset input[type=number]')].filter(el => el.min === '0').every(el => el.value === '0')), true, 'reload clears already-applied replenishment')
  await click('common.save'); assert.equal((await payload()).data.expectedRevision, 1); assert.equal('replenishAmount' in (await payload()).data, false)
  await acceptLatest('update', { success: true }); await acceptLatest('update', { success: true }); await list()
  await sleep(250) // Wait for the modal's existing 200 ms leave transition before inspecting DOM.
  assert.equal(await page.eval(() => [...document.querySelectorAll('fieldset')].some(el => el.checkVisibility())), false)

  await click('entertainment.admin.managePrizes'); const oldRead = await latest('detail')
  await click('common.cancel'); await sleep(230); await click('entertainment.admin.managePrizes'); const newRead = await latest('detail')
  await accept(oldRead, { lottery: lottery(9) }); assert.equal(await page.eval(() => document.body.innerText.includes('Lottery 9')), false)
  await reject(newRead); assert.equal(await alerts(), 1)
  await click('common.retry'); await acceptLatest('detail', { lottery: lottery(1, [prize(1, 2, 14)]) })
  const beforeInvalid = await count('update')
  await field('entertainment.admin.replenish', -1); await click('common.save'); assert.equal(await count('update'), beforeInvalid)
  await field('entertainment.admin.replenish', 0)
  await field('entertainment.admin.quantity', ''); await click('common.save'); assert.equal((await payload()).data.totalQuantity, null)
  const staleSave = await latest('update'), beforeSession = await toasts()
  await run(() => window.prizeHarness.session('b')); await accept(staleSave, { success: true })
  assert.equal(await toasts(), beforeSession, 'old session has no success effect')
  assert.equal(await count('update'), beforeInvalid + 1, 'old batch does not continue')
  await click('entertainment.admin.managePrizes'); await acceptLatest('detail', { lottery: lottery(1, [prize(1, 3)]) })
  for (const locale of ['zh-CN', 'zh-TW', 'en-US']) for (const width of [1440, 390]) {
    await run(({ locale, width }) => { window.prizeHarness.setLocale(locale); window.prizeHarness.theme.setTheme(width === 390 ? 'dark' : 'light') }, { locale, width })
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width === 390 })
    await page.screenshot({ path: resolve(output, `${locale}-${width}.png`) })
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
  }
  await click('common.save'); const hiddenSave = await latest('update'), beforeHidden = await toasts()
  await run(() => window.prizeHarness.router.push('/other')); await reject(hiddenSave)
  assert.equal(await toasts(), beforeHidden)
  await run(() => { window.prizeHarness.setLocale('zh-CN'); return window.prizeHarness.router.push('/entertainment') })
  const openNotification = () => click('entertainment.admin.notification.title')
  const formValue = label => page.eval(label => document.querySelector(`fieldset [aria-label="${label}"]`)?.value, label)
  const configFor = type => ({ enabled: false, type, notifyBalance: false, notifyInstance: true, config:
    type === 'telegram' ? { botToken: 'inert-fixture-value', chatId: '-1000' } :
    type === 'discord' ? { webhookUrl: 'https://example.invalid/inert-discord' } : { url: 'https://example.invalid/inert-webhook', secret: 'inert-fixture-value' } })
  for (const type of ['telegram', 'discord', 'webhook']) {
    await openNotification(); await click('common.save', 10)
    const beforeWrite = await count('notification')
    await acceptLatest('detail', { lottery: { ...lottery(), notificationConfig: configFor(type) } })
    assert.equal(await page.eval(() => document.querySelector('fieldset select').value), type)
    assert.equal(await page.eval(() => document.querySelector('fieldset input[type=checkbox]').checked), false)
    if (type === 'telegram') assert.equal(await formValue('Bot Token'), 'inert-fixture-value')
    else assert.equal(await formValue('Webhook URL'), configFor(type).config[type === 'discord' ? 'webhookUrl' : 'url'])
    await click('common.save', 10)
    assert.equal(await count('notification'), beforeWrite + 1)
    assert.deepEqual(await page.eval(() => window.prizeHarness.pending.findLast(item => item.kind === 'notification').params), { id: 1, data: configFor(type) })
    assert.equal(await page.eval(() => [...document.querySelectorAll('fieldset input,fieldset select')].every(el => el.matches(':disabled'))), true)
    await acceptLatest('notification', { success: true }); await list(); await sleep(250)
  }
  await openNotification(); const earlier = await latest('detail')
  await click('common.cancel'); await sleep(250); await openNotification(); const later = await latest('detail')
  await accept(earlier, { lottery: { ...lottery(), notificationConfig: configFor('discord') } })
  assert.equal(await formValue('Bot Token'), '', 'old read must not restore secrets into new form')
  await reject(later); const failedNotification = await count('notification')
  await click('common.save'); assert.equal(await count('notification'), failedNotification)
  await click('common.retry'); await acceptLatest('detail', { lottery: { ...lottery(), notificationConfig: configFor('telegram') } })
  for (const locale of ['zh-CN', 'zh-TW', 'en-US']) for (const width of [1440, 390]) {
    await run(({ locale, width }) => { window.prizeHarness.setLocale(locale); window.prizeHarness.theme.setTheme(width === 390 ? 'dark' : 'light') }, { locale, width })
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width === 390 })
    await page.screenshot({ path: resolve(output, `notification-${locale}-${width}.png`) })
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
  }
  await click('common.save'); await reject(await latest('notification'))
  assert.equal(await alerts(), 1); assert.equal(await formValue('Bot Token'), 'inert-fixture-value', 'current failed save preserves draft')
  await click('common.save'); const staleNotification = await latest('notification'), oldEffects = await toasts()
  await run(() => window.prizeHarness.session('notification-new')); await accept(staleNotification, { success: true })
  assert.equal(await toasts(), oldEffects)
  await sleep(250); await openNotification(); await acceptLatest('detail', { lottery: { ...lottery(), notificationConfig: null } })
  assert.equal(await formValue('Bot Token'), '', 'confirmed no config gets clean defaults')
  await click('common.cancel'); await sleep(250); await openNotification(); const hiddenRead = await latest('detail')
  await run(() => window.prizeHarness.router.push('/other')); await accept(hiddenRead, { lottery: { ...lottery(), notificationConfig: configFor('telegram') } })
  await sleep(250)
  assert.equal(await page.eval(() => [...document.querySelectorAll('fieldset')].some(el => el.checkVisibility())), false)
  console.log('PASS notification editor: detail configuration for all 3 types, exact save payload, read failure blocks overwrite, retry/defaults, duplicate/frozen save and close/session/cache guards. Inert credentials only; no messages sent.')
  console.log('PASS actual admin Vue prize editor: fresh read, delta/revision payload, duplicate gate/frozen inputs, partial failure blocks resend, reload clears increment, null/unlimited, invalid inventory, closed/session/cache stale results and three-language desktop/mobile layout. Controlled API, no real account writes.')
} finally { if (browser) await browser.close(); await server.close() }
