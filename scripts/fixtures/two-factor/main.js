import { createApp, reactive, ref } from 'vue'
import { createPinia } from 'pinia'
import i18n, { setLocale } from '@/locales/index'
import { useThemeStore } from '@/stores/theme'
import TwoFactor from '@/components/profile/TwoFactorSection.vue'
import { pending } from './api.js'
import '@/styles/main.css'
const state = reactive({ mounted: true })
createApp({ setup() {
  const component = ref(), theme = useThemeStore(); theme.setTheme('light'); setLocale('zh-CN')
  window.twoFactorHarness = { state, pending, theme, setLocale, view: () => component.value.$.setupState }
  return { state, component }
}, components: { TwoFactor }, template: '<main class="kawaii-app-shell p-4 max-w-2xl mx-auto"><TwoFactor v-if="state.mounted" ref="component"/></main>' }).use(createPinia()).use(i18n).mount('#app')
