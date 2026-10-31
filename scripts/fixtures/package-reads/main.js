import { createApp, ref } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import i18n, { setLocale } from '@/locales/index'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import { useToast } from '@/stores/toast'
import Packages from '@/views/resources/MyPackagesView.vue'
import { pending } from './api.js'
import '@/styles/main.css'
const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/resources/packages', component: { template: '<div/>' } }, { path: '/other', component: { template: '<div/>' } }] })
await router.push('/resources/packages'); await router.isReady()
createApp({ components: { Packages }, setup() {
  const component = ref(), active = ref(true), auth = useAuthStore(), theme = useThemeStore(), toast = useToast()
  const session = (id = 1, sid = 'package-session') => {
    localStorage.setItem('token', `fixture.${btoa(JSON.stringify({ id, sid, role: 'user', exp: 9999999999 }))}.fixture`)
    auth.syncToken(); auth.user = { id, username: `review-${id}`, role: 'user' }
  }
  session(); setLocale('zh-CN'); theme.setTheme('light'); window.confirm = () => true
  let cached
  window.packageReads = { pending, active, auth, toast, session, router, view: () => component.value ? (cached = component.value.$.setupState) : cached }
  return { component, active }
}, template: '<main class="p-4"><KeepAlive><Packages v-if="active" ref="component"/></KeepAlive></main>' })
  .use(createPinia()).use(i18n).use(router).mount('#app')
