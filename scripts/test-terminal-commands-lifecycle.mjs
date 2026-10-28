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
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/terminal-commands/*.js']
const output = resolve(root, 'logs/terminal-commands-lifecycle'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const server = await createServer({ configFile: false, root: root + '/scripts/fixtures/terminal-commands', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/terminal-commands/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19670, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19670', { settleMs: 1400 })
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(70); return result }
  const last = kind => page.eval(kind => window.commandsHarness.pending.findLastIndex(item => item.kind === kind), kind)
  const count = kind => page.eval(kind => window.commandsHarness.pending.filter(item => item.kind === kind).length, kind)
  const accept = (index, data) => run(({ index, data }) => window.commandsHarness.pending[index].resolve(data), { index, data })
  const reject = index => run(index => window.commandsHarness.pending[index].reject(new Error('fixture failure')), index)
  const view = key => page.eval(key => JSON.parse(JSON.stringify(window.commandsHarness.view()[key])), key)
  const draft = (name = 'Draft', command = 'echo fixture') => run(({ name, command }) => { const v = window.commandsHarness.view(); v.openCreateEditor(); v.form = { name, command, description: '' } }, { name, command })
  const save = () => run(() => { void window.commandsHarness.view().saveCommand() })
  const load = () => run(() => { void window.commandsHarness.view().loadCommands() })
  const execute = () => run(() => window.commandsHarness.view().executeSelectedCommand())
  const session = sid => run(sid => window.commandsHarness.session(sid), sid)
  const command = (id, name = `Command ${id}`) => ({ id, name, command: `echo fixture-${id}`, description: null, createdAt: '2030-01-01T00:00:00Z', updatedAt: '2030-01-01T00:00:00Z' })
  await accept(await last('list'), { commands: [] })
  await run(() => { const view = window.commandsHarness.view(); view.openCreateEditor(); view.form = { name: 'Original', command: 'echo original', description: '' }; void view.saveCommand() })
  const saving = await last('create')
  await run(() => { window.commandsHarness.view().form.name = 'New draft'; window.commandsHarness.view().form.command = 'echo new draft' })
  await accept(saving, { command: command(1, 'Original') })
  assert.equal(await page.eval(() => window.commandsHarness.view().form.name), 'New draft', 'completed save must not erase subsequent draft edits')
  assert.equal(await page.eval(() => window.commandsHarness.view().showEditor), true)
  console.log('PASS saved command completion preserves subsequent draft edits')
  await save(); const newSave = await last('create'); await save(); assert.equal(await last('create'), newSave)
  await accept(newSave, { command: command(2, 'New draft') }); assert.equal(await view('showEditor'), false)
  await load(); await accept(await last('list'), { commands: [command(1), command(2), command(3)] })
  assert.equal(await page.eval(() => document.querySelectorAll('button button').length), 0)
  await run(() => { const v = window.commandsHarness.view(); v.selectedId = 1; v.openEditEditor(); v.form.name = 'Updated 1' })
  await save(); const update = await last('update')
  await run(() => { const v = window.commandsHarness.view(); v.selectedId = 2; v.openEditEditor(); v.form.name = 'New edit 2' })
  await accept(update, { command: command(1, 'Updated 1') })
  assert.equal(await view('editingId'), 2); assert.equal((await view('form')).name, 'New edit 2'); assert.equal(await view('selectedId'), 2)
  await save(); const obsoleteFailure = await last('update'); await draft('After failure')
  const toastCount = await page.eval(() => window.commandsHarness.toasts.length); await reject(obsoleteFailure)
  assert.equal((await view('form')).name, 'After failure'); assert.equal(await page.eval(() => window.commandsHarness.toasts.length), toastCount)
  await save(); await reject(await last('create')); assert.equal(await view('saving'), false); assert.equal(await page.eval(() => window.commandsHarness.toasts.length), toastCount + 1)
  await run(() => window.commandsHarness.view().cancelEditor())
  await load(); const staleList = await last('list'); await load(); const freshList = await last('list')
  await accept(staleList, { commands: [command(99)] }); assert.equal(await view('loading'), true)
  await accept(freshList, { commands: [command(3)] }); assert.deepEqual((await view('commands')).map(c => c.id), [3])
  await load(); await reject(await last('list')); assert.equal(await view('ready'), false); assert.ok(await view('loadError'))
  await execute(); assert.deepEqual(await page.eval(() => window.commandsHarness.events), [])
  await load(); await accept(await last('list'), { commands: [command(3)] }); await execute()
  assert.deepEqual(await page.eval(() => window.commandsHarness.events), ['echo fixture-3'])
  const listBeforeRefresh = await count('list'); await run(() => window.commandsHarness.refresh()); assert.equal(await count('list'), listBeforeRefresh)
  await draft('Old account'); await save(); const sessionSave = await last('create')
  await session('b'); assert.equal(await view('ready'), false); assert.equal(await view('commands').then(items => items.length), 0)
  const sessionToasts = await page.eval(() => window.commandsHarness.toasts.length)
  await accept(sessionSave, { command: command(88) }); assert.equal(await page.eval(() => window.commandsHarness.toasts.length), sessionToasts)
  assert.equal(await view('loading'), true, 'new session reload waits for obsolete write settlement')
  await accept(await last('list'), { commands: [command(4)] }); assert.deepEqual((await view('commands')).map(c => c.id), [4])
  await load(); const logoutList = await last('list'); await session(null); await accept(logoutList, { commands: [command(90)] })
  assert.deepEqual(await view('commands'), []); await execute(); assert.equal(await page.eval(() => window.commandsHarness.events.length), 1)
  console.log('PASS fixed edit target, stale errors/lists, retry, busy writes and session isolation')

  await session('c'); await accept(await last('list'), { commands: [command(5), command(6)] })
  await run(() => { window.confirm = () => true; window.commandsHarness.view().selectedId = 5; void window.commandsHarness.view().deleteSelectedCommand() })
  const deletion = await last('delete'); await run(() => { window.commandsHarness.view().selectedId = 6 })
  await accept(deletion, {}); assert.deepEqual((await view('commands')).map(c => c.id), [6]); assert.equal(await view('selectedId'), 6)
  await draft('Cache old'); await save(); const cacheSave = await last('create')
  await run(() => { window.commandsHarness.state.active = false }); await run(() => { window.commandsHarness.state.active = true })
  assert.equal(await view('saving'), true); await draft('Cache new')
  await accept(cacheSave, { command: command(70) }); assert.equal((await view('form')).name, 'Cache new'); assert.equal(await view('ready'), false)
  await accept(await last('list'), { commands: [command(6), command(70)] }); assert.equal((await view('form')).name, 'Cache new')
  await run(() => { window.commandsHarness.state.mobile = true; window.commandsHarness.state.visible = false })
  assert.deepEqual(await view('commands'), []); await execute(); assert.equal(await page.eval(() => window.commandsHarness.events.length), 1)
  await run(() => { window.commandsHarness.state.visible = true }); await accept(await last('list'), { commands: [command(7)] })
  await draft('Mobile draft'); await save(); const mobileSave = await last('create')
  await run(() => { window.commandsHarness.state.visible = false }); await reject(mobileSave)
  await run(() => { window.commandsHarness.state.visible = true }); await accept(await last('list'), { commands: [command(7)] })
  for (const [locale, width, dark, mobile] of [['zh-CN', 1440, false, false], ['en', 390, true, true]]) {
    await page.setViewport({ width, height: 850, mobile })
    await run(({ locale, dark, mobile }) => { window.commandsHarness.setLocale(locale); window.commandsHarness.theme.setTheme(dark ? 'dark' : 'light'); window.commandsHarness.state.mobile = mobile }, { locale, dark, mobile })
    await sleep(450)
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
    if (mobile) assert.equal(await page.eval(() => document.querySelector('h3').getBoundingClientRect().left >= 0), true, 'mobile sheet content stays inside the screen after transition')
    await page.screenshot({ path: resolve(output, `${locale}-${width}.png`), format: 'png' })
  }
  await draft('Unmount old'); await save(); const unmountSave = await last('create'); const toastsOnLeave = await page.eval(() => window.commandsHarness.toasts.length)
  await run(() => { window.commandsHarness.state.mounted = false }); await accept(unmountSave, { command: command(80) })
  assert.equal(await page.eval(() => window.commandsHarness.toasts.length), toastsOnLeave)
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log('PASS delete target, cached/mobile pending writes, unmount, desktop/mobile Chrome')
} finally { if (browser) await browser.close(); await server.close() }
