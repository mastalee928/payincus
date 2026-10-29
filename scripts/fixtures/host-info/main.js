import { createApp, ref } from 'vue'
import { createPinia } from 'pinia'
import i18n, { setLocale } from '@/locales/index'
import { useThemeStore } from '@/stores/theme'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/stores/toast'
import HostInfoTab from '@/components/host/HostInfoTab.vue'
import { pending } from './api.js'
import '@/styles/main.css'
const intervals = new Map(), nativeInterval = window.setInterval.bind(window), nativeClearInterval = window.clearInterval.bind(window)
window.setInterval = (callback, ms, ...args) => { const id = nativeInterval(callback, ms, ...args); intervals.set(id, { callback: () => callback(...args), ms }); return id }
window.clearInterval = id => { intervals.delete(id); nativeClearInterval(id) }
createApp({ setup() {
  const component = ref(), theme = useThemeStore(), auth = useAuthStore(), toast = useToast(), active = ref(true), mounted = ref(true), refreshes = ref(0)
  const host = ref({ id: 11, name: '东京测试宿主', url: 'https://host.example.test', location: 'Tokyo', countryCode: 'JP', status: 'online', cpuAllowanceMax: 8, memoryMax: 8192, resources: { diskTotal: 102400 } })
  const session = (id = 1, sid = 'host-info-session', role = 'admin') => {
    auth.user = { id, username: 'fixture-account', role, email: 'fixture@example.test' }
    auth.token = 'fixture.' + btoa(JSON.stringify({ sid })) + '.fixture'
  }
  session(); setLocale('zh-CN'); theme.setTheme(new URLSearchParams(location.search).has('dark') ? 'dark' : 'light')
  if (new URLSearchParams(location.search).has('inspect')) queueMicrotask(() => {
    if (new URLSearchParams(location.search).has('mutations')) {
      const view = component.value?.$?.setupState
      view.recalculateError = i18n.global.t('admin.hosts.recalculateFailed')
      view.agentMutationError = i18n.global.t('admin.hosts.agentInstallCommandFailed')
    }
    if (new URLSearchParams(location.search).has('copy')) {
      const view = component.value?.$?.setupState
      view.agentInstallCommand = 'DISPLAY-ONLY fixture command'
      view.agentInstallTokenExpiresAt = new Date(Date.now() + 60000).toISOString()
      view.agentCommandCopyError = true
    }
    if (new URLSearchParams(location.search).has('error')) { pending.forEach(request => request.reject(Error('测试读取失败'))); return }
    const report = { id: 1, hostId: 11, agentId: 'fixture-agent', enabled: true, status: 'online', version: 'v1.0.1', latestVersion: 'v1.0.1', versionStatus: 'latest', capabilities: ['resources'], lastSeenAt: '2026-10-30T00:00:00.000Z', lastHeartbeatIp: '192.0.2.11', lastReport: {
      incus: { available: true }, resources: { cpuTotal: 8, cpuUsagePercent: 12.5, memoryTotalMb: 8192, memoryUsedMb: 2048, memoryUsagePercent: 25, swapTotalMb: 0, swapUsedMb: 0, swapUsagePercent: 0, diskTotalBytes: 107374182400, diskUsedBytes: 10737418240, diskUsagePercent: 10, processCount: 24 }, metrics: { heartbeatIntervalSeconds: 120, uptimeSeconds: 86461, load1: 0.12, load5: 0.23, load15: 0.34 }
    } }
    pending.find(p => p.kind === 'instances')?.resolve({ instances: [], total: 0 })
    const traffic = [0, 1024, 2048, 1024, 0].map((total, index) => ({ date: `2026-10-0${index + 1}`, rxTotal: String(total), txTotal: '0', total: String(total), rxFormatted: `${total} B`, txFormatted: '0 B', totalFormatted: `${total} B` }))
    const totalUsed = String(traffic.reduce((sum, row) => sum + Number(row.total), 0))
    pending.find(p => p.kind === 'traffic')?.resolve({ data: traffic, summary: { totalUsed, totalUsedFormatted: `${totalUsed} B`, totalLimit: '1073741824', totalLimitFormatted: '1 GB' }, periodStart: '2026-10-01', periodEnd: '2026-10-31' })
    pending.find(p => p.kind === 'agent')?.resolve({ host: { id: 11, name: host.value.name }, agent: report })
  })
  window.hostInfoHarness = { pending, intervals, theme, auth, toast, active, mounted, refreshes, host, session, setLocale, t: (...args) => i18n.global.t(...args), view: () => component.value?.$?.setupState }
  return { component, active, mounted, host, refreshes }
}, components: { HostInfoTab }, template: '<main class="max-w-6xl mx-auto p-4"><header class="mb-4"><h1 class="text-xl font-semibold">PayIncus · {{ host.name }}</h1><p class="text-sm text-themed-secondary">测试宿主信息 · 受控监控数据</p></header><KeepAlive v-if="mounted"><HostInfoTab v-if="active" :host="host" ref="component" @refresh="refreshes++"/></KeepAlive></main>' }).use(createPinia()).use(i18n).mount('#app')
