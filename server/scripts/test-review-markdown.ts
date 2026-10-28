import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { JSDOM } = require('jsdom')
const dom = new JSDOM('<!doctype html>')
Object.assign(globalThis, { window: dom.window, document: dom.window.document, Element: dom.window.Element })
const { parseMarkdown } = await import('../../client/src/utils/markdown.js')
function parsed(markdown: string): Document {
  return new JSDOM(parseMarkdown(markdown)).window.document
}
const table = parsed('| **Name** | Value |\n| --- | --- |\n| A | [link](https://example.test) |')
assert.equal(table.querySelector('th strong')?.textContent, 'Name')
assert.equal(table.querySelectorAll('td').length, 2)
assert.equal(table.querySelector('td a')?.textContent?.trim(), 'link')
const inline = parsed('[**bold**](https://example.test "quoted & title")\n\n> *quote*\n>\n> - nested\n\n- [x] **done**\n- outer\n  - *inner*')
assert.equal(inline.querySelector('a strong')?.textContent, 'bold')
assert.equal(inline.querySelector('blockquote em')?.textContent, 'quote')
assert.ok(inline.querySelector('li li em'))
assert.equal(inline.querySelector('li strong')?.textContent, 'done')
assert.ok(inline.querySelector('li svg path')?.getAttribute('d'), 'completed task icon must retain its path data')
assert.equal(parsed('[relative](guide1.md)').querySelector('a')?.getAttribute('href'), 'guide1.md')
for (const href of ['javascript:alert(1)', 'vbscript:msgbox(1)', 'data:text/html,x', 'custom1:payload']) {
  assert.equal(parsed(`<a href="${href}">bad</a>`).querySelector('a')?.getAttribute('href'), null)
}
const image = parsed('![alt](https://example.test/image.png \'title "quote" & value\')')
assert.equal(image.querySelector('img')?.getAttribute('title'), 'title "quote" & value')
assert.equal(image.querySelector('figcaption')?.textContent, 'title "quote" & value')
const attack = parsed('<img src=x onerror=alert(1)><a href="jav&#x61;script:alert(1)" target="_blank" onclick=alert(1)>bad</a><img src="data:image/svg+xml,x"><svg onload=alert(1)><script>alert(1)</script></svg>')
assert.equal(attack.querySelector('[onerror],[onclick],[onload],script,iframe,object'), null)
for (const element of attack.querySelectorAll('[href],[src]')) {
  assert.doesNotMatch(element.getAttribute('href') || element.getAttribute('src') || '', /^(?:javascript|data|vbscript):/i)
}
assert.equal(attack.querySelector('a')?.getAttribute('rel'), 'noopener noreferrer')
assert.ok(parsed('?{success}[Hello]').querySelector('svg path'), 'platform alert icons survive the strict tag list')
console.log('review Markdown runtime: real tokens, table, nested/task list, quoted attributes and DOM sanitization passed')
dom.window.close()
