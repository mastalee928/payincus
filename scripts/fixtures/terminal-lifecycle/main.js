import { createApp, reactive, markRaw } from 'vue'
import { createPinia } from 'pinia'
import i18n, { setLocale } from '@/locales/index'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import TerminalView from '@/views/TerminalView.vue'
import { pending } from './api.js'
import '@/styles/main.css'
const state = reactive({ active: true, mounted: true })
let cachedView
const pendingClipboard = [], sent = [], closed = [], sockets = []
if (location.search.includes('session-test')) {
  const NativeSocket = window.WebSocket
  window.WebSocket = class {
    static OPEN = 1; static CONNECTING = 0
    constructor(url, protocols) {
      if (!String(url).includes('/ws/instances/')) return new NativeSocket(url, protocols)
      this.url = url; this.readyState = 0; sockets.push(this)
      return markRaw(this)
    }
    send(value) { sent.push(value) }
    close(code = 1000) { this.readyState = 3; closed.push(code); this.onclose?.({ code }) }
  }
}
Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
  readText: () => new Promise(resolve => pendingClipboard.push(resolve)), writeText: async () => {},
} })
const app = createApp({ components: { TerminalView }, setup() {
  const auth = useAuthStore(), theme = useThemeStore()
  auth.user = { id: 1, username: 'fixture', role: 'user' }; auth.token = `fixture.${btoa(JSON.stringify({ sid: 'a' }))}.fixture`
  setLocale('zh-CN'); theme.setTheme('light')
  window.terminalHarness = { state, auth, theme, setLocale, pending, sockets, pendingClipboard, sent, closed,
    view() {
      let current = document.querySelector('h1')?.__vueParentComponent
      while (current && !current.setupState?.handleKeydown) current = current.parent
      if (current) cachedView = current.setupState
      return cachedView
    },
    seedTab(id = 'fixture-tab', instanceId = 10) {
      const view = this.view()
      view.tabs.push({ id, instanceId, instanceName: 'Fixture VPS', label: 'Fixture VPS',
        terminal: null, fitAddon: null, searchAddon: null, unicodeAddon: null, webglAddon: null, serializeAddon: null, clipboardAddon: null,
        ws: { readyState: 1, send: value => sent.push(value), close: () => closed.push('close') },
        status: 'connected', connectionMode: 'exec', error: null, container: null, eventsBound: false, isWebGLEnabled: false,
        consoleWarningShown: false, connectAttempt: 1 })
      view.activeTabId = id
    },
  }
  return { state }
}, template: '<main class="p-6"><KeepAlive v-if="state.mounted"><TerminalView v-if="state.active" /></KeepAlive><input id="fixture-input" placeholder="Unrelated editor" /></main>' })
app.use(createPinia()); app.use(i18n); app.mount('#app')
