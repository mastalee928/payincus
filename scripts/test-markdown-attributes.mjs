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
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/terms-modal/*.js']
const output = resolve(root, 'logs/markdown-attributes-browser'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const server = await createServer({ configFile: false, root: root + '/scripts/fixtures/terms-modal', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19671, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19671/', { settleMs: 1200 })
  const deadline = Date.now() + 15000
  while (!await page.eval(() => !!window.termsHarness?.pending.length)) {
    if (Date.now() >= deadline) throw Error('Terms modal did not load within 15 seconds')
    await sleep(100)
  }
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(60); return result }
  const body = [
    '# Quoted attributes',
    '[**Quoted link**](https://example.test/path1 \'title "quote" & <value>\')',
    '![alt](missing-fixture.png \'caption "quoted" & <value>\')',
    '[relative](guide1.md)',
    '<img src="missing-fixture.png" onerror="window.markdownAttackCount++">',
    '<a href="jav&#x61;script:window.markdownAttackCount++" target="_blank" onclick="window.markdownAttackCount++">unsafe link</a>',
    '<a href="custom1:payload">unknown protocol</a>',
    '<img src="data:image/svg+xml,x"><img src="vbscript:payload">',
    '<svg onload="window.markdownAttackCount++"><script>window.markdownAttackCount++</script></svg>',
    '<iframe srcdoc="<script>parent.markdownAttackCount++</script>"></iframe>',
    '<object data="javascript:window.markdownAttackCount++"></object>',
    '?{success}[Platform notice]',
  ].join('\n\n')
  await run(body => {
    window.markdownAttackCount = 0
    window.termsHarness.pending.at(-1).resolve(new Response(body))
  }, body)
  const result = await page.eval(() => {
    const el = document.querySelector('.markdown-body'), link = el.querySelector('a'), image = el.querySelector('figure img')
    for (const target of el.querySelectorAll('img, svg, a')) {
      target.dispatchEvent(new Event('error')); target.dispatchEvent(new Event('load'))
    }
    const unsafeLink = [...el.querySelectorAll('a')].find(a => a.textContent === 'unsafe link')
    // The sanitized unsafe link has no destination; dispatching click tests the removed handler.
    if (!unsafeLink.hasAttribute('href')) unsafeLink.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return { linkTitle: link.getAttribute('title'), linkBold: link.querySelector('strong')?.textContent,
      linkTarget: link.getAttribute('target'), linkRel: link.getAttribute('rel'),
      imageTitle: image.getAttribute('title'), imageAlt: image.getAttribute('alt'), caption: el.querySelector('figcaption')?.textContent,
      relative: [...el.querySelectorAll('a')].find(a => a.textContent === 'relative')?.getAttribute('href'),
      unsafeHref: unsafeLink.getAttribute('href'), unsafeRel: unsafeLink.getAttribute('rel'),
      forbidden: el.querySelectorAll('script,iframe,object,[onerror],[onload],[onclick]').length,
      unsafeUrls: [...el.querySelectorAll('[href],[src]')].map(node => node.getAttribute('href') || node.getAttribute('src')).filter(value => /^(?:javascript|vbscript|data|custom1):/i.test(value)),
      attackCount: window.markdownAttackCount,
      noticeGeometry: el.querySelector('.md-alert path')?.getBBox().width > 0 }
  })
  assert.deepEqual(result, { linkTitle: 'title "quote" & <value>', linkBold: 'Quoted link', linkTarget: '_blank', linkRel: 'noopener noreferrer',
    imageTitle: 'caption "quoted" & <value>', imageAlt: 'alt', caption: 'caption "quoted" & <value>', relative: 'guide1.md',
    unsafeHref: null, unsafeRel: 'noopener noreferrer', forbidden: 0, unsafeUrls: [], attackCount: 0, noticeGeometry: true })
  await sleep(300)
  assert.equal(await page.eval(() => window.markdownAttackCount), 0)
  for (const width of [1440, 390]) {
    await run(width => window.termsHarness.theme.setTheme(width === 390 ? 'dark' : 'light'), width)
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width === 390 })
    await page.screenshot({ path: resolve(output, `attributes-${width}.png`) })
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
  }
  console.log('PASS Markdown browser attributes: literal quotes/ampersands/angle brackets, formatted link labels, safe external targets and relative URLs, forbidden tags/events/protocols removed, active event probe unchanged and notice icon geometry. Local controlled content only.')
} finally { if (browser) await browser.close(); await server.close() }
