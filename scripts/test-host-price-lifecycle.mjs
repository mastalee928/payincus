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
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/host-price-lifecycle/*.js']
const output = resolve(root, 'logs/host-price-lifecycle-lifecycle'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const server = await createServer({ configFile: false, root: root + '/scripts/fixtures/host-price-lifecycle', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/host-price-lifecycle/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19683, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(90); return result }
  for (const role of ['user', 'admin']) for (const locale of ['zh-CN', 'zh-TW', 'en']) for (const width of [390, 768, 1440]) {
    await page.goto('http://127.0.0.1:19683', { settleMs: 800 })
    await page.setViewport({ width, height: 900, mobile: width < 500 })
    await run(({ role, locale }) => { const h = window.hostPrice; h.auth.user.role = role; h.setLocale(locale) }, { role, locale })
    await run(() => { const h = window.hostPrice; h.pending.filter(p => p.kind === 'list').forEach(p => p.resolve({
      instances: [{ id: 1, hostId: 1, name: 'seoul-amd-test', status: 'running', image: 'debian/13', cpu: 100, memory: 512,
        disk: 10240, packagePlanId: 1, billingPrice: 10 }], total: 1, totalPages: 1 })) })
    const state = await page.eval(() => { const h = window.hostPrice, view = h.view(); return { editor: typeof view.openPriceModal,
      mutation: typeof view.updateRenewalPrice, dialog: !!document.querySelector('[aria-label*=价格], [aria-label*="price" i]'),
      text: document.body.innerText, requests: h.pending.filter(p => p.kind === 'price').length,
      overflow: document.documentElement.scrollWidth > innerWidth } })
    assert.equal(state.editor, 'undefined'); assert.equal(state.mutation, 'undefined')
    assert.equal(state.dialog, false); assert.equal(state.requests, 0); assert.equal(state.overflow, false)
    assert.doesNotMatch(state.text, /修改续费价格|修改續費價格|Edit price|Edit renewal price/i)
    await page.screenshot({ path: resolve(output, `${role}-${locale}-${width}.png`), format: 'png' })
  }
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log('PASS customer/host-owner and admin host lists: all three locales/widths have no legacy price controls, editor functions or mutation requests')
} finally { if (browser) await browser.close(); await server.close() }
