import { createApp, ref } from 'vue'
import { createPinia } from 'pinia'
import i18n, { setLocale } from '@/locales/index'
import { useThemeStore } from '@/stores/theme'
import OAuthConfigView from '@/views/admin/OAuthConfigView.vue'
import { calls } from './api.js'
import '@/styles/main.css'
createApp({ components: { OAuthConfigView }, setup() {
  const view = ref(), theme = useThemeStore(); theme.setTheme('light'); setLocale('zh-CN')
  window.oauthLocaleHarness = { setLocale, theme, calls, t: (...args) => i18n.global.t(...args), view: () => view.value?.$.setupState }
  return { view }
}, template: '<main class="kawaii-app-shell p-4 sm:p-6"><OAuthConfigView ref="view" /></main>' }).use(createPinia()).use(i18n).mount('#app')
