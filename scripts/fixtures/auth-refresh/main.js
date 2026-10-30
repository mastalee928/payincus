import { createApp } from 'vue'
import { createPinia } from 'pinia'
import axios from 'axios'
const pending = [], refreshes = []
const token = (id = 1, sid = 'refresh-session', role = 'user', expires = 7 * 86400, marker = '') =>
  'fixture.' + btoa(JSON.stringify({ id, sid, role, exp: Math.floor(Date.now() / 1000) + expires, marker })) + '.fixture'
localStorage.removeItem('token')
axios.defaults.adapter = config => new Promise((resolve, reject) => pending.push({ config,
  resolve: data => resolve({ data, status: 200, statusText: 'OK', headers: {}, config }),
  reject: status => reject({ config, response: { status, data: { error: 'Controlled unauthorized', code: 'UNAUTHORIZED' } } }) }))
window.fetch = (url, options) => new Promise((resolve, reject) => {
  const row = { url, options, resolve: (value, status = 200) => resolve(new Response(JSON.stringify(value), { status })), reject }
  refreshes.push(row); options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
})
const { default: userApi } = await import('@/api')
const { default: adminApi } = await import('@/api/admin')
const { useAuthStore } = await import('@/stores/auth')
createApp({ setup() {
  const auth = useAuthStore()
  const session = (id = 1, sid = 'refresh-session', role = 'user', expires = 7 * 86400, marker = '') => {
    localStorage.setItem('token', token(id, sid, role, expires, marker)); auth.syncToken()
    auth.user = { id, username: 'fixture-account', email: 'fixture@example.test', role }; auth.quota = { hostLimit: id }
  }
  session()
  window.refreshHarness = { auth, userApi, adminApi, pending, refreshes, session, token, results: [], errors: [],
    start(client = 'user') { void (client === 'user' ? userApi : adminApi).instances.start(1).then(value => this.results.push(value)).catch(error => this.errors.push(error.code || error.message || 'failure')) } }
}, template: '<p>刷新隔离测试</p>' }).use(createPinia()).mount('#app')
