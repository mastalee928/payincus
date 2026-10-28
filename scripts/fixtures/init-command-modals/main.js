import { createApp, ref, nextTick } from 'vue'
import { createPinia } from 'pinia'
import i18n, { setLocale } from '@/locales/index'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import { useToast } from '@/stores/toast'
import Detail from '@/components/extensions/InitCommandDetailModal.vue'
import Editor from '@/components/extensions/InitCommandModal.vue'
import Extensions from '@/views/ExtensionsView.vue'
import { pending } from './api.js'
import '@/styles/main.css'

const jwt = (sid, generation = 1) => `fixture.${btoa(JSON.stringify({ sid, generation }))}.fixture`
localStorage.removeItem('token')
const record = id => ({ id, name: `List command ${id}`, distros: ['debian'], description: null, enabled: true, createdAt: '2026-10-28T00:00:00Z', updatedAt: '2026-10-28T00:00:00Z' })
const app = createApp({
  components: { Detail, Editor, Extensions },
  setup() {
    const auth = useAuthStore(), theme = useThemeStore(), toast = useToast()
    auth.user = { id: 1, username: 'isolated-ui', role: 'user' }; auth.token = jwt('session-a')
    const command = ref(record(1)), visible = ref(true), mode = ref('detail'), events = [], copies = []
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: text => new Promise((resolve, reject) => copies.push({ text, resolve, reject })),
    } })
    setLocale('zh-CN'); theme.setTheme('light')
    // Events do not unmount automatically: also test late callbacks against a reused instance.
    const close = () => events.push('close'), save = () => events.push('save')
    window.modalHarness = {
      pending, copies, command, visible, mode, events, auth, theme, toast, setLocale, nextTick,
      setCommand(id) { command.value = id === null ? null : record(id) },
      resolve(index, command) { pending[index].resolve({ command }) },
      reject(index) { pending[index].reject(new Error('isolated failure')) },
      newSession(sid) { auth.token = jwt(sid) }, refreshSession(sid) { auth.token = jwt(sid, 2) },
    }
    return { command, visible, mode, close, save }
  },
  template: `<main class="p-6"><h1>初始化命令 · 本地隔离验收</h1><Detail v-if="visible && mode === 'detail'" :command="command" @close="close"/><Editor v-if="visible && mode === 'edit'" :command="command" @close="close" @save="save"/><Extensions v-if="visible && mode === 'page'"/></main>`,
})
app.use(createPinia()); app.use(i18n); app.mount('#app')
