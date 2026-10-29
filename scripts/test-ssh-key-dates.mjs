import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { Browser, sleep } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'
const root = fileURLToPath(new URL('..', import.meta.url)).replaceAll('\\', '/'), require = createRequire(new URL('../client/package.json', import.meta.url))
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href), { default: vue } = await import(pathToFileURL(require.resolve('@vitejs/plugin-vue')).href)
const output = resolve(root, 'logs/ssh-key-dates'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js'); tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/ssh-keys/*.js']
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/ssh-keys', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/ssh-keys/api.js' }, { find: '@', replacement: root + '/client/src' }, ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } }, server: { host: '127.0.0.1', port: 19732, strictPort: true, fs: { allow: [root] } },
})
const first = '2026-10-28T01:02:03.000Z', second = '2026-10-29T04:05:06.000Z'
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19732', { settleMs: 400 })
  const deadline = Date.now() + 15000
  while (!await page.eval(() => !!window.sshHarness?.view())) { if (Date.now() > deadline) throw Error('SSH fixture did not mount: ' + page.consoleErrors.join('\n')); await sleep(70) }
  await page.eval(({ first, second }) => window.sshHarness.pending.findLast(x => x.kind === 'list').resolve({ keys: [
    { id: 1, name: 'Original laptop', fingerprint: 'fixture-public-fingerprint-1', publicKeyPreview: 'fixture-public-preview', createdAt: first },
    { id: 2, name: 'Replacement laptop', fingerprint: 'fixture-public-fingerprint-2', publicKeyPreview: 'fixture-public-preview', createdAt: second },
  ] }), { first, second }); await sleep(80)
  assert.equal(await page.eval(({ first, second }) => { const text = document.querySelector('#app').textContent; return text.includes(first) && text.includes(second) }, { first, second }), true, 'actual API camelCase dates must both render')
  for (const [locale, width] of [['zh-CN', 1440], ['zh-TW', 768], ['en', 390]]) {
    await page.setViewport({ width, height: 1000, mobile: width === 390 }); await page.eval(locale => { const h = window.sshHarness; h.setLocale(locale); h.theme.setTheme(innerWidth === 390 ? 'dark' : 'light') }, locale); await sleep(60)
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: resolve(output, locale + '-' + width + '.png'), format: 'png' })
  }
  assert.equal(await page.eval(() => window.sshHarness.pending.every(x => x.kind === 'list')), true, 'date display never creates, generates or deletes keys')
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log('PASS actual SSHKeysSection displays both server createdAt fields, three-language three-width layouts without key mutations; controlled list API without real keys')
} finally { if (browser) await browser.close(); await server.close() }
