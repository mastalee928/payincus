import { createApp, nextTick } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createWebHistory } from 'vue-router'
import i18n, { setLocale } from '@/locales'
import HomepageMapDemo from '@/components/public/HomepageMapDemo.vue'
import { useThemeStore } from '@/stores/theme'
import { useConfigStore } from '@/stores/config'
import { useAuthStore } from '@/stores/auth'
import { fixture } from './api.js'
import '@/styles/main.css'
import '@fontsource-variable/inter'
import 'flag-icons/css/flag-icons.min.css'

const router = createRouter({ history: createWebHistory(), routes: [
  { path: '/', component: HomepageMapDemo, props: { preview: false } },
  { path: '/preview', component: HomepageMapDemo, props: { preview: true } },
  { path: '/purchase', component: { template: '<main>Local purchase destination</main>' } }
] })
const app = createApp({ template: '<RouterView />' })
app.use(createPinia()); app.use(i18n); app.use(router)
const theme = useThemeStore(), config = useConfigStore()
config.loadPublicConfig = async () => {}; config.brandName = 'PayIncus'; config.brandSubtitle = ''; config.brandLogoUrl = '/incudal_logo.webp'
theme.init(); setLocale('zh-CN')
if (new URLSearchParams(location.search).has('hold')) fixture.delay()
await router.isReady(); app.mount('#app')
window.cameraHarness = { theme, router, setLocale, fixture, config, auth: useAuthStore() }
// Let the visual inspector open the requested continent using the real UI action.
if (new URLSearchParams(location.search).get('inspect-continent') === 'europe') {
  await nextTick()
  document.querySelectorAll('.continent-tabs button')[2]?.click()
}
