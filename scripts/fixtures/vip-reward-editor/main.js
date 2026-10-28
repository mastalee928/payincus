import { createApp } from 'vue'
import { createPinia } from 'pinia'
import i18n, { setLocale } from '@/locales/index'
import { useThemeStore } from '@/stores/theme'
import { useAuthStore } from '@/stores/auth'
import VipBenefitHallSettings from '@/components/admin/VipBenefitHallSettings.vue'
import { pending } from './api.js'
import '@/styles/main.css'
const app = createApp({ components: { VipBenefitHallSettings }, setup() {
  const theme = useThemeStore(), auth = useAuthStore()
  auth.user = { id: 1, username: 'fixture', role: 'admin' }; auth.token = 'fixture.eyJzaWQiOiJhIn0.fixture'
  setLocale('zh-CN'); theme.setTheme('light')
  window.vipHarness = { pending, theme, auth, setLocale, t: (...args) => i18n.global.t(...args) }
}, template: '<main class="p-4 sm:p-6"><VipBenefitHallSettings/></main>' })
app.use(createPinia()); app.use(i18n); app.mount('#app')
