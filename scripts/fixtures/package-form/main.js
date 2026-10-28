import { createApp, nextTick } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import i18n, { setLocale } from '@/locales/index'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import { useToast } from '@/stores/toast'
import PackageForm from '@/views/resources/PackageFormView.vue'
import { pending } from './api.js'
import '@/styles/main.css'

localStorage.removeItem('token')
const jwt = (sid, generation = 1) => `fixture.${btoa(JSON.stringify({ sid, generation }))}.fixture`
const router = createRouter({ history: createMemoryHistory(), routes: [
  { path: '/resources/packages/:id/edit', name: 'my-package-edit', component: PackageForm },
  { path: '/resources/packages/create', name: 'my-package-create', component: PackageForm },
  { path: '/resources/packages', name: 'my-packages', component: { template: '<p>Package list fixture</p>' } },
  { path: '/other', name: 'other', component: { template: '<p>Other page fixture</p>' } },
] })
const app = createApp({
  setup() {
    const auth = useAuthStore(), theme = useThemeStore(), toast = useToast()
    auth.user = { id: 1, username: 'isolated-ui', role: 'admin' }; auth.token = jwt('session-a')
    setLocale('zh-CN'); theme.setTheme('light')
    window.packageHarness = { pending, router, auth, theme, toast, nextTick, setLocale,
      newSession(sid) { auth.token = jwt(sid) }, refreshSession(sid) { auth.token = jwt(sid, 2) },
    }
  },
  // Same route-name key and KeepAlive exclusion as the actual App shell.
  template: `<main class="p-4 sm:p-6"><RouterView v-slot="{ Component, route }"><KeepAlive :exclude="['PackageFormView']"><component :is="Component" :key="route.name"/></KeepAlive></RouterView></main>`,
})
app.use(createPinia()); app.use(i18n); app.use(router)
await router.push('/resources/packages/1/edit')
await router.isReady()
app.mount('#app')
