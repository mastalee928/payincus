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
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/transfer-modal/*.js']
const output = resolve(root, 'logs/transfer-modal-lifecycle'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const server = await createServer({ configFile: false, root: root + '/scripts/fixtures/transfer-modal', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/transfer-modal/api.js' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19666, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.fixtureIntervals = new Map();
    const originalSet = window.setInterval.bind(window), originalClear = window.clearInterval.bind(window);
    window.setInterval = (callback, delay, ...args) => {
      const id = originalSet(callback, delay, ...args); window.fixtureIntervals.set(id, { callback, delay }); return id;
    };
    window.clearInterval = id => { window.fixtureIntervals.delete(id); return originalClear(id); };
  ` })
  await page.goto('http://127.0.0.1:19666', { settleMs: 1200 })
  const check = async (fn, label) => { const end = Date.now() + 12000; while (!await page.eval(fn)) { if (Date.now() > end) throw Error(label); await sleep(60) } }
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(60); return result }
  const last = kind => page.eval(kind => window.transferHarness.pending.findLastIndex(item => item.kind === kind), kind)
  const accept = (index, data) => run(({ index, data }) => window.transferHarness.pending[index].resolve(data), { index, data })
  const reject = (index, code = 'USER_NOT_FOUND') => run(({ index, code }) => window.transferHarness.pending[index].reject({ code, message: 'fixture failure' }), { index, code })
  const name = value => run(value => { const input = document.querySelector('input'); input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })) }, value)
  const search = () => run(() => { void window.transferHarness.view().searchUser() })
  const toggle = show => run(show => { window.transferHarness.state.show = show }, show)
  const count = kind => page.eval(kind => window.transferHarness.pending.filter(item => item.kind === kind).length, kind)
  const view = key => page.eval(key => JSON.parse(JSON.stringify(window.transferHarness.view()[key])), key)
  const user = (username, id = 2, status = 'active') => ({ user: { id, username, status } })
  const balance = () => acceptLast('balance', { balance: { balance: 20 } })
  const acceptLast = async (kind, data) => accept(await last(kind), data)
  const submit = () => run(() => { void window.transferHarness.view().handleTransfer() })
  const prepare = async (username = 'alice') => { await balance(); await name(username); await search(); await acceptLast('search', user(username)) }
  const reopen = async () => { await toggle(false); await toggle(true) }
  const challenge = async () => { await submit(); await reject(await last('create'), 'VERIFICATION_REQUIRED'); await check(() => !!window.transferHarness.verification()?.requestCode, 'verification mounted') }
  const code = () => run(() => { void window.transferHarness.verification().requestCode() })
  await check(() => window.transferHarness?.pending.length === 1, 'initial balance read')
  const a = await last('balance')
  await toggle(false); await toggle(true)
  const b = await last('balance')
  await accept(a, { balance: { balance: 999 } })
  assert.equal(await page.eval(() => window.transferHarness.view().userBalance), 0, 'closed generation balance cannot fund new transfer form')
  assert.equal(await page.eval(() => window.transferHarness.view().loadingBalance), true)
  await accept(b, { balance: { balance: 20 } })
  await name('alice'); await search(); const oldSearch = await last('search')
  await toggle(false); await toggle(true); await name('alice'); await search()
  assert.notEqual(await last('search'), oldSearch, 'old search cannot leave replacement form busy')
  await accept(oldSearch, user('alice', 99)); assert.equal(await view('targetUser'), null); assert.equal(await view('searchLoading'), true)
  await acceptLast('search', user('alice')); await balance()
  await name('bob'); await search(); const oldBob = await last('search')
  await name('alice'); await search(); const newAlice = await last('search')
  await reject(oldBob); assert.equal(await view('searchError'), ''); assert.equal(await view('searchLoading'), true)
  await accept(newAlice, user('alice'))
  await name('bob'); await search(); const aba = await last('search'); await name('alice'); await name('bob'); await search()
  await accept(aba, user('bob', 99)); assert.equal(await view('targetUser'), null)
  await acceptLast('search', user('bob')); assert.equal((await view('targetUser')).id, 2)
  await name('alice'); await search(); await acceptLast('search', user('someone-else'))
  assert.equal(await view('canTransfer'), false, 'mismatched search response never enables transfer')
  await search(); await reject(await last('search')); assert.ok(await view('searchError'))
  await search(); await acceptLast('search', user('alice', 2, 'banned')); assert.equal(await view('canTransfer'), false)
  await search(); await acceptLast('search', user('alice'))
  console.log('PASS transfer modal close/reopen reads')

  const beforeRefresh = await count('balance'); await run(() => window.transferHarness.refresh())
  assert.equal(await count('balance'), beforeRefresh, 'same sid refresh preserves the form')
  assert.equal((await view('targetUser')).username, 'alice')
  await reopen(); const staleBalance = await last('balance')
  await run(() => window.transferHarness.session('b')); const sessionBalance = await last('balance')
  await reject(staleBalance); assert.equal(await view('loadingBalance'), true)
  await accept(sessionBalance, { balance: { balance: 20 } }); await name('alice'); await search(); const staleSessionSearch = await last('search')
  await run(() => window.transferHarness.session('c')); await accept(staleSessionSearch, user('alice'))
  assert.equal(await view('targetUser'), null)
  await prepare(); await run(() => { window.transferHarness.state.instance.id = 11 })
  assert.equal(await view('targetUser'), null); await prepare()
  await run(() => { window.transferHarness.view().remark = 'original note' })
  await submit(); const sending = await last('create')
  assert.deepEqual(await page.eval(i => window.transferHarness.pending[i].data, sending), { id: 11, username: 'alice', remark: 'original note' })
  await submit(); assert.equal(await last('create'), sending, 'duplicate submission is blocked')
  await reopen(); await balance(); await name('bob'); await search()
  assert.equal(await view('transferLoading'), true, 'in-flight write remains busy across reopen')
  const eventCount = await page.eval(() => window.transferHarness.events.length), toastCount = await page.eval(() => window.transferHarness.toasts.length)
  await accept(sending, {}); assert.equal(await view('transferLoading'), false)
  assert.equal(await page.eval(() => window.transferHarness.events.length), eventCount)
  assert.equal(await page.eval(() => window.transferHarness.toasts.length), toastCount)
  await search(); await acceptLast('search', user('bob')); await submit(); const obsoleteError = await last('create')
  await run(() => { window.transferHarness.state.instance.id = 12 }); await reject(obsoleteError, 'VERIFICATION_REQUIRED')
  assert.equal(await view('verificationAttempt'), null); await prepare()
  await submit(); await reject(await last('create'), 'TRANSFER_ALREADY_PENDING')
  assert.equal(await view('transferLoading'), false); assert.equal(await page.eval(() => window.transferHarness.toasts.length), toastCount + 1)
  await submit(); await acceptLast('create', {})
  assert.deepEqual(await page.eval(() => window.transferHarness.events), ['success', 'close'])
  console.log('PASS fixed transfer payload, busy guard and obsolete success/failure')

  await reopen(); await prepare(); await challenge(); await code(); const oldCode = await last('request-code')
  const beforeCodeToast = await page.eval(() => window.transferHarness.toasts.length)
  await run(() => { window.transferHarness.view().remark = 'new draft' })
  await accept(oldCode, { channel: 'email', maskedTarget: 'f***@example.invalid' })
  assert.equal(await page.eval(() => window.transferHarness.toasts.length), beforeCodeToast, 'obsolete verification request stays silent')
  assert.equal(await page.eval(() => [...window.fixtureIntervals.values()].filter(timer => timer.delay === 1000).length), 0, 'late code response cannot start an orphan countdown')
  console.log('PASS verification request after draft change stays silent and starts no timer')

  await challenge(); await code(); await acceptLast('request-code', { channel: 'email', maskedTarget: 'f***@example.invalid' })
  await run(() => { window.transferHarness.verification().verificationCode = '123456'; void window.transferHarness.verification().verify() })
  const oldVerify = await last('verify'); const beforeVerify = await count('create')
  await reopen(); await prepare('bob'); await challenge()
  const newAttemptKey = await page.eval(() => window.transferHarness.view().verificationAttempt.key)
  const oldVerifyToasts = await page.eval(() => window.transferHarness.toasts.length)
  await accept(oldVerify, { verified: true })
  assert.equal(await count('create'), beforeVerify + 1, 'old successful verification cannot submit the new draft')
  assert.equal(await page.eval(() => window.transferHarness.view().verificationAttempt.key), newAttemptKey)
  assert.equal(await page.eval(() => window.transferHarness.toasts.length), oldVerifyToasts)
  await code(); const newCode = await last('request-code'); await code()
  assert.equal(await last('request-code'), newCode, 'duplicate verification requests are blocked')
  await accept(newCode, { channel: 'email', maskedTarget: 'f***@example.invalid' })
  await run(() => { window.transferHarness.verification().verificationCode = '123456'; void window.transferHarness.verification().verify() })
  const verifyFalse = await last('verify'); await run(() => { void window.transferHarness.verification().verify() })
  assert.equal(await last('verify'), verifyFalse, 'enter key cannot duplicate verification')
  await accept(verifyFalse, { verified: false }); assert.equal(await count('create'), beforeVerify + 1)
  await run(() => { void window.transferHarness.verification().verify() }); await reject(await last('verify'), 'INVALID_CODE')
  assert.ok(await page.eval(() => window.transferHarness.verification().error))
  await run(() => { void window.transferHarness.verification().verify() }); await acceptLast('verify', { verified: true })
  assert.equal(await count('create'), beforeVerify + 2, 'current verification retries the fixed transfer once')
  assert.deepEqual(await page.eval(i => window.transferHarness.pending[i].data, await last('create')), { id: 12, username: 'bob' })
  await acceptLast('create', {})
  console.log('PASS old verification fenced, negative verification denied, current retry uses fixed recipient')

  await reopen(); await prepare(); await challenge(); await code(); const closingCode = await last('request-code')
  await run(() => window.transferHarness.verification().close())
  await challenge(); await code(); const replacingCode = await last('request-code')
  await reject(closingCode); assert.equal(await page.eval(() => window.transferHarness.verification().loading), true)
  assert.equal(await page.eval(() => window.transferHarness.verification().error), '')
  await accept(replacingCode, { success: true, required: false })
  assert.equal(await last('create') > closingCode, true, 'server confirmed no-channel response retries through transfer endpoint')
  await acceptLast('create', {})
  await reopen(); await prepare(); await challenge(); await code(); const logoutCode = await last('request-code')
  await run(() => window.transferHarness.session(null)); const callsOnLogout = await page.eval(() => window.transferHarness.pending.length)
  await accept(logoutCode, { channel: 'email' }); await submit(); await search()
  assert.equal(await page.eval(() => window.transferHarness.pending.length), callsOnLogout)
  assert.equal(await view('targetUser'), null); assert.equal(await view('canTransfer'), false)
  await run(() => window.transferHarness.session('d')); await prepare()
  for (const [locale, width, dark] of [['zh-CN', 1440, false], ['en', 390, true]]) {
    await page.setViewport({ width, height: 850, mobile: width === 390 })
    await run(({ locale, dark }) => { window.transferHarness.setLocale(locale); window.transferHarness.theme.setTheme(dark ? 'dark' : 'light') }, { locale, dark })
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true, 'transfer form stays within viewport')
    await page.screenshot({ path: resolve(output, `${locale}-${width}.png`), format: 'png' })
  }
  await challenge(); await code(); const unmountedCode = await last('request-code')
  await run(() => { window.transferHarness.state.mounted = false })
  const toastsOnLeave = await page.eval(() => window.transferHarness.toasts.length)
  await accept(unmountedCode, { channel: 'email' }); await sleep(1100)
  assert.equal(await page.eval(() => window.transferHarness.toasts.length), toastsOnLeave)
  assert.equal(await page.eval(() => [...window.fixtureIntervals.values()].filter(timer => timer.delay === 1000).length), 0)
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log('PASS close/reopen verification errors, no-channel retry, logout, unmount, desktop/mobile Chrome')
} finally { if (browser) await browser.close(); await server.close() }
