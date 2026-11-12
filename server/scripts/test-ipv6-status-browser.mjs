import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath,pathToFileURL } from 'node:url'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { Browser,sleep } from '../../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'
const root=fileURLToPath(new URL('../..',import.meta.url)).replaceAll('\\','/'),require=createRequire(new URL('../../client/package.json',import.meta.url))
const {createServer}=await import(pathToFileURL(require.resolve('vite')).href),{default:vue}=await import(pathToFileURL(require.resolve('@vitejs/plugin-vue')).href)
const config=require('tailwindcss/loadConfig')(root+'/client/tailwind.config.js');config.content=[root+'/client/src/**/*.{vue,js,ts}']
const output=root+'/logs/ipv6-status-browser';mkdirSync(output,{recursive:true})
const server=await createServer({configFile:false,root:root+'/scripts/fixtures/ipv6-status',plugins:[vue()],cacheDir:output+'/cache',
 resolve:{alias:[{find:'@',replacement:root+'/client/src'},...['vue','pinia','vue-i18n'].map(name=>({find:name,replacement:require.resolve(name==='vue'?'vue/dist/vue.esm-bundler.js':name)}))]},
 css:{postcss:{plugins:[require('tailwindcss')(config),require('autoprefixer')()]}},server:{host:'127.0.0.1',port:19676,strictPort:true,fs:{allow:[root]}}})
let browser
try{await server.listen();browser=await Browser.launch();const page=await browser.newPage({reducedMotion:true})
 for(const locale of ['zh-CN','zh-TW','en'])for(const width of [390,1440]){
  await page.setViewport({width,height:700,mobile:width<500});await page.goto('http://127.0.0.1:19676',{settleMs:800})
  await page.eval(locale=>window.ipv6Fixture.locale(locale),locale);await sleep(100)
  const text=await page.eval(()=>document.body.innerText);assert.ok(text.includes('2603:c022:8018:be00::1'));assert.doesNotMatch(text,/正在配置|配置中|being configured|configuring/i)
  await page.screenshot({path:resolve(output,`${locale}-${width}.png`),format:'png'})
  await page.eval(()=>window.ipv6Fixture.state.status='pending');await sleep(80);assert.equal(await page.eval(()=>!!document.querySelector('[role=status]')),true)
 }
 assert.equal(page.consoleErrors.length,0,page.consoleErrors.join('\n'));console.log('PASS verified IPv6 address with ready allocation has no false configuring hint; genuinely pending status remains visible, all locales/mobile/desktop')
}finally{if(browser)await browser.close();await server.close()}
