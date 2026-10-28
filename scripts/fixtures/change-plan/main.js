import { createApp, reactive, watch } from 'vue'
import { createPinia } from 'pinia'
import i18n, { setLocale } from '@/locales/index'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import { useToast } from '@/stores/toast'
import ChangePlan from '@/components/instance/modals/ChangePlanModal.vue'
import { pending } from './api.js'
import '@/styles/main.css'
const state = reactive({ show: false, mounted: true, instanceId: 10, packageId: 1, currentPlanId: 1 })
const jwt = (sid, iat = 1) => `fixture.${btoa(JSON.stringify({ sid, iat }))}.fixture`
const app = createApp({ components: { ChangePlan }, setup() {
  const auth = useAuthStore(), theme = useThemeStore(), toast = useToast()
  const events = [], toasts = [], seen = new Set()
  auth.user = { id: 1, username: 'fixture', role: 'user' }; auth.token = jwt('a')
  setLocale('zh-CN'); theme.setTheme('light')
  watch(() => toast.toasts.value.map(item => ({ id: item.id, type: item.type, message: item.message })), items => {
    for (const item of items) if (!seen.has(item.id)) { seen.add(item.id); toasts.push(item) }
  }, { flush: 'sync' })
  const close = value => events.push(['show', value]), success = () => events.push(['success'])
  window.changePlanHarness = { state, pending, auth, theme, toasts, events, setLocale,
    session: sid => { auth.token = sid ? jwt(sid) : null }, refresh: () => { auth.token = jwt('a', 2) },
    view() {
      let current = document.querySelector('h3')?.__vueParentComponent
      while (current && !current.setupState?.loadPlans) current = current.parent
      return current?.setupState
    },
  }
  return { state, close, success }
}, template: '<main><ChangePlan v-if="state.mounted" :show="state.show" :instance-id="state.instanceId" :package-id="state.packageId" :current-plan-id="state.currentPlanId" instance-name="Fixture VPS" @update:show="close" @success="success"/></main>' })
app.use(createPinia()); app.use(i18n); app.mount('#app')
