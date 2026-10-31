import { createApp, reactive } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import i18n, { setLocale } from '@/locales/index'
import { useAuthStore } from '@/stores/auth'
import { useCartStore } from '@/stores/cart'
import { useConfigStore } from '@/stores/config'
import { useThemeStore } from '@/stores/theme'
import { useToast } from '@/stores/toast'
import CheckoutView from '@/views/CheckoutView.vue'
import PoolPurchaseWizard from '@/components/purchase/PoolPurchaseWizard.vue'
import { requests } from './api.js'
import '@/styles/main.css'
const state = reactive({ mounted: true }), router = createRouter({ history: createMemoryHistory(), routes: [
  { path: '/checkout', name: 'checkout', component: { components: { CheckoutView }, setup: () => ({ state }), template: '<CheckoutView v-if="state.mounted" />' } },
  { path: '/purchase', component: { components: { PoolPurchaseWizard }, setup: () => ({ state }), template: '<PoolPurchaseWizard v-if="state.mounted" />' } },
  { path: '/instances/:id', component: { template: '<p>Instance</p>' } }
] })
const app = createApp({ setup() {
  const auth = useAuthStore(), cart = useCartStore(), config = useConfigStore(), theme = useThemeStore()
  const account = (id, sid = 'a') => { const token = `fixture.${btoa(JSON.stringify({ id, role: 'user', sid }))}.fixture`; localStorage.setItem('token', token); auth.token = token; auth.user = { id, username: id === 1 ? 'seoul' : 'sydney', role: 'user' } }
  account(1); setLocale('zh-CN'); theme.setTheme('light'); config.loadPublicConfig = async () => {}; auth.fetchCurrentUser = async () => {}
  window.checkoutHarness = { requests, state, router, cart, auth, theme, account, setLocale, toast: useToast() }
}, template: '<main class="p-4 sm:p-6"><RouterView v-slot="{ Component }"><KeepAlive><component :is="Component" /></KeepAlive></RouterView></main>' })
app.use(createPinia()); app.use(i18n); app.use(router)
await router.push('/checkout'); await router.isReady(); app.mount('#app')
