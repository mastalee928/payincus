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
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/reinstall-selection/*.js']
const output = resolve(root, 'logs/reinstall-selection-lifecycle'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const server = await createServer({ configFile: false, root: root + '/scripts/fixtures/reinstall-selection', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/reinstall-selection/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19676, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19676', { settleMs: 1500 })
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(80); return result }
  const view = key => page.eval(key => JSON.parse(JSON.stringify(window.reinstallHarness.view()[key])), key)
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  assert.equal(await view('selectedImage'), 'debian/12')
  await run(() => { window.reinstallHarness.state.images = [window.reinstallHarness.image(13)] })
  await run(() => window.reinstallHarness.view().handleSubmit())
  assert.equal(await page.eval(() => window.reinstallHarness.submissions.some(item => item.data.image === 'debian/12')), false, 'removed image must never be submitted')
  console.log('PASS reinstall modal rejects a removed image')
  const count = () => page.eval(() => window.reinstallHarness.submissions.length)
  const submit = () => run(() => window.reinstallHarness.view().handleSubmit())
  const settle = () => run(() => { window.reinstallHarness.state.loading = false })
  for (const mode of ['Rebuild', 'Recreate']) {
    await settle()
    await run(() => { window.reinstallHarness.state.mounted = false })
    await run(mode => {
      const h = window.reinstallHarness
      h.state.visible = false; h.state.mode = mode; h.state.images = [h.image(12), h.image(13)]; h.state.keys = [{ id: 1, name: 'Fixture key 1' }, { id: 2, name: 'Fixture key 2' }]
    }, mode)
    await run(() => { window.reinstallHarness.state.mounted = true; window.reinstallHarness.state.visible = true })
    assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
    assert.equal(await view('selectedImage'), 'debian/12'); assert.equal(await view('selectedSshKeyId'), mode === 'Rebuild' ? null : 1)
    await run(() => { const v = window.reinstallHarness.view(); v.selectedSshKeyId = 2; v.selectImage('debian/13'); v.customInitCommandIds = [1] })
    await run(() => { const h = window.reinstallHarness; h.state.images = [h.image(12), h.image(13)]; h.state.keys = [...h.state.keys] })
    assert.equal(await view('selectedImage'), 'debian/13'); assert.equal(await view('selectedSshKeyId'), 2); assert.deepEqual(await view('customInitCommandIds'), [1])
    await run(() => { window.reinstallHarness.state.images.splice(1, 1) })
    assert.equal(await view('selectedImage'), 'debian/12'); assert.deepEqual(await view('customInitCommandIds'), [])
    await run(() => { window.reinstallHarness.state.keys.splice(1, 1) })
    assert.equal(await view('selectedSshKeyId'), mode === 'Rebuild' ? null : 1)
    await run(() => { window.reinstallHarness.state.images.length = 0 })
    assert.equal(await view('selectedImage'), ''); assert.equal(await view('canSubmit'), false)
    let prior = await count(); await submit(); assert.equal(await count(), prior)
    await run(() => { window.reinstallHarness.state.images.push(window.reinstallHarness.image(13)) })
    assert.equal(await view('selectedImage'), 'debian/13')
    await run(() => { window.reinstallHarness.state.keys.length = 0 })
    assert.equal(await view('selectedSshKeyId'), null); assert.equal(await view('canSubmit'), mode === 'Rebuild')
    if (mode === 'Rebuild') { await submit(); assert.equal(await count(), prior + 1); assert.equal(await page.eval(() => window.reinstallHarness.submissions.at(-1).data.sshKeyId), undefined); await settle() }
    else { await submit(); assert.equal(await count(), prior) }
    await run(() => { window.reinstallHarness.state.keys.push({ id: 3, name: 'Fixture key 3' }) })
    await run(() => { window.reinstallHarness.view().selectedSshKeyId = 99 })
    prior = await count(); await submit(); assert.equal(await count(), prior)
    await run(() => { window.reinstallHarness.view().selectedSshKeyId = 3; window.reinstallHarness.view().selectedImage = 'missing' })
    await submit(); assert.equal(await count(), prior)
    await run(() => window.reinstallHarness.view().selectImage('debian/13'))
    await run(() => window.reinstallHarness.view().selectImage('missing')); assert.equal(await view('selectedImage'), 'debian/13')
    await run(() => { const v = window.reinstallHarness.view(); v.customInitCommandIds = [1]; v.handleSubmit(); v.handleSubmit(); v.customInitCommandIds.push(2) })
    assert.equal(await count(), prior + 1, 'immediate duplicate emit must be gated before props.loading arrives')
    assert.deepEqual(await page.eval(() => window.reinstallHarness.submissions.at(-1).data), { image: 'debian/13', sshKeyId: 3, customInitCommandIds: [1] })
    await submit(); assert.equal(await count(), prior + 1)
    await run(() => { window.reinstallHarness.state.visible = false }); await submit(); assert.equal(await count(), prior + 1)
    await run(() => { window.reinstallHarness.state.visible = true }); await submit(); assert.equal(await count(), prior + 1)
    await settle(); assert.equal(await view('canSubmit'), true)
    await run(() => { const v = window.reinstallHarness.view(); v.customInitCommandIds = [1]; v.isImageDropdownOpen = true; v.imageSearchQuery = 'Debian' })
    await run(() => window.reinstallHarness.session('a', 2)); assert.deepEqual(await view('customInitCommandIds'), [1])
    await run(() => window.reinstallHarness.session('b')); assert.equal(await page.eval(() => window.reinstallHarness.state.visible), false)
    assert.deepEqual(await view('customInitCommandIds'), []); assert.equal(await view('isImageDropdownOpen'), false)
    await run(() => { window.reinstallHarness.state.visible = true }); prior = await count()
    await run(() => { window.reinstallHarness.state.active = false }); assert.equal(await page.eval(() => !!document.querySelector('body h3')), false)
    await submit(); assert.equal(await count(), prior)
    await run(() => { window.reinstallHarness.state.active = true }); assert.equal(await view('canSubmit'), true)
    await run(() => window.reinstallHarness.session(null)); await submit(); assert.equal(await count(), prior)
    assert.equal(await page.eval(() => !!document.querySelector('body h3')), false)
    await run(() => window.reinstallHarness.session('a')); await run(() => { window.reinstallHarness.state.visible = true })
    console.log(`PASS ${mode}: current image/key membership, deep list mutation, password/required-key semantics, copied commands, busy/session/cache/logout`)
    for (const [locale, width, dark, mobile] of [['zh-CN', 1440, false, false], ['en', 390, true, true]]) {
      await page.setViewport({ width, height: 1000, mobile })
      await run(({ locale, dark }) => { window.reinstallHarness.setLocale(locale); window.reinstallHarness.theme.setTheme(dark ? 'dark' : 'light') }, { locale, dark })
      assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
      await page.screenshot({ path: resolve(output, `${mode}-${locale}-${width}.png`), format: 'png' })
    }
  }
  const beforeUnmount = await count(); await run(() => { window.reinstallHarness.state.mounted = false }); await submit()
  assert.equal(await count(), beforeUnmount)
  assert.equal(await page.eval(() => !!document.querySelector('body h3')), false)
  console.log('PASS both reinstall dialogs desktop/mobile and unmount')
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
} finally { if (browser) await browser.close(); await server.close() }
