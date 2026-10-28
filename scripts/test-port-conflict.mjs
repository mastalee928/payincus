import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { Browser, sleep } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'
const root = fileURLToPath(new URL('..', import.meta.url)).replaceAll('\\', '/')
const require = createRequire(new URL('../client/package.json', import.meta.url))
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href)
const { default: vue } = await import(pathToFileURL(require.resolve('@vitejs/plugin-vue')).href)
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js')
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/port-conflict/*.js']
const output = resolve(root, 'logs/port-conflict-lifecycle'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const server = await createServer({ configFile: false, root: root + '/scripts/fixtures/port-conflict', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/port-conflict/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19677, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19677', { settleMs: 1500 })
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(80); return result }
  const view = key => page.eval(key => JSON.parse(JSON.stringify(window.portHarness.view()[key])), key)
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  await run(() => { window.portHarness.view().resolvedPorts = { 80: '22x', 81: '23' }; window.portHarness.view().handleConfirm() })
  assert.equal(await page.eval(() => window.portHarness.submissions.length), 0, 'partially numeric input must never emit a confirmed mapping')
  assert.equal(await view('allValid'), false)
  console.log('PASS port conflict rejects partially numeric input')
  const count = () => page.eval(() => window.portHarness.submissions.length)
  const confirm = () => run(() => window.portHarness.view().handleConfirm())
  for (const value of ['', ' ', '22x', '22.5', '2e2', '+22', '-1', '0', '65536', 'Infinity', 'NaN', '２２', '0x16']) {
    await run(value => { window.portHarness.view().resolvedPorts = { 80: value, 81: '23' } }, value)
    assert.equal(await view('allValid'), false, `invalid port: ${value}`); await confirm(); assert.equal(await count(), 0)
  }
  await run(() => { window.portHarness.view().resolvedPorts = { 80: '22', 81: '022' } })
  assert.equal(await view('allValid'), false); await confirm(); assert.equal(await count(), 0)
  await run(() => { window.portHarness.view().resolvedPorts = { 80: ' 0022 ', 81: '65535' } })
  assert.equal(await view('allValid'), true)
  await run(() => { const v = window.portHarness.view(); v.handleConfirm(); v.handleConfirm(); v.resolvedPorts[80] = '444' })
  assert.deepEqual(await page.eval(() => window.portHarness.submissions), [[{ original: 80, resolved: 22 }, { original: 81, resolved: 65535 }]])
  await confirm(); assert.equal(await count(), 1)
  await run(() => window.portHarness.view().useSuggested()); assert.equal((await view('resolvedPorts'))[80], '444', 'busy suggestions must not change the draft')
  await run(() => { window.portHarness.state.loading = false; window.portHarness.state.start = 10000 })
  await run(() => { window.portHarness.view().resolvedPorts = { 80: '9999', 81: '10001' } }); assert.equal(await view('allValid'), false)
  await run(() => { window.portHarness.view().resolvedPorts = { 80: '10000', 81: '10001' } }); assert.equal(await view('allValid'), true)
  await run(() => { window.portHarness.state.start = null; window.portHarness.state.end = 10000 })
  await run(() => { window.portHarness.view().resolvedPorts = { 80: '10000', 81: '10001' } }); assert.equal(await view('allValid'), false)
  await run(() => { window.portHarness.view().resolvedPorts = { 80: '1', 81: '10000' } }); assert.equal(await view('allValid'), true)
  await run(() => { window.portHarness.state.start = 10001 }); assert.equal(await view('allValid'), false)
  await run(() => { window.portHarness.state.start = null; window.portHarness.state.end = null; window.portHarness.state.conflicts = [] })
  assert.equal(await view('allValid'), false); await confirm(); assert.equal(await count(), 1)
  await run(() => { window.portHarness.state.conflicts = [{ publicPort: 80, suggestedPort: 10080 }, { publicPort: 80, suggestedPort: 10081 }] })
  assert.equal(await view('allValid'), false); await confirm(); assert.equal(await count(), 1)
  await run(() => { window.portHarness.state.conflicts = [{ publicPort: 90, suggestedPort: 10090 }, { publicPort: 91, suggestedPort: null }] })
  assert.deepEqual(await view('resolvedPorts'), { 90: '10090', 91: '' }); assert.equal(await view('allValid'), false)
  await run(() => { window.portHarness.state.conflicts[1].suggestedPort = 10091 })
  assert.deepEqual(await view('resolvedPorts'), { 90: '10090', 91: '10091' }); assert.equal(await view('allValid'), true)
  await run(() => { window.portHarness.view().resolvedPorts[90] = '90'; window.portHarness.view().useSuggested() })
  assert.equal((await view('resolvedPorts'))[90], '10090')
  console.log('PASS full numeric grammar, normalized duplicates, bounds, empty/duplicate conflicts, updates, suggestions and repeated confirm')
  await run(() => { window.portHarness.state.visible = false }); await confirm(); assert.equal(await count(), 1)
  await run(() => { window.portHarness.state.visible = true }); assert.equal(await view('allValid'), true)
  await run(() => { window.portHarness.view().resolvedPorts[90] = '222' }); await run(() => window.portHarness.session('a', 2)); assert.equal((await view('resolvedPorts'))[90], '222')
  await run(() => window.portHarness.session('b')); await confirm(); assert.equal(await count(), 1); assert.equal(await page.eval(() => window.portHarness.state.visible), false)
  await run(() => { window.portHarness.state.visible = true; window.portHarness.state.active = false }); await confirm(); assert.equal(await count(), 1)
  await run(() => { window.portHarness.state.active = true }); assert.equal(await view('allValid'), true)
  await run(() => window.portHarness.session(null)); await confirm(); assert.equal(await count(), 1)
  await run(() => window.portHarness.session('c')); await run(() => { window.portHarness.state.visible = true })
  for (const [locale, width, dark, mobile] of [['zh-CN', 1440, false, false], ['en', 390, true, true]]) {
    await page.setViewport({ width, height: 1000, mobile })
    await run(({ locale, dark }) => { window.portHarness.setLocale(locale); window.portHarness.theme.setTheme(dark ? 'dark' : 'light') }, { locale, dark })
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
    assert.equal(await page.eval(() => [...document.querySelectorAll('input')].every(input => input.clientWidth >= 110)), true, 'full port number must fit the editable field')
    await page.screenshot({ path: resolve(output, `${locale}-${width}.png`), format: 'png' })
  }
  await run(() => { window.portHarness.state.mounted = false }); await confirm(); assert.equal(await count(), 1)
  console.log('PASS visible/session/cache/logout/unmount gates and desktop/mobile Chrome')
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
} finally { if (browser) await browser.close(); await server.close() }
