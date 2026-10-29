import { createApp, ref } from 'vue'
import { createPinia } from 'pinia'
import i18n, { setLocale } from '@/locales/index'
import { useThemeStore } from '@/stores/theme'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/stores/toast'
import HostImagesTab from '@/components/host/HostImagesTab.vue'
import { pending } from './api.js'
import { policy } from './data.js'
import '@/styles/main.css'
createApp({ setup() {
  const component = ref(), theme = useThemeStore(), auth = useAuthStore(), toast = useToast(), active = ref(true), mounted = ref(true)
  const host = ref({ id: 11, name: '东京测试宿主' })
  const session = (id = 1, sid = 'host-images-session', role = 'admin') => {
    auth.user = { id, username: 'fixture-account', role, email: 'fixture@example.test' }
    auth.token = 'fixture.' + btoa(JSON.stringify({ sid })) + '.fixture'
  }
  session(); setLocale('zh-CN'); theme.setTheme(new URLSearchParams(location.search).has('dark') ? 'dark' : 'light')
  if (new URLSearchParams(location.search).has('inspect')) queueMicrotask(() => {
    pending[0]?.resolve(policy())
  })
  window.hostImagesHarness = { pending, theme, auth, toast, active, mounted, host, session, setLocale, t: (...args) => i18n.global.t(...args), view: () => component.value?.$?.setupState }
  return { component, active, mounted, host }
}, components: { HostImagesTab }, template: '<main class="max-w-6xl mx-auto p-4"><header class="mb-4"><h1 class="text-xl font-semibold">PayIncus · {{ host.name }}</h1><p class="text-sm text-themed-secondary">测试宿主 · 受控镜像策略</p></header><KeepAlive v-if="mounted"><HostImagesTab v-if="active" :host-id="host.id" :host-name="host.name" ref="component"/></KeepAlive></main>' }).use(createPinia()).use(i18n).mount('#app')
