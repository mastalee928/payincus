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
const tailwindConfig = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js')
tailwindConfig.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/init-command-selector/*.js']
const output = resolve(root, 'logs/init-command-selector')
mkdirSync(output, { recursive: true })
// Restrict this reusable browser helper's profile sweep to this test's own output directory.
process.env.TASTE_SKILL_TMP = output
const server = await createServer({ configFile: false, root: root + '/scripts/fixtures/init-command-selector',
  plugins: [vue()], resolve: { alias: [
    { find: /^@\/api$/, replacement: root + '/scripts/fixtures/init-command-selector/api.js' },
    { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) })),
  ], dedupe: ['vue', 'pinia', 'vue-i18n'] }, css: { postcss: { plugins: [require('tailwindcss')(tailwindConfig), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19642, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen()
  browser = await Browser.launch()
  const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19642', { settleMs: 1500 })
  const check = async (predicate, label) => {
    for (let attempt = 0; attempt < 60; attempt++) {
      if (await page.eval(predicate)) return
      await sleep(50)
    }
    assert.fail(label + ': ' + await page.eval(() => document.body.innerText))
  }
  const run = async (fn, arg) => { await page.eval(fn, arg); await sleep(50) }
  const command = (id, name, distro = 'all') => ({ id, name, distros: [distro], commandLineCount: 2, description: '独立测试命令描述' })
  const resolveRequest = (index, commands) => run(({ index, commands }) => window.selectorHarness.resolve(index, commands), { index, commands })
  const click = async selector => {
    const box = await page.eval(selector => { const el = document.querySelector(selector); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } }, selector)
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...box, button: 'left', clickCount: 1 })
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...box, button: 'left', clickCount: 1 })
    await sleep(60)
  }
  await check(() => window.selectorHarness?.pending.length === 1, 'initial request starts')
  await run(() => document.querySelector('#subject button').focus())
  await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 })
  await check(() => document.querySelector('#subject button').getAttribute('aria-expanded') === 'true', 'keyboard expands selector')
  await resolveRequest(0, [command(1, 'Debian first')])
  await click('#subject input[type=checkbox]')
  assert.deepEqual(await page.eval(() => Array.from(window.selectorHarness.selected.value)), [1])
  await run(() => window.selectorHarness.setDistro('ubuntu'))
  assert.deepEqual(await page.eval(() => Array.from(window.selectorHarness.selected.value)), [])
  await run(() => window.selectorHarness.setDistro('alpine'))
  await check(() => window.selectorHarness.pending.length === 3, 'rapid switch starts every request')
  assert.equal(await page.eval(() => window.selectorHarness.pending[1].signal.aborted), true)
  await resolveRequest(2, [command(3, 'Alpine current')])
  await resolveRequest(1, [command(2, 'Ubuntu obsolete')])
  await check(() => document.body.innerText.includes('Alpine current') && !document.body.innerText.includes('Ubuntu obsolete'), 'late success ignored')
  await click('#subject input[type=checkbox]')
  await run(() => window.selectorHarness.setDistro('debian'))
  await run(() => window.selectorHarness.setDistro('ubuntu'))
  await run(() => window.selectorHarness.reject(3))
  assert.equal(await page.eval(() => document.querySelector('#subject [role=alert]') === null && document.body.innerText.includes('加载中')), true, 'obsolete finally cannot clear current loading')
  await resolveRequest(4, [command(4, 'Ubuntu latest')])
  await run(() => window.selectorHarness.setDistro('rocky'))
  await run(() => window.selectorHarness.reject(5))
  await check(() => document.querySelector('#subject [role=alert]')?.textContent.includes('加载初始化命令失败'), 'error stays distinct from empty state')
  assert.equal(await page.eval(() => document.body.innerText.includes('暂无可用的初始化命令')), false)
  await click('#subject [role=alert] button')
  await resolveRequest(6, [command(6, 'Rocky retry')])
  await click('#subject input[type=checkbox]')
  await run(() => window.selectorHarness.setDistro('debian'))
  await run(() => window.selectorHarness.setDistro(''))
  await resolveRequest(7, [command(7, 'Discarded after clear')])
  assert.equal(await page.eval(() => document.querySelector('#subject').textContent.trim()), '')
  assert.deepEqual(await page.eval(() => Array.from(window.selectorHarness.selected.value)), [])
  await run(() => window.selectorHarness.setDistro('alpine'))
  await run(() => window.selectorHarness.newSession('session-b'))
  await resolveRequest(8, [command(8, 'Previous session')])
  await resolveRequest(9, [command(9, 'New session')])
  assert.equal(await page.eval(() => document.body.innerText.includes('Previous session')), false)
  await click('#subject input[type=checkbox]')
  await run(() => window.selectorHarness.refreshSession('session-b'))
  assert.equal(await page.eval(() => window.selectorHarness.pending.length), 10, 'same SID refresh keeps selection and list')
  assert.deepEqual(await page.eval(() => Array.from(window.selectorHarness.selected.value)), [9])
  await run(() => window.selectorHarness.setDistro('debian'))
  const eventsBefore = await page.eval(() => window.selectorHarness.events.length)
  await run(() => { window.selectorHarness.visible.value = false })
  await resolveRequest(10, [command(10, 'Unmounted response')])
  assert.equal(await page.eval(() => window.selectorHarness.events.length), eventsBefore)
  assert.equal(await page.eval(() => window.selectorHarness.pending[10].signal.aborted), true)
  await run(() => { window.selectorHarness.visible.value = true })
  await resolveRequest(11, Array.from({ length: 8 }, (_, index) => command(index + 20, `测试命令 ${index + 1} · long command description`)))
  await click('#subject button')
  for (const [locale, dark, width] of [['zh-CN', false, 1440], ['zh-TW', true, 390], ['en', false, 390]]) {
    await page.setViewport({ width, height: 850, mobile: width === 390 })
    await run(({ locale, dark }) => { window.selectorHarness.setLocale(locale); window.selectorHarness.theme.setTheme(dark ? 'dark' : 'light') }, { locale, dark })
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'selector must fit viewport')
    await page.screenshot({ path: resolve(output, `${locale}-${width}.png`), format: 'png' })
  }
  console.log('PASS real Chrome/Vue selector: rapid distro switches, old success/error/finally, cancellation, immediate selection clearing, empty distro, retry, session replacement/refresh, unmount, keyboard expansion, desktop/mobile and three locales. Production component/styles/store are used with deferred API fixture; no provisioning or real account requests.')
} finally {
  if (browser) await browser.close()
  await server.close()
}
