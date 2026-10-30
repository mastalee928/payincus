import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import { pending } from './api.js'
localStorage.removeItem('token')
createApp({ setup() {
  const auth = useAuthStore()
  const session = (id = 1, sid = 'auth-session', role = 'user', marker = '') => {
    const token = 'fixture.' + btoa(JSON.stringify({ id, sid, role, marker })) + '.fixture'
    localStorage.setItem('token', token); auth.syncToken()
    auth.user = { id, username: `fixture-account-${id}`, email: 'fixture@example.test', role, avatarStyle: 'bigSmile' }
    auth.quota = { hostLimit: id }
  }
  session()
  window.authHarness = { auth, pending, session, results: [], errors: [], user: (id = 1, role = 'user') => ({ id, username: `fixture-account-${id}`, email: 'fixture@example.test', role, quota: { hostLimit: id } }) }
  return { auth }
}, template: '<p>身份读取测试</p><output>{{ auth.user?.id }}</output>' }).use(createPinia()).mount('#app')
