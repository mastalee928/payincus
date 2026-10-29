import { createApp, nextTick, ref } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import i18n, { setLocale } from '@/locales/index'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import Login from '@/views/LoginView.vue'
import AdminLogin from '@/views/admin/AdminLoginView.vue'
import { pending } from './api.js'
import '@/styles/main.css'
localStorage.removeItem('token')
window.__PAYINCUS_DEMO_LOGIN__ = { hosts: ['127.0.0.1'], user: { username: 'fixture-demo', password: 'fixture-demo-password' }, admin: { username: 'fixture-admin-demo', password: 'fixture-demo-password' } }
const router = createRouter({ history: createMemoryHistory(), routes: [
  { path: '/login', name: 'login', component: Login },
  { path: '/admin-login', name: 'admin-login', component: AdminLogin },
  { path: '/dashboard', name: 'dashboard', component: { template: '<p>Isolated user console</p>' } },
  { path: '/admin/users', name: 'admin-users', component: { template: '<p>Isolated admin console</p>' } },
] })
const app = createApp({ setup() {
  const component = ref(), auth = useAuthStore(), theme = useThemeStore()
  setLocale('zh-CN'); theme.setTheme('light')
  window.loginHarness = { pending, router, auth, theme, nextTick, setLocale, view() { return component.value?.$?.setupState } }
  return { component }
}, template: '<RouterView v-slot="{ Component, route }"><component :is="Component" :key="route.name" ref="component"/></RouterView>' })
app.use(createPinia()); app.use(i18n); app.use(router)
await router.push(new URLSearchParams(location.search).has('admin') ? '/admin-login' : '/login'); await router.isReady(); app.mount('#app')
