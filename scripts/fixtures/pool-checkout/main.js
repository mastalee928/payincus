import { createApp, reactive } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory, createWebHistory } from 'vue-router'
import i18n, { setLocale } from '@/locales/index'
import { useAuthStore } from '@/stores/auth'
import { useCartStore } from '@/stores/cart'
import { useConfigStore } from '@/stores/config'
import { useThemeStore } from '@/stores/theme'
import { useToast } from '@/stores/toast'
import CheckoutView from '@/views/CheckoutView.vue'
import OrdersView from '@/views/OrdersView.vue'
import PoolPurchaseWizard from '@/components/purchase/PoolPurchaseWizard.vue'
import ManualControls from './ManualControls.vue'
import CheckoutRefundsPanel from '@/components/CheckoutRefundsPanel.vue'
import PaymentMethodIcon from '@/components/PaymentMethodIcon.vue'
import { requests } from './api.js'
import '@/styles/main.css'
const manual = new URLSearchParams(location.search).has('manual') || sessionStorage.getItem('fixture.manual') === '1'
if (manual) sessionStorage.setItem('fixture.manual','1')
const state = reactive({ mounted: true }), router = createRouter({ history: manual ? createWebHistory() : createMemoryHistory(), routes: [
  { path: '/checkout', name: 'checkout', component: { components: { CheckoutView }, setup: () => ({ state }), template: '<CheckoutView v-if="state.mounted" />' } },
  { path: '/purchase', component: { components: { PoolPurchaseWizard }, setup: () => ({ state }), template: '<PoolPurchaseWizard v-if="state.mounted" />' } },
  { path: '/orders', component: OrdersView },
  { path: '/refund-preview', component: { components: { CheckoutRefundsPanel }, template: '<div style="max-width:900px;margin:auto"><h1>退款处理 · 本地预览</h1><CheckoutRefundsPanel active /></div>' } },
  { path: '/payment-icons-preview', component: { components: { PaymentMethodIcon }, setup:()=>({methods:[['alipay','支付宝'],['wxpay','微信支付'],['USDT-Polygon','Polygon'],['USDT-BSC','BSC'],['USDT-TRC20','USDT · TRC20'],['USDT-ERC20','ERC20'],['USDT-ArbitrumOne','Arbitrum']]}), template: '<section style="max-width:1000px;margin:40px auto;color:var(--text-primary)"><h1 style="font-size:24px;margin-bottom:32px">支付标识</h1><div style="display:flex;gap:40px;align-items:center;flex-wrap:wrap;margin-bottom:40px"><div style="background:#09090b;color:#fafafa;padding:24px;display:flex;align-items:center;gap:24px"><PaymentMethodIcon method="alipay" style="width:144px;height:144px;flex-basis:144px"/><PaymentMethodIcon method="alipay"/><span>支付宝</span></div><div style="background:#fafafa;color:#09090b;padding:24px;display:flex;align-items:center;gap:24px"><PaymentMethodIcon method="alipay" style="width:144px;height:144px;flex-basis:144px"/><PaymentMethodIcon method="alipay"/><span>支付宝</span></div></div><div style="display:flex;gap:32px;flex-wrap:wrap;align-items:center"><div v-for="[method,label] in methods" :key="method" style="display:flex;align-items:center;gap:12px;font-size:20px"><PaymentMethodIcon :method="method" style="width:40px;height:40px;flex-basis:40px" /><span>{{label}}</span></div></div><p style="margin-top:36px;font-size:14px;color:var(--text-secondary)">结算页实际尺寸</p><div style="display:flex;gap:24px;flex-wrap:wrap;margin-top:20px"><div v-for="[method,label] in methods" :key="method" style="display:flex;align-items:center;gap:12px;font-size:14px"><PaymentMethodIcon :method="method" /><span>{{label}}</span></div></div></section>' } },
  { path: '/order/confirm', component: { components: { CheckoutView }, setup: () => ({ state }), template: '<CheckoutView v-if="state.mounted" />' } },
  { path: '/instances/:id', component: { template: '<p>Instance</p>' } }
] })
const app = createApp({ components: { ManualControls }, setup() {
  const auth = useAuthStore(), cart = useCartStore(), config = useConfigStore(), theme = useThemeStore()
  const account = (id, sid = 'a') => { const token = `fixture.${btoa(JSON.stringify({ id, role: 'user', sid }))}.fixture`; localStorage.setItem('token', token); auth.token = token; auth.user = { id, username: id === 1 ? 'seoul' : 'sydney', role: 'user' } }
  account(1); setLocale('zh-CN'); theme.setTheme('light'); config.loadPublicConfig = async () => {}; auth.fetchCurrentUser = async () => {}
  window.checkoutHarness = { requests, state, router, cart, auth, theme, account, setLocale, toast: useToast() }
  return { manual, controls: window.checkoutHarness }
}, template: '<main class="p-4 sm:p-6"><ManualControls v-if="manual" :controls="controls" /><RouterView v-slot="{ Component }"><KeepAlive><component :is="Component" /></KeepAlive></RouterView></main>' })
app.use(createPinia()); app.use(i18n); app.use(router)
await router.push(manual && location.pathname !== '/' ? location.pathname + location.search : '/checkout' + (manual ? '?manual=1' : '')); await router.isReady(); app.mount('#app')
