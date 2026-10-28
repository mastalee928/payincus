import assert from 'node:assert/strict'
import { readFileSync, readdirSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { documentBadgeStyles, normalizeBadgeMotion } from './lib/badge-styles.mjs'

const shared = '.node { animation: pulse 1s infinite } @keyframes pulse { to { opacity: .5 } }'
const local = '.ring { stroke: red }'
const html = `<html><head><style>${shared}</style></head><body><script type="text/babel">const Badge = () => <svg><style>{\`${local}\`}</style><circle r="5" /></svg></script><style media="all">.other { opacity: 1 }</style></body></html>`
assert.equal(documentBadgeStyles(html), `${shared}\n.other { opacity: 1 }`)
assert.equal(documentBadgeStyles('<script>const css = "<style>invalid</style>"</script>'), '')
const motionFixture = '<svg><style>.t{animation:zt1a .5s infinite alternate transform-origin:120px 120px}</style><g style="animation:art 15s linear infinite"/></svg>'
const normalized = normalizeBadgeMotion(motionFixture)
assert.ok(normalized.includes('alternate;transform-origin:'))
assert.ok(normalized.includes('@keyframes art'))
assert.equal(normalizeBadgeMotion(normalized), normalized)
const root = fileURLToPath(new URL('..', import.meta.url))
const logs = path.join(root, 'logs'); mkdirSync(logs, { recursive: true })
// The generator rebuilds its output directory. Run only in a new isolated log folder.
const fixture = mkdtempSync(path.join(logs, 'badge-generator-'))
assert.ok(path.resolve(fixture).startsWith(path.resolve(logs) + path.sep))
mkdirSync(path.join(fixture, 'server/src/config'), { recursive: true })
for (const [index, name] of ['aaaa.html', 'bbbb.html'].entries()) {
  writeFileSync(path.join(fixture, name), `<html><style>${shared}</style><script type="text/babel">
const SvgFilters = () => <svg />;
const Badge = () => <svg viewBox="0 0 240 240"><style>{\`${local}\`}</style><circle r="5" className="ring"/></svg>;
const seriesData = [{title:'TEST Example',desc:'Fixture',icons:[{id:'badge-${index}',label:'Example',component:Badge}]}];
const App = () => null;
</script></html>`)
}
const generated = spawnSync(process.execPath, [path.join(root, 'scripts/generate-badges-from-html.mjs')], { cwd: fixture, encoding: 'utf8' })
assert.equal(generated.status, 0, generated.stderr)
for (const theme of ['dark', 'light']) for (const index of [0, 1]) {
  const svg = readFileSync(path.join(fixture, `client/public/badges/${theme}/badge-${index}.svg`), 'utf8')
  assert.equal([...svg.matchAll(/<style>([\s\S]*?)<\/style>/g)].length, 3)
  assert.ok(svg.includes(`<style>${shared}</style>`))
  assert.ok(svg.includes(`<style>${local}</style>`))
  assert.ok(!svg.includes('{`'), 'real JSX generator must render local styles only once')
}
let count = 0
for (const theme of ['dark', 'light']) {
  const dir = new URL(`../client/public/badges/${theme}/`, import.meta.url)
  for (const file of readdirSync(dir).filter(file => file.endsWith('.svg'))) {
    const svg = readFileSync(new URL(file, dir), 'utf8')
    for (const style of svg.matchAll(/<style>([\s\S]*?)<\/style>/g)) {
      assert.doesNotMatch(style[1], /\{`|`\}/, `${theme}/${file} contains unrendered JSX CSS`)
      assert.doesNotMatch(style[1], /alternate\s+transform-origin:/, `${theme}/${file} has invalid animation shorthand`)
    }
    if (/animation:\s*art\b/.test(svg)) assert.match(svg, /@keyframes\s+art\b/)
    assert.ok(svg.includes('@media(prefers-reduced-motion:reduce)'))
    count++
  }
}
assert.equal(count, 178, 'check both themes of the full shipped badge catalog')
console.log(`Badge styles passed: document/JSX separation and all ${count} shipped SVGs free of unrendered JSX.`)
