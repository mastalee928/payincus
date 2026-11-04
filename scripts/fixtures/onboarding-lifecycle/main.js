import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import i18n, { setLocale } from '@/locales/index'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import HostOnboardingView from '@/views/admin/HostOnboardingView.vue'
import { pending } from './api.js'
import '@/styles/main.css'
const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: HostOnboardingView }] })
const app = createApp({ setup() {
  const auth = useAuthStore(), theme = useThemeStore()
  auth.user = { id: 1, username: 'fixture', role: 'admin' }; auth.token = 'fixture.' + btoa(JSON.stringify({ sid: 'a' })) + '.fixture'
  setLocale('zh-CN'); theme.setTheme('light')
  window.onboardingHarness = { pending, auth, theme, router, setLocale, t: (...args) => i18n.global.t(...args) }
}, template: '<main class="p-4 sm:p-6"><RouterView/></main>' })
app.use(createPinia()); app.use(i18n); app.use(router)
await router.push('/'); await router.isReady(); app.mount('#app')
