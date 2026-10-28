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
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/terms-modal/*.js']
const output = resolve(root, 'logs/terms-lifecycle-browser'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
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
  const acceptAt = (index, body) => run(({ index, body }) => window.termsHarness.pending[index].resolve(new Response(body)), { index, body })
  const accept = async body => acceptAt(await last(), body)
  const rejectAt = index => run(index => window.termsHarness.pending[index].reject(new Error('Old hidden terms error')), index)
  const text = () => page.eval(() => document.querySelector('.markdown-body')?.textContent ?? '')
  const show = value => run(value => { window.termsHarness.state.show = value }, value)
  const locale = value => run(value => window.termsHarness.setLocale(value), value)
  const route = async value => { await run(value => window.termsHarness.router.push(value), value); await sleep(250) }
  const aborted = index => page.eval(index => window.termsHarness.pending[index].signal?.aborted === true, index)
  const visible = () => page.eval(() => !!document.querySelector('.modal-content'))
  const waitClosed = async () => {
    const deadline = Date.now() + 2000
    while (await visible() && Date.now() < deadline) await sleep(50)
    assert.equal(await visible(), false, 'modal must be removed after its bounded leave transition')
  }
  const hiddenRead = await last(); await route('/other'); await waitClosed()
  assert.equal(await visible(), false, 'deactivated cached page must not leave its teleported terms over another page')
  assert.equal(await aborted(hiddenRead), true)
  const hiddenCount = await count(); await locale('en'); assert.equal(await count(), hiddenCount)
  await route('/terms'); assert.equal(await count(), hiddenCount + 1)
  await acceptAt(hiddenRead, '# Old hidden Chinese')
  assert.equal(await text(), ''); await accept('# Current English'); assert.match(await text(), /Current English/)
  // Successfully loaded same-language terms can be reused across a close/open.
  const cachedCount = await count(); await show(false); await waitClosed()
  await show(true); assert.equal(await count(), cachedCount); assert.match(await text(), /Current English/)
  await locale('zh-CN'); const closedRead = await last()
  await show(false); assert.equal(await aborted(closedRead), true)
  await show(true); const reopenedRead = await last(); assert.notEqual(reopenedRead, closedRead)
  await rejectAt(closedRead)
  assert.equal(await page.eval(() => !!document.querySelector('.modal-content .animate-spin')), true)
  await acceptAt(reopenedRead, '# Reopened Chinese'); assert.match(await text(), /Reopened Chinese/)
  await locale('en'); const oldSuccess = await last(); await show(false); await show(true)
  await accept('# Reopened English'); await acceptAt(oldSuccess, '# Closed old success')
  assert.match(await text(), /Reopened English/)
  // A fulfilled response can still have a pending body when the cached page deactivates.
  await locale('zh-CN'); const bodyRead = await last()
  await run(index => window.termsHarness.pending[index].resolve({ ok: true, text: () => new Promise(resolve => { window.termsHarness.finishBody = resolve }) }), bodyRead)
  await route('/other'); assert.equal(await aborted(bodyRead), true)
  await route('/terms'); await accept('# Current cached body')
  await run(() => window.termsHarness.finishBody('# Stale body')); assert.match(await text(), /Current cached body/)
  await locale('en'); const unmountedRead = await last()
  await run(() => { window.termsHarness.state.mounted = false }); await waitClosed()
  assert.equal(await aborted(unmountedRead), true); assert.equal(await visible(), false)
  await run(() => { window.termsHarness.state.mounted = true }); await accept('# New component English')
  await acceptAt(unmountedRead, '# Old component English'); assert.match(await text(), /New component English/)
  const beforeHiddenMount = await count(); await show(false)
  await run(() => { window.termsHarness.state.mounted = false })
  await run(() => { window.termsHarness.state.mounted = true })
  assert.equal(await count(), beforeHiddenMount, 'hidden mount must not fetch')
  await show(true); await accept('# Visible again'); assert.match(await text(), /Visible again/)
  console.log('PASS terms lifecycle: KeepAlive teleport removal, hidden locale/no fetch, abort, close/reopen cache and in-flight races, delayed bodies, unmount/remount and initially hidden mount; actual Vue with controlled fetch.')
} finally { if (browser) await browser.close(); await server.close() }
