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
tailwindConfig.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/init-command-modals/*.js']
const output = resolve(root, 'logs/init-command-modals')
mkdirSync(output, { recursive: true })
// Restrict this reusable browser helper's profile sweep to this test's own output directory.
process.env.TASTE_SKILL_TMP = output
const server = await createServer({ configFile: false, root: root + '/scripts/fixtures/init-command-modals',
  plugins: [vue()], resolve: { alias: [
    { find: /^@\/api$/, replacement: root + '/scripts/fixtures/init-command-modals/api.js' },
    { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) })),
  ], dedupe: ['vue', 'pinia', 'vue-i18n'] }, css: { postcss: { plugins: [require('tailwindcss')(tailwindConfig), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19643, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen()
  browser = await Browser.launch()
  const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19643', { settleMs: 1500 })
  const check = async (predicate, label) => {
    for (let attempt = 0; attempt < 60; attempt++) {
      if (await page.eval(predicate)) return
      await sleep(50)
    }
    assert.fail(label + ': ' + await page.eval(() => document.body.innerText))
  }
  const run = async (fn, arg) => { await page.eval(fn, arg); await sleep(50) }
  const command = (id, name = `Detail ${id}`) => ({ id, name, command: `echo command-${id}`, distros: ['debian', 'ubuntu'], description: '独立测试备注', enabled: true, createdAt: '2026-10-28T00:00:00Z', updatedAt: '2026-10-28T00:00:00Z' })
  const resolveRequest = (index, detail) => run(({ index, detail }) => window.modalHarness.resolve(index, detail), { index, detail })
  const last = () => page.eval(() => window.modalHarness.pending.length - 1)
  const switchCommand = async id => { await run(id => window.modalHarness.setCommand(id), id); return last() }
  const click = async selector => {
    const box = await page.eval(selector => { const el = document.querySelector(selector); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } }, selector)
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...box, button: 'left', clickCount: 1 })
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...box, button: 'left', clickCount: 1 })
    await sleep(60)
  }
  await check(() => window.modalHarness?.pending.length === 1, 'initial detail starts')
  let a = await last(), b = await switchCommand(2)
  assert.equal(await page.eval(() => window.modalHarness.pending[0].signal.aborted), true)
  await resolveRequest(b, command(2))
  await resolveRequest(a, command(1))
  await check(() => document.querySelector('pre')?.textContent === 'echo command-2' && document.querySelector('.modal-header').textContent.includes('Detail 2'), 'title and body stay on current record')
  a = await switchCommand(3); b = await switchCommand(4)
  await run(index => window.modalHarness.reject(index), a)
  assert.equal(await page.eval(() => document.querySelector('[role=status]') !== null && window.modalHarness.events.length === 0 && window.modalHarness.toast.toasts.value.length === 0), true, 'obsolete failure/finally neither closes nor clears new loading')
  await resolveRequest(b, command(4))
  await click('.modal-body button')
  assert.equal(await page.eval(() => window.modalHarness.copies[0].text), 'echo command-4', 'copy captures exact current content')
  b = await switchCommand(5)
  await resolveRequest(b, command(5))
  await run(() => window.modalHarness.copies[0].resolve())
  assert.equal(await page.eval(() => document.querySelector('.modal-body button').textContent.includes('已复制')), false, 'old clipboard completion ignored')
  await click('.modal-body button')
  await run(() => window.modalHarness.newSession('session-b'))
  b = await last()
  assert.equal(await page.eval(() => document.querySelector('pre') === null), true, 'session change immediately hides old detail')
  await run(() => window.modalHarness.copies[1].reject(new Error('old clipboard denied')))
  await resolveRequest(b, command(5, 'New session name'))
  const count = await last()
  await run(() => window.modalHarness.refreshSession('session-b'))
  assert.equal(await last(), count, 'same SID refresh does not reload')
  assert.equal(await page.eval(() => window.modalHarness.toast.toasts.value.length), 0, 'old clipboard failure ignored')
  a = await switchCommand(6)
  await run(() => window.modalHarness.newSession('session-c'))
  b = await last()
  await resolveRequest(a, command(6, 'Previous session'))
  assert.equal(await page.eval(() => document.querySelector('[role=status]') !== null), true)
  await resolveRequest(b, command(6, 'Current session'))
  await click('.modal-body button')
  await run(() => window.modalHarness.copies[2].resolve())
  assert.equal(await page.eval(() => document.querySelector('.modal-body button').textContent.includes('已复制')), true)
  await click('.modal-header button')
  b = await switchCommand(7)
  await resolveRequest(b, command(7))
  await sleep(230)
  assert.equal(await page.eval(() => window.modalHarness.events.length), 0, 'old close timer cannot close replacement detail')
  await click('.modal-body button')
  await run(() => window.modalHarness.copies[3].resolve())
  await sleep(2050)
  assert.equal(await page.eval(() => document.querySelector('.modal-body button').textContent.includes('已复制')), false, 'copy feedback clears')
  a = await switchCommand(8)
  await click('.modal-header button')
  await run(() => { window.modalHarness.visible.value = false })
  await run(index => window.modalHarness.reject(index), a)
  await sleep(220)
  assert.equal(await page.eval(() => window.modalHarness.events.length), 0, 'unmount clears pending close')
  assert.equal(await page.eval(index => window.modalHarness.pending[index].signal.aborted, a), true)
  await run(() => { window.modalHarness.visible.value = true })
  a = await last()
  await run(index => window.modalHarness.reject(index), a)
  await sleep(230)
  assert.equal(await page.eval(() => window.modalHarness.events.length), 1, 'current failure emits one close')
  assert.equal(await page.eval(() => window.modalHarness.toast.toasts.value.length), 1)
  a = await switchCommand(9)
  await run(() => { window.modalHarness.auth.token = null })
  await resolveRequest(a, command(9))
  await sleep(230)
  assert.equal(await page.eval(() => document.querySelector('pre') === null && window.modalHarness.events.length === 2), true, 'logout clears detail and closes without accepting pending response')
  await run(() => window.modalHarness.newSession('session-d'))
  b = await last()
  const visual = command(9, '初始化脚本 / LongCommandName'.repeat(6))
  visual.description = '备注 / LongDescription'.repeat(30)
  visual.command = Array.from({ length: 20 }, (_, i) => `echo 'Line ${i}: isolated fixture'`).join('\n')
  await resolveRequest(b, visual)
  for (const [locale, dark, width] of [['zh-CN', false, 1440], ['zh-TW', true, 390], ['en', false, 390]]) {
    await page.setViewport({ width, height: 850, mobile: width === 390 })
    await run(({ locale, dark }) => { window.modalHarness.setLocale(locale); window.modalHarness.theme.setTheme(dark ? 'dark' : 'light') }, { locale, dark })
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= window.innerWidth && document.querySelector('.modal-content').scrollWidth <= document.querySelector('.modal-content').clientWidth), true, 'long modal content fits viewport')
    await page.screenshot({ path: resolve(output, `detail-${locale}-${width}.png`), format: 'png' })
  }
  console.log('PASS real Chrome/Vue detail modal: target and session changes, stale success/error/finally, abort, clipboard snapshot and old success/error, feedback timer, close timer reuse/unmount, logout, current failure, same-SID refresh, long content and three locales at desktop/mobile. Deferred API/clipboard fixture only; no real account/backend or system clipboard.')
} finally {
  if (browser) await browser.close()
  await server.close()
}
