import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import i18n, { setLocale } from '@/locales/index'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import Panel from '@/components/host/ManagementGatewayPanel.vue'
import { fixture } from './api.js'
import '@/styles/main.css'
import '@fontsource-variable/inter'
const app = createApp({ components: { Panel }, setup() {
  const auth = useAuthStore(), theme = useThemeStore(), query = new URLSearchParams(location.search)
  auth.user = { id: 1, username: 'isolated-admin', role: 'admin' }
  auth.token = 'fixture.' + btoa(JSON.stringify({ sid: 'gateway-check' })) + '.fixture'; localStorage.setItem('token', auth.token)
  setLocale(query.get('locale') || 'zh-CN'); theme.setTheme(query.has('dark') ? 'dark' : 'light')
  window.gatewayFixture = { fixture, setLocale, theme, auth }
}, template: '<main class="max-w-6xl mx-auto p-4 text-themed"><h1 class="text-2xl font-semibold mb-2">PayIncus · 网关</h1><p class="text-sm text-gray-600 dark:text-gray-300 mb-5">本机隔离验证 · 示例网关</p><Panel /></main>' })
const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
app.use(createPinia()).use(i18n).use(router); await router.push('/'); await router.isReady(); app.mount('#app')
