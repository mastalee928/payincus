import { createApp, reactive, watch } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import i18n, { setLocale } from '@/locales/index'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import { useToast } from '@/stores/toast'
import AdminInstanceCreateView from '@/views/admin/AdminInstanceCreateView.vue'
import { pending } from './api.js'
import '@/styles/main.css'
const state = reactive({ mounted: true })
const router = createRouter({ history: createMemoryHistory(), routes: [
  { path: '/create', name: 'create', component: { components: { AdminInstanceCreateView }, setup: () => ({ state }), template: '<AdminInstanceCreateView v-if="state.mounted" />' } },
  { path: '/other', name: 'other', component: { template: '<p>Other page</p>' } },
  { path: '/admin/instances/:id', name: 'instance', component: { template: '<p>Created instance detail</p>' } }
] })
const jwt = sid => `fixture.${btoa(JSON.stringify({ sid }))}.fixture`
const app = createApp({ setup() {
  const auth = useAuthStore(), theme = useThemeStore(), toast = useToast()
  const toastEvents = [], seenToasts = new Set()
  watch(() => toast.toasts.value.map(item => ({ id: item.id, type: item.type, message: item.message })), items => {
    for (const item of items) if (!seenToasts.has(item.id)) { seenToasts.add(item.id); toastEvents.push(item) }
  }, { flush: 'sync' })
  auth.user = { id: 1, username: 'fixture', role: 'admin' }; auth.token = jwt('a')
  setLocale('zh-CN'); theme.setTheme('light')
  window.poolHarness = { pending, auth, theme, toastEvents, state, router, setLocale, session: sid => { auth.token = jwt(sid) }, t: (...args) => i18n.global.t(...args) }
}, template: '<main class="p-4 sm:p-6"><RouterView v-slot="{ Component, route }"><KeepAlive><component :is="Component" :key="route.name"/></KeepAlive></RouterView></main>' })
app.use(createPinia()); app.use(i18n); app.use(router)
await router.push('/create'); await router.isReady(); app.mount('#app')
