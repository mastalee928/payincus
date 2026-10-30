import { createApp, ref } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import i18n, { setLocale } from '@/locales/index'
import { useThemeStore } from '@/stores/theme'
import { useAuthStore } from '@/stores/auth'
import DashboardView from '@/views/DashboardView.vue'
import { pending } from './api.js'
import '@/styles/main.css'
const timers = new Map(), originalSet = window.setInterval.bind(window), originalClear = window.clearInterval.bind(window)
window.setInterval = (callback, delay, ...args) => { if (delay !== 15000) return originalSet(callback, delay, ...args); const id = originalSet(() => {}, 3600000); timers.set(id, () => callback(...args)); return id }
window.clearInterval = id => { timers.delete(id); originalClear(id) }
const router = createRouter({ history: createMemoryHistory(), routes: ['/dashboard', '/away'].map(path => ({ path, component: { template: '<div/>' } })) })
await router.push('/dashboard')
createApp({ setup() {
  const component = ref(), auth = useAuthStore(), theme = useThemeStore(), active = ref(true), mounted = ref(true)
  const session = (id = 1, sid = 'dashboard-session', role = 'user') => {
    auth.user = { id, username: `fixture-account-${id}`, email: 'fixture@example.test', role }
    auth.token = 'fixture.' + btoa(JSON.stringify({ sid })) + '.fixture'
  }
  session(); theme.setTheme('light'); setLocale('zh-CN')
  window.dashboardHarness = { component, auth, theme, active, mounted, session, pending, timers, router, setLocale,
    view: () => component.value?.$?.setupState, tick: () => [...timers.values()].forEach(callback => callback()) }
  return { component, active, mounted }
}, components: { DashboardView }, template: '<main class="max-w-6xl mx-auto p-4"><KeepAlive v-if="mounted"><DashboardView v-if="active" ref="component"/></KeepAlive></main>' })
  .use(createPinia()).use(router).use(i18n).mount('#app')
