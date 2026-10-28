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
const output = resolve(root, 'logs/badge-image-browser'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const requests = []
const fixtureImages = { name: 'fixture-images', configureServer(server) { server.middlewares.use((req, res, next) => {
  if (!req.url.startsWith('/badges/') && !req.url.startsWith('/fixtures/')) return next()
  requests.push(req.url)
  if (req.url.endsWith('/ignition.svg') || req.url.startsWith('/fixtures/valid-')) {
    res.setHeader('Content-Type', 'image/svg+xml')
    res.end('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="black"/><circle cx="48" cy="48" r="30" fill="white"/></svg>')
  } else { res.statusCode = 404; res.end('missing fixture image') }
}) } }
const server = await createServer({ configFile: false, root: root + '/scripts/fixtures/badge-image', plugins: [vue(), fixtureImages],
  resolve: { alias: [ { find: /^@\/api$/, replacement: root + '/scripts/fixtures/badge-image/api.js' },
    { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) })),
  ], dedupe: ['vue', 'pinia'] }, server: { host: '127.0.0.1', port: 19646, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch()
  const page = await browser.newPage()
  await page.goto('http://127.0.0.1:19646', { settleMs: 700 })
  const run = async (fn, arg) => { const value = await page.eval(fn, arg); await sleep(30); return value }
  const checkImage = async (url, message) => {
    for (let i = 0; i < 80; i++) {
      if (await page.eval(url => { const image = document.querySelector('img'); return image?.getAttribute('src') === url && image.complete && image.naturalWidth > 0 }, url)) return
      await sleep(50)
    }
    assert.fail(message + ': ' + await page.eval(() => document.querySelector('img')?.outerHTML))
  }
  const catalog = { id: 'late-catalog', assetUrlLight: '/fixtures/valid-light.svg', assetUrlDark: '/fixtures/valid-dark.svg' }
  await checkImage('/badges/light/ignition.svg', 'missing conventional filename must fall back')
  await run(catalog => window.badgeHarness.pending[0].resolve({ badges: [catalog], series: [] }), catalog)
  await checkImage(catalog.assetUrlLight, 'delayed catalog URL must replace the fallback')
  await run(() => window.badgeHarness.theme.setTheme('dark'))
  await checkImage(catalog.assetUrlDark, 'dark catalog URL')
  await run(() => { window.badgeHarness.oldImage = document.querySelector('img'); window.badgeHarness.badges.badges[0].assetUrlDark = '/fixtures/valid-updated.svg' })
  await checkImage('/fixtures/valid-updated.svg', 'catalog refresh must update the image')
  await run(() => window.badgeHarness.oldImage.dispatchEvent(new Event('error')))
  await checkImage('/fixtures/valid-updated.svg', 'obsolete image errors cannot mark the new URL failed')
  await run(() => { window.badgeHarness.badges.badges[0].assetUrlDark = '/fixtures/missing.svg' })
  await checkImage('/badges/dark/ignition.svg', 'failed catalog URL must fall back once')
  const oldMissingCount = requests.filter(url => url === '/fixtures/missing.svg').length
  await run(() => { window.badgeHarness.badges.badges = window.badgeHarness.badges.badges.map(badge => ({ ...badge, name: 'Metadata refresh' })) })
  assert.equal(requests.filter(url => url === '/fixtures/missing.svg').length, oldMissingCount, 'same failing URL must not spin on metadata refresh')
  await run(() => { window.badgeHarness.badges.badges[0].assetUrlDark = '/fixtures/valid-repaired.svg' })
  await checkImage('/fixtures/valid-repaired.svg', 'changed URL must recover without theme or ID change')
  await run(() => {
    window.badgeHarness.badges.badges.push({ id: 'second', assetUrl: '/fixtures/valid-shared.svg' })
    window.badgeHarness.badgeId.value = 'second'
  })
  await checkImage('/fixtures/valid-shared.svg', 'badge ID changes retain general URL fallback')
  console.log('BadgeImage passed actual Vue/Pinia + local HTTP image loads: delayed catalog, theme/ID/URL changes, stale error and stable fallback; no live catalog mutation.')
} finally { if (browser) await browser.close(); await server.close() }
