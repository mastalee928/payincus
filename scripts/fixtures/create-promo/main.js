import { createApp, reactive } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import i18n, { setLocale } from '@/locales/index'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import Create from '@/views/InstanceCreateView.vue'
import { pending, calls } from './api.js'
import '@/styles/main.css'
const state = reactive({ mounted: true })
const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/instances/create', component: Create }, { path: '/other', component: { template: '<p>Other fixture</p>' } }, { path: '/instances', component: { template: '<p>Instances fixture</p>' } }] })
const jwt = (sid, iat = 1) => `fixture.${btoa(JSON.stringify({ sid, iat }))}.fixture`
let cachedView
const app = createApp({ setup() {
  const auth = useAuthStore(), theme = useThemeStore()
  auth.user = { id: 1, username: 'fixture', role: 'user' }; auth.token = jwt('a'); setLocale('zh-CN'); theme.setTheme('light')
  window.promoHarness = { state, auth, theme, pending, calls, router, setLocale,
    session(sid, iat = 1) { auth.token = sid ? jwt(sid, iat) : null },
    view() {
      let current = document.querySelector('.kawaii-page')?.__vueParentComponent
      while (current && !current.setupState?.verifyPromoCode) current = current.parent
      if (current) cachedView = current.setupState
      return cachedView
    },
    seed() {
      const v = this.view()
      v.packages = [{ id: 1, name: 'Fixture package', active: 1, soldOut: false, sourceType: 'official', cpu_max: 200, memory_max: 4096, disk_max: 40960, host_ids: [], quotaInfo: null }]
      v.packagePlans = [1, 2].map(id => ({ id, name: `Plan ${id}`, price: 1000, monthlyPrice: 1000, billingCycle: 1, cpu: 100, memory: 512, disk: 5120, isActive: true, isSoldOut: false, setupFee: 0, trafficLimit: '0', trafficLimitSpeed: '0' }))
      v.form.packageId = 1; v.form.planId = 1; v.form.promoCode = ''; v.packageSource = 'official'
    },
  }
  return { state }
}, template: '<main class="max-w-6xl mx-auto p-4"><RouterView v-slot="{ Component }"><KeepAlive v-if="state.mounted"><component :is="Component"/></KeepAlive></RouterView></main>' })
app.use(createPinia()); app.use(i18n); app.use(router); await router.push('/instances/create?source=zone&zoneId=7'); await router.isReady(); app.mount('#app')
