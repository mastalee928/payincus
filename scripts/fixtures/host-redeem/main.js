import { createApp, reactive, watch } from 'vue'
import { createPinia } from 'pinia'
import i18n, { setLocale } from '@/locales/index'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import { useToast } from '@/stores/toast'
import RedeemCodes from '@/components/host/HostRedeemCodesTab.vue'
import { pending } from './api.js'
import '@/styles/main.css'
const state = reactive({ mounted: true, active: true, id: 1 })
const jwt = (sid, iat = 1) => `fixture.${btoa(JSON.stringify({ sid, iat }))}.fixture`
let cached
const app = createApp({ components: { RedeemCodes }, setup() {
  const auth = useAuthStore(), theme = useThemeStore(), toast = useToast(), toastEvents = [], seen = new Set()
  auth.user = { id: 1, username: 'fixture', role: 'admin' }; auth.token = jwt('a'); setLocale('zh-CN'); theme.setTheme('light')
  watch(() => toast.toasts.value.map(item => ({ id: item.id, message: item.message })), items => {
    for (const item of items) if (!seen.has(item.id)) { seen.add(item.id); toastEvents.push(item) }
  }, { flush: 'sync' })
  window.redeemHarness = { state, auth, theme, pending, setLocale, toastEvents,
    session(sid, iat = 1) { auth.token = sid ? jwt(sid, iat) : null },
    view() {
      let current = document.querySelector('#app main > div')?.__vueParentComponent
      while (current && !current.setupState?.loadCodes) current = current.parent
      if (current) cached = current.setupState
      return cached
    },
  }
  return { state }
}, template: '<main class="max-w-7xl mx-auto p-4"><KeepAlive v-if="state.mounted"><RedeemCodes v-if="state.active" :host-id="state.id"/></KeepAlive></main>' })
app.use(createPinia()); app.use(i18n); app.mount('#app')
