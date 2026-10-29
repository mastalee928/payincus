<script setup lang="ts">
import { ref, onMounted, onActivated, onDeactivated, onBeforeUnmount, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import api from '@/api'
import { useThemeStore } from '@/stores/theme'
import { useToast } from '@/stores/toast'
import { useAuthStore } from '@/stores/auth'
import SkeletonLoader from '@/components/SkeletonLoader.vue'
import HostInfoTab from '@/components/host/HostInfoTab.vue'
import HostImagesTab from '@/components/host/HostImagesTab.vue'
import MyHostConfigTab from '@/components/host/MyHostConfigTab.vue'
import HostInstancesTab from '@/components/host/HostInstancesTab.vue'
import HostStorageTab from '@/components/host/HostStorageTab.vue'
import HostPublicIpv4Tab from '@/components/host/HostPublicIpv4Tab.vue'
import HostCaddyTab from '@/components/host/HostCaddyTab.vue'
import HostRedeemCodesTab from '@/components/host/HostRedeemCodesTab.vue'
import HostCreateInstanceTab from '@/components/host/HostCreateInstanceTab.vue'
import HostOpsTab from '@/components/host/HostOpsTab.vue'
import FlagIcon from '@/components/FlagIcon.vue'
import { hostsPath } from '@/utils/app-paths'

// 为 KeepAlive exclude 匹配定义组件名称
defineOptions({
  name: 'MyHostDetailView'
})

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const toast = useToast()
const themeStore = useThemeStore()
const authStore = useAuthStore()

// 是否是管理员
const isAdmin = computed(() => authStore.user?.role === 'admin')

type TabType = 'info' | 'config' | 'images' | 'instances' | 'storage' | 'publicIpv4' | 'caddy' | 'redeemCodes' | 'ops' | 'create'
const activeTab = ref<TabType>('info')

interface Host {
  id: number
  name: string
  url: string
  location?: string
  countryCode: string
  status: 'online' | 'offline' | 'maintenance'
  instanceCount?: number
  certPath?: string
  keyPath?: string
  cpuAllowanceMax?: number
  memoryMax?: number
  instanceType?: 'container' | 'vm' | 'both'
  notifyPurchase?: boolean
  notifyRenew?: boolean
  notifyDestroy?: boolean
  resources?: {
    cpuUsed: number
    memoryUsed: number
    diskTotal: number  // 计算值，来自 storage_size * 1024
    diskUsed: number
  }
  natConfig?: {
    publicIp: string | null
    publicIpv6?: string | null
    bindIp?: string | null
    bindIpv6?: string | null
    portRangeStart: number | null
    portRangeEnd: number | null
    portsUsedCount?: number
  }
  createdAt?: string
  updatedAt?: string
}

const host = ref<Host | null>(null)
const loading = ref(true)
const hostLoadError = ref('')
let hostReadGeneration = 0, hostReadSequence = 0
let pendingHostRead: (() => boolean) | null = null
const actionLoading = ref('')
const actionError = ref('')
let hostActionGeneration = 0
let pendingHostAction: { current: () => boolean } | null = null

// 删除确认弹窗
const showDeleteModal = ref(false)
const deleteConfirmName = ref('')

// 批量延期弹窗（仅管理员）
const showExtendModal = ref(false)
const extendDays = ref<number | undefined>(undefined)
const paidInstanceCount = ref(0)

// 重新安装弹窗
const showReinstallModal = ref(false)
const reinstallCommand = ref('')
const reinstallCopying = ref(false), reinstallCopyError = ref(false), copyViewActive = ref(true)
let copyViewAlive = true, reinstallCopyGeneration = 0
const copySession = computed(() => {
  if (!authStore.user || !authStore.token || !Number.isSafeInteger(authStore.user.id) || authStore.user.id < 1) return ''
  let identity = authStore.token
  try {
    const payload = JSON.parse(atob(identity.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    if (typeof payload.sid === 'string' && payload.sid) identity = payload.sid
  } catch { /* Legacy tokens retain their full identity. */ }
  return `${authStore.user.id}:${authStore.user.role}:${identity}`
})
function invalidateReinstallCopy() { reinstallCopyGeneration++; reinstallCopyError.value = false }
watch([() => route.fullPath, copySession, () => host.value?.id, reinstallCommand, showReinstallModal], invalidateReinstallCopy, { flush: 'sync' })
function clearReinstallCommand() { reinstallCommand.value = ''; showReinstallModal.value = false; invalidateReinstallCopy() }
watch([() => route.fullPath, copySession, () => host.value?.id], clearReinstallCommand, { flush: 'sync' })
onActivated(() => { copyViewActive.value = true })
onDeactivated(() => { copyViewActive.value = false; clearReinstallCommand() })
onBeforeUnmount(() => { copyViewAlive = false; clearReinstallCommand() })

const reinstallStatus = ref<'waiting' | 'verifying' | 'success' | 'error'>('waiting')
const reinstallError = ref('')

const statusInfo = computed(() => {
  if (!host.value) return { label: '', class: '', dot: '' }
  const map: Record<string, { label: string; class: string; dot: string }> = {
    online: { label: t('admin.hosts.statusOnline'), class: 'badge-success', dot: 'bg-green-500' },
    offline: { label: t('admin.hosts.statusOffline'), class: 'badge-default', dot: 'bg-gray-500' },
    maintenance: { label: t('admin.hosts.statusMaintenance'), class: 'badge-warning', dot: 'bg-yellow-500' }
  }
  return map[host.value.status] || map.offline
})

// 本组件被用户端和管理端共用，两侧的路由名不同：
// 用户端 = 'my-host-detail'，管理端 = 'admin-my-host-detail'。
// 之前只比较 'my-host-detail'，导致管理端的守卫永远提前 return、从不重新加载数据。
const HOST_DETAIL_ROUTE_NAMES = ['my-host-detail', 'admin-my-host-detail']
const isOnHostDetailRoute = () => HOST_DETAIL_ROUTE_NAMES.includes(String(route.name ?? ''))

function invalidateHostReads() {
  hostActionGeneration++; actionError.value = ''
  hostReadGeneration++; hostReadSequence++; pendingHostRead = null
  host.value = null; loading.value = false; hostLoadError.value = ''; activeTab.value = 'info'
  showDeleteModal.value = false; deleteConfirmName.value = ''
  showExtendModal.value = false; extendDays.value = undefined; paidInstanceCount.value = 0
  clearReinstallCommand(); reinstallStatus.value = 'waiting'; reinstallError.value = ''
}
watch([() => route.fullPath, copySession], () => {
  invalidateHostReads()
  if (copyViewAlive && copyViewActive.value && isOnHostDetailRoute()) void loadHost()
}, { flush: 'sync' })
onMounted(() => { if (!pendingHostRead?.()) void loadHost() })
onActivated(() => { if (isOnHostDetailRoute() && !host.value && !pendingHostRead?.()) void loadHost() })
onDeactivated(invalidateHostReads)
onBeforeUnmount(invalidateHostReads)

async function loadHost() {
  if (!copyViewAlive || !copyViewActive.value || !isOnHostDetailRoute()) return
  if (pendingHostAction?.current()) return
  const rawId = String(route.params.id ?? ''), hostId = Number(rawId), session = copySession.value
  if (!/^[1-9]\d*$/.test(rawId) || !Number.isSafeInteger(hostId)) { hostLoadError.value = t('admin.hosts.invalidId'); loading.value = false; return }
  if (!session) { hostLoadError.value = t('admin.hosts.loadFailed'); loading.value = false; return }
  const path = route.fullPath, generation = hostReadGeneration, sequence = ++hostReadSequence
  const current = () => copyViewAlive && copyViewActive.value && isOnHostDetailRoute() && path === route.fullPath &&
    session === copySession.value && generation === hostReadGeneration && sequence === hostReadSequence
  pendingHostRead = current; loading.value = !host.value; hostLoadError.value = ''
  try {
    const res: unknown = await api.hosts.get(hostId)
    if (!current()) return
    const detail = res && typeof res === 'object' && 'host' in res ? res.host : res
    if (!isHostDetail(detail, hostId)) throw Error(t('admin.hosts.loadFailed'))
    host.value = detail
  } catch (err: any) {
    if (current()) hostLoadError.value = t('admin.hosts.loadFailed') + ': ' + (err?.message || String(err))
  } finally {
    if (current()) { loading.value = false; pendingHostRead = null }
  }
}

function isHostDetail(value: unknown, hostId: number): value is Host {
  if (!value || typeof value !== 'object') return false
  const detail = value as Partial<Host>
  return detail.id === hostId && typeof detail.name === 'string' && typeof detail.url === 'string' &&
    typeof detail.countryCode === 'string' && typeof detail.status === 'string' && ['online', 'offline', 'maintenance'].includes(detail.status)
}

// 兜底态里的「重试」：重新拉一次节点详情
async function retryLoadHost() {
  if (pendingHostRead?.()) return
  await loadHost()
}

async function testConnection() {
  await runHostAction('test', 'admin.hosts.testFailed', async (id, current) => {
    const res: unknown = await api.hosts.test(id)
    if (!current()) return
    requireHostSuccess(res)
    toast.success(t('admin.hosts.testSuccess'))
    return true
  })
}

// 验证并连接宿主机（用于未完成安装的宿主机）
async function verifyHost() {
  await runHostAction('verify', 'admin.hosts.verifyFailed', async (id, current) => {
    const res: unknown = await api.hosts.verify(id)
    if (!current()) return
    requireHostSuccess(res)
    toast.success(t('admin.hosts.verifySuccess'))
    return true
  })
}

watch(() => host.value?.id, () => { hostActionGeneration++; actionError.value = '' }, { flush: 'sync' })
let deleteDialogGeneration = 0
watch([showDeleteModal, deleteConfirmName], () => { deleteDialogGeneration++ }, { flush: 'sync' })

function requireHostSuccess(value: unknown): asserts value is { success: true; installCommand?: unknown } {
  if (!value || typeof value !== 'object' || !('success' in value) || value.success !== true) throw Error(t('common.operationFailed'))
}

// Retain the gate until the original request settles, including cached navigation.
async function runHostAction(kind: string, failureKey: string, execute: (id: number, current: () => boolean) => Promise<boolean | void>, dialogCurrent = () => true) {
  const id = host.value?.id, session = copySession.value, path = route.fullPath, generation = hostActionGeneration
  const current = () => copyViewAlive && copyViewActive.value && isOnHostDetailRoute() && !!session && session === copySession.value &&
    path === route.fullPath && generation === hostActionGeneration && host.value?.id === id && String(route.params.id) === String(id) && dialogCurrent()
  if (actionLoading.value || !Number.isSafeInteger(id) || (id ?? 0) < 1 || !current()) return
  const operation = { current }; pendingHostAction = operation; actionLoading.value = kind; actionError.value = ''
  hostReadSequence++; pendingHostRead = null; loading.value = false
  let refresh = false
  try { refresh = (await execute(id!, current)) === true }
  catch (err: unknown) {
    if (current()) {
      actionError.value = t(failureKey) + ': ' + (err instanceof Error ? err.message : String(err))
      if (kind === 'verify-reinstall') { reinstallStatus.value = 'error'; reinstallError.value = actionError.value }
      toast.error(actionError.value)
    }
  } finally {
    if (pendingHostAction === operation) { pendingHostAction = null; actionLoading.value = '' }
  }
  if (refresh && current()) void loadHost()
}

// 是否需要验证（证书路径未配置）
const needsVerification = computed(() => !host.value?.certPath)

async function openDeleteModal() {
  await runHostAction('delete', 'admin.hosts.checkFailed', async (id, current) => {
    const res: unknown = await api.instances.list({ hostId: id, pageSize: 1 })
    if (!current()) return
    const instanceCount = res && typeof res === 'object' && 'total' in res ? res.total : undefined
    if (typeof instanceCount !== 'number' || !Number.isSafeInteger(instanceCount) || instanceCount < 0) throw Error(t('admin.hosts.checkFailed'))
    if (instanceCount > 0) {
      throw Error(t('admin.hosts.hasInstances', { count: instanceCount }))
    }
    deleteConfirmName.value = ''
    showDeleteModal.value = true
  })
}

async function confirmDeleteHost() {
  if (actionLoading.value || !host.value || !showDeleteModal.value) return
  if (deleteConfirmName.value !== host.value.name) {
    toast.error(t('admin.hosts.deleteNameMismatch'))
    return
  }

  const dialog = deleteDialogGeneration
  await runHostAction('delete', 'admin.hosts.deleteFailed', async (id, current) => {
    const res: unknown = await api.hosts.delete(id)
    if (!current()) return
    if (!res || typeof res !== 'object' || !('message' in res) || typeof res.message !== 'string' || !res.message.trim()) throw Error(t('admin.hosts.deleteFailed'))
    showDeleteModal.value = false
    toast.success(t('admin.hosts.hostDeleted'))
    void router.push(hostsPath())
  }, () => showDeleteModal.value && dialog === deleteDialogGeneration)
}

const canDelete = computed(() => {
  return deleteConfirmName.value === host.value?.name
})

function onConfigSaved() {
  loadHost()
}

// 打开批量延期弹窗（仅管理员）
async function openExtendModal() {
  if (actionLoading.value || !host.value || !isAdmin.value) return

  paidInstanceCount.value = 0
  extendDays.value = undefined
  showExtendModal.value = true
}

// 确认批量延期
async function confirmExtendAll() {
  if (actionLoading.value) return
  if (!host.value || !extendDays.value || extendDays.value < 1 || extendDays.value > 365) {
    toast.error(t('admin.hosts.extendDaysInvalid'))
    return
  }
  
  actionLoading.value = 'extend'
  showExtendModal.value = false
  try {
    const res = await api.hosts.batchExtendAll(host.value.id, extendDays.value)
    if (res.success) {
      toast.success(t('admin.hosts.extendSuccess', { count: res.extendedCount, days: extendDays.value }))
    } else {
      toast.info(res.message)
    }
  } catch (err: any) {
    toast.error(t('admin.hosts.extendFailed') + ': ' + (err?.message || String(err)))
  } finally {
    actionLoading.value = ''
  }
}

// 重新安装：生成新的安装命令
async function regenerateInstall() {
  if (actionLoading.value) return
  clearReinstallCommand()
  const dialog = reinstallCopyGeneration
  await runHostAction('reinstall', 'admin.hosts.reinstallFailed', async (id, current) => {
    const res: unknown = await api.hosts.regenerateInstall(id)
    if (!current()) return
    requireHostSuccess(res)
    if (typeof res.installCommand !== 'string' || !res.installCommand.trim() || res.installCommand.length > 32768) throw Error(t('admin.hosts.reinstallFailed'))
    reinstallCommand.value = res.installCommand
    reinstallStatus.value = 'waiting'
    reinstallError.value = ''
    showReinstallModal.value = true
  }, () => dialog === reinstallCopyGeneration)
}

// 重新安装后验证
async function verifyAfterReinstall() {
  if (actionLoading.value || !showReinstallModal.value || !reinstallCommand.value || reinstallStatus.value === 'success') return
  const dialog = reinstallCopyGeneration, command = reinstallCommand.value
  await runHostAction('verify-reinstall', 'admin.hosts.verifyFailed', async (id, current) => {
    reinstallStatus.value = 'verifying'; reinstallError.value = ''
    const res: unknown = await api.hosts.verify(id)
    if (!current()) return
    requireHostSuccess(res)
    reinstallStatus.value = 'success'
    toast.success(t('admin.hosts.verifySuccess'))
    return true
  }, () => showReinstallModal.value && dialog === reinstallCopyGeneration && command === reinstallCommand.value)
}

// 复制重新安装命令
async function copyReinstallCommand() {
  const hostId = host.value?.id, command = reinstallCommand.value, session = copySession.value, generation = reinstallCopyGeneration
  const current = () => copyViewAlive && copyViewActive.value && !!session && session === copySession.value &&
    generation === reinstallCopyGeneration && showReinstallModal.value && isOnHostDetailRoute() &&
    String(route.params.id) === String(hostId) && Number.isSafeInteger(hostId) && (hostId ?? 0) > 0 &&
    host.value?.id === hostId && reinstallCommand.value === command
  if (reinstallCopying.value || !current() || !command.trim() || command.length > 32768) return
  reinstallCopying.value = true; reinstallCopyError.value = false
  try {
    await navigator.clipboard.writeText(command)
    if (current()) toast.success(t('common.copied'))
  } catch {
    if (current()) { reinstallCopyError.value = true; toast.error(t('common.copyFailed')) }
  } finally { reinstallCopying.value = false }
}



// 关闭重新安装弹窗
function closeReinstallModal() {
  if (actionLoading.value) return
  clearReinstallCommand()
  loadHost()
}

function closeDeleteModal() { if (!actionLoading.value) showDeleteModal.value = false }

const tabs = [
  { key: 'info', labelKey: 'admin.hosts.tabInfo', icon: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
  { key: 'config', labelKey: 'admin.hosts.tabConfig', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z' },
  { key: 'images', labelKey: 'admin.hosts.tabImages', icon: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z' },
  { key: 'storage', labelKey: 'admin.hosts.tabStorage', icon: 'M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4' },
  { key: 'publicIpv4', labelKey: 'admin.hosts.tabPublicIpv4', icon: 'M12 11c0 1.657-1.79 3-4 3s-4-1.343-4-3 1.79-3 4-3 4 1.343 4 3zm0 0c0-1.657 1.79-3 4-3s4 1.343 4 3-1.79 3-4 3-4-1.343-4-3zm-4 3v4m8-4v4M8 6V3m8 3V3' },
  { key: 'caddy', labelKey: 'host.caddy.title', icon: 'M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9' },
  { key: 'redeemCodes', labelKey: 'redeemCodes.title', icon: 'M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z' },
  { key: 'instances', labelKey: 'admin.hosts.tabInstances', icon: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10' },
  { key: 'ops', labelKey: 'admin.hosts.tabOps', icon: 'M5 13l4 4L19 7M12 6v6l4 2' },
  { key: 'create', labelKey: 'admin.hosts.tabCreate', icon: 'M12 4v16m8-8H4' }
]
</script>

<template>
  <div class="host-detail kawaii-page space-y-6 animate-fade-in">
    <div v-if="hostLoadError" data-host-detail-read-error class="rounded-lg bg-themed-secondary p-4 flex items-center justify-between gap-3 text-sm" role="status">
      <span class="min-w-0 break-words">{{ hostLoadError }}</span>
      <button type="button" data-host-detail-read-retry class="btn-secondary btn-sm shrink-0" @click="retryLoadHost">{{ t('common.retry') }}</button>
    </div>
    <div v-if="loading">
      <SkeletonLoader type="detail" />
    </div>

    <template v-else-if="host">
      <!-- Header -->
      <div class="page-header flex-col sm:flex-row gap-4">
        <div class="flex items-center gap-3 min-w-0">
          <RouterLink
            :to="hostsPath()"
            class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-themed bg-themed-surface text-themed-muted transition-colors hover:bg-themed-hover hover:text-themed"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 19l-7-7 7-7" />
            </svg>
          </RouterLink>
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2.5">
              <FlagIcon v-if="host.countryCode" :code="host.countryCode" size="md" />
              <h1 class="page-title uppercase truncate">{{ host.name }}</h1>
              <span :class="['inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-mono', statusInfo.class]">
                <span :class="['h-1.5 w-1.5 rounded-full', statusInfo.dot]"></span>
                {{ statusInfo.label }}
              </span>
            </div>
            <p class="page-description mt-1 truncate font-mono text-themed-muted">{{ host.location || host.url }}</p>
          </div>
        </div>

        <div class="flex items-center gap-2 flex-wrap">
          <!-- 批量延期按钮（仅管理员可见） -->
          <button
            v-if="isAdmin"
            :disabled="!!actionLoading"
            class="btn-primary btn-sm sm:btn"
            @click="openExtendModal"
          >
            <svg v-if="actionLoading === 'extend'" class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            <span v-else>{{ t('admin.hosts.batchExtend') }}</span>
          </button>
          <!-- 重新安装按钮：已安装和离线节点都允许重新生成安装脚本 -->
          <button
            :disabled="!!actionLoading"
            class="btn-secondary btn-sm sm:btn"
            @click="regenerateInstall"
          >
            <svg v-if="actionLoading === 'reinstall'" class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            <span v-else>{{ t('admin.hosts.reinstall') }}</span>
          </button>
          <!-- 未验证的宿主机显示验证按钮 -->
          <button
            v-if="needsVerification"
            :disabled="!!actionLoading"
            class="btn-primary btn-sm sm:btn"
            @click="verifyHost"
          >
            <svg v-if="actionLoading === 'verify'" class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            <span v-else>{{ t('admin.hosts.verifyAndConnect') }}</span>
          </button>
          <!-- 已验证的宿主机显示测试连接按钮 -->
          <button
            v-else
            :disabled="!!actionLoading"
            class="btn-secondary btn-sm sm:btn"
            @click="testConnection"
          >
            <svg v-if="actionLoading === 'test'" class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            <span v-else>{{ t('admin.hosts.test') }}</span>
          </button>
          <button
            :disabled="!!actionLoading"
            class="btn-danger btn-sm sm:btn"
            @click="openDeleteModal"
          >
            <svg v-if="actionLoading === 'delete'" class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            <span v-else>{{ t('common.delete') }}</span>
          </button>
        </div>
      </div>

      <p v-if="actionError && !showDeleteModal && !showReinstallModal" data-host-detail-action-error class="rounded-lg bg-themed-secondary p-4 text-sm break-words" role="status">{{ actionError }}</p>

      <!-- Tab Navigation -->
      <div class="border-b border-themed">
        <div class="flex gap-1 overflow-x-auto scrollbar-hide scroll-smooth -mb-px">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            :class="[
              'nimbus-tab flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2.5 text-xs sm:text-sm rounded-t-lg whitespace-nowrap shrink-0 border-b-2',
              activeTab === tab.key
                ? 'text-themed font-semibold border-primary-500'
                : 'text-themed-muted font-medium border-transparent hover:text-themed hover:bg-themed-hover'
            ]"
            @click="activeTab = tab.key as TabType"
          >
            <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" :d="tab.icon" />
            </svg>
            <span>{{ t(tab.labelKey) }}</span>
          </button>
        </div>
      </div>

      <!-- Tab Content -->
      <div>
        <HostInfoTab v-if="activeTab === 'info'" :host="host" @refresh="loadHost" />
        <MyHostConfigTab v-if="activeTab === 'config'" :host="host" @saved="onConfigSaved" />
        <HostImagesTab v-if="activeTab === 'images'" :host-id="host.id" :host-name="host.name" />
        <HostStorageTab v-if="activeTab === 'storage'" :host-id="host.id" />
        <HostPublicIpv4Tab v-if="activeTab === 'publicIpv4'" :host-id="host.id" />
        <HostCaddyTab v-if="activeTab === 'caddy'" :host-id="host.id" />
        <HostRedeemCodesTab v-if="activeTab === 'redeemCodes'" :host-id="host.id" />
        <HostInstancesTab v-if="activeTab === 'instances'" :host-id="host.id" :host-name="host.name" />
        <HostOpsTab v-if="activeTab === 'ops'" :host-id="host.id" :host-name="host.name" />
        <HostCreateInstanceTab v-if="activeTab === 'create'" :host-id="host.id" :host-name="host.name" :instance-type="host.instanceType" />
      </div>

      <!-- 批量延期弹窗 -->
      <Teleport to="body">
        <Transition name="modal">
          <div v-if="showExtendModal" class="modal-overlay">
            <div class="modal-backdrop" @click="showExtendModal = false"></div>
            <div class="modal-content max-w-md">
              <div class="modal-header">
                <h3 class="modal-title">{{ t('admin.hosts.batchExtend') }}</h3>
                <button class="text-themed-muted hover:text-themed" @click="showExtendModal = false">
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div class="modal-body space-y-4">
                <div class="flex gap-2.5 rounded-lg border border-themed bg-themed-secondary p-3">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-themed-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p class="text-sm text-themed-secondary">
                    {{ t('admin.hosts.extendHint', { count: paidInstanceCount }) }}
                  </p>
                </div>
                <div>
                  <label class="block text-xs text-themed-muted mb-1.5">{{ t('admin.hosts.extendDaysLabel') }}</label>
                  <input
                    v-model.number="extendDays"
                    type="number"
                    min="1"
                    max="365"
                    class="input"
                    :placeholder="t('admin.hosts.extendDaysPlaceholder')"
                  />
                </div>
              </div>
              <div class="modal-footer">
                <button class="btn-secondary" @click="showExtendModal = false">{{ t('common.cancel') }}</button>
                <button
                  class="btn-primary"
                  :disabled="!extendDays || extendDays < 1 || extendDays > 365"
                  @click="confirmExtendAll"
                >
                  {{ t('admin.hosts.confirmExtendBtn') }}
                </button>
              </div>
            </div>
          </div>
        </Transition>
      </Teleport>

      <!-- 删除确认弹窗 -->
      <Teleport to="body">
        <Transition name="modal">
          <div v-if="showDeleteModal" class="modal-overlay host-delete-overlay">
            <div class="modal-backdrop" @click="closeDeleteModal"></div>
            <div class="modal-content max-w-md host-delete-dialog" :class="{ 'host-delete-dark': themeStore.isDark }" role="dialog" aria-modal="true" :aria-label="t('admin.hosts.deleteHost')">
              <div class="modal-header">
                <h3 class="modal-title text-error">{{ t('admin.hosts.deleteHost') }}</h3>
                <button type="button" class="text-themed-muted hover:text-themed" :disabled="!!actionLoading" :aria-label="t('common.close')" @click="closeDeleteModal">
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div class="modal-body space-y-4">
                <div class="p-3 rounded-lg" :class="themeStore.isDark ? 'bg-rose-500/10' : 'bg-rose-50'">
                  <p class="text-sm text-error">{{ t('admin.hosts.deleteWarning') }}</p>
                </div>
                <p class="text-sm text-themed-secondary">
                  {{ t('admin.hosts.deleteConfirmHint', { name: host.name }) }}
                </p>
                <div>
                  <label class="block text-xs text-themed-muted mb-1.5">{{ t('admin.hosts.enterHostName') }}</label>
                  <input
                    v-model="deleteConfirmName"
                    :disabled="!!actionLoading"
                    :aria-label="t('admin.hosts.enterHostName')"
                    type="text"
                    class="input"
                    :placeholder="host.name"
                    autocomplete="off"
                  />
                </div>
                <p v-if="actionError" data-host-detail-action-error class="text-sm text-themed-secondary break-words" role="status">{{ actionError }}</p>
              </div>
              <div class="modal-footer">
                <button class="btn-secondary" :disabled="!!actionLoading" @click="closeDeleteModal">{{ t('common.cancel') }}</button>
                <button
                  class="btn-danger"
                  :disabled="!canDelete || !!actionLoading"
                  :aria-busy="actionLoading === 'delete'"
                  @click="confirmDeleteHost"
                >
                  {{ t('admin.hosts.confirmDeleteBtn') }}
                </button>
              </div>
            </div>
          </div>
        </Transition>
      </Teleport>

      <!-- 重新安装弹窗 -->
      <Teleport to="body">
        <Transition name="modal">
          <div v-if="showReinstallModal" class="modal-overlay reinstall-overlay">
            <div class="modal-backdrop" @click="closeReinstallModal"></div>
            <div class="modal-content reinstall-dialog" role="dialog" aria-modal="true" :aria-label="t('admin.hosts.reinstallScript')" style="max-width: 72rem; width: 95%;">
              <div class="modal-header">
                <h3 class="modal-title">{{ t('admin.hosts.reinstallScript') }}</h3>
                <button type="button" class="text-themed-muted hover:text-themed" :disabled="!!actionLoading" :aria-label="t('common.close')" @click="closeReinstallModal">
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div class="modal-body space-y-4">
                <!-- 步骤 1: 执行安装命令 -->
                <div class="space-y-2">
                  <div class="flex items-center gap-2">
                    <span class="flex items-center justify-center w-6 h-6 rounded-full text-xs font-medium" :class="reinstallStatus === 'success' ? 'bg-green-500 text-white' : 'bg-accent text-white dark:text-black'">1</span>
                    <span class="text-sm font-medium text-themed">{{ t('admin.hosts.step1RunScript') }}</span>
                  </div>
                  <p class="text-xs text-themed-muted ml-8">{{ t('admin.hosts.runOnHost') }}</p>
                  <div class="ml-8 overflow-x-auto rounded-lg border border-gray-800 bg-gray-950 p-4">
                    <code class="text-green-400 text-sm break-all whitespace-pre-wrap font-mono">{{ reinstallCommand }}</code>
                  </div>
                  <div class="ml-8 mb-4">
                    <button type="button" data-host-reinstall-copy class="btn-secondary btn-sm min-h-11 sm:min-h-0" :disabled="reinstallCopying || !reinstallCommand" :aria-busy="reinstallCopying" @click="copyReinstallCommand">{{ t('admin.hosts.copyCommand') }}</button>
                    <p v-if="reinstallCopyError" data-host-reinstall-copy-error class="text-sm text-themed-secondary break-words mt-2" role="status">{{ t('common.copyFailed') }}</p>
                  </div>
                </div>

                <!-- 步骤 2: 验证并连接 -->
                <div class="space-y-2 pt-4 border-t border-themed">
                  <div class="flex items-center gap-2">
                    <span class="flex items-center justify-center w-6 h-6 rounded-full text-xs font-medium" :class="reinstallStatus === 'success' ? 'bg-green-500 text-white' : 'bg-gray-500 text-white'">2</span>
                    <span class="text-sm font-medium text-themed">{{ t('admin.hosts.step2Verify') }}</span>
                  </div>
                  <p class="text-xs text-themed-muted ml-8">{{ t('admin.hosts.verifyHint') }}</p>
                
                  <!-- 状态显示 -->
                  <div class="ml-8 flex items-center gap-3">
                    <button 
                      class="btn-secondary btn-sm" 
                      :disabled="!!actionLoading || reinstallStatus === 'success'"
                      :aria-busy="reinstallStatus === 'verifying'"
                      data-host-detail-reinstall-verify
                      @click="verifyAfterReinstall"
                    >
                      <svg v-if="reinstallStatus === 'verifying'" class="w-4 h-4 animate-spin mr-1" fill="none" viewBox="0 0 24 24">
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                      </svg>
                      {{ reinstallStatus === 'verifying' ? t('admin.hosts.verifying') : t('admin.hosts.verifyAndConnect') }}
                    </button>
                  
                    <!-- 成功状态 -->
                    <div v-if="reinstallStatus === 'success'" class="flex items-center gap-2 text-green-500">
                      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                      </svg>
                      <span class="text-sm">{{ t('admin.hosts.verifySuccess') }}</span>
                    </div>
                  </div>
                
                  <!-- 错误提示 -->
                  <div v-if="actionError" data-host-detail-action-error class="ml-8 p-3 rounded-lg bg-themed-secondary text-themed-secondary text-sm break-words" role="status">
                    {{ actionError }}
                  </div>
                </div>
              </div>
              <div class="modal-footer">
                <button class="btn-secondary" :disabled="!!actionLoading" @click="closeReinstallModal">{{ t('common.close') }}</button>
                <button v-if="reinstallStatus === 'success'" class="btn-primary" @click="closeReinstallModal">{{ t('common.done') }}</button>
              </div>
            </div>
          </div>
        </Transition>
      </Teleport>
    </template>

    <!-- 兜底态：既不在 loading、host 又为空时必须给出明确状态。
         此前这里没有 v-else，两个分支都不成立就什么都不渲染 —— 表现为整页白屏，
         用户完全无从判断发生了什么，只能靠刷新。 -->
    <div v-else class="host-read-empty rounded-lg bg-themed-secondary p-6 space-y-4">
      <h1 class="text-xl font-semibold">{{ t('admin.hosts.tabInfo') }}</h1>
      <p v-if="!hostLoadError" class="text-themed-muted">{{ t('admin.hosts.loadFailed') }}</p>
      <div class="flex gap-2">
        <button v-if="!hostLoadError" type="button" class="btn-secondary btn-sm" @click="retryLoadHost">
          {{ t('common.retry') }}
        </button>
        <button type="button" class="btn-secondary btn-sm" @click="router.replace(hostsPath())">
          {{ t('common.back') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.host-detail { animation: none !important; }
.host-detail .page-header .btn-primary { background: var(--kawaii-text) !important; color: var(--kawaii-surface) !important; }
.host-detail .nimbus-tab.border-primary-500 { border-color: currentColor; }
.reinstall-dialog {
  background: var(--kawaii-surface) !important;
  box-shadow: none !important;
  backdrop-filter: none;
}
.reinstall-overlay .modal-backdrop { backdrop-filter: none; }
.reinstall-dialog button,
.host-delete-dialog button,
.host-detail button { box-shadow: none !important; }
.host-delete-dialog { box-shadow: none !important; background: var(--kawaii-surface) !important; }
.host-delete-dialog button::before { display: none; }
.host-delete-dialog .text-themed-muted { color: var(--kawaii-text) !important; }
.host-delete-dialog .text-error,
.host-delete-dialog .btn-danger { color: #b91c1c !important; }
.host-delete-dialog.host-delete-dark .text-error,
.host-delete-dialog.host-delete-dark .btn-danger { color: #fca5a5 !important; }
.host-delete-overlay .modal-backdrop { backdrop-filter: none; }
.reinstall-dialog button { transition-property: color, background-color, border-color, opacity; }
.reinstall-dialog .bg-accent { background: var(--kawaii-text) !important; color: var(--kawaii-surface) !important; }
.reinstall-dialog button::before,
.host-detail button::before { display: none; }
.reinstall-dialog .text-themed-muted,
.host-detail .text-themed-muted { color: var(--kawaii-text) !important; }
@media (max-width: 639px) {
  [data-host-detail-read-retry] { min-height: 44px !important; }
  .host-detail .page-header button, .host-delete-dialog button, .host-delete-dialog input { min-height: 44px !important; }
  .host-detail .page-header button, .host-detail .nimbus-tab, .host-detail .page-header p, .host-detail .page-header span { font-size: 13px; }
  .reinstall-dialog button { min-height: 44px !important; font-size: 13px; }
  .reinstall-dialog p { font-size: 13px; }
}
/* Neutral tabs keep their existing selection and keyboard behavior. */
.nimbus-tab {
  transition: color 0.15s ease, background-color 0.15s ease, border-color 0.15s ease;
}

@media (prefers-reduced-motion: reduce) {
  .host-detail { animation: none !important; }
  .reinstall-dialog { animation: none !important; transition: none !important; transform: none !important; }
  .nimbus-tab {
    transition: none;
  }
}
</style>
