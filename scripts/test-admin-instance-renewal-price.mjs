import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { Browser, sleep } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'
const root = fileURLToPath(new URL('..', import.meta.url)).replaceAll('\\', '/')
const require = createRequire(new URL('../client/package.json', import.meta.url))
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href)
const { default: vue } = await import(pathToFileURL(require.resolve('@vitejs/plugin-vue')).href)
const output = resolve(root, 'logs/admin-renewal-price-browser'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js')
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/admin-renewal-price/*.js']
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/admin-renewal-price', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api\/admin$/, replacement: root + '/scripts/fixtures/admin-renewal-price/api.js' },
    { find: /^@\/api$/, replacement: root + '/scripts/fixtures/admin-renewal-price/api.js' },
    { find: '@fontsource-variable/inter', replacement: require.resolve('@fontsource-variable/inter') },
    { find: '@fontsource-variable/jetbrains-mono', replacement: require.resolve('@fontsource-variable/jetbrains-mono') },
    { find: /^@\/utils\/app-paths$/, replacement: root + '/client/src/utils/app-paths-admin.ts' },
    { find: '@', replacement: root + '/client/src' }, ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } }, server: { host: '127.0.0.1', port: 19773, strictPort: true, fs: { allow: [root] } }
})
const snapshot = { instanceId: 41, ownerId: 2, hostId: 3, incusId: 'isolated-guest', price: '10.00', final: false, billingCycle: 1, revision: 'a'.repeat(64) }
let browser
try {
  await server.listen()
  if (process.argv.includes('--inspect-only')) { console.log('Renewal price inspector ready http://127.0.0.1:19773/?inspect'); await new Promise(() => {}) }
  browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(60); return result }
  const waitFor = async fn => { for (let n = 0; n < 120; n++) { if (await page.eval(fn)) return; await sleep(100) } throw Error(await page.eval(() => document.body.innerText)) }
  const fresh = async () => { await page.goto('http://127.0.0.1:19773', { settleMs: 200 }); await waitFor(() => !!document.querySelector('.renewal-price-edit')) }
  const open = async () => { await run(() => { const b = document.querySelector('.renewal-price-edit'); b.focus(); b.click() }); await waitFor(() => window.renewalPrice.pending.length > 0) }
  const settle = (data = snapshot) => run(data => window.renewalPrice.pending.at(-1).resolve(data), data)
  const edit = value => run(value => { const input = document.querySelector('#renewal-price-input'); input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })) }, value)
  const submit = () => run(() => document.querySelector('dialog form').requestSubmit())
  const key = async (key, shiftKey = false) => { await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code: key, windowsVirtualKeyCode: key === 'Escape' ? 27 : 9, modifiers: shiftKey ? 8 : 0 }); await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: key === 'Escape' ? 27 : 9 }); await sleep(80) }
  const reports = []
  for (const locale of ['zh-CN', 'zh-TW', 'en']) for (const width of [1440, 768, 390]) for (const theme of ['light', 'dark']) {
    await fresh(); await page.setViewport({ width, height: 900, mobile: width < 500 })
    await run(({ locale, theme }) => { window.renewalPrice.setLocale(locale); window.renewalPrice.theme.setTheme(theme) }, { locale, theme })
    await open(); await settle()
    const info = await page.eval(() => { const d = document.querySelector('dialog'), rect = d.getBoundingClientRect(); return {
      text: d.innerText, scroll: d.scrollWidth, client: d.clientWidth, width: rect.width, pageWidth: document.body.scrollWidth,
      focus: d.contains(document.activeElement), input: document.querySelector('#renewal-price-input').value,
      controls: [...d.querySelectorAll('button,input')].map(el => ({ height: el.getBoundingClientRect().height, color: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor })),
      disabled: d.querySelector('[type=submit]').disabled } })
    assert.equal(info.input, '10.00'); assert.equal(info.disabled, false, 'saving the same base price establishes the final price')
    assert.ok(info.focus && info.scroll <= info.client + 1 && info.width <= width && info.pageWidth <= width)
    assert.ok(info.text.includes('seoul-amd-test') && !info.text.includes('instanceRenewalPrice.'))
    for (const c of info.controls) assert.ok(c.height >= 44, JSON.stringify(c))
    reports.push({ locale, width, theme, ...info })
    await page.screenshot({ path: output + `/${locale}-${width}-${theme}.png`, format: 'png' })
    await key('Escape')
    assert.equal(await page.eval(() => !!document.querySelector('dialog')), false)
    assert.equal(await page.eval(() => document.activeElement.classList.contains('renewal-price-edit')), true)
  }
  writeFileSync(output + '/layout.json', JSON.stringify(reports, null, 2))
  console.log('PASS actual Vue/Chrome: pencil entry, 18 locale/width/theme combinations, 44px controls, no clipping, focus/ESC/restore')
  for (const value of ['0', '12.34', '100000']) {
    await fresh(); await open(); await settle(); await edit(value)
    assert.equal(await page.eval(() => document.querySelector('[type=submit]').disabled), false)
    await run(() => { document.querySelector('dialog form').requestSubmit(); document.querySelector('dialog form').requestSubmit() })
    assert.equal(await page.eval(() => window.renewalPrice.pending.filter(p => p.method === 'put').length), 1)
    assert.deepEqual(await page.eval(() => window.renewalPrice.pending.at(-1).data), { price: Number(value).toFixed(2), revision: snapshot.revision })
    await key('Escape'); assert.equal(await page.eval(() => !!document.querySelector('dialog')), true)
    await settle({ ...snapshot, price: Number(value).toFixed(2), final: true, changed: true })
    assert.equal(await page.eval(() => window.renewalPrice.state.changed), 1)
    assert.equal(await page.eval(() => !!document.querySelector('dialog')), false)
  }
  console.log('PASS zero/decimal/max prices, one submit, pending-save protection and matching success receipt')
  for (const value of ['1.234', '01', '1e2', '-1', '100000.01', ' 10 ']) {
    await fresh(); await open(); await settle(); await edit(value); await submit()
    assert.equal(await page.eval(() => window.renewalPrice.pending.filter(p => p.method === 'put').length), 0)
    assert.equal(await page.eval(() => document.querySelector('[type=submit]').disabled), true)
  }
  await fresh(); await open(); await settle(); await edit('20'); await submit()
  await run(() => window.renewalPrice.pending.at(-1).reject({ code: 'RENEWAL_PRICE_CHANGED', httpStatus: 409 }))
  assert.equal(await page.eval(() => document.querySelector('[type=submit]').disabled), true)
  await run(() => document.querySelector('[role=alert]').parentElement.querySelector('button').click())
  await settle({ ...snapshot, price: '30.00', final: true, revision: 'b'.repeat(64) })
  assert.equal(await page.eval(() => document.querySelector('#renewal-price-input').value), '30.00')
  console.log('PASS invalid money rejected before requests and stale save requires explicit current-price reload')
  for (const mode of ['target', 'owner', 'host', 'guest', 'role', 'session', 'aba', 'storage', 'unmount']) {
    await fresh(); await open(); await settle(); await edit('20'); await submit()
    await run(mode => { const h = window.renewalPrice
      if (mode === 'target') h.state.id++
      else if (mode === 'owner') h.state.instance.expiryIdentity.ownerId++
      else if (mode === 'host') h.state.instance.expiryIdentity.hostId++
      else if (mode === 'guest') h.state.instance.expiryIdentity.incusId += '-new'
      else if (mode === 'role') h.session('price-a', 'user')
      else if (mode === 'session' || mode === 'aba') { h.session('price-b'); if (mode === 'aba') h.session('price-a') }
      else if (mode === 'storage') localStorage.setItem('token', 'fixture.changed.fixture')
      else h.state.open = false
    }, mode)
    await settle({ ...snapshot, price: '20.00', final: true })
    assert.equal(await page.eval(() => window.renewalPrice.state.changed), 0, mode)
  }
  for (const field of ['ownerId', 'hostId', 'incusId', 'instanceId']) {
    await fresh(); await open(); await settle({ ...snapshot, [field]: field === 'incusId' ? 'different-guest' : 999 })
    assert.equal(await page.eval(() => !!document.querySelector('#renewal-price-input')), false)
  }
  await fresh(); await open(); await settle(); await edit('20'); await submit()
  await settle({ ...snapshot, price: '21.00', final: true })
  assert.equal(await page.eval(() => window.renewalPrice.state.changed), 0)
  await fresh(); await run(() => window.renewalPrice.session('price-user', 'user'))
  assert.equal(await page.eval(() => !!document.querySelector('.renewal-price-edit')), false)
  console.log('PASS wrong binding/amount and late session/role/target/ABA/storage/unmount receipts cannot report success; user has no editor')
  await fresh(); await page.setViewport({ width: 390, height: 600, mobile: true }); await open(); await settle(); await edit('20')
  for (let n = 0; n < 6; n++) { await key('Tab'); assert.equal(await page.eval(() => document.querySelector('dialog').contains(document.activeElement)), true) }
  await page.screenshot({ path: output + '/mobile-short.png', format: 'png' })
  const bill = { billing: { instanceId: 41, expiresAt: '2030-02-02T04:00:00Z', autoRenew: true, isHostedInstance: false,
    renewPreview: [{ months: 1, price: 12.34, discountedPrice: 12.34, expiresAt: '2030-03-02T04:00:00Z' }] } }
  const customer = async () => {
    await fresh(); await run(() => { window.renewalPrice.session('customer-a', 'user'); window.renewalPrice.state.renewOpen = true })
    await waitFor(() => window.renewalPrice.pending.some(p => p.method === 'billing'))
  }
  const resolveCustomer = async () => {
    await run(bill => { const h = window.renewalPrice; h.pending.filter(p => p.method === 'billing').at(-1).resolve(bill);
      h.pending.filter(p => p.method === 'balance').at(-1).resolve({ balance: { balance: 1000 } }) }, bill)
  }
  await customer(); await resolveCustomer()
  const readsBeforeRefresh = await page.eval(() => window.renewalPrice.pending.filter(p => p.method === 'billing').length)
  await run(() => { const h = window.renewalPrice; h.auth.token = 'fixture.' + btoa(JSON.stringify({ sid: 'customer-a', iat: 123 })) + '.fixture'; localStorage.setItem('token', h.auth.token) })
  assert.equal(await page.eval(() => window.renewalPrice.pending.filter(p => p.method === 'billing').length), readsBeforeRefresh, 'same-session access token refresh preserves the approved quote')
  assert.equal(await page.eval(() => document.querySelector('button.bg-accent').disabled), false)
  await run(() => { const h = window.renewalPrice; const button = document.querySelector('button.bg-accent'); button.click(); button.click() })
  assert.equal(await page.eval(() => window.renewalPrice.pending.filter(p => p.method === 'renew').length), 1)
  await run(() => window.renewalPrice.pending.find(p => p.method === 'renew').resolve({ amount: NaN, months: 1, newExpiresAt: 'invalid' }))
  assert.equal(await page.eval(() => window.renewalPrice.state.renewed), 0, 'malformed renewal success must not close the window or report success')
  await customer()
  await run(bill => {
    const h = window.renewalPrice
    h.pending.find(p => p.method === 'billing').resolve({ ...bill, billing: { ...bill.billing, instanceId: 999 } })
    h.pending.find(p => p.method === 'balance').resolve({ balance: { balance: 1000 } })
  }, bill)
  assert.equal(await page.eval(() => !document.querySelector('button.bg-accent').disabled), false, 'wrong-instance quote cannot be submitted')
  await customer(); await resolveCustomer()
  await run(() => document.querySelector('button.bg-accent').click())
  const request = await page.eval(() => { const p = window.renewalPrice.pending.at(-1); return { id: p.id, data: p.data, method: p.method } })
  assert.deepEqual(request, { id: 41, method: 'renew', data: { months: 1, expectedAmount: 12.34 } })
  await run(() => { window.renewalPrice.state.id = 42; window.renewalPrice.pending.find(p => p.method === 'renew').resolve({ amount: 12.34 }) })
  assert.equal(await page.eval(() => window.renewalPrice.state.renewed), 0)
  for (const amount of [0, 12.34]) {
    await customer()
    await run(({ bill, amount }) => { const h = window.renewalPrice; const quote = { ...bill, billing: { ...bill.billing,
      renewPreview: [{ months: 1, price: amount, discountedPrice: amount, expiresAt: '2030-03-02T04:00:00Z' }] } };
      h.pending.find(p => p.method === 'billing').resolve(quote); h.pending.find(p => p.method === 'balance').resolve({ balance: { balance: 1000 } }) }, { bill, amount })
    await run(() => document.querySelector('button.bg-accent').click())
    await run(amount => window.renewalPrice.pending.find(p => p.method === 'renew').resolve({ amount, months: 1, newExpiresAt: '2030-03-02T04:00:00.000Z' }), amount)
    assert.equal(await page.eval(() => window.renewalPrice.state.renewed), 1)
    assert.equal(await page.eval(() => window.renewalPrice.state.renewOpen), false)
  }
  await customer()
  // Allow each target to reach the child as a rendered prop. A parent-only
  // 42->41 assignment in one Vue batch never changes the child's target.
  await run(() => { window.renewalPrice.state.id = 42 })
  await run(() => { window.renewalPrice.state.id = 41 })
  await run(bill => { const h = window.renewalPrice; h.pending.find(p => p.method === 'billing').resolve(bill);
    h.pending.find(p => p.method === 'balance').resolve({ balance: { balance: 1000 } }) }, bill)
  assert.equal(await page.eval(() => !document.querySelector('button.bg-accent').disabled), false)
  await customer(); await resolveCustomer()
  await run(() => document.querySelector('button.bg-accent').click())
  await run(() => { const h = window.renewalPrice; h.session('customer-b', 'user'); h.pending.find(p => p.method === 'renew').resolve({ amount: 12.34 }) })
  assert.equal(await page.eval(() => window.renewalPrice.state.renewed), 0)
  console.log('PASS actual customer renewal modal sends the shown final amount; malformed success/wrong quote rejected, same-session refresh preserves quote, stale target/ABA/session replies cannot report success')
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log('PASS short mobile viewport and native keyboard focus containment; zero browser console errors')
} finally { if (browser) await browser.close(); await server.close() }
