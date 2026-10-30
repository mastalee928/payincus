import { createApp, reactive, ref } from 'vue'
import { createPinia } from 'pinia'
import i18n, { setLocale } from '@/locales/index'
import { useThemeStore } from '@/stores/theme'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/stores/toast'
import TwoFactor from '@/components/profile/TwoFactorSection.vue'
import { pending } from './api.js'
import '@/styles/main.css'
const state = reactive({ mounted: true, active: true })
const jwt = (sid, iat = 1) => `fixture.${btoa(JSON.stringify({ sid, iat }))}.fixture`
let cached
createApp({ setup() {
  const component = ref(), theme = useThemeStore(), auth = useAuthStore(); theme.setTheme('light'); setLocale('zh-CN')
  auth.user = { id: 1, username: 'fixture', role: 'user' }; auth.token = jwt('a')
  window.twoFactorHarness = { state, pending, theme, auth, toast: useToast(), setLocale, session(sid, iat = 1) { auth.token = sid ? jwt(sid, iat) : null },
    view() { if (component.value) cached = component.value.$.setupState; return cached },
    verification() {
      const walk = vnode => {
        if (!vnode) return null
        if (vnode.component?.type.__file?.endsWith('SensitiveVerificationModal.vue')) return vnode.component.setupState
        if (vnode.component) { const found = walk(vnode.component.subTree); if (found) return found }
        for (const child of Array.isArray(vnode.children) ? vnode.children : []) { const found = walk(child); if (found) return found }
        return null
      }
      return walk(component.value?.$.subTree)
    } }
  return { state, component }
}, components: { TwoFactor }, template: '<main class="kawaii-app-shell p-4 max-w-2xl mx-auto"><KeepAlive v-if="state.mounted"><TwoFactor v-if="state.active" ref="component"/></KeepAlive></main>' }).use(createPinia()).use(i18n).mount('#app')
