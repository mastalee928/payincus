import { createApp, ref } from 'vue'
import { createPinia } from 'pinia'
import i18n, { setLocale } from '@/locales/index'
import { useThemeStore } from '@/stores/theme'
import { useAuthStore } from '@/stores/auth'
import LoginHistorySection from '@/components/profile/LoginHistorySection.vue'
import { pending } from './api.js'
import '@/styles/main.css'
createApp({ setup() {
  const component = ref(), theme = useThemeStore(), auth = useAuthStore(), active = ref(true), mounted = ref(true)
  const session = (id = 1, sid = 'history-session', role = 'user') => {
    auth.user = { id, username: 'fixture-account', role, email: 'fixture@example.test' }
    auth.token = 'fixture.' + btoa(JSON.stringify({ sid })) + '.fixture'
  }
  session(); setLocale('zh-CN'); theme.setTheme('light')
  window.historyHarness = { pending, theme, auth, active, mounted, session, setLocale, view: () => component.value?.$?.setupState }
  return { component, active, mounted }
}, components: { LoginHistorySection }, template: '<main class="max-w-3xl mx-auto p-4"><KeepAlive v-if="mounted"><LoginHistorySection v-if="active" ref="component"/></KeepAlive></main>' }).use(createPinia()).use(i18n).mount('#app')
