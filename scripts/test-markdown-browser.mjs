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
const output = resolve(root, 'logs/markdown-browser'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
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
  const markdown = '# Markdown rendering\n\n| **Name** | Value |\n| --- | --- |\n| A | [link](https://example.test) |\n| B | `code` |\n\n| Header only |\n| --- |\n\n| Empty cell | Value |\n| --- | --- |\n| | Content |'
  await run(body => window.termsHarness.pending.at(-1).resolve(new Response(body)), markdown)
  const table = await page.eval(() => {
    const tables = [...document.querySelectorAll('.markdown-body table')]
    return { count: tables.length, header: tables[0]?.querySelector('th strong')?.textContent,
      cells: tables[0]?.querySelectorAll('td').length, link: tables[0]?.querySelector('td a')?.textContent.trim(),
      code: tables[0]?.querySelector('td code')?.textContent, headerOnly: tables[1]?.querySelectorAll('tbody tr').length,
      emptyCell: tables[2]?.querySelector('td')?.textContent }
  })
  assert.deepEqual(table, { count: 3, header: 'Name', cells: 4, link: 'link', code: 'code', headerOnly: 0, emptyCell: '' })
  for (const width of [1440, 390]) {
    await run(width => window.termsHarness.theme.setTheme(width === 390 ? 'dark' : 'light'), width)
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width === 390 })
    await page.screenshot({ path: resolve(output, `table-${width}.png`) })
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
  }
  await run(() => window.termsHarness.setLocale('en'))
  const nested = '[**bold** and *italic*](https://example.test)\n\n> *quote*\n>\n> - nested quote\n>   - **deep quote**\n\n- [x] **done**\n- [ ] *todo*\n- outer\n  - *inner*\n    - `deep`\n\n1. first\n2. **second**\n\n```txt\n<literal> **not bold**\n```'
  await run(body => window.termsHarness.pending.at(-1).resolve(new Response(body)), nested)
  const tokens = await page.eval(() => {
    const el = document.querySelector('.markdown-body')
    return { linkBold: el.querySelector('a strong')?.textContent, linkItalic: el.querySelector('a em')?.textContent,
      quote: el.querySelector('blockquote em')?.textContent, deepQuote: el.querySelector('blockquote li li strong')?.textContent,
      inner: el.querySelector(':scope > ul li li em')?.textContent, deep: el.querySelector(':scope > ul li li li code')?.textContent,
      done: el.querySelector(':scope > ul > li strong')?.textContent,
      taskIcons: el.querySelectorAll(':scope > ul > li > span > svg').length,
      ordered: el.querySelector('ol li strong')?.textContent, literal: el.querySelector('pre code')?.textContent,
      rawSyntax: /\*\*(?:bold|done|second)\*\*|\*(?:quote|inner)\*/.test(el.textContent) }
  })
  assert.deepEqual(tokens, { linkBold: 'bold', linkItalic: 'italic', quote: 'quote', deepQuote: 'deep quote', inner: 'inner',
    deep: 'deep', done: 'done', taskIcons: 2, ordered: 'second', literal: '<literal> **not bold**', rawSyntax: false })
  assert.equal(await page.eval(() => {
    const path = document.querySelector('.markdown-body > ul > li > span > svg path')
    return !!path?.getAttribute('d') && path.getBBox().width > 0 && path.getBBox().height > 0
  }), true, 'completed task checkmark must retain visible SVG geometry after sanitization')
  for (const width of [1440, 390]) {
    await run(width => window.termsHarness.theme.setTheme(width === 390 ? 'dark' : 'light'), width)
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width === 390 })
    await page.screenshot({ path: resolve(output, `nested-${width}.png`) })
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
  }
  console.log('PASS Markdown actual browser: table edge cases, formatted links, nested quotes/lists, task and ordered lists, literal code and desktop/mobile rendering; controlled content.')
} finally { if (browser) await browser.close(); await server.close() }
