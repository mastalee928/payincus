import { createApp, ref } from 'vue'
import { createPinia } from 'pinia'
import i18n, { setLocale } from '@/locales/index'
import { useThemeStore } from '@/stores/theme'
import HostRecoveryModal from '@/components/host/HostRecoveryModal.vue'
import { reads, writes } from './api.js'
import '@/styles/main.css'
createApp({ setup() {
  const hostId = ref(53), opened = ref(false), changes = ref(0), theme = useThemeStore()
  setLocale('zh-CN'); theme.setTheme('light')
  window.recoveryTest = { reads, writes, hostId, opened, changes, theme, setLocale,
    report: (id = hostId.value, quarantined = true, error = 'tools-pending') => ({ hostId: id, quarantined,
      checkedAt: new Date().toISOString(), blockers: quarantined ? [error] : [], instances: [], forwardCount: 0,
      needsCleanup: false, canRecover: false, confirmation: '', mode: 'empty',
      automaticCleanup: { status: quarantined ? 'retry' : 'done', kind: 'verify_empty', attempts: 1, error: quarantined ? error : undefined,
        nextAttemptAt: quarantined ? new Date(Date.now() + 15000).toISOString() : undefined } }) }
  return { hostId, opened, changes }
}, components: { HostRecoveryModal }, template: '<button id="open" class="btn-secondary" @click="opened=true">Open recovery</button><HostRecoveryModal v-if="opened" :host-id="hostId" :host-name="`singapore2-arm-${hostId}`" @close="opened=false" @changed="changes++" />' })
  .use(createPinia()).use(i18n).mount('#app')
