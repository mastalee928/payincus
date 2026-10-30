import { createApp, ref } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import i18n, { setLocale } from '@/locales/index'
import { useThemeStore } from '@/stores/theme'
import { useAuthStore } from '@/stores/auth'
import { useInboxStore } from '@/stores/inbox'
import { useToast } from '@/stores/toast'
import InboxView from '@/views/InboxView.vue'
import { pending } from './api.js'
import '@/styles/main.css'
const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/inbox', component: { template: '<div/>' } }, { path: '/away', component: { template: '<div/>' } }] })
await router.push('/inbox')
createApp({ setup() {
  const component = ref(), theme = useThemeStore(), auth = useAuthStore(), inbox = useInboxStore(), toast = useToast(), active = ref(true), mounted = ref(true)
  const session = (id = 1, sid = 'inbox-session', role = 'user') => {
    auth.user = { id, username: 'fixture-account', role, email: 'fixture@example.test' }
    auth.token = 'fixture.' + btoa(JSON.stringify({ sid })) + '.fixture'
  }
  session(); setLocale('zh-CN'); theme.setTheme('light'); window.confirm = () => true
  if (new URLSearchParams(location.search).has('dark')) theme.setTheme('dark')
  if (new URLSearchParams(location.search).has('inspect')) {
    const timer = setInterval(() => {
      for (const request of pending) if (!request.settled) {
        request.settled = true
        if (request.kind === 'list') request.resolve({ messages: Array.from({ length: 4 }, (_, index) => ({ id: index + 1, userId: 1, isRead: false,
          eventType: 'system', title: ['续费完成', '实例已就绪', '备份任务失败', '工单收到回复'][index], content: ['续费账单已完成，请在实例页面查看到期时间。', '实例已完成配置，可在控制台查看连接信息。', '本次备份失败，请查看备份任务记录后重试。', '您的工单收到回复，请查看工单详情。'][index], data: null, createdAt: '2026-10-29T00:00:00Z' })), total: 4, page: 1, pageSize: 20, totalPages: 1 })
        else if (request.kind === 'unread') request.resolve({ count: 4 })
        else request.reject(Error('受控测试写入失败，请重试'))
      }
    }, 50)
    window.addEventListener('beforeunload', () => clearInterval(timer), { once: true })
  }
  window.inboxHarness = { pending, theme, auth, inbox, toast, active, mounted, session, setLocale, router, t: (...args) => i18n.global.t(...args), view: () => component.value?.$?.setupState }
  return { component, active, mounted }
}, components: { InboxView }, template: '<main class="max-w-6xl mx-auto p-4"><KeepAlive v-if="mounted"><InboxView v-if="active" ref="component"/></KeepAlive></main>' }).use(createPinia()).use(i18n).use(router).mount('#app')
