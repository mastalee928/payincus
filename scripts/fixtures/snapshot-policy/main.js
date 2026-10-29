import { createApp, ref } from 'vue'
import { createPinia } from 'pinia'
import i18n, { setLocale } from '@/locales/index'
import { useThemeStore } from '@/stores/theme'
import SnapshotManager from '@/components/SnapshotManager.vue'
import { pending } from './api.js'
import '@/styles/main.css'
createApp({ setup() {
  const component = ref(), instanceId = ref(1), theme = useThemeStore()
  setLocale('zh-CN'); theme.setTheme('light')
  window.snapshotHarness = { pending, theme, setLocale, instanceId, t: (...args) => i18n.global.t(...args), view: () => component.value?.$?.setupState }
  return { component, instanceId }
}, components: { SnapshotManager }, template: '<main class="p-4"><SnapshotManager ref="component" :instance-id="instanceId" instance-name="Isolated snapshot instance" instance-status="stopped" :snapshot-limit="3"/></main>' }).use(createPinia()).use(i18n).mount('#app')
