import { createApp, reactive, watch } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import i18n, { setLocale } from '@/locales/index'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import { useToast } from '@/stores/toast'
import Instances from '@/views/InstancesView.vue'
import { pending, calls } from './api.js'
import '@/styles/main.css'
const state = reactive({ mounted: true })
const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/instances', component: Instances }, { path: '/other', component: { template: '<p>Other fixture page</p>' } }, { path: '/purchase', component: { template: '<p>Purchase fixture</p>' } }] })
const jwt = (sid, iat = 1) => `fixture.${btoa(JSON.stringify({ sid, iat }))}.fixture`
let cachedView
const app = createApp({ setup() {
  const auth = useAuthStore(), theme = useThemeStore(), toast = useToast(), toasts = [], seen = new Set()
  auth.user = { id: 1, username: 'fixture', role: 'user' }; auth.token = jwt('a'); setLocale('zh-CN'); theme.setTheme('light')
  watch(() => toast.toasts.value.map(item => ({ id: item.id, type: item.type, message: item.message })), items => {
    for (const item of items) if (!seen.has(item.id)) { seen.add(item.id); toasts.push(item) }
  }, { flush: 'sync' })
  window.batchHarness = { state, auth, theme, pending, calls, toasts, router, setLocale,
    session(sid, iat = 1) { auth.token = sid ? jwt(sid, iat) : null },
    view() {
      let current = document.querySelector('.kawaii-instances-page')?.__vueParentComponent
      while (current && !current.setupState?.confirmBatchRenew) current = current.parent
      if (current) cachedView = current.setupState
      return cachedView
    },
  }
  return { state }
}, template: '<main class="max-w-6xl mx-auto p-4"><RouterView v-slot="{ Component }"><KeepAlive v-if="state.mounted"><component :is="Component"/></KeepAlive></RouterView></main>' })
app.use(createPinia()); app.use(i18n); app.use(router); await router.push('/instances'); await router.isReady(); app.mount('#app')
