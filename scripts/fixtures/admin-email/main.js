import { createApp, reactive } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import i18n, { setLocale } from '@/locales/index'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import Users from '@/views/admin/UsersView.vue'
import Modal from '@/components/admin/AdminUserEmailModal.vue'
import { pending, users } from './api.js'
import '@/styles/main.css'
import '@fontsource-variable/inter'
const state = reactive({ mounted: true }), query = new URLSearchParams(location.search)
const app = createApp({ components: { Users, Modal }, setup() {
  const auth = useAuthStore(), theme = useThemeStore()
  const session = (sid = 'email-a', role = 'admin') => {
    auth.user = { id: 1, role, username: 'isolated-admin' }
    auth.token = 'fixture.' + btoa(JSON.stringify({ sid })) + '.fixture'; localStorage.setItem('token', auth.token)
  }
  session(); setLocale(query.get('locale') || 'zh-CN'); theme.setTheme(query.has('dark') ? 'dark' : 'light')
  if (query.has('long-email')) users[1].email = 'a'.repeat(64) + '@' + 'b'.repeat(63) + '.' + 'c'.repeat(63) + '.' + 'd'.repeat(61)
  window.emailFixture = { state, auth, theme, setLocale, session, pending, users }
  return { state, inspect: query.has('inspect') }
}, template: `<main class="p-4 text-themed"><h1 class="text-xl font-semibold mb-2">PayIncus · 用户管理</h1><p class="text-sm text-gray-600 dark:text-gray-300 mb-4">本机隔离验证 · 示例用户</p><Users v-if="state.mounted && !inspect" />
  <Modal v-if="inspect" :user-id="42" username="seoul-customer" session-key="email-a" />
  </main>` })
const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
app.use(createPinia()).use(i18n).use(router); await router.push('/'); await router.isReady(); app.mount('#app')
