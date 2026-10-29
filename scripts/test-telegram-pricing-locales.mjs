import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { Browser, sleep } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'
import { probe, app as probeApp } from '../.agents/skills/design-taste-frontend/scripts/lib/probe.mjs'
import { judge, judgeApp, APP_SKIP } from '../.agents/skills/design-taste-frontend/scripts/lib/rules.mjs'

const root = fileURLToPath(new URL('..', import.meta.url)).replaceAll('\\', '/')
const require = createRequire(new URL('../client/package.json', import.meta.url))
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href)
const { default: vue } = await import(pathToFileURL(require.resolve('@vitejs/plugin-vue')).href)
const output = resolve(root, 'logs/telegram-pricing-locales')
mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const hostname = ['a'.repeat(63), 'b'.repeat(63), 'c'.repeat(63), 'example', 'test'].join('.')
const servers = []
let browser
try {
  for (const [fixture, port] of [['telegram-config', 19725], ['system-settings', 19726]]) {
    const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js')
    tailwind.content = [root + '/client/src/**/*.{vue,ts,js}', root + '/scripts/fixtures/' + fixture + '/*.js']
    const server = await createServer({ configFile: false, cacheDir: resolve(output, fixture + '-cache'), root: root + '/scripts/fixtures/' + fixture,
      publicDir: root + '/client/public', plugins: [vue()],
      resolve: { alias: [{ find: /^@\/api(?:\/admin)?$/, replacement: root + '/scripts/fixtures/' + fixture + '/api.js' }, { find: '@', replacement: root + '/client/src' },
        ...['vue', 'pinia', 'vue-router', 'vue-i18n'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-router', 'vue-i18n'] },
      css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
      server: { host: '127.0.0.1', port, strictPort: true, allowedHosts: [hostname], fs: { allow: [root] } },
    })
    servers.push(server); await server.listen()
  }
  browser = await Browser.launch({ extraArgs: [`--host-resolver-rules=MAP ${hostname} 127.0.0.1`, '--no-proxy-server'] })
  const telegram = await browser.newPage({ reducedMotion: true }), pricing = await browser.newPage({ reducedMotion: true })
  const ready = async (page, name) => {
    const deadline = Date.now() + 20000
    while (!await page.eval(name => !!window[name]?.view(), name)) {
      if (Date.now() > deadline) throw Error(name + ' did not mount: ' + page.consoleErrors.join('\n'))
      await sleep(100)
    }
  }
  await telegram.goto(`http://${hostname}:19725`, { settleMs: 1400 }); await ready(telegram, 'telegramHarness')
  await telegram.eval(() => {
    const h = window.telegramHarness, group = { enabled: false, configured: false, joinMode: 'any', minRecharge: 0, minConsume: 0 }
    for (const item of h.pending) {
      if (item.kind === 'configs') item.resolve({ configs: [] })
      if (item.kind === 'channels') item.resolve({ channels: [] })
      if (item.kind === 'bindings') item.resolve({ bindings: [], total: 0, page: 1, pageSize: 5, group, vipGroup: group })
    }
    h.view().telegramWebhookInfo = { url: location.origin + '/api/telegram/webhook?' + 'delivery=' + 'x'.repeat(300), pending_update_count: 0, max_connections: 40, allowed_updates: ['message', 'callback_query'] }
  })
  await pricing.goto('http://127.0.0.1:19726', { settleMs: 1400 }); await ready(pricing, 'settingsHarness')
  await pricing.eval(() => {
    const h = window.settingsHarness, seed = Object.entries(h.view().form).map(([key, value], id) => ({ id: id + 1, key, value: typeof value === 'object' ? JSON.stringify(value) : String(value), type: typeof value, label: null, description: null }))
    for (const item of h.pending) if (item.kind === 'list') item.resolve({ configs: seed })
  })
  await sleep(250)
  const webhook = `http://${hostname}:19725/api/telegram/webhook`
  const findings = []
  for (const locale of ['zh-CN', 'zh-TW', 'en']) {
    for (const [page, name] of [[telegram, 'telegramHarness'], [pricing, 'settingsHarness']]) {
      const pendingBefore = await page.eval(name => window[name].pending.length, name)
      await page.eval(({ name, locale }) => window[name].setLocale(locale), { name, locale }); await sleep(100)
      assert.equal(await page.eval(name => window[name].pending.length, name), pendingBefore, 'language switch does not submit or refetch settings')
    }
    assert.equal(await telegram.eval(() => window.telegramHarness.view().telegramWebhookUrl), webhook, 'actual public URL uses the current frontend origin')
    const telegramText = await telegram.eval(() => document.body.innerText)
    const expectedTitle = { 'zh-CN': 'Telegram 设置', 'zh-TW': 'Telegram 設定', en: 'Telegram Settings' }[locale]
    assert.equal(await telegram.eval(() => document.querySelector('h1').textContent.trim()), expectedTitle)
    for (const key of ['telegramConfig.webhook.address', 'telegramConfig.webhook.currentAddress', 'telegramConfig.bot.username', 'telegramConfig.group.inviteExpiry']) {
      const translated = await telegram.eval(key => window.telegramHarness.t(key), key)
      assert.notEqual(translated, key); assert.ok(telegramText.includes(translated.trim()), key + ' appears translated')
    }
    const pricingKeys = ['title', 'description', 'balance', 'points', 'balanceHint', 'pointsHint', 'priceYuan', 'pricePoints', 'expiry', 'expiryHint']
    const pricingText = await pricing.eval(() => [...document.querySelectorAll('h3')].find(x => x.textContent === window.settingsHarness.t('admin.system.invitePricing.title')).closest('.card').innerText)
    for (const part of pricingKeys) {
      const key = 'admin.system.invitePricing.' + part, translated = await pricing.eval(key => window.settingsHarness.t(key), key)
      assert.notEqual(translated, key); assert.ok(pricingText.includes(translated.trim()), key + ' appears translated')
    }
    assert.ok(!telegramText.includes('telegramConfig.') && !pricingText.includes('admin.system.invitePricing.'), 'no raw i18n keys')
    if (locale === 'en') { assert.ok(!/[\u4e00-\u9fff]/.test(telegramText), 'English Telegram UI has no Chinese copy'); assert.ok(!/[\u4e00-\u9fff]/.test(pricingText), 'English settings UI has no Chinese copy') }
    const toggles = await pricing.eval(() => ['balance', 'points'].map(resource => {
      const h = window.settingsHarness, key = 'admin.system.invitePricing.' + resource
      const button = document.querySelector('button[role="switch"][aria-label="' + h.t(key) + '"]')
      const input = button.closest('.rounded-lg').querySelector('input[type="number"]')
      return { label: button.getAttribute('aria-label'), checked: button.getAttribute('aria-checked'), step: input.step, min: input.min, value: input.value }
    }))
    assert.deepEqual(toggles.map(x => [x.checked, x.step, x.min, x.value]), [['false', '0.01', '0', '0'], ['false', '1', '0', '0']], 'pricing limits and zero values survive language switches')
    for (const width of [1440, 768, 390]) {
      for (const [page, name, screen] of [[telegram, 'telegramHarness', 'telegram'], [pricing, 'settingsHarness', 'pricing']]) {
        await page.setViewport({ width, height: 1000, mobile: width === 390 })
        await page.eval(name => window[name].theme.setTheme(innerWidth === 390 ? 'dark' : 'light'), name)
        await sleep(150)
        if (screen === 'telegram') {
          const fit = await page.eval(() => {
            const code = [...document.querySelectorAll('code')].find(x => x.textContent === window.telegramHarness.view().telegramWebhookUrl)
            const current = [...document.querySelectorAll('span')].find(x => x.textContent === window.telegramHarness.view().telegramWebhookInfo.url)
            code.scrollIntoView({ block: 'center' })
            const range = document.createRange(); range.selectNodeContents(code)
            const currentRange = document.createRange(); currentRange.selectNodeContents(current)
            return { text: code.textContent, current: current.textContent, lines: range.getClientRects().length, currentLines: currentRange.getClientRects().length,
              codeFits: code.scrollWidth <= code.clientWidth, rectFits: currentRange.getBoundingClientRect().right <= innerWidth, pageFits: document.documentElement.scrollWidth <= innerWidth }
          })
          assert.equal(fit.text, webhook); assert.ok(fit.current.endsWith('x'.repeat(300))); assert.ok(fit.codeFits && fit.rectFits && fit.pageFits, 'complete configured/current URLs fit the viewport')
          if (width === 390) assert.ok(fit.lines > 1 && fit.currentLines > 1, 'long configured/current URLs wrap on a phone')
        } else await page.eval(() => [...document.querySelectorAll('h3')].find(x => x.textContent === window.settingsHarness.t('admin.system.invitePricing.title')).scrollIntoView({ block: 'center' }))
        assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true, screen + ' fits at ' + width)
        await page.screenshot({ path: resolve(output, `${screen}-${locale}-${width}.png`), format: 'png' })
        const metrics = await page.eval(probe), appMetrics = await page.eval(probeApp)
        const measured = [...judge(metrics, { width }).filter(x => !APP_SKIP.has(x.id)), ...judgeApp(appMetrics, metrics, { width })]
        findings.push({ screen, locale, width, findings: measured })
      }
    }
  }
  assert.equal(await pricing.eval(() => window.settingsHarness.pending.filter(x => x.kind !== 'list').length), 0, 'no configuration or mail writes')
  assert.equal(await telegram.eval(() => window.telegramHarness.pending.some(x => !['configs', 'channels', 'bindings'].includes(x.kind))), false, 'no external Telegram or channel writes')
  assert.equal(telegram.consoleErrors.length, 0, telegram.consoleErrors.join('\n')); assert.equal(pricing.consoleErrors.length, 0, pricing.consoleErrors.join('\n'))
  writeFileSync(resolve(output, 'measurements.json'), JSON.stringify(findings, null, 2))
  console.log('PASS actual Telegram/pricing UI: three locales, real long local frontend hostname/public URL, complete configured/current address wrapping at 1440/768/390, stable pricing limits/zero, no raw keys or writes')
  console.log('Taste measurements: ' + resolve(output, 'measurements.json'))
} finally { if (browser) await browser.close(); for (const server of servers) await server.close() }
