import { createApp, ref } from 'vue'
import { createPinia } from 'pinia'
import i18n, { setLocale } from '@/locales/index'
import { useThemeStore } from '@/stores/theme'
import SSHKeysSection from '@/components/profile/SSHKeysSection.vue'
import { pending } from './api.js'
import '@/styles/main.css'
createApp({ setup() {
  const component = ref(), theme = useThemeStore(); setLocale('zh-CN'); theme.setTheme('light')
  window.sshHarness = { pending, theme, setLocale, view: () => component.value?.$?.setupState }
  return { component }
}, components: { SSHKeysSection }, template: '<main class="max-w-3xl mx-auto p-4"><SSHKeysSection ref="component"/></main>' }).use(createPinia()).use(i18n).mount('#app')
