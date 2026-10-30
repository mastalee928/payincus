import { createApp, ref, onMounted, nextTick } from 'vue'
import { createPinia } from 'pinia'
import i18n, { setLocale } from '@/locales/index'
import { useThemeStore } from '@/stores/theme'
import { useAuthStore } from '@/stores/auth'
import NotificationSection from '@/components/profile/NotificationSection.vue'
import { pending } from './api.js'
import '@/styles/main.css'
localStorage.removeItem('token')
createApp({ setup() {
  const component = ref(), auth = useAuthStore(), theme = useThemeStore(), active = ref(true), mounted = ref(true)
  const session = (id = 1, sid = 'notification-session', role = 'user') => {
    localStorage.setItem('token', 'fixture.' + btoa(JSON.stringify({ id, sid, role })) + '.fixture'); auth.syncToken()
    auth.user = { id, username: 'fixture-account', email: 'fixture@example.test', role }
  }
  const query = new URLSearchParams(location.search)
  session(); theme.setTheme(query.get('theme') === 'dark' ? 'dark' : 'light'); setLocale('zh-CN')
  window.notificationHarness = { component, auth, theme, active, mounted, session, pending, setLocale, view: () => component.value?.$?.setupState }
  if (query.get('preview') === 'history') onMounted(async () => {
    await nextTick()
    pending[0].resolve({ channels: [{ id: 1, name: '实例到期通知', type: 'telegram', enabled: true, configPreview: '已配置' }] })
    void component.value.$.setupState.openHistory()
    const rows = ['failed', 'sent', 'pending'].map((status, index) => ({ id: index + 1, channelId: 1, channelName: '实例到期通知', channelType: 'telegram', eventType: 'instance_expiring', message: '实例即将到期，请及时续费。', status, error: status === 'failed' ? '专用测试通知发送失败' : null, createdAt: '2026-10-30T09:00:00.000Z' }))
    pending.find(r => r.kind === 'logs').resolve({ logs: rows, total: rows.length, page: 1, pageSize: 10 })
    pending.find(r => r.kind === 'stats').resolve({ stats: { total: 3, failed: 1, sent: 1, pending: 1 } })
  })
  return { component, active, mounted }
}, components: { NotificationSection }, template: '<main class="max-w-6xl mx-auto p-4"><h1 class="text-xl mb-4">PayIncus · 通知设置</h1><KeepAlive v-if="mounted"><NotificationSection v-if="active" ref="component"/></KeepAlive></main>' })
  .use(createPinia()).use(i18n).mount('#app')
