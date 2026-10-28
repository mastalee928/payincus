import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFileSync, readdirSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { Browser } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'
const root = fileURLToPath(new URL('..', import.meta.url))
const output = resolve(root, 'logs/badge-motion-browser'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const files = ['dark', 'light'].flatMap(theme => readdirSync(resolve(root, `client/public/badges/${theme}`)).filter(f => f.endsWith('.svg')).map(f => `${theme}/${f}`))
const server = createServer((req, res) => {
  const file = req.url.slice(1)
  if (files.includes(file)) {
    res.setHeader('Content-Type', 'image/svg+xml'); res.end(readFileSync(resolve(root, 'client/public/badges', file)))
  } else { res.setHeader('Content-Type', 'text/html'); res.end('<html><body></body></html>') }
})
await new Promise(resolve => server.listen(19648, '127.0.0.1', resolve))
let browser
try {
  browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: false })
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
  await page.goto('http://127.0.0.1:19648')
  const frames = await page.eval(async files => {
    const results = []
    for (const file of files) {
      const frame = document.createElement('iframe'); frame.src = '/' + file; frame.width = frame.height = 240
      const loaded = new Promise((resolve, reject) => { frame.onload = resolve; frame.onerror = reject }); document.body.append(frame); await loaded
      const doc = frame.contentDocument, view = frame.contentWindow
      if (doc.documentElement.localName !== 'svg') throw new Error(file + ' did not load an SVG document')
      doc.documentElement.getBoundingClientRect()
      const animations = doc.getAnimations(), names = animations.map(animation => animation.animationName)
      const unknown = [...doc.querySelectorAll('*')].flatMap(element => view.getComputedStyle(element).animationName.split(',').map(s => s.trim()))
        .filter(name => name !== 'none' && !names.includes(name))
      const targetName = /(?:tiger|goat|rooster)\.svg$/.test(file) ? ({ tiger: 'zt1a', goat: 'zg1a', rooster: 'zro1a' })[file.split('/')[1].split('.')[0]]
        : /(?:aquarius|cancer|gemini|libra|pisces|scorpio)\.svg$/.test(file) ? 'art' : null
      let target = null
      if (targetName) {
        const animation = animations.find(animation => animation.animationName === targetName)
        if (animation) {
          animation.pause(); animation.currentTime = 0
          const start = view.getComputedStyle(animation.effect.target).transform
          animation.currentTime = Number(animation.effect.getTiming().duration) / 4
          const end = view.getComputedStyle(animation.effect.target).transform
          target = { name: targetName, changed: start !== end }
        }
      }
      results.push({ file, animations: animations.length, unknown: [...new Set(unknown)], targetName, target })
      frame.remove()
    }
    return results
  }, files)
  assert.deepEqual(frames.filter(frame => frame.unknown.length), [], 'every declared animation must have a parsed keyframe')
  const repaired = frames.filter(frame => frame.targetName)
  assert.equal(repaired.length, 18)
  assert.ok(repaired.every(frame => frame.target?.changed), JSON.stringify(repaired))
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  const reduced = await page.eval(async files => {
    const failures = []
    for (const file of files) {
      const frame = document.createElement('iframe'); frame.src = '/' + file
      const loaded = new Promise(resolve => { frame.onload = resolve }); document.body.append(frame); await loaded
      const doc = frame.contentDocument, view = frame.contentWindow
      doc.documentElement.getBoundingClientRect()
      if (doc.documentElement.localName !== 'svg' || doc.getAnimations().length
        || [...doc.querySelectorAll('*')].some(element => view.getComputedStyle(element).animationName !== 'none')) failures.push(file)
      frame.remove()
    }
    return failures
  }, files)
  assert.deepEqual(reduced, [], 'reduced motion must stop every badge animation')
  console.log(`Badge motion: all ${files.length} SVGs parsed with existing keyframes; 18 repaired transforms change at sampled timeline positions; reduced motion stops all ${files.length}.`)
} finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)) }
