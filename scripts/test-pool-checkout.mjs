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
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } }, server: { host: '127.0.0.1', port: 19817, strictPort: true, fs: { allow: [root] } } })
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19817', { settleMs: 900 })
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(35); return result }
  const wait = async fn => { const until = Date.now()+8000; while (!await page.eval(fn)) { assert.ok(Date.now()<until, await page.eval(() => document.body.innerText)); await sleep(30) } }
  const product = { id: 20, resourcePreset: 'E2', diskGiB: 30, cpu: 200, memoryMiB: 768, monthlyPrice: 1000, setupFee: 200, idle: 5, total: 5 }
  const catalog = { regions: [{ id: 10, name: '美国 · 圣何塞', countryCode: 'us', products: [product] }], maxInstances: 100 }
  const item = { poolPriceId: 20, quantity: 1, namePrefix: 'my-server', image: 'debian/12', customInitCommandIds: [], snapshot: { regionId: 10, regionName: '美国 · 圣何塞', countryCode: 'us', resourcePreset: 'E2', diskGiB: 30, cpu: 200, memoryMiB: 768, monthlyPrice: 1000, setupFee: 200, imageLabel: 'Debian 12' } }
  const respond = (index, data, failure = false) => run(({index,data,failure}) => { const r=window.checkoutHarness.requests[index]; if(!r||r.done)throw Error('Invalid request '+index);r.done=true;failure?r.reject(data):r.resolve(data) }, {index,data,failure})
  const pending = kind => page.eval(kind => window.checkoutHarness.requests.findLastIndex(r=>r.kind===kind&&!r.done),kind)
  const accept = async (kind, data) => respond(await pending(kind),data)
  const load = async () => { await wait(()=>window.checkoutHarness.requests.some(r=>r.kind==='catalog'&&!r.done));await accept('catalog',catalog);await accept('keys',{keys:[]});await accept('providers',{providers:[{id:5,name:'Payment',type:'yipay'}]}) }
  const add = value => run(value=>window.checkoutHarness.cart.add(value),value)
  const click = () => run(()=>document.querySelector('.checkout-pay').click())
  const result = id => ({batchId:id,total:1200,instances:[{id:70,name:'my-server',status:'creating',refunded:false,refundPending:false,host:null,sshPort:null,rootPassword:null}]})
  const fresh = async () => { await run(()=>{sessionStorage.clear();localStorage.clear()});await page.goto('http://127.0.0.1:19817', {settleMs:300});await load();await add(item) }
  await load();await add(item);await run(()=>{document.querySelector('.checkout-pay').click();document.querySelector('.checkout-pay').click()})
  assert.equal(await page.eval(()=>window.checkoutHarness.requests.filter(r=>r.kind==='buy').length),1,'double click sends one purchase')
  const first = await page.eval(()=>window.checkoutHarness.requests.findLast(r=>r.kind==='buy').data.requestId)
  await add({...item,namePrefix:'next-server'})
  await accept('buy',result(first))
  assert.equal(await page.eval(()=>window.checkoutHarness.cart.items.length),1,'successful purchase must keep later cart additions')
  assert.equal(await page.eval(()=>sessionStorage.getItem('payincus.checkout.1')),null,'acknowledged checkout must clear its intent so another purchase is new')
  await run(()=>window.checkoutHarness.router.push('/checkout'));await load()
  await run(()=>window.checkoutHarness.cart.clear());await add(item);await click()
  assert.notEqual(await page.eval(()=>window.checkoutHarness.requests.findLast(r=>r.kind==='buy').data.requestId),first,'new acknowledged purchase uses a new key')
  console.log('PASS double click, acknowledgement, later cart entries and intentional repeat purchase')

  await fresh();await click()
  const lost = await page.eval(()=>window.checkoutHarness.requests.findLast(r=>r.kind==='buy').data.requestId)
  await respond(await pending('buy'),{message:'connection lost'},true)
  await respond(await pending('order'),{message:'connection lost'},true)
  await click()
  assert.equal(await page.eval(()=>window.checkoutHarness.requests.findLast(r=>r.kind==='buy').data.requestId),lost)
  await page.goto('http://127.0.0.1:19817', {settleMs:300});await load();await click()
  assert.equal(await page.eval(()=>window.checkoutHarness.requests.findLast(r=>r.kind==='buy').data.requestId),lost,'refresh retains ambiguous request identity')
  await respond(await pending('buy'),{message:'connection lost'},true);await accept('order',result(lost))
  assert.equal(await page.eval(()=>window.checkoutHarness.cart.items.length),0)
  console.log('PASS response loss and refresh replay original key; receipt lookup acknowledges accepted order')

  for (const scenario of ['account','session','route-aba','unmount','storage']) {
    await fresh();await click()
    const buy = await pending('buy'), id = await page.eval(index=>window.checkoutHarness.requests[index].data.requestId,buy)
    await run(async scenario=>{const h=window.checkoutHarness;if(scenario==='account')h.account(2);if(scenario==='session')h.account(1,'next');if(scenario==='route-aba'){await h.router.push('/purchase');await h.router.push('/checkout')}if(scenario==='unmount')h.state.mounted=false;if(scenario==='storage')localStorage.setItem('token','changed')},scenario)
    if(scenario==='account')await add({...item,namePrefix:'other-account'})
    const cartBefore=await page.eval(()=>JSON.stringify(window.checkoutHarness.cart.items))
    await respond(buy,result(id))
    assert.equal(await page.eval(()=>JSON.stringify(window.checkoutHarness.cart.items)),cartBefore,scenario+' stale purchase must not clear cart')
    assert.equal(await page.eval(()=>window.checkoutHarness.router.currentRoute.value.query.order),undefined,scenario+' stale purchase must not navigate')
    assert.ok(await page.eval(()=>!!sessionStorage.getItem('payincus.checkout.1')),scenario+' ambiguous purchase identity remains recoverable')
  }
  console.log('PASS stale purchase acknowledgements: account, session, route ABA, unmount and unsynchronized storage')

  await fresh()
  await run(()=>window.checkoutHarness.router.push('/checkout?order=old-order'))
  const oldOrder=await pending('order')
  await run(()=>window.checkoutHarness.router.push('/checkout?order=new-order'))
  await accept('order',result('new-order'));await respond(oldOrder,result('old-order'))
  assert.equal(await page.eval(()=>window.checkoutHarness.requests.findLast(r=>r.kind==='order').data),'new-order')
  assert.equal(await page.eval(()=>window.checkoutHarness.router.currentRoute.value.query.order),'new-order')
  const poll=await pending('order');await run(()=>window.checkoutHarness.account(2));await respond(poll,result('new-order'))
  assert.equal(await page.eval(()=>!!document.querySelector('.order-result')),false)
  console.log('PASS old order and poll replies cannot replace another order or account')

  await fresh();await click();await respond(await pending('buy'),{code:'POOL_PRICE_CHANGED'},true)
  await respond(await pending('catalog'),{message:'catalog unavailable'},true)
  assert.equal(await page.eval(()=>document.querySelector('.checkout-pay').disabled),true,'failed fresh pricing cannot use stale catalog')
  console.log('PASS failed price refresh prevents checkout against stale catalog')

  const charge={order:{orderNo:'PAY-1',payableAmount:12,actualAmount:12},provider:{id:5,name:'Payment'},payUrl:null,manualPayment:{instructions:'Use the original payment order'}}
  const selectProvider=()=>run(()=>document.querySelectorAll('.checkout-pay-option')[1].click())
  await fresh();await selectProvider();await click();await accept('charge',charge)
  assert.ok(await page.eval(()=>sessionStorage.getItem('payincus.checkout-payment.1')))
  await page.goto('http://127.0.0.1:19817', {settleMs:300});await load()
  assert.equal(await page.eval(()=>window.checkoutHarness.requests.filter(r=>r.kind==='charge').length),0)
  await accept('charge-status',{order:{orderNo:'PAY-1',status:'pending',actualAmount:12}})
  assert.equal(await page.eval(()=>document.querySelector('.checkout-pay').disabled),true)
  await run(()=>document.querySelector('.checkout-gateway-actions button:last-child').click());await accept('verify',{})
  await accept('charge-status',{order:{orderNo:'PAY-1',status:'completed',actualAmount:12}})
  assert.equal(await page.eval(()=>document.querySelector('.checkout-pay').disabled),false)
  assert.equal(await page.eval(()=>window.checkoutHarness.requests.filter(r=>r.kind==='buy').length),0,'credited payment requires explicit checkout')
  console.log('PASS payment refresh restores original order, queries authoritative status and requires explicit purchase')

  await fresh();await selectProvider();await click();const oldCharge=await pending('charge')
  await run(()=>window.checkoutHarness.account(2));await respond(oldCharge,charge)
  assert.equal(await page.eval(()=>sessionStorage.getItem('payincus.checkout-payment.2')),null)
  assert.equal(await page.eval(()=>!!document.querySelector('.checkout-gateway')),false)
  console.log('PASS old account payment receipt cannot populate new account')

  await fresh();await selectProvider();await click();await accept('charge',charge)
  await run(()=>document.querySelector('.checkout-gateway-actions button:last-child').click());await accept('verify',{})
  const oldStatus=await pending('charge-status');await run(()=>window.checkoutHarness.account(2));await respond(oldStatus,{order:{orderNo:'PAY-1',status:'completed',actualAmount:12}})
  assert.equal(await page.eval(()=>!!document.querySelector('.checkout-gateway-credited')),false)
  console.log('PASS old account credit status cannot claim payment on new account')

  await fresh();await selectProvider();await click()
  const creation=await page.eval(()=>window.checkoutHarness.requests.findLast(r=>r.kind==='charge').data[4])
  assert.match(creation,/^[a-f0-9-]{36}$/i)
  await respond(await pending('charge'),{message:'response lost'},true)
  assert.ok(await page.eval(()=>document.body.innerText.includes('response lost')),'creation error is visible outside missing receipt')
  await click()
  assert.equal(await page.eval(()=>window.checkoutHarness.requests.findLast(r=>r.kind==='charge').data[4]),creation)
  await run(()=>window.checkoutHarness.router.push('/purchase'))
  await respond(await pending('charge'),{...charge,recovered:true})
  await run(()=>window.checkoutHarness.router.push('/checkout'));await load()
  assert.equal(await page.eval(()=>window.checkoutHarness.requests.findLast(r=>r.kind==='charge-intent').data),creation)
  await accept('charge-intent',{order:{orderNo:'PAY-1',status:'pending',payableAmount:12,actualAmount:12,provider:{name:'Payment'}}})
  await accept('charge-status',{order:{orderNo:'PAY-1',status:'pending',actualAmount:12}})
  assert.ok(await page.eval(()=>document.body.innerText.includes('继续原订单付款')))
  await run(()=>document.querySelector('.checkout-gateway-actions button:first-child').click())
  await accept('repay',{order:{orderNo:'PAY-1',payableAmount:12,actualAmount:12},payUrl:null,manualPayment:{instructions:'Original order resumed'}})
  await accept('charge-status',{order:{orderNo:'PAY-1',status:'completed',actualAmount:12}})
  assert.equal(await page.eval(()=>window.checkoutHarness.requests.filter(r=>r.kind==='buy').length),0)
  console.log('PASS ambiguous recharge reuses intent, navigation recovers original order and explicit resume never auto-purchases')

  await fresh();await selectProvider();await click()
  const refreshedIntent=await page.eval(()=>window.checkoutHarness.requests.findLast(r=>r.kind==='charge').data[4])
  await page.goto('http://127.0.0.1:19817',{settleMs:300});await load()
  assert.equal(await page.eval(()=>window.checkoutHarness.requests.findLast(r=>r.kind==='charge-intent').data),refreshedIntent)
  await accept('charge-intent',{order:null});await click()
  assert.equal(await page.eval(()=>window.checkoutHarness.requests.findLast(r=>r.kind==='charge').data[4]),refreshedIntent)
  console.log('PASS refresh retains unknown creation intent even before order commit')

  await fresh();await selectProvider();await click()
  const rejectedIntent=await page.eval(()=>window.checkoutHarness.requests.findLast(r=>r.kind==='charge').data[4])
  await respond(await pending('charge'),{message:'Invalid amount',response:{status:400}},true);await click()
  assert.notEqual(await page.eval(()=>window.checkoutHarness.requests.findLast(r=>r.kind==='charge').data[4]),rejectedIntent,'definite rejection allows corrected input')
  await respond(await pending('charge'),{message:'response lost'},true);await click()
  await accept('charge',{...charge,manualPayment:null,recovered:true});await accept('charge-status',{order:{orderNo:'PAY-1',status:'pending',actualAmount:12}})
  for(const width of [1440,768,390])for(const theme of ['light','dark']) {
    await page.setViewport({width,height:900});await run(theme=>window.checkoutHarness.theme.setTheme(theme),theme);await sleep(350)
    assert.equal(await page.eval(()=>document.documentElement.scrollWidth>innerWidth),false,`${width}/${theme} overflow`)
    assert.ok(await page.eval(()=>document.querySelector('.checkout-pay').getBoundingClientRect().height>=44))
    const metrics=await page.eval(probe), lay=await page.eval(layout), screen=await page.eval(appProbe)
    const findings=[...judge(metrics,{width,allow:[]}),...judgeLayout(lay,{width,allow:[]})].filter(f=>!APP_SKIP.has(f.id)).concat(judgeApp(screen,metrics,{width,allow:[]}))
    writeFileSync(root+`/logs/pool-checkout-browser/${width}-${theme}-inspection.json`,JSON.stringify(findings,null,2))
    assert.ok(!findings.some(f=>f.level==='FAIL'),JSON.stringify(findings.filter(f=>f.level==='FAIL')))
    await page.screenshot({path:root+`/logs/pool-checkout-browser/${width}-${theme}.png`,format:'png',fullPage:true})
  }
  console.log('PASS checkout three widths / light and dark screenshots, primary target and no horizontal overflow')
} finally { if(browser)await browser.close();await server.close() }
