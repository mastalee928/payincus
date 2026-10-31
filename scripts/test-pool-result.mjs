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
mkdirSync(root + '/logs/pool-result-browser', { recursive: true })
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

  const ready = id => ({...result(id), instances:[{...result(id).instances[0],status:'running',host:'192.0.2.10',sshPort:22,rootPassword:'isolated-test-password'}]})
  const show=async id=>{await run(id=>window.checkoutHarness.router.push('/checkout?order='+id),id);await accept('order',ready(id));await wait(()=>!!document.querySelector('.order-address-value button'))}
  const controlClipboard=()=>run(()=>{window.pendingCopies=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:value=>new Promise((resolve,reject)=>window.pendingCopies.push({value,resolve,reject}))}})})
  await load();await show('first');await controlClipboard()
  await run(()=>document.querySelector('.order-address-value button').click())
  await run(()=>window.checkoutHarness.router.push('/purchase'))
  const toastCount=await page.eval(()=>window.checkoutHarness.toast.toasts.value.length)
  await run(()=>window.pendingCopies[0].reject(Error('late failure')))
  assert.equal(await page.eval(()=>window.checkoutHarness.toast.toasts.value.length),toastCount,'a clipboard failure after leaving checkout must not notify the new page')

  console.log('PASS result clipboard does not notify another route')
  for(const scenario of ['route-aba','account','session','storage','unmount']) {
    await fresh();await show('copy-'+scenario);await controlClipboard()
    await run(()=>document.querySelector('.order-address-value button').click())
    await run(async scenario=>{const h=window.checkoutHarness;if(scenario==='account')h.account(2);if(scenario==='session')h.account(1,'next');if(scenario==='route-aba'){await h.router.push('/purchase');await h.router.push('/checkout?order=copy-route-aba')}if(scenario==='storage')localStorage.setItem('token','changed');if(scenario==='unmount')h.state.mounted=false},scenario)
    if(scenario==='route-aba')await accept('order',ready('copy-route-aba'))
    await run(()=>window.pendingCopies[0].resolve())
    assert.equal(await page.eval(()=>!!document.querySelector('.order-copy-done')),false,scenario+' stale completion')
  }
  await fresh();await show('copy-normal');await controlClipboard()
  await run(()=>{document.querySelector('.order-address-value button').click();document.querySelector('.order-ssh button').click()})
  await run(()=>window.pendingCopies[1].resolve());await run(()=>window.pendingCopies[0].resolve())
  assert.equal(await page.eval(()=>!!document.querySelector('.order-ssh .order-copy-done')),true)
  assert.equal(await page.eval(()=>!!document.querySelector('.order-address-value .order-copy-done')),false)
  console.log('PASS result clipboard current success, reversed completions, route/account/session/storage/unmount isolation')
  const cases=[
    {status:'creating',refunded:false,refundPending:false,host:null,sshPort:null,rootPassword:null},
    {status:'error',refunded:false,refundPending:true,host:null,sshPort:null,rootPassword:null},
    {status:'error',refunded:true,refundPending:false,host:null,sshPort:null,rootPassword:null},
    {status:'running',refunded:false,refundPending:false,publicIpUpdating:true,host:null,sshPort:null,rootPassword:null},
    {status:'running',refunded:false,refundPending:false,host:'192.0.2.20',sshPort:22,rootPassword:'isolated-test-password'}
  ]
  for(let index=0;index<cases.length;index++) {
    await fresh();const id='state-'+index;await run(id=>window.checkoutHarness.router.push('/checkout?order='+id),id)
    await accept('order',{...result(id),instances:[{...result(id).instances[0],...cases[index]}]})
    assert.equal(await page.eval(()=>!!document.querySelector('.order-address-value')),index===4)
    assert.equal(await page.eval(()=>!!document.querySelector('.order-password')),index===4)
    assert.equal(await page.eval(()=>!!document.querySelector('.order-copy-done')),false)
    if(index===4) assert.equal(await page.eval(()=>document.querySelector('.order-password input').type),'password')
  }

  console.log('PASS result creating/refund-pending/refunded/address-updating/ready states and password hidden by default')
  for(const width of [1440,768,390])for(const theme of ['light','dark']) {
    await page.setViewport({width,height:900});await run(theme=>window.checkoutHarness.theme.setTheme(theme),theme);await sleep(150)
    assert.equal(await page.eval(()=>document.documentElement.scrollWidth>innerWidth),false)
    await page.screenshot({path:root+`/logs/pool-result-browser/${width}-${theme}.png`,format:'png',fullPage:true})
  }
  await run(()=>document.querySelector('.order-password button').click())
  assert.equal(await page.eval(()=>document.querySelector('.order-password input').type),'text')
  await run(()=>window.checkoutHarness.router.push('/purchase'));await run(()=>window.checkoutHarness.router.push('/checkout?order=state-4'));await accept('order',ready('state-4'))
  assert.equal(await page.eval(()=>document.querySelector('.order-password input').type),'password','password visibility does not survive leaving the order')



} finally { if(browser)await browser.close();await server.close() }
