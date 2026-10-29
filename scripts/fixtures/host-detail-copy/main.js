import { createApp, ref, nextTick } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import i18n, { setLocale } from '@/locales/index'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import { useToast } from '@/stores/toast'
import HostDetail from '@/views/resources/MyHostDetailView.vue'
import { pending } from './api.js'
import '@/styles/main.css'
const router = createRouter({ history: createMemoryHistory(), routes: [
  { path: '/hosts/:id', name: 'my-host-detail', component: { template: '<div/>' } },
  { path: '/admin/hosts/:id', name: 'admin-my-host-detail', component: { template: '<div/>' } },
  { path: '/elsewhere', name: 'elsewhere', component: { template: '<div/>' } },
] })
const app = createApp({ components: { HostDetail }, setup() {
  const component = ref(), active = ref(true), mounted = ref(true), auth = useAuthStore(), theme = useThemeStore()
  const session = (id = 1, sid = 'copy-session', role = 'admin', revision = 1) => {
    auth.user = { id, username: 'fixture', role, email: 'fixture@example.test' }
    auth.token = 'fixture.' + btoa(JSON.stringify({ sid, revision })) + '.fixture'
  }
  session(); setLocale('zh-CN'); theme.setTheme(new URLSearchParams(location.search).has('dark') ? 'dark' : 'light')
  window.hostDetailHarness = { pending, router, auth, theme, session, active, mounted, setLocale, toast: useToast(), t: (...args) => i18n.global.t(...args), view: () => component.value?.$?.setupState }
  if (new URLSearchParams(location.search).has('inspect')) queueMicrotask(async () => {
    const read = pending.at(-1)
    if (new URLSearchParams(location.search).has('read-error')) read?.reject(Error('fixture read failed'))
    else read?.resolve({ host: { id: 11, name: '测试宿主', countryCode: 'JP', status: 'online', certPath: '/fixture/cert', url: 'https://host.example.test' } })
    await nextTick()
    const v = component.value?.$?.setupState
    const params = new URLSearchParams(location.search)
    if (params.has('action-error')) { void v.testConnection(); pending.at(-1)?.reject(Error('fixture action failed')) }
    else if (params.has('delete-error')) { v.showDeleteModal = true; v.deleteConfirmName = v.host.name; void v.confirmDeleteHost(); pending.at(-1)?.reject(Error('fixture deletion failed')) }
    else if (!params.has('read-error')) { v.reinstallCommand = 'DISPLAY-ONLY reinstall command'; v.showReinstallModal = true }
    if (params.has('verify-error')) { void v.verifyAfterReinstall(); pending.at(-1)?.resolve({ success: false }) }
    if (new URLSearchParams(location.search).has('error')) v.reinstallCopyError = true
  })
  return { component, active, mounted }
}, template: '<main class="max-w-6xl mx-auto p-4"><KeepAlive v-if="mounted"><HostDetail v-if="active" ref="component"/></KeepAlive></main>' })
app.use(createPinia()); app.use(i18n); app.use(router); await router.push('/hosts/11'); await router.isReady(); app.mount('#app')
