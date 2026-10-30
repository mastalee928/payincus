import { createApp, ref, nextTick } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import i18n, { setLocale } from '@/locales/index'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import { useToast } from '@/stores/toast'
import MyHosts from '@/views/resources/MyHostsView.vue'
import { pending } from './api.js'
import '@/styles/main.css'
localStorage.removeItem('token')
const jwt = sid => `fixture.${btoa(JSON.stringify({ sid }))}.fixture`
const router = createRouter({ history: createMemoryHistory(), routes: [
  { path: '/hosts', name: 'hosts-fixture', component: MyHosts },
  { path: '/other', name: 'other', component: { template: '<p>Other page</p>' } },
] })
const app = createApp({ setup() {
  const component = ref(), auth = useAuthStore(), theme = useThemeStore(), toast = useToast()
  auth.user = { id: 1, username: 'isolated-ui', role: 'admin' }; auth.token = jwt('session-a')
  setLocale('zh-CN'); theme.setTheme('light')
  window.hostCalibrationHarness = { auth, theme, toast, pending, router, nextTick, setLocale,
    newSession(sid) { auth.token = jwt(sid) }, view() { return component.value?.$?.setupState }, unmount() { app.unmount() } }
  return { component }
}, template: `<main class="p-4 sm:p-6"><RouterView v-slot="{ Component, route }"><KeepAlive><component :is="Component" :key="route.name" ref="component"/></KeepAlive></RouterView></main>` })
app.use(createPinia()); app.use(i18n); app.use(router)
await router.push('/hosts'); await router.isReady(); app.mount('#app')
