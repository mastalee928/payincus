import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Browser, sleep } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'
import { checkHomeMapMobile } from './lib/check-home-map-mobile.mjs'
import { checkHomeResponsive } from './lib/check-home-responsive.mjs'
import { checkHomeMapGestures } from './lib/check-home-map-gestures.mjs'
import { checkHomeSelection } from './lib/check-home-selection.mjs'

const root = fileURLToPath(new URL('..', import.meta.url)).replaceAll('\\', '/')
const outputIndex = process.argv.indexOf('--out')
const out = outputIndex >= 0 ? fileURLToPath(new URL(process.argv[outputIndex + 1].replaceAll('\\', '/') + '/', pathToFileURL(root + '/'))) : root + '/logs/home-map-camera'
mkdirSync(out, { recursive: true })
const require = createRequire(new URL('../client/package.json', import.meta.url))
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href)
const { default: vue } = await import(pathToFileURL(require.resolve('@vitejs/plugin-vue')).href)
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js')
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/home-map-camera/*.js']
const before = process.argv.includes('--before'), phase = before ? 'before' : 'after'
const reuseDemo = process.argv.includes('--reuse-demo')
const baseline = before ? execFileSync('git', ['show', 'HEAD:client/src/components/public/HomeRegionAtlas.vue'], { cwd: root, encoding: 'utf8' }) : ''
const server = await createServer({ configFile: false, root: root + '/scripts/fixtures/home-map-camera', publicDir: root + '/client/public', cacheDir: out + '/vite-' + phase,
  plugins: [...(before ? [{ name: 'baseline-map', enforce: 'pre', transform(source, id) { if (id.endsWith('/HomeRegionAtlas.vue')) return baseline } }] : []), vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/home-map-camera/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router', '@fontsource-variable/inter', 'flag-icons/css/flag-icons.min.css'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19834, strictPort: true, fs: { allow: [root] } } })
let browser
const observations = []
try {
  if (!reuseDemo) await server.listen()
  if (process.argv.includes('--serve')) { console.log('Map camera fixture http://127.0.0.1:19834'); await new Promise(() => {}) }
  browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  if (process.argv.includes('--selection-only')) {
    try {
      observations.push({ name: 'selected-region-card', checks: await checkHomeSelection(page, out) })
      writeFileSync(out + '/selection.json', JSON.stringify({ at: new Date().toISOString(), scope: 'Real Vue/Chrome; local catalog; no backend', observations }, null, 2))
    } catch (error) {
      await page.screenshot({ path: out + '/selection-failure.png', format: 'png', fullPage: true })
      throw error
    }
  } else {
  const wait = async (fn, arg) => { const end = Date.now() + 15000; while (!await page.eval(fn, arg)) { assert.ok(Date.now() < end, 'Timed out: ' + String(fn) + '\n' + page.consoleErrors.join('\n')); await sleep(40) } }
  const click = async selector => {
    const box = await page.eval(s => { const e = document.querySelector(s); if (!e) throw new Error('Missing ' + s); e.scrollIntoView({ block: 'center', behavior: 'instant' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } }, selector)
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...box })
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...box, button: 'left', clickCount: 1 })
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...box, button: 'left', clickCount: 1 })
    await sleep(120)
  }
  const tab = async index => { await click(`.continent-tabs button:nth-child(${index + 1})`); await sleep(150) }
  const state = () => page.eval(() => {
    const group = document.querySelector('.map-transformation'), frame = document.querySelector('.atlas-map').getBoundingClientRect()
    const matrix = group?.getScreenCTM()
    const nodes = [...document.querySelectorAll('.map-marker:not(.dimmed)')].map(e => {
      const p = new DOMPoint(0, 0).matrixTransform(e.getScreenCTM())
      return { x: p.x - frame.x, y: p.y - frame.y, name: e.getAttribute('aria-label') }
    })
    return { tab: [...document.querySelectorAll('.continent-tabs button')].findIndex(e => e.getAttribute('aria-pressed') === 'true'),
      transform: group?.getAttribute('transform'), zoom: Number(group?.getAttribute('transform').match(/scale\(([^)]+)\)/)?.[1]), matrix: matrix ? [matrix.a, matrix.d, matrix.e, matrix.f] : null,
      width: frame.width, height: frame.height, nodes, labels: [...document.querySelectorAll('.map-region-label')].map(e => {
        const r = e.getBoundingClientRect(); return { text: e.textContent.trim(), x: r.x - frame.x, y: r.y - frame.y, width: r.width, height: r.height }
      }), scrollWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth }
  })
  const check = value => {
    assert.equal(value.scrollWidth, value.viewportWidth, 'no page horizontal overflow')
    for (const node of value.nodes) assert.ok(node.x >= 8 && node.y >= 8 && node.x <= value.width - 8 && node.y <= value.height - 8, 'clipped node ' + JSON.stringify(node))
    for (const label of value.labels) assert.ok(label.x >= 7 && label.y >= 7 && label.x + label.width <= value.width - 7 && label.y + label.height <= value.height - 7, 'clipped label ' + JSON.stringify(label))
    for (const [i,a] of value.labels.entries()) for (const b of value.labels.slice(i + 1)) assert.ok(!(a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y), 'overlapping city labels')
  }
  await page.goto('http://127.0.0.1:19834/preview?hold=1', { settleMs: 400 })
  await wait(() => !!window.cameraHarness && document.querySelectorAll('.map-marker').length === 45)
  await page.eval(() => window.cameraHarness.theme.setTheme('dark'))
  await tab(2)
  const loadingEurope = await state()
  await page.eval(() => window.cameraHarness.fixture.release()); await sleep(200)
  const loadedEurope = await state()
  observations.push({ name: 'catalog-arrives-after-selection', loadingEurope, loadedEurope })
  if (!before) { assert.equal(loadedEurope.tab, 2); assert.equal(loadedEurope.transform, loadingEurope.transform) }

  for (const [width, height] of [[3440,1440],[1920,1080],[1440,900],[768,900]]) {
    await page.setViewport({ width, height }); await sleep(200)
    const zooms = []
    for (const index of before ? [2] : [1,2,3,4,5]) {
      await tab(index); const value = await state(); observations.push({ name: 'continent', width, height, index, ...value }); zooms.push(value.zoom)
      if (!before) { check(value); assert.equal(value.tab,index); assert.ok(value.zoom > 1); if(index===2) assert.ok(value.zoom>=3,'Europe must be visibly focused') }
      if(index===2) { await page.eval(() => window.scrollTo(0,0)); await page.screenshot({ path: `${out}/${phase}-europe-${width}.png`, format:'png', fullPage:true }) }
    }
    if(!before) { assert.ok(new Set(zooms).size>=3); await tab(0); assert.equal((await state()).zoom,1) }
  }
  if (before) { console.log('Saved current fixed-scale/refresh baseline'); }
  else {
    await page.setViewport({width:1440,height:900}); await tab(2)
    const europe = await state()
    const londonEdge = await page.eval(() => {
      document.querySelector('.atlas-map').scrollIntoView({block:'center',behavior:'instant'})
      const marker = [...document.querySelectorAll('.map-marker')].find(e=>e.getAttribute('aria-label').startsWith('英国南部'))
      const matrix = marker.getScreenCTM(), p = new DOMPoint(0,0).matrixTransform(matrix)
      const core = marker.querySelector('.node-core'), coreMatrix = core.getScreenCTM()
      const r = Number(core.getAttribute('r')) * Math.hypot(coreMatrix.a,coreMatrix.b)
      return {x:p.x+r-1,y:p.y}
    })
    await page.send('Input.dispatchMouseEvent',{type:'mousePressed',...londonEdge,button:'left',clickCount:1})
    await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',...londonEdge,button:'left',clickCount:1})
    await sleep(150)
    assert.ok(await page.eval(()=>location.search.includes('region=uk-london-1')),'visible enlarged node edge must select that city')
    await tab(2)
    await click('.map-region-label[data-region="uk-london-1"]')
    await wait(() => location.search.includes('region=uk-london-1'))
    assert.equal((await state()).tab,2); assert.equal((await state()).transform,europe.transform)
    const purchase = await page.eval(() => document.querySelector('.minimal-selection a')?.getAttribute('href'))
    assert.ok(purchase?.match(/^\/purchase\?region=\d+$/), 'purchase retains real numeric region')
    await click('.preview-note button'); await sleep(200)
    assert.equal((await state()).tab,2); assert.equal((await state()).transform,europe.transform)
    await click('.map-controls button:nth-child(2)'); const manual = await state()
    await click('.preview-note button'); await sleep(200); assert.equal((await state()).transform,manual.transform)
    await page.eval(() => window.cameraHarness.fixture.fail()); await click('.preview-note button'); await sleep(150)
    assert.equal((await state()).transform,manual.transform)
    assert.equal(await page.eval(() => !!document.querySelector('.minimal-selection a')),false,'failed inventory cannot offer purchase')
    await click('.minimal-load-error button'); await sleep(150); assert.equal((await state()).transform,manual.transform)
    await click('.map-controls button:last-child'); assert.equal((await state()).transform,europe.transform)
    await tab(3); assert.equal(await page.eval(() => new URLSearchParams(location.search).get('region')),null)
    await tab(2); await page.eval(() => window.cameraHarness.router.push({query:{region:'ap-sydney-1'}})); await sleep(200)
    assert.equal((await state()).tab,3,'back/deep link into another continent stays consistent')
    await page.eval(() => history.back()); await sleep(180)
    assert.equal((await state()).tab,3,'history without a selected city keeps the chosen continent')
    await tab(2)
    await page.eval(() => document.querySelector('.map-region-label[data-region="uk-london-1"]').focus())
    await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'})
    await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13})
    await sleep(150)
    assert.equal(await page.eval(()=>new URLSearchParams(location.search).get('region')),'uk-london-1')
    assert.equal((await state()).tab,2,'keyboard city selection preserves continent')
    const beforeDrag = await state()
    const dragPoint = await page.eval(()=>{document.querySelector('.map-svg').scrollIntoView({block:'center',behavior:'instant'});const r=document.querySelector('.map-svg').getBoundingClientRect();return {x:r.x+120,y:r.y+120}})
    await page.send('Input.dispatchMouseEvent',{type:'mousePressed',...dragPoint,button:'left',clickCount:1})
    await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:dragPoint.x+80,y:dragPoint.y+40,button:'left',buttons:1})
    await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:dragPoint.x+80,y:dragPoint.y+40,button:'left',clickCount:1})
    assert.notEqual((await state()).transform,beforeDrag.transform,'manual drag works after fitting')
    await page.send('Input.dispatchMouseEvent',{type:'mouseWheel',...dragPoint,deltaX:0,deltaY:90}); await sleep(100)
    assert.ok((await state()).zoom<4,'wheel still zooms')
    const afterDrag = await state(); await click('.preview-note button'); await sleep(150)
    assert.equal((await state()).transform,afterDrag.transform,'refresh preserves manual pan and zoom')
    await tab(2)
    for(const locale of ['zh-CN','zh-TW','en']) for(const theme of ['dark','light']) {
      await page.eval(({locale,theme}) => { window.cameraHarness.setLocale(locale); window.cameraHarness.theme.setTheme(theme) },{locale,theme}); await sleep(220)
      const value = await state(); check(value); assert.equal(value.tab,2)
      await page.eval(() => window.scrollTo(0,0)); await page.screenshot({path:`${out}/after-europe-${locale}-${theme}.png`,format:'png',fullPage:true})
    }
    // Observe actual CSS interpolation and then the final, stable map matrix.
    await page.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]})
    await page.eval(() => { window.cameraHarness.theme.setTheme('dark'); window.cameraHarness.setLocale('zh-CN') }); await tab(0)
    await sleep(750)
    const start = await state()
    await page.eval(() => document.querySelectorAll('.continent-tabs button')[2].click()); await sleep(110)
    const middle = await state(); await sleep(850); const end = await state()
    assert.notDeepEqual(middle.matrix,start.matrix); assert.notDeepEqual(middle.matrix,end.matrix); check(end)
    observations.push({ name:'motion',start,middle,end })
    await page.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]})
    await page.eval(() => { for(const i of [1,4,5,2]) document.querySelectorAll('.continent-tabs button')[i].click() }); await sleep(200)
    assert.equal((await state()).tab,2); check(await state())

    // Crossing the mobile breakpoint preserves the selected continent and the existing globe.
    await page.setViewport({width:390,height:844,mobile:true}); await wait(() => !!document.querySelector('.vector-globe-svg'))
    await sleep(500)
    assert.equal(await page.eval(() => [...document.querySelectorAll('.continent-tabs button')].findIndex(e=>e.getAttribute('aria-pressed')==='true')),2)
    const rotation = await page.eval(() => document.querySelector('.vector-globe-svg').dataset.rotation)
    assert.ok(Math.abs(Number(rotation.split(',')[0]))<30,'mobile globe centers on Europe')
    await click('.globe-reset'); await sleep(200)
    assert.ok(Math.abs(Number((await page.eval(()=>document.querySelector('.vector-globe-svg').dataset.rotation)).split(',')[0]))<30,'reset stays with selected continent')
    await page.eval(() => window.scrollTo(0,0)); await page.screenshot({path:`${out}/after-europe-mobile.png`,format:'png',fullPage:true})
    await page.setViewport({width:1920,height:1080}); await sleep(350); check(await state()); assert.equal((await state()).tab,2)
    await page.setViewport({width:390,height:844,mobile:true})
    await page.eval(() => window.cameraHarness.router.push({query:{mobile:'map'}})); await wait(() => !!document.querySelector('.map-svg'))
    for(const index of [1,2,3,4,5]) { await tab(index); check(await state()) }
    await tab(0); assert.equal((await state()).zoom,1)
    assert.equal(page.consoleErrors.length,0,page.consoleErrors.join('\n'))
    observations.push({ name:'mobile-correction', checks:await checkHomeMapMobile(page,out) })
    // A long-lived Chrome emulation target can stop delivering PointerEvents after the
    // pinch/navigation/device changes above (also reproduced on plain HTML). Use an
    // independent target for this device matrix; it asserts real pointer delivery too.
    const responsivePage = await browser.newPage({ reducedMotion: true })
    try { observations.push({ name:'responsive-home', checks:await checkHomeResponsive(responsivePage,out) }) }
    finally { await responsivePage.close() }
    observations.push({ name:'map-label-gestures', checks:await checkHomeMapGestures(browser,out) })
    const selectionPage = await browser.newPage({ reducedMotion: true })
    try { observations.push({ name:'selected-region-card', checks:await checkHomeSelection(selectionPage,out) }) }
    finally { await selectionPage.close() }
    console.log('PASS five continents/four widths, bounds/labels, stock refresh/failure, same-city selection/purchase URL, manual/reset, deep links, three languages/two themes, actual animation/reduced motion and mobile globe/map')
  }
  writeFileSync(out+'/'+phase+'.json',JSON.stringify({phase,at:new Date().toISOString(),scope:'Real Vue/Chrome; local static catalog; no backend',observations},null,2))
  }
} finally { if(browser) await browser.close(); await server.close() }
