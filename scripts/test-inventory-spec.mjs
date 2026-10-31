import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { Browser, sleep } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'
import { probe } from '../.agents/skills/design-taste-frontend/scripts/lib/probe.mjs'
import { judge, APP_SKIP } from '../.agents/skills/design-taste-frontend/scripts/lib/rules.mjs'
const root = fileURLToPath(new URL('..', import.meta.url)).replaceAll('\\', '/')
const require = createRequire(new URL('../client/package.json', import.meta.url))
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href)
const { default: vue } = await import(pathToFileURL(require.resolve('@vitejs/plugin-vue')).href)
const output = resolve(root, 'logs/inventory-spec'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js')
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/inventory-spec/*.js']
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/inventory-spec', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api(?:\/admin)?$/, replacement: root + '/scripts/fixtures/inventory-spec/api.js' }, { find: '@', replacement: root + '/client/src' }, ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19771, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(40); return result }
  const fresh = async () => {
    await page.goto('http://127.0.0.1:19771', { settleMs: 200 })
    const deadline = Date.now() + 15000
    while (!await page.eval(() => !!window.inventorySpec?.view())) { if (Date.now() > deadline) throw Error('Inventory fixture failed to mount'); await sleep(60) }
  }
  if (process.argv.includes('--focus-diagnostic')) {
    await fresh()
    await run(() => window.inventorySpec.view().openSpec([window.inventorySpec.host()]))
    console.log(JSON.stringify(await page.eval(() => ({ active: document.activeElement?.outerHTML?.slice(0, 200), root: !!window.inventorySpec.view().specDialog,
      controls: [...document.querySelectorAll('.inventory-spec select,.inventory-spec button')].map(el => ({ id: el.id, disabled: el.matches(':disabled'), rect: el.getBoundingClientRect().toJSON() })) }))))
    await run(() => document.querySelector('#host-spec-preset').focus())
    console.log('After direct focus:', await page.eval(() => document.activeElement?.id))
    process.exitCode = 0
  } else {
  if (process.argv.includes('--inspect-only')) {
    await fresh()
    console.log('Inventory inspector ready http://127.0.0.1:19771/?inspect')
    await new Promise(() => {})
  }
  const open = async () => run(() => { const h = window.inventorySpec; h.view().openSpec([h.host()]) })
  const start = async () => run(() => { void window.inventorySpec.view().saveSpec() })
  if (!process.argv.includes('--visual-only')) {
  await fresh()
  await run(() => { const h = window.inventorySpec; h.view().openSpec([h.host()]); void h.view().saveSpec() })
  assert.equal(await page.eval(() => window.inventorySpec.pending.length), 1)
  await run(() => { window.inventorySpec.mounted.value = false })
  await run(() => window.inventorySpec.pending[0].resolve({ success: true, updated: 1 }))
  assert.equal(await page.eval(() => window.inventorySpec.toast.toasts.value.length), 0, 'unmounted specification save must not notify a different page')
  assert.equal(await page.eval(() => window.inventorySpec.reads.length), 1, 'unmounted save must not start another inventory request')
  console.log('PASS obsolete inventory specification save has no notification or refresh after unmount')
  for (const result of ['success', 'failure']) {
    for (const change of ['cache', 'account', 'session', 'role', 'storage', 'storage-event', 'account-aba', 'disk', 'disk-aba', 'target', 'target-aba', 'filter', 'page']) {
      await fresh(); await open(); await start()
      assert.equal(await page.eval(() => window.inventorySpec.pending.length), 1)
      await run(change => {
        const h = window.inventorySpec, v = h.view()
        if (change === 'cache') h.active.value = false
        if (change === 'account') h.session(2)
        if (change === 'session') h.session(1, 'replacement-session')
        if (change === 'role') h.session(1, 'inventory-session', 'user')
        if (change === 'storage') localStorage.removeItem('token')
        if (change === 'storage-event') { localStorage.removeItem('token'); window.dispatchEvent(new StorageEvent('storage', { key: null })) }
        if (change === 'account-aba') { h.session(2); h.session(1) }
        if (change === 'disk') v.specDisk = 60
        if (change === 'disk-aba') { v.specDisk = 60; v.specDisk = 30 }
        if (change === 'target') v.specTargets = [h.host(12)]
        if (change === 'target-aba') { v.specTargets = [h.host(12)]; v.specTargets = [h.host()] }
        if (change === 'filter') v.search = 'another group'
        if (change === 'page') v.page = 2
      }, change)
      const baseline = await page.eval(() => {
        const h = window.inventorySpec, v = h.view()
        return { ids: v?.specTargets?.map(host => host.id) ?? [], disk: v?.specDisk ?? 30, reads: h.reads.length }
      })
      await run(result => {
        const item = window.inventorySpec.pending[0]
        if (result === 'success') item.resolve({ success: true, updated: 1 }); else item.reject(Error('Delayed save failure'))
      }, result)
      assert.equal(await page.eval(() => window.inventorySpec.toast.toasts.value.length), 0, `${change}/${result} notification`)
      assert.equal(await page.eval(() => window.inventorySpec.reads.length), baseline.reads, `${change}/${result} refresh`)
      assert.equal(await page.eval(() => document.querySelector('.inventory-spec [role="alert"]')?.textContent ?? ''), '')
      if (change === 'cache') {
        await run(() => { window.inventorySpec.active.value = true })
        assert.equal(await page.eval(() => window.inventorySpec.view().specTargets.length), 0)
      } else {
        assert.deepEqual(await page.eval(() => window.inventorySpec.view().specTargets.map(host => host.id)), baseline.ids)
        assert.equal(await page.eval(() => window.inventorySpec.view().specDisk), baseline.disk)
      }
    }
  }
  console.log('PASS 26 obsolete success/failure completions across cache, identity, storage, target, draft ABA and filters')
  await fresh(); await open(); await start()
  await run(() => { const h = window.inventorySpec, v = h.view(); void v.saveSpec(); v.openSpec([h.host(12)]); v.closeSpec() })
  assert.equal(await page.eval(() => window.inventorySpec.pending.length), 1)
  assert.deepEqual(await page.eval(() => window.inventorySpec.view().specTargets.map(host => host.id)), [11])
  await run(() => window.inventorySpec.session(1, 'inventory-session', 'admin', 'refreshed'))
  await run(() => window.inventorySpec.pending[0].resolve({ success: true, updated: 1 }))
  assert.equal(await page.eval(() => window.inventorySpec.toast.toasts.value.length), 1, 'same-session token refresh remains valid')
  assert.equal(await page.eval(() => window.inventorySpec.view().specTargets.length), 0)
  for (const response of [null, {}, { success: false, updated: 1 }, { success: true, updated: 0 }, { success: true, updated: 2 }, { success: true, updated: '1' }]) {
    await fresh(); await open(); await start(); await run(response => window.inventorySpec.pending[0].resolve(response), response)
    assert.equal(await page.eval(() => window.inventorySpec.toast.toasts.value.length), 0)
    assert.equal(await page.eval(() => window.inventorySpec.view().specTargets.length), 1)
    assert.ok(await page.eval(() => document.querySelector('[role="alert"]')?.textContent))
  }
  for (const value of [0, '', null, 60.5, 10000]) {
    await fresh(); await open(); await run(value => { const v = window.inventorySpec.view(); v.specDisk = value; void v.saveSpec() }, value)
    assert.equal(await page.eval(() => window.inventorySpec.pending.length), 0)
  }
  await fresh(); await run(() => { const h = window.inventorySpec; h.view().openSpec([h.host(11), h.host(12, 'aarch64')]); void h.view().saveSpec() })
  assert.equal(await page.eval(() => window.inventorySpec.pending.length), 0)
  await fresh(); await run(() => { const h = window.inventorySpec; h.view().openSpec([h.host(11), h.host(12)]); void h.view().saveSpec() })
  assert.deepEqual(await page.eval(() => window.inventorySpec.pending[0].data), { hostIds: [11, 12], resourcePreset: 'E2', customerDiskGiB: 30 })
  await run(() => window.inventorySpec.pending[0].resolve({ success: true, updated: 2 }))
  assert.equal(await page.eval(() => window.inventorySpec.toast.toasts.value.length), 1)
  console.log('PASS duplicate/open/close gate, same-session refresh, six invalid receipts, five disk inputs, architecture mismatch and batch payload')
  }
  for (const locale of ['zh-CN', 'zh-TW', 'en']) for (const width of [1440, 768, 390]) for (const theme of ['light', 'dark']) {
    await page.setViewport({ width, height: 1000 }); await fresh()
    await run(({ locale, theme }) => { const h = window.inventorySpec; h.setLocale(locale); h.theme.setTheme(theme); h.view().openSpec([{ ...h.host(), name: 'PayIncus-' + 'long-host-name-'.repeat(15) }]) }, { locale, theme })
    assert.ok(await page.eval(() => document.querySelector('.inventory-spec').contains(document.activeElement)))
    await run(() => { const input = document.querySelector('#host-spec-disk'); input.value = '60'; input.dispatchEvent(new Event('change', { bubbles: true })); document.querySelector('.inventory-spec button[type="submit"]').click() })
    assert.equal(await page.eval(() => window.inventorySpec.pending[0].data.customerDiskGiB), 60)
    assert.ok(await page.eval(() => document.querySelector('#host-spec-disk').matches(':disabled')))
    await run(() => window.inventorySpec.pending[0].reject({ code: 'RESOURCE_DISK_INSUFFICIENT' }))
    assert.ok(await page.eval(() => document.querySelector('[role="alert"]')?.textContent))
    assert.ok(await page.eval(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector('.inventory-spec').scrollWidth <= document.querySelector('.inventory-spec').clientWidth + 1))
    const heights = await page.eval(() => [...document.querySelectorAll('.inventory-spec button,.inventory-spec select')].map(el => el.getBoundingClientRect().height))
    assert.ok(heights.every(value => value >= 44), JSON.stringify(heights))
    await run(() => [...document.querySelectorAll('.inventory-spec button')].at(-1).focus())
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
    assert.equal(await page.eval(() => document.activeElement?.id), 'host-spec-preset')
    // Inspect the edited Teleport dialog; the unchanged inventory behind it has
    // its own review scope and remains in the screenshots.
    await page.eval(() => { window.inspectionBackground = document.querySelector('main'); window.inspectionBackground.remove() })
    const metrics = await page.eval(probe), findings = judge(metrics, { width }).filter(item => !APP_SKIP.has(item.id))
    await page.eval(() => { document.querySelector('#app').append(window.inspectionBackground); delete window.inspectionBackground })
    writeFileSync(resolve(output, `r114-${locale}-${theme}-${width}.json`), JSON.stringify({ metrics, findings }, null, 2))
    assert.deepEqual(findings, [], `${locale}/${theme}/${width} visual findings`)
    if (locale === 'zh-CN') await page.screenshot({ path: resolve(output, `r114-${theme}-${width}.png`), format: 'png' })
    await run(() => document.querySelector('.inventory-spec button[type="submit"]').click())
    assert.equal(await page.eval(() => window.inventorySpec.pending.length), 2)
    await run(() => window.inventorySpec.pending[1].resolve({ success: true, updated: 1 }))
    assert.equal(await page.eval(() => document.querySelector('.inventory-spec')), null)
    await open()
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    assert.equal(await page.eval(() => document.querySelector('.inventory-spec')), null)
  }
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log('PASS 18 locale/width/theme actual inputs, error retention, retry, long names, no overflow, 44px controls, Tab/Escape and taste measurements')
  }
} finally { if (browser) await browser.close(); await server.close() }
