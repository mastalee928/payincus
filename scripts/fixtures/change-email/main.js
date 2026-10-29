import { createApp, reactive, ref, watch } from 'vue'
import { createPinia } from 'pinia'
import i18n, { setLocale } from '@/locales/index'
import { useThemeStore } from '@/stores/theme'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/stores/toast'
import ChangeEmail from '@/components/profile/ChangeEmailModal.vue'
import { pending } from './api.js'
import '@/styles/main.css'
const state = reactive({ mounted: true, show: true, closes: 0, updates: [] })
const jwt = (sid, iat = 1) => `fixture.${btoa(JSON.stringify({ sid, iat }))}.fixture`
let cached
createApp({ setup() {
  const component = ref(), theme = useThemeStore(), auth = useAuthStore(); theme.setTheme('light'); setLocale('zh-CN')
  auth.user = { id: 1, username: 'fixture', role: 'user', email: 'original@example.test' }; auth.token = jwt('a')
  const toast = useToast(), toasts = [], seen = new Set()
  watch(() => toast.toasts.value, items => { for (const item of items) if (!seen.has(item.id)) { seen.add(item.id); toasts.push(item.message) } }, { flush: 'sync', deep: true })
  window.emailHarness = { state, pending, theme, auth, toasts, setLocale, session(sid, iat = 1) { auth.token = sid ? jwt(sid, iat) : null },
    view() { if (component.value) cached = component.value.$.setupState; return cached } }
  return { state, component }
}, components: { ChangeEmail }, template: '<main class="kawaii-app-shell p-4"><ChangeEmail v-if="state.mounted" ref="component" :show="state.show" @close="state.closes++" @updated="state.updates.push($event)"/></main>' }).use(createPinia()).use(i18n).mount('#app')
