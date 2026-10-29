import { createApp, ref } from 'vue'
import { createPinia } from 'pinia'
import i18n, { setLocale } from '@/locales/index'
import { useThemeStore } from '@/stores/theme'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/stores/toast'
import TelegramBindingSection from '@/components/profile/TelegramBindingSection.vue'
import { pending } from './api.js'
import '@/styles/main.css'
createApp({ setup() {
  const component = ref(), theme = useThemeStore(), auth = useAuthStore(), toast = useToast(), active = ref(true), mounted = ref(true)
  const session = (id = 1, sid = 'tg-session', role = 'user') => {
    auth.user = { id, username: 'fixture-account', role, email: 'fixture@example.test' }
    auth.token = 'fixture.' + btoa(JSON.stringify({ sid })) + '.fixture'
  }
  session(); setLocale('zh-CN'); theme.setTheme('light')
  if (new URLSearchParams(location.search).has('dark')) theme.setTheme('dark')
  if (new URLSearchParams(location.search).has('inspect')) queueMicrotask(() => pending[0]?.resolve({ enabled: true, configured: true, botUsername: 'FixtureBot', binding: {
    telegramUserId: '101', telegramUsername: 'operator', firstName: null, lastName: null, notifyEnabled: true,
    notifyLastError: null, notifyLastErrorAt: null, boundAt: '2026-10-29T04:05:06.000Z'
  } }))
  window.tgHarness = { pending, theme, auth, toast, active, mounted, session, setLocale, t: (...args) => i18n.global.t(...args), view: () => component.value?.$?.setupState }
  return { component, active, mounted }
}, components: { TelegramBindingSection }, template: '<main class="max-w-3xl mx-auto p-4"><KeepAlive v-if="mounted"><TelegramBindingSection v-if="active" ref="component"/></KeepAlive></main>' }).use(createPinia()).use(i18n).mount('#app')
