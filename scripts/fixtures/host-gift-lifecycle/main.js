import { createApp, reactive } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import i18n, { setLocale } from '@/locales/index'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import Instances from '@/components/host/HostInstancesTab.vue'
import { pending } from './api.js'
import '@/styles/main.css'
const state = reactive({ mounted: true, active: true, id: 1 })
const jwt = (sid, iat = 1) => `fixture.${btoa(JSON.stringify({ sid, iat }))}.fixture`
let cachedView
const app = createApp({ components: { Instances }, setup() {
  const auth = useAuthStore(), theme = useThemeStore()
  auth.user = { id: 1, username: 'fixture', role: 'admin' }; auth.token = jwt('a'); setLocale('zh-CN'); theme.setTheme('light')
  window.hostGift = { state, auth, theme, pending, setLocale,
    session(sid, iat = 1) { auth.token = sid ? jwt(sid, iat) : null },
    view() {
      let current = document.querySelector('#app main > div')?.__vueParentComponent
      while (current && !current.setupState?.loadInstances) current = current.parent
      if (current) cachedView = current.setupState
      return cachedView
    },
  }
  return { state }
}, template: '<main class="max-w-7xl mx-auto p-4"><KeepAlive v-if="state.mounted"><Instances v-if="state.active" :host-id="state.id" host-name="Fixture host"/></KeepAlive></main>' })
const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div/>' } }] })
app.use(createPinia()); app.use(i18n); app.use(router); await router.push('/'); await router.isReady(); app.mount('#app')

