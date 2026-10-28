import { createApp, reactive, watch } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import i18n, { setLocale } from '@/locales/index'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import { useToast } from '@/stores/toast'
import Tickets from '@/views/TicketsView.vue'
import { pending, calls, controls } from './api.js'
import '@/styles/main.css'
const router = createRouter({ history: createMemoryHistory(), routes: [
  { path: '/tickets', component: Tickets }, { path: '/admin/tickets', component: Tickets },
  { path: '/other', component: { template: '<p>Other fixture page</p>' } },
] })
const state = reactive({ mounted: true })
const jwt = (sid, iat = 1) => `fixture.${btoa(JSON.stringify({ sid, iat }))}.fixture`
let cachedView
const app = createApp({ setup() {
  const auth = useAuthStore(), theme = useThemeStore(), toast = useToast(), toasts = [], seen = new Set()
  auth.user = { id: 1, username: 'fixture', role: 'user' }; auth.token = jwt('a'); setLocale('zh-CN'); theme.setTheme('light')
  watch(() => toast.toasts.value.map(item => ({ id: item.id, type: item.type, message: item.message })), items => {
    for (const item of items) if (!seen.has(item.id)) { seen.add(item.id); toasts.push(item) }
  }, { flush: 'sync' })
  const urls = new Set(), createUrl = URL.createObjectURL.bind(URL), revokeUrl = URL.revokeObjectURL.bind(URL)
  URL.createObjectURL = blob => { const url = createUrl(blob); urls.add(url); return url }
  URL.revokeObjectURL = url => { urls.delete(url); revokeUrl(url) }
  window.ticketHarness = { state, auth, theme, pending, calls, controls, toasts, urls, router, setLocale,
    session(sid, role = 'user', iat = 1) { auth.user = { id: 1, username: 'fixture', role }; auth.token = sid ? jwt(sid, iat) : null },
    view() {
      let current = document.querySelector('.kawaii-page')?.__vueParentComponent
      while (current && !current.setupState?.openTicketDetail) current = current.parent
      if (current) cachedView = current.setupState
      return cachedView
    },
  }
  return { state }
}, template: '<main class="max-w-6xl mx-auto px-4"><RouterView v-slot="{ Component }"><KeepAlive v-if="state.mounted"><component :is="Component"/></KeepAlive></RouterView></main>' })
app.use(createPinia()); app.use(i18n); app.use(router)
await router.push('/tickets?ticket=1'); await router.isReady(); app.mount('#app')
