import { createApp, reactive, watch } from 'vue'
import { createPinia } from 'pinia'
import i18n, { setLocale } from '@/locales/index'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import { useToast } from '@/stores/toast'
import MigrateModal from '@/components/host/MigrateHostModal.vue'
import { pending } from './api.js'
import '@/styles/main.css'
const state = reactive({ mounted: true, active: true, id: 1, visible: false, selectedIds: [1], instances: [{ id: 1, name: 'fixture-instance', packagePlanId: 1 }], successCount: 0 })
const jwt = (sid, iat = 1) => `fixture.${btoa(JSON.stringify({ sid, iat }))}.fixture`
let cached
const app = createApp({ components: { MigrateModal }, setup() {
  const auth = useAuthStore(), theme = useThemeStore(), toast = useToast(), toastEvents = [], seen = new Set()
  auth.user = { id: 1, username: 'fixture', role: 'admin' }; auth.token = jwt('a'); setLocale('zh-CN'); theme.setTheme('light')
  watch(() => toast.toasts.value.map(item => ({ id: item.id, message: item.message })), items => {
    for (const item of items) if (!seen.has(item.id)) { seen.add(item.id); toastEvents.push(item) }
  }, { flush: 'sync' })
  window.migrateHarness = { state, auth, theme, pending, setLocale, toastEvents,
    session(sid, iat = 1) { auth.token = sid ? jwt(sid, iat) : null },
    view() {
      let current = document.querySelector('.modal-content')?.__vueParentComponent
      while (current && !current.setupState?.loadHosts) current = current.parent
      if (current) cached = current.setupState
      return cached
    },
  }
  return { state }
}, template: '<main><KeepAlive v-if="state.mounted"><MigrateModal v-if="state.active" v-model:visible="state.visible" :host-id="state.id" host-name="fixture-host" :selected-ids="state.selectedIds" :instances="state.instances" @success="state.successCount++"/></KeepAlive></main>' })
app.use(createPinia()); app.use(i18n); app.mount('#app')
