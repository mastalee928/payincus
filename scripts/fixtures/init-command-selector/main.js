import { createApp, ref, nextTick } from 'vue'
import { createPinia } from 'pinia'
import i18n, { setLocale } from '@/locales/index'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import Selector from '@/components/extensions/InitCommandSelector.vue'
import { pending } from './api.js'
import '@/styles/main.css'

const jwt = (sid, generation = 1) => `fixture.${btoa(JSON.stringify({ sid, generation }))}.fixture`
localStorage.removeItem('token')
const app = createApp({
  components: { Selector },
  setup() {
    const auth = useAuthStore(), theme = useThemeStore()
    auth.user = { id: 1, username: 'isolated-ui', role: 'user' }
    auth.token = jwt('session-a')
    const distro = ref('debian'), selected = ref([]), visible = ref(true)
    const events = []
    const update = value => { selected.value = value; events.push([...value]) }
    setLocale('zh-CN'); theme.setTheme('light')
    window.selectorHarness = {
      pending, selected, events, distro, visible, auth, theme, setLocale, nextTick,
      setDistro(value) { distro.value = value },
      resolve(index, commands) { pending[index].resolve({ commands }) },
      reject(index) { pending[index].reject(new Error('isolated failure')) },
      newSession(sid, userId = 1) { auth.user = { ...auth.user, id: userId }; auth.token = jwt(sid) },
      refreshSession(sid) { auth.token = jwt(sid, 2) },
    }
    return { distro, selected, visible, update }
  },
  template: `<main class="max-w-3xl mx-auto p-4 sm:p-6"><h1 class="text-xl mb-6">初始化命令 · 本地隔离验收</h1><section id="subject"><Selector v-if="visible" :distro="distro" :model-value="selected" @update:model-value="update" /></section><output id="selection">{{JSON.stringify(selected)}}</output></main>`,
})
app.component('RouterLink', { props: ['to'], template: '<a :href="to"><slot /></a>' })
app.use(createPinia()); app.use(i18n); app.mount('#app')
