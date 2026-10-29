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
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/host-notify-lifecycle/*.js']
const output = resolve(root, 'logs/host-notify-lifecycle-lifecycle'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const server = await createServer({ configFile: false, root: root + '/scripts/fixtures/host-notify-lifecycle', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/host-notify-lifecycle/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19685, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19685', { settleMs: 1600 })
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(90); return result }
  const last = kind => page.eval(kind => window.hostNotify.pending.findLastIndex(item => item.kind === kind), kind)
  const accept = (index, data) => run(({ index, data }) => window.hostNotify.pending[index].resolve(data), { index, data })
  const row = (id, hostId = 1) => ({ id, name: `Fixture instance ${id}`, hostId, status: 'running', image: 'debian/12', cpu: 1, memory: 512, disk: 10240, username: 'Fixture user', packagePlanId: 1, billingPrice: 10 })
  const list = (ids, hostId = 1, status = 'running') => ({ instances: ids.map(id => ({ ...row(id, hostId), status })), total: ids.length, totalPages: 1 })
  const choose = ids => run(ids => { window.hostNotify.view().selectedIds = new Set(ids) }, ids)
  await accept(await last('list'), list([1, 2]))
  await choose([1]); await run(() => window.hostNotify.view().openNotifyModal())
  await choose([2]); await run(() => { const v = window.hostNotify.view(); v.notifyTitle = 'Fixture title'; v.notifyContent = 'Fixture content'; void v.sendNotify() })
  assert.deepEqual(await page.eval(index => window.hostNotify.pending[index].params.instanceIds, await last('notify')), [1], 'notification uses reviewed instances, not later selection')
  console.log('PASS fixed notification recipients')
  const view = key => page.eval(key => JSON.parse(JSON.stringify(window.hostNotify.view()[key])), key)
  const count = kind => page.eval(kind => window.hostNotify.pending.filter(item => item.kind === kind).length, kind)
  const reject = index => run(index => window.hostNotify.pending[index].reject(new Error('Fixture notification failure')), index)
  const call = method => run(method => { void window.hostNotify.view()[method]() }, method)
  const draft = (title = 'Fixture title', content = 'Fixture content', sendEmail = false) => run(({ title, content, sendEmail }) => {
    const v = window.hostNotify.view(); v.notifyTitle = title; v.notifyContent = content; v.notifySendEmail = sendEmail
  }, { title, content, sendEmail })
  await call('sendNotify'); assert.equal(await count('notify'), 1)
  await draft('Later title', 'Later content', true); await accept(await last('notify'), { success: true, count: 1 })
  assert.equal(await view('showNotifyModal'), true); assert.equal(await view('notifyTitle'), 'Later title'); assert.equal(await view('notifySendEmail'), true)
  await call('sendNotify'); assert.deepEqual(await page.eval(index => window.hostNotify.pending[index].params, await last('notify')),
    { hostId: 1, instanceIds: [1], title: 'Later title', content: 'Later content', sendEmail: true })
  await accept(await last('notify'), { success: true, count: 1, email: { requested: true, mode: 'direct', sentCount: 1, queuedCount: 0, skippedCount: 0, failedCount: 0 } })
  assert.equal(await view('showNotifyModal'), false)
  await call('openNotifyModal'); await draft(); await call('sendNotify'); const queryWrite = await last('notify')
  await run(() => { window.hostNotify.view().searchQuery = 'next'; void window.hostNotify.view().handleSearch() }); await accept(await last('list'), list([2]))
  await choose([2]); await accept(queryWrite, { success: true, count: 1 }); assert.equal(await view('showNotifyModal'), false); assert.equal(await view('notifyContent'), '')
  const closed = await count('notify'); await call('sendNotify'); assert.equal(await count('notify'), closed)
  await choose([2]); await call('openNotifyModal')
  for (const [title, content] of [['', 'body'], ['title', ''], ['x'.repeat(201), 'body'], ['title', 'x'.repeat(5001)]]) {
    await draft(title, content); await call('sendNotify'); assert.equal(await count('notify'), closed)
  }
  await draft('x'.repeat(200), 'x'.repeat(5000)); await call('sendNotify'); await reject(await last('notify'))
  assert.ok(await view('notifyError')); assert.equal(await view('isSendingNotify'), false)
  await draft('  Current title  ', '  Current body  '); await call('sendNotify')
  assert.deepEqual(await page.eval(index => window.hostNotify.pending[index].params, await last('notify')),
    { hostId: 1, instanceIds: [2], title: 'Current title', content: 'Current body', sendEmail: false })
  await accept(await last('notify'), { success: false, count: 0 }); assert.ok(await view('notifyError')); assert.equal(await view('showNotifyModal'), true)
  await call('sendNotify'); const oldHost = await last('notify')
  await run(() => { window.hostNotify.state.id = 2 }); await accept(await last('list'), list([3], 2)); await choose([3])
  await call('openNotifyModal'); assert.equal(await view('showNotifyModal'), false)
  await accept(oldHost, { success: true, count: 1 }); assert.equal(await view('notifyError'), '')
  await call('openNotifyModal'); await draft(); await call('sendNotify'); const sameQuery = await last('notify')
  await call('loadInstances'); await accept(await last('list'), list([3], 2)); await accept(sameQuery, { success: true, count: 1 })
  assert.equal(await view('showNotifyModal'), false)
  await call('openNotifyModal'); await draft(); await run(() => window.hostNotify.session('a', 2)); assert.equal(await view('showNotifyModal'), true)
  await call('sendNotify'); const oldSession = await last('notify'); await run(() => window.hostNotify.session('b')); await accept(await last('list'), list([3], 2))
  await reject(oldSession); assert.equal(await view('notifyError'), ''); assert.equal(await view('notifyContent'), '')
  await choose([3]); await call('openNotifyModal'); await draft(); await call('sendNotify'); const oldCache = await last('notify')
  await run(() => { window.hostNotify.state.active = false }); await run(() => { window.hostNotify.state.active = true }); await accept(await last('list'), list([3], 2))
  await accept(oldCache, { success: true, count: 1 }); assert.equal(await view('showNotifyModal'), false)
  await choose([3]); await call('openNotifyModal'); await draft(); await call('sendNotify'); await reject(await last('notify'))
  await run(() => {
    const dialog = document.querySelector('[role="dialog"]'), controls = dialog.querySelectorAll('button, input, textarea')
    controls[controls.length - 1].focus(); controls[controls.length - 1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    if (document.activeElement !== controls[0]) throw new Error('notification confirmation must retain focus')
  })
  for (const [locale, width, dark, mobile] of [['zh-CN', 1440, false, false], ['en', 390, true, true]]) {
    await page.setViewport({ width, height: 1000, mobile })
    await run(({ locale, dark }) => { window.hostNotify.setLocale(locale); window.hostNotify.theme.setTheme(dark ? 'dark' : 'light') }, { locale, dark })
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: resolve(output, `${locale}-${width}.png`), format: 'png' })
  }
  await call('sendNotify'); const logout = await last('notify'); await run(() => window.hostNotify.session(null)); await reject(logout)
  const loggedOut = await count('notify'); await call('sendNotify'); assert.equal(await count('notify'), loggedOut); assert.equal(await view('notifyError'), '')
  await run(() => window.hostNotify.session('c')); await accept(await last('list'), list([3], 2)); await choose([3]); await call('openNotifyModal'); await draft(); await call('sendNotify')
  const unmounted = await last('notify'); await run(() => { window.hostNotify.state.mounted = false }); await accept(unmounted, { success: true, count: 1 })
  assert.equal(await view('isSendingNotify'), false); assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log('PASS fixed recipient set, duplicate gates, newer drafts, input bounds, failed/current/old receipts, same query/session/cache/logout/unmount and both viewports')
} finally { if (browser) await browser.close(); await server.close() }
