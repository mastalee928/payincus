import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Browser, sleep } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'
const root = fileURLToPath(new URL('..', import.meta.url)).replaceAll('\\', '/')
const require = createRequire(new URL('../client/package.json', import.meta.url))
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href)
const { default: vue } = await import(pathToFileURL(require.resolve('@vitejs/plugin-vue')).href)
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js')
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/pool-checkout/*.{js,vue}']
mkdirSync(root + '/logs/pool-checkout-browser', { recursive: true })
const server = await createServer({ configFile: false, root: root + '/scripts/fixtures/pool-checkout', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/pool-checkout/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue','pinia','vue-i18n','vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue','pinia','vue-i18n','vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } }, server: { host: '127.0.0.1', port: 19817, strictPort: true, fs: { allow: [root] } } })
// CI browser acceptance. Local interactive verification uses cua_repl instead.
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19817/checkout?manual=1', { settleMs: 900 })
  const run = async (fn,arg) => { const result=await page.eval(fn,arg); await sleep(70); return result }
  const wait = async fn => { const until=Date.now()+8000; while(!await page.eval(fn)){assert.ok(Date.now()<until,await page.eval(()=>document.body.innerText));await sleep(50)} }
  const clickText = text => run(text=>{const el=[...document.querySelectorAll('button,a')].find(el=>el.textContent.trim()===text);if(!el)throw Error('Missing '+text);el.click()},text)
  await clickText('加入测试商品');await clickText('加入测试商品')
  await run(()=>{const fields=document.querySelectorAll('input[id^="cart-name-"]');fields[1].value='second-server';fields[1].dispatchEvent(new Event('input',{bubbles:true}))})
  await wait(()=>document.querySelectorAll('.checkout-pay-choice button').length===4)
  assert.match(await page.eval(()=>document.querySelector('.checkout-pay-choice button').textContent), /账户余额\(￥\d+\.\d{2}\)/)
  await clickText('微信支付');await clickText('确认并付款')
  await wait(()=>document.querySelector('.purchase-payment'))
  assert.match(await page.eval(()=>document.querySelector('.payment-options button').textContent), /账户余额\(￥\d+\.\d{2}\)/)
  const original=await page.eval(()=>new URL(location.href).searchParams.get('checkout'))
  assert.ok(original)
  assert.ok((await page.eval(()=>document.querySelector('.payment-total').textContent)).includes('22.44'))
  await clickText('USDT')
  assert.ok((await page.eval(()=>document.querySelector('.payment-total').textContent)).includes('22.00'))
  assert.equal(await page.eval(()=>!!document.querySelector('.payment-hint')),false,'old gateway prompt disappears')
  await page.goto(await page.eval(()=>location.href),{settleMs:500})
  assert.equal(await page.eval(()=>document.querySelector('.payment-options .selected').textContent.trim()),'USDT','reload preserves method')
  await clickText('取消订单');await wait(()=>document.body.innerText.includes('订单已取消'))
  await clickText('购物车');await clickText('确认并付款');await wait(()=>document.querySelector('.order-result'))
  const current=await page.eval(()=>new URL(location.href).searchParams.get('checkout'))
  assert.notEqual(current,original,'cancelled checkout cannot trap repeat purchase')
  assert.ok((await page.eval(()=>document.body.innerText)).includes('购物车 0 台'))
  assert.equal(await page.eval(()=>[...document.querySelectorAll('button')].some(el=>el.textContent.trim()==='确认并付款')),false,'paid order has no second confirmation')
  assert.equal(await page.eval(()=>window.checkoutHarness.requests.some(r=>['charge','buy'].includes(r.kind))),false,'no recharge intermediary')
  await clickText('选择商品')
  await run(()=>{const input=document.querySelector('input[placeholder="my-server"]');input.value='direct-server';input.dispatchEvent(new Event('input',{bubbles:true}))})
  await clickText('直接购买');await wait(()=>location.pathname==='/order/confirm' && !new URL(location.href).searchParams.has('checkout'))
  assert.equal(await page.eval(()=>window.checkoutHarness.cart.totalQuantity),0)
  await clickText('支付宝');await clickText('确认并付款');await wait(()=>document.querySelector('.purchase-payment'))
  for(const width of [1440,768,390]) for(const theme of ['light','dark']) for(const language of ['zh-CN','zh-TW','en']) {
    await page.setViewport({width,height:900});await run(({theme,language})=>{window.checkoutHarness.theme.setTheme(theme);window.checkoutHarness.setLocale(language)},{theme,language});await sleep(100)
    assert.equal(await page.eval(()=>document.documentElement.scrollWidth>innerWidth),false,`${width}/${theme}/${language} overflow`)
    assert.equal(await page.eval(()=>document.querySelectorAll('h1').length),1)
    assert.ok(await page.eval(()=>document.querySelector('.payment-primary').getBoundingClientRect().height>=44))
    await page.screenshot({path:root+`/logs/pool-checkout-browser/${width}-${theme}-${language}.png`,format:'png',fullPage:true})
  }
  console.log('PASS direct/cart split, batch payment, switch/reload, cancel/rebuy, automatic delivery, no recharge intermediary and 18 responsive views')
} finally { if(browser)await browser.close();await server.close() }
