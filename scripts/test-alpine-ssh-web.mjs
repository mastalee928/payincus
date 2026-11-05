import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { Browser, sleep } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'
const root = process.cwd().replaceAll('\\', '/'), require = createRequire(root + '/client/package.json')
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href)
const { default: vue } = await import(pathToFileURL(require.resolve('@vitejs/plugin-vue')).href)
const output = root + '/logs/alpine-ssh-web'; mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const tailwind = require('tailwindcss/loadConfig')(root + '/client/tailwind.config.js'); tailwind.content = [root + '/client/src/**/*.{vue,js,ts}']
const server = await createServer({ configFile: false, root: root + '/scripts/fixtures/instance-detail', publicDir: root + '/client/public', cacheDir: output + '/cache',
  plugins: [{ name: 'alpine-security-isolated-fixture', enforce: 'pre', transform(source, id) {
    if (id.endsWith('/fixtures/instance-detail/main.js')) return source.replaceAll("name: 'instance-detail'", "name: 'admin-instance-detail'").replaceAll("role: 'user'", "role: 'admin'")
    if (id.endsWith('/fixtures/instance-detail/api.js')) return source.replaceAll("role: 'user'", "role: 'admin'").replace('get: id =>', "maintainSshSecurity: id => defer('ssh-security', id), get: id =>")
  } }, vue()],
  resolve: { alias: [{ find: /^@\/api$/, replacement: root + '/scripts/fixtures/instance-detail/api.js' }, { find: /^@\/utils\/app-paths$/, replacement: root + '/client/src/utils/app-paths-admin.ts' }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } }, server: { host: '127.0.0.1', port: 19766, strictPort: true, fs: { allow: [root] } }
})
let browser
try {
  await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19766', { settleMs: 1800 })
  const wait = async (fn, label) => { const end = Date.now()+15000; while (!await page.eval(fn)) { if(Date.now()>end)throw Error(label+page.consoleErrors.join('\n')); await sleep(60) } }
  await wait(() => !!window.detailHarness?.pending.length, 'fixture starts')
  await page.eval(() => { const h=window.detailHarness; h.pending.find(x=>x.kind==='instance').resolve({instance:{id:1,name:'Isolated Alpine 3.22',incus_id:'test',host_id:10,user_id:1,status:'running',image:'alpine/3.22',cpu:100,memory:512,disk:2048,ipv4:'192.0.2.10',dedicatedIpv4:true,dedicatedNetworkReady:true,portLimit:5,snapshotLimit:5,host:{name:'Isolated host',user_id:1}}}) })
  await wait(() => window.detailHarness.pending.some(x=>x.kind==='task'), 'task starts')
  await page.eval(() => window.detailHarness.pending.find(x=>x.kind==='task').resolve({task:null}))
  await wait(() => window.detailHarness.pending.some(x=>x.kind==='stats'), 'stats starts')
  await page.eval(() => {for(const p of window.detailHarness.pending){if(p.kind==='stats')p.resolve({stats:null});if(p.kind==='traffic')p.resolve(null)}})
  await wait(() => [...document.querySelectorAll('button')].some(x=>x.textContent.trim()==='SSH 安全维护'&&!x.disabled), 'security button ready')
  for (const [width,height,locale,theme] of [[1440,900,'zh-CN','light'],[768,1024,'en','dark'],[390,844,'zh-TW','light']]) {
    await page.setViewport({width,height,mobile:width<500}); await page.eval(({locale,theme})=>{window.detailHarness.setLocale(locale);window.detailHarness.theme.setTheme(theme)}, {locale,theme}); await sleep(100)
    const metrics = await page.eval(()=>{const b=[...document.querySelectorAll('button')].find(x=>/SSH.*(安全|Security)/.test(x.textContent));return {height:b.getBoundingClientRect().height,visible:b.checkVisibility(),overflow:document.documentElement.scrollWidth>innerWidth}})
    assert.ok(metrics.height>=44&&metrics.visible&&!metrics.overflow,JSON.stringify(metrics))
    await page.screenshot({path:output+`/${width}-${locale}-${theme}.png`,format:'png',fullPage:false})
  }
  await page.eval(()=>window.detailHarness.setLocale('zh-CN'))
  await page.eval(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='SSH 安全维护');b.click();b.click()})
  await wait(()=>window.detailHarness.pending.some(x=>x.kind==='ssh-security'),'maintenance starts')
  assert.equal(await page.eval(()=>window.detailHarness.pending.filter(x=>x.kind==='ssh-security').length),1)
  await page.eval(()=>window.detailHarness.pending.find(x=>x.kind==='ssh-security').resolve({instanceId:1,status:'already-fixed'}))
  await wait(()=>window.detailHarness.toastEvents.some(x=>x.type==='success'),'success shown')
  await page.eval(()=>[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='SSH 安全维护').click())
  await wait(()=>window.detailHarness.pending.filter(x=>x.kind==='ssh-security').length===2,'second starts')
  const previous=await page.eval(()=>window.detailHarness.toastEvents.length)
  await page.eval(()=>{window.detailHarness.session('replacement');window.detailHarness.pending.findLast(x=>x.kind==='ssh-security').reject(Error('late original session failure'))})
  await sleep(120); assert.equal(await page.eval(()=>window.detailHarness.toastEvents.length),previous)
  assert.equal(page.consoleErrors.length,0,page.consoleErrors.join('\n'))
  console.log('PASS Chrome actual admin instance detail: three widths/locales/themes, 44px visible target/no overflow, duplicate click suppression, result and obsolete session ignored')
} finally { if(browser)await browser.close();await server.close() }
