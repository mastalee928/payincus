import { createApp, ref } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import i18n, { setLocale } from '@/locales/index'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import Orders from '@/views/OrdersView.vue'
import { pending } from './api.js'
import '@/styles/main.css'
const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/orders', component: { template: '<div/>' } }, { path: '/dashboard', component: { template: '<div/>' } }] })
await router.push('/orders'); await router.isReady()
createApp({ components: { Orders }, setup() {
  const component = ref(), mounted = ref(true), active = ref(true), auth = useAuthStore(), theme = useThemeStore()
  const session = (id = 1, sid = 'order-session', role = 'user', suffix = 'fixture') => {
    localStorage.setItem('token', `fixture.${btoa(JSON.stringify({ id, sid, role, exp: 9999999999 }))}.${suffix}`)
    auth.syncToken(); auth.user = { id, username: `review-${id}`, role }
  }
  session(); setLocale('zh-CN'); theme.setTheme('light')
  let cachedView
  window.orderReads = { pending, mounted, active, auth, theme, session, router, setLocale,
    view: () => component.value ? (cachedView = component.value.$.setupState) : cachedView }
  return { component, mounted, active }
}, template: '<main class="mx-auto max-w-6xl p-4"><KeepAlive v-if="mounted"><Orders v-if="active" ref="component"/></KeepAlive></main>' })
  .use(createPinia()).use(i18n).use(router).mount('#app')
