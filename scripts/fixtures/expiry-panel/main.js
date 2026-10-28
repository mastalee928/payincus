import { createApp, ref } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import i18n, { setLocale } from '@/locales/index'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import Panel from '@/components/admin/ExpiryEnforcementPanel.vue'
import { pending } from './api.js'
import '@/styles/main.css'

// Control only patrol timers. Vue, Vite and other browser timing remain native.
const timers = new Map(), nativeTimeout = window.setTimeout, nativeClear = window.clearTimeout
let timerId = -1, visibility = 'visible'
window.setTimeout = (fn, delay, ...args) => {
  if (delay !== 5000 && delay !== 15000) return nativeTimeout(fn, delay, ...args)
  const id = timerId--; timers.set(id, { fn: () => fn(...args), delay }); return id
}
window.clearTimeout = id => { timers.delete(id); nativeClear(id) }
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
const activeTab = ref('overview')
const BillingShell = { name: 'BillingShell', components: { Panel }, setup: () => ({ activeTab }),
  template: `<section><nav><button @click="activeTab = 'overview'">Overview</button><button @click="activeTab = 'records'">Records</button></nav><div v-show="activeTab === 'overview'"><Panel :active="activeTab === 'overview'" /></div><p v-show="activeTab === 'records'">Records fixture</p></section>` }
const router = createRouter({ history: createMemoryHistory(), routes: [
  { path: '/billing', name: 'billing', component: BillingShell },
  { path: '/other', name: 'other', component: { template: '<p>Other page</p>' } },
] })
const jwt = (sid, generation = 1) => `fixture.${btoa(JSON.stringify({ sid, generation }))}.fixture`
const app = createApp({
  setup() {
    const auth = useAuthStore(), theme = useThemeStore()
    auth.user = { id: 1, username: 'isolated-ui', role: 'admin' }; auth.token = jwt('a')
    setLocale('zh-CN'); theme.setTheme('light')
    window.expiryHarness = { pending, timers, activeTab, router, auth, theme, setLocale,
      session(sid, generation) { auth.token = jwt(sid, generation) },
      visibility(value) { visibility = value; document.dispatchEvent(new Event('visibilitychange')) },
      tick() { for (const [id, timer] of [...timers]) { timers.delete(id); timer.fn() } },
    }
  },
  template: `<main class="p-4 sm:p-6"><RouterView v-slot="{ Component, route }"><KeepAlive><component :is="Component" :key="route.name"/></KeepAlive></RouterView></main>`,
})
app.use(createPinia()); app.use(i18n); app.use(router)
await router.push('/billing'); await router.isReady(); app.mount('#app')
window.expiryHarness.unmount = () => app.unmount()
