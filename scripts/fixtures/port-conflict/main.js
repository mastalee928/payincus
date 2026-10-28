import { createApp, reactive } from 'vue'
import { createPinia } from 'pinia'
import i18n, { setLocale } from '@/locales/index'
import { useThemeStore } from '@/stores/theme'
import { useAuthStore } from '@/stores/auth'
import Modal from '@/components/instance/modals/PortConflictModal.vue'
import '@/styles/main.css'
const state = reactive({ mounted: true, active: true, visible: true, loading: false, conflicts: [{ publicPort: 80, suggestedPort: 10080 }, { publicPort: 81, suggestedPort: 10081 }], start: null, end: null })
const jwt = (sid, iat = 1) => `fixture.${btoa(JSON.stringify({ sid, iat }))}.fixture`
let cachedView
const app = createApp({ components: { Modal }, setup() {
  const theme = useThemeStore(), auth = useAuthStore(), submissions = []
  auth.user = { id: 1, username: 'fixture', role: 'user' }; auth.token = jwt('a'); setLocale('zh-CN'); theme.setTheme('light')
  window.portHarness = { state, auth, theme, submissions, setLocale,
    session(sid, iat = 1) { auth.token = sid ? jwt(sid, iat) : null },
    view() {
      let current = document.querySelector('body h3')?.__vueParentComponent
      while (current && !current.setupState?.handleConfirm) current = current.parent
      if (current) cachedView = current.setupState
      return cachedView
    },
    confirm(data) { submissions.push(data); state.loading = true },
  }
  return { state, confirm: window.portHarness.confirm }
}, template: '<main><KeepAlive v-if="state.mounted"><Modal v-if="state.active" v-model:visible="state.visible" :loading="state.loading" :conflicts="state.conflicts" :port-range-start="state.start" :port-range-end="state.end" @confirm="confirm"/></KeepAlive></main>' })
app.use(createPinia()); app.use(i18n); app.mount('#app')
