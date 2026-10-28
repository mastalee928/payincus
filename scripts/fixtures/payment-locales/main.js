import { createApp } from 'vue'
import { createPinia } from 'pinia'
import i18n, { setLocale } from '@/locales/index'
import { useThemeStore } from '@/stores/theme'
import PaymentProvidersView from '@/views/admin/PaymentProvidersView.vue'
import { calls } from './api.js'
import '@/styles/main.css'
const app = createApp({ components: { PaymentProvidersView }, setup() {
  const theme = useThemeStore(); theme.setTheme('light'); setLocale('zh-CN')
  window.localeHarness = { setLocale, theme, calls, t: (...args) => i18n.global.t(...args) }
}, template: '<main class="kawaii-app-shell p-4 sm:p-6"><PaymentProvidersView /></main>' })
app.use(createPinia()); app.use(i18n); app.mount('#app')
