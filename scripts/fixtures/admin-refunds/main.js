import { createApp, reactive } from 'vue'
import { createPinia } from 'pinia'
import i18n, { setLocale } from '@/locales/index'
import { useAuthStore } from '@/stores/auth'
import CheckoutRefundsPanel from '@/components/CheckoutRefundsPanel.vue'
import api from '@/api'
import '@/styles/main.css'

const state = reactive({ active: true, mounted: true })
const app = createApp({
  components: { CheckoutRefundsPanel },
  setup() {
    const auth = useAuthStore()
    function account(id, sid = 'one') {
      const token = `fixture.${btoa(JSON.stringify({ id, role: 'admin', sid }))}.fixture`
      localStorage.setItem('token', token)
      auth.token = token
      auth.user = { id, username: `admin-${id}`, role: 'admin' }
    }
    account(1); setLocale('zh-CN')
    window.refundHarness = { state, account, api }
    return { state }
  },
  template: '<main style="max-width:900px;margin:auto;padding:16px"><CheckoutRefundsPanel v-if="state.mounted" :active="state.active" /></main>'
})
app.use(createPinia()); app.use(i18n); app.mount('#app')
