import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { Browser, sleep } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'
const root = fileURLToPath(new URL('..', import.meta.url)).replaceAll('\\', '/')
const require = createRequire(new URL('../client/package.json', import.meta.url))
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href)
const { default: vue } = await import(pathToFileURL(require.resolve('@vitejs/plugin-vue')).href)
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js')
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/terms-modal/*.js']
const output = resolve(root, 'logs/terms-language-browser'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const server = await createServer({ configFile: false, root: root + '/scripts/fixtures/terms-modal', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19671, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19671/', { settleMs: 1200 })
  const deadline = Date.now() + 15000
  while (!await page.eval(() => !!window.termsHarness?.pending.length)) {
    if (Date.now() >= deadline) throw Error('Terms modal did not load within 15 seconds')
    await sleep(100)
  }
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(60); return result }
  const count = () => page.eval(() => window.termsHarness.pending.length)
  const last = async () => (await count()) - 1
  const acceptAt = (index, body, status = 200) => run(({ index, body, status }) => window.termsHarness.pending[index].resolve(new Response(body, { status })), { index, body, status })
  const accept = async body => acceptAt(await last(), body)
  const rejectAt = index => run(index => window.termsHarness.pending[index].reject(new Error('Controlled terms failure')), index)
  const locale = value => run(value => window.termsHarness.setLocale(value), value)
  const text = () => page.eval(() => document.querySelector('.markdown-body')?.textContent ?? '')
  assert.equal(await page.eval(() => window.termsHarness.pending[0].path), '/tos/zh.md')
  await accept('# Chinese fixture'); assert.match(await text(), /Chinese fixture/)
  await locale('en')
  assert.equal(await count(), 2, 'switching language with visible cached terms must load the selected language')
  assert.equal(await text(), '', 'previous language must not remain visible during loading')
  assert.equal(await page.eval(() => window.termsHarness.pending.at(-1).path), '/tos/en.md')
  await accept('# English fixture'); assert.match(await text(), /English fixture/)
  await run(() => { window.termsHarness.state.show = false }); await locale('zh-TW')
  const hiddenCount = await count(); await run(() => { window.termsHarness.state.show = true })
  assert.equal(await count(), hiddenCount + 1)
  assert.equal(await page.eval(() => window.termsHarness.pending.at(-1).path), '/tos/zh.md')
  await accept('# Chinese shared source'); await locale('zh-CN')
  assert.equal(await count(), hiddenCount + 1, 'both Chinese UI variants use the existing zh terms source')
  await locale('en'); const staleEnglish = await last()
  await locale('zh-CN'); const currentChinese = await last()
  await rejectAt(staleEnglish)
  assert.equal(await page.eval(() => !!document.querySelector('.modal-content .animate-spin')), true, 'old errors/finally cannot hide a newer loader')
  await acceptAt(currentChinese, '# Current Chinese')
  await locale('en'); const staleSuccess = await last()
  await locale('zh-CN'); await accept('# Newest Chinese')
  await acceptAt(staleSuccess, '# Stale English'); assert.match(await text(), /Newest Chinese/)
  // Also delay response.text(): selecting another language must invalidate parsing its late body.
  await locale('en'); const slowBody = await last()
  await run(index => window.termsHarness.pending[index].resolve({ ok: true, text: () => new Promise(resolve => { window.termsHarness.finishBody = resolve }) }), slowBody)
  await locale('zh-CN'); await accept('# Latest body')
  await run(() => window.termsHarness.finishBody('# Old body')); assert.match(await text(), /Latest body/)
  await locale('en'); await acceptAt(await last(), 'not found', 404)
  assert.equal(await text(), '')
  assert.equal(await page.eval(() => document.querySelector('.modal-content').textContent.includes(window.termsHarness.t('auth.tos.loadFailed'))), true)
  await run(() => [...document.querySelectorAll('button')].find(el => el.textContent.trim() === window.termsHarness.t('common.refresh')).click())
  await accept('# Retry English'); assert.match(await text(), /Retry English/)
  // Use the repository's unchanged terms for the visual checks.
  const source = lang => readFileSync(resolve(root, `client/public/tos/${lang}.md`), 'utf8')
  for (const value of ['zh-CN', 'zh-TW', 'en']) {
    const before = await count(); await locale(value)
    if (await count() > before) await accept(source(value.startsWith('zh') ? 'zh' : 'en'))
    for (const width of [1440, 390]) {
      await run(width => window.termsHarness.theme.setTheme(width === 390 ? 'dark' : 'light'), width)
      await page.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width === 390 })
      await page.screenshot({ path: resolve(output, `${value}-${width}.png`) })
      assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
    }
  }
  console.log('PASS terms language: visible and hidden language changes, shared zh source, old success/error/finally/body isolation, HTTP failure/retry and 3 locales at desktop/mobile. Actual component with controlled fetch; legal content unchanged.')
} finally { if (browser) await browser.close(); await server.close() }
