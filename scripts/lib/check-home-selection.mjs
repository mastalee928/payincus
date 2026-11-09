import assert from 'node:assert/strict'
import { sleep } from '../../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'

// Select a real region before measuring. Changing continents alone clears this card.
export async function checkHomeSelection(page, out) {
  const observations = []
  const wait = async fn => {
    const end = Date.now() + 15000
    while (!await page.eval(fn)) { assert.ok(Date.now() < end, 'selection timed out: ' + fn); await sleep(40) }
  }
  const select = async slug => {
    await page.eval(slug => window.cameraHarness.router.replace({ path: '/', query: { region: slug } }), slug)
    await sleep(100)
    assert.equal(await page.eval(() => new URLSearchParams(location.search).get('region')), slug)
  }
  const measure = () => page.eval(() => {
    const rect = e => e?.getBoundingClientRect().toJSON()
    const visible = s => [...document.querySelectorAll(s)].find(e => e.getBoundingClientRect().width > 0)
    const card = visible('.minimal-selection')
    const action = card?.querySelector('.selection-action')
    const legend = visible('.atlas-legend')
    return {
      width: innerWidth, height: innerHeight, region: new URLSearchParams(location.search).get('region'),
      map: rect(document.querySelector('.atlas-map')), card: rect(card), controls: rect(visible('.map-controls')),
      legend: rect(legend), legendChildren: [...(legend?.children ?? [])].map(rect),
      children: [...(card?.children ?? [])].map(e => ({ text: e.textContent, ...rect(e), overflow: e.scrollWidth - e.clientWidth })),
      action: action ? { ...rect(action), href: action.getAttribute('href'), disabled: action.disabled === true } : null,
      mobileCard: rect(visible('.mobile-region-card.is-current')),
      overflow: document.documentElement.scrollWidth - innerWidth
    }
  })
  const overlap = (a, b) => a && b && a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y
  const check = async (label, expectedPurchase) => {
    const s = await measure()
    const context = label + ' ' + JSON.stringify(s)
    assert.equal(s.overflow, 0, context)
    if (s.width < 768) {
      assert.ok(!s.card && s.mobileCard?.width > 0, 'phone keeps its selected swipe card: ' + context)
    } else {
      assert.ok(s.card?.width > 0, 'selected card must exist: ' + context)
      const offset = s.card.x + s.card.width / 2 - s.map.x - s.map.width / 2
      assert.ok(Math.abs(offset) < 1, 'selected card must center on the map: ' + context)
      assert.ok(s.card.x >= s.map.x && s.card.right <= s.map.right && s.card.y >= s.map.y && s.card.bottom <= s.map.bottom, context)
      for (const neighbor of [s.controls, s.legend, ...s.legendChildren]) assert.ok(!overlap(s.card, neighbor), 'card overlaps legend/zoom: ' + context)
      for (const [i, a] of s.children.entries()) {
        assert.ok(a.x >= s.card.x && a.right <= s.card.right && a.y >= s.card.y && a.bottom <= s.card.bottom && a.overflow <= 1, 'card content clipped: ' + context)
        for (const b of s.children.slice(i + 1)) assert.ok(!overlap(a, b), 'card children overlap: ' + context)
      }
      assert.ok(s.action.height >= 44, 'action keeps touch height: ' + context)
      if (expectedPurchase) assert.match(s.action.href ?? '', /^\/purchase\?region=\d+$/, context)
      else assert.ok(s.action.disabled && !s.action.href, 'unavailable inventory cannot buy: ' + context)
      s.centerOffset = offset
    }
    observations.push({ label, ...s })
    return s
  }
  const click = async (selector, touch = false) => {
    await page.eval(s => document.querySelector(s).scrollIntoView({ block: 'center', behavior: 'instant' }), selector)
    await sleep(80)
    const p = await page.eval(s => {
      const e = document.querySelector(s), r = e.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2
      if (!e.contains(document.elementFromPoint(x, y))) throw Error('selection action obstructed: ' + s)
      return { x, y }
    }, selector)
    if (touch) {
      await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...p, id: 1 }] }); await sleep(50)
      await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    } else {
      await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...p, button: 'left', clickCount: 1 })
      await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...p, button: 'left', clickCount: 1 })
    }
    await sleep(120)
  }
  await page.goto('http://127.0.0.1:19834/?region=uk-london-1', { settleMs: 500 })
  await wait(() => !!document.querySelector('.minimal-selection a'))
  const sizes = [[768,1024],[820,1180],[900,600],[1024,768],[1050,900],[1051,700],[1280,800],[1440,900],[1604,1034],[1920,1080],[2560,1440],[3440,1440],
    [768,390],[844,390],[1024,500],[1280,560],[1440,500],[1920,600],[2560,720],[3440,900]]
  for (const [width, height] of sizes) {
    await page.setViewport({ width, height, mobile: width <= 1050 }); await sleep(150)
    for (const locale of ['zh-CN', 'zh-TW', 'en']) for (const theme of ['light', 'dark']) {
      await page.eval(({ locale, theme }) => { window.cameraHarness.setLocale(locale); window.cameraHarness.theme.setTheme(theme) }, { locale, theme })
      for (const slug of ['uk-london-1', 'af-johannesburg-1']) {
        await select(slug)
        await check(`${width}/${locale}/${theme}/${slug}`, slug === 'uk-london-1')
      }
    }
    console.log(`PASS selected card ${width}x${height}: centered, clear of legend/zoom, three languages/two themes, available/sold out`)
  }
  // Match the reported image, plus a narrow English tablet and the unchanged mobile strip.
  for (const [width, height, locale, slug] of [[1604,1034,'zh-CN','ap-mumbai-1'],[768,1024,'en','af-johannesburg-1'],[390,844,'zh-CN','uk-london-1'],[767,900,'en','uk-london-1']]) {
    await page.setViewport({ width, height, mobile: width < 1051 })
    await page.eval(locale => { window.cameraHarness.setLocale(locale); window.cameraHarness.theme.setTheme('dark') }, locale)
    await select(slug); await check('screenshot/' + width, slug === 'uk-london-1')
    await page.eval(() => window.scrollTo(0, 0))
    await page.screenshot({ path: `${out}/selection-${width}.png`, format: 'png', fullPage: true })
  }
  // Same selection survives the phone/tablet boundary and has a working touch purchase link.
  await page.setViewport({ width: 768, height: 1024, mobile: true }); await sleep(180)
  await check('767-to-768', true)
  const target = (await measure()).action.href
  await click('.minimal-selection a', true)
  assert.equal(await page.eval(() => location.pathname + location.search), target, 'actual tablet purchase navigation')
  await select('uk-london-1'); await wait(() => !!document.querySelector('.minimal-selection a'))
  await page.setViewport({ width: 390, height: 844, mobile: true }); await sleep(200)
  await check('768-to-390', true)
  await click('.mobile-region-card.is-current a', true)
  assert.equal(await page.eval(() => location.pathname + location.search), target, 'actual mobile purchase navigation')
  await page.setViewport({ width: 1440, height: 900 }); await select('uk-london-1')
  await wait(() => !!document.querySelector('.minimal-selection a'))
  await page.eval(() => document.querySelector('.minimal-selection a').focus())
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await wait(() => location.pathname === '/purchase')
  assert.equal(await page.eval(() => location.pathname + location.search), target, 'keyboard purchase navigation')
  // Exercise selection from the map itself, with normal transitions and the region filter.
  await page.goto('http://127.0.0.1:19834/', { settleMs: 300 })
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
  await click('.continent-tabs button:nth-child(3)'); await sleep(600)
  assert.equal(await page.eval(() => !!document.querySelector('.minimal-selection')), false, 'filter alone does not count as selected-card coverage')
  await click('.map-region-label[data-region="uk-london-1"]'); await sleep(400)
  assert.equal(await page.eval(() => new URLSearchParams(location.search).get('region')), 'uk-london-1')
  await check('actual-map-selection-normal-motion', true)
  await click('.map-controls button:first-child'); await sleep(400)
  await check('selected-card-after-zoom', true)
  await click('.map-controls button:last-child'); await sleep(400)
  await check('selected-card-after-reset', true)
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  // Initial pending, failed and unlisted catalogs change the card text and cannot shift or enable it.
  for (const state of ['loading', 'failed', 'unlisted']) {
    await page.setViewport({ width: 768, height: 900 })
    await page.goto('http://127.0.0.1:19834/?hold=1&region=af-johannesburg-1', { settleMs: 300 })
    await wait(() => !!document.querySelector('.minimal-selection'))
    await page.eval(() => window.cameraHarness.setLocale('en'))
    if (state !== 'loading') {
      await page.eval(state => {
        if (state === 'failed') window.cameraHarness.fixture.fail()
        else window.cameraHarness.fixture.catalog.regions.length = 0
        window.cameraHarness.fixture.release()
      }, state)
      await sleep(200)
    }
    await check(state, false)
    if (state === 'failed') {
      assert.ok(await page.eval(() => !!document.querySelector('.minimal-load-error')))
      await click('.minimal-load-error button'); await sleep(150)
      assert.equal(await page.eval(() => !!document.querySelector('.minimal-load-error')), false)
      await check('failure-recovered', false)
    }
  }
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log('PASS selected-card touch/keyboard navigation, mobile breakpoint, map selection/zoom/reset, pending/failed/unlisted catalogs')
  return observations
}
