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
tailwind.content = [root + '/client/src/**/*.{vue,js,ts}', root + '/scripts/fixtures/host-ip-change/*.js']
const output = resolve(root, 'logs/host-ip-browser'); mkdirSync(output, { recursive: true }); process.env.TASTE_SKILL_TMP = output
const server = await createServer({ configFile: false, root: root + '/scripts/fixtures/host-ip-change', publicDir: root + '/client/public', plugins: [vue()],
  resolve: { alias: [{ find: /^@\/api(?:\/admin)?$/, replacement: root + '/scripts/fixtures/host-ip-change/api.js' }, { find: '@fontsource-variable/inter', replacement: require.resolve('@fontsource-variable/inter') }, { find: '@fontsource-variable/jetbrains-mono', replacement: require.resolve('@fontsource-variable/jetbrains-mono') }, { find: '@', replacement: root + '/client/src' },
    ...['vue', 'pinia', 'vue-i18n', 'vue-router'].map(name => ({ find: name, replacement: require.resolve(name === 'vue' ? 'vue/dist/vue.esm-bundler.js' : name) }))], dedupe: ['vue', 'pinia', 'vue-i18n', 'vue-router'] },
  css: { postcss: { plugins: [require('tailwindcss')(tailwind), require('autoprefixer')()] } },
  server: { host: '127.0.0.1', port: 19665, strictPort: true, fs: { allow: [root] } },
})
let browser
const report = (ip = '1.1.1.2') => ({ hostId: 11, supported: true, currentIp: ip, confirmedIp: '8.8.8.1', observedIp: ip, currentBindIp: '10.0.0.13', blocked: true, settings: { mode: 'auto', publicIp: null, bindIp: null, sshPort: 22 }, status: 'pending', candidateIp: ip, candidateBindIp: '10.0.0.13', bindAddresses: ['10.0.0.13'], checkedAt: '2026-11-04T10:00:00Z', nextCheckAt: '2026-11-04T10:01:00Z', error: 'IP_INSTANCE_STOPPED' })
const host = (ip = '1.1.1.2') => ({ id: 11, name: 'OCI us-ashburn', countryCode: 'us', status: 'online', stock: 'assigned', architecture: 'x86_64', isInstalled: true, url: 'https://10.253.240.2:8443', location: 'OCI', publicIp: ip, managementAddress: '10.253.240.2', singleTenant: true, resourcePreset: 'E2', cpuAllowanceMax: 200, memoryMax: 768, customerDiskGiB: 30, storageSize: 34, resources:{diskTotal:34816}, instanceCount: 1, agentLastSeenAt: new Date().toISOString(), portProtocol: { requested: 'tcp', applied: 'tcp', status: 'applied' }, publicIpSync: report(ip), natConfig: { publicIp: '8.8.8.1', publicIpSync: report(ip), portRangeStart: 1, portRangeEnd: 65535 } })
try {
 await server.listen(); browser = await Browser.launch(); const page = await browser.newPage({ reducedMotion: true })
 const run = async (fn, arg) => { const value = await page.eval(fn, arg); await sleep(80); return value }
 await page.goto('http://127.0.0.1:19665/', { settleMs: 600 })
 await run(h => { const w = ipHarness; w.state.hosts = [h]; w.view().loadHosts() }, host())
 assert.ok(await page.eval(() => document.querySelector('[data-node-current-ip]').textContent.includes('1.1.1.2')))
 await run(h => { ipHarness.state.hosts = [h]; ipHarness.tick(15000) }, host('1.1.1.3'))
 assert.ok(await page.eval(() => document.querySelector('[data-node-current-ip]').textContent.includes('1.1.1.3')), 'list automatic refresh follows observed IP')
 await run(() => { ipHarness.state.paused = true; ipHarness.tick(15000) })
 const obsolete = await page.eval(() => ipHarness.pending.length - 1)
 await run(() => { ipHarness.session('other'); ipHarness.session('ip-test') })
 await run(({ index, h }) => ipHarness.pending[index].resolve({ hosts: [h], total: 1 }), { index: obsolete, h: host('1.1.1.9') })
 assert.equal(await page.eval(() => document.body.textContent.includes('1.1.1.9')), false, 'session ABA cannot publish stale IP')
 await run(() => { ipHarness.state.paused = false; ipHarness.screen.value = 'detail' })
 assert.ok(await page.eval(() => document.querySelector('[data-node-current-ip]').textContent.includes('1.1.1.3')))
 await run(h => { ipHarness.state.hosts = [h]; ipHarness.tick(15000) }, host('1.1.1.4'))
 assert.ok(await page.eval(() => document.querySelector('[data-node-current-ip]').textContent.includes('1.1.1.4')))
 await run(() => { ipHarness.view().activeTab = 'config' })
 const readsBefore = await page.eval(() => ipHarness.pending.length)
 await run(() => { ipHarness.state.paused = true; ipHarness.tick(15000) })
 assert.equal(await page.eval(() => ipHarness.pending.length), readsBefore, 'detail polling does not reload the editable configuration')
 await run(() => { ipHarness.state.paused = false; ipHarness.screen.value = 'pool'; ipHarness.state.batches = [{ id: 'batch-ip', name: 'OCI test batch', accountLabel: 'isolated test', defaults: {}, nodes: [{ id: 'node-ip', name: 'OCI us-ashburn', hostId: 11, publicIp: '8.8.8.1', currentPublicIp: '1.1.1.4', managementIp: '10.253.240.2', status: 'succeeded', step: 'done', attempt: 1 }] }] })
 await run(() => ipHarness.view().activeTab = 'tasks')
 assert.ok(await page.eval(() => document.querySelector('[data-onboarding-current-ip]').textContent.includes('1.1.1.4')))
 assert.ok(await page.eval(() => document.body.textContent.includes(ipHarness.t('hostIpSync.original'))))
 await run(() => { ipHarness.view().activeTab = 'hosts' })
 assert.ok(await page.eval(() => !!document.querySelector('[data-host-public-ip-status]')), 'compact pool shows exact IPv4 pending status')
 for (const screen of ['list','detail','pool','network']) {
  await run(screen => ipHarness.screen.value = screen, screen)
  for (const locale of ['zh-CN','zh-TW','en']) for (const width of [390,768,1440]) {
   await run(({ locale,width }) => { ipHarness.setLocale(locale);ipHarness.theme.setTheme(width === 390 ? 'dark' : 'light') }, { locale,width })
   await page.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width === 390 })
   assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth),true, screen + ' horizontal overflow')
   await page.screenshot({ path: resolve(output, `${screen}-${locale}-${width}.png`) })
  }
 }
 assert.equal(await page.eval(() => [...document.querySelectorAll('button')].some(b => b.checkVisibility() && b.textContent.includes('1.1.1.2'))), false, 'unverified customer address has no copy button')
 await run(() => ipHarness.session('customer',2,'user'))
 for (const screen of ['list','detail','network']) {
  await run(screen=>ipHarness.screen.value=screen,screen)
  for(const locale of ['zh-CN','zh-TW','en']) {
   await run(locale=>ipHarness.setLocale(locale),locale)
   assert.equal(await page.eval(()=>document.body.textContent.includes(ipHarness.t('hostIpSync.customerStopped')) || document.body.textContent.includes(ipHarness.t('hostIpSync.customerUpdating')) || document.body.textContent.includes(ipHarness.t('hostIpSync.errors.IP_INSTANCE_STOPPED'))),false,'customer has no verification explanation')
  }
 }
 await run(()=>{ipHarness.screen.value='network';ipHarness.setLocale('zh-CN')})
 assert.ok(await page.eval(()=>document.querySelector('[data-customer-observed-ip]').textContent.includes('1.1.1.2')),'customer sees new IP in the existing public IPv4 field')
 assert.equal(await page.eval(()=>document.body.textContent.includes('8.8.8.1')),false,'customer cannot see the obsolete connection address')
 for(const width of [390,768,1440]) {
  await page.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===390})
  await run(width=>ipHarness.theme.setTheme(width===390?'dark':'light'),width)
  await page.screenshot({path:resolve(output,`customer-network-zh-CN-${width}.png`)})
 }
 await run(()=>{ipHarness.instance.value={...ipHarness.instance.value,publicIpUpdating:false,natPublicIp:'1.1.1.2',ipv4:'1.1.1.2'}})
 assert.ok(await page.eval(()=>[...document.querySelectorAll('code')].some(el=>el.textContent==='1.1.1.2' && !!el.parentElement.querySelector('button'))),'confirmed new IP restores the existing copy control')
 await run(()=>{ipHarness.instance.value={...ipHarness.instance.value,publicIpUpdating:true,natPublicIp:null,ipv4:null}})
 await run(()=>ipHarness.session())
 await run(() => { ipHarness.screen.value = 'list';ipHarness.setLocale('zh-CN');ipHarness.modal.value = true })
 await run(() => { const v = [...document.querySelectorAll('select')].find(el => el.closest('form[role="dialog"]'));v.value = 'manual';v.dispatchEvent(new Event('change',{bubbles:true})) })
 await run(() => { const input=document.querySelector('form[role="dialog"] input[placeholder="IPv4"]');input.value='9.9.9.9';input.dispatchEvent(new Event('input',{bubbles:true}));ipHarness.tick(10000) })
 assert.equal(await page.eval(() => document.querySelector('form[role="dialog"] input[placeholder="IPv4"]').value),'9.9.9.9','report refresh preserves edited manual input')
 await run(() => { ipHarness.state.paused = true;ipHarness.tick(10000);ipHarness.modal.value = false })
 const late = await page.eval(() => ipHarness.pending.length - 1)
 await run(() => { ipHarness.modal.value = true })
 await run(({ index,result }) => ipHarness.pending[index].resolve(result), { index:late,result:report('1.1.1.9') })
 assert.equal(await page.eval(() => document.querySelector('form[role="dialog"]').textContent.includes('1.1.1.9')),false,'closed modal response does not affect reopened modal')
 await run(result => ipHarness.pending.at(-1).resolve(result),report())
 await page.screenshot({path:resolve(output,'modal-zh-CN-1440.png')})
 const formatted = await page.eval(() => ipHarness.formatLogContent('Host #11: observed IPv4 1.1.1.2; ingress pending; reason IP_INSTANCE_STOPPED; next check 2026-11-04T10:01:00.000Z; instance and management identity retained','host.public_ip.observed','zh-CN'))
 assert.ok(!formatted.includes('IP_INSTANCE_STOPPED') && formatted.includes('启动后'))
 assert.equal(page.consoleErrors.length,0,page.consoleErrors.join('\n'))
 console.log('PASS actual Vue host-IP: list/detail automatic refresh, editable config untouched, session ABA and closed modal isolation, compact inventory and original/current task IP, customer sees only changed IP without verification explanation or obsolete copy, human-readable admin logs; 4 screens x 3 locales x 3 widths, light/dark. Controlled API, no production network.')
 if (process.argv.includes('--inspect-only')) { console.log('Inspect http://127.0.0.1:19665/'); await new Promise(() => {}) }
} finally { if (browser) await browser.close();await server.close() }
