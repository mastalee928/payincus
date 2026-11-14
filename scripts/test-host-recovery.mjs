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
const output = resolve(root, 'logs/host-recovery'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js')
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/host-recovery/*.js']
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/host-recovery', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api\/admin$/, replacement: root + '/scripts/fixtures/host-recovery/api.js' }, { find: '@', replacement: root + '/client/src' }, ...['vue', 'pinia', 'vue-i18n'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19785, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  const run = async (fn, arg) => { const value = await page.eval(fn, arg); await sleep(40); return value }
  const fresh = async () => {
    await page.goto('http://127.0.0.1:19785', { settleMs: 100 })
    const deadline = Date.now() + 15000
    while (!await page.eval(() => !!window.recoveryTest)) { if (Date.now() > deadline) throw Error(page.consoleErrors.join('\n')); await sleep(50) }
    await run(() => document.querySelector('#open').click())
  }
  const reply = (index, id = 53, done = false) => run(({ index, id, done }) => { const h = window.recoveryTest; h.reads[index].resolve(h.report(id, !done)) }, { index, id, done })
  const click = () => run(() => document.querySelector('.host-recovery .btn-primary').click())
  await fresh(); await reply(0); await click(); await click()
  assert.deepEqual(await page.eval(() => window.recoveryTest.writes.map(w => w.hostId)), [53])
  assert.equal(await page.eval(() => document.querySelector('.host-recovery .btn-primary').disabled), true)
  await run(() => window.recoveryTest.writes[0].reject(Error('fixture rejected')))
  assert.ok(await page.eval(() => document.querySelector('.host-recovery').textContent.includes('核验请求未成功')))
  await click(); await run(() => window.recoveryTest.writes[1].resolve({ accepted: true }))
  assert.ok(await page.eval(() => document.querySelector('.host-recovery').textContent.includes('已请求立即核验')))
  await reply(1, 53, true)
  assert.ok(await page.eval(() => window.recoveryTest.changes.value > 0 && !document.querySelector('.host-recovery').textContent.includes('已请求立即核验')))
  console.log('PASS button duplicate gate, failure retry, request acceptance and completed recovery')
  await fresh(); await click(); await run(() => { window.recoveryTest.hostId.value = 54 })
  await reply(1, 54); await reply(0, 53, true)
  await run(() => window.recoveryTest.writes[0].resolve({ accepted: true }))
  assert.equal(await page.eval(() => window.recoveryTest.changes.value), 0)
  assert.equal(await page.eval(() => window.recoveryTest.reads.length), 2)
  assert.ok(await page.eval(() => document.querySelector('.host-recovery').textContent.includes('singapore2-arm-54')))
  await click(); await run(() => document.querySelector('.host-recovery .btn-secondary').click())
  await run(() => window.recoveryTest.writes[1].resolve({ accepted: true }))
  assert.equal(await page.eval(() => document.querySelector('.host-recovery')), null)
  assert.equal(await page.eval(() => window.recoveryTest.reads.length), 2)
  console.log('PASS old host reads/POST receipts ignored, and closing never starts another read')
  for (const width of [390, 1440]) for (const theme of ['light', 'dark']) for (const locale of ['zh-CN', 'zh-TW', 'en']) {
    await page.setViewport({ width, height: 850 }); await fresh()
    await run(({ theme, locale }) => { const h = window.recoveryTest; h.theme.setTheme(theme); h.setLocale(locale) }, { theme, locale })
    await reply(0)
    assert.ok(await page.eval(() => document.querySelector('.host-recovery').contains(document.activeElement)))
    assert.ok(await page.eval(() => [...document.querySelectorAll('.host-recovery button')].every(el => el.getBoundingClientRect().height >= 44)))
    assert.ok(await page.eval(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector('.modal-content').scrollWidth <= document.querySelector('.modal-content').clientWidth + 1))
    const positions = await page.eval(() => [...document.querySelectorAll('.modal-footer button')].map(el => el.getBoundingClientRect().left))
    assert.ok(positions[0] < positions[1], 'Verify must be left of Close')
    await page.screenshot({ path: resolve(output, `${theme}-${width}-${locale}.png`), format: 'png' })
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await sleep(40)
    assert.equal(await page.eval(() => !!document.querySelector('.host-recovery')), false)
  }
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log('PASS three languages, desktop/mobile light/dark, 44px controls, left placement, focus and Escape')
} finally { if (browser) await browser.close(); await server.close() }
