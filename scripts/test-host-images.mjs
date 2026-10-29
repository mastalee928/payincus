import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { Browser, sleep } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'
import { policy } from './fixtures/host-images/data.js'
const root = fileURLToPath(new URL('..', import.meta.url)).replaceAll('\\', '/'), require = createRequire(new URL('../client/package.json', import.meta.url))
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href), { default: vue } = await import(pathToFileURL(require.resolve('@vitejs/plugin-vue')).href)
const output = resolve(root, 'logs/host-images'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js'); tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/host-images/*.js']
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/host-images', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/host-images/api.js' }, { find: '@', replacement: root + '/client/src' }, ...['vue', 'pinia', 'vue-i18n'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } }, server: { host: '127.0.0.1', port: 19745, strictPort: true, fs: { allow: [root] } }
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  if (process.argv.includes('--inspect-only')) { console.log('Host images inspector ready http://127.0.0.1:19745/?inspect'); await new Promise(() => {}) }
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(40); return result }
  const fresh = async () => {
    await page.goto('http://127.0.0.1:19745', { settleMs: 250 }); const deadline = Date.now() + 15000
    while (!await page.eval(() => !!window.hostImagesHarness?.view())) { if (Date.now() > deadline) throw Error('Host images fixture did not mount'); await sleep(70) }
  }
  const settle = (index, result, fail = false) => run(({ index, result, fail }) => { const p = window.hostImagesHarness.pending[index]; fail ? p.reject(Error('测试镜像读取失败')) : p.resolve(result) }, { index, result, fail })
  await fresh(); await settle(0, null, true)
  await run(() => { void window.hostImagesHarness.view().savePolicy() })
  assert.equal(await page.eval(() => window.hostImagesHarness.pending.filter(p => p.kind === 'write').length), 0, 'failed initial policy never permits writing an unknown default')
  console.log('PASS failed initial host policy forbids writes')
  if (process.argv.includes('--before')) process.exitCode = 0
  else {
    await fresh(); await settle(0, policy())
    await run(() => { const v = window.hostImagesHarness.view(); void v.loadPolicy(); void v.loadPolicy() })
    await settle(2, policy(11, [2])); await settle(1, policy(11, [3]))
    assert.deepEqual(await page.eval(() => [...window.hostImagesHarness.view().selectedImageIds]), [2])
    console.log('PASS ordered current host reads')
    let checked = 0
    for (const kind of ['read', 'write']) for (const mode of ['host', 'host-aba', 'account', 'sid', 'role', 'logout', 'session-aba', 'cache', 'unmount']) for (const fail of [false, true]) {
      await fresh(); await settle(0, policy())
      await run(kind => { const h = window.hostImagesHarness, v = h.view(); window.oldHostImages = v; void v[kind === 'read' ? 'loadPolicy' : 'savePolicy']() }, kind)
      await run(mode => { const h = window.hostImagesHarness
        if (mode === 'host') h.host.value = { ...h.host.value, id: 12 }
        if (mode === 'host-aba') h.host.value = { ...h.host.value, id: 12 }
        if (mode === 'account') h.session(2)
        if (mode === 'sid') h.session(1, 'other-host-session')
        if (mode === 'role') h.session(1, 'host-images-session', 'user')
        if (mode === 'logout') h.auth.clearLocalAuth()
        if (mode === 'session-aba') { h.session(2); h.session(1) }
        if (mode === 'cache') h.active.value = false
        if (mode === 'unmount') h.mounted.value = false
      }, mode)
      if (mode === 'host-aba') await run(() => { const h = window.hostImagesHarness; h.host.value = { ...h.host.value, id: 11 } })
      const before = await page.eval(() => JSON.stringify({ selected: [...oldHostImages.selectedImageIds], images: [...oldHostImages.images], ready: oldHostImages.policyReady,
        error: oldHostImages.policyError, saveError: oldHostImages.saveError, loading: oldHostImages.loading, toasts: window.hostImagesHarness.toast.toasts.value.map(t => t.message) }))
      await settle(1, { ...policy(11, [1]), message: 'saved' }, fail)
      assert.equal(await page.eval(() => JSON.stringify({ selected: [...oldHostImages.selectedImageIds], images: [...oldHostImages.images], ready: oldHostImages.policyReady,
        error: oldHostImages.policyError, saveError: oldHostImages.saveError, loading: oldHostImages.loading, toasts: window.hostImagesHarness.toast.toasts.value.map(t => t.message) })), before, `${kind} ${mode} ignores obsolete success/failure`)
      if (mode === 'cache') {
        await run(() => { window.hostImagesHarness.active.value = true })
        assert.equal(await page.eval(() => window.hostImagesHarness.pending.at(-1).kind), 'read')
        await settle(2, policy())
      }
      checked++
    }
    console.log(`PASS actual host image read/save ${checked} obsolete route/account/session/ABA/cache/unmount receipts`)
    await fresh(); await settle(0, policy())
    await run(() => { const h = window.hostImagesHarness; h.auth.token = 'fixture.' + btoa(JSON.stringify({ sid: 'host-images-session', revision: 2 })) + '.fixture' })
    assert.equal(await page.eval(() => window.hostImagesHarness.pending.length), 1, 'same sid refresh keeps current policy')
    for (const result of [null, {}, { ...policy(), success: false }, policy(12), { ...policy(), host: { ...policy().host, architecture: 'arm' } },
      { ...policy(), images: null }, { ...policy(), images: [null] }, { ...policy(), images: [{ ...policy().images[0], name: null }] },
      { ...policy(), useDefault: 'true' }, { ...policy(), allowedImageIds: null }, { ...policy(), allowedImageIds: [-1] },
      { ...policy(), allowedImageIds: [99] }, { ...policy(), allowedImageIds: [1, 1] }, { ...policy(), images: [policy().images[0], policy().images[0]] }]) {
      await fresh(); await settle(0, result)
      assert.equal(await page.eval(() => window.hostImagesHarness.view().canSave), false)
      assert.ok(await page.eval(() => document.querySelector('[data-host-policy-error]')?.textContent))
      await run(() => { document.querySelector('[data-host-policy-error] button').click() })
      await settle(1, policy())
      assert.equal(await page.eval(() => !!document.querySelector('[data-host-policy-error]')), false)
    }
    await fresh(); await settle(0, policy())
    await run(() => { void window.hostImagesHarness.view().loadPolicy() }); await settle(1, null, true)
    assert.deepEqual(await page.eval(() => [...window.hostImagesHarness.view().selectedImageIds]), [1])
    assert.equal(await page.eval(() => window.hostImagesHarness.view().canSave), false)
    console.log('PASS fourteen malformed policies, persistent error/actual retry, last-good preservation and same-session refresh')

    await fresh(); await settle(0, policy())
    await run(() => { const v = window.hostImagesHarness.view(); void v.savePolicy(); void v.savePolicy(); v.toggleImage(2); void v.loadPolicy() })
    assert.equal(await page.eval(() => window.hostImagesHarness.pending.length), 2, 'duplicate writes and current reads cannot overlap a save')
    assert.deepEqual(await page.eval(() => [...window.hostImagesHarness.view().selectedImageIds]), [1])
    assert.ok(await page.eval(() => [...document.querySelectorAll('button[aria-pressed]')].every(button => button.disabled)))
    assert.deepEqual(await page.eval(() => window.hostImagesHarness.pending[1].data), { useDefault: false, imageIds: [1] })
    await settle(1, null, true)
    assert.ok(await page.eval(() => document.querySelector('[data-host-policy-save-error]')?.textContent))
    await run(() => { [...document.querySelectorAll('button')].find(button => button.textContent.trim() === window.hostImagesHarness.t('common.save')).click() })
    await settle(2, { ...policy(), message: 'saved' })
    assert.equal(await page.eval(() => window.hostImagesHarness.pending.length), 3, 'save uses its actual response instead of a new draft-overwriting read')
    assert.equal(await page.eval(() => window.hostImagesHarness.view().saveError), '')
    assert.equal(await page.eval(() => window.hostImagesHarness.toast.toasts.value.length), 1)
    for (const result of [null, { ...policy(), message: '' }, { ...policy(12), message: 'saved' }, { ...policy(11, [2]), message: 'saved' }]) {
      await fresh(); await settle(0, policy()); await run(() => { void window.hostImagesHarness.view().savePolicy() }); await settle(1, result)
      assert.ok(await page.eval(() => !!document.querySelector('[data-host-policy-save-error]')))
      assert.equal(await page.eval(() => window.hostImagesHarness.toast.toasts.value.length), 0)
    }
    for (const mode of ['draft', 'draft-aba']) {
      await fresh(); await settle(0, policy()); await run(() => { void window.hostImagesHarness.view().savePolicy() })
      await run(mode => { const v = window.hostImagesHarness.view(); v.selectedImageIds = [2]; if (mode === 'draft-aba') v.selectedImageIds = [1] }, mode)
      await settle(1, { ...policy(), message: 'saved' })
      assert.deepEqual(await page.eval(() => [...window.hostImagesHarness.view().selectedImageIds]), mode === 'draft' ? [2] : [1])
      assert.equal(await page.eval(() => window.hostImagesHarness.toast.toasts.value.length), 0)
    }
    console.log('PASS fixed submitted payload, duplicate/pending controls, save retry, malformed receipts and draft ABA')

    await fresh(); await settle(0, policy()); await run(() => { void window.hostImagesHarness.view().savePolicy(); window.hostImagesHarness.active.value = false })
    await run(() => { window.hostImagesHarness.active.value = true })
    await settle(2, policy()); await run(() => { void window.hostImagesHarness.view().savePolicy() })
    assert.equal(await page.eval(() => window.hostImagesHarness.pending.length), 3, 'cache return keeps original write lock')
    await settle(1, { ...policy(), message: 'saved' }); assert.equal(await page.eval(() => window.hostImagesHarness.toast.toasts.value.length), 0)
    await run(() => { void window.hostImagesHarness.view().savePolicy() }); await settle(3, { ...policy(), message: 'saved' })
    await fresh(); await settle(0, { ...policy(11, []), images: [], useDefault: true })
    assert.equal(await page.eval(() => window.hostImagesHarness.view().canSave), true)
    await run(() => { void window.hostImagesHarness.view().savePolicy() }); await settle(1, { ...policy(11, []), images: [], useDefault: true, message: 'saved' })
    assert.equal(await page.eval(() => window.hostImagesHarness.pending[1].data.useDefault), true)
    console.log('PASS cached original write lock and legitimate empty/default policy')

    for (const locale of ['zh-CN', 'zh-TW', 'en']) for (const width of [1440, 768, 390]) {
      await page.setViewport({ width, height: 900 }); await fresh(); await settle(0, policy())
      await run(locale => window.hostImagesHarness.setLocale(locale), locale)
      await run(() => { const buttons = [...document.querySelectorAll('button[aria-pressed]')]; buttons[0].click() })
      assert.equal(await page.eval(() => window.hostImagesHarness.view().useDefaultMode), true)
      await run(() => { document.querySelectorAll('button[aria-pressed]')[1].click() })
      await run(() => { document.querySelectorAll('button[aria-pressed]')[3].click() })
      assert.deepEqual(await page.eval(() => [...window.hostImagesHarness.view().selectedImageIds]), [1, 2])
      await run(() => { document.querySelector('input').value = 'ubuntu'; document.querySelector('input').dispatchEvent(new Event('input', { bubbles: true })) })
      assert.equal(await page.eval(() => window.hostImagesHarness.view().filteredImages.length), 1)
      await run(() => { const button = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === window.hostImagesHarness.t('common.save')); button.click() })
      await settle(1, { ...policy(11, [1, 2]), message: 'saved' })
      assert.ok(await page.eval(() => document.documentElement.scrollWidth <= innerWidth + 1))
      if (width === 390) assert.ok(await page.eval(() => [...document.querySelectorAll('button, input')].every(el => el.getBoundingClientRect().height >= 44)))
      await page.screenshot({ path: resolve(output, `${locale}-${width}.jpg`), fullPage: true })
    }
    assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
    console.log('PASS actual mode/image/search/save controls in three languages and three widths, 44px phone targets and zero overflow')
  }
  if (process.argv.includes('--serve')) { console.log('Host images fixture ready http://127.0.0.1:19745'); await new Promise(() => {}) }
} finally { if (browser) await browser.close(); await server.close() }
