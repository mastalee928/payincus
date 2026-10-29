import { createApp, reactive, watch } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import i18n, { setLocale } from '@/locales/index'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import { useToast } from '@/stores/toast'
import Users from '@/views/admin/UsersView.vue'
import { pending } from './api.js'
import '@/styles/main.css'
const state = reactive({ mounted: true })
const router = createRouter({ history: createMemoryHistory(), routes: [
  { path: '/admin/users', component: Users }, { path: '/other', component: { template: '<p>Other fixture page</p>' } },
] })
const jwt = (sid, iat = 1) => `fixture.${btoa(JSON.stringify({ sid, iat }))}.fixture`
let cached
const app = createApp({ setup() {
  const auth = useAuthStore(), theme = useThemeStore(), toast = useToast(), toasts = [], seen = new Set()
  auth.user = { id: 1, username: 'fixture', role: 'admin' }; auth.token = jwt('a'); setLocale('zh-CN'); theme.setTheme('light')
  watch(() => toast.toasts.value.map(item => ({ id: item.id, message: item.message })), items => {
    for (const item of items) if (!seen.has(item.id)) { seen.add(item.id); toasts.push(item) }
  }, { flush: 'sync' })
  window.userDialogsHarness = { state, auth, theme, pending, toasts, router, setLocale,
    session(sid, iat = 1) { auth.token = sid ? jwt(sid, iat) : null },
    view() {
      let current = document.querySelector('#app main > div')?.__vueParentComponent
      while (current && !current.setupState?.openBalanceModal) current = current.parent
      if (current) cached = current.setupState
      return cached
    },
  }
  return { state }
}, template: '<main class="kawaii-app-shell p-4"><RouterView v-slot="{ Component }"><KeepAlive v-if="state.mounted"><component :is="Component"/></KeepAlive></RouterView></main>' })
app.use(createPinia()); app.use(i18n); app.use(router)
await router.push('/admin/users'); await router.isReady(); app.mount('#app')
