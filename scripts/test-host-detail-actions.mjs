import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { Browser, sleep } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'
const root = fileURLToPath(new URL('..', import.meta.url)).replaceAll('\\', '/'), require = createRequire(new URL('../client/package.json', import.meta.url))
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href), { default: vue } = await import(pathToFileURL(require.resolve('@vitejs/plugin-vue')).href)
const output = resolve(root, 'logs/host-detail-actions'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js'); tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/host-detail-copy/*.js']
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/host-detail-copy', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/host-detail-copy/api.js' }, { find: /^@\/components\/host\/.*\.vue$/, replacement: root + '/scripts/fixtures/host-detail-copy/empty.js' }, { find: '@', replacement: root + '/client/src' }, ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } }, server: { host: '127.0.0.1', port: process.argv.includes('--serve-only') ? 19746 : 19745, strictPort: true, fs: { allow: [root] } }
})
const host = (id = 11) => ({ id, name: '测试宿主', status: 'online', countryCode: 'JP', url: 'https://host.example.test', certPath: '/fixture/cert' })
const methods = { test: 'testConnection', verify: 'verifyHost', preflight: 'openDeleteModal', delete: 'confirmDeleteHost', regenerate: 'regenerateInstall', after: 'verifyAfterReinstall' }
const result = kind => kind === 'preflight' ? { total: 0, instances: [] } : kind === 'delete' ? { message: 'Host deleted' } : kind === 'regenerate' ? { success: true, message: 'fixture generated', installCommand: 'DISPLAY-ONLY reinstall command' } : { success: true, message: 'fixture success' }
let browser, obsolete = 0
try {
  await server.listen()
  if (process.argv.includes('--serve-only')) { console.log('Host detail action fixture http://127.0.0.1:19746/?inspect&action-error'); await new Promise(() => {}) }
  browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  const run = async (fn, arg) => { const value = await page.eval(fn, arg); await sleep(35); return value }
  const fresh = async () => {
    await page.goto('http://127.0.0.1:19745', { settleMs: 250 }); const deadline = Date.now() + 15000
    while (!await page.eval(() => !!window.hostDetailHarness?.view() && hostDetailHarness.pending.length > 0)) { if (Date.now() > deadline) throw Error('Host detail action fixture did not mount: ' + page.consoleErrors.join('\n')); await sleep(70) }
    await run(host => { hostDetailHarness.pending.forEach(p => p.resolve({ host })) }, host())
  }
  const prepare = kind => run(kind => { const v = hostDetailHarness.view(); if (kind === 'delete') { v.showDeleteModal = true; v.deleteConfirmName = v.host.name } if (kind === 'after') { v.reinstallCommand = 'DISPLAY-ONLY reinstall command'; v.showReinstallModal = true } }, kind)
  const submit = kind => run(method => { void hostDetailHarness.view()[method]() }, methods[kind])
  const finish = (index, payload, fail = false) => run(({ index, payload, fail }) => { const p = hostDetailHarness.pending[index]; fail ? p.reject(Error('fixture action failed')) : p.resolve(payload) }, { index, payload, fail })
  await fresh(); await submit('test'); await submit('test')
  assert.equal(await page.eval(() => hostDetailHarness.pending.filter(p => p.kind === 'test').length), 1, 'pending host action is not duplicated')
  for (const kind of Object.keys(methods)) for (const mode of ['host', 'route', 'route-aba', 'account', 'sid', 'role', 'logout', 'session-aba', 'cache', 'unmount']) for (const fail of [false, true]) {
    await fresh(); await prepare(kind); await submit(kind); const pending = await page.eval(() => hostDetailHarness.pending.length - 1)
    assert.equal(await page.eval(index => hostDetailHarness.pending[index].id, pending), 11)
    await run(async mode => { const h = hostDetailHarness
      if (mode === 'host') await h.router.push('/hosts/12')
      if (mode === 'route') await h.router.push('/elsewhere')
      if (mode === 'route-aba') { await h.router.push('/hosts/12'); await h.router.push('/hosts/11') }
      if (mode === 'account') h.session(2)
      if (mode === 'sid') h.session(1, 'other')
      if (mode === 'role') h.session(1, 'copy-session', 'user')
      if (mode === 'logout') h.auth.clearLocalAuth()
      if (mode === 'session-aba') { h.session(2); h.session(1) }
      if (mode === 'cache') h.active.value = false
      if (mode === 'unmount') h.mounted.value = false
    }, mode)
    const before = await page.eval(() => JSON.stringify({ host: hostDetailHarness.view()?.host, deleted: hostDetailHarness.view()?.showDeleteModal, command: hostDetailHarness.view()?.reinstallCommand, reinstall: hostDetailHarness.view()?.showReinstallModal, status: hostDetailHarness.view()?.reinstallStatus, route: hostDetailHarness.router.currentRoute.value.fullPath, pending: hostDetailHarness.pending.length }))
    await finish(pending, result(kind), fail)
    assert.equal(await page.eval(() => hostDetailHarness.toast.toasts.value.length), 0, kind + ' ' + mode + ' old feedback ignored')
    assert.equal(await page.eval(() => JSON.stringify({ host: hostDetailHarness.view()?.host, deleted: hostDetailHarness.view()?.showDeleteModal, command: hostDetailHarness.view()?.reinstallCommand, reinstall: hostDetailHarness.view()?.showReinstallModal, status: hostDetailHarness.view()?.reinstallStatus, route: hostDetailHarness.router.currentRoute.value.fullPath, pending: hostDetailHarness.pending.length })), before)
    obsolete++
  }
  for (const kind of Object.keys(methods)) {
    await fresh(); await prepare(kind); await submit(kind); const pending = await page.eval(() => hostDetailHarness.pending.length - 1)
    for (const other of Object.keys(methods)) await submit(other)
    assert.equal(await page.eval(() => hostDetailHarness.pending.length), pending + 1, 'actions share one pending-operation gate')
    await finish(pending, null, true)
    assert.ok(await page.eval(() => document.querySelector('[data-host-detail-action-error]')), kind + ' has persistent error')
    await prepare(kind); await submit(kind); await finish(await page.eval(() => hostDetailHarness.pending.length - 1), result(kind))
    assert.equal(await page.eval(() => !!document.querySelector('[data-host-detail-action-error]')), false)
    if (kind === 'regenerate') assert.equal(await page.eval(() => hostDetailHarness.view().reinstallCommand), 'DISPLAY-ONLY reinstall command')
  }
  for (const kind of ['delete', 'regenerate', 'after']) for (const mode of ['dialog-aba', 'draft-aba']) for (const fail of [false, true]) {
    await fresh(); await prepare(kind); await submit(kind); const index = await page.eval(() => hostDetailHarness.pending.length - 1)
    await run(({ kind, mode }) => { const v = hostDetailHarness.view()
      if (kind === 'delete') { if (mode === 'dialog-aba') { v.showDeleteModal = false; v.showDeleteModal = true } else { const name = v.deleteConfirmName; v.deleteConfirmName = 'other'; v.deleteConfirmName = name } }
      else if (mode === 'dialog-aba') { const open = v.showReinstallModal; v.showReinstallModal = !open; v.showReinstallModal = open }
      else { const command = v.reinstallCommand; v.reinstallCommand = 'other'; v.reinstallCommand = command }
    }, { kind, mode })
    const before = await page.eval(() => JSON.stringify({ deleted: hostDetailHarness.view().showDeleteModal, reinstall: hostDetailHarness.view().showReinstallModal, command: hostDetailHarness.view().reinstallCommand, status: hostDetailHarness.view().reinstallStatus }))
    await finish(index, result(kind), fail)
    assert.equal(await page.eval(() => hostDetailHarness.toast.toasts.value.length), 0)
    assert.equal(await page.eval(() => JSON.stringify({ deleted: hostDetailHarness.view().showDeleteModal, reinstall: hostDetailHarness.view().showReinstallModal, command: hostDetailHarness.view().reinstallCommand, status: hostDetailHarness.view().reinstallStatus })), before)
    obsolete++
  }
  for (const kind of Object.keys(methods)) {
    const invalids = kind === 'preflight' ? [null, {}, { total: null }, { total: -1 }, { total: 0.5 }, { total: '0' }] : kind === 'delete' ? [null, {}, { message: '' }] : kind === 'regenerate' ? [null, {}, { ...result(kind), success: false }, { ...result(kind), installCommand: '' }] : [null, {}, { success: false }, { success: 'yes' }]
    for (const payload of invalids) {
      await fresh(); await prepare(kind); await submit(kind); const index = await page.eval(() => hostDetailHarness.pending.length - 1); await finish(index, payload)
      assert.ok(await page.eval(() => document.querySelector('[data-host-detail-action-error]')))
      assert.equal(await page.eval(() => hostDetailHarness.pending.length), index + 1)
    }
  }
  await fresh(); await submit('preflight'); await finish(await page.eval(() => hostDetailHarness.pending.length - 1), { total: 3 })
  assert.equal(await page.eval(() => hostDetailHarness.view().showDeleteModal), false)
  await fresh(); await prepare('delete'); await run(() => { hostDetailHarness.view().deleteConfirmName = 'wrong' }); await submit('delete')
  assert.equal(await page.eval(() => hostDetailHarness.pending.filter(p => p.kind === 'delete').length), 0)
  await fresh(); await prepare('after'); await submit('after'); const index = await page.eval(() => hostDetailHarness.pending.length - 1)
  await run(() => { hostDetailHarness.view().closeReinstallModal() }); assert.equal(await page.eval(() => hostDetailHarness.view().showReinstallModal), true, 'pending verification keeps dialog')
  await finish(index, { success: true }); assert.equal(await page.eval(() => hostDetailHarness.view().reinstallStatus), 'success')
  await fresh(); await submit('test'); const same = await page.eval(() => hostDetailHarness.pending.length - 1); await run(() => hostDetailHarness.session(1, 'copy-session', 'admin', 2)); await finish(same, { success: true })
  assert.equal(await page.eval(() => hostDetailHarness.toast.toasts.value.length), 1)
  await fresh(); await submit('test'); const old = await page.eval(() => hostDetailHarness.pending.length - 1)
  await run(async () => { await hostDetailHarness.router.push('/hosts/12') }); await finish(await page.eval(() => hostDetailHarness.pending.length - 1), { host: host(12) })
  await submit('test'); assert.equal(await page.eval(() => hostDetailHarness.pending.filter(p => p.kind === 'test').length), 1)
  await finish(old, { success: true }); await submit('test'); const current = await page.eval(() => hostDetailHarness.pending.length - 1)
  await finish(old, { success: true }); assert.equal(await page.eval(() => hostDetailHarness.view().actionLoading), 'test', 'old receipt cannot release current action')
  await finish(current, { success: true })
  await fresh(); await submit('regenerate'); const install = await page.eval(() => hostDetailHarness.pending.length - 1)
  await run(() => { void hostDetailHarness.view().loadHost() }); assert.equal(await page.eval(() => hostDetailHarness.pending.length), install + 1, 'active mutation pauses reads')
  await finish(install, result('regenerate')); assert.equal(await page.eval(() => hostDetailHarness.view().showReinstallModal), true)
  await fresh(); await run(() => { void hostDetailHarness.view().loadHost() }); const read = await page.eval(() => hostDetailHarness.pending.length - 1)
  await submit('regenerate'); await finish(await page.eval(() => hostDetailHarness.pending.length - 1), result('regenerate'))
  await finish(read, { host: { ...host(), name: 'obsolete read' } }); assert.equal(await page.eval(() => hostDetailHarness.view().host.name), host().name)
  await fresh(); await submit('test'); const cached = await page.eval(() => hostDetailHarness.pending.length - 1)
  await run(() => { hostDetailHarness.active.value = false }); await run(() => { hostDetailHarness.active.value = true })
  await finish(await page.eval(() => hostDetailHarness.pending.length - 1), { host: host() }); await submit('test')
  assert.equal(await page.eval(() => hostDetailHarness.pending.filter(p => p.kind === 'test').length), 1, 'cache return retains original operation gate')
  await finish(cached, { success: true }); assert.equal(await page.eval(() => hostDetailHarness.toast.toasts.value.length), 0)
  await fresh(); await run(async () => { await hostDetailHarness.router.push('/admin/hosts/11') })
  await finish(await page.eval(() => hostDetailHarness.pending.length - 1), { host: host() }); await submit('test')
  await finish(await page.eval(() => hostDetailHarness.pending.length - 1), { success: true })
  assert.equal(await page.eval(() => hostDetailHarness.toast.toasts.value.length), 1, 'administrator route actions remain usable')
  for (const locale of ['zh-CN', 'zh-TW', 'en']) for (const width of [1440, 768, 390]) {
    await fresh(); await page.setViewport({ width, height: 900, mobile: width === 390 }); await run(locale => hostDetailHarness.setLocale(locale), locale)
    await run(() => Array.from(document.querySelectorAll('.page-header button')).find(b => b.textContent.trim() === hostDetailHarness.t('admin.hosts.test')).click())
    await finish(await page.eval(() => hostDetailHarness.pending.length - 1), null, true)
    assert.ok(await page.eval(() => document.querySelector('[data-host-detail-action-error]').textContent.includes(hostDetailHarness.t('admin.hosts.testFailed'))))
    await run(() => Array.from(document.querySelectorAll('.page-header button')).find(b => b.textContent.trim() === hostDetailHarness.t('admin.hosts.test')).click())
    await finish(await page.eval(() => hostDetailHarness.pending.length - 1), { success: true })
    assert.equal(await page.eval(() => !!document.querySelector('[data-host-detail-action-error]')), false)
    await finish(await page.eval(() => hostDetailHarness.pending.length - 1), { host: host() })
    await prepare('after'); await run(() => document.querySelector('[data-host-detail-reinstall-verify]').click()); const verifying = await page.eval(() => hostDetailHarness.pending.length - 1)
    assert.equal(await page.eval(() => document.querySelector('[data-host-detail-reinstall-verify]').disabled), true)
    await finish(verifying, { success: false }); assert.equal(await page.eval(() => hostDetailHarness.view().reinstallStatus), 'error')
    assert.ok(await page.eval(locale => document.querySelector('[data-host-detail-action-error]').textContent.includes(locale === 'zh-CN' ? '操作失败' : locale === 'zh-TW' ? '操作失敗' : 'Operation failed'), locale), 'failure detail uses the requested language')
    await sleep(350)
    assert.ok(await page.eval(() => document.documentElement.scrollWidth <= innerWidth))
    if (width === 390) assert.ok(await page.eval(() => document.querySelector('[data-host-detail-reinstall-verify]').getBoundingClientRect().height >= 44))
    await page.screenshot({ path: resolve(output, `${locale}-${width}.png`), format: 'png' })
    await run(() => { const v = hostDetailHarness.view(); v.closeReinstallModal() }); await finish(await page.eval(() => hostDetailHarness.pending.length - 1), { host: host() })
    await run(() => Array.from(document.querySelectorAll('.page-header button')).find(b => b.textContent.trim() === hostDetailHarness.t('common.delete')).click())
    await finish(await page.eval(() => hostDetailHarness.pending.length - 1), { total: 0 }); await sleep(350)
    await run(() => { const input = document.querySelector('.host-delete-dialog input'); input.value = hostDetailHarness.view().host.name; input.dispatchEvent(new Event('input', { bubbles: true })) })
    await run(() => document.querySelector('.host-delete-dialog .btn-danger').click())
    const deletion = await page.eval(() => hostDetailHarness.pending.length - 1)
    assert.equal(await page.eval(() => document.querySelector('.host-delete-dialog input').disabled), true)
    assert.equal(await page.eval(() => document.querySelector('.host-delete-dialog .btn-danger').disabled), true)
    await finish(deletion, null, true)
    assert.equal(await page.eval(() => hostDetailHarness.view().showDeleteModal), true, 'delete failure keeps confirmation for retry')
    await run(() => document.querySelector('.host-delete-dialog .btn-danger').click()); await finish(await page.eval(() => hostDetailHarness.pending.length - 1), result('delete'))
    assert.equal(await page.eval(() => hostDetailHarness.view().showDeleteModal), false)
  }
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log(`PASS actual host detail six actions, ${obsolete} obsolete receipts, shared pending gate, persistent failures/retry, strict replies, delete preflight and reinstall verification; controlled API no host writes`)
} finally { if (browser) await browser.close(); await server.close() }
