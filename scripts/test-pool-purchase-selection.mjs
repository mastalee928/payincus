import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Browser, sleep } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'
import { probe, layout, app as appProbe } from '../.agents/skills/design-taste-frontend/scripts/lib/probe.mjs'
import { judge, judgeLayout, judgeApp, APP_SKIP } from '../.agents/skills/design-taste-frontend/scripts/lib/rules.mjs'

// Real Vue/Pinia/router, with deferred local API responses. No production API or payment.
const root = fileURLToPath(new URL('..', import.meta.url)).replaceAll('\\', '/')
const require = createRequire(new URL('../client/package.json', import.meta.url))
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href)
const { default: vue } = await import(pathToFileURL(require.resolve('@vitejs/plugin-vue')).href)
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js')
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/pool-checkout/*.js']
const out = root + '/logs/pool-purchase-selection'
mkdirSync(out, { recursive: true })
const server = await createServer({ configFile: false, root: root + '/scripts/fixtures/pool-checkout', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/pool-checkout/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } }, server: { host: '127.0.0.1', port: 19831, strictPort: true, fs: { allow: [root] } } })
const product = (id, resourcePreset, monthlyPrice, memoryMiB = 768, idle = 5) => ({ id, resourcePreset, monthlyPrice, memoryMiB, cpu: resourcePreset === 'ARM4C' ? 400 : 200, diskGiB: 30, setupFee: 100, idle, total: 5 })
const catalog = { maxInstances: 100, regions: [
  { id: 10, name: 'E2 · 美国东部（阿什本）', countryCode: 'us', products: [product(20, 'E2', 1000)] },
  { id: 11, name: 'ARM · 美国东部（阿什本）', countryCode: 'us', products: [product(21, 'ARM2C', 1900, 2048)] },
  { id: 30, name: 'E2 · 德国中部（法兰克福）', countryCode: 'de', products: [product(40, 'E2', 2200)] },
  { id: 31, name: 'ARM · 德国中部（法兰克福）', countryCode: 'de', products: [product(41, 'ARM2C', 3100, 2048)] },
  { id: 50, name: 'ARM · 法国中部（巴黎）', countryCode: 'fr', products: [product(60, 'ARM4C', 4300, 4096)] },
  { id: 70, name: 'E2 · 韩国中部（首尔）', countryCode: 'kr', products: [product(80, 'E2', 900, 768, 0)] }
] }
const imageReply = { images: [
  { name: 'Debian 12 x86', remoteAlias: 'debian/x86', architecture: 'x86_64' },
  { name: 'Debian 12 ARM', remoteAlias: 'debian/arm', architecture: 'aarch64' }
] }
let browser
const evidence = []
try {
  await server.listen(); browser = await Browser.launch()
  const page = await browser.newPage()
  await page.goto('http://127.0.0.1:19831', { settleMs: 300 })
  const run = (fn, arg) => page.eval(fn, arg)
  const wait = async fn => { const end = Date.now() + 8000; while (!await run(fn)) { assert.ok(Date.now() < end, await run(() => document.body.innerText)); await sleep(25) } }
  await wait(() => !!window.checkoutHarness)
  const reply = (index, data, failed = false) => run(({ index, data, failed }) => {
    const r = window.checkoutHarness.requests[index]; if (!r || r.done) throw Error('Invalid request ' + index)
    r.done = true; failed ? r.reject(data) : r.resolve(data)
  }, { index, data, failed })
  const pendingImages = () => run(() => window.checkoutHarness.requests.findLastIndex(r => r.kind === 'images' && !r.done))
  const replyImages = async () => { await wait(() => window.checkoutHarness.requests.some(r => r.kind === 'images' && !r.done)); await reply(await pendingImages(), imageReply); await sleep(25) }
  const enter = async (path = '/purchase', authenticated = true) => {
    await run(async authenticated => {
      const h = window.checkoutHarness
      await h.router.push('/checkout'); h.cart.clear()
      if (authenticated) h.account(1)
      else { h.auth.token = null; h.auth.user = null; localStorage.removeItem('token') }
    }, authenticated)
    const after = await run(() => window.checkoutHarness.requests.length)
    await run(path => window.checkoutHarness.router.push(path), path)
    const count = authenticated ? 2 : 1
    await wait(() => !!document.querySelector('.purchase-page'))
    const until = Date.now() + 8000
    let indexes = []
    while (indexes.length !== count) {
      indexes = await run(after => window.checkoutHarness.requests.flatMap((r, i) => i >= after && r.kind === 'catalog' && !r.done ? [i] : []), after)
      assert.ok(Date.now() < until, 'expected current catalog requests'); if (indexes.length !== count) await sleep(25)
    }
    for (const index of indexes) await reply(index, catalog)
    await wait(() => !!document.querySelector('.purchase-region-option'))
  }
  const choose = async (selector, text, expectedPresets) => {
    const frames = await run(async ({ selector, text }) => {
      const el = [...document.querySelectorAll(selector)].find(e => e.textContent.includes(text))
      if (!el || el.disabled) throw Error('Unavailable selection ' + text)
      const result = []
      const snapshot = () => ({
        presets: [...document.querySelectorAll('.purchase-config-option .purchase-preset')].map(e => e.textContent),
        selected: [...document.querySelectorAll('.purchase-config-option[aria-pressed="true"] .purchase-preset')].map(e => e.textContent),
        region: document.querySelector('.purchase-selected-region')?.textContent ?? null,
        total: document.querySelector('.purchase-grand-total strong')?.textContent ?? null,
        image: document.querySelector('.image-selector-trigger-embedded')?.textContent.trim() ?? null,
        quantity: document.querySelector('#purchase-quantity')?.value ?? null,
        activeBuy: !!document.querySelector('.purchase-actions button:not(:disabled)')
      })
      el.click()
      // The first rendering opportunity matters; waiting out a transition would hide the bug.
      for (let i = 0; i < 8; i++) { await new Promise(requestAnimationFrame); result.push(snapshot()) }
      return result
    }, { selector, text })
    if (expectedPresets) for (const frame of frames) assert.deepEqual(frame.presets, expectedPresets, 'no outgoing configuration remains for even one frame')
    evidence.push({ selector, text, frames })
    return frames
  }
  const continent = (text, presets = []) => choose('.purchase-continents button', text, presets)
  const region = (text, presets) => choose('.purchase-region-option', text, presets)
  const configuration = text => choose('.purchase-config-option', text)
  const fill = () => run(() => { const el = document.querySelector('.purchase-input'); el.value = 'selection-test'; el.dispatchEvent(new Event('input', { bubbles: true })) })
  const currentSummary = () => run(() => ({ region: document.querySelector('.purchase-selected-region')?.textContent, total: document.querySelector('.purchase-grand-total strong')?.textContent }))
  const assertEmpty = frames => { for (const f of frames) { assert.equal(f.region, null); assert.equal(f.total, null); assert.equal(f.image, null); assert.equal(f.activeBuy, false) } }

  await enter(); await replyImages(); await fill()
  assert.match((await currentSummary()).region, /阿什本/)
  await run(() => {
    const oldCartButton = document.querySelector('.purchase-actions .purchase-primary')
    const oldDirectButton = document.querySelector('.purchase-actions .purchase-secondary')
    ;[...document.querySelectorAll('.purchase-continents button')].find(e => e.textContent.includes('欧洲')).click()
    // DOM patch has not happened yet: the old button handlers still must reject the old selection.
    oldCartButton.click(); oldDirectButton.click()
  })
  assert.equal(await run(() => window.checkoutHarness.cart.items.length), 0)
  assert.equal(await run(() => window.checkoutHarness.router.currentRoute.value.path), '/purchase')
  assert.equal(await run(() => [...Array(sessionStorage.length)].some((_, i) => sessionStorage.key(i).startsWith('incudal.direct-purchase.'))), false)
  await continent('北美'); await region('阿什本', ['E2', 'ARM 2C']); await replyImages(); await fill()
  assertEmpty(await continent('欧洲'))
  await region('法兰克福', ['E2', 'ARM 2C']); await replyImages(); await fill()
  assert.deepEqual(await currentSummary(), { region: '德国中部（法兰克福）', total: '¥23.00' })
  await configuration('ARM 2C'); await replyImages()
  await run(() => { const el = document.querySelector('#purchase-quantity'); el.value = '3'; el.dispatchEvent(new Event('input', { bubbles: true })) })
  const parisFrames = await region('巴黎', ['ARM 4C'])
  for (const f of parisFrames) { assert.match(f.region, /巴黎/); assert.equal(f.total, '¥44.00'); assert.equal(f.quantity, '1'); assert.equal(f.image, null); assert.equal(f.activeBuy, false) }
  await replyImages(); await fill()
  assertEmpty(await continent('亚太'))
  assert.equal(await run(() => [...document.querySelectorAll('.purchase-region-option')].find(e => e.textContent.includes('首尔')).disabled), true)
  assertEmpty(await continent('北美'))
  await region('阿什本', ['E2', 'ARM 2C'])
  const oldNorth = await pendingImages()
  await continent('欧洲'); await region('法兰克福', ['E2', 'ARM 2C'])
  const oldEurope = await pendingImages()
  await region('巴黎', ['ARM 4C'])
  const newest = await pendingImages()
  await reply(oldNorth, imageReply); await reply(oldEurope, { message: 'obsolete image failure' }, true)
  assert.equal(await run(() => !!document.querySelector('.purchase-alert')), false, 'obsolete error cannot cover the new selection')
  assert.equal(await run(() => !!document.querySelector('.image-selector-trigger-embedded')), false, 'old replies cannot end current image loading')
  await reply(newest, imageReply); await fill()
  assert.match(await run(() => document.querySelector('.image-selector-trigger-embedded').textContent), /ARM/)

  // Search can cross continents. Selecting a result establishes its actual continent.
  await run(() => { const el = document.querySelector('.purchase-region-search input'); el.value = 'Ashburn'; el.dispatchEvent(new Event('input', { bubbles: true })) })
  await sleep(25)
  assert.equal(await run(() => !!document.querySelector('.purchase-config-grid')), false, 'search hiding the old region also clears its configuration')
  await region('阿什本', ['E2', 'ARM 2C']); await replyImages()
  await run(() => { const el = document.querySelector('.purchase-region-search input'); el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })) })
  assert.equal(await run(() => document.querySelector('.purchase-continents button[aria-pressed="true"]').textContent.trim()), '北美')
  await configuration('ARM 2C'); await replyImages(); await fill()
  const same = await continent('北美', ['E2', 'ARM 2C'])
  for (const f of same) assert.deepEqual(f.selected, ['ARM 2C'], 'same continent does not change a valid choice')
  const sameRegion = await region('阿什本', ['E2', 'ARM 2C'])
  for (const f of sameRegion) assert.deepEqual(f.selected, ['ARM 2C'], 'same region does not reset an explicitly chosen configuration')
  assertEmpty(await continent('全部'))
  await region('巴黎', ['ARM 4C']); await replyImages(); await fill()
  await run(() => document.querySelector('.purchase-actions .purchase-primary').click())
  const cartItem = await run(() => JSON.parse(JSON.stringify(window.checkoutHarness.cart.items[0])))
  assert.equal(cartItem.poolPriceId, 60); assert.equal(cartItem.snapshot.regionId, 50); assert.equal(cartItem.image, 'debian/arm')
  assert.equal(cartItem.snapshot.monthlyPrice, 4300)
  await continent('北美'); await region('阿什本', ['E2', 'ARM 2C']); await replyImages(); await fill()
  await run(() => document.querySelector('.purchase-actions .purchase-secondary').click())
  await wait(() => window.checkoutHarness.router.currentRoute.value.path === '/order/confirm')
  const draft = await run(() => {
    const h = window.checkoutHarness, id = h.router.currentRoute.value.query.draft
    return JSON.parse(sessionStorage.getItem(`incudal.direct-purchase.${h.auth.user.id}.${id}`))
  })
  assert.equal(draft.poolPriceId, 20); assert.equal(draft.snapshot.regionId, 10); assert.equal(draft.image, 'debian/x86')
  assert.equal(await run(() => window.checkoutHarness.cart.items[0].poolPriceId), 60, 'direct purchase preserves the unrelated cart line')
  console.log('PASS continents, same choice, stock-zero, geographic E2/ARM grouping, eight-frame immediate configuration/price update, stale image replies, search and correct cart/direct payloads')

  await enter('/purchase?region=50&product=60', false)
  assert.match((await currentSummary()).region, /巴黎/)
  assert.equal(await run(() => document.querySelector('.purchase-continents button[aria-pressed="true"]').textContent.trim()), '欧洲')
  assertEmpty(await continent('北美'))
  await region('阿什本', ['E2', 'ARM 2C'])
  assert.match((await currentSummary()).region, /阿什本/)
  assert.equal(await run(() => !!document.querySelector('.purchase-instance-fields')), false)
  await enter('/purchase?region=31&product=41'); await replyImages(); await fill()
  assert.equal(await run(() => document.querySelector('.purchase-config-option[aria-pressed="true"] .purchase-preset').textContent), 'ARM 2C')
  await region('巴黎', ['ARM 4C'])
  await reply(await pendingImages(), { message: 'current image failure' }, true)
  await wait(() => !!document.querySelector('.purchase-alert button'))
  const refreshStart = await run(() => window.checkoutHarness.requests.length)
  await run(() => document.querySelector('.purchase-alert button').click())
  let refreshIndexes = []
  const refreshDeadline = Date.now() + 8000
  while (refreshIndexes.length !== 2) {
    refreshIndexes = await run(after => window.checkoutHarness.requests.flatMap((r, i) => i >= after && r.kind === 'catalog' && !r.done ? [i] : []), refreshStart)
    assert.ok(Date.now() < refreshDeadline, 'retry should request two current catalogs'); if (refreshIndexes.length !== 2) await sleep(25)
  }
  for (const index of refreshIndexes) await reply(index, catalog)
  await replyImages(); await fill()
  assert.match((await currentSummary()).region, /法兰克福/)
  assert.equal(await run(() => document.querySelector('.purchase-continents button[aria-pressed="true"]').textContent.trim()), '欧洲', 'catalog retry preserves the selected continent')
  await run(() => { const el = document.querySelector('.purchase-region-search input'); el.value = 'not-a-region'; el.dispatchEvent(new Event('input', { bubbles: true })) })
  await sleep(25)
  assert.equal(await run(() => !!document.querySelector('.purchase-config-grid')), false)
  await run(() => { const el = document.querySelector('.purchase-region-search input'); el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })) })
  assert.equal(await run(() => !!document.querySelector('.purchase-config-grid')), false, 'clearing search does not revive an old selection')
  console.log('PASS anonymous selection, login-only actions and authenticated E2/ARM deep links')

  for (const width of [1440, 768, 390]) for (const theme of ['light', 'dark']) {
    await page.setViewport({ width, height: 900 }); await run(theme => window.checkoutHarness.theme.setTheme(theme), theme)
    for (const motion of ['no-preference', 'reduce']) {
      await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: motion }] })
      await continent('北美'); await region('阿什本', ['E2', 'ARM 2C']); await replyImages()
      assertEmpty(await continent('欧洲')); await region('法兰克福', ['E2', 'ARM 2C']); await replyImages()
      const frames = await region('巴黎', ['ARM 4C'])
      for (const f of frames) { assert.match(f.region, /巴黎/); assert.equal(f.total, '¥44.00') }
      await replyImages(); await fill()
      evidence.push({ width, theme, motion, passed: true })
    }
    await region('法兰克福', ['E2', 'ARM 2C']); await replyImages(); await fill()
    assert.deepEqual(await run(() => [...document.querySelectorAll('.purchase-config-option .purchase-stock')].map(e => e.textContent.trim())), ['库存:5', '库存:5'])
    const specGeometry = await run(() => [...document.querySelectorAll('.purchase-config-specs')].map(group => [...group.children].map(item => {
      const r = item.getBoundingClientRect(), icon = item.querySelector('svg').getBoundingClientRect(), value = item.querySelector('span').getBoundingClientRect()
      return { x: r.x, top: r.top, width: r.width, center: r.x + r.width / 2, iconCenter: icon.x + icon.width / 2, valueCenter: value.x + value.width / 2, iconBottom: icon.bottom, valueTop: value.top, valueRight: value.right, right: r.right }
    })))
    for (const items of specGeometry) {
      assert.equal(items.length, 3)
      for (const item of items) { assert.ok(Math.abs(item.top - items[0].top) < 1, 'three specs share one row'); assert.ok(item.iconBottom < item.valueTop, 'icon above its value'); assert.ok(item.valueRight <= item.right + 1, 'value fits its column') }
      for (const item of items) { assert.ok(Math.abs(item.iconCenter - item.center) < 1, 'icon centered in its column'); assert.ok(Math.abs(item.valueCenter - item.center) < 1, 'value centered below its icon, including 768 MiB') }
      assert.ok(items[0].x < items[1].x && items[1].x < items[2].x)
    }
    assert.equal(await run(() => document.documentElement.scrollWidth > innerWidth), false)
    const metrics = await page.eval(probe), lay = await page.eval(layout), screen = await page.eval(appProbe)
    const findings = [...judge(metrics, { width, allow: [] }), ...judgeLayout(lay, { width, allow: [] })].filter(f => !APP_SKIP.has(f.id)).concat(judgeApp(screen, metrics, { width, allow: [] }))
    writeFileSync(`${out}/${width}-${theme}-inspection.json`, JSON.stringify(findings, null, 2))
    await page.screenshot({ path: `${out}/${width}-${theme}.png`, format: 'png', fullPage: true })
    assert.ok(!findings.some(f => f.level === 'FAIL'), JSON.stringify(findings.filter(f => f.level === 'FAIL')))
  }
  writeFileSync(out + '/verified.json', JSON.stringify({ verifiedAt: new Date().toISOString(), scope: 'real local Vue; controlled catalog/images; no payment or production request', evidence }, null, 2))
  console.log('PASS three widths, light/dark and both motion preferences: first-frame selection, horizontal CPU/memory/disk with icons above values, and six screenshots with taste inspection')
} finally { if (browser) await browser.close(); await server.close() }
