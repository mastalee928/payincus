import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Browser, sleep } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'
import { probe, layout, app as appProbe } from '../.agents/skills/design-taste-frontend/scripts/lib/probe.mjs'
import { judge, judgeLayout, judgeApp, APP_SKIP } from '../.agents/skills/design-taste-frontend/scripts/lib/rules.mjs'
const root = fileURLToPath(new URL('..', import.meta.url)).replaceAll('\\', '/')
const require = createRequire(new URL('../client/package.json', import.meta.url))
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href)
const { default: vue } = await import(pathToFileURL(require.resolve('@vitejs/plugin-vue')).href)
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js')
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/pool-checkout/*.js']
mkdirSync(root + '/logs/pool-checkout-browser', { recursive: true })
const server = await createServer({ configFile: false, root: root + '/scripts/fixtures/pool-checkout', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/pool-checkout/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue','pinia','vue-i18n','vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue','pinia','vue-i18n','vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } }, server: { host: '127.0.0.1', port: 19818, strictPort: true, fs: { allow: [root] } } })
let browser
try {
  await server.listen(); browser=await Browser.launch()
  const a=await browser.newPage(), b=await browser.newPage()
  const url='http://127.0.0.1:19818'
  await a.goto(url,{settleMs:300});await b.goto(url,{settleMs:300})
  const item={poolPriceId:20,quantity:1,namePrefix:'first',image:'debian/12',customInitCommandIds:[],snapshot:{regionId:10,regionName:'Seoul',countryCode:'kr',resourcePreset:'E2',diskGiB:30,cpu:200,memoryMiB:768,monthlyPrice:1000,setupFee:200,imageLabel:'Debian 12'}}
  await a.eval(item=>window.checkoutHarness.cart.add(item),item);await sleep(100)
  await b.eval(item=>window.checkoutHarness.cart.add({...item,namePrefix:'second'}),item);await sleep(100)
  await a.eval(()=>window.checkoutHarness.cart.reload())
  assert.equal(await a.eval(()=>window.checkoutHarness.cart.items.length),2,'a second tab must not erase the first tab cart line')
  assert.equal(await b.eval(()=>window.checkoutHarness.cart.items.length),2)
  await a.eval(()=>window.checkoutHarness.cart.setNamePrefix(window.checkoutHarness.cart.items[0].key,'renamed'))
  await sleep(100)
  assert.equal(await b.eval(()=>window.checkoutHarness.cart.items[0].namePrefix),'renamed','storage events refresh the other tab')
  const submitted=await a.eval(()=>window.checkoutHarness.cart.items[0])
  await b.eval(()=>window.checkoutHarness.cart.setQuantity(window.checkoutHarness.cart.items[0].key,2))
  await a.eval(submitted=>window.checkoutHarness.cart.remove(submitted.key,submitted),submitted)
  assert.equal(await a.eval(()=>window.checkoutHarness.cart.items.length),2,'stale checkout cleanup preserves edited line')
  await Promise.all([a.eval(item=>window.checkoutHarness.cart.add({...item,namePrefix:'third'}),item),b.eval(item=>window.checkoutHarness.cart.add({...item,namePrefix:'fourth'}),item)])
  await sleep(100)
  assert.equal(await a.eval(()=>window.checkoutHarness.cart.items.length),4,'simultaneous different lines survive')
  await a.eval(()=>{const c=window.checkoutHarness.cart;c.setQuantity(c.items[0].key,Infinity);c.setQuantity(c.items[0].key,NaN)})
  assert.equal(await a.eval(()=>window.checkoutHarness.cart.items[0].quantity),2)
  await a.eval(()=>window.checkoutHarness.cart.setQuantity(window.checkoutHarness.cart.items[0].key,10000))
  assert.equal(await a.eval(()=>window.checkoutHarness.cart.totalQuantity),100)
  assert.equal(await a.eval(item=>window.checkoutHarness.cart.add(item),item),null,'over-limit addition rejected')
  await a.eval(()=>window.checkoutHarness.cart.setQuantity(window.checkoutHarness.cart.items[0].key,1))
  await a.eval(item=>{const h=window.checkoutHarness;h.account(2);h.cart.add({...item,namePrefix:'account-two'})},item)
  await a.eval(()=>window.checkoutHarness.account(1))
  assert.equal(await a.eval(()=>window.checkoutHarness.cart.items.length),4,'immediate account switch cannot save old lines into new account')
  await a.eval(()=>window.checkoutHarness.account(2))
  assert.deepEqual(await a.eval(()=>window.checkoutHarness.cart.items.map(x=>x.namePrefix)),['account-two'])
  await a.eval(()=>localStorage.setItem('token','unsynchronized'))
  assert.equal(await a.eval(item=>window.checkoutHarness.cart.add(item),item),null,'unsynchronized authentication cannot mutate')
  await a.eval(()=>window.checkoutHarness.account(1))
  await a.eval(item=>{
    const c=window.checkoutHarness.cart;c.clear()
    const line={...item,key:'legacy',addedAt:new Date().toISOString()}
    localStorage.setItem('incudal.cart.1',JSON.stringify([line,{...line,key:'bad',snapshot:{}},{...line,key:'bad-command',customInitCommandIds:['oops']}]))
    localStorage.setItem('incudal.cart.v2.1.corrupt','{bad')
    c.reload()
  },item)
  assert.equal(await a.eval(()=>window.checkoutHarness.cart.items.length),1,'malformed entries rejected, valid legacy cart retained')
  await a.goto(url,{settleMs:300})
  assert.equal(await a.eval(()=>window.checkoutHarness.cart.items.length),1,'migration and reload do not duplicate')
  console.log('PASS two-tab simultaneous add/edit, stale receipt removal, account switch, bounds, corrupt storage and migration')

  const run=(fn,arg)=>a.eval(fn,arg)
  const wait=async fn=>{const end=Date.now()+7000;while(!await run(fn)){assert.ok(Date.now()<end,await run(()=>document.body.innerText));await sleep(30)}}
  const pending=kind=>run(kind=>window.checkoutHarness.requests.findLastIndex(r=>r.kind===kind&&!r.done),kind)
  const reply=(index,data,failed=false)=>run(({index,data,failed})=>{const r=window.checkoutHarness.requests[index];r.done=true;failed?r.reject(data):r.resolve(data)},{index,data,failed})
  const product={id:20,resourcePreset:'E2',diskGiB:30,cpu:200,memoryMiB:768,monthlyPrice:1000,setupFee:200,idle:5,total:5}
  const catalog={regions:[{id:10,name:'韩国 · 首尔',countryCode:'kr',products:[product]}],maxInstances:100}
  const images={images:[{name:'Debian 12',remoteAlias:'debian/12',architecture:'x86_64'}]}
  const enter=async()=>{await run(()=>{window.checkoutHarness.cart.clear();return window.checkoutHarness.router.push('/purchase')});await wait(()=>!!document.querySelector('.purchase-page'));await reply(await pending('catalog'),catalog);await wait(()=>window.checkoutHarness.requests.some(r=>r.kind==='images'&&!r.done))}
  const fill=()=>run(()=>{const el=document.querySelector('.purchase-input');el.value='new-server';el.dispatchEvent(new Event('input',{bubbles:true}))})
  await enter();await reply(await pending('images'),images);await fill();await sleep(40)
  assert.equal(await run(()=>document.querySelector('.purchase-primary').disabled),false)
  await run(()=>document.querySelector('.purchase-primary').click())
  assert.equal(await run(()=>window.checkoutHarness.cart.totalQuantity),1)
  for(const scenario of ['account','session','route','unmount','storage']) {
    await run(()=>{window.checkoutHarness.state.mounted=true;window.checkoutHarness.account(1);return window.checkoutHarness.router.push('/checkout')})
    await enter();const old=await pending('images')
    await run(async scenario=>{const h=window.checkoutHarness;if(scenario==='account')h.account(2);if(scenario==='session')h.account(1,'changed');if(scenario==='route'){await h.router.push('/checkout');await h.router.push('/purchase')}if(scenario==='unmount')h.state.mounted=false;if(scenario==='storage')localStorage.setItem('token','changed')},scenario)
    const before=await run(()=>JSON.stringify(window.checkoutHarness.cart.items))
    await reply(old,images);await sleep(40)
    assert.equal(await run(()=>!!document.querySelector('.purchase-primary:not(:disabled)')),false,scenario+' old image cannot enable purchase')
    assert.equal(await run(()=>JSON.stringify(window.checkoutHarness.cart.items)),before,scenario+' old image does not alter cart')
  }
  await run(()=>{window.checkoutHarness.state.mounted=true;window.checkoutHarness.account(1);return window.checkoutHarness.router.push('/checkout')})
  await enter();await reply(await pending('images'),{message:'images unavailable'},true);await sleep(40)
  await run(()=>document.querySelector('.purchase-alert button').click());await reply(await pending('catalog'),{message:'catalog unavailable'},true);await sleep(40)
  assert.equal(await run(()=>!!document.querySelector('.purchase-primary:not(:disabled)')),false,'failed refresh cannot use old product')
  await run(()=>document.querySelector('.purchase-alert button').click());await reply(await pending('catalog'),catalog);await reply(await pending('images'),images);await fill();await sleep(40)
  await run(()=>document.querySelector('.purchase-secondary').click());await sleep(60)
  assert.equal(await run(()=>window.checkoutHarness.router.currentRoute.value.path),'/checkout')
  assert.equal(await run(()=>window.checkoutHarness.cart.totalQuantity),1,'direct purchase uses the same valid cart')
  console.log('PASS actual purchase selector: add/direct purchase, old image replies, identity/routes/unmount and catalog retry')
  await enter();await reply(await pending('images'),images);await fill();await sleep(80)
  assert.ok(await run(()=>document.querySelector('.purchase-name-quantity').getBoundingClientRect().top < document.querySelector('.purchase-instance-fields > .purchase-field').getBoundingClientRect().top),'instance name precedes operating system')
  mkdirSync(root+'/logs/pool-cart-browser',{recursive:true})
  for(const width of [1440,768,390]) for(const theme of ['light','dark']) {
    await a.setViewport({width,height:900});await run(theme=>window.checkoutHarness.theme.setTheme(theme),theme);await sleep(350)
    assert.equal(await run(()=>document.documentElement.scrollWidth>innerWidth),false)
    const metrics=await a.eval(probe),lay=await a.eval(layout),screen=await a.eval(appProbe)
    const findings=[...judge(metrics,{width,allow:[]}),...judgeLayout(lay,{width,allow:[]})].filter(f=>!APP_SKIP.has(f.id)).concat(judgeApp(screen,metrics,{width,allow:[]}))
    writeFileSync(root+`/logs/pool-cart-browser/${width}-${theme}-inspection.json`,JSON.stringify(findings,null,2))
    await a.screenshot({path:root+`/logs/pool-cart-browser/${width}-${theme}.png`,format:'png',fullPage:true})
    assert.ok(!findings.some(f=>f.level==='FAIL'),JSON.stringify(findings.filter(f=>f.level==='FAIL')))
    await a.screenshot({path:root+`/logs/pool-cart-browser/${width}-${theme}.png`,format:'png',fullPage:true})
  }
  console.log('PASS purchase selector three widths and themes: layout, interaction and screenshots')
} finally {if(browser)await browser.close();await server.close()}
