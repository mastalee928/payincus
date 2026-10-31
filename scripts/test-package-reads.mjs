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
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/package-reads/*.js']
const output = resolve(root, 'logs/package-reads'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const server = await createServer({ configFile: false, cacheDir: output + '/vite-cache', root: root + '/scripts/fixtures/package-reads', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/package-reads/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19764, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  const run = async (fn, arg) => { const value = await page.eval(fn, arg); await sleep(60); return value }
  const last = kind => page.eval(kind => window.packageReads?.pending.findLastIndex(r => r.kind === kind) ?? -1, kind)
  const accept = (i, value) => run(({ i, value }) => packageReads.pending[i].resolve(value), { i, value })
  const row = { id: 11, name: 'Review package', description: '', isOwn: true, active: 1, host_ids: [] }
  const fresh = async () => {
    await page.goto('http://127.0.0.1:19764', { settleMs: 500 }); const deadline = Date.now() + 15000
    while (await last('list') < 0) { if (Date.now() > deadline) throw Error('No package request'); await sleep(100) }
    await page.eval(() => { packageReads.view() })
  }
  for (const change of ['account', 'cache', 'route', 'supersede']) for (const fail of [false, true]) {
    await fresh(); const old = await last('list')
    await run(change => { const h = packageReads; if (change === 'account') h.session(2)
      if (change === 'cache') h.active.value = false
      if (change === 'route') void h.router.push('/other')
      if (change === 'supersede') void h.view().loadPackages()
    }, change)
    const snapshot = () => page.eval(() => JSON.stringify({ rows: packageReads.view().packages, loading: packageReads.view().loading, toasts: packageReads.toast.toasts.value }))
    const before = await snapshot()
    if (fail) await run(i => packageReads.pending[i].reject(Error('Old package failure')), old)
    else await accept(old, { packages: [row] })
    assert.equal(await snapshot(), before, `${change}: obsolete package result`)
  }
  await fresh(); await accept(await last('list'), { packages: [row] })
  await run(() => { packageReads.active.value = false })
  await run(() => { packageReads.active.value = true })
  assert.equal(await page.eval(() => packageReads.view().packages.length), 0)
  await accept(await last('list'), { packages: [row] })
  await run(() => { void packageReads.view().loadPackages() })
  await run(i => packageReads.pending[i].reject(Error('Current package failure')), await last('list'))
  assert.ok(await page.eval(() => packageReads.view().packagesError))
  await run(() => document.querySelector('[data-package-read-retry]').click())
  await accept(await last('list'), { packages: [row] })
  assert.equal(await page.eval(() => packageReads.view().packagesError), '')
  if (process.argv.includes('--with-deletion')) {
  for (const fail of [false, true]) {
    await fresh(); await accept(await last('list'), { packages: [row] })
    await run(() => { const v = packageReads.view(); void v.deletePackage(v.packages[0]); void v.deletePackage(v.packages[0]) })
    assert.equal(await page.eval(() => packageReads.pending.filter(r => r.kind === 'delete').length), 1, 'one delete while busy')
    const old = await last('delete'); await run(() => packageReads.session(2))
    const before = await page.eval(() => JSON.stringify(packageReads.toast.toasts.value))
    if (fail) await run(i => packageReads.pending[i].reject(Error('Old delete failure')), old)
    else await accept(old, { message: 'Package deleted' })
    assert.equal(await page.eval(() => JSON.stringify(packageReads.toast.toasts.value)), before)
  }
  await fresh(); await accept(await last('list'), { packages: [row] })
  await run(() => { void packageReads.view().deletePackage(packageReads.view().packages[0]) })
  await accept(await last('delete'), { message: 'Package deleted' })
  assert.equal(await page.eval(() => packageReads.view().packages.length), 0)
  }
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log('PASS package stale reads/cache reload' + (process.argv.includes('--with-deletion') ? ' and deletion receipts' : ''))
} finally { if (browser) await browser.close(); await server.close() }
