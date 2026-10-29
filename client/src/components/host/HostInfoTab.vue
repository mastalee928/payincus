<script setup lang="ts">
import { computed, onMounted, onActivated, onDeactivated, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useThemeStore } from '@/stores/theme'
import { useToast } from '@/stores/toast'
import api from '@/api'
import FlagIcon from '@/components/FlagIcon.vue'
import PublicIpv6Addresses from '@/components/PublicIpv6Addresses.vue'
import { useAuthStore } from '@/stores/auth'
import type { HostPublicIpv6Sync } from '@/types/host-pool'
import type { HostAgentStatus } from '@/types/api'

const { t, te } = useI18n()
const themeStore = useThemeStore()
const toast = useToast()

const emit = defineEmits(['refresh'])

interface Host {
  id: number
  name: string
  url: string
  location?: string
  countryCode: string
  status: 'online' | 'offline' | 'maintenance'
  instanceCount?: number
  cpuAllowanceMax?: number
  memoryMax?: number
  instanceType?: 'container' | 'vm' | 'both'
  resources?: {
    cpuUsed: number
    memoryUsed: number
    diskTotal: number  // 计算值，来自 storage_size * 1024
    diskUsed: number
  }
  natConfig?: {
    publicIp: string | null
    publicIpv6?: string | null
    publicIpv6Sync?: HostPublicIpv6Sync | null
    bindIp?: string | null
    bindIpv6?: string | null
    portRangeStart: number | null
    portRangeEnd: number | null
    portsUsedCount?: number
  }
  createdAt?: string
  updatedAt?: string
}

interface Props {
  host: Host
}

const props = defineProps<Props>()
const authStore = useAuthStore()
const syncingIpv6 = ref(false)
const ipv6Sync = computed(() => props.host.natConfig?.publicIpv6Sync)
const ipv6Error = computed(() => ipv6Sync.value?.error && te('ipv6Delivery.errors.' + ipv6Sync.value.error)
  ? t('ipv6Delivery.errors.' + ipv6Sync.value.error) : '')
async function syncIpv6() {
  if (!available.value || authStore.user?.role !== 'admin' || hostMutating.value) return
  const context = readContext()
  syncingIpv6.value = true
  ipv6MutationError.value = ''
  try {
    const result = await api.hosts.syncIpv6(context.hostId)
    if (!context.current()) return
    if (!result || !['idle', 'synced', 'pending', 'failed'].includes(result.status) || !Array.isArray(result.addresses) ||
      !result.addresses.every(address => typeof address === 'string') || (result.primary !== null && typeof result.primary !== 'string')) throw Error('Invalid IPv6 sync response')
    emit('refresh')
  }
  catch {
    if (context.current()) { ipv6MutationError.value = t('ipv6Delivery.status.failed'); toast.error(ipv6MutationError.value) }
  }
  finally { syncingIpv6.value = false }
}

// 从系统数据库获取实例统计
const instanceStats = ref({
  count: 0,
  cpuUsed: 0,
  memoryUsed: 0,
  diskUsed: 0
})

// 流量历史数据
interface TrafficHistoryItem {
  date: string
  rxTotal: string
  txTotal: string
  rxFormatted: string
  txFormatted: string
  total: string
  totalFormatted: string
}

interface TrafficSummary {
  totalUsed: string
  totalUsedFormatted: string
  totalLimit: string
  totalLimitFormatted: string
}

const trafficHistory = ref<TrafficHistoryItem[]>([])
const trafficSummary = ref<TrafficSummary | null>(null)
const trafficPeriod = ref<{ periodStart: string; periodEnd: string } | null>(null)
const trafficLoading = ref(true)

const agentStatus = ref<HostAgentStatus | null>(null)
const agentStatusLoading = ref(true)
const agentStatusRefreshing = ref(false)
const agentUpgradeRequesting = ref(false)
const agentInstallCommandLoading = ref(false)
const agentInstallCommand = ref('')
const agentInstallTokenExpiresAt = ref('')
const recalculating = ref(false)
const recalculateError = ref(''), ipv6MutationError = ref(''), agentMutationError = ref('')
const hostMutating = computed(() => syncingIpv6.value || recalculating.value || agentUpgradeRequesting.value || agentInstallCommandLoading.value)
let installingCurrentHost: (() => boolean) | null = null
const agentCommandCopying = ref(false)
const agentCommandCopyError = ref(false)
let commandGeneration = 0
watch([agentInstallCommand, agentInstallTokenExpiresAt], () => { commandGeneration++; agentCommandCopyError.value = false }, { flush: 'sync' })
const agentStatusError = ref('')
const statsError = ref(false), statsReady = ref(false), statsLoading = ref(false)
const trafficError = ref(false), trafficReady = ref(false), active = ref(false)
let alive = true, generation = 0, statsSequence = 0, trafficSequence = 0, agentSequence = 0
const session = computed(() => {
  if (!authStore.user || !authStore.token || !Number.isSafeInteger(authStore.user.id) || authStore.user.id < 1) return ''
  let identity = authStore.token
  try {
    const payload = JSON.parse(atob(identity.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    if (typeof payload.sid === 'string' && payload.sid) identity = payload.sid
  } catch { /* Legacy tokens retain their full identity. */ }
  return `${authStore.user.id}:${authStore.user.role}:${identity}`
})
const available = computed(() => alive && active.value && !!session.value && Number.isSafeInteger(props.host.id) && props.host.id > 0)
function readContext() {
  const hostId = props.host.id, identity = session.value, version = generation
  return { hostId, current: () => available.value && hostId === props.host.id && identity === session.value && version === generation }
}
let agentStatusRefreshTimer: ReturnType<typeof setInterval> | null = null
let agentStatusRefreshIntervalMs = 0

const defaultAgentRefreshSeconds = 30
const minAgentRefreshSeconds = 5
const maxAgentRefreshSeconds = 3600

async function loadInstanceStats() {
  if (!available.value) return
  const context = readContext(), sequence = ++statsSequence
  const current = () => context.current() && sequence === statsSequence
  statsLoading.value = true; statsError.value = false
  try {
    const res = await api.instances.list({
      hostId: context.hostId,
      pageSize: 1000 // 获取所有实�?
    }) as unknown as { instances: Array<{ cpu?: number; memory?: number; disk?: number }>; total: number }
    if (!current()) return
    const instances = res.instances
    if (!Array.isArray(instances) || !Number.isSafeInteger(res.total) || res.total < instances.length ||
      !instances.every(instance => instance && ['cpu', 'memory', 'disk'].every(key => {
        const value = instance[key as 'cpu' | 'memory' | 'disk']
        return value === undefined || value === null || metricNumber(value) !== undefined
      }))) throw new Error('Invalid host instance statistics')
    const stats = {
      count: res.total,
      cpuUsed: instances.reduce((sum, instance) => sum + (instance.cpu || 0), 0),
      memoryUsed: instances.reduce((sum, instance) => sum + (instance.memory || 0), 0),
      diskUsed: instances.reduce((sum, instance) => sum + (instance.disk || 0), 0)
    }
    if (![stats.cpuUsed, stats.memoryUsed, stats.diskUsed].every(value => metricNumber(value) !== undefined)) throw new Error('Invalid host resource totals')
    instanceStats.value = stats
    statsReady.value = true
  } catch {
    if (current()) statsError.value = true
  } finally {
    if (current()) statsLoading.value = false
  }
}

async function loadTrafficHistory() {
  if (!available.value) return
  const context = readContext(), sequence = ++trafficSequence
  const current = () => context.current() && sequence === trafficSequence
  trafficLoading.value = !trafficReady.value; trafficError.value = false
  try {
    const response = await api.traffic.getHostTrafficHistory(context.hostId)
    if (!current()) return
    if (!response || !Array.isArray(response.data) || !response.data.every(item => item &&
      ['date', 'rxTotal', 'txTotal', 'rxFormatted', 'txFormatted', 'total', 'totalFormatted'].every(key => typeof item[key as keyof TrafficHistoryItem] === 'string') &&
      /^\d{4}-\d{2}-\d{2}$/.test(item.date) && metricNumber(Number(item.total)) !== undefined) ||
      !response.summary || !['totalUsed', 'totalUsedFormatted', 'totalLimit', 'totalLimitFormatted'].every(key => typeof response.summary[key as keyof TrafficSummary] === 'string') ||
      typeof response.periodStart !== 'string' || typeof response.periodEnd !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(response.periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(response.periodEnd)) throw new Error('Invalid host traffic response')
    trafficHistory.value = response.data
    trafficSummary.value = response.summary
    trafficPeriod.value = {
      periodStart: response.periodStart,
      periodEnd: response.periodEnd
    }
    trafficReady.value = true
  } catch {
    if (current()) trafficError.value = true
  } finally {
    if (current()) trafficLoading.value = false
  }
}

async function loadAgentStatus(showToast = false) {
  if (!available.value || installingCurrentHost?.()) return
  const context = readContext(), sequence = ++agentSequence
  const current = () => context.current() && sequence === agentSequence
  agentStatusLoading.value = !agentStatus.value
  agentStatusRefreshing.value = true
  try {
    const response = await api.hosts.getAgentStatus(context.hostId)
    if (!current()) return
    if (!response || response.host?.id !== context.hostId || (response.agent !== null &&
      (!response.agent || response.agent.hostId !== context.hostId || !Number.isSafeInteger(response.agent.id) || response.agent.id < 1 ||
      typeof response.agent.enabled !== 'boolean' || typeof response.agent.status !== 'string' || !Array.isArray(response.agent.capabilities) ||
      !response.agent.capabilities.every(value => typeof value === 'string')))) throw new Error(t('admin.hosts.agentStatusLoadFailed'))
    agentStatus.value = response.agent
    agentStatusError.value = ''
    startAgentStatusAutoRefresh()
    if (showToast) {
      toast.success(t('admin.hosts.agentStatusRefreshSuccess'))
    }
  } catch (err: any) {
    if (!current()) return
    agentStatusError.value = err?.message || String(err)
    if (showToast) {
      toast.error(t('admin.hosts.agentStatusLoadFailed') + ': ' + agentStatusError.value)
    }
  } finally {
    if (current()) { agentStatusLoading.value = false; agentStatusRefreshing.value = false }
  }
}

function stopAgentStatusAutoRefresh() {
  if (agentStatusRefreshTimer) {
    clearInterval(agentStatusRefreshTimer)
    agentStatusRefreshTimer = null
  }
  agentStatusRefreshIntervalMs = 0
}

function startAgentStatusAutoRefresh() {
  if (!available.value) return
  const context = readContext()
  const refreshIntervalMs = agentHeartbeatIntervalSeconds.value * 1000
  if (agentStatusRefreshTimer && agentStatusRefreshIntervalMs === refreshIntervalMs) {
    return
  }

  stopAgentStatusAutoRefresh()
  agentStatusRefreshIntervalMs = refreshIntervalMs
  agentStatusRefreshTimer = setInterval(() => {
    if (context.current() && !agentStatusRefreshing.value) void loadAgentStatus()
  }, refreshIntervalMs)
}

const statusInfo = computed(() => {
  const map: Record<string, { label: string; class: string; dot: string }> = {
    online: { label: t('admin.hosts.statusOnline'), class: 'badge-success', dot: 'bg-green-500' },
    offline: { label: t('admin.hosts.statusOffline'), class: 'badge-default', dot: 'bg-gray-500' },
    maintenance: { label: t('admin.hosts.statusMaintenance'), class: 'badge-warning', dot: 'bg-yellow-500' }
  }
  return map[props.host.status] || map.offline
})

const agentStatusInfo = computed(() => {
  if (!agentStatus.value) {
    return { label: t('admin.hosts.agentNotInstalled'), class: 'badge-default', dot: 'bg-gray-500' }
  }
  if (!agentStatus.value.enabled) {
    return { label: t('admin.hosts.agentDisabled'), class: 'badge-warning', dot: 'bg-yellow-500' }
  }
  const map: Record<string, { label: string; class: string; dot: string }> = {
    online: { label: t('admin.hosts.agentOnline'), class: 'badge-success', dot: 'bg-green-500' },
    offline: { label: t('admin.hosts.agentOffline'), class: 'badge-default', dot: 'bg-gray-500' }
  }
  return map[agentStatus.value.status] || { label: t('admin.hosts.agentUnknown'), class: 'badge-default', dot: 'bg-gray-500' }
})

function reportObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function metricNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

const agentReport = computed(() => {
  const report = reportObject(agentStatus.value?.lastReport)
  const incus = reportObject(report.incus)
  return {
    ...report,
    resources: report.resources,
    metrics: report.metrics,
    incus: {
      available: typeof incus.available === 'boolean' ? incus.available : undefined,
      socket: typeof incus.socket === 'string' ? incus.socket : undefined
    }
  }
})
const hostResources = computed(() => {
  const resources = reportObject(agentReport.value.resources)
  return {
    cpuTotal: metricNumber(resources.cpuTotal),
    cpuUsagePercent: metricNumber(resources.cpuUsagePercent),
    memoryTotalMb: metricNumber(resources.memoryTotalMb),
    memoryUsedMb: metricNumber(resources.memoryUsedMb),
    memoryAvailableMb: metricNumber(resources.memoryAvailableMb),
    memoryUsagePercent: metricNumber(resources.memoryUsagePercent),
    swapTotalMb: metricNumber(resources.swapTotalMb),
    swapUsedMb: metricNumber(resources.swapUsedMb),
    swapUsagePercent: metricNumber(resources.swapUsagePercent),
    diskMountpoint: typeof resources.diskMountpoint === 'string' ? resources.diskMountpoint : undefined,
    diskTotalBytes: metricNumber(resources.diskTotalBytes),
    diskUsedBytes: metricNumber(resources.diskUsedBytes),
    diskAvailableBytes: metricNumber(resources.diskAvailableBytes),
    diskUsagePercent: metricNumber(resources.diskUsagePercent),
    processCount: metricNumber(resources.processCount)
  }
})
const hostMetrics = computed(() => {
  const metrics = reportObject(agentReport.value.metrics)
  return {
    heartbeatIntervalSeconds: metricNumber(metrics.heartbeatIntervalSeconds),
    uptimeSeconds: metricNumber(metrics.uptimeSeconds),
    load1: metricNumber(metrics.load1),
    load5: metricNumber(metrics.load5),
    load15: metricNumber(metrics.load15)
  }
})
const agentHeartbeatIntervalSeconds = computed(() => {
  const value = hostMetrics.value.heartbeatIntervalSeconds
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minAgentRefreshSeconds ||
    value > maxAgentRefreshSeconds
  ) {
    return defaultAgentRefreshSeconds
  }
  return value
})
const agentStatusDescription = computed(() => t('admin.hosts.agentStatusDesc', {
  seconds: agentHeartbeatIntervalSeconds.value
}))

const agentVersionInfo = computed(() => {
  const latestVersion = agentStatus.value?.latestVersion
  const status = agentStatus.value?.versionStatus ?? 'unknown'
  if (status === 'latest') {
    return {
      label: t('admin.hosts.agentVersionLatest'),
      title: latestVersion ? t('admin.hosts.agentLatestVersion', { version: latestVersion }) : '',
      class: themeStore.isDark
        ? 'bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/20'
        : 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
    }
  }
  if (status === 'outdated') {
    return {
      label: t('admin.hosts.agentVersionOutdated'),
      title: latestVersion ? t('admin.hosts.agentLatestVersion', { version: latestVersion }) : '',
      class: themeStore.isDark
        ? 'bg-amber-500/10 text-amber-300 ring-1 ring-amber-500/20'
        : 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
    }
  }
  return {
    label: t('admin.hosts.agentVersionUnknown'),
    title: latestVersion ? t('admin.hosts.agentLatestVersion', { version: latestVersion }) : '',
    class: themeStore.isDark
      ? 'bg-gray-800 text-gray-400 ring-1 ring-gray-700'
      : 'bg-gray-100 text-gray-600 ring-1 ring-gray-200'
  }
})

const canRequestAgentUpgrade = computed(() => agentStatus.value?.versionStatus === 'outdated')

function invalidateReads(): void {
  generation++; statsSequence++; trafficSequence++; agentSequence++
  stopAgentStatusAutoRefresh()
  instanceStats.value = { count: 0, cpuUsed: 0, memoryUsed: 0, diskUsed: 0 }
  trafficHistory.value = []; trafficSummary.value = null; trafficPeriod.value = null
  agentStatus.value = null; agentStatusError.value = ''
  statsReady.value = false; statsLoading.value = false; statsError.value = false
  trafficReady.value = false; trafficLoading.value = false; trafficError.value = false
  agentStatusLoading.value = false; agentStatusRefreshing.value = false
  agentInstallCommand.value = ''
  agentInstallTokenExpiresAt.value = ''
  recalculateError.value = ''; ipv6MutationError.value = ''; agentMutationError.value = ''
}
function loadCurrentReads(): void {
  if (!available.value) return
  void loadInstanceStats(); void loadTrafficHistory(); void loadAgentStatus()
  startAgentStatusAutoRefresh()
}
watch([() => props.host, () => props.host.id, session], () => { invalidateReads(); loadCurrentReads() }, { flush: 'sync' })
function activate(): void { if (!alive || active.value) return; active.value = true; loadCurrentReads() }
onMounted(activate)
onActivated(activate)
onDeactivated(() => { active.value = false; invalidateReads() })
onBeforeUnmount(() => { alive = false; active.value = false; invalidateReads() })

const agentIncusStatus = computed(() => {
  const incus = agentReport.value.incus
  if (incus.available === undefined) return '-'
  return incus.available ? t('admin.hosts.agentIncusAvailable') : t('admin.hosts.agentIncusUnavailable')
})

function formatMemory(mb: number | undefined): string {
  if (!mb) return '0'
  if (mb >= 1024) return (mb / 1024).toFixed(1) + ' GB'
  return mb + ' MB'
}

// 硬盘格式化（1024进制�?
function formatDisk(mb: number | undefined): string {
  if (!mb) return '0'
  if (mb >= 1024) return (mb / 1024).toFixed(1) + ' GB'
  return mb + ' MB'
}

function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleString()
}

function formatPercent(value: unknown): string {
  const number = metricNumber(value)
  return number === undefined ? '-' : `${number.toFixed(1)}%`
}

function percentWidth(value: unknown): string {
  const number = metricNumber(value)
  return number === undefined ? '0%' : `${Math.min(100, number)}%`
}

function progressColor(value: unknown, fallback = 'bg-blue-500'): string {
  const number = metricNumber(value)
  if (number === undefined) return fallback
  if (number >= 90) return 'bg-red-500'
  if (number >= 75) return 'bg-yellow-500'
  return fallback
}

function formatMemoryPair(used: number | undefined, total: number | undefined): string {
  if (used === undefined || total === undefined) return '-'
  return `${formatMemory(used)} / ${formatMemory(total)}`
}

function formatBytesPair(used: number | undefined, total: number | undefined): string {
  if (used === undefined || total === undefined) return '-'
  return `${formatBytes(used)} / ${formatBytes(total)}`
}

function formatLoadAverage(load1: number | undefined, load5: number | undefined, load15: number | undefined): string {
  if (load1 === undefined || load5 === undefined || load15 === undefined) return '-'
  return `${load1.toFixed(2)} / ${load5.toFixed(2)} / ${load15.toFixed(2)}`
}

function formatUptime(seconds: number | undefined): string {
  const value = metricNumber(seconds)
  if (value === undefined) return '-'
  const days = Math.floor(value / 86400)
  const hours = Math.floor((value % 86400) / 3600)
  const minutes = Math.floor((value % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

function refreshAgentStatus() {
  loadAgentStatus(true)
}

async function requestAgentUpgrade() {
  if (!available.value || !canRequestAgentUpgrade.value || hostMutating.value) return
  const context = readContext()
  agentUpgradeRequesting.value = true
  agentMutationError.value = ''
  try {
    const result = await api.hosts.requestAgentUpgrade(context.hostId)
    if (!context.current()) return
    if (!result || typeof result.requested !== 'boolean' || typeof result.message !== 'string' || !result.message.trim() ||
      !Number.isSafeInteger(result.nextHeartbeatSeconds) || result.nextHeartbeatSeconds < minAgentRefreshSeconds ||
      result.nextHeartbeatSeconds > maxAgentRefreshSeconds || !['latest', 'outdated'].includes(result.versionStatus)) throw Error(t('admin.hosts.agentUpgradeRequestFailed'))
    const message = result.requested
      ? t('admin.hosts.agentUpgradeRequestSuccess', { seconds: result.nextHeartbeatSeconds })
      : t('admin.hosts.agentAlreadyLatest')
    toast.success(message)
    await loadAgentStatus()
  } catch (err: any) {
    if (context.current()) { agentMutationError.value = t('admin.hosts.agentUpgradeRequestFailed') + ': ' + (err?.message || String(err)); toast.error(agentMutationError.value) }
  } finally {
    agentUpgradeRequesting.value = false
  }
}

async function generateAgentInstallCommand() {
  if (!available.value || hostMutating.value) return
  const context = readContext()
  if (!window.confirm(t('admin.hosts.agentInstallCommandConfirm'))) return
  if (!context.current() || hostMutating.value) return
  agentInstallCommandLoading.value = true
  installingCurrentHost = context.current
  agentMutationError.value = ''
  agentInstallCommand.value = ''; agentInstallTokenExpiresAt.value = ''
  agentSequence++; agentStatusRefreshing.value = false; agentStatusLoading.value = false
  try {
    const result = await api.hosts.generateAgentInstallCommand(context.hostId)
    if (!context.current()) return
    if (!result || result.host?.id !== context.hostId || result.agent?.hostId !== context.hostId ||
      !Number.isSafeInteger(result.agent.id) || result.agent.id < 1 || typeof result.agent.enabled !== 'boolean' ||
      typeof result.agent.status !== 'string' || !Array.isArray(result.agent.capabilities) || !result.agent.capabilities.every(value => typeof value === 'string') ||
      typeof result.installCommand !== 'string' || !result.installCommand.trim() || result.installCommand.length > 32768 ||
      typeof result.installTokenExpiresAt !== 'string' || !Number.isFinite(Date.parse(result.installTokenExpiresAt)) || Date.parse(result.installTokenExpiresAt) <= Date.now()) throw Error(t('admin.hosts.agentInstallCommandFailed'))
    agentSequence++
    agentInstallCommand.value = result.installCommand
    agentInstallTokenExpiresAt.value = result.installTokenExpiresAt
    agentStatus.value = result.agent
    startAgentStatusAutoRefresh()
    toast.success(t('admin.hosts.agentInstallCommandSuccess'))
  } catch (err: any) {
    if (context.current()) { agentMutationError.value = t('admin.hosts.agentInstallCommandFailed') + ': ' + (err?.message || String(err)); toast.error(agentMutationError.value) }
  } finally {
    installingCurrentHost = null
    agentInstallCommandLoading.value = false
  }
}

async function copyAgentInstallCommand() {
  if (!available.value || !agentInstallCommand.value || agentCommandCopying.value) return
  const context = readContext(), command = agentInstallCommand.value, version = commandGeneration
  const current = () => context.current() && version === commandGeneration && command === agentInstallCommand.value
  agentCommandCopying.value = true
  agentCommandCopyError.value = false
  try {
    await navigator.clipboard.writeText(command)
    if (current()) toast.success(t('admin.hosts.agentInstallCommandCopied'))
  } catch {
    if (current()) { agentCommandCopyError.value = true; toast.error(t('common.copyFailed')) }
  } finally {
    agentCommandCopying.value = false
  }
}

// 资源校对
async function recalculateResources() {
  if (!available.value || hostMutating.value) return
  const context = readContext()
  recalculating.value = true
  recalculateError.value = ''
  try {
    const result = await api.hosts.recalculateResources(context.hostId)
    if (!context.current()) return
    if (!result || typeof result.hasChanges !== 'boolean' || typeof result.message !== 'string' || !result.message.trim()) throw Error(t('admin.hosts.recalculateFailed'))
    if (result.hasChanges) {
      toast.success(t('admin.hosts.recalculateSuccess'))
      // 刷新父组件数�?
      emit('refresh')
    } else {
      toast.info(t('admin.hosts.recalculateNoChanges'))
    }
  } catch (err: any) {
    if (context.current()) { recalculateError.value = t('admin.hosts.recalculateFailed') + ': ' + (err?.message || String(err)); toast.error(recalculateError.value) }
  } finally {
    recalculating.value = false
  }
}

// 使用系统内实例计算的资源使用�?
// CPU 使用率：基于 CPU allowance（资源池大小�?
const cpuUsagePercent = computed(() => {
  const total = props.host.cpuAllowanceMax
  if (!total || total === 0) return 0
  return Math.min(100, Math.round((instanceStats.value.cpuUsed / total) * 100))
})

// 内存使用率：基于内存配额（资源池大小�?
const memoryUsagePercent = computed(() => {
  const total = props.host.memoryMax
  if (!total || total === 0) return 0
  return Math.min(100, Math.round((instanceStats.value.memoryUsed / total) * 100))
})

// 磁盘使用率：基于物理磁盘大小
const diskUsagePercent = computed(() => {
  const total = props.host.resources?.diskTotal || 0
  if (!total) return 0
  return Math.min(100, Math.round((instanceStats.value.diskUsed / total) * 100))
})

const chartMaxValue = computed(() => {
  if (trafficHistory.value.length === 0) return 1
  const max = Math.max(...trafficHistory.value.map(h => Number(h.total)))
  return max || 1
})

// 格式化字节数为可读字符串
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0'
  if (bytes < 1024) return bytes + 'B'
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + 'K'
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + 'M'
  return (bytes / 1073741824).toFixed(1) + 'G'
}

// Y 轴刻度标�?
const yAxisLabels = computed(() => {
  const max = chartMaxValue.value
  return {
    top: formatBytes(max),
    mid: formatBytes(max / 2),
    bottom: '0'
  }
})

// 格式化日期显�?(MM-DD)
function formatDateLabel(dateStr: string): string {
  return dateStr.slice(5) // 去掉年份，只保留 MM-DD
}

// X 轴标签（显示 5-7 个日期点�?
const xAxisLabels = computed(() => {
  const len = trafficHistory.value.length
  if (len === 0) return []
  if (len <= 7) return trafficHistory.value.map((h, index) => ({ date: formatDateLabel(h.date), index }))
  
  // 显示首、尾和中间均匀分布的点
  const step = Math.floor(len / 5)
  const labels = []
  for (let i = 0; i < len; i += step) {
    labels.push({ date: formatDateLabel(trafficHistory.value[i].date), index: i })
  }
  // 确保最后一个日期显�?
  if (labels[labels.length - 1].index !== len - 1) {
    labels.push({ date: formatDateLabel(trafficHistory.value[len - 1].date), index: len - 1 })
  }
  return labels
})
</script>

<template>
  <div class="host-info grid grid-cols-1 md:grid-cols-2 gap-4">
    <!-- 基本信息 -->
    <div class="card p-5">
      <h2 class="text-sm font-medium mb-4" :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">
        {{ t('admin.hosts.basicInfo') }}
      </h2>
      <dl class="space-y-3 text-sm">
        <div class="flex justify-between items-center">
          <dt class="text-gray-500">{{ t('admin.hosts.hostName') }}</dt>
          <dd class="font-medium uppercase" :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">
            {{ host.name }}
          </dd>
        </div>
        <div class="flex justify-between items-center">
          <dt class="text-gray-500">{{ t('admin.hosts.status') }}</dt>
          <dd>
            <span class="inline-flex items-center gap-1.5">
              <span :class="['w-2 h-2 rounded-full', statusInfo.dot]"></span>
              <span :class="['badge', statusInfo.class]">{{ statusInfo.label }}</span>
            </span>
          </dd>
        </div>
        <div class="flex justify-between items-center">
          <dt class="text-gray-500">{{ t('admin.hosts.hostDesc') }}</dt>
          <dd :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">
            <FlagIcon v-if="host.countryCode" :code="host.countryCode" size="sm" class="mr-1.5" />
            {{ host.location || '-' }}
          </dd>
        </div>
        <div class="flex justify-between items-center">
          <dt class="text-gray-500">{{ t('admin.hosts.instances') }}</dt>
          <dd :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">
            {{ statsReady ? instanceStats.count : '-' }}
          </dd>
        </div>
        <div class="flex justify-between items-center">
          <dt class="text-gray-500">{{ t('admin.hosts.instanceTypeLabel') }}</dt>
          <dd :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">
            {{ host.instanceType === 'container' ? t('admin.hosts.typeContainer') : host.instanceType === 'vm' ? t('admin.hosts.typeVm') : t('admin.hosts.typeBoth') }}
          </dd>
        </div>
        <div class="flex justify-between items-center">
          <dt class="text-gray-500">{{ t('admin.hosts.apiUrl') }}</dt>
          <dd class="font-mono text-xs truncate max-w-[200px]" :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'" :title="host.url">
            {{ host.url }}
          </dd>
        </div>
        <div v-if="host.createdAt" class="flex justify-between items-center">
          <dt class="text-gray-500">{{ t('common.createdAt') }}</dt>
          <dd class="text-xs" :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'">
            {{ formatDate(host.createdAt) }}
          </dd>
        </div>
      </dl>
    </div>

    <!-- 资源使用 -->
    <div class="card p-5">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-sm font-medium" :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">
          {{ t('admin.hosts.resources') }}
        </h2>
        <button
          class="btn-ghost btn-xs flex items-center gap-1"
          :disabled="hostMutating"
          :title="t('admin.hosts.recalculateResourcesTip')"
          @click="recalculateResources"
        >
          <svg 
            class="w-3.5 h-3.5" 
            :class="{ 'animate-spin': recalculating }"
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <span class="hidden sm:inline">{{ t('admin.hosts.recalculateResources') }}</span>
        </button>
      </div>
      <p v-if="recalculateError" data-host-mutation-error class="text-sm text-themed-secondary break-words mb-3" role="status">{{ recalculateError }}</p>
      <p v-if="statsError" data-host-stats-error class="text-sm text-themed-secondary flex items-center justify-between gap-3 mb-3" role="status">
        {{ t('common.loadFailed') }} · {{ t('admin.hosts.resources') }}
        <button type="button" class="btn-secondary btn-xs shrink-0" :disabled="statsLoading" @click="loadInstanceStats">{{ t('common.retry') }}</button>
      </p>
      <div v-if="statsReady" class="space-y-4">
        <!-- CPU -->
        <div>
          <div class="flex justify-between text-sm mb-1">
            <span class="text-gray-500">{{ t('admin.hosts.cpuQuota') }}</span>
            <span :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">
              {{ instanceStats.cpuUsed }} / {{ host.cpuAllowanceMax || 0 }}
            </span>
          </div>
          <div class="h-2 rounded-full overflow-hidden" :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-200'">
            <div
              class="h-full rounded-full transition-all duration-500"
              :class="cpuUsagePercent > 80 ? 'bg-red-500' : cpuUsagePercent > 60 ? 'bg-yellow-500' : 'bg-blue-500'"
              :style="{ width: cpuUsagePercent + '%' }"
            ></div>
          </div>
        </div>
        <!-- Memory -->
        <div>
          <div class="flex justify-between text-sm mb-1">
            <span class="text-gray-500">{{ t('admin.hosts.memoryQuota') }}</span>
            <span :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">
              {{ formatMemory(instanceStats.memoryUsed) }} / {{ formatMemory(host.memoryMax) }}
            </span>
          </div>
          <div class="h-2 rounded-full overflow-hidden" :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-200'">
            <div
              class="h-full rounded-full transition-all duration-500"
              :class="memoryUsagePercent > 80 ? 'bg-red-500' : memoryUsagePercent > 60 ? 'bg-yellow-500' : 'bg-green-500'"
              :style="{ width: memoryUsagePercent + '%' }"
            ></div>
          </div>
        </div>
        <!-- Disk -->
        <div>
          <div class="flex justify-between text-sm mb-1">
            <span class="text-gray-500">{{ t('admin.hosts.diskUsage') }}</span>
            <span :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">
              {{ formatDisk(instanceStats.diskUsed) }} / {{ formatDisk(host.resources?.diskTotal) }}
            </span>
          </div>
          <div class="h-2 rounded-full overflow-hidden" :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-200'">
            <div
              class="h-full rounded-full transition-all duration-500"
              :class="diskUsagePercent > 80 ? 'bg-red-500' : diskUsagePercent > 60 ? 'bg-yellow-500' : 'host-meter'"
              :style="{ width: diskUsagePercent + '%' }"
            ></div>
          </div>
        </div>
      </div>
      <p v-else-if="!statsError" class="text-sm text-themed-secondary" role="status">{{ t(statsLoading ? 'common.loading' : 'common.notSet') }}</p>

      <!-- NAT 配置 -->
      <div
        v-if="host.natConfig?.publicIp || host.natConfig?.publicIpv6 || host.natConfig?.bindIp || host.natConfig?.bindIpv6"
        class="mt-6 pt-4 border-t"
        :class="themeStore.isDark ? 'border-gray-800' : 'border-gray-200'"
      >
        <h3 class="text-xs font-medium text-gray-500 mb-3">{{ t('admin.hosts.natConfig') }}</h3>
        <dl class="space-y-2 text-sm">
          <div v-if="host.natConfig?.publicIp" class="flex justify-between">
            <dt class="text-gray-500">{{ t('admin.hosts.natPublicIpv4') }}</dt>
            <dd class="font-mono" :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">{{ host.natConfig.publicIp }}</dd>
          </div>
          <div v-if="ipv6Sync" class="space-y-2 pt-2">
            <dt class="flex flex-wrap items-center justify-between gap-2">
              <span class="text-gray-500">{{ t('ipv6Delivery.title') }}</span>
              <button v-if="authStore.user?.role === 'admin'" type="button" class="btn-secondary text-xs" :disabled="hostMutating" @click="syncIpv6">{{ t(syncingIpv6 ? 'ipv6Delivery.checking' : 'ipv6Delivery.sync') }}</button>
            </dt>
            <dd class="space-y-2">
              <p v-if="ipv6MutationError" data-host-mutation-error class="text-sm text-themed-secondary break-words" role="status">{{ ipv6MutationError }}</p>
              <PublicIpv6Addresses :addresses="ipv6Sync.addresses" show-empty />
              <p class="text-xs" :class="ipv6Sync.status === 'failed' ? 'text-red-600 dark:text-red-400' : ipv6Sync.status === 'pending' ? 'text-amber-700 dark:text-amber-300' : 'text-themed-muted'" role="status">{{ t('ipv6Delivery.status.' + ipv6Sync.status) }}</p>
              <p v-if="ipv6Error" class="text-xs text-amber-700 dark:text-amber-300">{{ ipv6Error }}</p>
              <p class="text-xs text-themed-muted">{{ t('ipv6Delivery.adminHint') }}</p>
              <p v-if="ipv6Sync.checkedAt" class="text-xs text-themed-muted">{{ t('ipv6Delivery.checked') }}: {{ new Date(ipv6Sync.checkedAt).toLocaleString() }}</p>
            </dd>
          </div>
          <div v-else-if="host.natConfig?.publicIpv6" class="flex justify-between">
            <dt class="text-gray-500">{{ t('admin.hosts.natPublicIpv6') }}</dt>
            <dd class="font-mono break-all text-right" :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">{{ host.natConfig.publicIpv6 }}</dd>
          </div>
          <div v-if="host.natConfig?.bindIp" class="flex justify-between">
            <dt class="text-gray-500">{{ t('admin.hosts.natBindIpv4') }}</dt>
            <dd class="font-mono break-all text-right" :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">{{ host.natConfig.bindIp }}</dd>
          </div>
          <div v-if="host.natConfig?.bindIpv6" class="flex justify-between">
            <dt class="text-gray-500">{{ t('admin.hosts.natBindIpv6') }}</dt>
            <dd class="font-mono break-all text-right" :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">{{ host.natConfig.bindIpv6 }}</dd>
          </div>
          <div v-if="host.natConfig?.portRangeStart != null || host.natConfig?.portRangeEnd != null" class="flex justify-between">
            <dt class="text-gray-500">{{ t('admin.hosts.portRange') }}</dt>
            <dd class="font-mono" :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">
              {{ host.natConfig.portRangeStart }} - {{ host.natConfig.portRangeEnd }}
            </dd>
          </div>
          <div v-if="host.natConfig.portsUsedCount !== undefined" class="flex justify-between">
            <dt class="text-gray-500">{{ t('admin.hosts.portsUsed') }}</dt>
            <dd :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">{{ host.natConfig.portsUsedCount }}</dd>
          </div>
        </dl>
      </div>
    </div>
  </div>

  <!-- 宿主机状态 -->
  <div class="host-info card p-5 mt-4">
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
      <div>
        <h2 class="text-sm font-medium" :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">
          {{ t('admin.hosts.agentStatusTitle') }}
        </h2>
        <p class="text-xs mt-1" :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-400'">
          {{ agentStatusDescription }}
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2 self-start sm:self-auto">
        <button
          class="btn-secondary btn-xs flex items-center gap-1"
          :disabled="hostMutating"
          @click="generateAgentInstallCommand"
        >
          <svg
            class="w-3.5 h-3.5"
            :class="{ 'animate-spin': agentInstallCommandLoading }"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v12m0 0l4-4m-4 4l-4-4M4 17v1a3 3 0 003 3h10a3 3 0 003-3v-1" />
          </svg>
          <span>{{ t('admin.hosts.agentInstallCommand') }}</span>
        </button>
        <button
          class="btn-ghost btn-xs flex items-center gap-1"
          :disabled="agentStatusRefreshing || agentInstallCommandLoading"
          @click="refreshAgentStatus"
        >
          <svg
            class="w-3.5 h-3.5"
            :class="{ 'animate-spin': agentStatusRefreshing }"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <span>{{ t('common.refresh') }}</span>
        </button>
      </div>
    </div>

    <div
      v-if="agentInstallCommand"
      class="rounded-lg p-3 mb-4"
      :class="themeStore.isDark ? 'bg-gray-900/70 border border-gray-800' : 'bg-gray-50 border border-gray-200'"
    >
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-2">
        <div>
          <p class="text-xs font-medium" :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">
            {{ t('admin.hosts.agentInstallCommandTitle') }}
          </p>
          <p class="text-xs mt-0.5" :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-500'">
            {{ t('admin.hosts.agentInstallCommandHint') }}
            <span v-if="agentInstallTokenExpiresAt">
              {{ t('admin.hosts.agentInstallTokenExpiresAt', { time: formatDate(agentInstallTokenExpiresAt) }) }}
            </span>
          </p>
        </div>
        <button type="button" data-host-command-copy class="btn-secondary btn-xs shrink-0 whitespace-nowrap" :disabled="agentCommandCopying" :aria-busy="agentCommandCopying" @click="copyAgentInstallCommand">
          {{ t('admin.hosts.copyCommand') }}
        </button>
      </div>
      <p v-if="agentCommandCopyError" data-host-command-copy-error class="text-sm text-themed-secondary mb-2" role="status">{{ t('common.copyFailed') }}</p>
      <pre class="rounded-md p-3 overflow-x-auto text-xs font-mono whitespace-pre-wrap break-all" :class="themeStore.isDark ? 'bg-black/40 text-green-300' : 'bg-gray-900 text-green-300'">{{ agentInstallCommand }}</pre>
    </div>

    <p v-if="agentMutationError" data-host-mutation-error class="text-sm text-themed-secondary break-words mb-3" role="status">{{ agentMutationError }}</p>
    <div v-if="agentStatusError" data-host-agent-error class="rounded-lg p-3 mb-3 text-sm flex items-center justify-between gap-3" :class="themeStore.isDark ? 'bg-red-500/10 text-red-300' : 'bg-red-50 text-red-700'" role="status">
      <span class="min-w-0 break-words">{{ t('admin.hosts.agentStatusLoadFailed') }}: {{ agentStatusError }}</span>
      <button type="button" class="btn-secondary btn-xs shrink-0" :disabled="agentStatusRefreshing" @click="refreshAgentStatus">{{ t('common.retry') }}</button>
    </div>
    <div v-if="agentStatusLoading" class="animate-pulse grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div
        v-for="i in 6"
        :key="i"
        class="h-20 rounded-lg"
        :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-100'"
      ></div>
    </div>

    <div v-else-if="!agentStatus && !agentStatusError" class="flex items-start gap-3 rounded-lg p-4" :class="themeStore.isDark ? 'bg-gray-800/60' : 'bg-gray-50'">
      <span :class="['w-2.5 h-2.5 rounded-full mt-1.5', agentStatusInfo.dot]"></span>
      <div>
        <p class="text-sm font-medium" :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">
          {{ agentStatusInfo.label }}
        </p>
        <p class="text-xs mt-1" :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-400'">
          {{ t('admin.hosts.agentNoRecordHint') }}
        </p>
      </div>
    </div>

    <template v-else-if="agentStatus">
      <div
        class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 pb-4 mb-4 border-b"
        :class="themeStore.isDark ? 'border-gray-800' : 'border-gray-100'"
      >
        <div class="flex flex-wrap items-center gap-2">
          <span class="inline-flex items-center gap-1.5">
            <span :class="['w-2 h-2 rounded-full', agentStatusInfo.dot]"></span>
            <span :class="['badge', agentStatusInfo.class]">{{ agentStatusInfo.label }}</span>
          </span>
          <button
            v-if="canRequestAgentUpgrade"
            type="button"
            class="text-xs px-2 py-1 rounded-full font-mono inline-flex items-center gap-1.5 transition hover:brightness-105 disabled:cursor-wait disabled:opacity-70"
            :class="agentVersionInfo.class"
            :title="agentStatus.latestVersion ? t('admin.hosts.agentUpgradeClickHint', { version: agentStatus.latestVersion }) : agentVersionInfo.title"
            :disabled="hostMutating"
            @click="requestAgentUpgrade"
          >
            <svg
              v-if="agentUpgradeRequesting"
              class="w-3 h-3 animate-spin"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span v-if="agentStatus.version">{{ agentStatus.version }}</span>
            <span class="font-sans font-medium">{{ agentVersionInfo.label }}</span>
          </button>
          <span
            v-else
            class="text-xs px-2 py-1 rounded-full font-mono inline-flex items-center gap-1.5"
            :class="agentVersionInfo.class"
            :title="agentVersionInfo.title"
          >
            <span v-if="agentStatus.version">{{ agentStatus.version }}</span>
            <span class="font-sans font-medium">{{ agentVersionInfo.label }}</span>
          </span>
          <span
            v-for="capability in agentStatus.capabilities"
            :key="capability"
            class="text-xs px-2 py-1 rounded-full"
            :class="themeStore.isDark ? 'bg-blue-500/10 text-blue-300' : 'bg-blue-50 text-blue-600'"
          >
            {{ capability }}
          </span>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-xs" :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-400'">
          <p>
            {{ t('admin.hosts.agentIncus') }}:
            <span :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'">{{ agentIncusStatus }}</span>
            <span
              v-if="agentReport.incus?.socket"
              class="font-mono inline-block max-w-[14rem] truncate align-bottom ml-1"
              :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-400'"
              :title="agentReport.incus.socket"
            >
              {{ agentReport.incus.socket }}
            </span>
          </p>
          <p>
            {{ t('admin.hosts.agentLastSeen') }}:
            <span :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'">{{ formatDate(agentStatus.lastSeenAt || undefined) }}</span>
          </p>
          <p>
            {{ t('admin.hosts.agentHeartbeatIp') }}:
            <span class="font-mono" :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'">{{ agentStatus.lastHeartbeatIp || '-' }}</span>
          </p>
          <p>
            {{ t('admin.hosts.agentUptime') }}:
            <span :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'">{{ formatUptime(hostMetrics.uptimeSeconds) }}</span>
          </p>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div class="rounded-lg p-4" :class="themeStore.isDark ? 'bg-gray-800/60' : 'bg-white border border-gray-200 shadow-sm'">
          <div class="flex justify-between items-start gap-3 mb-2">
            <div>
              <p class="text-xs font-medium" :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'">{{ t('admin.hosts.agentCpuUsage') }}</p>
              <p class="text-xs mt-0.5" :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-500'">
                {{ hostResources.cpuTotal ?? '-' }} {{ t('admin.hosts.agentCpuCores') }}
              </p>
            </div>
            <p class="text-lg font-semibold" :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-900'">
              {{ formatPercent(hostResources.cpuUsagePercent) }}
            </p>
          </div>
          <div class="h-2 rounded-full overflow-hidden" :class="themeStore.isDark ? 'bg-gray-900' : 'bg-gray-200'">
            <div
              class="h-full rounded-full transition-all duration-500"
              :class="progressColor(hostResources.cpuUsagePercent, 'bg-blue-500')"
              :style="{ width: percentWidth(hostResources.cpuUsagePercent) }"
            ></div>
          </div>
        </div>

        <div class="rounded-lg p-4" :class="themeStore.isDark ? 'bg-gray-800/60' : 'bg-white border border-gray-200 shadow-sm'">
          <div class="flex justify-between items-start gap-3 mb-2">
            <div>
              <p class="text-xs font-medium" :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'">{{ t('admin.hosts.agentMemoryUsage') }}</p>
              <p class="text-xs mt-0.5" :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-500'">
                {{ formatMemoryPair(hostResources.memoryUsedMb, hostResources.memoryTotalMb) }}
              </p>
            </div>
            <p class="text-lg font-semibold" :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-900'">
              {{ formatPercent(hostResources.memoryUsagePercent) }}
            </p>
          </div>
          <div class="h-2 rounded-full overflow-hidden" :class="themeStore.isDark ? 'bg-gray-900' : 'bg-gray-200'">
            <div
              class="h-full rounded-full transition-all duration-500"
              :class="progressColor(hostResources.memoryUsagePercent, 'bg-green-500')"
              :style="{ width: percentWidth(hostResources.memoryUsagePercent) }"
            ></div>
          </div>
        </div>

        <div class="rounded-lg p-4" :class="themeStore.isDark ? 'bg-gray-800/60' : 'bg-white border border-gray-200 shadow-sm'">
          <div class="flex justify-between items-start gap-3 mb-2">
            <div>
              <p class="text-xs font-medium" :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'">{{ t('admin.hosts.agentSwapUsage') }}</p>
              <p class="text-xs mt-0.5" :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-500'">
                {{ formatMemoryPair(hostResources.swapUsedMb, hostResources.swapTotalMb) }}
              </p>
            </div>
            <p class="text-lg font-semibold" :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-900'">
              {{ formatPercent(hostResources.swapUsagePercent) }}
            </p>
          </div>
          <div class="h-2 rounded-full overflow-hidden" :class="themeStore.isDark ? 'bg-gray-900' : 'bg-gray-200'">
            <div
              class="h-full rounded-full transition-all duration-500"
              :class="progressColor(hostResources.swapUsagePercent, 'bg-cyan-500')"
              :style="{ width: percentWidth(hostResources.swapUsagePercent) }"
            ></div>
          </div>
        </div>

        <div class="rounded-lg p-4" :class="themeStore.isDark ? 'bg-gray-800/60' : 'bg-white border border-gray-200 shadow-sm'">
          <div class="flex justify-between items-start gap-3 mb-2">
            <div>
              <p class="text-xs font-medium" :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'">
                {{ t('admin.hosts.agentDiskUsage') }}
                <span v-if="hostResources.diskMountpoint" class="font-mono">({{ hostResources.diskMountpoint }})</span>
              </p>
              <p class="text-xs mt-0.5" :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-500'">
                {{ formatBytesPair(hostResources.diskUsedBytes, hostResources.diskTotalBytes) }}
              </p>
            </div>
            <p class="text-lg font-semibold" :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-900'">
              {{ formatPercent(hostResources.diskUsagePercent) }}
            </p>
          </div>
          <div class="h-2 rounded-full overflow-hidden" :class="themeStore.isDark ? 'bg-gray-900' : 'bg-gray-200'">
            <div
              class="h-full rounded-full transition-all duration-500"
              :class="progressColor(hostResources.diskUsagePercent, 'host-meter')"
              :style="{ width: percentWidth(hostResources.diskUsagePercent) }"
            ></div>
          </div>
        </div>

        <div class="rounded-lg p-4" :class="themeStore.isDark ? 'bg-gray-900/60' : 'bg-white border border-gray-200 shadow-sm'">
          <p class="text-xs font-medium mb-1" :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'">{{ t('admin.hosts.agentLoadAverage') }}</p>
          <p class="text-lg font-semibold" :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-900'">
            {{ formatLoadAverage(hostMetrics.load1, hostMetrics.load5, hostMetrics.load15) }}
          </p>
          <p class="text-xs mt-1" :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-500'">{{ t('admin.hosts.agentLoadAverageHint') }}</p>
        </div>

        <div class="rounded-lg p-4" :class="themeStore.isDark ? 'bg-gray-900/60' : 'bg-white border border-gray-200 shadow-sm'">
          <p class="text-xs font-medium mb-1" :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'">{{ t('admin.hosts.agentProcessCount') }}</p>
          <p class="text-lg font-semibold" :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-900'">
            {{ hostResources.processCount ?? '-' }}
          </p>
        </div>
      </div>
    </template>
  </div>

  <!-- 流量统计 -->
  <div class="host-info card p-5 mt-4">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-sm font-medium" :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">
        {{ t('admin.hosts.trafficStats') }}
        <span v-if="trafficPeriod" class="text-xs font-normal ml-2" :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-400'">
          ({{ trafficPeriod.periodStart.slice(5) }} ~ {{ trafficPeriod.periodEnd.slice(5) }})
        </span>
      </h2>
      <span 
        v-if="!trafficLoading && trafficSummary"
        class="text-xs px-2 py-1 rounded-full"
        :class="themeStore.isDark ? 'bg-gray-800 text-gray-400' : 'bg-gray-100 text-gray-600'"
      >
        {{ t('admin.hosts.monthlyUsed') }}: {{ trafficSummary.totalUsedFormatted }} | {{ t('admin.hosts.hostTotalLimit') }}: {{ trafficSummary.totalLimitFormatted }}
      </span>
    </div>

    <!-- 加载状�?-->
    <p v-if="trafficError" data-host-traffic-error class="text-sm text-themed-secondary flex items-center justify-between gap-3 mb-3" role="status">
      {{ t('common.loadFailed') }} · {{ t('admin.hosts.trafficStats') }}
      <button type="button" class="btn-secondary btn-xs shrink-0" :disabled="trafficLoading" @click="loadTrafficHistory">{{ t('common.retry') }}</button>
    </p>
    <div v-if="trafficLoading" class="animate-pulse">
      <div class="flex items-end gap-1 h-32">
        <div 
          v-for="i in 30" 
          :key="i" 
          class="flex-1 rounded-t"
          :class="themeStore.isDark ? 'bg-gray-700' : 'bg-gray-200'"
          :style="{ height: `${Math.random() * 100}%` }"
        ></div>
      </div>
    </div>

    <!-- 有数据显示图�?-->
    <template v-else-if="trafficHistory.length > 0">
      <div class="flex">
        <!-- Y 轴刻�?-->
        <div class="flex flex-col justify-between h-32 pr-2 text-xs w-10" :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-400'">
          <span class="text-right">{{ yAxisLabels.top }}</span>
          <span class="text-right">{{ yAxisLabels.mid }}</span>
          <span class="text-right">{{ yAxisLabels.bottom }}</span>
        </div>
        
        <!-- 图表区域 -->
        <div class="flex-1">
          <!-- 背景网格�?-->
          <div class="relative h-32">
            <div 
              class="absolute inset-0 flex flex-col justify-between pointer-events-none"
            >
              <div class="border-b" :class="themeStore.isDark ? 'border-gray-800' : 'border-gray-100'"></div>
              <div class="border-b" :class="themeStore.isDark ? 'border-gray-800' : 'border-gray-100'"></div>
              <div class="border-b" :class="themeStore.isDark ? 'border-gray-800' : 'border-gray-100'"></div>
            </div>
            
            <!-- 柱状�?-->
            <div class="absolute inset-0 flex items-end gap-0.5 px-1">
              <div 
                v-for="(item, index) in trafficHistory" 
                :key="item.date"
                class="host-traffic-bar flex-1 min-w-0.5 rounded-t transition-all duration-200 cursor-pointer group relative"
                :style="{ height: `${Math.max((Number(item.total) / chartMaxValue) * 100, 1)}%` }"
              >
                <!-- Tooltip -->
                <div 
                  class="absolute bottom-full mb-2 px-2.5 py-1.5 text-xs rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10"
                  :class="[
                    themeStore.isDark ? 'bg-gray-800 text-gray-200 border border-gray-700' : 'bg-white text-gray-900 border border-gray-200 shadow-md',
                    index < 5 ? 'left-0' : index > trafficHistory.length - 5 ? 'right-0' : 'left-1/2 -translate-x-1/2'
                  ]"
                >
                  <div class="font-medium mb-1">{{ item.date }}</div>
                  <div class="flex items-center gap-1.5">
                    <span class="w-2 h-2 rounded-full bg-green-500"></span>
                    <span>{{ t('traffic.download') }}: {{ item.rxFormatted }}</span>
                  </div>
                  <div class="flex items-center gap-1.5">
                    <span class="w-2 h-2 rounded-full bg-orange-500"></span>
                    <span>{{ t('traffic.upload') }}: {{ item.txFormatted }}</span>
                  </div>
                  <div 
                    class="mt-1 pt-1 font-medium"
                    :class="themeStore.isDark ? 'border-t border-gray-700' : 'border-t border-gray-200'"
                  >
                    {{ t('traffic.total') }}: {{ item.totalFormatted }}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- X轴标�?-->
          <div class="relative h-5 mt-1">
            <div 
              v-for="label in xAxisLabels" 
              :key="label.index"
              class="absolute text-xs transform -translate-x-1/2"
              :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-400'"
              :style="{ left: `${(label.index / Math.max(trafficHistory.length - 1, 1)) * 100}%` }"
            >
              {{ label.date }}
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- 无数据状�?-->
    <div v-else-if="trafficReady" class="text-center py-8" data-host-traffic-empty>
      <span :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-400'">
        {{ t('traffic.noHistoryData') }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.host-info {
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}
.host-info.card,
.host-info .card {
  box-shadow: none !important;
}
.host-info [class*="text-gray-400"],
.host-info [class*="text-gray-500"] {
  color: var(--text-secondary) !important;
}
.host-info .text-xs {
  font-size: 13px;
  line-height: 1.5;
}
.host-info .py-8 {
  padding-block: 16px;
}
.host-info .shadow-sm {
  box-shadow: none;
}
.host-info .host-traffic-bar {
  background-color: var(--text-primary);
}
.host-info .bg-blue-500,
.host-info .host-meter,
.host-info .bg-cyan-500 {
  background-color: var(--text-primary) !important;
}
.host-info [class*="bg-blue-500/10"],
.host-info .bg-blue-50 {
  background-color: var(--bg-tertiary) !important;
  color: var(--text-secondary) !important;
}
.host-info button:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 3px;
}
@media (max-width: 640px) {
  .host-info button {
    min-height: 44px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .host-info [class*="transition"],
  .host-info [class*="animate"] {
    transition: none;
    animation: none;
  }
}
</style>
