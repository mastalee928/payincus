import { createApp, ref } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import i18n, { setLocale } from '@/locales/index'
import { useThemeStore } from '@/stores/theme'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/stores/toast'
import HostOnboardingView from '@/views/admin/HostOnboardingView.vue'
import { pending, reads, creates, inventory } from './api.js'
import '@/styles/main.css'
const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: { template: '<div />' } }] })
await router.push('/')
createApp({ setup() {
  const component = ref(), active = ref(true), auth = useAuthStore(), toast = useToast(), theme = useThemeStore()
  const session = (id = 1, sid = 'protocol-session', role = 'admin') => {
    localStorage.setItem('token', 'fixture.' + btoa(JSON.stringify({ id, sid, role, exp: 9999999999 })) + '.fixture')
    auth.syncToken(); auth.user = { id, username: 'review-admin', email: 'review@example.invalid', role }
  }
  session(); setLocale('zh-CN'); theme.setTheme('light')
  window.protocolTest = { pending, reads, creates, inventory, active, auth, toast, theme, session, router,
    t: (...args) => i18n.global.t(...args), view: () => component.value?.$?.setupState }
  return { component, active }
}, components: { HostOnboardingView }, template: '<main class="max-w-6xl mx-auto p-4"><KeepAlive><HostOnboardingView v-if="active" ref="component"/></KeepAlive></main>' })
  .use(createPinia()).use(i18n).use(router).mount('#app')
