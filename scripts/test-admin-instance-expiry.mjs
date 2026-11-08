import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { Browser, sleep } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'
const root = fileURLToPath(new URL('..', import.meta.url)).replaceAll('\\', '/'), require = createRequire(new URL('../client/package.json', import.meta.url))
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href), { default: vue } = await import(pathToFileURL(require.resolve('@vitejs/plugin-vue')).href)
const output = resolve(root, 'logs/admin-expiry-review-browser'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js')
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/admin-expiry/*.js']
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/admin-expiry', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api\/admin$/, replacement: root + '/scripts/fixtures/admin-expiry/api.js' },
    { find: '@fontsource-variable/inter', replacement: require.resolve('@fontsource-variable/inter') },
    { find: '@fontsource-variable/jetbrains-mono', replacement: require.resolve('@fontsource-variable/jetbrains-mono') },
    { find: /^@\/utils\/app-paths$/, replacement: root + '/client/src/utils/app-paths-admin.ts' },
    { find: '@', replacement: root + '/client/src' }, ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } }, server: { host: '127.0.0.1', port: 19763, strictPort: true, fs: { allow: [root] } }
})
let browser
const snapshot = { instanceId: 41, ownerId: 2, hostId: 3, incusId: 'vps-demo', expiresAt: '2030-02-02T04:00:00.123Z', revision: 'a'.repeat(64) }
try {
  await server.listen()
  if (process.argv.includes('--inspect-only')) { console.log('Expiry inspector ready http://127.0.0.1:19763/?inspect'); await new Promise(() => {}) }
  browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(70); return result }
  const waitFor = async (fn) => { for (let n = 0; n < 120; n++) { if (await page.eval(fn)) return; await sleep(100) } throw Error(await page.eval(() => document.body.innerText)) }
  const fresh = async () => { await page.goto('http://127.0.0.1:19763', { settleMs: 200 }); await waitFor(() => !!document.querySelector('.expiry-edit')) }
  const open = async () => { await run(() => { const b = document.querySelector('.expiry-edit'); b.focus(); b.click() }); await waitFor(() => window.expiry.pending.length > 0) }
  const settle = (data = snapshot) => run(data => window.expiry.pending.at(-1).resolve(data), data)
  const escape = async () => {
    await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 })
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 }); await sleep(100)
  }
  const edit = (value = '2030-03-02T12:34:56') => run(value => { const input = document.querySelector('#expiry-input'); input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })) }, value)
  await page.send('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Shanghai' })
  await fresh()
  await page.screenshot({ path: output + '/entry.png', format: 'png' })
  for (const locale of ['zh-CN', 'zh-TW', 'en']) for (const width of [1440, 768, 390]) for (const theme of ['light', 'dark']) {
    await fresh(); await page.setViewport({ width, height: 900, mobile: width < 500 })
    await run(({ locale, theme }) => { window.expiry.setLocale(locale); window.expiry.theme.setTheme(theme) }, { locale, theme })
    await open(); await settle()
    const info = await page.eval(() => { const d = document.querySelector('dialog'); return { text: d.innerText, scroll: d.scrollWidth, client: d.clientWidth,
      width: d.getBoundingClientRect().width, focus: d.contains(document.activeElement), pageWidth: document.body.scrollWidth,
      input: document.querySelector('#expiry-input').value, disabled: d.querySelector('[type=submit]').disabled } })
    assert.equal(info.input, '2030-02-02T12:00'); assert.equal(info.disabled, true, 'unchanged input must not truncate milliseconds')
    assert.ok(info.focus && info.scroll <= info.client + 1 && info.width <= width && info.pageWidth <= width)
    assert.ok(info.text.includes('Asia/Shanghai') && !info.text.includes('instanceExpiry.'))
    await page.screenshot({ path: output + `/${locale}-${width}-${theme}.png`, format: 'png' })
    await escape()
    const closed = await page.eval(() => ({ closed: !document.querySelector('dialog'), focus: document.activeElement.outerHTML.slice(0, 300) }))
    assert.ok(closed.closed && closed.focus.includes('expiry-edit'), JSON.stringify(closed))
  }
  console.log('PASS actual Vue/Chrome: info entry, 18 locale/width/theme combinations, no clipping, native focus/ESC/restore')
  await fresh(); await open(); await settle(); await edit()
  await run(() => { document.querySelector('dialog form').requestSubmit(); document.querySelector('dialog form').requestSubmit() })
  assert.equal(await page.eval(() => window.expiry.pending.filter(p => p.method === 'put').length), 1)
  assert.deepEqual(await page.eval(() => window.expiry.pending.at(-1).data), { revision: snapshot.revision, expiresAt: '2030-03-02T04:34:56.000Z' })
  await escape()
  assert.equal(await page.eval(() => !!document.querySelector('dialog')), true, 'pending save remains visible')
  await settle({ ...snapshot, expiresAt: '2030-03-02T04:34:56.000Z' })
  assert.equal(await page.eval(() => window.expiry.state.changed), 1)
  assert.equal(await page.eval(() => !!document.querySelector('dialog')), false)
  console.log('PASS exact UTC conversion, single submit and matching success receipt')
  await fresh(); await open(); await settle(); await edit()
  await run(() => document.querySelector('dialog form').requestSubmit())
  await run(() => window.expiry.pending.at(-1).reject({ code: 'EXPIRY_BUSY', httpStatus: 409 }))
  assert.equal(await page.eval(() => document.querySelector('dialog [type=submit]').disabled), true)
  assert.ok(await page.eval(() => document.querySelector('[role=alert]').textContent.includes('正在执行任务')), 'actual API wrapper exposes code at the top level')
  await run(() => document.querySelector('[role=alert]').parentElement.querySelector('button').click())
  await settle({ ...snapshot, expiresAt: '2030-04-02T04:00:00.000Z', revision: 'b'.repeat(64) })
  assert.equal(await page.eval(() => document.querySelector('#expiry-input').value), '2030-04-02T12:00')
  console.log('PASS stale update requires explicit reload; form adopts current expiry only on reload')
  for (const mode of ['target', 'owner', 'host', 'incus', 'role', 'session', 'aba', 'unmount', 'storage']) {
    await fresh(); await open(); await settle(); await edit()
    await run(() => document.querySelector('dialog form').requestSubmit())
    await run(mode => { const h = window.expiry
      if (mode === 'target') h.state.id++
      else if (mode === 'owner') h.state.instance.expiryIdentity.ownerId++
      else if (mode === 'host') h.state.instance.expiryIdentity.hostId++
      else if (mode === 'incus') h.state.instance.expiryIdentity.incusId += '-new'
      else if (mode === 'role') h.session('expiry-a', 'user')
      else if (mode === 'session' || mode === 'aba') { h.session('expiry-b'); if (mode === 'aba') h.session('expiry-a') }
      else if (mode === 'storage') localStorage.setItem('token', 'fixture.changed.fixture')
      else h.state.open = false
    }, mode)
    await settle({ ...snapshot, expiresAt: '2030-03-02T04:34:56.000Z' })
    assert.equal(await page.eval(() => window.expiry.state.changed), 0, mode)
  }
  await fresh(); await open(); await settle({ ...snapshot, instanceId: 42 })
  assert.equal(await page.eval(() => !!document.querySelector('#expiry-input')), false)
  await fresh(); await open(); await settle(); await edit(); await run(() => document.querySelector('dialog form').requestSubmit())
  await settle({ ...snapshot, instanceId: 42 })
  assert.equal(await page.eval(() => window.expiry.state.changed), 0)
  console.log('PASS wrong receipts and late target/role/session/ABA/storage/unmount replies cannot report success')
  for (const key of ['ownerId', 'hostId', 'incusId']) {
    await fresh(); await open(); await settle({ ...snapshot, [key]: key === 'incusId' ? 'other-guest' : 999 })
    assert.equal(await page.eval(() => !!document.querySelector('#expiry-input')), false, 'GET must match the displayed instance binding: ' + key)
  }
  await fresh(); await open()
  await run(() => { window.expiry.state.instance.expiryIdentity.ownerId++; window.expiry.state.instance.expiryIdentity.ownerId-- })
  await settle()
  assert.equal(await page.eval(() => !!document.querySelector('dialog')), false, 'same-ID ownership ABA invalidates a pending read')
  for (const code of ['ADMIN_REQUIRED', 'SESSION_INVALIDATED', 'ACCOUNT_BANNED']) {
    await fresh(); await open(); await run(code => window.expiry.pending.at(-1).reject({ code, httpStatus: 403 }), code)
    assert.ok(await page.eval(() => document.querySelector('[role=alert]').textContent.includes('管理员权限')))
  }
  await fresh(); await run(() => window.expiry.session('expiry-user', 'user'))
  assert.equal(await page.eval(() => !!document.querySelector('.expiry-edit')), false, 'regular user cannot see the editor entry')
  console.log('PASS current owner/host/guest binding, read ABA, actual auth error format and hidden regular-user entry')
  await fresh()
  assert.equal(await page.eval(() => window.expiry.expiryUtcInput('2030-02-30T12:00:00')), null)
  await page.send('Emulation.setTimezoneOverride', { timezoneId: 'America/New_York' })
  assert.equal(await page.eval(() => window.expiry.expiryUtcInput('2030-03-10T02:30:00')), null)
  assert.equal(await page.eval(() => window.expiry.expiryUtcInput('2030-03-10T03:30:00')), '2030-03-10T07:30:00.000Z')
  assert.equal(await page.eval(() => window.expiry.expiryUtcInput('2030-11-03T01:30:00')), null, 'fall-back time must not silently pick one instant')
  assert.equal(await page.eval(() => window.expiry.expiryUtcInput('9999-12-31T23:59:59')), null, 'UTC year 10000 is rejected locally')
  await page.send('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Shanghai' })
  assert.equal(await page.eval(() => window.expiry.expiryUtcInput('2000-01-01T00:00:00')), null, 'UTC year 1999 is rejected locally')
  await fresh(); await open(); await settle(); await edit()
  await page.send('Emulation.setTimezoneOverride', { timezoneId: 'America/New_York' })
  await run(() => document.querySelector('dialog form').requestSubmit())
  assert.equal(await page.eval(() => window.expiry.pending.filter(p => p.method === 'put').length), 0, 'timezone change cannot submit a different instant')
  assert.ok(await page.eval(() => document.querySelector('[role=alert]').textContent.includes('设备时区已变化')))
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log('PASS invalid calendar and DST-skipped local times rejected; DST offset is correct; zero console errors')
} finally { if (browser) await browser.close(); await server.close() }
