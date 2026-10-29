import { createApp, ref } from 'vue'
import { createPinia } from 'pinia'
import i18n, { setLocale } from '@/locales/index'
import { useThemeStore } from '@/stores/theme'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/stores/toast'
import SnapshotManager from '@/components/SnapshotManager.vue'
import { pending } from './api.js'
import '@/styles/main.css'
createApp({ setup() {
  const component = ref(), instanceId = ref(1), theme = useThemeStore(), auth = useAuthStore()
  const active = ref(true), mounted = ref(true), toast = useToast()
  let retainedView
  const setSession = (id = 1, sid = 'snapshot-session', role = 'user', revision = 1) => {
    auth.user = { id, role, username: 'snapshot-fixture', email: 'snapshot@example.test', status: 'active' }
    auth.token = 'fixture.' + btoa(JSON.stringify({ sid, revision })) + '.fixture'
  }
  setSession()
  setLocale('zh-CN'); theme.setTheme('light')
  window.snapshotHarness = { pending, theme, auth, active, mounted, toast, setSession, setLocale, instanceId,
    t: (...args) => i18n.global.t(...args), view: () => {
      retainedView = component.value?.$?.setupState || retainedView
      return retainedView
    } }
  return { component, instanceId, active, mounted }
}, components: { SnapshotManager }, template: '<main class="p-4"><KeepAlive v-if="mounted"><SnapshotManager v-if="active" ref="component" :instance-id="instanceId" instance-name="Isolated snapshot instance" instance-status="stopped" :snapshot-limit="3"/></KeepAlive></main>' }).use(createPinia()).use(i18n).mount('#app')
