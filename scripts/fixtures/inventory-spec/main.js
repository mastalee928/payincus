import { createApp, ref } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import i18n, { setLocale } from '@/locales/index'
import { useThemeStore } from '@/stores/theme'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/stores/toast'
import HostInventoryPanel from '@/components/host/HostInventoryPanel.vue'
import { pending, reads } from './api.js'
import '@/styles/main.css'

const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
createApp({ setup() {
  const component = ref(), active = ref(true), mounted = ref(true), auth = useAuthStore(), toast = useToast(), theme = useThemeStore()
  const session = (id = 1, sid = 'inventory-session', role = 'admin', suffix = 'fixture') => {
    localStorage.setItem('token', 'fixture.' + btoa(JSON.stringify({ id, sid, role, exp: 9999999999 })) + '.' + suffix)
    auth.syncToken(); auth.user = { id, username: 'review-admin', email: 'review@example.invalid', role }
  }
  session(); setLocale('zh-CN'); theme.setTheme('light')
  const host = (id = 11, architecture = 'x86_64') => ({
    id, name: `PayIncus-${id}`, architecture, resourcePreset: architecture === 'aarch64' ? 'ARM1C' : 'E2', customerDiskGiB: 30,
    cpuAllowanceMax: 100, memoryMax: 1024, status: 'online', instanceCount: 0,
  })
  window.inventorySpec = { pending, reads, active, mounted, auth, toast, theme, session, setLocale, host,
    t: (...args) => i18n.global.t(...args), view: () => component.value?.$?.setupState }
  return { component, active, mounted }
}, components: { HostInventoryPanel }, template: '<main class="max-w-6xl mx-auto p-4"><h1 class="text-xl font-semibold mb-4">PayIncus · 机器池</h1><KeepAlive v-if="mounted"><HostInventoryPanel v-if="active" ref="component"/></KeepAlive></main>' })
  .use(createPinia()).use(i18n).use(router).mount('#app')
