import { createApp, ref } from 'vue'
import { createPinia } from 'pinia'
import i18n, { setLocale } from '@/locales/index'
import { useThemeStore } from '@/stores/theme'
import { useAuthStore } from '@/stores/auth'
import HostAbusePolicyPanel from '@/components/host/HostAbusePolicyPanel.vue'
import GatewayEndpointPanel from '@/components/host/GatewayEndpointPanel.vue'
import GatewayDomainChangePanel from '@/components/host/GatewayDomainChangePanel.vue'
import { requests, pending, reads, fixture, heldEndpointReads } from './api.js'
import '@/styles/main.css'
createApp({ setup() {
  const active = ref(true), auth = useAuthStore(), theme = useThemeStore(), tab = ref('abuse')
  const session = (id = 1, sid = 'gateway-abuse-session', role = 'admin') => {
    localStorage.setItem('token', 'fixture.' + btoa(JSON.stringify({ id, sid, role, exp: 9999999999 })) + '.fixture')
    auth.syncToken(); auth.user = { id, username: 'review-admin', email: 'review@example.invalid', role }
  }
  session(); setLocale('zh-CN'); theme.setTheme('light')
  window.gatewayAbuseTest = { requests, pending, reads, fixture, heldEndpointReads, active, auth, theme, session, setLocale, tab }
  return { active, tab }
}, components: { HostAbusePolicyPanel, GatewayEndpointPanel, GatewayDomainChangePanel },
template: `<main class="mx-auto max-w-6xl p-4 sm:p-6 space-y-5">
  <header class="flex items-center justify-between gap-3"><h1 class="text-xl font-semibold text-themed">PayIncus</h1><span class="text-sm text-themed">{{ $t('logModules.admin') }}</span></header>
  <KeepAlive><HostAbusePolicyPanel v-if="active && tab === 'abuse'" /></KeepAlive>
  <KeepAlive><section v-if="active && tab === 'gateways'" class="space-y-6">
    <article class="card p-5"><h2 class="text-lg font-semibold text-themed mb-4">{{ $t('gatewayEndpoint.flow.local') }}</h2><GatewayEndpointPanel /></article>
    <article v-for="id in ['independent','backup']" :key="id" class="card p-5"><h2 class="text-lg font-semibold text-themed mb-4">{{ $t('gatewayEndpoint.extensions.' + id + '.title') }}</h2><GatewayDomainChangePanel :gateway-id="id" /></article>
  </section></KeepAlive>
</main>` }).use(createPinia()).use(i18n).mount('#app')
