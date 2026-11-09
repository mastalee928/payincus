import assert from 'node:assert/strict'
import { sleep } from '../../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'

export const homeViewports = [
  [320,568,true],[360,800,true],[375,667,true],[390,844,true],[430,932,true],
  [568,320,true],[667,375,true],[844,390,true],[767,900,true],[768,1024,true],
  [820,1180,true],[1024,768,true],[1280,800,false],[1366,768,false],[1440,900,false],
  [1920,1080,false],[2560,1440,false],[3440,1440,false],[3840,2160,false]
]

export async function checkHomeResponsive(page,out, { interactionsOnly = false } = {}) {
  const observations=[]
  const wait=async fn=>{const end=Date.now()+15000;while(!await page.eval(fn)){assert.ok(Date.now()<end,'timeout '+fn);await sleep(50)}}
  const click=async(selector,touch=false)=>{
    await page.eval(s=>document.querySelector(s).scrollIntoView({block:'center',behavior:'instant'}),selector);await sleep(65)
    const p=await page.eval(s=>{const e=document.querySelector(s),r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(!e.contains(document.elementFromPoint(x,y)))throw Error('obstructed '+s);return{x,y}},selector)
    if(touch){await page.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...p,id:1}]});await sleep(50);await page.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})}
    else{await page.send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1});await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:1})}
    await sleep(120)
  }
  const state=()=>page.eval(()=>{
    const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}}
    const frame=document.querySelector('.atlas-map'), r=frame.getBoundingClientRect()
    const nodes=[...document.querySelectorAll('.globe-region-point:not(.dimmed),.map-marker:not(.dimmed)')].map(e=>{const p=new DOMPoint().matrixTransform(e.getScreenCTM());return {x:p.x-r.x,y:p.y-r.y}})
    const labels=[...document.querySelectorAll('.globe-city-label,.map-region-label')].map(e=>({id:e.dataset.region,text:e.textContent,...rect(e)}))
    const leaders=[...document.querySelectorAll('.globe-label-layer line,.map-label-leaders line')].map(e=>Math.hypot(Number(e.getAttribute('x2'))-Number(e.getAttribute('x1')),Number(e.getAttribute('y2'))-Number(e.getAttribute('y1'))))
    const controls=[...document.querySelectorAll('.header-inner button,.desktop-nav a,.continent-tabs button,.all-regions-link,.map-controls button')].filter(e=>e.getBoundingClientRect().width).map(e=>({text:e.textContent||e.getAttribute('aria-label'),...rect(e)}))
    const selection=document.querySelector('.minimal-selection'), mapControls=document.querySelector('.map-controls')
    return {width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth-innerWidth,map:rect(frame),footer:rect(document.querySelector('.home-footer')),
      nodes,labels,leaders,controls,selection:selection?rect(selection):null,mapControls:mapControls?rect(mapControls):null,
      tab:[...document.querySelectorAll('.continent-tabs button')].findIndex(e=>e.getAttribute('aria-pressed')==='true'),
      headlineLines:[...document.querySelectorAll('#home-title span')].map(e=>e.getBoundingClientRect().height/parseFloat(getComputedStyle(e).lineHeight)),
      dimmedTabStops:document.querySelectorAll('.dimmed[tabindex="0"]').length}
  })
  const overlaps=(a,b)=>a.x<b.right&&a.right>b.x&&a.y<b.bottom&&a.bottom>b.y
  const check=(s,tab,touch)=>{
    assert.equal(s.overflow,0,'horizontal page overflow '+JSON.stringify(s))
    assert.equal(s.tab,tab);assert.equal(s.dimmedTabStops,0,'filtered nodes removed from tab sequence')
    if(s.width<768&&tab===0)assert.equal(s.labels.length,0,'mobile all overview must not label cities')
    if(s.width<768&&[3,4].includes(tab)){
      const ids=tab===3?['ap-singapore-1','ap-singapore-2','ap-chuncheon-1']:['sa-valparaiso-1']
      for(const id of ids)assert.ok(s.labels.some(label=>label.id===id),'requested region name missing '+JSON.stringify({width:s.width,height:s.height,id,labels:s.labels}))
      if(tab===3){
        assert.ok(['新加坡','Singapore'].includes(s.labels.find(label=>label.id==='ap-singapore-1').text.trim()))
        assert.ok(['新加坡西部','Singapore West'].includes(s.labels.find(label=>label.id==='ap-singapore-2').text.trim()))
      }
    }
    assert.ok(s.leaders.every(n=>n<=35.1),'city label may not migrate into another geographic area')
    assert.ok(s.headlineLines.every(n=>n<=1.1),'headline must keep intended two lines')
    for(const n of s.nodes) if(tab>0)assert.ok(n.x>=4&&n.y>=4&&n.x<=s.map.width-4&&n.y<=s.map.height-4,'continent node clipped '+JSON.stringify({s,n}))
    for(const [i,a]of s.labels.entries()){
      assert.ok(a.x>=s.map.x+6&&a.right<=s.map.right-6&&a.y>=s.map.y+6&&a.bottom<=s.map.bottom-6,'city label clipped')
      if(touch)assert.ok(a.width>=43.99&&a.height>=43.99,'tablet/phone city labels need 44px touch targets '+JSON.stringify(a))
      for(const b of s.labels.slice(i+1))assert.ok(!overlaps(a,b),'overlapping city labels')
    }
    for(const [i,a]of s.controls.entries()){
      assert.ok(a.x>=-1&&a.right<=s.width+1,'control outside page '+a.text)
      if(touch&&a.height<43.9) assert.ok(a.text.includes('configurations')||a.text.includes('配置'),'small touch control '+JSON.stringify(a))
      for(const b of s.controls.slice(i+1))assert.ok(!overlaps(a,b),'overlapping controls '+a.text+'/'+b.text)
    }
    if(s.selection&&s.mapControls)assert.ok(!overlaps(s.selection,s.mapControls),'selected region obscured by zoom controls')
  }
  await page.goto('http://127.0.0.1:19834/',{settleMs:600})
  await wait(()=>!!window.cameraHarness&&!!document.querySelector('.continent-tabs'))
  for(const [width,height,touch]of interactionsOnly ? [] : homeViewports){
    await page.setViewport({width,height,mobile:touch});await sleep(160)
    for(const locale of ['zh-CN','zh-TW','en']){
      await page.eval(locale=>window.cameraHarness.setLocale(locale),locale)
      for(const theme of ['light','dark']){
        await page.eval(theme=>window.cameraHarness.theme.setTheme(theme),theme)
        for(const tab of [0,1,2,3,4,5]){
          await page.eval(i=>document.querySelectorAll('.continent-tabs button')[i].click(),tab);await sleep(80)
          const s=await state();check(s,tab,touch);observations.push({locale,theme,touch,...s})
          if(locale==='en'&&theme==='light'&&tab===2){await page.eval(()=>window.scrollTo(0,0));await page.screenshot({path:`${out}/responsive-${width}x${height}.png`,format:'png',fullPage:true})}
        }
      }
    }
    console.log(`PASS layout ${width}x${height} ${touch?'touch':'mouse'} / all continents, languages and themes`)
  }
  // CSS viewport + device-scale equivalent of desktop 125/150/200% page zoom.
  for(const zoom of [1.25,1.5,2]){
    await page.setViewport({width:Math.round(1440/zoom),height:Math.round(900/zoom),dsf:zoom});await sleep(150)
    await page.eval(()=>document.querySelectorAll('.continent-tabs button')[2].click());await sleep(180);check(await state(),2,false)
  }
  // Tablet: actual touches on dense nodes use the same disambiguation as phones.
  await page.eval(()=>{
    window.homePointerTrace=[]
    window.homePointerTraceController=new AbortController()
    for(const type of ['pointerdown','pointermove','pointerup','pointercancel','gotpointercapture','lostpointercapture','touchstart','touchend','mousedown','mouseup','click'])document.addEventListener(type,event=>{
      window.homePointerTrace.push({type,id:event.pointerId,pointerType:event.pointerType,button:event.button,x:event.clientX,y:event.clientY,target:event.target.tagName,marker:event.target.closest?.('.map-marker')?.getAttribute('aria-label')})
      if(window.homePointerTrace.length>40)window.homePointerTrace.shift()
    },{capture:true,signal:window.homePointerTraceController.signal})
  })
  for(const width of [768,820,1024]){
    await page.setViewport({width,height:1024,mobile:true});await page.eval(()=>window.cameraHarness.setLocale('en'));await sleep(180)
    await click('.continent-tabs button:nth-child(3)',true)
    await click('.map-region-label[data-region="uk-london-1"]',true)
    assert.equal(await page.eval(()=>new URLSearchParams(location.search).get('region')),'uk-london-1')
    check(await state(),2,true)
    await click('.continent-tabs button:nth-child(3)',true)
    await page.eval(()=>document.querySelector('.map-svg').scrollIntoView({block:'center',behavior:'instant'}));await sleep(70)
    const point=await page.eval(()=>{const e=[...document.querySelectorAll('.map-marker')].find(e=>e.getAttribute('aria-label').startsWith('UK South'));const p=new DOMPoint().matrixTransform(e.getScreenCTM());return{x:p.x,y:p.y}})
    await page.eval(()=>window.homePointerTrace=[])
    await page.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...point,id:1}]});await sleep(50);await page.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await sleep(150)
    const touchResult=await page.eval(p=>({ok:!!document.querySelector('.candidate-list')||new URLSearchParams(location.search).get('region')==='uk-london-1',query:location.search,hit:document.elementFromPoint(p.x,p.y)?.outerHTML.slice(0,500),coarse:matchMedia('(pointer: coarse)').matches}),point)
    if(!touchResult.ok)await page.screenshot({path:`${out}/tablet-touch-failure-${width}.png`,format:'png',fullPage:true})
    const trace=await page.eval(()=>window.homePointerTrace)
    assert.ok(['pointerdown','pointerup'].every(type=>trace.some(e=>e.type===type&&e.pointerType==='touch')),'browser must deliver actual touch PointerEvents '+JSON.stringify({width,trace}))
    assert.ok(touchResult.ok,'tablet touch selects or opens precise candidates '+JSON.stringify({width,point,...touchResult,trace}))
  }
  await page.eval(()=>window.homePointerTraceController.abort())
  // Long configurable brand must not crush the account action or overflow the footer.
  for(const width of [320,768,1024,1920]){
    await page.setViewport({width,height:900,mobile:width<1100})
    await page.eval(()=>{window.cameraHarness.config.brandName='VeryLongInfrastructureCloudPlatformWithoutSpaces';window.cameraHarness.config.brandSubtitle='Managed cloud virtual servers with reliable regional infrastructure and support'})
    await sleep(150);await click('.continent-tabs button:nth-child(3)',width<1100);check(await state(),2,width<1100)
    const login=await page.eval(()=>{const e=document.querySelector('.header-login');return {height:e.getBoundingClientRect().height,line:parseFloat(getComputedStyle(e).lineHeight)}})
    assert.ok(login.height<=48,'login label must not wrap')
  }
  await page.eval(()=>{window.cameraHarness.config.brandName='PayIncus';window.cameraHarness.config.brandSubtitle=''})
  // Menus, Escape/focus return and actual navigation remain usable in a short landscape viewport.
  await page.setViewport({width:667,height:375,mobile:true});await sleep(150)
  await click('.mobile-menu',true)
  assert.ok(await page.eval(()=>document.activeElement.closest('#home-mobile-nav')),'opening navigation focuses first link')
  await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await sleep(80)
  assert.equal(await page.eval(()=>document.activeElement.classList.contains('mobile-menu')),true,'escape restores trigger focus')
  await click('.mobile-menu',true)
  await click('.public-language-switch > button',true)
  assert.equal(await page.eval(()=>!!document.querySelector('#home-mobile-nav')),false,'language menu closes mobile navigation instead of covering its links')
  assert.ok(await page.eval(()=>document.activeElement.classList.contains('public-language-option')),'language menu focuses current choice')
  await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await sleep(80)
  assert.ok(await page.eval(()=>document.activeElement.matches('.public-language-switch > button')))
  await click('.mobile-menu',true);await click('#home-mobile-nav a',true)
  assert.equal(await page.eval(()=>location.pathname),'/purchase','real menu navigation')
  await page.eval(()=>history.back());await wait(()=>!!document.querySelector('.home-theme-toggle'))
  assert.equal(await page.eval(()=>!!document.querySelector('#home-mobile-nav')),false,'navigation cannot leave stale open menu')
  assert.equal(page.consoleErrors.length,0,page.consoleErrors.join('\n'))
  console.log(interactionsOnly ? 'PASS responsive interaction follow-up: zoom, long branding, tablet selection and menu keyboard/navigation' : 'PASS responsive home: 19 sizes, touch/mouse, 3 languages, 2 themes, 6 regions, zoom, long branding, tablet selection and menu keyboard/navigation')
  return observations
}
