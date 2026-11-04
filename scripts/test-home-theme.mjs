import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Browser, sleep } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'

const root = fileURLToPath(new URL('..', import.meta.url)).replaceAll('\\', '/')
const out = root + '/logs/home-theme'
mkdirSync(out, { recursive: true })
const require = createRequire(new URL('../client/package.json', import.meta.url))
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href)
const { default: vue } = await import(pathToFileURL(require.resolve('@vitejs/plugin-vue')).href)
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js')
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/home-theme/*.js']
const aliases = [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/home-theme/api.js' }]
if (process.argv.includes('--baseline-store')) {
  writeFileSync(out + '/baseline-theme.ts', execFileSync('git', ['show', 'HEAD:client/src/stores/theme.ts'], { cwd: root }))
  aliases.push({ find: /^@\/stores\/theme$/, replacement: out + '/baseline-theme.ts' })
}
const server = await createServer({ cacheDir: root + '/logs/home-theme/vite-cache', configFile: false, root: root + '/scripts/fixtures/home-theme', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [...aliases, { find: '@', replacement: root + '/client/src' }, ...['vue', 'pinia', 'vue-i18n', 'vue-router', '@fontsource-variable/inter', 'flag-icons/css/flag-icons.min.css'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } }, server: { host: '127.0.0.1', port: 19832, strictPort: true, fs: { allow: [root] } } })
let browser
const observations = []
try {
  await server.listen(); browser = await Browser.launch()
  const page = await browser.newPage()
  const run = (fn, arg) => page.eval(fn, arg)
  const wait = async fn => { const end = Date.now() + 10000; while (!await run(fn)) { assert.ok(Date.now() < end, page.consoleErrors.join('\n') + await run(() => document.body.innerText)); await sleep(25) } }
  const os = async value => { await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value }, { name: 'prefers-reduced-motion', value: 'reduce' }] }); await sleep(100) }
  await os('dark')
  await page.goto('http://127.0.0.1:19832', { settleMs: 300 })
  await wait(() => !!window.themeHarness && !!document.querySelector('.home-theme-toggle'))
  for (const [width,height] of [[1948,1024],[1920,720],[1366,768],[1024,576],[768,600],[390,844]]) {
    await page.setViewport({width,height,mobile:width<768}); await sleep(150)
    const layout=await run(()=>{const r=document.querySelector('.home-footer').getBoundingClientRect(); return {bottom:r.bottom,scrollWidth:document.documentElement.scrollWidth,height:innerHeight,width:innerWidth}})
    assert.equal(layout.scrollWidth,layout.width)
    if(width>=768)assert.ok(layout.bottom<=height+2,JSON.stringify(layout))
    else {await run(()=>window.scrollTo(0,document.documentElement.scrollHeight));assert.ok(await run(()=>document.querySelector('.home-footer').getBoundingClientRect().bottom<=innerHeight+2));await run(()=>window.scrollTo(0,0))}
    observations.push({width,height,...layout})
    await page.screenshot({path:out+`/fit-${width}x${height}.png`,format:'png',fullPage:true})
  }
  for (const zoom of [1.25, 1.5]) {
    // Browser page zoom reduces the CSS viewport; device scale alone does not.
    const width = Math.round(1948 / zoom), height = Math.round(1024 / zoom)
    await page.setViewport({ width, height, dsf: zoom }); await sleep(180)
    assert.ok(await run(() => document.querySelector('.home-footer').getBoundingClientRect().bottom <= innerHeight + 2))
    observations.push({ zoom, width, height, scope: 'CSS viewport and device scale equivalent to desktop page zoom' })
  }
  await run(() => { window.themeHarness.config.brandName = 'OCI 示例品牌'; window.themeHarness.config.brandSubtitle = '管理员配置的网站副标题 · 基于云资源的实例服务' })
  await sleep(180)
  assert.ok(await run(() => document.querySelector('.home-footer').getBoundingClientRect().bottom <= innerHeight + 2))
  await run(() => window.themeHarness.router.push('/purchase')); await wait(() => !!document.querySelector('.purchase-page'))
  await sleep(500)
  assert.equal(await run(() => document.title), 'OCI 示例品牌 - 管理员配置的网站副标题 · 基于云资源的实例服务')
  await run(() => { window.themeHarness.config.brandSubtitle = '已保存的新副标题' }); await sleep(100)
  assert.equal(await run(() => document.title), 'OCI 示例品牌 - 已保存的新副标题')
  await run(() => window.themeHarness.router.push('/')); await wait(() => !!document.querySelector('.home-theme-toggle'))
  await run(() => window.themeHarness.router.push('/purchase')); await sleep(500)
  assert.equal(await run(() => document.title), 'OCI 示例品牌 - 已保存的新副标题', 'old home SEO cleanup cannot restore obsolete title')
  await run(() => { window.themeHarness.config.brandName = 'PayIncus'; window.themeHarness.config.brandSubtitle = ''; return window.themeHarness.router.push('/') }); await wait(() => !!document.querySelector('.home-theme-toggle'))
  console.log('PASS actual App home/purchase transitions, reactive brand subtitle, SEO cleanup and zoom-equivalent viewport')
  await page.setViewport({width:1440,height:900})
  const state = () => run(() => ({ mode: window.themeHarness.theme.mode, resolved: window.themeHarness.theme.resolvedTheme,
    classDark: document.documentElement.classList.contains('dark'), home: document.querySelector('.homepage-map-demo')?.dataset.homeTheme,
    map: document.querySelector('.world-outline')?.getAttribute('href'), meta: document.querySelector('meta[name="theme-color"]').content,
    label: document.querySelector('.home-theme-toggle')?.title }))
  assert.equal((await state()).mode, 'system')
  assert.equal((await state()).home, 'dark')
  await os('light')
  const switched = await state(); observations.push(switched)
  assert.equal(switched.resolved, 'light', 'system change invalidates the cached resolvedTheme')
  assert.equal(switched.home, 'light'); assert.equal(switched.classDark, false); assert.equal(switched.meta, '#ffffff')
  assert.equal(switched.map, '/maps/home-world-light.svg')
  await os('dark')
  assert.equal((await state()).home, 'dark'); assert.equal((await state()).map, '/maps/home-world.svg')
  console.log('PASS real OS media-query changes update shared store, homepage palette, desktop map and theme-color')

  // Same click sequence and persisted preference as the other public header.
  const clickHome = () => run(() => document.querySelector('.home-theme-toggle').click())
  for (const mode of ['dark', 'light', 'system']) { await clickHome(); assert.equal((await state()).mode, mode) }
  await run(() => { window.themeHarness.theme.setTheme('light'); return window.themeHarness.router.push('/other') })
  await wait(() => !!document.querySelector('.public-header-icon'))
  await run(() => document.querySelector('button[aria-label="切换主题"]').click())
  assert.equal(await run(() => window.themeHarness.theme.mode), 'system')
  await run(() => window.themeHarness.router.push('/'))
  await wait(() => !!document.querySelector('.home-theme-toggle'))
  assert.equal((await state()).mode, 'system'); assert.equal((await state()).home, 'dark')
  await run(() => window.themeHarness.theme.setTheme('light'))
  await os('dark'); assert.equal((await state()).home, 'light', 'explicit light ignores system dark')
  await run(() => window.themeHarness.theme.setTheme('dark'))
  await os('light'); assert.equal((await state()).home, 'dark', 'explicit dark ignores system light')
  await run(() => window.themeHarness.theme.setTheme('system'))
  assert.equal((await state()).home, 'light', 'return to system uses its current preference')
  // Obsolete home-only preference must not override the shared choice.
  await run(() => { window.themeHarness.theme.setTheme('dark'); localStorage.setItem('homepage-theme', 'light') })
  await page.goto('http://127.0.0.1:19832', { settleMs: 300 }); await wait(() => !!window.themeHarness && !!document.querySelector('.home-theme-toggle'))
  assert.equal((await state()).home, 'dark'); assert.equal(await run(() => localStorage.getItem('theme')), 'dark')
  await run(() => { window.themeHarness.theme.init(); window.themeHarness.theme.init() })
  assert.equal(await run(() => window.themeHarness.listeners.size), 1, 'repeated init registers one system listener')
  console.log('PASS shared public header and home cycle, explicit mode isolation, persisted reload and idempotent init')

  for (const width of [1440, 768, 390]) for (const locale of ['zh-CN', 'zh-TW', 'en']) {
    await page.setViewport({ width, height: 900 }); await run(locale => window.themeHarness.setLocale(locale), locale)
    for (const scheme of ['light', 'dark']) {
      await os(scheme); await run(() => window.themeHarness.theme.setTheme('system')); await sleep(150)
      const result = await state()
      assert.equal(result.home, scheme); assert.equal(result.classDark, scheme === 'dark')
      const button = await run(() => { const b = document.querySelector('.home-theme-toggle'), r = b.getBoundingClientRect(); return { width: r.width, height: r.height, title: b.title, label: b.getAttribute('aria-label'), icon: !!b.querySelector('.lucide-monitor-icon') } })
      assert.ok(button.width >= 44 && button.height >= 44)
      assert.equal(button.title, { 'zh-CN': '跟随系统', 'zh-TW': '跟隨系統', en: 'System' }[locale]); assert.equal(button.icon, true)
      assert.equal(await run(() => document.documentElement.scrollWidth > innerWidth), false)
      observations.push({ width, locale, scheme, ...button })
      if (locale === 'zh-CN') await page.screenshot({ path: `${out}/${width}-${scheme}.png`, format: 'png', fullPage: true })
    }
  }
  await run(() => window.themeHarness.dispose())
  assert.equal(await run(() => window.themeHarness.listeners.size), 0, 'store disposal removes the system listener')
  writeFileSync(out + '/verified.json', JSON.stringify({ verifiedAt: new Date().toISOString(), scope: 'actual local Vue and browser matchMedia; static catalog, no production calls', observations }, null, 2))
  console.log('PASS three locales/widths, light/dark system changes, monitor icon/labels, 44px touch targets, six screenshots and listener disposal')
} finally { if (browser) await browser.close(); await server.close() }
