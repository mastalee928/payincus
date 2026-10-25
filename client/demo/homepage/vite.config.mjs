import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const demoRoot = fileURLToPath(new URL('.', import.meta.url))
const clientRoot = resolve(demoRoot, '../..')
const require = createRequire(resolve(clientRoot, 'package.json'))
const loadTailwindConfig = require('tailwindcss/loadConfig')
const tailwindConfig = loadTailwindConfig(resolve(clientRoot, 'tailwind.config.js'))
const readonlyPaths = new Set(['/api/system-config/public', '/api/host-pools/public/catalog'])
const publicOrigin = process.env.HOMEPAGE_DEMO_PUBLIC_ORIGIN || 'https://vm-admin.oci.ee'
const source = new URL(publicOrigin)
if (!['https:', 'http:'].includes(source.protocol) || source.username || source.password || source.search || source.hash || source.pathname !== '/') {
  throw new Error('HOMEPAGE_DEMO_PUBLIC_ORIGIN must be a plain HTTP(S) origin without credentials.')
}

export default defineConfig({
  root: demoRoot,
  publicDir: resolve(clientRoot, 'public'),
  plugins: [vue(), {
    name: 'homepage-preview-readonly-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0]
        if (path?.startsWith('/api/') && (req.method !== 'GET' || !readonlyPaths.has(path))) {
          res.statusCode = 403
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ message: '本地首页预览只允许读取公开品牌与商品目录。' }))
          return
        }
        next()
      })
    }
  }],
  css: { postcss: { plugins: [tailwindcss({ ...tailwindConfig, content: [resolve(clientRoot, 'src/**/*.{vue,js,ts,jsx,tsx}'), resolve(demoRoot, '**/*.{html,ts}')] }), autoprefixer()] } },
  resolve: { alias: {
    '@': resolve(clientRoot, 'src'),
    vue: resolve(clientRoot, 'node_modules/vue/dist/vue.esm-bundler.js'),
    pinia: require.resolve('pinia/dist/pinia.mjs'),
    'vue-router': require.resolve('vue-router/dist/vue-router.mjs')
  } },
  server: { host: '127.0.0.1', port: 19511, strictPort: true,
    fs: { allow: [resolve(clientRoot, '..')] },
    proxy: { '/api': { target: source.origin, changeOrigin: true } }
  },
  build: { outDir: resolve(demoRoot, 'dist'), emptyOutDir: false }
})
