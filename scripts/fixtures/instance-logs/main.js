import { createApp, reactive, watch } from 'vue'
import { createPinia } from 'pinia'
import i18n, { setLocale } from '@/locales/index'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import { useToast } from '@/stores/toast'
import Logs from '@/components/instance/InstanceLogsTab.vue'
import { pending } from './api.js'
import '@/styles/main.css'
const state = reactive({ mounted: true, active: true, id: 1, name: 'Fixture 1' })
const jwt = (sid, iat = 1) => `fixture.${btoa(JSON.stringify({ sid, iat }))}.fixture`
let cachedView
const app = createApp({ components: { Logs }, setup() {
  const auth = useAuthStore(), theme = useThemeStore(), toast = useToast(), toasts = [], seen = new Set()
  auth.user = { id: 1, username: 'fixture', role: 'user' }; auth.token = jwt('a'); setLocale('zh-CN'); theme.setTheme('light')
  watch(() => toast.toasts.value.map(item => ({ id: item.id, type: item.type, message: item.message })), items => {
    for (const item of items) if (!seen.has(item.id)) { seen.add(item.id); toasts.push(item) }
  }, { flush: 'sync' })
  window.logsHarness = { state, auth, theme, pending, toasts, setLocale,
    session(sid, iat = 1) { auth.token = sid ? jwt(sid, iat) : null },
    view() {
      let current = document.querySelector('#app main > div')?.__vueParentComponent
      while (current && !current.setupState?.loadLogs) current = current.parent
      if (current) cachedView = current.setupState
      return cachedView
    },
  }
  return { state }
}, template: '<main class="max-w-6xl mx-auto p-4"><KeepAlive v-if="state.mounted"><Logs v-if="state.active" :instance-id="state.id" :instance-name="state.name"/></KeepAlive></main>' })
app.use(createPinia()); app.use(i18n); app.mount('#app')
