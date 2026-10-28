import { createApp, reactive } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import i18n, { setLocale } from '@/locales/index'
import { useThemeStore } from '@/stores/theme'
import TermsOfServiceModal from '@/components/TermsOfServiceModal.vue'
import '@/styles/main.css'

const state = reactive({ mounted: true, show: true }), pending = []
const realFetch = window.fetch.bind(window)
window.fetch = (input, options) => {
  if (typeof input !== 'string' || !input.startsWith('/tos/')) return realFetch(input, options)
  return new Promise((resolve, reject) => pending.push({ path: input, signal: options?.signal, resolve, reject }))
}
const router = createRouter({ history: createMemoryHistory(), routes: [
  { path: '/terms', name: 'terms', component: { components: { TermsOfServiceModal }, setup: () => ({ state }), template: '<TermsOfServiceModal v-if="state.mounted" :show="state.show" @close="state.show = false" />' } },
  { path: '/other', name: 'other', component: { template: '<p>Other page</p>' } }
] })
const app = createApp({ setup() {
  const theme = useThemeStore(); theme.setTheme('light'); setLocale('zh-CN')
  window.termsHarness = { state, pending, theme, setLocale, router, t: (...args) => i18n.global.t(...args) }
}, template: '<main><RouterView v-slot="{ Component, route }"><KeepAlive><component :is="Component" :key="route.name" /></KeepAlive></RouterView></main>' })
app.use(createPinia()); app.use(i18n); app.use(router)
await router.push('/terms'); await router.isReady(); app.mount('#app')
