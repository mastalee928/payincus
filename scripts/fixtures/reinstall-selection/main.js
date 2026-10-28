import { createApp, reactive } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import i18n, { setLocale } from '@/locales/index'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import Rebuild from '@/components/instance/modals/RebuildModal.vue'
import Recreate from '@/components/instance/modals/RecreateModal.vue'
import '@/styles/main.css'
const image = id => ({ incusAlias: `debian/${id}`, name: `Debian ${id}`, description: null, icon: 'debian' })
const state = reactive({ mode: 'Rebuild', mounted: true, active: true, visible: true, loading: false, images: [image(12), image(13)], keys: [{ id: 1, name: 'Fixture key 1' }, { id: 2, name: 'Fixture key 2' }] })
const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<p>Fixture</p>' } }] })
const jwt = (sid, iat = 1) => `fixture.${btoa(JSON.stringify({ sid, iat }))}.fixture`
let cachedView
const app = createApp({ components: { Rebuild, Recreate }, setup() {
  const auth = useAuthStore(), theme = useThemeStore(), submissions = []
  auth.user = { id: 1, username: 'fixture', role: 'user' }; auth.token = jwt('a'); setLocale('zh-CN'); theme.setTheme('light')
  window.reinstallHarness = { state, auth, theme, submissions, image, setLocale,
    session(sid, iat = 1) { auth.token = sid ? jwt(sid, iat) : null },
    view() {
      let current = document.querySelector('body h3')?.__vueParentComponent
      while (current && !current.setupState?.handleSubmit) current = current.parent
      if (current) cachedView = current.setupState
      return cachedView
    },
    submit(data) { submissions.push({ mode: state.mode, data }); state.loading = true },
  }
  return { state, submit: window.reinstallHarness.submit }
}, template: '<main><KeepAlive v-if="state.mounted"><component v-if="state.active" :is="state.mode" v-model:visible="state.visible" :loading="state.loading" :available-images="state.images" :ssh-keys="state.keys" @submit="submit"/></KeepAlive></main>' })
app.use(createPinia()); app.use(i18n); app.use(router); await router.push('/'); await router.isReady(); app.mount('#app')
