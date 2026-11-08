import { createApp, reactive, computed, watch } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import i18n, { setLocale } from '@/locales/index'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import Info from '@/components/instance/InstanceInfoTab.vue'
import Modal from '@/components/instance/modals/AdminExpiryModal.vue'
import { expiryLocalInput, expiryUtcInput } from '@/utils/instance-expiry-date'
import { pending } from './api.js'
import '@/styles/main.css'
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
const query = new URLSearchParams(location.search)
const state = reactive({ open: query.has('inspect'), id: 41, sid: 'expiry-a', changed: 0,
  instance: { id: 41, expiryIdentity: { ownerId: 2, hostId: 3, incusId: 'vps-demo' }, name: 'seoul-amd-test', incusId: 'vps-demo', status: 'running', host: { name: 'seoul-amd-test' },
    image: 'Debian 13', created_at: '2026-11-08T04:00:00Z', expires_at: '2030-02-02T04:00:00.000Z',
    cpu: 200, memory: 4096, disk: 51200, network_mode: 'nat', ssh_port: 22, instance_type: 'container' } })
const app = createApp({ components: { Info, Modal }, setup() {
  watch([() => state.instance.expiryIdentity?.ownerId, () => state.instance.expiryIdentity?.hostId, () => state.instance.expiryIdentity?.incusId], () => {
    state.open = false
  }, { flush: 'sync' })
  const auth = useAuthStore(), theme = useThemeStore()
  const session = (sid = 'expiry-a', role = 'admin') => {
    state.sid = sid; auth.user = { id: 1, role, username: 'isolated-admin' }
    auth.token = 'fixture.' + btoa(JSON.stringify({ sid })) + '.fixture'; localStorage.setItem('token', auth.token)
  }
  session(); setLocale(query.get('locale') || 'zh-CN'); theme.setTheme(query.has('dark') ? 'dark' : 'light')
  const sessionKey = computed(() => `${state.sid}:${auth.user?.role}`)
  window.expiry = { state, auth, theme, pending, setLocale, session, expiryLocalInput, expiryUtcInput }
  return { state, auth, sessionKey, stats: { memory: { usage: 256, limit: 4096, usagePercent: 6.25 }, disk: { usage: 1024, limit: 51200, usagePercent: 2 } } }
  }, template: `<main class="max-w-5xl mx-auto p-4 text-themed"><h1 class="text-2xl font-semibold mb-2">PayIncus · seoul-amd-test</h1><p class="text-sm text-themed-muted mb-5">隔离测试实例 · 示例数据</p>
  <Info :instance="state.instance" :stats="stats" :stats-loading="false" :show-password="{}" :can-edit-expiry="auth.isAdmin" @edit-expiry="state.open=true" />
  <Modal v-if="state.open && auth.isAdmin" :instance-id="state.id" :owner-id="state.instance.expiryIdentity?.ownerId" :host-id="state.instance.expiryIdentity?.hostId" :incus-id="state.instance.expiryIdentity?.incusId" :instance-name="state.instance.name" :session-key="sessionKey" @close="state.open=false" @changed="state.changed++" />
  </main>` })
const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
app.use(createPinia()).use(i18n).use(router); await router.push('/'); await router.isReady(); app.mount('#app')
