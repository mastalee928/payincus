import { createApp, reactive, watch } from 'vue'
import { createPinia } from 'pinia'
import i18n, { setLocale } from '@/locales/index'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import { useToast } from '@/stores/toast'
import { useConfigStore } from '@/stores/config'
import Transfer from '@/components/instance/modals/TransferModal.vue'
import { pending } from './api.js'
import '@/styles/main.css'
const state = reactive({ show: true, mounted: true, instance: { id: 10, name: 'Fixture VPS', cpu: 100, memory: 1024, disk: 10240 } })
const jwt = (sid, iat = 1) => `fixture.${btoa(JSON.stringify({ sid, iat }))}.fixture`
const app = createApp({ components: { Transfer }, setup() {
  const auth = useAuthStore(), theme = useThemeStore(), config = useConfigStore(), toast = useToast()
  const events = [], toasts = [], seen = new Set()
  auth.user = { id: 1, username: 'fixture', role: 'user' }; auth.token = jwt('a'); config.transferFee = 5
  setLocale('zh-CN'); theme.setTheme('light')
  watch(() => toast.toasts.value.map(item => ({ id: item.id, type: item.type, message: item.message })), items => {
    for (const item of items) if (!seen.has(item.id)) { seen.add(item.id); toasts.push(item) }
  }, { flush: 'sync' })
  const close = () => events.push('close'), success = () => events.push('success')
  window.transferHarness = { state, pending, auth, config, theme, toasts, events, setLocale,
    session: sid => { auth.token = sid ? jwt(sid) : null },
    refresh: () => { auth.token = jwt('a', 2) },
    view() { let current = document.querySelector('[role=dialog]')?.__vueParentComponent; return current?.setupState },
    verification() {
      let current = document.querySelector('.modal-content')?.__vueParentComponent
      while (current && !current.setupState?.requestCode) current = current.parent
      return current?.setupState
    },
  }
  return { state, close, success }
}, template: '<main class="p-6"><Transfer v-if="state.mounted" :show="state.show" :instance="state.instance" @close="close" @success="success"/></main>' })
app.use(createPinia()); app.use(i18n); app.mount('#app')
