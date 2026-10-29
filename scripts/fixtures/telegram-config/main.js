import { createApp, nextTick, ref, watch } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import i18n, { setLocale } from '@/locales/index'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import { useToast } from '@/stores/toast'
import Telegram from '@/views/admin/TelegramConfigView.vue'
import { pending } from './api.js'
import '@/styles/main.css'
const jwt = (sid, generation = 1) => `fixture.${btoa(JSON.stringify({ sid, generation }))}.fixture`
const shown = ref(true)
const router = createRouter({ history: createMemoryHistory(), routes: [
  { path: '/settings/telegram', name: 'telegram', component: Telegram },
  { path: '/other', name: 'other', component: { template: '<p>Other page fixture</p>' } },
] })
const app = createApp({ setup() {
  const component = ref(), auth = useAuthStore(), theme = useThemeStore(), toast = useToast()
  const events = [], seen = new Set()
  watch(() => toast.toasts.value, items => { for (const item of items) if (!seen.has(item.id)) { seen.add(item.id); events.push(item.message) } }, { deep: true, flush: 'sync' })
  auth.user = { id: 1, username: 'isolated-ui', role: 'admin' }; auth.token = jwt('a')
  setLocale('zh-CN'); theme.setTheme('light')
  window.telegramHarness = { pending, router, auth, theme, toast, events, shown, nextTick, setLocale, t: (...args) => i18n.global.t(...args),
    session(sid, generation = 1) { auth.token = jwt(sid, generation) }, view() { return component.value?.$?.setupState },
  }
  return { component, shown }
}, template: '<main class="p-4 sm:p-6"><RouterView v-if="shown" v-slot="{ Component, route }"><KeepAlive><component :is="Component" :key="route.name" ref="component"/></KeepAlive></RouterView></main>' })
app.use(createPinia()); app.use(i18n); app.use(router)
await router.push('/settings/telegram'); await router.isReady(); app.mount('#app')
