import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createWebHistory } from 'vue-router'
import i18n, { setLocale } from '@/locales'
import HomepageMapDemo from '@/components/public/HomepageMapDemo.vue'
import PublicSiteHeader from '@/components/public/PublicSiteHeader.vue'
import { useThemeStore } from '@/stores/theme'
import { useConfigStore } from '@/stores/config'
import '@/styles/main.css'
import '@fontsource-variable/inter'
import 'flag-icons/css/flag-icons.min.css'

// Observe listener ownership without substituting the actual browser media query.
const nativeMatchMedia = window.matchMedia.bind(window), listeners = new Set()
window.matchMedia = query => {
  const media = nativeMatchMedia(query)
  if (query === '(prefers-color-scheme: dark)') {
    const add = media.addEventListener.bind(media), remove = media.removeEventListener.bind(media)
    media.addEventListener = (type, fn, ...args) => { if (type === 'change') listeners.add(fn); add(type, fn, ...args) }
    media.removeEventListener = (type, fn, ...args) => { if (type === 'change') listeners.delete(fn); remove(type, fn, ...args) }
  }
  return media
}
const router = createRouter({ history: createWebHistory(), routes: [
  { path: '/', component: { components: { HomepageMapDemo }, template: '<HomepageMapDemo :preview="false" />' } },
  { path: '/other', component: { components: { PublicSiteHeader }, template: '<PublicSiteHeader /><main style="padding:24px"><h1>创建实例</h1></main>' } }
] })
const app = createApp({ template: '<RouterView />' })
app.use(createPinia()); app.use(i18n); app.use(router)
const theme = useThemeStore(), config = useConfigStore()
config.loadPublicConfig = async () => {}; config.brandName = 'PayIncus'
config.brandSubtitle = ''; config.brandLogoUrl = '/incudal_logo.webp'
theme.init()
setLocale('zh-CN')
await router.isReady(); app.mount('#app')
window.themeHarness = { theme, router, setLocale, listeners, dispose: () => { app.unmount(); theme.$dispose() } }
