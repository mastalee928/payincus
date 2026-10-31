import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { Browser, sleep } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'
import { probe } from '../.agents/skills/design-taste-frontend/scripts/lib/probe.mjs'
import { judge, APP_SKIP } from '../.agents/skills/design-taste-frontend/scripts/lib/rules.mjs'
const root = fileURLToPath(new URL('..', import.meta.url)).replaceAll('\\', '/')
const require = createRequire(new URL('../client/package.json', import.meta.url))
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href)
const { default: vue } = await import(pathToFileURL(require.resolve('@vitejs/plugin-vue')).href)
const output = resolve(root, 'logs/host-protocol'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js')
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/host-protocol/*.js']
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/host-protocol', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api(?:\/admin)?$/, replacement: root + '/scripts/fixtures/host-protocol/api.js' }, { find: '@', replacement: root + '/client/src' }, ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19774, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  const run = async (fn, arg) => { const value = await page.eval(fn, arg); await sleep(50); return value }
  const fresh = async () => {
    await page.goto('http://127.0.0.1:19774', { settleMs: 150 })
    const deadline = Date.now() + 15000
    while (!await page.eval(() => window.protocolTest?.view()?.gateway?.ready && document.querySelectorAll('article input[type="checkbox"]').length === 3)) {
      if (Date.now() > deadline) throw Error('Protocol fixture did not mount: ' + page.consoleErrors.join('\n'))
      await sleep(60)
    }
  }
  const openBatch = async () => {
    await run(() => document.querySelectorAll('article input[type="checkbox"]')[0].click())
    await run(() => document.querySelectorAll('article input[type="checkbox"]')[1].click())
    await run(() => document.querySelector('[data-batch-protocol]').click())
    assert.equal(await page.eval(() => document.querySelector('#batch-port-protocol').value), 'tcp')
  }
  const choose = async value => run(value => { const el = document.querySelector('#batch-port-protocol'); el.value = value; el.dispatchEvent(new Event('change', { bubbles: true })) }, value)
  const save = async () => run(() => document.querySelector('.protocol-batch button[type="submit"]').click())
  const reply = async (index, failed = false) => run(({ index, failed }) => {
    const p = window.protocolTest.pending[index]
    p.resolve({ results: p.hostIds.map((id, i) => failed && i === 1 ? { id, success: false, code: 'HOST_AGENT_UPGRADE_REQUIRED' } :
      { id, success: true, protocol: { requested: p.protocol, applied: 'tcp', status: 'pending' } }) })
  }, { index, failed })
  for (const createMode of ['single', 'batch']) {
    await fresh()
    await run(createMode => window.protocolTest.view().openCreate(createMode), createMode)
    assert.equal(await page.eval(() => document.querySelector('#onboarding-port-protocol').value), 'tcp')
    await run(createMode => {
      const v = window.protocolTest.view(); v.hostAddress = '192.0.2.11'; v.batchName = 'protocol-fixture'; v.accountLabel = 'fixture'; v.credential = 'fixture-only'
      if (createMode === 'batch') v.importText = 'name,publicIp\nfixture-a,192.0.2.11\nfixture-b,192.0.2.12'
      const el = document.querySelector('#onboarding-port-protocol'); el.value = 'tcp_udp'; el.dispatchEvent(new Event('change', { bubbles: true }))
    }, createMode)
    await run(() => document.querySelector('.onboarding-create-dialog button[type="submit"]').click())
    assert.equal(await page.eval(() => window.protocolTest.creates.length), 1, `${createMode} form submission`)
    assert.equal(await page.eval(() => window.protocolTest.creates[0].defaults.portProtocol), 'tcp_udp')
    assert.equal(await page.eval(() => window.protocolTest.creates[0].nodes.length), createMode === 'single' ? 1 : 2)
    await run(createMode => window.protocolTest.view().openCreate(createMode), createMode)
    assert.equal(await page.eval(() => document.querySelector('#onboarding-port-protocol').value), 'tcp')
  }
  console.log('PASS onboarding single/batch forms prefer TCP, explicit TCP+UDP reaches create payload, reopen resets the preference')
  await fresh(); await openBatch()
  assert.equal(await page.eval(() => window.protocolTest.pending.length), 0, 'opening does not change existing hosts')
  await choose('tcp_udp'); await save(); await save()
  assert.deepEqual(await page.eval(() => window.protocolTest.pending.map(p => ({ hostIds: p.hostIds, protocol: p.protocol }))), [{ hostIds: [11, 12], protocol: 'tcp_udp' }])
  await reply(0, true)
  assert.ok(await page.eval(() => document.querySelector('[data-protocol-host="11"]').textContent.includes('等待生效')))
  assert.ok(await page.eval(() => document.querySelector('[data-protocol-host="12"] [role="alert"]').textContent.includes('升级')))
  await save()
  assert.deepEqual(await page.eval(() => window.protocolTest.pending[1].hostIds), [12], 'retry only failed hosts')
  await reply(1)
  assert.ok(await page.eval(() => document.querySelector('.protocol-batch button[type="submit"]').disabled))
  await choose('tcp'); await save()
  assert.deepEqual(await page.eval(() => ({ hostIds: window.protocolTest.pending[2].hostIds, protocol: window.protocolTest.pending[2].protocol })), { hostIds: [11, 12], protocol: 'tcp' })
  await reply(2)
  console.log('PASS selected IDs only, duplicate submit gate, partial outcomes, retry failed targets and explicit switch back to TCP')
  for (const change of ['account', 'cache', 'storage', 'route']) {
    await fresh(); await openBatch(); await save()
    await run(change => { const h = window.protocolTest
      if (change === 'account') h.session(2)
      if (change === 'cache') h.active.value = false
      if (change === 'storage') { localStorage.removeItem('token'); window.dispatchEvent(new StorageEvent('storage', { key: 'token' })) }
      if (change === 'route') void h.router.push('/elsewhere')
    }, change)
    const counts = await page.eval(() => ({ reads: window.protocolTest.reads.length, toasts: window.protocolTest.toast.toasts.value.length }))
    await reply(0)
    assert.deepEqual(await page.eval(() => ({ reads: window.protocolTest.reads.length, toasts: window.protocolTest.toast.toasts.value.length })), counts, `${change} obsolete receipt`)
    assert.equal(await page.eval(() => !!document.querySelector('.protocol-batch[open]')), false)
  }
  await fresh(); await openBatch(); await save()
  await run(() => window.protocolTest.pending[0].resolve({ results: [{ id: 99, success: true }] }))
  assert.equal(await page.eval(() => document.querySelectorAll('.protocol-batch [role="alert"]').length), 2)
  console.log('PASS four obsolete receipt boundaries and malformed response retention')
  for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
    await page.setViewport({ width, height: 1000 }); await fresh()
    await run(theme => { const h = window.protocolTest; h.theme.setTheme(theme); const v = h.view().inventory.$.setupState; v.hosts[0].name = 'PayIncus-' + 'long-name-'.repeat(10) }, theme)
    await openBatch()
    assert.ok(await page.eval(() => document.querySelector('.protocol-batch').contains(document.activeElement)))
    assert.ok(await page.eval(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector('.protocol-batch').scrollWidth <= document.querySelector('.protocol-batch').clientWidth + 1))
    assert.ok((await page.eval(() => [...document.querySelectorAll('.protocol-batch button,.protocol-batch select')].map(el => el.getBoundingClientRect().height))).every(height => height >= 44))
    await save(); await reply(0, true)
    await run(() => document.querySelector('.protocol-batch button[type="submit"]').focus())
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
    assert.equal(await page.eval(() => document.activeElement?.id), 'batch-port-protocol')
    await page.eval(() => { window.inspectionBackground = document.querySelector('main'); window.inspectionBackground.remove() })
    const metrics = await page.eval(probe), findings = judge(metrics, { width }).filter(item => !APP_SKIP.has(item.id))
    await page.eval(() => { document.querySelector('#app').append(window.inspectionBackground); delete window.inspectionBackground })
    writeFileSync(resolve(output, `${theme}-${width}.json`), JSON.stringify({ metrics, findings }, null, 2))
    assert.deepEqual(findings, [], `${theme}/${width} visual findings`)
    await page.screenshot({ path: resolve(output, `${theme}-${width}.png`), format: 'png' })
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    assert.equal(await page.eval(() => !!document.querySelector('.protocol-batch')), false)
  }
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log('PASS desktop/mobile light/dark dialog: long names, 44px controls, no overflow, focus/Tab/Escape, contrast inspection')
} finally { if (browser) await browser.close(); await server.close() }
