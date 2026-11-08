import assert from 'node:assert/strict'
import { sleep } from '../../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'

// Use a fresh target per device: this checks real browser pointer routing, not Vue handlers.
export async function checkHomeMapGestures(browser, out) {
  const observations = []
  for (const [width, height, touch] of [[390, 844, true], [820, 1180, true], [1440, 900, false]]) {
    const page = await browser.newPage({ width, height, mobile: touch, reducedMotion: true })
    try {
      await page.goto('http://127.0.0.1:19834/', { settleMs: 700 })
      await page.eval(() => { window.cameraHarness.setLocale('en'); window.cameraHarness.theme.setTheme('light') })
      const mobile = width < 768
      const svgSelector = mobile ? '.vector-globe-svg' : '.map-svg'
      const labelSelector = `${mobile ? '.globe-city-label' : '.map-region-label'}[data-region="uk-london-1"]`
      const state = () => page.eval(() => {
        const globe = document.querySelector('.vector-globe-svg'), flat = document.querySelector('.map-transformation')
        return { view: globe?.dataset.rotation ?? flat?.getAttribute('transform'),
          zoom: globe ? Number(globe.dataset.zoom) : Number(flat.getAttribute('transform').match(/scale\(([^)]+)/)[1]),
          selected: new URLSearchParams(location.search).get('region'),
          active: !!document.querySelector('.is-interacting,.is-gesturing'), scroll: scrollY }
      })
      const reset = async () => {
        await page.eval(() => document.querySelectorAll('.continent-tabs button')[2].click()); await sleep(200)
        await page.eval(s => document.querySelector(s).scrollIntoView({ block: 'center', behavior: 'instant' }), svgSelector)
        await sleep(80)
      }
      const labelPoint = () => page.eval(selector => {
        const e = document.querySelector(selector), r = e.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2
        if (!e.contains(document.elementFromPoint(x, y))) throw Error('Label obstructed: ' + selector)
        return { x, y, id: 1 }
      }, labelSelector)
      const touchEvent = async (type, touchPoints) => { await page.send('Input.dispatchTouchEvent', { type, touchPoints }); await sleep(35) }
      const mouse = async (type, point, buttons = 0) => { await page.send('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, button: 'left', buttons, clickCount: 1 }); await sleep(35) }
      const tap = async () => {
        const p = await labelPoint()
        if (touch) { await touchEvent('touchStart', [p]); await touchEvent('touchEnd', []) }
        else { await mouse('mousePressed', p, 1); await mouse('mouseReleased', p) }
        await sleep(120)
        assert.equal((await state()).selected, 'uk-london-1', 'label selects its original region')
      }
      await reset(); await tap(); await reset()
      let p = await labelPoint(), before = await state()
      if (touch) await touchEvent('touchStart', [p]); else await mouse('mousePressed', p, 1)
      for (let i = 1; i <= 5; i++) {
        const moved = { ...p, x: p.x + i * 10, y: p.y + i * 4 }
        if (touch) await touchEvent('touchMove', [moved]); else await mouse('mouseMoved', moved, 1)
      }
      if (touch) await touchEvent('touchEnd', []); else await mouse('mouseReleased', { x: p.x + 50, y: p.y + 20 })
      let after = await state()
      assert.notEqual(after.view, before.view, 'drag beginning on text must move the map')
      assert.equal(after.selected, null, 'drag must not select a region')
      assert.equal(after.scroll, before.scroll, 'drag must not scroll the page')
      assert.equal(after.active, false, 'gesture ends on release')
      observations.push({ width, touch, action: 'label drag', before, after })
      if (mobile) {
        await page.setViewport({width:465,height:850,mobile:true}); await reset(); await tap()
        await page.setViewport({width:320,height:740,mobile:true}); await sleep(200)
        const resized = await state()
        await page.eval(() => document.querySelector('.globe-reset').click()); await sleep(150)
        assert.equal(resized.zoom, (await state()).zoom, 'tapping a city must not disable automatic continent fitting on resize')
        assert.equal(resized.selected, 'uk-london-1')
        await page.setViewport({width,height,mobile:true}); await reset()
      }
      if (touch) {
        await reset(); p = await labelPoint(); before = await state()
        await touchEvent('touchStart', [p]); await touchEvent('touchCancel', [])
        assert.equal((await state()).selected, null, 'cancel does not select a region')
        await tap(); await reset()
        // A third finger joining and then the first lifting must rebase the remaining pair.
        p = await labelPoint(); const second = { x: p.x + 140, y: p.y, id: 2 }, third = { x: p.x + 65, y: p.y + 65, id: 3 }
        await touchEvent('touchStart', [p]); await touchEvent('touchStart', [p, second])
        const closer = { ...second, x: second.x - 30 }
        await touchEvent('touchMove', [p, closer]); await touchEvent('touchStart', [p, closer, third])
        await touchEvent('touchEnd', [closer, third]); const rebased = await state()
        await touchEvent('touchMove', [{ ...closer, x: closer.x + 1 }, third]); const continued = await state()
        assert.ok(Math.abs(continued.zoom - rebased.zoom) < .15, 'remaining pinch must not jump after first finger lifts')
        await touchEvent('touchEnd', []); after = await state()
        assert.equal(after.selected, null, 'multi-touch cannot select a city')
        assert.equal(after.active, false); assert.ok(after.zoom < before.zoom, 'pinch from text zooms the map')
        observations.push({ width, action: 'three fingers', rebased, continued, after })
        await reset(); await tap()
      } else {
        await reset(); p = await labelPoint(); before = await state()
        await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: p.x, y: p.y, deltaX: 0, deltaY: 90 }); await sleep(150)
        assert.ok((await state()).zoom < before.zoom, 'wheel over text must zoom the same map')
      }
      // Unexpected loss of a real pointer capture cancels the gesture and allows a new one.
      await reset(); p = await labelPoint()
      await page.eval(() => { document.addEventListener('gotpointercapture', e => { window.homeCapturedPointer = e.pointerId }, { once: true }) })
      if (touch) { await touchEvent('touchStart', [p]); await touchEvent('touchMove', [{ ...p, x: p.x + 10 }]) }
      else { await mouse('mousePressed', p, 1); await mouse('mouseMoved', { ...p, x: p.x + 10 }, 1) }
      await page.eval(selector => { const e = document.querySelector(selector); if (!e.hasPointerCapture(window.homeCapturedPointer)) throw Error('Expected real pointer capture'); e.releasePointerCapture(window.homeCapturedPointer) }, svgSelector)
      if (touch) { await touchEvent('touchMove', [{ ...p, x: p.x + 15 }]); await touchEvent('touchEnd', []) }
      else { await mouse('mouseMoved', { ...p, x: p.x + 15 }, 1); await mouse('mouseReleased', p) }
      after = await state(); assert.equal(after.active, false); assert.equal(after.selected, null)
      await reset(); await tap()
      await page.screenshot({ path: `${out}/gestures-${width}.png`, format: 'png', fullPage: true })
      assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
      console.log(`PASS gestures ${width}: exact label tap, drag, ${touch ? 'cancel / three-finger pinch' : 'wheel'}, lost capture, recovery; no accidental selection`)
    } finally { await page.close() }
  }
  return observations
}
