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
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/package-form/*.js']
const output = resolve(root, 'logs/package-priorities')
mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const server = await createServer({ configFile: false, root: root + '/scripts/fixtures/package-form',
  plugins: [vue()], resolve: { alias: [
    { find: /^@\/api$/, replacement: root + '/scripts/fixtures/package-form/api.js' },
    { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) })),
  ], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19644, strictPort: true, fs: { allow: [root] } },
})
let browser
try {
  await server.listen(); browser = await Browser.launch()
  const page = await browser.newPage({ reducedMotion: true })
  await page.goto('http://127.0.0.1:19644', { settleMs: 1200 })
  const run = async (fn, arg) => { const result = await page.eval(fn, arg); await sleep(35); return result }
  const check = async (fn, label) => {
    for (let i = 0; i < 100; i++) { if (await page.eval(fn)) return; await sleep(50) }
    assert.fail(label + ': ' + await page.eval(() => document.body.innerText))
  }
  const latest = async kind => page.eval(kind => window.packageHarness.pending.findLastIndex(item => item.kind === kind), kind)
  const resolveRequest = async (index, data) => run(({ index, data }) => window.packageHarness.pending[index].resolve(data), { index, data })
  const rejectRequest = async index => run(index => window.packageHarness.pending[index].reject(new Error('isolated failure')), index)
  const routeTo = async path => run(path => window.packageHarness.router.push(path), path)
  const record = (id, name = `Package ${id}`, hostIds = []) => ({ package: { id, name, description: `Description ${id}`, host_ids: hostIds, ownerId: 1, active: true, instance_type: 'container' } })
  const name = () => page.eval(() => document.querySelector('form input[required]')?.value)
  const click = async selector => {
    const point = await page.eval(selector => { const el = document.querySelector(selector); el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } }, selector)
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 })
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 }); await sleep(50)
  }
  await check(()=>!!window.packageHarness?.view(),'actual package setup available')
  const fields=[['limits_cpu_priority','limitsCpuPriority',10],['boot_autostart_priority','bootAutostartPriority',20]]
  const load=async(id,extra)=>{if(id!==1)await routeTo('/resources/packages/'+id+'/edit');await resolveRequest(await latest('get'),{package:{...record(id).package,host_ids:[10],network_mode:'public_ipv4',...extra}});await resolveRequest(await latest('pools'),{pools:[{name:'system',driver:'dir',purpose:'instance_data',status:'Created',description:''}]})}
  await load(1,{limits_cpu_priority:0,boot_autostart_priority:0})
  for(const[,key]of fields)assert.equal(await page.eval(key=>window.packageHarness.view().form[key],key),0,'loaded '+key+' keeps legal zero')
  await run(()=>{const v=window.packageHarness.view();void v.savePackage()});let write=await latest('update');for(const[,key]of fields)assert.equal(await page.eval(({write,key})=>window.packageHarness.pending[write].data[key],{write,key}),0,'submitted '+key+' keeps legal zero');await rejectRequest(write)
  for(const [id,extra]of [[2,{limits_cpu_priority:'0',boot_autostart_priority:'0'}],[3,{limits_cpu_priority:null,boot_autostart_priority:null}],[4,{}]]){await load(id,extra);for(const[raw,key,fallback]of fields)assert.equal(await page.eval(key=>window.packageHarness.view().form[key],key),extra[raw]==='0'?0:fallback)}
  for(const[key,max]of [['limitsCpuPriority',10],['bootAutostartPriority',100]])for(const value of [0,max]){await run(({key,value})=>{const v=window.packageHarness.view();v.form[key]=value;void v.savePackage()},{key,value});write=await latest('update');assert.equal(await page.eval(({write,key})=>window.packageHarness.pending[write].data[key],{write,key}),value);await rejectRequest(write)}
  for(const[key,value]of [['limitsCpuPriority',-1],['limitsCpuPriority',11],['limitsCpuPriority',0.5],['limitsCpuPriority',''],['limitsCpuPriority','abc'],['bootAutostartPriority',-1],['bootAutostartPriority',101],['bootAutostartPriority',0.5],['bootAutostartPriority',''],['bootAutostartPriority','abc']]){const before=await page.eval(()=>window.packageHarness.pending.filter(x=>x.kind==='update').length);await run(({key,value})=>{const v=window.packageHarness.view();v.form.limitsCpuPriority=10;v.form.bootAutostartPriority=20;v.form[key]=value;void v.savePackage()},{key,value});assert.equal(await page.eval(()=>window.packageHarness.pending.filter(x=>x.kind==='update').length),before);assert.ok(await page.eval(()=>window.packageHarness.view().formError))}
  for(const[locale,width,dark]of[['zh-CN',1440,false],['zh-TW',768,false],['en',390,true]]){await run(({locale,dark})=>{const h=window.packageHarness;h.setLocale(locale);h.theme.setTheme(dark?'dark':'light');h.view().form.limitsCpuPriority=0;h.view().form.bootAutostartPriority=0},{locale,dark});await page.setViewport({width,height:1000,mobile:width===390});await run(()=>document.querySelector('input[max="10"]').scrollIntoView({block:'center'}));await sleep(180);assert.equal(await page.eval(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:resolve(output,locale+'-'+width+'.png'),format:'png'})}
  assert.equal(page.consoleErrors.length,0,page.consoleErrors.join('\n'));console.log('PASS actual package priorities preserve loaded/submitted numeric and string zero, null/absent defaults, legal boundaries and invalid inputs')
}finally{if(browser)await browser.close();await server.close()}
