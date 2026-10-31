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
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/host-delete-lifecycle/*.js']
const output = resolve(root, 'logs/host-delete-lifecycle-lifecycle'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const server = await createServer({ configFile: false, root: root + '/scripts/fixtures/host-delete-lifecycle', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/host-delete-lifecycle/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19680, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19680', { settleMs: 1600 })
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(90); return result }
  const last = kind => page.eval(kind => window.hostDelete.pending.findLastIndex(item => item.kind === kind), kind)
  const accept = (index, data) => run(({ index, data }) => window.hostDelete.pending[index].resolve(data), { index, data })
  const row = (id, hostId = 1) => ({ id, name: `Fixture instance ${id}`, hostId, status: 'running', image: 'debian/12', cpu: 1, memory: 512, disk: 10240, username: 'Fixture user', packagePlanId: 1, billingPrice: 10 })
  const preview = ids => ({ instances: ids.map(id => ({ id, name: `Fixture instance ${id}`, username: 'Fixture user', userId: 2, isOwnInstance: false, isPaid: true, remainingDays: 10, refundAmount: 5 })), totalRefundAmount: ids.length * 5 })
  let copyCases = 0
  for (const [locale, width] of [['zh-CN', 1440], ['zh-TW', 768], ['en', 390]]) {
    for (const databaseOnly of [true, false]) for (const failedCount of [0, 1, 2]) {
      await page.goto('http://127.0.0.1:19680', { settleMs: 800 })
      await page.setViewport({ width, height: 1000, mobile: width === 390 })
      await run(locale => window.hostDelete.setLocale(locale), locale)
      await accept(await last('list'), { instances: [row(1), row(2)], total: 2, totalPages: 1 })
      await run(() => { const v = window.hostDelete.view(); v.selectedIds = new Set([1, 2]); void v.openBatchDeleteModal() })
      await accept(await last('preview'), preview([1, 2]))
      await run(databaseOnly => {
        const action = document.querySelector(databaseOnly ? '.modal-footer .btn-warning' : '.modal-footer .btn-danger')
        if (!action || action.disabled) throw Error('Delete action unavailable')
        action.click()
      }, databaseOnly)
      assert.equal(await page.eval(index => window.hostDelete.pending[index].params.databaseOnly, await last('delete')), databaseOnly)
      const successCount = 2 - failedCount
      await accept(await last('delete'), { successCount, failedCount, results: [1, 2].map(id => ({ id, success: id <= successCount, error: id > successCount ? 'Isolated failure' : undefined })) })
      const messages = await page.eval(() => window.hostDelete.toast.toasts.value.map(item => item.message))
      assert.equal(messages.length, 1)
      if (databaseOnly) {
        assert.match(messages[0], { 'zh-CN': /移除.*记录/, 'zh-TW': /移除.*記錄/, en: /removed.*record/i }[locale])
        assert.match(messages[0], { 'zh-CN': /实例与磁盘.*保留/, 'zh-TW': /實例與磁碟.*保留/, en: /instances and disks.*remain/i }[locale])
        assert.doesNotMatch(messages[0], /删除.*实例|刪除.*實例|deleted.*instance/i)
      } else assert.match(messages[0], /删除.*实例|刪除.*實例|deleted.*instance/i)
      assert.ok(messages[0].includes(String(successCount)), 'show the actual success count')
      if (failedCount) assert.ok(messages[0].includes(String(failedCount)), 'show the actual failure count')
      assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
      if (databaseOnly && failedCount === 0) await page.screenshot({ path: resolve(output, `r263-${locale}-${width}.png`), format: 'png' })
      copyCases++
    }
  }
  console.log(`PASS R263 ${copyCases} real button actions: database/full deletion, all/partial/no success and three languages/widths`)
  if (!process.argv.includes('--copy-only')) {
  await page.goto('http://127.0.0.1:19680', { settleMs: 800 })
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  await accept(await last('list'), { instances: [row(1), row(2)], total: 2, totalPages: 1 })
  await run(() => { const v = window.hostDelete.view(); v.toggleSelect(1); void v.openBatchDeleteModal() })
  await accept(await last('preview'), preview([1]))
  await run(() => { const v = window.hostDelete.view(); v.toggleSelect(1); v.toggleSelect(2); void v.confirmBatchDelete(false) })
  assert.deepEqual(await page.eval(index => window.hostDelete.pending[index].params.ids, await last('delete')), [1], 'deletion must use the reviewed target, not later checkbox changes')
  console.log('PASS host delete fixes reviewed target')
  const view = key => page.eval(key => JSON.parse(JSON.stringify(window.hostDelete.view()[key])), key)
  const reject = index => run(index => window.hostDelete.pending[index].reject(new Error('Fixture delete failure')), index)
  const count = kind => page.eval(kind => window.hostDelete.pending.filter(item => item.kind === kind).length, kind)
  const list = (ids, hostId = 1) => ({ instances: ids.map(id => row(id, hostId)), total: ids.length, totalPages: 1 })
  const result = (ids, failed = []) => ({ successCount: ids.filter(id => !failed.includes(id)).length, failedCount: failed.length,
    results: ids.map(id => ({ id, name: `Fixture instance ${id}`, success: !failed.includes(id), error: failed.includes(id) ? 'Fixture retained failure' : undefined })) })
  const choose = ids => run(ids => { window.hostDelete.view().selectedIds = new Set(ids) }, ids)
  const open = async (ids, refund = false) => {
    await choose(ids); await run(() => { void window.hostDelete.view().openBatchDeleteModal() })
    await run(refund => { window.hostDelete.view().deleteRefund = refund }, refund)
    return last('preview')
  }
  const initialDelete = await last('delete'); await run(() => { void window.hostDelete.view().confirmBatchDelete(true) })
  assert.equal(await count('delete'), 1)
  await accept(initialDelete, result([1])); await accept(await last('list'), list([2]))
  assert.equal(await page.eval(() => window.hostDelete.view().selectedIds.has(2)), true, 'later checkbox target survives completion')
  assert.equal(await view('showDeleteModal'), false)
  let request = await open([2], true); const beforePending = await count('delete')
  await run(() => { void window.hostDelete.view().confirmBatchDelete(false) }); assert.equal(await count('delete'), beforePending)
  await accept(request, preview([2])); await run(() => { window.hostDelete.view().showDeleteModal = false })
  await run(() => { void window.hostDelete.view().confirmBatchDelete(false) }); assert.equal(await count('delete'), beforePending)
  const stalePreview = await open([2], true)
  await run(() => { window.hostDelete.view().showDeleteModal = false }); const currentPreview = await open([2], true)
  await accept(stalePreview, preview([2])); assert.equal(await view('deletePreview'), null); assert.equal(await view('deletePreviewLoading'), true)
  await accept(currentPreview, preview([2]))
  await run(() => { window.hostDelete.view().deleteReason = '  reviewed reason  '; void window.hostDelete.view().confirmBatchDelete(true) })
  const currentWrite = await last('delete')
  assert.deepEqual(await page.eval(index => window.hostDelete.pending[index].params, currentWrite), { hostId: 1, ids: [2], reason: 'reviewed reason', databaseOnly: true, refund: true })
  await reject(currentWrite); assert.ok(await view('deleteRequestError')); assert.equal(await view('isDeleting'), false)
  await run(() => { void window.hostDelete.view().confirmBatchDelete(true) }); const inFlight = await last('delete')
  await run(() => { window.hostDelete.state.id = 2 }); await accept(await last('list'), list([3], 2))
  await open([3]); assert.equal(await view('showDeleteModal'), false, 'pending deletion must not open another deletion')
  const beforeOldWrite = await count('list'); await accept(inFlight, result([2]))
  assert.equal(await count('list'), beforeOldWrite); assert.equal((await view('instances'))[0].id, 3)
  request = await open([3], true)
  for (const data of [preview([999]), preview([]), preview([3, 3]), { ...preview([3]), totalRefundAmount: -1 }, { ...preview([3]), totalRefundAmount: '5' }]) {
    await accept(request, data)
    assert.equal(await view('deletePreview'), null); assert.ok(await view('deletePreviewError'))
    const before = await count('delete'); await run(() => { void window.hostDelete.view().confirmBatchDelete(false) }); assert.equal(await count('delete'), before)
    await run(() => { void window.hostDelete.view().loadDeletePreview() }); request = await last('preview')
  }
  await accept(request, preview([3])); await run(() => { void window.hostDelete.view().confirmBatchDelete(false) })
  await accept(await last('delete'), result([3], [3])); await accept(await last('list'), list([3], 2))
  assert.equal(await view('showDeleteModal'), true); assert.equal((await view('deleteFailures'))[0].id, 3)
  await accept(await last('preview'), preview([3])); await run(() => { void window.hostDelete.view().confirmBatchDelete(false) })
  const oldSession = await last('delete'); await run(() => window.hostDelete.session('b'))
  await accept(await last('list'), list([3], 2)); await reject(oldSession)
  assert.equal(await view('deleteRequestError'), ''); assert.equal(await view('isDeleting'), false)
  request = await open([3], true); await run(() => { window.hostDelete.state.active = false }); await accept(request, preview([3]))
  assert.equal(await view('showDeleteModal'), false); assert.equal(await view('deletePreview'), null)
  await run(() => { window.hostDelete.state.active = true }); await accept(await last('list'), list([3], 2))
  request = await open([3], false); await reject(request)
  await run(() => { void window.hostDelete.view().confirmBatchDelete(false) }); assert.equal((await page.eval(index => window.hostDelete.pending[index].params, await last('delete'))).refund, false)
  await accept(await last('delete'), result([3], [3])); await accept(await last('list'), list([3], 2))
  await accept(await last('preview'), preview([3]))
  for (const [locale, width, dark, mobile] of [['zh-CN', 1440, false, false], ['en', 390, true, true]]) {
    await page.setViewport({ width, height: 1000, mobile })
    await run(({ locale, dark }) => { window.hostDelete.setLocale(locale); window.hostDelete.theme.setTheme(dark ? 'dark' : 'light') }, { locale, dark })
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: resolve(output, `${locale}-${width}.png`), format: 'png' })
  }
  const beforeUnmount = await count('delete'); await run(() => { window.hostDelete.state.mounted = false })
  await run(() => { void window.hostDelete.view().confirmBatchDelete(false) }); assert.equal(await count('delete'), beforeUnmount)
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log('PASS fixed targets, preview validation, duplicate and pending actions, partial failure, session/cache/unmount and both deletion modes')
  }
} finally { if (browser) await browser.close(); await server.close() }

