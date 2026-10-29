import { createApp, reactive } from 'vue'
import { createPinia } from 'pinia'
import i18n, { setLocale } from '@/locales/index'
import { useThemeStore } from '@/stores/theme'
import Uploader from '@/components/tickets/TicketImageUploader.vue'
import '@/styles/main.css'
const pixel = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII='), c => c.charCodeAt(0))
const file = (name = 'fixture.png', type = 'image/png') => new File([pixel], name, { type })
const state = reactive({ mounted: true, disabled: true, files: [file()], maxFiles: 6 })
const liveUrls = new Set(), create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL)
URL.createObjectURL = blob => { const url = create(blob); liveUrls.add(url); return url }
URL.revokeObjectURL = url => { liveUrls.delete(url); revoke(url) }
let cachedView
const app = createApp({ components: { Uploader }, setup() {
  const theme = useThemeStore(); setLocale('zh-CN'); theme.setTheme('light')
  window.uploaderHarness = { state, theme, file, liveUrls, setLocale, updates: 0,
    view() {
      let current = document.querySelector('#app main > div')?.__vueParentComponent
      while (current && !current.setupState?.removeFile) current = current.parent
      if (current) cachedView = current.setupState
      return cachedView
    },
    update(files) { this.updates++; state.files = files },
  }
  return { state, update: files => window.uploaderHarness.update(files) }
}, template: '<main class="max-w-xl mx-auto p-4"><Uploader v-if="state.mounted" :model-value="state.files" :disabled="state.disabled" :max-files="state.maxFiles" @update:model-value="update"/></main>' })
app.use(createPinia()); app.use(i18n); app.mount('#app')
