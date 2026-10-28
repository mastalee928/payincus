import { createApp, reactive, watch } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import i18n, { setLocale } from '@/locales/index'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import { useToast } from '@/stores/toast'
import Card from '@/components/tickets/TicketInstanceOwnerCard.vue'
import { pending } from './api.js'
import '@/styles/main.css'
const state = reactive({ mounted: true, active: true, summary: { id: 1, name: 'Fixture instance', status: 'running' } })
const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<p>Fixture</p>' } }] })
const jwt = (sid, iat = 1) => `fixture.${btoa(JSON.stringify({ sid, iat }))}.fixture`
const intervals = new Map(), originalSet = window.setInterval.bind(window), originalClear = window.clearInterval.bind(window)
window.setInterval = (fn, ms, ...args) => { const id = originalSet(fn, ms, ...args); if ([2000, 3000, 15000].includes(ms)) intervals.set(id, ms); return id }
window.clearInterval = id => { intervals.delete(id); originalClear(id) }
let cachedView
const app = createApp({ components: { Card }, setup() {
  const auth = useAuthStore(), theme = useThemeStore(), toast = useToast(), toasts = [], seen = new Set()
  auth.user = { id: 1, username: 'fixture', role: 'admin' }; auth.token = jwt('a'); setLocale('zh-CN'); theme.setTheme('light')
  watch(() => toast.toasts.value.map(item => ({ id: item.id, type: item.type, message: item.message })), items => {
    for (const item of items) if (!seen.has(item.id)) { seen.add(item.id); toasts.push(item) }
  }, { flush: 'sync' })
  window.cardHarness = { state, auth, theme, pending, toasts, intervals, setLocale,
    session(sid, iat = 1) { auth.token = sid ? jwt(sid, iat) : null },
    view() {
      let current = document.querySelector('#app main > div')?.__vueParentComponent
      while (current && !current.setupState?.loadInstanceContext) current = current.parent
      if (current) cachedView = current.setupState
      return cachedView
    },
  }
  return { state }
}, template: '<main class="max-w-6xl mx-auto p-4"><KeepAlive v-if="state.mounted"><Card v-if="state.active" :instance-summary="state.summary"/></KeepAlive></main>' })
app.use(createPinia()); app.use(i18n); app.use(router); await router.push('/'); await router.isReady(); app.mount('#app')
