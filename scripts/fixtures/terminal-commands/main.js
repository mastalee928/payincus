import { createApp, reactive, watch } from 'vue'
import { createPinia } from 'pinia'
import i18n, { setLocale } from '@/locales/index'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import { useToast } from '@/stores/toast'
import Commands from '@/components/terminal/TerminalSavedCommandsSidebar.vue'
import { pending } from './api.js'
import '@/styles/main.css'
const state = reactive({ active: true, mounted: true, visible: true, mobile: false, connected: true })
const jwt = (sid, iat = 1) => `fixture.${btoa(JSON.stringify({ sid, iat }))}.fixture`
let cachedView
const app = createApp({ components: { Commands }, setup() {
  const auth = useAuthStore(), theme = useThemeStore(), toast = useToast(), events = [], toasts = [], seen = new Set()
  auth.user = { id: 1, username: 'fixture', role: 'user' }; auth.token = jwt('a'); setLocale('zh-CN'); theme.setTheme('light')
  watch(() => toast.toasts.value.map(item => ({ id: item.id, type: item.type, message: item.message })), items => {
    for (const item of items) if (!seen.has(item.id)) { seen.add(item.id); toasts.push(item) }
  }, { flush: 'sync' })
  const execute = command => events.push(command), close = () => { state.visible = false }
  window.commandsHarness = { state, auth, theme, pending, events, toasts, setLocale,
    session: sid => { auth.token = sid ? jwt(sid) : null }, refresh: () => { auth.token = jwt('a', 2) },
    view() {
      let current = document.querySelector('h3')?.__vueParentComponent
      while (current && !current.setupState?.saveCommand) current = current.parent
      if (current) cachedView = current.setupState
      return cachedView
    },
  }
  return { state, execute, close }
}, template: '<main class="h-screen flex justify-center"><KeepAlive v-if="state.mounted"><Commands v-if="state.active" :connected="state.connected" :visible="state.visible" :mobile="state.mobile" @execute="execute" @close="close"/></KeepAlive></main>' })
app.use(createPinia()); app.use(i18n); app.mount('#app')
