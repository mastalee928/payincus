import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { Browser, sleep } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'
const root = fileURLToPath(new URL('..', import.meta.url)).replaceAll('\\', '/'), require = createRequire(new URL('../client/package.json', import.meta.url))
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href), { default: vue } = await import(pathToFileURL(require.resolve('@vitejs/plugin-vue')).href)
const output = resolve(root, 'logs/snapshot-policy-ui'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js'); tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/snapshot-policy/*.js']
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/snapshot-policy', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/snapshot-policy/api.js' }, { find: '@', replacement: root + '/client/src' }, ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } }, server: { host: '127.0.0.1', port: 19727, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19727', { settleMs: 1400 })
  const deadline = Date.now() + 15000
  while (!await page.eval(() => !!window.snapshotHarness?.view())) { if (Date.now() > deadline) throw Error('Snapshot fixture did not mount: ' + page.consoleErrors.join('\n')); await sleep(100) }
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(80); return result }
  const settle = (enabled, interval) => run(({ enabled, interval }) => {
    const h = window.snapshotHarness
    for (const item of h.pending) if (item.kind === 'snapshots') item.resolve([])
    h.pending.findLast(x => x.kind === 'policy').resolve({ enabled, interval_minutes: interval, last_run_at: null, next_run_at: null, operation: null })
  }, { enabled, interval })
  for (const enabled of [true, false]) for (const interval of [10, 60, 360, 1440]) {
    await run(() => { window.snapshotHarness.view().showPolicyModal = false; void window.snapshotHarness.view().loadPolicy() })
    await settle(enabled, interval)
    assert.deepEqual(await page.eval(() => ({ ...window.snapshotHarness.view().policyForm })), { enabled, intervalMinutes: interval }, 'actual boolean read preserves policy state/interval')
    await run(() => [...document.querySelectorAll('#app button')].find(x => x.getAttribute('aria-label') === window.snapshotHarness.t('snapshot.autoSettings')).click())
    assert.equal(await page.eval(() => document.querySelector('.modal-content input[type="checkbox"]').checked), enabled, 'actual editor checkbox follows boolean state')
    await run(() => [...document.querySelectorAll('.modal-footer button')].find(x => x.textContent.trim() === window.snapshotHarness.t('snapshot.policyModal.save')).click())
    assert.deepEqual(await page.eval(() => { const x = window.snapshotHarness.pending.findLast(x => x.kind === 'update'); return { id: x.id, data: x.data } }), { id: 1, data: { enabled, intervalMinutes: interval } }, 'unchanged save keeps enabled boolean and exact interval')
    await run(() => window.snapshotHarness.pending.findLast(x => x.kind === 'update').resolve({ message: 'Auto snapshot policy updated' })); await settle(enabled, interval)
    assert.equal(await page.eval(() => window.snapshotHarness.view().showPolicyModal), false)
  }
  for (const [locale, width, enabled] of [['zh-CN', 1440, true], ['zh-TW', 768, false], ['en', 390, true]]) {
    await run(({ locale, enabled }) => { const h = window.snapshotHarness; h.setLocale(locale); h.theme.setTheme(innerWidth === 390 ? 'dark' : 'light'); h.view().showPolicyModal = false; void h.view().loadPolicy() }, { locale, enabled })
    await settle(enabled, 60); await run(() => window.snapshotHarness.view().showPolicyModal = true)
    await page.setViewport({ width, height: 1000, mobile: width === 390 }); await run(width => window.snapshotHarness.theme.setTheme(width === 390 ? 'dark' : 'light'), width)
    assert.equal(await page.eval(() => document.querySelector('.modal-content input[type="checkbox"]').checked), enabled)
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: resolve(output, locale + '-' + width + '.png'), format: 'png' })
  }
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log('PASS actual SnapshotManager Boolean true/false reads, actual editor checkbox and unchanged save payload at all four server intervals; three-language screenshots; controlled API without snapshots or policy writes')
} finally { if (browser) await browser.close(); await server.close() }
