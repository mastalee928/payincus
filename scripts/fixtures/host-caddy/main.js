import { createApp, ref } from 'vue'
import { createPinia } from 'pinia'
import i18n, { setLocale } from '@/locales/index'
import { useThemeStore } from '@/stores/theme'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/stores/toast'
import HostCaddyTab from '@/components/host/HostCaddyTab.vue'
import { pending } from './api.js'
import { status, sites } from './data.js'
import '@/styles/main.css'
createApp({ setup() {
  const component = ref(), theme = useThemeStore(), auth = useAuthStore(), toast = useToast(), active = ref(true), mounted = ref(true)
  const host = ref({ id: 11, name: '东京测试宿主' })
  const session = (id = 1, sid = 'host-caddy-session', role = 'admin') => {
    auth.user = { id, username: 'fixture-account', role, email: 'fixture@example.test' }
    auth.token = 'fixture.' + btoa(JSON.stringify({ sid })) + '.fixture'
  }
  session(); setLocale('zh-CN'); theme.setTheme(new URLSearchParams(location.search).has('dark') ? 'dark' : 'light')
  if (new URLSearchParams(location.search).has('inspect')) {
    const timer = setInterval(() => {
      for (const request of pending) if (!request.settled) {
        request.settled = true
        if (request.kind === 'status') new URLSearchParams(location.search).has('error') ? request.reject(Error('测试读取失败')) : request.resolve(status())
        if (request.kind === 'sites') request.resolve(sites(request.data.page))
      }
    }, 50)
    window.addEventListener('beforeunload', () => clearInterval(timer), { once: true })
  }
  window.hostCaddyHarness = { pending, theme, auth, toast, active, mounted, host, session, setLocale, t: (...args) => i18n.global.t(...args), view: () => component.value?.$?.setupState }
  return { component, active, mounted, host }
}, components: { HostCaddyTab }, template: '<main class="max-w-6xl mx-auto p-4"><header class="mb-4"><h1 class="text-xl font-semibold">PayIncus · {{ host.name }}</h1><p class="text-sm text-themed-secondary">测试宿主 · 受控Caddy站点</p></header><KeepAlive v-if="mounted"><HostCaddyTab v-if="active" :host-id="host.id" ref="component"/></KeepAlive></main>' }).use(createPinia()).use(i18n).mount('#app')
