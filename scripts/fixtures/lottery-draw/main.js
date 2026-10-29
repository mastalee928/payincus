import { createApp, nextTick, ref, watch } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import i18n, { setLocale } from '@/locales/index'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import { useToast } from '@/stores/toast'
import Entertainment from '@/views/EntertainmentView.vue'
import { pending } from './api.js'
import '@/styles/main.css'
const jwt = (sid, generation = 1) => `fixture.${btoa(JSON.stringify({ sid, generation }))}.fixture`
const router = createRouter({ history: createMemoryHistory(), routes: [
  { path: '/entertainment', name: 'entertainment', component: Entertainment },
  { path: '/other', name: 'other', component: { template: '<p>Other page fixture</p>' } },
] })
const shown = ref(true)
const app = createApp({ setup() {
  const component = ref(), auth = useAuthStore(), theme = useThemeStore(), toast = useToast()
  const toastEvents = [], seen = new Set()
  watch(() => toast.toasts.value, items => { for (const item of items) if (!seen.has(item.id)) { seen.add(item.id); toastEvents.push({ type: item.type, message: item.message }) } }, { flush: 'sync', deep: true })
  auth.user = { id: 1, username: 'isolated-ui', role: 'user' }; auth.token = jwt('a')
  setLocale('zh-CN'); theme.setTheme('light')
  window.lotteryHarness = { pending, router, auth, theme, toast, toastEvents, nextTick, setLocale, shown,
    session(sid, generation = 1) { auth.token = jwt(sid, generation) },
    view() { return component.value?.$?.setupState },
  }
  return { component, shown }
}, template: '<main class="p-4 sm:p-6"><RouterView v-if="shown" v-slot="{ Component, route }"><KeepAlive><component :is="Component" :key="route.name" ref="component"/></KeepAlive></RouterView></main>' })
app.use(createPinia()); app.use(i18n); app.use(router)
await router.push('/entertainment?tab=lottery'); await router.isReady(); app.mount('#app')
