import { createApp, ref, nextTick } from 'vue'
import { createPinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import LatePayments from '@/components/admin/LatePaymentsPanel.vue'
import { requests } from './api.js'
import '@/styles/main.css'
const app = createApp({ components: { LatePayments }, setup() {
  const active = ref(true), auth = useAuthStore(), theme = useThemeStore()
  theme.setTheme('light')
  auth.user = { id: 1, username: '财务管理员', role: 'admin' }; auth.token = 'session-a'; localStorage.setItem('token', auth.token)
  window.lateHarness = { requests, active, auth, theme, nextTick, session(value) { localStorage.setItem('token', value); auth.token = value } }
  return { active }
}, template: '<main class="p-4 sm:p-6"><h1 class="mb-5 text-2xl font-semibold">PayIncus 财务对账</h1><LatePayments :active="active" /></main>' })
app.use(createPinia()); app.mount('#app')
