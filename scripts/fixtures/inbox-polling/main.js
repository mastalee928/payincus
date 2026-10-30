import { createApp, ref } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import i18n from '@/locales/index'
import { useAuthStore } from '@/stores/auth'
import { useInboxStore } from '@/stores/inbox'
import AppLayout from '@/components/layout/AppLayout.vue'
import { pending } from './api.js'
import '@/styles/main.css'
const timers = new Map(), listeners = new Set()
const originalSetInterval = window.setInterval.bind(window), originalClearInterval = window.clearInterval.bind(window)
window.setInterval = (callback, delay, ...args) => {
  if (delay !== 15000) return originalSetInterval(callback, delay, ...args)
  const id = originalSetInterval(() => {}, 3600000); timers.set(id, () => callback(...args)); return id
}
window.clearInterval = id => { timers.delete(id); originalClearInterval(id) }
const originalAdd = document.addEventListener.bind(document), originalRemove = document.removeEventListener.bind(document)
document.addEventListener = (name, handler, options) => { if (name === 'visibilitychange') listeners.add(handler); originalAdd(name, handler, options) }
document.removeEventListener = (name, handler, options) => { if (name === 'visibilitychange') listeners.delete(handler); originalRemove(name, handler, options) }
window.fetch = async () => new Response(JSON.stringify({ recoveryHeld: false }), { headers: { 'Content-Type': 'application/json' } })
const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/inbox', component: { template: '<div/>' } }] })
await router.push('/inbox')
createApp({ setup() {
  const auth = useAuthStore(), inbox = useInboxStore(), mounted = ref(false)
  const session = (id = 1, sid = 'polling-session', role = 'user') => {
    auth.user = { id, username: 'fixture-account', email: 'fixture@example.test', role }
    auth.token = 'fixture.' + btoa(JSON.stringify({ sid })) + '.fixture'
  }
  session()
  window.pollingHarness = { auth, inbox, session, mounted, pending, timers, listeners, tick: () => [...timers.values()].forEach(callback => callback()) }
  return { mounted, inbox }
}, components: { AppLayout }, template: '<AppLayout v-if="mounted"><p>通知中心</p></AppLayout><output id="unread">{{ inbox.unreadCount }}</output>' })
  .use(createPinia()).use(router).use(i18n).mount('#app')
