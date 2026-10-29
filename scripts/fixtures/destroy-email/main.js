import { createApp, nextTick, reactive, ref } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import i18n, { setLocale } from '@/locales/index'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import Destroy from '@/components/instance/modals/DestroyInstanceModal.vue'
import Wallet from '@/views/WalletView.vue'
import Detail from '@/views/InstanceDetailView.vue'
import { pending } from './api.js'
import '@/styles/main.css'
const query = new URLSearchParams(location.search)
const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/wallet', component: Wallet },
  { path: '/instances/:id', name: 'instance-detail', component: Detail },
  { path: '/instances', name: 'instances', component: { template: '<p>Isolated instance list</p>' } },
  { path: '/', component: { template: '<p>Isolated instance confirmation</p>' } }] })
const app = createApp({ setup() {
  const auth = useAuthStore(), theme = useThemeStore(), component = ref()
  auth.user = { id: 1, username: 'isolated', role: 'user', email: 'isolated@example.test' }
  const session = sid => { auth.token = `fixture.${btoa(JSON.stringify({ sid }))}.fixture` }
  session('a'); setLocale(query.get('locale') || 'zh-CN'); theme.setTheme(query.has('dark') ? 'dark' : 'light')
  const state = reactive({ visible: !query.has('wallet'), loading: false, error: '', info: {
    canDestroy: true, cannotDestroyReason: '', isFreeInstance: true, isFirstTime: false, feeWaiverEligible: false,
    refund: { refundAmount: 0, feeAmount: 0 }, instance: { id: 1, name: 'Osaka server', hostName: 'Isolated host', planName: null },
  }, destroyed: [] })
  window.destroyHarness = { state, auth, theme, pending, session, setLocale, nextTick, router, view: () => component.value?.$?.setupState,
    dialog() { let node = document.querySelector('[role="dialog"]')?.__vueParentComponent
      while (node && node.setupState.emailCode === undefined) node = node.parent
      return node?.setupState
    } }
  return { state, component, pageView: query.has('wallet') || query.has('detail') }
}, components: { Destroy }, template: `<main class="mx-auto max-w-5xl p-6"><h1 class="text-2xl font-semibold">PayIncus</h1>
  <RouterView v-if="pageView" v-slot="{ Component }"><component :is="Component" ref="component"/></RouterView>
  <template v-else><button id="opener" type="button" class="btn-secondary mt-6" @click="state.visible = true">Osaka server</button>
    <Destroy ref="component" v-model:visible="state.visible" :destroy-info="state.info" :loading="state.loading" :error="state.error" region-label="大阪 / Osaka" @destroy="code => state.destroyed.push(code)"/>
  </template></main>` })
app.use(createPinia()); app.use(i18n); app.use(router); await router.push(query.has('wallet') ? '/wallet' : query.has('detail') ? '/instances/1' : '/'); await router.isReady(); app.mount('#app')
