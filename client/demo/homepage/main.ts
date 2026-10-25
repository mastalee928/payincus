import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createWebHistory } from 'vue-router'
import i18n from '../../src/locales'
import { setLocale, getLocale } from '../../src/locales'
import Home from '../../src/components/public/HomepageMapDemo.vue'
import '../../src/styles/main.css'
import '@fontsource-variable/inter'
import 'flag-icons/css/flag-icons.min.css'

const router = createRouter({ history: createWebHistory(), routes: [
  { path: '/', component: Home },
  { path: '/index.html', component: Home },
  { path: '/purchase', component: () => import('../../src/components/purchase/PoolPurchaseWizard.vue') },
  ...['/help', '/dashboard'].map(path => ({ path, beforeEnter: () => { window.location.assign(`https://vm.oci.ee${path}`); return false } })),
  { path: '/login', component: { template: '<main style="padding:60px;text-align:center"><h1>登录后继续配置</h1><p style="margin:24px">本地预览不处理登录和付款。</p><a href="https://vm.oci.ee/login">前往平台登录</a><br><br><a href="/">返回首页预览</a></main>' } }
] })
const app = createApp({ template: '<RouterView />' })
app.use(createPinia())
app.use(router)
app.use(i18n)
setLocale(getLocale())
app.mount('#app')
