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
const output = resolve(root, 'logs/gateway-abuse'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js')
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/gateway-abuse/*.js']
const server = await createServer({ configFile: false, cacheDir: resolve(output, 'vite-cache'), root: root + '/scripts/fixtures/gateway-abuse', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api(?:\/admin)?$/, replacement: root + '/scripts/fixtures/gateway-abuse/api.js' }, { find: '@', replacement: root + '/client/src' }, ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19778, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  const run = async (fn, arg) => { const value = await page.eval(fn, arg); await sleep(80); return value }
  const until = async condition => { const deadline = Date.now() + 15000; while (!await page.eval(condition)) { assert.ok(Date.now() < deadline, page.consoleErrors.join('\n') || 'Fixture did not reach expected state'); await sleep(80) } }
  const fresh = async tab => {
    await page.goto('http://127.0.0.1:19778', { settleMs: 150 })
    await until(() => window.gatewayAbuseTest && document.querySelector('.abuse-policy[aria-busy="false"]'))
    if (tab === 'gateways') { await run(() => { window.gatewayAbuseTest.tab.value = 'gateways' }); await until(() => document.querySelectorAll('.gateway-domain-change[aria-busy="false"]').length === 2) }
  }
  const submitPolicy = () => run(() => document.querySelector('.abuse-policy button[type="submit"]').click())
  const fill = (selector, value) => run(({ selector, value }) => { const el = document.querySelector(selector); el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })) }, { selector, value })
  const complete = index => run(index => {
    const h = window.gatewayAbuseTest, item = h.pending[index]
    if (item.kind === 'save-policy') { h.fixture.policy = { ...item.input, revision: item.input.revision + 1 }; item.resolve(structuredClone(h.fixture.policy)) }
    if (item.kind === 'retry-all') item.resolve({ queued: 105, failed: 0, results: [] })
    if (item.kind === 'save-endpoint') { h.fixture.endpoint.endpoint.hostname = item.input.hostname; item.resolve(structuredClone(h.fixture.endpoint)) }
    if (item.kind === 'save-domain') { const state = h.fixture.domains[item.id]; Object.assign(state, { desiredHostname: item.input.hostname, state: 'retrying', attempt: 9, retryAt: new Date(Date.now() + 900000).toISOString(), errorCode: 'SSH_DISCONNECTED' }); item.resolve(structuredClone(state)) }
  }, index)
  await fresh()
  assert.equal(await page.eval(() => document.querySelectorAll('[data-abuse-toggle]').length), 3)
  assert.equal(await page.eval(() => document.querySelector('[data-abuse-toggle="blockSpeedTest"]').checked), false)
  await run(() => document.querySelector('[data-abuse-toggle="blockSpeedTest"]').click())
  await run(() => document.querySelector('[data-abuse-toggle="blockBt"]').click())
  await run(() => document.querySelectorAll('.abuse-policy form button')[2].click())
  assert.equal(await page.eval(() => document.querySelector('[data-abuse-toggle="blockBt"]').checked), true, 'refresh preserves an unsaved administrator choice')
  assert.equal(await page.eval(() => document.querySelector('[data-abuse-toggle="blockSpeedTest"]').checked), true, 'refresh preserves speed-test draft')
  await submitPolicy(); await submitPolicy()
  assert.deepEqual(await page.eval(() => window.gatewayAbuseTest.requests), [{ kind: 'save-policy', input: { revision: 3, blockBt: true, blockMining: false, blockSpeedTest: true } }])
  await complete(0)
  assert.ok(await page.eval(() => document.querySelector('.abuse-policy').textContent.includes('已应用 2')), 'save receipt is not host verification')
  await run(() => document.querySelector('.abuse-policy summary').click())
  await fill('.abuse-policy input[type="search"]', 'PayIncus-108')
  await run(() => document.querySelector('.abuse-policy input[type="search"]').dispatchEvent(new Event('change', { bubbles: true })))
  assert.ok(await page.eval(() => document.querySelector('.abuse-policy').textContent.includes('没有符合筛选')))
  await run(() => document.querySelectorAll('.abuse-policy form button')[1].click())
  assert.deepEqual(await page.eval(() => window.gatewayAbuseTest.requests[1]), { kind: 'retry-all', input: { revision: 4 } }, 'global action is independent of search or visible page')
  await complete(1)
  assert.ok(await page.eval(() => document.querySelector('.abuse-policy').textContent.includes('105 台重试')))
  console.log('PASS one global save, no false applied receipt, duplicate submit, refresh keeps draft, global retry ignores page/search')
  for (const boundary of ['account', 'cache', 'storage', 'aba']) {
    await fresh(); await run(() => document.querySelector('[data-abuse-toggle="blockBt"]').click()); await submitPolicy()
    await run(boundary => { const h = window.gatewayAbuseTest; if (boundary === 'account') h.session(2); else if (boundary === 'storage') { localStorage.removeItem('token'); h.auth.syncToken() } else h.active.value = false }, boundary)
    if (boundary === 'aba') await run(() => { window.gatewayAbuseTest.active.value = true })
    const count = await page.eval(() => window.gatewayAbuseTest.reads.length)
    await complete(0)
    assert.equal(await page.eval(() => window.gatewayAbuseTest.reads.length), count, `${boundary} late write cannot refresh a different context`)
    assert.ok(!await page.eval(() => document.querySelector('.abuse-policy')?.textContent.includes('策略已保存')), `${boundary} late notice discarded`)
  }
  await fresh(); await run(() => document.querySelector('[data-abuse-toggle="blockBt"]').click()); await submitPolicy()
  await run(() => window.gatewayAbuseTest.pending[0].reject({ code: 'ABUSE_POLICY_CHANGED' }))
  assert.ok(await page.eval(() => document.querySelector('.abuse-policy [role="alert"]').textContent.includes('其他窗口')))
  await run(() => { const h = window.gatewayAbuseTest; h.fixture.hosts[0].state = 'conflict'; h.fixture.hosts[0].errorCode = 'ABUSE_POLICY_CONFLICT'; document.querySelectorAll('.abuse-policy form button')[2].click() })
  assert.ok(await page.eval(() => document.querySelector('.abuse-policy').textContent.includes('部分宿主的策略需要核对')))
  console.log('PASS session/storage/KeepAlive/ABA late receipts, concurrent policy error and restore conflict guidance')
  await fresh('gateways')
  await fill('.gateway-domain form input', 'control-new.example.invalid')
  await run(() => document.querySelector('.gateway-domain button[type="submit"]').click())
  assert.deepEqual(await page.eval(() => window.gatewayAbuseTest.requests[0].input), { hostname: 'control-new.example.invalid', expectedHostname: 'control.example.invalid' })
  await complete(0)
  for (const [index, id] of ['independent', 'backup'].entries()) {
    await run(index => document.querySelectorAll('.gateway-domain-change')[index].querySelector('button').click(), index)
    await run(({ index, id }) => { const inputs = document.querySelectorAll('.gateway-domain-change')[index].querySelectorAll('input'); inputs[0].value = `${id}-new.example.invalid`; inputs[0].dispatchEvent(new Event('input', { bubbles: true })); if (inputs[1]) { inputs[1].value = 'fixture-only-password'; inputs[1].dispatchEvent(new Event('input', { bubbles: true })) } }, { index, id })
    await run(index => document.querySelectorAll('.gateway-domain-change')[index].querySelector('button[type="submit"]').click(), index)
    const request = await page.eval(index => window.gatewayAbuseTest.requests[index + 1], index)
    assert.equal(request.id, id); assert.equal(request.input.expectedHostname, `${id}.example.invalid`); assert.equal(request.input.hostname, `${id}-new.example.invalid`)
    assert.equal(!!request.input.credentials, id === 'backup'); assert.ok(request.input.requestId)
    await complete(index + 1)
    assert.equal(await page.eval(index => document.querySelectorAll('.gateway-domain-change')[index].querySelector('input[type="password"]'), index), null)
    assert.ok(await page.eval(index => document.querySelectorAll('.gateway-domain-change')[index].textContent.includes('下次自动重试'), index))
  }
  await run(() => { const h = window.gatewayAbuseTest; for (const state of Object.values(h.fixture.domains)) { state.hostname = state.desiredHostname; state.state = 'succeeded'; state.errorCode = null; state.retryAt = null } h.active.value = false })
  await run(() => { window.gatewayAbuseTest.active.value = true })
  await until(() => [...document.querySelectorAll('.gateway-domain-change')].every(el => el.textContent.includes('已核验生效')))
  assert.ok(await page.eval(() => document.querySelectorAll('.gateway-domain-change')[1].textContent.includes('backup-new.example.invalid')))
  console.log('PASS local/independent/backup domain targets, old value CAS, scoped one-time credentials, long outage retry and verified completion')
  await fresh('gateways')
  await run(() => { const h = window.gatewayAbuseTest; h.fixture.domains.independent.state = 'failed'; h.fixture.domains.independent.desiredHostname = 'independent-next.example.invalid'; h.fixture.domains.independent.requestId = '11111111-1111-4111-8111-111111111111'; h.fixture.domains.independent.errorCode = 'GATEWAY_DOMAIN_VERIFY_FAILED'; h.fixture.endpoint.needsChannelUpgrade = true; h.fixture.endpoint.channelTarget = 'remote'; h.active.value = false })
  await run(() => { window.gatewayAbuseTest.active.value = true })
  await until(() => document.querySelector('.gateway-domain input[type="password"]'))
  await run(() => document.querySelector('.gateway-domain-change button').click())
  await run(() => document.querySelector('.gateway-domain-change button[type="submit"]').click())
  assert.equal(await page.eval(() => window.gatewayAbuseTest.requests[0].input.requestId), '11111111-1111-4111-8111-111111111111', 'resume a failed persistent intent instead of duplicating it')
  await run(() => window.gatewayAbuseTest.pending[0].reject({ code: 'GATEWAY_DOMAIN_CONFLICT' }))
  assert.ok(await page.eval(() => document.querySelector('.gateway-domain-change [role="alert"]').textContent.includes('已有变化')), 'successful status poll does not erase a rejected action')
  await run(() => window.gatewayAbuseTest.session(2))
  assert.equal(await page.eval(() => document.querySelector('.gateway-domain-change [role="alert"]')), null, 'new administrator context clears old action errors')
  await fill('.gateway-domain form input:not([type="password"])', 'legacy-new.example.invalid')
  await fill('.gateway-domain form input[type="password"]', 'fixture-only-password')
  await run(() => document.querySelector('.gateway-domain button[type="submit"]').click())
  assert.deepEqual(await page.eval(() => window.gatewayAbuseTest.requests[1].input.credentials), { password: 'fixture-only-password' })
  await complete(1)
  assert.equal(await page.eval(() => document.querySelector('.gateway-domain input[type="password"]')?.value), '', 'one-time password clears after use')
  console.log('PASS failed intent reuse, persistent action errors and one-time upgrade of a legacy remote gateway channel')
  for (const code of ['GATEWAY_WEB_SESSION_REQUIRED', 'GATEWAY_TASK_CREDENTIALS_CHANGED']) {
    await fresh('gateways')
    await run(code => {
      const h = window.gatewayAbuseTest
      Object.assign(h.fixture.domains.independent, { state: 'failed', errorCode: code })
      h.active.value = false
    }, code)
    await run(() => { window.gatewayAbuseTest.active.value = true })
    await until(() => document.querySelector('.gateway-domain-change')?.textContent.includes('有效管理员账户'))
    assert.ok(!await page.eval(code => document.querySelector('.gateway-domain-change').textContent.includes(code), code), 'authorization failures explain how to continue without exposing an untranslated code')
  }
  console.log('PASS revoked session and changed credentials show administrator recovery guidance')
  await fresh('gateways')
  await run(() => { window.gatewayAbuseTest.fixture.holdEndpoint = true })
  await until(() => window.gatewayAbuseTest.heldEndpointReads.length === 1)
  await run(() => window.gatewayAbuseTest.session(2))
  await until(() => window.gatewayAbuseTest.heldEndpointReads.length === 2)
  await run(() => { const h = window.gatewayAbuseTest; h.heldEndpointReads[1].resolve(structuredClone(h.fixture.endpoint)) })
  await run(() => { const h = window.gatewayAbuseTest; h.heldEndpointReads[0].resolve(structuredClone(h.fixture.endpoint)) })
  await until(() => window.gatewayAbuseTest.heldEndpointReads.length === 3)
  await sleep(300)
  assert.equal(await page.eval(() => window.gatewayAbuseTest.heldEndpointReads.length), 3, 'old account poll cannot spawn another polling chain')
  console.log('PASS delayed endpoint poll across account change schedules only one successor')
  await fresh()
  await run(() => {
    const h = window.gatewayAbuseTest
    Object.assign(h.fixture.hosts[0], { state: 'unsupported', errorCode: 'HOST_AGENT_DISABLED', queueErrorCode: 'ABUSE_RETRY_TIMEOUT', queueErrorAt: new Date().toISOString() })
    document.querySelectorAll('.abuse-policy form button')[2].click()
    document.querySelector('.abuse-policy summary').click()
  })
  assert.ok(await page.eval(() => document.querySelector('.abuse-policy').textContent.includes('Agent 已停用')))
  assert.ok(await page.eval(() => document.querySelector('.abuse-policy').textContent.includes('最近重试未能安排')))
  assert.ok(await page.eval(() => document.querySelector('.abuse-policy').textContent.includes('本批重试超过处理时限')))
  console.log('PASS persistent batch failure and specific Agent capability guidance')
  for (const [width, theme, locale] of [[1440, 'light', 'zh-CN'], [390, 'dark', 'zh-CN'], [768, 'light', 'zh-TW'], [390, 'light', 'en']]) for (const tab of ['abuse', 'gateways']) {
    await page.setViewport({ width, height: 1100 }); await fresh(tab)
    await run(({ theme, locale, tab }) => { const h = window.gatewayAbuseTest; h.theme.setTheme(theme); h.setLocale(locale); if (tab === 'abuse') document.querySelector('.abuse-policy summary').click(); else document.querySelectorAll('.gateway-domain-change')[1].querySelector('button').click() }, { theme, locale, tab })
    assert.ok(await page.eval(() => [...document.querySelectorAll('.abuse-policy button, .gateway-domain-change button')].every(button => getComputedStyle(button).transitionDuration === '0s')), 'theme changes must not interpolate the policy and domain action colors')
    // The shared page body has its own pre-existing theme transition. These
    // screenshots inspect stable themes; wait for its actual completion, while
    // the feature controls above explicitly prohibit unsafe intermediate colors.
    await page.eval(async () => { await Promise.allSettled(document.body.getAnimations().map(animation => animation.finished)) })
    assert.ok(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), `${tab}/${width}/${locale} overflow`)
    if (tab === 'abuse') assert.ok(await page.eval(() => document.querySelector('.abuse-policy input[type="search"]').getBoundingClientRect().width >= 180), 'search remains usable beside the filter')
    const metrics = await page.eval(probe), findings = judge(metrics, { width }).filter(item => !APP_SKIP.has(item.id))
    writeFileSync(resolve(output, `${tab}-${theme}-${width}-${locale}.json`), JSON.stringify({ metrics, findings }, null, 2))
    assert.deepEqual(findings.filter(item => item.level === 'FAIL' || item.id === 'contrast'), [], `${tab}/${width}/${locale} visual failures or insufficient text contrast`)
    await page.screenshot({ path: resolve(output, `${tab}-${theme}-${width}-${locale}.png`), format: 'png' })
  }
  assert.equal(page.consoleErrors.length, 0, page.consoleErrors.join('\n'))
  console.log('PASS 1440/768/390 light/dark and three languages: no horizontal overflow, contrast inspection and screenshots')
} finally { if (browser) await browser.close(); await server.close() }
