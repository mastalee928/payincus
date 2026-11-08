import assert from 'node:assert/strict'
import { sleep } from '../../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'

export async function checkHomeMapMobile(page, out) {
  const wait = async fn => { const end = Date.now()+15000; while (!await page.eval(fn)) { assert.ok(Date.now()<end,'mobile UI timeout: '+fn); await sleep(60) } }
  const tapAt = async point => {
    await page.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...point,id:1,radiusX:2,radiusY:2}]})
    await sleep(50)
    await page.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); await sleep(120)
  }
  const tap = async selector => {
    await page.eval(s=>document.querySelector(s).scrollIntoView({block:'center',behavior:'instant'}),selector)
    await sleep(70)
    const point=await page.eval(s=>{const e=document.querySelector(s),r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;
      if(!e.contains(document.elementFromPoint(x,y))) throw Error('Touch obstructed: '+s);return {x,y}},selector)
    await tapAt(point)
  }
  const tab = async index => {await tap(`.continent-tabs button:nth-child(${index+1})`); await sleep(120)}
  const state = () => page.eval(()=>{
    const svg=document.querySelector('.vector-globe-svg'), frame=svg.getBoundingClientRect()
    return {width:frame.width,height:frame.height,zoom:Number(svg.dataset.zoom),rotation:svg.dataset.rotation,
      tab:[...document.querySelectorAll('.continent-tabs button')].findIndex(e=>e.getAttribute('aria-pressed')==='true'),
      nodes:[...document.querySelectorAll('.globe-region-point:not(.dimmed)')].map(e=>{const p=new DOMPoint().matrixTransform(e.getScreenCTM());return {x:p.x-frame.x,y:p.y-frame.y,name:e.getAttribute('aria-label')}}),
      labels:[...document.querySelectorAll('.globe-city-label')].map(e=>{const r=e.getBoundingClientRect();return {id:e.dataset.region,text:e.textContent,x:r.x-frame.x,y:r.y-frame.y,width:r.width,height:r.height}}),
      overflow:document.documentElement.scrollWidth>innerWidth}
  })
  const observations=[]
  const check = (s,index) => {
    assert.equal(s.overflow,false,'no horizontal page overflow'); assert.equal(s.tab,index)
    for(const n of s.nodes) assert.ok(n.x>=22&&n.x<=s.width-22&&n.y>=22&&n.y<=s.height-22,'clipped touch target '+JSON.stringify(n))
    for(const [i,a] of s.labels.entries()) {
      assert.ok(a.width>=44&&a.height>=44,'city label touch target')
      assert.ok(a.x>=7&&a.y>=7&&a.x+a.width<=s.width-7&&a.y+a.height<=s.height-7,'clipped city label')
      for(const b of s.labels.slice(i+1)) assert.ok(!(a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y),'overlapping city touch targets')
    }
    if(index===2) {
      assert.equal(s.nodes.length,13,'all thirteen Europe regions remain visible')
      assert.ok(s.zoom>=3,'Europe must visibly enlarge, not merely rotate')
      assert.ok(Math.max(...s.nodes.map(n=>n.y))-Math.min(...s.nodes.map(n=>n.y))>=s.height*.55,'Europe fills useful mobile height')
      assert.ok(s.labels.length>=6,'Europe exposes nearby city names; crowded labels yield to precise node/candidate selection')
    }
  }
  await page.setViewport({width:390,height:844,mobile:true})
  await page.goto('http://127.0.0.1:19834/preview?inspect-continent=europe',{settleMs:800})
  await wait(()=>document.querySelectorAll('.globe-region-point:not(.dimmed)').length===13&&document.querySelectorAll('.globe-city-label').length>0)
  for(const [width,height] of [[320,740],[390,844],[465,850],[767,900]]) {
    await page.setViewport({width,height,mobile:true}); await sleep(250)
    for(const index of [1,2,3,4,5]) {
      await tab(index);const s=await state(); check(s,index);observations.push({width,height,index,...s})
      const total=await page.eval(()=>document.querySelectorAll('.mobile-region-card').length)
      assert.equal(s.nodes.length,total,'every filtered region must remain on the globe')
    }
    await tab(2)
    for(const locale of ['zh-CN','zh-TW','en']) for(const theme of ['light','dark']) {
      await page.eval(({locale,theme})=>{window.cameraHarness.setLocale(locale);window.cameraHarness.theme.setTheme(theme)},{locale,theme});await sleep(150)
      const s=await state();check(s,2);observations.push({width,locale,theme,...s})
      await page.eval(()=>window.scrollTo(0,0));await page.screenshot({path:`${out}/mobile-europe-${width}-${locale}-${theme}.png`,format:'png',fullPage:true})
    }
  }
  await page.setViewport({width:390,height:844,mobile:true})
  await page.eval(()=>{window.cameraHarness.setLocale('zh-CN');window.cameraHarness.theme.setTheme('light')});await tab(2)
  const europe=await state()
  // Every region is reachable by a real touch on its projected node, resolving dense neighbors.
  const targets=await page.eval(()=>[...document.querySelectorAll('.globe-region-point:not(.dimmed)')].map(e=>e.getAttribute('aria-label')))
  for(const target of targets) {
    await tab(2)
    await page.eval(()=>document.querySelector('.vector-globe-svg').scrollIntoView({block:'center',behavior:'instant'}));await sleep(70)
    const node=await page.eval(target=>{const e=[...document.querySelectorAll('.globe-region-point')].find(e=>e.getAttribute('aria-label')===target);const p=new DOMPoint().matrixTransform(e.getScreenCTM());return {x:p.x,y:p.y}},target)
    await tapAt(node)
    const candidates=await page.eval(()=>[...document.querySelectorAll('.globe-candidates button')].map(e=>e.textContent))
    if(candidates.length) {
      const name=target.split('，')[0], index=candidates.findIndex(text=>text.includes(name))
      assert.ok(index>=0,'nearby list includes touched city '+name)
      await tap(`.globe-candidates button:nth-child(${index+1})`)
    }
    const chosen=await page.eval(()=>document.querySelector('.globe-region-point.selected')?.getAttribute('aria-label'))
    assert.equal(chosen,target,'real touch selects exact intended region')
  }
  await tab(2);await tap('.globe-city-label[data-region="uk-london-1"]')
  assert.equal(await page.eval(()=>new URLSearchParams(location.search).get('region')),'uk-london-1')
  assert.ok(await page.eval(()=>[...document.querySelectorAll('.mobile-region-card a')].some(e=>/^\/purchase\?region=\d+$/.test(e.getAttribute('href')))),'numeric purchase route retained')
  await tap('.preview-note button');assert.equal((await state()).zoom,europe.zoom,'refresh keeps Europe framing')
  await page.eval(()=>window.cameraHarness.fixture.fail());await tap('.preview-note button')
  assert.equal(await page.eval(()=>document.querySelectorAll('.mobile-region-card a').length),0,'unknown stock cannot purchase')
  await tap('.minimal-load-error button')
  await tab(2);await tap('.globe-city-label[data-region="eu-frankfurt-1"]')
  assert.equal(await page.eval(()=>!!document.querySelector('.mobile-region-card.is-current a')),false,'unlisted region cannot purchase')
  await tap('.globe-reset');assert.equal((await state()).zoom,europe.zoom)
  await tab(0);assert.equal((await state()).zoom,1,'all restores globe overview')
  assert.equal((await state()).labels.length,0,'mobile all overview has no city labels')
  await tab(2)
  await page.eval(()=>document.querySelector('.vector-globe-svg').scrollIntoView({block:'center',behavior:'instant'}));await sleep(70)
  const position=await page.eval(()=>{const r=document.querySelector('.vector-globe-svg').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})
  await page.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:position.x-40,y:position.y,id:1},{x:position.x+40,y:position.y,id:2}]})
  await page.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:position.x-60,y:position.y,id:1},{x:position.x+60,y:position.y,id:2}]})
  await page.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await sleep(150)
  assert.ok((await state()).zoom>europe.zoom,'pinch can zoom beyond continent fit')
  await tap('.globe-reset');assert.equal((await state()).zoom,europe.zoom)
  await page.eval(()=>document.querySelector('.vector-globe-svg').scrollIntoView({block:'center',behavior:'instant'}));await sleep(70)
  const labelPoint=await page.eval(()=>{const r=document.querySelector('.globe-city-label[data-region="uk-london-1"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})
  const oldRotation=(await state()).rotation
  await page.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...labelPoint,id:1}]})
  await page.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:labelPoint.x+45,y:labelPoint.y+15,id:1}]})
  await page.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await sleep(150)
  assert.notEqual((await state()).rotation,oldRotation,'drag starting on a city label rotates globe')
  assert.equal(await page.eval(()=>new URLSearchParams(location.search).get('region')),null,'dragging label must not select city')
  const manual=await state();await tap('.preview-note button');assert.equal((await state()).rotation,manual.rotation,'refresh preserves manual globe view')
  await tap('.globe-reset')
  await page.eval(()=>document.querySelector('.globe-city-label[data-region="uk-london-1"]').focus())
  await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'})
  await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await sleep(150)
  assert.equal(await page.eval(()=>new URLSearchParams(location.search).get('region')),'uk-london-1','keyboard label selects exact region')
  await tap('.mobile-region-card.is-current .mobile-card-location')
  assert.ok((await state()).zoom>=europe.zoom,'city card must not shrink a continent view to old 2.5 zoom cap')
  await tab(2)
  // Explicit regressions for previously hidden neighboring cities and Singapore West.
  for(const [width,locale]of [[320,'en'],[390,'zh-CN'],[465,'zh-TW']]){
    await page.setViewport({width,height:844,mobile:true});await page.eval(locale=>window.cameraHarness.setLocale(locale),locale)
    for(const [id,index]of [['ap-chuncheon-1',3],['ap-singapore-1',3],['ap-singapore-2',3],['sa-valparaiso-1',4]]){
      await tab(index)
      await tap(`.globe-city-label[data-region="${id}"]`)
      assert.equal(await page.eval(()=>new URLSearchParams(location.search).get('region')),id,'label touch selects its original service region')
      assert.ok(await page.eval(()=>document.querySelector('.mobile-region-card.is-current .mobile-card-location').textContent.length>0))
    }
  }
  await page.setViewport({width:390,height:844,mobile:true});await page.eval(()=>window.cameraHarness.setLocale('zh-CN'));await tab(2)
  await page.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]})
  await tab(0);await sleep(750)
  await page.eval(()=>document.querySelectorAll('.continent-tabs button')[2].click());await sleep(110)
  const mid=await state();await sleep(800);const end=await state()
  assert.ok(mid.zoom>1&&mid.zoom<end.zoom,'actual mobile camera interpolation');check(end,2)
  await page.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]})
  await page.goto('http://127.0.0.1:19834/preview?hold=1&inspect-continent=europe',{settleMs:500})
  await wait(()=>document.querySelectorAll('.globe-region-point:not(.dimmed)').length===13&&document.querySelectorAll('.globe-city-label').length>0)
  const loading=await state();check(loading,2)
  await page.eval(()=>window.cameraHarness.fixture.release());await sleep(180)
  const loaded=await state();assert.equal(loaded.zoom,loading.zoom);assert.equal(loaded.rotation,loading.rotation,'late catalog retains mobile continent framing')
  assert.equal(page.consoleErrors.length,0,page.consoleErrors.join('\n'))
  console.log('PASS mobile: four widths/five continents, three languages/two themes, readable touch labels, all 13 Europe nodes by real touch, nearby selection, stock/purchase, pinch/reset and actual camera animation')
  return observations
}
