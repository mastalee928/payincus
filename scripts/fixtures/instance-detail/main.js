import { createApp, watch } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import i18n, { setLocale } from '@/locales/index'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import { useToast } from '@/stores/toast'
import Detail from '@/views/InstanceDetailView.vue'
import { pending, calls } from './api.js'
import '@/styles/main.css'
const router = createRouter({ history: createMemoryHistory(), routes: [
  { path: '/instances/:id', name: 'instance-detail', component: Detail },
  { path: '/instances', name: 'instances', component: { template: '<p>Fixture instance list</p>' } },
  { path: '/other', name: 'other', component: { template: '<p>Fixture other page</p>' } },
] })
const jwt = (sid, iat = 1) => `fixture.${btoa(JSON.stringify({ sid, iat }))}.fixture`
const app = createApp({ setup() {
  const auth = useAuthStore(), theme = useThemeStore(), toast = useToast()
  const toastEvents = [], seen = new Set()
  watch(() => toast.toasts.value.map(item => ({ id: item.id, type: item.type, message: item.message })), items => {
    for (const item of items) if (!seen.has(item.id)) { seen.add(item.id); toastEvents.push(item) }
  }, { flush: 'sync' })
  auth.user = { id: 1, username: 'fixture', role: 'user' }; auth.token = jwt('a')
  setLocale('zh-CN'); theme.setTheme('light')
  window.detailHarness = { pending, calls, auth, theme, toastEvents, router, setLocale,
    session(sid, iat = 1) { auth.token = sid ? jwt(sid, iat) : null },
    view() {
      let current = document.querySelector('#app')?.firstElementChild?.__vueParentComponent
      while (current && current.type.name !== 'InstanceDetailView') current = current.parent
      return current?.setupState
    },
  }
}, template: '<RouterView/>' })
app.use(createPinia()); app.use(i18n); app.use(router)
await router.push('/instances/1'); await router.isReady(); app.mount('#app')
