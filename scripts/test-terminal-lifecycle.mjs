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
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/terminal-lifecycle/*.js']
const output = resolve(root, 'logs/terminal-lifecycle'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const server = await createServer({ configFile: false, root: root + '/scripts/fixtures/terminal-lifecycle', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/terminal-lifecycle/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19668, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19668', { settleMs: 1500 })
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(90); return result }
  const key = (key, input = false) => run(({ key, input }) => {
    const event = new KeyboardEvent('keydown', { key, ctrlKey: true, shiftKey: true, cancelable: true, bubbles: true })
    ;(input ? document.querySelector('#fixture-input') : window).dispatchEvent(event)
    return event.defaultPrevented
  }, { key, input })
  await run(() => { window.terminalHarness.view(); window.terminalHarness.state.active = false })
  assert.equal(await key('F'), false, 'cached terminal must not capture keyboard shortcuts from another page')
  assert.equal(await page.eval(() => window.terminalHarness.view().showSearch), false)
  console.log('PASS inactive cached terminal leaves keyboard shortcuts alone')
  await run(() => { window.terminalHarness.state.active = true })
  assert.equal(await key('F'), true)
  assert.equal(await page.eval(() => window.terminalHarness.view().showSearch), true, 'one active shortcut handler toggles search once')
  assert.equal(await key('F', true), false, 'unrelated input keeps its shortcut')
  await run(() => {
    const view = window.terminalHarness.view()
    view.showHelp = true; view.showSettings = true; view.showInstanceSelector = true
    view.showSavedCommandsMobile = true; view.contextMenu.visible = true; view.linkTooltip.visible = true
    window.terminalHarness.state.active = false
  })
  assert.deepEqual(await page.eval(() => {
    const v = window.terminalHarness.view()
    return [v.showSearch, v.showHelp, v.showSettings, v.showInstanceSelector, v.showSavedCommandsMobile, v.contextMenu.visible, v.linkTooltip.visible]
  }), [false, false, false, false, false, false, false], 'all transient UI closes when cached')
  await run(() => { window.terminalHarness.state.active = true; window.terminalHarness.seedTab() })
  assert.equal(await page.eval(() => document.querySelectorAll('button button').length), 0, 'tab activation and close are separate buttons')
  await key('V'); assert.equal(await page.eval(() => window.terminalHarness.pendingClipboard.length), 1)
  await run(() => { window.terminalHarness.state.active = false; window.terminalHarness.pendingClipboard[0]('obsolete clipboard') })
  assert.deepEqual(await page.eval(() => window.terminalHarness.sent), [])
  assert.deepEqual(await page.eval(() => window.terminalHarness.closed), [], 'caching preserves the established terminal connection')
  assert.equal(await key('V'), false)
  assert.equal(await page.eval(() => window.terminalHarness.pendingClipboard.length), 1)
  await run(() => { window.terminalHarness.state.active = true })
  await key('V'); await run(() => window.terminalHarness.pendingClipboard[1]('current clipboard'))
  assert.deepEqual(await page.eval(() => window.terminalHarness.sent), ['current clipboard'])
  await run(() => { void window.terminalHarness.view().handleAccessoryPaste() })
  await run(() => { window.terminalHarness.view().activeTabId = ''; window.terminalHarness.view().activeTabId = 'fixture-tab' })
  await run(() => window.terminalHarness.pendingClipboard[2]('obsolete tab ABA clipboard'))
  assert.deepEqual(await page.eval(() => window.terminalHarness.sent), ['current clipboard'])
  await run(() => { void window.terminalHarness.view().handleAccessoryPaste() })
  await run(() => { window.terminalHarness.auth.token = `fixture.${btoa(JSON.stringify({ sid: 'b' }))}.fixture`; window.terminalHarness.pendingClipboard[3]('obsolete session clipboard') })
  assert.deepEqual(await page.eval(() => window.terminalHarness.sent), ['current clipboard'])
  for (let iteration = 0; iteration < 3; iteration++) {
    await run(() => { window.terminalHarness.state.active = false }); await run(() => { window.terminalHarness.state.active = true })
    assert.equal(await key('F'), true); assert.equal(await page.eval(() => window.terminalHarness.view().showSearch), true)
  }
  for (const [locale, width, dark] of [['zh-CN', 1440, false], ['en', 390, true]]) {
    await page.setViewport({ width, height: 850, mobile: width === 390 })
    await run(({ locale, dark }) => { window.terminalHarness.setLocale(locale); window.terminalHarness.theme.setTheme(dark ? 'dark' : 'light') }, { locale, dark })
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: resolve(output, `${locale}-${width}.png`), format: 'png' })
  }
  await run(() => { window.terminalHarness.state.mounted = false })
  assert.equal(await key('F'), false)
  assert.deepEqual(await page.eval(() => window.terminalHarness.closed), ['close'])
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  const mobile = await browser.newPage({ width: 390, height: 850, mobile: true, reducedMotion: true })
  await mobile.setViewport({ width: 390, height: 850, mobile: true })
  await mobile.goto('http://127.0.0.1:19668', { settleMs: 1200 })
  await mobile.eval(() => { window.terminalHarness.view(); window.terminalHarness.seedTab(); window.terminalHarness.theme.setTheme('dark'); window.terminalHarness.setLocale('en') })
  await sleep(150)
  assert.equal(await mobile.eval(() => window.terminalHarness.view().isMobileDevice), true, 'mobile uses a fresh device context')
  assert.equal(await mobile.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
  await mobile.screenshot({ path: resolve(output, 'en-390-native.png'), format: 'png' })
  assert.equal(mobile.consoleErrors.length, 0, mobile.consoleErrors.join('\n'))
  console.log('PASS cached overlays, delayed clipboard isolation, repeat activation and unmount cleanup')
} finally { if (browser) await browser.close(); await server.close() }
