import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { Browser, sleep } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'
const root = fileURLToPath(new URL('..', import.meta.url)).replaceAll('\\', '/'), require = createRequire(new URL('../client/package.json', import.meta.url))
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href), { default: vue } = await import(pathToFileURL(require.resolve('@vitejs/plugin-vue')).href)
const output = resolve(root, 'logs/admin-email-browser'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js')
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/admin-email/*.js']
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/admin-email', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api\/admin$/, replacement: root + '/scripts/fixtures/admin-email/api.js' },
    { find: '@fontsource-variable/inter', replacement: require.resolve('@fontsource-variable/inter') },
    { find: /^@\/utils\/app-paths$/, replacement: root + '/client/src/utils/app-paths-admin.ts' },
    { find: '@', replacement: root + '/client/src' }, ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } }, server: { host: '127.0.0.1', port: 19765, strictPort: true, fs: { allow: [root] } }
})
let browser
const snapshot = { userId: 42, username: 'seoul-customer', email: 'seoul.customer@example.test', revision: 'a'.repeat(64) }
try {
  await server.listen()
  if (process.argv.includes('--inspect-only')) { console.log('Email inspector ready http://127.0.0.1:19765/?inspect'); await new Promise(() => {}) }
  browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(80); return result }
  const waitFor = async fn => { for (let n = 0; n < 100; n++) { if (await page.eval(fn)) return; await sleep(100) } throw Error(await page.eval(() => document.body.innerText)) }
  const fresh = async (query = '') => { await page.goto('http://127.0.0.1:19765/' + query, { settleMs: 150 }); await waitFor(() => !!document.querySelector('.user-email-edit')) }
  const open = async () => { await run(() => { const b = [...document.querySelectorAll('.user-email-edit')].find(e => e.getBoundingClientRect().width); b.focus(); b.click() }); await waitFor(() => window.emailFixture.pending.length > 0) }
  const settle = (data = snapshot) => run(data => window.emailFixture.pending.at(-1).resolve(data), data)
  const edit = (email = 'NEW.ADDRESS@example.test') => run(email => { const i = document.querySelector('#admin-email-input'); i.value = email; i.dispatchEvent(new Event('input', { bubbles: true })) }, email)
  const submit = () => run(() => document.querySelector('dialog form').requestSubmit())
  const escape = async () => { await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(100) }
  await fresh(); await open(); await settle(); await edit(); await submit()
  await run(() => {
    const oldValue = localStorage.getItem('token'), newValue = 'fixture.changed.fixture'
    localStorage.setItem('token', newValue)
    window.dispatchEvent(new StorageEvent('storage', { key: 'token', oldValue, newValue, storageArea: localStorage }))
  })
  assert.equal(await page.eval(() => !!document.querySelector('dialog')), false, 'another tab changes authentication: close pending modal immediately')
  await fresh(); await open(); await settle(); await edit(); await submit()
  await run(() => localStorage.setItem('token', 'fixture.changed.fixture'))
  await settle({ ...snapshot, email: 'new.address@example.test' })
  assert.equal(await page.eval(() => !!document.querySelector('dialog')), false, 'authentication drift before store sync cannot leave saving stuck')
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewport({ width, height: 900, mobile: width < 500 }); await fresh('?long-email')
    const layout = await page.eval(() => {
      const b = [...document.querySelectorAll('.user-email-edit')].find(e => e.getBoundingClientRect().width)
      const r = b.getBoundingClientRect(), text = b.previousElementSibling
      return { right: r.right, title: text.title, client: text.clientWidth, scroll: text.scrollWidth, page: document.body.scrollWidth }
    })
    assert.equal(layout.title.length, 254)
    assert.ok(layout.right <= width && layout.page <= width && layout.scroll > layout.client, JSON.stringify(layout))
    await page.screenshot({ path: output + `/review-long-email-${width}.png`, format: 'png' })
  }
  console.log('PASS authentication drift closes stale modal and maximum-length email keeps pencil visible')
  for (const locale of (process.argv.includes('--review-only') ? [] : ['zh-CN', 'zh-TW', 'en'])) for (const width of [1440, 768, 390]) for (const theme of ['light', 'dark']) {
    await fresh(); await page.setViewport({ width, height: 900, mobile: width < 500 })
    await run(({ locale, theme }) => { window.emailFixture.setLocale(locale); window.emailFixture.theme.setTheme(theme) }, { locale, theme })
    assert.ok(await page.eval(() => [...document.querySelectorAll('.user-email-edit')].every(b => !b.getAttribute('aria-label').includes('isolated-admin'))))
    const pencil = await page.eval(() => {
      const b = [...document.querySelectorAll('.user-email-edit')].find(e => e.getBoundingClientRect().width)
      const s = b.previousElementSibling.getBoundingClientRect(), icon = b.querySelector('svg').getBoundingClientRect(), rect = b.getBoundingClientRect()
      return { text: b.textContent.trim(), label: b.getAttribute('aria-label'), gap: icon.left - s.right,
        aligned: Math.abs(icon.top + icon.height / 2 - s.top - s.height / 2), width: rect.width, height: rect.height }
    })
    assert.equal(pencil.text, ''); assert.ok(pencil.label && pencil.gap >= 0 && pencil.gap <= 8 && pencil.aligned < 2, JSON.stringify(pencil))
    if (width < 500) assert.ok(pencil.width >= 44 && pencil.height >= 44)
    await page.screenshot({ path: output + `/entry-${locale}-${width}-${theme}.png`, format: 'png' })
    await open(); await settle()
    const info = await page.eval(() => { const d = document.querySelector('dialog'); return { text: d.innerText, scroll: d.scrollWidth, client: d.clientWidth,
      width: d.getBoundingClientRect().width, focus: d.contains(document.activeElement), disabled: d.querySelector('[type=submit]').disabled } })
    assert.ok(info.focus && info.scroll <= info.client + 1 && info.width <= width && info.disabled)
    assert.ok(info.text.includes('seoul.customer@example.test') && !info.text.includes('adminUserEmail.'))
    await page.screenshot({ path: output + `/${locale}-${width}-${theme}.png`, format: 'png' })
    await escape()
    assert.ok(await page.eval(() => !document.querySelector('dialog') && document.activeElement.classList.contains('user-email-edit')))
  }
  if (!process.argv.includes('--review-only')) console.log('PASS real UsersView and modal: 18 locales/widths/themes, correct self exclusion, no modal clipping, focus/ESC/restore')
  await fresh(); await open(); await settle(); await edit(snapshot.email.toUpperCase())
  assert.equal(await page.eval(() => document.querySelector('dialog [type=submit]').disabled), true)
  await edit('bad-address'); await submit(); assert.equal(await page.eval(() => window.emailFixture.pending.filter(p => p.method === 'put').length), 0)
  await edit(); await run(() => { document.querySelector('dialog form').requestSubmit(); document.querySelector('dialog form').requestSubmit() })
  assert.equal(await page.eval(() => window.emailFixture.pending.filter(p => p.method === 'put').length), 1)
  assert.deepEqual(await page.eval(() => window.emailFixture.pending.at(-1).data), { email: 'new.address@example.test', revision: snapshot.revision })
  await escape(); assert.equal(await page.eval(() => !!document.querySelector('dialog')), true)
  await run(() => { window.emailFixture.users[1].email = 'new.address@example.test' })
  await settle({ ...snapshot, email: 'new.address@example.test' }); assert.equal(await page.eval(() => !!document.querySelector('dialog')), false)
  assert.ok(await page.eval(() => document.body.innerText.includes('new.address@example.test')))
  console.log('PASS validation, normalized request, duplicate-submit guard, pending-save ESC guard and list refresh')
  for (const code of ['ADMIN_EMAIL_TAKEN', 'ADMIN_EMAIL_CHANGED', 'ADMIN_EMAIL_FAILED']) {
    await fresh(); await open(); await settle(); await edit(); await submit()
    await run(code => window.emailFixture.pending.at(-1).reject({ code }), code)
    assert.ok(await page.eval(() => !!document.querySelector('[role=alert]')))
    assert.equal(await page.eval(() => document.querySelector('#admin-email-input').disabled), code !== 'ADMIN_EMAIL_TAKEN')
  }
  for (const mode of ['role', 'session', 'aba', 'storage', 'unmount']) {
    await fresh(); await open(); await settle(); await edit(); await submit()
    await run(mode => { const h = window.emailFixture
      if (mode === 'role') h.session('email-a', 'user')
      else if (mode === 'session' || mode === 'aba') { h.session('email-b'); if (mode === 'aba') h.session('email-a') }
      else if (mode === 'storage') localStorage.setItem('token', 'different-session')
      else h.state.mounted = false
    }, mode)
    await settle({ ...snapshot, email: 'must-not-show@example.test' })
    assert.equal(await page.eval(() => document.body.innerText.includes('must-not-show@example.test')), false)
  }
  await fresh(); await open(); await settle({ ...snapshot, userId: 43 })
  assert.equal(await page.eval(() => !!document.querySelector('#admin-email-input')), false)
  console.log('PASS duplicate/stale/failure messages and rejected late role/session/ABA/storage/unmount/wrong-target receipts')
} finally { if (browser) await browser.close(); await server.close() }
console.log('PASS browser and fixture server closed after all assertions')
process.exit(0)
