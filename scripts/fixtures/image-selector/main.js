import { createApp, ref } from 'vue'
import { createPinia } from 'pinia'
import i18n from '@/locales/index'
import { useThemeStore } from '@/stores/theme'
import ImageSelector from '@/components/instance/ImageSelector.vue'
import '@/styles/main.css'

// Count the exact callback identities registered by the mounted component.
const tracked = [], originalAdd = EventTarget.prototype.addEventListener, originalRemove = EventTarget.prototype.removeEventListener
let unmatched = 0, added = 0, removed = 0
const capture = options => typeof options === 'boolean' ? options : !!options?.capture
EventTarget.prototype.addEventListener = function(type, listener, options) {
  if ((this === document && type === 'click') || (this === window && ['scroll', 'resize'].includes(type))) {
    if (!tracked.some(item => item.target === this && item.type === type && item.listener === listener && item.capture === capture(options))) {
      tracked.push({ target: this, type, listener, capture: capture(options) }); added++
    }
  }
  return originalAdd.call(this, type, listener, options)
}
EventTarget.prototype.removeEventListener = function(type, listener, options) {
  if ((this === document && type === 'click') || (this === window && ['scroll', 'resize'].includes(type))) {
    const index = tracked.findIndex(item => item.target === this && item.type === type && item.listener === listener && item.capture === capture(options))
    if (index < 0) unmatched++; else { tracked.splice(index, 1); removed++ }
  }
  return originalRemove.call(this, type, listener, options)
}
createApp({ components: { ImageSelector }, setup() {
  const mounted = ref(false), embedded = ref(false), selected = ref('debian/13')
  useThemeStore().setTheme('light')
  const images = [{ value: 'debian/13', label: 'Debian 13', icon: 'debian' }, { value: 'ubuntu/24.04', label: 'Ubuntu 24.04', icon: 'ubuntu' }]
  window.imageSelectorHarness = { mounted, embedded, selected, counts: () => ({ active: tracked.length, added, removed, unmatched,
    kinds: tracked.map(item => `${item.target === window ? 'window' : 'document'}:${item.type}:${item.capture}`).sort() }) }
  return { mounted, embedded, selected, images }
}, template: '<main class="max-w-xl mx-auto p-6"><h1 class="text-xl mb-4">PayIncus · 系统镜像</h1><ImageSelector v-if="mounted" v-model:selected-image="selected" :available-images="images" :images-loading="false" :embedded="embedded"/><button id="outside" type="button">Outside</button></main>' }).use(createPinia()).use(i18n).mount('#app')
