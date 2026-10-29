import { createApp, ref } from 'vue'
import { createPinia } from 'pinia'
import i18n, { setLocale } from '@/locales/index'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import { useToast } from '@/stores/toast'
import AccountSection from '@/components/profile/AccountSection.vue'
import { pending } from './api.js'
import '@/styles/main.css'
createApp({ setup() {
  const component = ref(), auth = useAuthStore(), theme = useThemeStore(), toast = useToast(), active = ref(true), mounted = ref(true)
  let retained
  const session = (id = 1, sid = 'avatar-session', role = 'user', revision = 1) => {
    auth.user = { id, username: 'avatar-fixture', email: 'avatar@example.test', avatarStyle: 'initials', role, status: 'active' }
    auth.token = 'fixture.' + btoa(JSON.stringify({ sid, revision })) + '.fixture'
  }
  session(); setLocale('zh-CN'); theme.setTheme('light')
  window.avatarHarness = { pending, auth, theme, toast, active, mounted, session, setLocale, t: (...args) => i18n.global.t(...args), view() {
    retained = component.value?.$?.setupState || retained; return retained
  } }
  return { component, active, mounted }
}, components: { AccountSection }, template: '<main class="max-w-3xl mx-auto p-4"><KeepAlive v-if="mounted"><AccountSection v-if="active" ref="component"/></KeepAlive></main>' }).use(createPinia()).use(i18n).mount('#app')
