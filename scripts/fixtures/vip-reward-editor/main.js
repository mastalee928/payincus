import { createApp, reactive, watch } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import i18n, { setLocale } from '@/locales/index'
import { useThemeStore } from '@/stores/theme'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/stores/toast'
import VipBenefitHallSettings from '@/components/admin/VipBenefitHallSettings.vue'
import VipLevelRulesEditor from '@/components/admin/VipLevelRulesEditor.vue'
import { pending } from './api.js'
import '@/styles/main.css'
const state = reactive({ editorVisible: true, rules: new URLSearchParams(location.search).has('rules'), ruleType: 'user' })
const router = createRouter({ history: createMemoryHistory(), routes: [
  { path: '/rewards', name: 'rewards', component: { components: { VipBenefitHallSettings, VipLevelRulesEditor }, setup: () => ({ state }), template: '<template v-if="state.editorVisible"><VipLevelRulesEditor v-if="state.rules" :type="state.ruleType"/><VipBenefitHallSettings v-else/></template>' } },
  { path: '/other', name: 'other', component: { template: '<p>Other page</p>' } }
] })
const jwt = sid => `fixture.${btoa(JSON.stringify({ sid }))}.fixture`
const app = createApp({ setup() {
  const theme = useThemeStore(), auth = useAuthStore(), toast = useToast()
  const toastEvents = [], seenToasts = new Set()
  watch(() => toast.toasts.value.map(item => ({ id: item.id, type: item.type, message: item.message })), items => {
    for (const item of items) if (!seenToasts.has(item.id)) { seenToasts.add(item.id); toastEvents.push(item) }
  }, { flush: 'sync' })
  auth.user = { id: 1, username: 'fixture', role: 'admin' }; auth.token = jwt('a')
  setLocale('zh-CN'); theme.setTheme('light')
  window.vipHarness = { pending, theme, auth, state, router, toastEvents, setLocale, session: sid => { auth.token = jwt(sid) }, t: (...args) => i18n.global.t(...args) }
}, template: '<main class="p-4 sm:p-6"><RouterView v-slot="{ Component, route }"><KeepAlive><component :is="Component" :key="route.name"/></KeepAlive></RouterView></main>' })
app.use(createPinia()); app.use(i18n); app.use(router)
await router.push('/rewards'); await router.isReady(); app.mount('#app')
