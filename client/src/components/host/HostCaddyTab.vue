<script setup lang="ts">
import { ref, nextTick, onMounted, onActivated, onDeactivated, onBeforeUnmount, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useThemeStore } from '@/stores/theme'
import { useToast } from '@/stores/toast'
import { useAuthStore } from '@/stores/auth'
import api from '@/api'

const { t } = useI18n()
const themeStore = useThemeStore()
const toast = useToast()
const authStore = useAuthStore()

interface Props {
  hostId: number
}

const props = defineProps<Props>()

const loading = ref(true)
const generating = ref(false)
const resetting = ref(false)
const confirming = ref(false)
const testing = ref(false)
const copied = ref(false), copying = ref(false), copyError = ref(false), actionError = ref('')
const actionBusy = computed(() => generating.value || resetting.value || confirming.value || testing.value)
let currentOperation: (() => boolean) | null = null
let commandGeneration = 0, copiedTimer: ReturnType<typeof setTimeout> | undefined
function clearCopiedTimer() { if (copiedTimer) clearTimeout(copiedTimer); copiedTimer = undefined }

// Caddy 状态
const caddyStatus = ref<{
  enabled: boolean
  username: string | null
  port: number
  hasPassword: boolean
  natPublicIp: string | null
  sitesCount: number
}>({
  enabled: false,
  username: null,
  port: 8444,
  hasPassword: false,
  natPublicIp: null,
  sitesCount: 0
})

// 生成的安装信息
const installInfo = ref({
  command: '',
  username: '',
  password: '',
  port: 8444
})

// 测试结果
const testResult = ref<{
  connected: boolean
  sitesCount: number
  dnsRecordType: 'A' | 'AAAA' | 'CNAME'
  dnsRecordValue: string
}>({
  connected: false,
  sitesCount: 0,
  dnsRecordType: 'A',
  dnsRecordValue: ''
})

const showInstallModal = ref(false)
const installDialog = ref<HTMLElement>()
let previousFocus: HTMLElement | null = null

// 站点列表相关
interface ProxySite {
  id: number
  domain: string
  targetPort: number
  httpsEnabled: boolean
  status: 'pending' | 'active' | 'error'
  enabled: boolean
  error: string | null
  createdAt: string
  instance: {
    id: number
    name: string
    ipv4: string | null
    status: string
  } | null
}

const sites = ref<ProxySite[]>([])
const sitesLoading = ref(false)
const sitesPage = ref(1)
const sitesPageSize = 5
const sitesTotal = ref(0)
const sitesTotalPages = ref(1)
const statusReady = ref(false), statusError = ref(''), sitesReady = ref(false), sitesError = ref(''), active = ref(false)
let alive = true, generation = 0, statusSequence = 0, sitesSequence = 0
const session = computed(() => {
  if (!authStore.user || !authStore.token || !Number.isSafeInteger(authStore.user.id) || authStore.user.id < 1) return ''
  let identity = authStore.token
  try {
    const payload = JSON.parse(atob(identity.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    if (typeof payload.sid === 'string' && payload.sid) identity = payload.sid
  } catch { /* Legacy tokens keep their complete identity. */ }
  return `${authStore.user.id}:${authStore.user.role}:${identity}`
})
const available = computed(() => alive && active.value && !!session.value && Number.isSafeInteger(props.hostId) && props.hostId > 0)
const actionsDisabled = computed(() => !available.value || loading.value || !statusReady.value || !!statusError.value || actionBusy.value || copying.value)
function context() {
  const hostId = props.hostId, identity = session.value, version = generation
  return { hostId, current: () => available.value && hostId === props.hostId && identity === session.value && version === generation }
}
function invalidateReads() {
  generation++; statusSequence++; sitesSequence++
  sitesPage.value = 1
  sites.value = []
  sitesTotal.value = 0
  sitesTotalPages.value = 1
  statusReady.value = false; sitesReady.value = false; statusError.value = ''; sitesError.value = ''
  loading.value = false; sitesLoading.value = false
  caddyStatus.value = { enabled: false, username: null, port: 8444, hasPassword: false, natPublicIp: null, sitesCount: 0 }
  showInstallModal.value = false
  clearCopiedTimer(); commandGeneration++; copyError.value = false; actionError.value = ''
  installInfo.value = { command: '', username: '', password: '', port: 8444 }; copied.value = false
  testResult.value = { connected: false, sitesCount: 0, dnsRecordType: 'A', dnsRecordValue: '' }
}
watch([() => props.hostId, session], () => { invalidateReads(); if (available.value) void loadCaddyStatus() }, { flush: 'sync' })
watch(sitesPage, () => {
  sitesSequence++; sitesLoading.value = false
  sites.value = []; sitesReady.value = false; sitesError.value = ''
}, { flush: 'sync' })
function activate() {
  if (!alive || active.value) return
  active.value = true
  if (available.value) void loadCaddyStatus()
}
onMounted(activate)
onActivated(activate)
onDeactivated(() => { active.value = false; invalidateReads() })
onBeforeUnmount(() => { alive = false; active.value = false; invalidateReads() })

function validStatus(value: unknown): value is typeof caddyStatus.value {
  if (!value || typeof value !== 'object') return false
  const row = value as typeof caddyStatus.value
  return typeof row.enabled === 'boolean' && typeof row.hasPassword === 'boolean' &&
    (row.username === null || typeof row.username === 'string') && (row.natPublicIp === null || typeof row.natPublicIp === 'string') &&
    Number.isSafeInteger(row.port) && row.port > 0 && row.port <= 65535 && Number.isSafeInteger(row.sitesCount) && row.sitesCount >= 0
}
function validSites(value: unknown, page: number): value is Awaited<ReturnType<typeof api.hosts.getCaddySites>> {
  if (!value || typeof value !== 'object') return false
  const row = value as Awaited<ReturnType<typeof api.hosts.getCaddySites>>
  return row.page === page && row.pageSize === sitesPageSize && Number.isSafeInteger(row.total) && row.total >= 0 &&
    row.totalPages === Math.ceil(row.total / sitesPageSize) && Array.isArray(row.sites) && row.sites.length <= sitesPageSize &&
    row.sites.every(site => site && Number.isSafeInteger(site.id) && site.id > 0 && typeof site.domain === 'string' &&
      Number.isSafeInteger(site.targetPort) && site.targetPort > 0 && site.targetPort <= 65535 && typeof site.httpsEnabled === 'boolean' &&
      ['pending', 'active', 'error'].includes(site.status) && typeof site.enabled === 'boolean' && (site.error === null || typeof site.error === 'string') &&
      typeof site.createdAt === 'string' && Number.isFinite(Date.parse(site.createdAt)) && (site.instance === null || site.instance &&
        Number.isSafeInteger(site.instance.id) && site.instance.id > 0 && typeof site.instance.name === 'string' &&
        (site.instance.ipv4 === null || typeof site.instance.ipv4 === 'string') && typeof site.instance.status === 'string')) &&
    new Set(row.sites.map(site => site.id)).size === row.sites.length &&
    row.sites.length === Math.max(0, Math.min(sitesPageSize, row.total - (page - 1) * sitesPageSize))
}

async function loadCaddyStatus() {
  if (!available.value || currentOperation?.()) return
  const target = context(), sequence = ++statusSequence
  const owns = () => target.current() && sequence === statusSequence
  loading.value = true
  sitesSequence++; sitesLoading.value = false
  statusError.value = ''
  try {
    const res = await api.hosts.getCaddy(target.hostId)
    if (!owns()) return
    if (!validStatus(res)) throw Error(t('host.caddy.loadFailed'))
    caddyStatus.value = { ...res }; statusReady.value = true
    if (res.enabled) void loadSites()
    else {
      sitesSequence++; sites.value = []; sitesTotal.value = 0; sitesTotalPages.value = 1; sitesPage.value = 1
      sitesError.value = ''; sitesReady.value = false; sitesLoading.value = false
    }
  } catch (err: unknown) {
    const error = err as { message?: string }
    if (owns()) statusError.value = t('host.caddy.loadFailed') + ': ' + (error?.message || String(err))
  } finally {
    if (owns()) loading.value = false
  }
}

async function loadSites() {
  if (!available.value || currentOperation?.() || !statusReady.value || !caddyStatus.value.enabled || statusError.value ||
    !Number.isSafeInteger(sitesPage.value) || sitesPage.value < 1) return
  const target = context(), page = sitesPage.value, sequence = ++sitesSequence
  const owns = () => target.current() && page === sitesPage.value && sequence === sitesSequence && caddyStatus.value.enabled
  sitesLoading.value = true
  sitesError.value = ''
  try {
    const res = await api.hosts.getCaddySites(target.hostId, {
      page,
      pageSize: sitesPageSize
    })
    if (!owns()) return
    if (!validSites(res, page)) throw Error(t('host.caddy.loadSitesFailed'))
    const totalPages = Math.max(1, res.totalPages)
    if (page > totalPages) { sitesPage.value = totalPages; void loadSites(); return }
    sites.value = res.sites.map(site => ({ ...site, instance: site.instance ? { ...site.instance } : null }))
    sitesTotal.value = res.total
    sitesTotalPages.value = totalPages; sitesReady.value = true
  } catch (err: unknown) {
    const error = err as { message?: string }
    if (owns()) sitesError.value = t('host.caddy.loadSitesFailed') + ': ' + (error?.message || String(err))
  } finally {
    if (owns()) sitesLoading.value = false
  }
}

function goToPrevSitesPage(): void {
  if (!actionsDisabled.value && !sitesLoading.value && sitesPage.value > 1) {
    sitesPage.value--
    loadSites()
  }
}

function goToNextSitesPage(): void {
  if (!actionsDisabled.value && !sitesLoading.value && sitesPage.value < sitesTotalPages.value) {
    sitesPage.value++
    loadSites()
  }
}

function getSiteStatusBadge(site: ProxySite) {
  if (!site.enabled) {
    return { label: t('host.caddy.siteDisabled'), class: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' }
  }
  switch (site.status) {
    case 'active':
      return { label: t('host.caddy.siteActive'), class: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' }
    case 'pending':
      return { label: t('host.caddy.sitePending'), class: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400' }
    case 'error':
      return { label: t('host.caddy.siteError'), class: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' }
    default:
      return { label: site.status, class: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' }
  }
}

function clearInstallInfo() {
  installInfo.value = { command: '', username: '', password: '', port: 8444 }
  copied.value = false; copyError.value = false; clearCopiedTimer()
}
watch(() => [installInfo.value.command, installInfo.value.username, installInfo.value.password, installInfo.value.port], () => {
  commandGeneration++; copied.value = false; copyError.value = false; clearCopiedTimer()
}, { flush: 'sync' })
watch(showInstallModal, shown => {
  commandGeneration++
  if (!shown) {
    clearInstallInfo()
    if (available.value && previousFocus?.isConnected) previousFocus.focus()
    previousFocus = null
  } else previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
}, { flush: 'sync' })
watch(showInstallModal, shown => {
  if (!shown) return
  const target = context(), revision = commandGeneration
  void nextTick(() => {
    if (target.current() && showInstallModal.value && revision === commandGeneration) installDialog.value?.focus()
  })
}, { flush: 'post' })
function closeInstallModal() { if (!actionBusy.value) showInstallModal.value = false }
function trapInstallFocus(event: KeyboardEvent) {
  if (!available.value || !showInstallModal.value || !installDialog.value) return
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeInstallModal(); return }
  if (event.key !== 'Tab') return
  const buttons = [...installDialog.value.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
  const first = buttons[0], last = buttons.at(-1)
  if (!first) { event.preventDefault(); installDialog.value.focus(); return }
  if (!installDialog.value.contains(document.activeElement) || document.activeElement === installDialog.value ||
    event.shiftKey && document.activeElement === first || !event.shiftKey && document.activeElement === last) {
    event.preventDefault(); event.stopPropagation(); (event.shiftKey ? last : first)?.focus()
  }
}
onMounted(() => document.addEventListener('keydown', trapInstallFocus, true))
onBeforeUnmount(() => document.removeEventListener('keydown', trapInstallFocus, true))
function validCredentials(value: unknown): value is Awaited<ReturnType<typeof api.hosts.resetCaddyCredentials>> {
  if (!value || typeof value !== 'object') return false
  const row = value as Awaited<ReturnType<typeof api.hosts.resetCaddyCredentials>>
  return typeof row.installCommand === 'string' && !!row.installCommand.trim() && row.installCommand.length <= 32768 &&
    typeof row.username === 'string' && !!row.username.trim() && row.username.length <= 256 &&
    typeof row.password === 'string' && !!row.password.trim() && row.password.length <= 1024 &&
    Number.isSafeInteger(row.port) && row.port > 0 && row.port <= 65535
}
function validTest(value: unknown): value is typeof testResult.value {
  if (!value || typeof value !== 'object') return false
  const row = value as typeof testResult.value
  return typeof row.connected === 'boolean' && Number.isSafeInteger(row.sitesCount) && row.sitesCount >= 0 &&
    ['A', 'AAAA', 'CNAME'].includes(row.dnsRecordType) && typeof row.dnsRecordValue === 'string' &&
    !!row.dnsRecordValue.trim() && row.dnsRecordValue.length <= 2048
}
async function runCaddyAction(kind: 'generate' | 'reset' | 'confirm' | 'test', failureKey: string, operation: (id: number) => Promise<unknown>) {
  if (actionsDisabled.value) return
  if (kind === 'confirm' && (!showInstallModal.value || !installInfo.value.command || !installInfo.value.username || !installInfo.value.password)) return
  if (kind === 'test' && !caddyStatus.value.enabled) return
  const target = context()
  if (kind === 'generate' || kind === 'reset') { showInstallModal.value = false; clearInstallInfo() }
  const revision = commandGeneration
  const owns = () => target.current() && revision === commandGeneration
  const flag = { generate: generating, reset: resetting, confirm: confirming, test: testing }[kind]
  currentOperation = target.current; flag.value = true; actionError.value = ''
  statusSequence++; sitesSequence++; loading.value = false; sitesLoading.value = false
  if (kind === 'test') testResult.value = { connected: false, sitesCount: 0, dnsRecordType: 'A', dnsRecordValue: '' }
  let refresh = false
  try {
    const res = await operation(target.hostId)
    if (!owns()) return
    if (kind === 'generate' || kind === 'reset') {
      if (!validCredentials(res) || kind === 'generate' && typeof (res as { isNewCredentials?: unknown }).isNewCredentials !== 'boolean') throw Error(t(failureKey))
      installInfo.value = { command: res.installCommand, username: res.username, password: res.password, port: res.port }
      showInstallModal.value = true
      if (kind === 'reset') toast.success(t('host.caddy.resetSuccess'))
      refresh = true
    } else if (kind === 'confirm') {
      if (!res || typeof res !== 'object' || typeof (res as { message?: unknown }).message !== 'string' ||
        !(res as { message: string }).message.trim()) throw Error(t(failureKey))
      toast.success(t('host.caddy.confirmSuccess')); showInstallModal.value = false; refresh = true
    } else {
      if (!validTest(res)) throw Error(t(failureKey))
      testResult.value = { ...res }
      if (res.connected) toast.success(t('host.caddy.testSuccess'))
      else { actionError.value = t('host.caddy.testFailed'); toast.error(actionError.value) }
    }
  } catch (err: unknown) {
    if (owns()) {
      const error = err as { response?: { data?: { error?: string } }; message?: string }
      actionError.value = t(failureKey) + ': ' + (error?.response?.data?.error || error?.message || String(err))
      toast.error(actionError.value)
    }
  } finally {
    currentOperation = null; flag.value = false
    if (refresh && target.current()) void loadCaddyStatus()
  }
}
function generateInstallCommand() {
  return runCaddyAction('generate', 'host.caddy.generateFailed', api.hosts.generateCaddyCommand)
}
function resetCredentials() {
  if (actionsDisabled.value) return
  const target = context(), revision = commandGeneration
  if (!window.confirm(t('host.caddy.resetConfirm')) || !target.current() || revision !== commandGeneration || actionsDisabled.value) return
  return runCaddyAction('reset', 'host.caddy.resetFailed', api.hosts.resetCaddyCredentials)
}
function confirmInstallation() {
  return runCaddyAction('confirm', 'host.caddy.confirmFailed', api.hosts.confirmCaddyInstalled)
}
function testConnection() {
  return runCaddyAction('test', 'host.caddy.testFailed', api.hosts.testCaddyConnection)
}
async function copyCommand() {
  if (!available.value || !showInstallModal.value || !installInfo.value.command || copying.value || actionBusy.value) return
  const target = context(), command = installInfo.value.command, revision = commandGeneration
  const owns = () => target.current() && showInstallModal.value && command === installInfo.value.command && revision === commandGeneration
  copying.value = true; copied.value = false; copyError.value = false; clearCopiedTimer()
  try {
    await navigator.clipboard.writeText(command)
    if (!owns()) return
    copied.value = true; toast.success(t('common.copied'))
    copiedTimer = setTimeout(() => { if (owns()) copied.value = false; copiedTimer = undefined }, 2000)
  } catch {
    if (owns()) { copyError.value = true; toast.error(t('common.copyFailed')) }
  } finally { copying.value = false }
}

const isEnabled = computed(() => caddyStatus.value.enabled)
</script>

<template>
  <div class="host-caddy space-y-6" :aria-busy="actionBusy">
    <p v-if="actionError && !showInstallModal" data-caddy-action-error class="text-sm text-themed break-words" role="alert">{{ actionError }}</p>
    <div v-if="statusError" data-caddy-status-error class="card p-5 space-y-3" role="alert">
      <p class="text-sm text-themed break-words">{{ statusError }}</p>
      <button class="btn-secondary" :disabled="loading || !available" @click="loadCaddyStatus">{{ t('common.retry') }}</button>
    </div>
    <!-- 加载状态 -->
    <div v-if="loading && !statusReady" class="flex justify-center py-12" role="status" :aria-label="t('common.loading')">
      <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
    </div>

    <!-- Caddy 状态卡片 -->
    <div v-else-if="statusReady" class="card p-6">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-lg font-medium" :class="themeStore.isDark ? 'text-white' : 'text-gray-900'">
          {{ t('host.caddy.title') }}
        </h3>
        <span 
          class="px-3 py-1 text-sm rounded-full"
          :class="isEnabled 
            ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' 
            : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'"
        >
          {{ isEnabled ? t('host.caddy.enabled') : t('host.caddy.disabled') }}
        </span>
      </div>

      <p class="text-sm mb-6" :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'">
        {{ t('host.caddy.description') }}
      </p>

      <!-- 未启用状态 -->
      <div v-if="!isEnabled" class="space-y-4">
        <div 
          class="border-2 border-dashed rounded-lg p-6 text-center"
          :class="themeStore.isDark ? 'border-gray-700' : 'border-gray-300'"
        >
          <svg class="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
          </svg>
          <p class="text-sm mb-4" :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-500'">
            {{ t('host.caddy.notInstalled') }}
          </p>
          <button
            :disabled="actionsDisabled || generating"
            class="btn-primary"
            @click="generateInstallCommand"
          >
            <span v-if="generating" class="flex items-center gap-2">
              <svg class="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              {{ t('common.loading') }}
            </span>
            <span v-else>{{ t('host.caddy.generateCommand') }}</span>
          </button>
        </div>
      </div>

      <!-- 已启用状态 -->
      <div v-else class="space-y-4">
        <dl class="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt class="text-gray-500">{{ t('host.caddy.apiPort') }}</dt>
            <dd class="font-mono" :class="themeStore.isDark ? 'text-white' : 'text-gray-900'">
              {{ caddyStatus.port }}
            </dd>
          </div>
          <div>
            <dt class="text-gray-500">{{ t('host.caddy.username') }}</dt>
            <dd class="font-mono" :class="themeStore.isDark ? 'text-white' : 'text-gray-900'">
              {{ caddyStatus.username || '-' }}
            </dd>
          </div>
          <div>
            <dt class="text-gray-500">{{ t('host.caddy.publicIp') }}</dt>
            <dd class="font-mono" :class="themeStore.isDark ? 'text-white' : 'text-gray-900'">
              {{ caddyStatus.natPublicIp || '-' }}
            </dd>
          </div>
          <div>
            <dt class="text-gray-500">{{ t('host.caddy.sitesCount') }}</dt>
            <dd class="font-mono" :class="themeStore.isDark ? 'text-white' : 'text-gray-900'">
              {{ caddyStatus.sitesCount || 0 }}
            </dd>
          </div>
        </dl>

        <div class="flex gap-3 pt-2">
          <button
            :disabled="actionsDisabled || testing"
            class="btn-ghost"
            @click="testConnection"
          >
            <span v-if="testing" class="flex items-center gap-2">
              <svg class="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              {{ t('common.loading') }}
            </span>
            <span v-else>{{ t('host.caddy.testConnection') }}</span>
          </button>
          <button
            :disabled="actionsDisabled || generating"
            class="btn-ghost"
            @click="generateInstallCommand"
          >
            {{ t('host.caddy.viewCommand') }}
          </button>
          <button
            :disabled="actionsDisabled || resetting"
            class="btn-ghost text-amber-600 hover:text-amber-700"
            @click="resetCredentials"
          >
            <span v-if="resetting" class="flex items-center gap-2">
              <svg class="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              {{ t('common.loading') }}
            </span>
            <span v-else>{{ t('host.caddy.resetCredentials') }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- 反代站点列表 -->
    <div v-if="statusReady && isEnabled" class="card p-6">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-lg font-medium" :class="themeStore.isDark ? 'text-white' : 'text-gray-900'">
          {{ t('host.caddy.sitesList') }}
        </h3>
        <span v-if="sitesReady" class="text-sm text-gray-500">{{ t('host.caddy.sitesTotalCount', { count: sitesTotal }) }}</span>
      </div>
      <div v-if="sitesError" data-caddy-sites-error class="space-y-3" role="alert">
        <p class="text-sm text-themed break-words">{{ sitesError }}</p>
        <button class="btn-secondary" :disabled="sitesLoading || actionsDisabled" @click="loadSites">{{ t('common.retry') }}</button>
      </div>

      <!-- 加载状态 -->
      <div v-if="sitesLoading && !sitesReady" class="flex justify-center py-8" role="status" :aria-label="t('common.loading')">
        <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
      </div>

      <!-- 空状态 -->
      <div v-else-if="sitesReady && !sitesError && sites.length === 0" data-caddy-sites-empty class="text-center py-8">
        <svg class="w-12 h-12 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
        </svg>
        <p class="text-sm" :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-500'">
          {{ t('host.caddy.noSites') }}
        </p>
      </div>

      <!-- 站点列表 -->
      <div v-else-if="sitesReady" class="space-y-3">
        <div 
          v-for="site in sites" 
          :key="site.id"
          class="flex items-center justify-between gap-4 p-3 rounded-lg border"
          :class="themeStore.isDark ? 'border-gray-800 bg-gray-900/50' : 'border-gray-200 bg-gray-50'"
        >
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="font-mono text-sm truncate" :class="themeStore.isDark ? 'text-white' : 'text-gray-900'">
                {{ site.domain }}
              </span>
              <span 
                class="px-2 py-0.5 text-xs rounded-full flex-shrink-0"
                :class="getSiteStatusBadge(site).class"
              >
                {{ getSiteStatusBadge(site).label }}
              </span>
              <span 
                v-if="site.httpsEnabled" 
                class="px-2 py-0.5 text-xs rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 flex-shrink-0"
              >
                HTTPS
              </span>
            </div>
            <div class="flex items-center gap-3 mt-1 text-xs" :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-500'">
              <span v-if="site.instance">
                <span class="text-gray-400">{{ t('host.caddy.instance') }}:</span>
                {{ site.instance.name }}
              </span>
              <span>
                <span class="text-gray-400">{{ t('host.caddy.targetPort') }}:</span>
                {{ site.targetPort }}
              </span>
            </div>
          </div>
        </div>

        <!-- 分页控件 -->
        <div v-if="sitesTotalPages > 1" class="flex items-center justify-between mt-4 pt-3 border-t" :class="themeStore.isDark ? 'border-gray-800' : 'border-gray-200'">
          <span class="text-xs text-gray-500">
            {{ t('host.caddy.pageInfo', { current: sitesPage, total: sitesTotalPages, count: sitesTotal }) }}
          </span>
          <div class="flex items-center gap-2">
            <button 
              class="btn-ghost btn-sm" 
              :disabled="actionsDisabled || sitesLoading || sitesPage <= 1"
              @click="goToPrevSitesPage"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
              </svg>
              {{ t('host.caddy.prevPage') }}
            </button>
            <button 
              class="btn-ghost btn-sm" 
              :disabled="actionsDisabled || sitesLoading || sitesPage >= sitesTotalPages"
              @click="goToNextSitesPage"
            >
              {{ t('host.caddy.nextPage') }}
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 安装命令模态框 -->
    <Teleport to="body">
      <div 
        v-if="showInstallModal" 
        class="caddy-install-overlay modal-overlay"
        @click.self="closeInstallModal"
        @keydown.esc.stop.prevent="closeInstallModal"
      >
        <div 
          class="caddy-install-modal modal-content w-full max-w-2xl"
          ref="installDialog" tabindex="-1"
          role="dialog" aria-modal="true" aria-labelledby="caddy-install-title" :aria-busy="actionBusy"
        >
          <div class="p-6">
            <h3 id="caddy-install-title" class="text-lg font-medium mb-4" :class="themeStore.isDark ? 'text-white' : 'text-gray-900'">
              {{ t('host.caddy.installCommand') }}
            </h3>

            <!-- 凭据信息 -->
            <div class="mb-4 p-4 rounded-lg" :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-100'">
              <dl class="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt class="text-gray-500">{{ t('host.caddy.username') }}</dt>
                  <dd class="font-mono font-medium" :class="themeStore.isDark ? 'text-white' : 'text-gray-900'">
                    {{ installInfo.username }}
                  </dd>
                </div>
                <div>
                  <dt class="text-gray-500">{{ t('host.caddy.password') }}</dt>
                  <dd class="font-mono font-medium" :class="themeStore.isDark ? 'text-white' : 'text-gray-900'">
                    {{ installInfo.password }}
                  </dd>
                </div>
                <div>
                  <dt class="text-gray-500">{{ t('host.caddy.apiPort') }}</dt>
                  <dd class="font-mono font-medium" :class="themeStore.isDark ? 'text-white' : 'text-gray-900'">
                    {{ installInfo.port }}
                  </dd>
                </div>
              </dl>
            </div>

            <!-- 安装命令 -->
            <div class="mb-4">
              <label class="block text-sm font-medium mb-2" :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">
                {{ t('host.caddy.commandLabel') }}
              </label>
              <div class="relative">
                <pre 
                  class="p-4 pr-16 rounded-lg text-sm overflow-x-auto font-mono"
                  :class="themeStore.isDark ? 'bg-gray-800 text-green-400' : 'bg-gray-900 text-green-400'"
                >{{ installInfo.command }}</pre>
                <button
                  class="caddy-copy absolute top-2 right-2 p-2 rounded hover:bg-gray-700 transition-colors"
                  :disabled="copying || actionBusy || !available || !installInfo.command"
                  :aria-label="t('common.copy')"
                  :title="t('common.copy')"
                  @click="copyCommand"
                >
                  <svg v-if="!copied" class="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  <svg v-else class="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                  </svg>
                </button>
              </div>
            </div>

            <p v-if="copyError" data-caddy-copy-error class="text-sm text-themed-secondary mb-3" role="status">{{ t('common.copyFailed') }}</p>
            <p v-if="actionError" data-caddy-action-error class="text-sm text-themed break-words mb-3" role="alert">{{ actionError }}</p>

            <!-- 提示 -->
            <div 
              class="caddy-install-hint p-4 rounded-lg mb-6 text-sm"
              :class="themeStore.isDark ? 'bg-blue-900/30 text-blue-300' : 'bg-blue-50 text-blue-700'"
            >
              <p class="font-medium mb-1">{{ t('host.caddy.installHint') }}</p>
              <ol class="list-decimal list-inside space-y-1 text-sm opacity-90">
                <li>{{ t('host.caddy.step1') }}</li>
                <li>{{ t('host.caddy.step2') }}</li>
                <li>{{ t('host.caddy.step3') }}</li>
              </ol>
            </div>

            <!-- 操作按钮 -->
            <div class="flex justify-end gap-3">
              <button
                class="btn-ghost"
                :disabled="actionBusy"
                @click="closeInstallModal"
              >
                {{ t('common.close') }}
              </button>
              <button
                :disabled="actionsDisabled || !installInfo.command"
                class="btn-primary"
                @click="confirmInstallation"
              >
                <span v-if="confirming" class="flex items-center gap-2">
                  <svg class="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  {{ t('common.loading') }}
                </span>
                <span v-else>{{ t('host.caddy.confirmInstalled') }}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.host-caddy .card, .host-caddy button, .caddy-install-modal, .caddy-install-modal button {
  box-shadow: none !important;
  background-image: none !important;
}
.host-caddy button:focus-visible, .caddy-install-modal button:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }
.caddy-install-modal .caddy-copy { min-width: 44px; min-height: 44px; }
.caddy-install-modal button { transform: none !important; }
.caddy-install-overlay { background: rgb(0 0 0 / 45%); }
.caddy-install-modal {
  background: var(--bg-primary) !important;
  background-image: none !important;
  backdrop-filter: none;
  border-radius: 8px !important;
  border: 1px solid var(--border-color) !important;
}
.caddy-install-modal .caddy-install-hint {
  background: var(--bg-secondary) !important;
  color: var(--text-primary) !important;
}
.caddy-install-modal pre { background: var(--bg-secondary) !important; color: var(--text-primary) !important; }
.caddy-install-modal dd { overflow-wrap: anywhere; }
.caddy-install-modal .btn-primary, .host-caddy .btn-primary { background: var(--text-primary) !important; color: var(--bg-primary) !important; }
.host-caddy .text-xs { font-size: 13px; }
.host-caddy .text-gray-500, .host-caddy .text-gray-400 { color: var(--text-secondary); }
@media (max-width: 640px) {
  .host-caddy button, .caddy-install-modal button { min-height: 44px; }
  .host-caddy dl { grid-template-columns: minmax(0, 1fr); }
}
@media (prefers-reduced-motion: reduce) {
  .host-caddy *, .host-caddy .animate-spin, .caddy-install-modal *, .caddy-install-modal .animate-spin { transition: none; animation: none; }
}
</style>
