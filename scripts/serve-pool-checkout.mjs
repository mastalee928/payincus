import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
const root = fileURLToPath(new URL('..', import.meta.url)).replaceAll('\\','/')
const require = createRequire(new URL('../client/package.json', import.meta.url))
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href)
const { default: vue } = await import(pathToFileURL(require.resolve('@vitejs/plugin-vue')).href)
const tailwind = require('tailwindcss/loadConfig')(root+'/client/tailwind.config.js')
tailwind.content = [root+'/client/src/**/*.{vue,js,ts}',root+'/scripts/fixtures/pool-checkout/*.{js,vue}']
const server = await createServer({configFile:false,root:root+'/scripts/fixtures/pool-checkout',publicDir:root+'/client/public',plugins:[vue()],
 resolve:{alias:[{find:/^@\/api$/,replacement:root+'/scripts/fixtures/pool-checkout/api.js'},{find:'@',replacement:root+'/client/src'},...['vue','pinia','vue-i18n','vue-router'].map(name=>({find:name,replacement:require.resolve(name==='vue'?'vue/dist/vue.esm-bundler.js':name)}))],dedupe:['vue','pinia','vue-i18n','vue-router']},
 css:{postcss:{plugins:[require('tailwindcss')(tailwind),require('autoprefixer')()]}},server:{host:'127.0.0.1',port:19817,strictPort:true,fs:{allow:[root]}}})
await server.listen(); console.log('Local fixture http://127.0.0.1:19817/?manual=1')
