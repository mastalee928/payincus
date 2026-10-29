import { createApp, ref } from 'vue'
import { createPinia } from 'pinia'
import i18n, { setLocale } from '@/locales/index'
import { useThemeStore } from '@/stores/theme'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/stores/toast'
import SSHKeysSection from '@/components/profile/SSHKeysSection.vue'
import { pending } from './api.js'
import '@/styles/main.css'
createApp({ setup() {
  const component = ref(), theme = useThemeStore(), auth = useAuthStore(), toast = useToast(), active = ref(true), mounted = ref(true)
  const session = (id = 1, sid = 'ssh-session', role = 'user') => {
    auth.user = { id, username: 'fixture-account', role, email: 'fixture@example.test' }
    auth.token = 'fixture.' + btoa(JSON.stringify({ sid })) + '.fixture'
  }
  session(); setLocale('zh-CN'); theme.setTheme('light')
  window.sshHarness = { pending, theme, auth, toast, active, mounted, session, setLocale, view: () => component.value?.$?.setupState }
  return { component, active, mounted }
}, components: { SSHKeysSection }, template: '<main class="max-w-3xl mx-auto p-4"><KeepAlive v-if="mounted"><SSHKeysSection v-if="active" ref="component"/></KeepAlive></main>' }).use(createPinia()).use(i18n).mount('#app')
