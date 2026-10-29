<script setup lang="ts">
import { ref, onMounted, onActivated, onDeactivated, onUnmounted, watch, computed, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import { useToast } from '@/stores/toast'

import api from '@/api'
import SkeletonLoader from '@/components/SkeletonLoader.vue'
import BatchConfigModal from '@/components/host/BatchConfigModal.vue'
import MigrateHostModal from '@/components/host/MigrateHostModal.vue'
import HostInstancesList from '@/components/host/HostInstancesList.vue'
import RecreateModal from '@/components/instance/modals/RecreateModal.vue'
import type { InstanceConfigResponse } from '@/types/api'
import { translateError } from '@/utils/errorHandler'
import { instanceDetailPath } from '@/utils/app-paths'

const { t } = useI18n()
const router = useRouter()
const authStore = useAuthStore()
const themeStore = useThemeStore()
const toast = useToast()


interface Props {
  hostId: number
  hostName?: string
}

const props = defineProps<Props>()
const pageActive = ref(false)
let alive = true
let listSequence = 0
let trafficSequence = 0
let displayedQuery = ''
const detailSequences = new Map<number, number>()
const sessionKey = computed(() => {
  if (!authStore.token || !authStore.user) return ''
  let identity = authStore.token
  try {
    const payload = JSON.parse(atob(identity.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    if (typeof payload.sid === 'string') identity = payload.sid
  } catch { /* Legacy tokens retain their full identity. */ }
  return `${authStore.user.id}:${authStore.user.role}:${identity}`
})
function captureReadContext() {
  const sequence = listSequence, session = sessionKey.value, hostId = props.hostId
  return () => alive && pageActive.value && !!session && session === sessionKey.value && hostId === props.hostId && sequence === listSequence
}

// 获取付费实例的图标类型（根据实例类型判断）
// 返回 'pro' | 'prime' | null
function getPaidIconType(instance: Instance): 'pro' | 'prime' | null {
  // 只有付费实例才显示付费图标
  if (!instance.packagePlanId) return null
  
  // 根据实例类型判断：虚拟机显示 prime，容器显示 pro
  return instance.instanceType === 'vm' ? 'prime' : 'pro'
}

interface Instance {
  id: number
  hostId?: number
  host_id?: number
  name: string
  incusId?: string
  incus_id?: string
  status: string
  image: string
  imageName?: string | null
  ipv4?: string
  ipv6?: string
  network_mode?: string
  networkMode?: string
  cpu: number
  memory: number
  disk: number
  createdAt?: string
  created_at?: string
  updatedAt?: string
  updated_at?: string
  // 管理员视图返回的用户信息
  username?: string | null
  userEmail?: string | null
  userAvatarStyle?: string | null
  userId?: number
  user_id?: number
  ssh_port?: number | null
  port_limit?: number | null
  snapshot_limit?: number | null
  backup_limit?: number | null
  site_limit?: number | null
  remaining_quota?: {
    port: number
    snapshot: number
    backup: number
    site: number
  }
  quota_usage?: {
    port: number
    snapshot: number
    backup: number
    site: number
  }
  effective_quota_limit?: {
    port: number
    snapshot: number
    backup: number
    site: number
  }
  swapEnabled?: boolean
  swapSize?: number | null
  monthlyTrafficLimit?: string | null
  limitsIngress?: string | null
  limitsEgress?: string | null
  expiresAt?: string | null
  expires_at?: string | null
  suspendedAt?: string | null
  suspended_at?: string | null
  suspendReason?: string | null
  suspend_reason?: string | null
  autoRenew?: boolean
  package?: {
    id?: number
    name?: string
  } | null
  // NAT公网IP
  natPublicIp?: string | null
  host?: {
    nat_public_ip?: string | null
  }
  // 流量信息
  trafficData?: {
    monthlyUsed: string
    monthlyUsedFormatted: string
    monthlyLimit: string | null
    monthlyLimitFormatted: string | null
    percentage: number
  } | null
  // 付费实例标识
  packagePlanId?: number | null
  // 实例类型：容器或虚拟机
  instanceType?: 'container' | 'vm'
  // 续费价格
  billingPrice?: number | null
}

interface ImageOption {
  incusAlias: string
  name: string
  description: string | null
  icon?: string | null
}

interface SshKeyOption {
  id: number
  name: string
}

const instances = ref<Instance[]>([])
const loading = ref(true)
const loadError = ref('')
const page = ref(1)
const pageSize = ref(10)
const total = ref(0)
const totalPages = ref(1)
const searchQuery = ref('')

// 状态筛选
const statusFilter = ref('')

// 排序
const sortBy = ref('createdAt')
const sortOrder = ref<'asc' | 'desc'>('desc')

// 状态选项
const statusOptions = [
  { value: '', label: 'instance.statusFilter.all' },
  { value: 'running', label: 'instance.status.running' },
  { value: 'stopped', label: 'instance.status.stopped' },
  { value: 'suspended', label: 'instance.status.suspended' },
  { value: 'creating', label: 'instance.status.creating' },
  { value: 'error', label: 'instance.status.error' }
]

// 批量选择相关
const selectedIds = ref<Set<number>>(new Set())
const isDeleting = ref(false)
const deletingMode = ref<'database' | 'full' | null>(null)
const isSyncing = ref(false)
const showDeleteModal = ref(false)
const deleteReason = ref('')
const deleteRefund = ref(false)
const deletePreviewError = ref('')
const deleteRequestError = ref('')
let deletePreviewSequence = 0
let deleteDialogGeneration = 0
let selectionRevision = 0
let deleteSelectionRevision = 0
watch(selectedIds, () => { selectionRevision++ }, { deep: true, flush: 'sync' })
const deleteDialog = ref<HTMLElement | null>(null)
let deleteReturnFocus: HTMLElement | null = null
watch(showDeleteModal, async (open) => {
  const generation = ++deleteDialogGeneration
  if (open) {
    deleteReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    await nextTick()
    if (!showDeleteModal.value || generation !== deleteDialogGeneration) return
    deleteDialog.value?.querySelector<HTMLButtonElement>('button')?.focus()
  } else { deletePreviewSequence++; if (deleteReturnFocus?.isConnected) deleteReturnFocus.focus() }
}, { flush: 'sync' })
function handleDeleteDialogKey(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); if (!isDeleting.value) showDeleteModal.value = false; return }
  if (event.key !== 'Tab' || !deleteDialog.value) return
  const controls = [...deleteDialog.value.querySelectorAll<HTMLElement>('button, input, textarea, [tabindex="0"]')]
    .filter(element => !element.matches(':disabled') && element.getClientRects().length > 0)
  const target = event.shiftKey ? controls.at(-1) : controls[0]
  if (!controls.length || (event.shiftKey ? document.activeElement === controls[0] : document.activeElement === controls.at(-1))) {
    event.preventDefault(); target?.focus()
  }
}
const deleteFailures = ref<Array<{ id: number; name: string; error?: string }>>([])
const deleteSelectionOverride = ref<number[] | null>(null)

// 删除预览相关（退款信息）
const deletePreviewLoading = ref(false)
const deletePreview = ref<{
  instances: Array<{
    id: number
    name: string
    username: string
    userId: number
    isOwnInstance: boolean
    isPaid: boolean
    remainingDays: number
    refundAmount: number
  }>
  totalRefundAmount: number
} | null>(null)

// 批量封停相关
const isSuspending = ref(false)
const isUnsuspending = ref(false)
const showSuspendModal = ref(false)
const suspendReason = ref('')
const suspendTargets = ref<number[]>([])
let suspendDialogGeneration = 0
const suspendDialog = ref<HTMLElement | null>(null)
let suspendReturnFocus: HTMLElement | null = null
const batchActionError = ref('')
const batchActionFailures = ref<Array<{ id: number; name: string; error?: string }>>([])
const batchStatusBusy = computed(() => isSuspending.value || isUnsuspending.value || isSyncing.value)
function validBatchTargets(ids: number[]): boolean {
  return ids.length > 0 && ids.length <= 100 && new Set(ids).size === ids.length &&
    ids.every(id => instances.value.some(instance => instance.id === id))
}
const canStartBatchStatus = computed(() => alive && pageActive.value && !!sessionKey.value && !loading.value &&
  !batchStatusBusy.value && validBatchTargets([...selectedIds.value]))
const canConfirmSuspend = computed(() => alive && pageActive.value && !!sessionKey.value && !loading.value &&
  !batchStatusBusy.value && showSuspendModal.value && validBatchTargets(suspendTargets.value) && suspendReason.value.length <= 500)
watch(showSuspendModal, async (open) => {
  const generation = ++suspendDialogGeneration
  if (open) {
    suspendReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    await nextTick()
    if (showSuspendModal.value && generation === suspendDialogGeneration) suspendDialog.value?.querySelector<HTMLButtonElement>('button')?.focus()
  } else {
    suspendTargets.value = []
    if (suspendReturnFocus?.isConnected) suspendReturnFocus.focus()
  }
}, { flush: 'sync' })
function handleSuspendDialogKey(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); if (!isSuspending.value) showSuspendModal.value = false; return }
  if (event.key !== 'Tab' || !suspendDialog.value) return
  const controls = [...suspendDialog.value.querySelectorAll<HTMLElement>('button, textarea')]
    .filter(element => !element.matches(':disabled') && element.getClientRects().length > 0)
  const target = event.shiftKey ? controls.at(-1) : controls[0]
  if (!controls.length || (event.shiftKey ? document.activeElement === controls[0] : document.activeElement === controls.at(-1))) {
    event.preventDefault(); target?.focus()
  }
}

function applyBatchStatusResults(results: Array<{ id: number; name: string; success: boolean; error?: string }>, ids: number[]) {
  // The server may skip targets that already have the requested state.
  if (!Array.isArray(results) || new Set(results.map(item => item.id)).size !== results.length ||
    results.some(item => !ids.includes(item.id) || typeof item.success !== 'boolean')) throw new Error(t('common.operationFailed'))
  batchActionFailures.value = results.filter(item => !item.success)
  const succeeded = new Set(results.filter(item => item.success).map(item => item.id))
  selectedIds.value = new Set([...selectedIds.value].filter(id => !succeeded.has(id)))
}

// 通知节点下实例所属用户
const showNotifyModal = ref(false)
const notifyTitle = ref('')
const notifyContent = ref('')
const notifySendEmail = ref(false)
const isSendingNotify = ref(false)
const notifyTargets = ref<number[]>([])
const notifyError = ref('')
let notifyDialogGeneration = 0
let notifyDraftRevision = 0
const notifyDialog = ref<HTMLElement | null>(null)
let notifyReturnFocus: HTMLElement | null = null
const canOpenNotify = computed(() => alive && pageActive.value && !!sessionKey.value && !loading.value && !isSendingNotify.value &&
  validBatchTargets([...selectedIds.value]))
const canSendNotify = computed(() => alive && pageActive.value && !!sessionKey.value && !loading.value && !isSendingNotify.value &&
  showNotifyModal.value && validBatchTargets(notifyTargets.value) &&
  notifyTitle.value.trim().length > 0 && notifyTitle.value.trim().length <= 200 &&
  notifyContent.value.trim().length > 0 && notifyContent.value.trim().length <= 5000)
watch([notifyTitle, notifyContent, notifySendEmail], () => { notifyDraftRevision++ }, { flush: 'sync' })
watch(showNotifyModal, async (open) => {
  const generation = ++notifyDialogGeneration
  if (open) {
    notifyReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    await nextTick()
    if (showNotifyModal.value && generation === notifyDialogGeneration) notifyDialog.value?.querySelector<HTMLButtonElement>('button')?.focus()
  } else {
    notifyTargets.value = []
    if (notifyReturnFocus?.isConnected) notifyReturnFocus.focus()
  }
}, { flush: 'sync' })
function handleNotifyDialogKey(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); closeNotifyModal(); return }
  if (event.key !== 'Tab' || !notifyDialog.value) return
  const controls = [...notifyDialog.value.querySelectorAll<HTMLElement>('button, input, textarea')]
    .filter(element => !element.matches(':disabled') && element.getClientRects().length > 0)
  const target = event.shiftKey ? controls.at(-1) : controls[0]
  if (!controls.length || (event.shiftKey ? document.activeElement === controls[0] : document.activeElement === controls.at(-1))) {
    event.preventDefault(); target?.focus()
  }
}



// 重置流量
const resettingTrafficId = ref<number | null>(null)

// 重置流量确认弹窗
const showResetTrafficModal = ref(false)
const resetTrafficTarget = ref<Instance | null>(null)
const resetTrafficError = ref('')
let resetTrafficDialogGeneration = 0
const resetTrafficDialog = ref<HTMLElement | null>(null)
let resetTrafficReturnFocus: HTMLElement | null = null
const canResetTraffic = computed(() => alive && pageActive.value && !!sessionKey.value && !loading.value && resettingTrafficId.value === null &&
  showResetTrafficModal.value && resetTrafficTarget.value && instances.value.some(instance => instance.id === resetTrafficTarget.value?.id && instance.status !== 'deleted'))
watch(showResetTrafficModal, async (open) => {
  const generation = ++resetTrafficDialogGeneration
  if (open) {
    resetTrafficReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    await nextTick()
    if (showResetTrafficModal.value && generation === resetTrafficDialogGeneration) resetTrafficDialog.value?.querySelector<HTMLButtonElement>('button')?.focus()
  } else {
    resetTrafficTarget.value = null
    if (resetTrafficReturnFocus?.isConnected) resetTrafficReturnFocus.focus()
  }
}, { flush: 'sync' })
function handleResetTrafficDialogKey(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); if (resettingTrafficId.value === null) showResetTrafficModal.value = false; return }
  if (event.key !== 'Tab' || !resetTrafficDialog.value) return
  const controls = [...resetTrafficDialog.value.querySelectorAll<HTMLElement>('button')]
    .filter(element => !element.matches(':disabled') && element.getClientRects().length > 0)
  const target = event.shiftKey ? controls.at(-1) : controls[0]
  if (!controls.length || (event.shiftKey ? document.activeElement === controls[0] : document.activeElement === controls.at(-1))) {
    event.preventDefault(); target?.focus()
  }
}

// 修改续费价格
const showPriceModal = ref(false)
const priceModalTarget = ref<Instance | null>(null)
const newPriceInput = ref<number>(0)
const isUpdatingPrice = ref(false)
const priceError = ref('')
let priceDialogGeneration = 0
let priceDraftRevision = 0
const priceDialog = ref<HTMLElement | null>(null)
let priceReturnFocus: HTMLElement | null = null
const canUpdatePrice = computed(() => alive && pageActive.value && !!sessionKey.value && !loading.value && !isUpdatingPrice.value &&
  showPriceModal.value && priceModalTarget.value && instances.value.some(instance => instance.id === priceModalTarget.value?.id && instance.packagePlanId) &&
  typeof newPriceInput.value === 'number' && Number.isFinite(newPriceInput.value) && newPriceInput.value >= 0 && newPriceInput.value <= 99999 &&
  Math.abs(Number(priceModalTarget.value.billingPrice ?? 0) - newPriceInput.value) >= 0.001)
watch(newPriceInput, () => { priceDraftRevision++ }, { flush: 'sync' })
watch(showPriceModal, async (open) => {
  const generation = ++priceDialogGeneration
  if (open) {
    priceReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    await nextTick()
    if (showPriceModal.value && generation === priceDialogGeneration) priceDialog.value?.querySelector<HTMLButtonElement>('button')?.focus()
  } else {
    priceModalTarget.value = null
    if (priceReturnFocus?.isConnected) priceReturnFocus.focus()
  }
}, { flush: 'sync' })
function handlePriceDialogKey(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); if (!isUpdatingPrice.value) showPriceModal.value = false; return }
  if (event.key !== 'Tab' || !priceDialog.value) return
  const controls = [...priceDialog.value.querySelectorAll<HTMLElement>('button, input')]
    .filter(element => !element.matches(':disabled') && element.getClientRects().length > 0)
  const target = event.shiftKey ? controls.at(-1) : controls[0]
  if (!controls.length || (event.shiftKey ? document.activeElement === controls[0] : document.activeElement === controls.at(-1))) {
    event.preventDefault(); target?.focus()
  }
}

// 批量修改配置
const showBatchConfigModal = ref(false)
const batchConfigSelectionOverride = ref<number[] | null>(null)
const lastBatchConfigSelection = ref<number[]>([])

// 批量迁移实例
const showMigrateModal = ref(false)

// 重建实例
const showRecreateModal = ref(false)
const recreateLoading = ref(false)
const recreateTarget = ref<Instance | null>(null)
const availableImages = ref<ImageOption[]>([])
const sshKeys = ref<SshKeyOption[]>([])
const recreatePreparing = ref(false)
const recreateError = ref('')
let recreateGeneration = 0
function resetRecreateDialog() {
  recreateGeneration++
  showRecreateModal.value = false
  recreateTarget.value = null
  availableImages.value = []
  sshKeys.value = []
  recreatePreparing.value = false
  recreateError.value = ''
}
function recreateTargetIsCurrent(target: Instance): boolean {
  const instance = instances.value.find(item => item.id === target.id)
  return !!instance && canRecreateInstance(instance) && instance.memory === target.memory && instance.instanceType === target.instanceType
}

// 批量赠送时长
const showGiftDaysModal = ref(false)
const giftDays = ref(7)
const isGifting = ref(false)
const giftTargets = ref<number[]>([])
const giftError = ref('')
const giftFailures = ref<Array<{ instanceId: number; instanceName: string; error?: string }>>([])
let giftDialogGeneration = 0
const giftDialog = ref<HTMLElement | null>(null)
let giftReturnFocus: HTMLElement | null = null
const canOpenGift = computed(() => alive && pageActive.value && !!sessionKey.value && !loading.value && !isGifting.value &&
  validBatchTargets([...selectedIds.value]) && instances.value.some(instance => selectedIds.value.has(instance.id) && instance.packagePlanId))
const canConfirmGift = computed(() => alive && pageActive.value && !!sessionKey.value && !loading.value && !isGifting.value &&
  showGiftDaysModal.value && validBatchTargets(giftTargets.value) &&
  giftTargets.value.every(id => instances.value.some(instance => instance.id === id && instance.packagePlanId)) &&
  Number.isSafeInteger(giftDays.value) && giftDays.value >= 1 && giftDays.value <= 365)
watch(showGiftDaysModal, async (open) => {
  const generation = ++giftDialogGeneration
  if (open) {
    giftReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    await nextTick()
    if (showGiftDaysModal.value && generation === giftDialogGeneration) giftDialog.value?.querySelector<HTMLButtonElement>('button')?.focus()
  } else {
    giftTargets.value = []
    if (giftReturnFocus?.isConnected) giftReturnFocus.focus()
  }
}, { flush: 'sync' })
function handleGiftDialogKey(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); if (!isGifting.value) showGiftDaysModal.value = false; return }
  if (event.key !== 'Tab' || !giftDialog.value) return
  const controls = [...giftDialog.value.querySelectorAll<HTMLElement>('button, input')]
    .filter(element => !element.matches(':disabled') && element.getClientRects().length > 0)
  const target = event.shiftKey ? controls.at(-1) : controls[0]
  if (!controls.length || (event.shiftKey ? document.activeElement === controls[0] : document.activeElement === controls.at(-1))) {
    event.preventDefault(); target?.focus()
  }
}

// 展开详情
const expandedInstanceId = ref<number | null>(null)
const detailConfigs = ref<Record<number, InstanceConfigResponse | null>>({})
const detailConfigErrors = ref<Record<number, string>>({})
const detailLoadingIds = ref<Set<number>>(new Set())
const syncingInstanceIds = ref<Set<number>>(new Set())
const swapActionLoadingIds = ref<Set<number>>(new Set())
const singleActionErrors = ref<Record<number, string>>({})
let singleActionGeneration = 0
function captureSingleActionContext() {
  const generation = singleActionGeneration, session = sessionKey.value, hostId = props.hostId
  return () => alive && pageActive.value && !!session && session === sessionKey.value &&
    hostId === props.hostId && generation === singleActionGeneration
}
function canStartSingleAction(instanceId: number): boolean {
  return alive && pageActive.value && !!sessionKey.value && !loading.value &&
    Number.isSafeInteger(instanceId) && instanceId > 0 && instances.value.some(instance => instance.id === instanceId) &&
    !syncingInstanceIds.value.has(instanceId) && !swapActionLoadingIds.value.has(instanceId)
}

const isAllSelected = computed(() => {
  return instances.value.length > 0 && selectedIds.value.size === instances.value.length
})

const isPartialSelected = computed(() => {
  return selectedIds.value.size > 0 && selectedIds.value.size < instances.value.length
})

const selectedCount = computed(() => selectedIds.value.size)
const effectiveBatchConfigSelection = computed(() => batchConfigSelectionOverride.value ?? Array.from(selectedIds.value))
const effectiveDeleteSelection = computed(() => deleteSelectionOverride.value ?? Array.from(selectedIds.value))
const effectiveDeleteCount = computed(() => effectiveDeleteSelection.value.length)
const validDeleteTargets = computed(() => effectiveDeleteSelection.value.length > 0 && effectiveDeleteSelection.value.length <= 100 &&
  new Set(effectiveDeleteSelection.value).size === effectiveDeleteSelection.value.length &&
  effectiveDeleteSelection.value.every(id => instances.value.some(instance => instance.id === id)))
const canDelete = computed(() => alive && pageActive.value && !!sessionKey.value && showDeleteModal.value && !loading.value &&
  !isDeleting.value && validDeleteTargets.value && (!deleteRefund.value || (!!deletePreview.value && !deletePreviewLoading.value)))
function captureDeleteContext() {
  const generation = deleteDialogGeneration, session = sessionKey.value, hostId = props.hostId
  return () => alive && pageActive.value && !!session && session === sessionKey.value && hostId === props.hostId &&
    showDeleteModal.value && generation === deleteDialogGeneration
}

// 计算选中的付费实例数量
const selectedPaidCount = computed(() => {
  return instances.value.filter(i => selectedIds.value.has(i.id) && i.packagePlanId).length
})

function toggleSelectAll() {
  if (loading.value || !pageActive.value || !sessionKey.value) return
  if (isAllSelected.value) {
    selectedIds.value.clear()
  } else {
    selectedIds.value = new Set(instances.value.map(i => i.id))
  }
}

function toggleSelect(id: number) {
  if (loading.value || !pageActive.value || !sessionKey.value || !instances.value.some(instance => instance.id === id)) return
  if (selectedIds.value.has(id)) {
    selectedIds.value.delete(id)
  } else {
    selectedIds.value.add(id)
  }
  // 触发响应式更新
  selectedIds.value = new Set(selectedIds.value)
}

function setLoadingState(target: typeof detailLoadingIds | typeof syncingInstanceIds | typeof swapActionLoadingIds, id: number, loading: boolean) {
  const next = new Set(target.value)
  if (loading) {
    next.add(id)
  } else {
    next.delete(id)
  }
  target.value = next
}

function isInstanceExpanded(id: number): boolean {
  return expandedInstanceId.value === id
}

function isDetailLoading(id: number): boolean {
  return detailLoadingIds.value.has(id)
}

function isInstanceSyncing(id: number): boolean {
  return syncingInstanceIds.value.has(id)
}

function isSwapActionLoading(id: number): boolean {
  return swapActionLoadingIds.value.has(id)
}

function getDetailConfig(id: number): InstanceConfigResponse | null {
  return detailConfigs.value[id] ?? null
}

async function loadInstanceDetailConfig(instanceId: number, force: boolean = false): Promise<void> {
  const currentInstance = instances.value.find(instance => instance.id === instanceId)
  if (!currentInstance || !pageActive.value || !sessionKey.value) return
  const hasQuotaDetail = !!currentInstance?.quota_usage && !!currentInstance?.effective_quota_limit
  if (!force && detailLoadingIds.value.has(instanceId)) return
  if (!force && detailConfigs.value[instanceId] && hasQuotaDetail) return

  const contextCurrent = captureReadContext()
  const sequence = (detailSequences.get(instanceId) || 0) + 1
  detailSequences.set(instanceId, sequence)
  const current = () => contextCurrent() && sequence === detailSequences.get(instanceId) && instances.value.some(instance => instance.id === instanceId)
  setLoadingState(detailLoadingIds, instanceId, true)
  try {
    const [configResult, detailResult] = await Promise.allSettled([
      api.instances.getConfig(instanceId),
      api.instances.get(instanceId)
    ])
    if (!current()) return

    if (configResult.status === 'fulfilled') {
      detailConfigs.value = {
        ...detailConfigs.value,
        [instanceId]: configResult.value
      }
      detailConfigErrors.value = {
        ...detailConfigErrors.value,
        [instanceId]: ''
      }
    } else {
      detailConfigErrors.value = {
        ...detailConfigErrors.value,
        [instanceId]: (configResult.reason as any)?.message || String(configResult.reason)
      }
    }

    if (detailResult.status === 'fulfilled') {
      const detail = detailResult.value as Partial<Instance>
      if (detail.id !== instanceId || (detail.hostId != null && detail.hostId !== props.hostId) ||
        (detail.host_id != null && detail.host_id !== props.hostId)) return
      instances.value = instances.value.map(instance =>
        instance.id === instanceId
          ? { ...instance, ...(detailResult.value as Partial<Instance>) }
          : instance
      )
    }
  } catch (err: any) {
    if (!current()) return
    detailConfigErrors.value = {
      ...detailConfigErrors.value,
      [instanceId]: err?.message || String(err)
    }
  } finally {
    if (current()) setLoadingState(detailLoadingIds, instanceId, false)
  }
}

async function toggleExpandInstance(instance: Instance): Promise<void> {
  if (expandedInstanceId.value === instance.id) {
    expandedInstanceId.value = null
    return
  }

  expandedInstanceId.value = instance.id
  await loadInstanceDetailConfig(instance.id)
}

function openSingleConfigModal(instanceId: number): void {
  batchConfigSelectionOverride.value = [instanceId]
  lastBatchConfigSelection.value = [instanceId]
  showBatchConfigModal.value = true
}

function openBatchConfigForSelection(): void {
  lastBatchConfigSelection.value = [...effectiveBatchConfigSelection.value]
  showBatchConfigModal.value = true
}

function openSingleDeleteModal(instanceId: number): void {
  if (!alive || !pageActive.value || !sessionKey.value || isDeleting.value || loading.value || !instances.value.some(instance => instance.id === instanceId)) return
  deleteSelectionOverride.value = [instanceId]
  void openBatchDeleteModal()
}

async function openBatchDeleteModal() {
  if (!alive || !pageActive.value || !sessionKey.value || isDeleting.value || loading.value || !validDeleteTargets.value) return
  deleteSelectionOverride.value = [...effectiveDeleteSelection.value]
  deleteSelectionRevision = selectionRevision
  deleteReason.value = ''
  deleteRefund.value = authStore.user?.role !== 'admin'
  deletePreviewError.value = ''
  deleteRequestError.value = ''
  deleteFailures.value = []
  deletePreview.value = null
  showDeleteModal.value = true
  await loadDeletePreview()
}

async function loadDeletePreview() {
  if (!alive || !pageActive.value || !sessionKey.value || !showDeleteModal.value || !validDeleteTargets.value || loading.value) return
  const current = captureDeleteContext()
  const sequence = ++deletePreviewSequence
  const ids = [...effectiveDeleteSelection.value]
  const selection = ids.join(',')
  deletePreviewLoading.value = true
  deletePreview.value = null
  deletePreviewError.value = ''
  try {
    const preview = await api.hosts.batchDeleteInstancesPreview(
      props.hostId,
      ids
    )
    if (!current() || sequence !== deletePreviewSequence || effectiveDeleteSelection.value.join(',') !== selection) return
    if (!Array.isArray(preview.instances) || preview.instances.length !== ids.length ||
      new Set(preview.instances.map(item => item.id)).size !== ids.length ||
      preview.instances.some(item => !ids.includes(item.id) || typeof item.refundAmount !== 'number' || !Number.isFinite(item.refundAmount) || item.refundAmount < 0) ||
      typeof preview.totalRefundAmount !== 'number' || !Number.isFinite(preview.totalRefundAmount) || preview.totalRefundAmount < 0) {
      throw new Error(t('admin.hosts.batchDeleteFailed'))
    }
    deletePreview.value = preview
  } catch (err: any) {
    if (current() && sequence === deletePreviewSequence && effectiveDeleteSelection.value.join(',') === selection) deletePreviewError.value = translateError(err)
  } finally {
    if (current() && sequence === deletePreviewSequence) deletePreviewLoading.value = false
  }
}

async function confirmBatchDelete(databaseOnly: boolean = false) {
  if (!canDelete.value) return
  const current = captureDeleteContext(), hostId = props.hostId, ids = [...effectiveDeleteSelection.value]
  const revision = deleteSelectionRevision
  const reason = deleteReason.value.trim() || undefined, refund = deleteRefund.value
  isDeleting.value = true
  deleteRequestError.value = ''
  deletingMode.value = databaseOnly ? 'database' : 'full'
  try {
    const result = await api.hosts.batchDeleteInstances(
      hostId,
      ids,
      reason,
      databaseOnly,
      refund
    )
    if (!current()) return
    if (!Array.isArray(result.results) || result.results.length !== ids.length ||
      new Set(result.results.map(item => item.id)).size !== ids.length || result.results.some(item => !ids.includes(item.id))) {
      throw new Error(t('admin.hosts.batchDeleteFailed'))
    }
    if (result.failedCount > 0) {
      toast.warning(t('admin.hosts.batchDeletePartial', {
        success: result.successCount,
        failed: result.failedCount
      }))
    } else {
      toast.success(t('admin.hosts.batchDeleteSuccess', { count: result.successCount }))
    }
    
    deleteFailures.value = result.results.filter(item => !item.success)
    const succeeded = new Set(result.results.filter(item => item.success).map(item => item.id))
    selectedIds.value = revision === selectionRevision
      ? new Set(deleteFailures.value.map(item => item.id))
      : new Set([...selectedIds.value].filter(id => !succeeded.has(id)))
    deleteSelectionOverride.value = deleteFailures.value.length ? deleteFailures.value.map(item => item.id) : null
    if (!deleteFailures.value.length) { deleteReason.value = ''; showDeleteModal.value = false }
    await loadInstances()
  } catch (err: any) {
    if (!current()) return
    deleteRequestError.value = translateError(err)
    toast.error(t('admin.hosts.batchDeleteFailed') + ': ' + deleteRequestError.value)
  } finally {
    isDeleting.value = false
    deletingMode.value = null
  }
}

function openBatchSuspendModal() {
  if (!canStartBatchStatus.value || showSuspendModal.value) return
  suspendTargets.value = [...selectedIds.value]
  suspendReason.value = ''
  batchActionError.value = ''
  showSuspendModal.value = true
}

async function confirmBatchSuspend() {
  if (!canConfirmSuspend.value) return
  const context = captureReadContext(), generation = suspendDialogGeneration
  const current = () => context() && showSuspendModal.value && generation === suspendDialogGeneration
  const hostId = props.hostId, ids = [...suspendTargets.value], reason = suspendReason.value.trim() || undefined
  isSuspending.value = true
  batchActionError.value = ''
  try {
    const result = await api.hosts.batchSuspendInstances(
      hostId,
      ids,
      reason
    )
    if (!current()) return
    applyBatchStatusResults(result.results, ids)
    if (result.failedCount > 0) {
      toast.warning(t('admin.hosts.batchSuspendPartial', {
        success: result.successCount,
        failed: result.failedCount
      }))
    } else {
      toast.success(t('admin.hosts.batchSuspendSuccess', { count: result.successCount }))
    }
    
    suspendReason.value = ''
    showSuspendModal.value = false
    await loadInstances()
  } catch (err: any) {
    if (!current()) return
    batchActionError.value = t('admin.hosts.batchSuspendFailed') + ': ' + translateError(err)
    toast.error(batchActionError.value)
  } finally {
    isSuspending.value = false
  }
}

async function confirmBatchUnsuspend() {
  if (!canStartBatchStatus.value || showSuspendModal.value) return
  const current = captureReadContext(), hostId = props.hostId, ids = [...selectedIds.value]
  isUnsuspending.value = true
  batchActionError.value = ''
  try {
    const result = await api.hosts.batchUnsuspendInstances(
      hostId,
      ids
    )
    if (!current()) return
    applyBatchStatusResults(result.results, ids)
    if (result.failedCount > 0) {
      toast.warning(t('admin.hosts.batchUnsuspendPartial', {
        success: result.successCount,
        failed: result.failedCount
      }))
    } else if (result.successCount === 0) {
      toast.warning(t('admin.hosts.batchUnsuspendNone'))
    } else {
      toast.success(t('admin.hosts.batchUnsuspendSuccess', { count: result.successCount }))
    }
    
    await loadInstances()
  } catch (err: any) {
    if (!current()) return
    batchActionError.value = t('admin.hosts.batchUnsuspendFailed') + ': ' + translateError(err)
    toast.error(batchActionError.value)
  } finally {
    isUnsuspending.value = false
  }
}

async function batchSyncStatus() {
  if (!canStartBatchStatus.value || showSuspendModal.value) return
  const current = captureReadContext(), hostId = props.hostId, ids = [...selectedIds.value]
  isSyncing.value = true
  batchActionError.value = ''
  try {
    const result = await api.hosts.batchSyncInstanceStatus(
      hostId,
      ids
    )
    if (!current()) return
    applyBatchStatusResults(result.results, ids)
    if (result.failedCount > 0) {
      toast.warning(t('admin.hosts.batchSyncPartial', {
        synced: result.syncedCount,
        changed: result.changedCount,
        failed: result.failedCount
      }))
    } else if (result.changedCount > 0 || result.ipv4ChangedCount > 0) {
      // 有状态变更或 IPv4 变更
      if (result.ipv4ChangedCount > 0) {
        toast.success(t('admin.hosts.batchSyncWithIpv4', {
          synced: result.syncedCount,
          changed: result.changedCount,
          ipv4Changed: result.ipv4ChangedCount
        }))
      } else {
        toast.success(t('admin.hosts.batchSyncSuccess', {
          synced: result.syncedCount,
          changed: result.changedCount
        }))
      }
    } else {
      toast.info(t('admin.hosts.batchSyncNoChange', { synced: result.syncedCount }))
    }
    
    await loadInstances()
  } catch (err: any) {
    if (!current()) return
    batchActionError.value = t('admin.hosts.batchSyncFailed') + ': ' + translateError(err)
    toast.error(batchActionError.value)
  } finally {
    isSyncing.value = false
  }
}

// 批量赠送时长
function openGiftDaysModal() {
  if (!canOpenGift.value || showGiftDaysModal.value) return
  giftTargets.value = instances.value.filter(instance => selectedIds.value.has(instance.id) && instance.packagePlanId).map(instance => instance.id)
  giftDays.value = 7
  giftError.value = ''
  giftFailures.value = []
  showGiftDaysModal.value = true
}

async function confirmGiftDays() {
  if (!canConfirmGift.value) return
  const generation = giftDialogGeneration, session = sessionKey.value
  const hostId = props.hostId, ids = [...giftTargets.value], days = giftDays.value
  const current = () => alive && pageActive.value && !!session && session === sessionKey.value && hostId === props.hostId &&
    showGiftDaysModal.value && generation === giftDialogGeneration
  isGifting.value = true
  giftError.value = ''
  try {
    const result = await api.hosts.giftDays(
      hostId,
      ids,
      days
    )
    if (!current()) return
    if (!Array.isArray(result.results) || !Number.isSafeInteger(result.skippedCount) || result.skippedCount < 0 ||
      result.results.length + result.skippedCount !== ids.length ||
      new Set(result.results.map(item => item.instanceId)).size !== result.results.length ||
      result.results.some(item => !ids.includes(item.instanceId) || typeof item.success !== 'boolean')) throw new Error(t('common.operationFailed'))
    if (result.failedCount > 0) {
      toast.warning(t('host.giftDays.partial', {
        success: result.successCount,
        failed: result.failedCount
      }))
    } else {
      toast.success(t('host.giftDays.success', { count: result.successCount, days }))
    }
    
    if (result.skippedCount > 0) {
      toast.info(t('host.giftDays.skipped', { count: result.skippedCount }))
    }
    
    giftFailures.value = result.results.filter(item => !item.success)
    const succeeded = new Set(result.results.filter(item => item.success).map(item => item.instanceId))
    selectedIds.value = new Set([...selectedIds.value].filter(id => !succeeded.has(id)))
    giftTargets.value = giftFailures.value.map(item => item.instanceId)
    if (!giftFailures.value.length) showGiftDaysModal.value = false
    await loadInstances()
  } catch (err: any) {
    if (!current()) return
    giftError.value = t('host.giftDays.failed') + ': ' + translateError(err)
    toast.error(giftError.value)
  } finally {
    isGifting.value = false
  }
}

// 发送通知给选中实例的用户
function openNotifyModal() {
  if (!canOpenNotify.value || showNotifyModal.value) return
  notifyTargets.value = [...selectedIds.value]
  notifyError.value = ''
  notifyTitle.value = ''
  notifyContent.value = ''
  notifySendEmail.value = false
  showNotifyModal.value = true
}

function closeNotifyModal(force: boolean = false) {
  if (isSendingNotify.value && !force) return
  showNotifyModal.value = false
  notifyTitle.value = ''
  notifyContent.value = ''
  notifySendEmail.value = false
}

function handleCloseNotifyModal() {
  closeNotifyModal()
}

function buildNotifyResultMessage(result: Awaited<ReturnType<typeof api.inbox.notifyHostUsers>>): string {
  if (!result.email) {
    return t('host.notify.sendSuccess', { count: result.count })
  }

  const parts = [t('host.notify.sendSuccessBase', { count: result.count })]

  if (result.email.sentCount > 0) {
    parts.push(t('host.notify.emailDirectSuccess', { count: result.email.sentCount }))
  }
  if (result.email.queuedCount > 0) {
    parts.push(t('host.notify.emailQueuedSuccess', { count: result.email.queuedCount }))
  }
  if (result.email.skippedCount > 0) {
    parts.push(t('host.notify.emailSkipped', { count: result.email.skippedCount }))
  }
  if (result.email.failedCount > 0) {
    parts.push(t('host.notify.emailFailed', { count: result.email.failedCount }))
  }

  return parts.join(' · ')
}

async function sendNotify() {
  if (!canSendNotify.value) return
  const hostId = props.hostId, instanceIds = [...notifyTargets.value], title = notifyTitle.value.trim(), content = notifyContent.value.trim(), sendEmail = notifySendEmail.value
  const session = sessionKey.value, generation = notifyDialogGeneration, revision = notifyDraftRevision
  const current = () => alive && pageActive.value && !!session && session === sessionKey.value && hostId === props.hostId &&
    showNotifyModal.value && generation === notifyDialogGeneration
  isSendingNotify.value = true
  notifyError.value = ''
  try {
    const result = await api.inbox.notifyHostUsers(hostId, { title, content, instanceIds, sendEmail })
    if (!current()) return
    if (result.success !== true || !Number.isSafeInteger(result.count) || result.count < 0 || result.count > instanceIds.length ||
      (result.email && [result.email.sentCount, result.email.queuedCount, result.email.skippedCount, result.email.failedCount]
        .some(count => !Number.isSafeInteger(count) || count < 0))) throw new Error(t('common.operationFailed'))
    const message = buildNotifyResultMessage(result)
    if (result.email?.failedCount) {
      toast.warning(message)
    } else {
      toast.success(message)
    }

    if (revision === notifyDraftRevision) closeNotifyModal(true)
  } catch (err: any) {
    if (!current()) return
    notifyError.value = t('host.notify.sendFailed') + ': ' + translateError(err)
    toast.error(notifyError.value)
  } finally {
    isSendingNotify.value = false
  }
}



// 打开修改续费价格弹窗
function openPriceModal(instance: Instance) {
  if (!alive || !pageActive.value || !sessionKey.value || loading.value || isUpdatingPrice.value || showPriceModal.value) return
  const current = instances.value.find(item => item.id === instance.id && item.packagePlanId && item.status !== 'deleted')
  if (!current) return
  priceModalTarget.value = current
  newPriceInput.value = Number(current.billingPrice ?? 0)
  priceError.value = ''
  showPriceModal.value = true
}

// 更新续费价格
async function updateRenewalPrice() {
  if (!canUpdatePrice.value || !priceModalTarget.value) return
  const hostId = props.hostId, instanceId = priceModalTarget.value.id, newPrice = newPriceInput.value
  const session = sessionKey.value, generation = priceDialogGeneration, revision = priceDraftRevision
  const current = () => alive && pageActive.value && !!session && session === sessionKey.value && hostId === props.hostId &&
    showPriceModal.value && generation === priceDialogGeneration && priceModalTarget.value?.id === instanceId
  isUpdatingPrice.value = true
  priceError.value = ''
  try {
    const result = await api.hosts.updateInstanceRenewalPrice(
      hostId,
      instanceId,
      newPrice
    )
    if (!current()) return
    if (result.instanceId !== instanceId || typeof result.newPrice !== 'number' || !Number.isFinite(result.newPrice) ||
      result.newPrice < 0 || result.newPrice > 99999 || result.newPrice !== newPrice) throw new Error(t('common.operationFailed'))
    toast.success(t('host.price.updateSuccess'))
    const target = instances.value.find(instance => instance.id === instanceId)
    if (target) target.billingPrice = result.newPrice
    if (priceModalTarget.value?.id === instanceId) priceModalTarget.value.billingPrice = result.newPrice
    if (revision === priceDraftRevision) showPriceModal.value = false
    // A list request started before this write may still carry the previous price.
    if (loading.value) await loadInstances()
  } catch (err: any) {
    if (!current()) return
    priceError.value = t('host.price.updateFailed') + ': ' + translateError(err)
    toast.error(priceError.value)
  } finally {
    isUpdatingPrice.value = false
  }
}

// 打开重置流量确认弹窗
function openResetTrafficModal(instance: Instance) {
  if (!alive || !pageActive.value || !sessionKey.value || loading.value || resettingTrafficId.value !== null || showResetTrafficModal.value) return
  const current = instances.value.find(item => item.id === instance.id && item.status !== 'deleted')
  if (!current) return
  resetTrafficTarget.value = current
  resetTrafficError.value = ''
  showResetTrafficModal.value = true
}

// 确认重置实例流量
async function confirmResetTraffic() {
  if (!canResetTraffic.value || !resetTrafficTarget.value) return
  const instanceId = resetTrafficTarget.value.id, hostId = props.hostId, session = sessionKey.value, generation = resetTrafficDialogGeneration
  const current = () => alive && pageActive.value && !!session && session === sessionKey.value && hostId === props.hostId &&
    showResetTrafficModal.value && generation === resetTrafficDialogGeneration && resetTrafficTarget.value?.id === instanceId
  resettingTrafficId.value = instanceId
  resetTrafficError.value = ''
  try {
    const result = await api.traffic.resetInstanceTraffic(instanceId)
    if (!current()) return
    if (result.success !== true) throw new Error(t('common.operationFailed'))
    toast.success(t('admin.hosts.trafficResetSuccess'))
    showResetTrafficModal.value = false
    // Reset is already committed. Optional display reads must not turn it into a retryable failure.
    if (loading.value) void loadInstances()
    else void loadInstancesTraffic()
  } catch (err: any) {
    if (!current()) return
    resetTrafficError.value = t('admin.hosts.trafficResetFailed') + ': ' + translateError(err)
    toast.error(resetTrafficError.value)
  } finally {
    resettingTrafficId.value = null
  }
}

function canRecreateInstance(instance: Instance): boolean {
  const currentUserId = authStore.user?.id
  const ownerId = instance.userId ?? instance.user_id
  return alive && pageActive.value && !!sessionKey.value && !loading.value &&
    Number.isSafeInteger(instance.id) && instance.id > 0 && instances.value.some(item => item.id === instance.id) &&
    !!currentUserId && ownerId === currentUserId && typeof instance.status === 'string' && instance.status.toLowerCase() !== 'suspended'
}

async function openRecreateModal(instance: Instance): Promise<void> {
  const target = instances.value.find(item => item.id === instance.id)
  if (!target || !canRecreateInstance(target) || recreateLoading.value || showRecreateModal.value ||
    (recreatePreparing.value && recreateTarget.value?.id === target.id)) return
  resetRecreateDialog()
  recreateTarget.value = { ...target }
  recreatePreparing.value = true
  const generation = recreateGeneration, hostId = props.hostId, session = sessionKey.value
  const current = () => alive && pageActive.value && !!session && session === sessionKey.value &&
    hostId === props.hostId && generation === recreateGeneration
  try {
    const imageType = target.instanceType === 'vm' ? 'vm' : 'container'
    const [imageResponse, keyResponse] = await Promise.all([
      api.images.getSystemImages(imageType, target.memory, hostId),
      api.sshKeys.list()
    ])
    if (!current()) return
    if (!recreateTarget.value || !recreateTargetIsCurrent(recreateTarget.value)) { resetRecreateDialog(); return }
    if (imageResponse.success !== true || !Array.isArray(imageResponse.images) ||
      imageResponse.images.some(img => typeof img.remoteAlias !== 'string' || !img.remoteAlias.trim() || typeof img.name !== 'string') ||
      !Array.isArray(keyResponse.keys) || keyResponse.keys.some(key => !Number.isSafeInteger(key.id) || key.id <= 0 || typeof key.name !== 'string')) {
      throw new Error(t('common.operationFailed'))
    }
    availableImages.value = imageResponse.images.map(img => ({
      incusAlias: img.remoteAlias,
      name: img.name,
      description: null,
      icon: img.icon || null
    }))
    sshKeys.value = keyResponse.keys.map(key => ({ id: key.id, name: key.name }))
    showRecreateModal.value = true
  } catch (err: any) {
    if (!current()) return
    recreateError.value = t('common.operationFailed') + ': ' + translateError(err)
    recreateTarget.value = null
    toast.error(recreateError.value)
  } finally {
    if (current()) recreatePreparing.value = false
  }
}

function handleRecreateModalVisibleChange(value: boolean): void {
  if (!value) resetRecreateDialog()
}

async function doRecreate(data: { image: string; sshKeyId: number; customInitCommandIds?: number[] }): Promise<void> {
  if (!showRecreateModal.value || recreateLoading.value || recreatePreparing.value || !recreateTarget.value ||
    !recreateTargetIsCurrent(recreateTarget.value) || !availableImages.value.some(image => image.incusAlias === data.image) ||
    !Number.isSafeInteger(data.sshKeyId) || !sshKeys.value.some(key => key.id === data.sshKeyId) ||
    (data.customInitCommandIds !== undefined && (!Array.isArray(data.customInitCommandIds) || data.customInitCommandIds.length > 20 ||
      data.customInitCommandIds.some(id => !Number.isSafeInteger(id) || id <= 0)))) return
  const instanceId = recreateTarget.value.id, hostId = props.hostId, session = sessionKey.value, generation = recreateGeneration
  const payload = { image: data.image, sshKeyId: data.sshKeyId, customInitCommandIds: data.customInitCommandIds ? [...data.customInitCommandIds] : undefined }
  const current = () => alive && pageActive.value && !!session && session === sessionKey.value && hostId === props.hostId &&
    showRecreateModal.value && generation === recreateGeneration && recreateTarget.value?.id === instanceId
  recreateLoading.value = true
  recreateError.value = ''
  try {
    const result = await api.instances.recreate(instanceId, payload)
    if (!current()) return
    if (!Number.isSafeInteger(result.taskId) || result.taskId <= 0 ||
      !['PENDING', 'PROCESSING', 'COMPLETED'].includes(result.status)) throw new Error(t('common.operationFailed'))
    toast.success(t('instance.detail.actions.taskQueued'))
    resetRecreateDialog()
    void loadInstances()
  } catch (err: any) {
    if (!current()) return
    recreateError.value = translateError(err)
    toast.error(recreateError.value)
  } finally {
    recreateLoading.value = false
  }
}

async function loadInstances() {
  if (!alive || !pageActive.value || !sessionKey.value || !Number.isSafeInteger(props.hostId) || props.hostId <= 0) return
  listSequence++
  const current = captureReadContext()
  const params = {
    hostId: props.hostId, page: page.value, pageSize: pageSize.value,
    search: searchQuery.value.trim() || undefined, status: statusFilter.value || undefined,
    sortBy: sortBy.value, sortOrder: sortOrder.value
  }
  const query = JSON.stringify(params)
  const changed = query !== displayedQuery
  const selection = !changed ? new Set(selectedIds.value) : new Set<number>()
  clearInstanceReads()
  if (changed) closeReadContextModals()
  else if (showDeleteModal.value) {
    deletePreviewSequence++
    deletePreview.value = null
    deletePreviewLoading.value = true
  }
  loading.value = true
  loadError.value = ''
  try {
    const res = await api.instances.list(params) as unknown as { instances: Instance[]; total: number; totalPages: number }
    if (!current()) return
    if (!Array.isArray(res.instances) || !Number.isSafeInteger(res.total) || res.total < 0 ||
      !Number.isSafeInteger(res.totalPages) || res.totalPages < 0 ||
      new Set(res.instances.map(instance => instance.id)).size !== res.instances.length ||
      res.instances.some(instance => !Number.isSafeInteger(instance.id) || instance.id <= 0 ||
        (instance.hostId != null && instance.hostId !== params.hostId) || (instance.host_id != null && instance.host_id !== params.hostId))) {
      throw new Error(t('instance.detail.loadFailed'))
    }
    if (params.page > Math.max(1, res.totalPages)) {
      page.value = Math.max(1, res.totalPages)
      return loadInstances()
    }
    instances.value = res.instances
    total.value = res.total
    totalPages.value = Math.max(1, res.totalPages)
    displayedQuery = query
    selectedIds.value = new Set([...selection].filter(id => res.instances.some(instance => instance.id === id)))
    if (showResetTrafficModal.value) {
      resetTrafficTarget.value = res.instances.find(instance => instance.id === resetTrafficTarget.value?.id && instance.status !== 'deleted') ?? null
      if (!resetTrafficTarget.value) showResetTrafficModal.value = false
    }
    if (showPriceModal.value) {
      priceModalTarget.value = res.instances.find(instance => instance.id === priceModalTarget.value?.id && instance.packagePlanId && instance.status !== 'deleted') ?? null
      if (!priceModalTarget.value) showPriceModal.value = false
    }
    if (showGiftDaysModal.value) {
      giftTargets.value = giftTargets.value.filter(id => res.instances.some(instance => instance.id === id && instance.packagePlanId))
      if (!giftTargets.value.length) showGiftDaysModal.value = false
    }
    if (showDeleteModal.value) {
      if (deleteSelectionOverride.value) deleteSelectionOverride.value = deleteSelectionOverride.value.filter(id => res.instances.some(instance => instance.id === id))
      if (effectiveDeleteSelection.value.length) {
        loading.value = false
        void loadDeletePreview()
      }
      else showDeleteModal.value = false
    }
    void loadInstancesTraffic()
  } catch (err: any) {
    if (!current()) return
    clearInstanceReads()
    closeReadContextModals()
    loadError.value = t('instance.detail.loadFailed') + ': ' + translateError(err)
  } finally {
    if (current()) loading.value = false
  }
}

// 批量加载实例流量数据
async function loadInstancesTraffic() {
  if (!alive || !pageActive.value || !sessionKey.value || instances.value.length === 0) return
  const contextCurrent = captureReadContext(), sequence = ++trafficSequence
  const targets = [...instances.value]
  const current = () => contextCurrent() && sequence === trafficSequence

  try {
    // 并发请求所有实例的流量数据
    const trafficPromises = targets.map(async (instance) => {
      try {
        const trafficData = await api.traffic.getInstanceTraffic(instance.id)
        return { instanceId: instance.id, trafficData }
      } catch {
        return { instanceId: instance.id, trafficData: null }
      }
    })

    const trafficResults = await Promise.all(trafficPromises)
    if (!current()) return

    // 更新实例的流量数据
    trafficResults.forEach(({ instanceId, trafficData }) => {
      const instance = instances.value.find(i => i.id === instanceId)
      if (instance) {
        instance.trafficData = trafficData
      }
    })
  } catch {
    // Traffic is optional; a failed auxiliary read must not replace the list.
  }
}

function handleSearch() {
  page.value = 1
  loadInstances()
}

function clearSearch() {
  searchQuery.value = ''
  page.value = 1
  loadInstances()
}

function handleStatusChange() {
  page.value = 1
  loadInstances()
}

function toggleSort() {
  sortOrder.value = sortOrder.value === 'desc' ? 'asc' : 'desc'
  page.value = 1
  loadInstances()
}

function handlePageSizeChange() {
  page.value = 1
  loadInstances()
}

function closeReadContextModals() {
  singleActionGeneration++
  singleActionErrors.value = {}
  resetRecreateDialog()
  notifyError.value = ''
  notifyTitle.value = ''
  notifyContent.value = ''
  notifySendEmail.value = false
  resetTrafficError.value = ''
  priceError.value = ''
  giftError.value = ''
  giftFailures.value = []
  batchActionError.value = ''
  batchActionFailures.value = []
  suspendReason.value = ''
  showDeleteModal.value = false
  showSuspendModal.value = false
  showNotifyModal.value = false
  showResetTrafficModal.value = false
  showPriceModal.value = false
  showBatchConfigModal.value = false
  showMigrateModal.value = false
  showGiftDaysModal.value = false
  deletePreviewSequence++
  deletePreview.value = null
  deletePreviewLoading.value = false
  deleteSelectionOverride.value = null
  batchConfigSelectionOverride.value = null
  lastBatchConfigSelection.value = []
}

function clearInstanceReads() {
  trafficSequence++
  instances.value = []
  total.value = 0
  totalPages.value = 1
  selectedIds.value = new Set()
  expandedInstanceId.value = null
  detailConfigs.value = {}
  detailConfigErrors.value = {}
  detailLoadingIds.value = new Set()
  detailSequences.clear()
}

function resetReadContext() {
  listSequence++
  displayedQuery = ''
  clearInstanceReads()
  closeReadContextModals()
  deleteRequestError.value = ''
  deletePreviewError.value = ''
  deleteFailures.value = []
  deleteReason.value = ''
  loadError.value = ''
  loading.value = false
  page.value = 1
  searchQuery.value = ''
  statusFilter.value = ''
  sortOrder.value = 'desc'
}
watch([() => props.hostId, sessionKey], () => {
  resetReadContext()
  void loadInstances()
}, { flush: 'sync' })

watch(showBatchConfigModal, (visible) => {
  if (visible) {
    lastBatchConfigSelection.value = [...effectiveBatchConfigSelection.value]
  } else {
    batchConfigSelectionOverride.value = null
  }
})

watch(showDeleteModal, (visible) => {
  if (!visible) {
    deleteSelectionOverride.value = null
  }
})

function activateReads() {
  if (!alive || pageActive.value) return
  pageActive.value = true
  void loadInstances()
}
onMounted(activateReads)
onActivated(activateReads)
onDeactivated(() => { pageActive.value = false; resetReadContext() })
onUnmounted(() => { alive = false; pageActive.value = false; resetReadContext() })

function getStatusInfo(status: string) {
  const map: Record<string, { label: string; class: string; dot: string }> = {
    running: { label: t('instance.status.running'), class: 'badge-success', dot: 'bg-green-500' },
    stopped: { label: t('instance.status.stopped'), class: 'badge-default', dot: 'bg-gray-500' },
    suspended: { label: t('instance.status.suspended'), class: 'badge-error', dot: 'bg-red-500' },
    starting: { label: t('instance.status.starting'), class: 'badge-warning', dot: 'bg-yellow-500 animate-pulse' },
    stopping: { label: t('instance.status.stopping'), class: 'badge-warning', dot: 'bg-yellow-500 animate-pulse' },
    restarting: { label: t('instance.status.restarting'), class: 'badge-warning', dot: 'bg-yellow-500 animate-pulse' },
    creating: { label: t('instance.status.creating'), class: 'badge-warning', dot: 'bg-yellow-500 animate-pulse' },
    error: { label: t('instance.status.error'), class: 'badge-error', dot: 'bg-red-500' }
  }
  return map[status?.toLowerCase()] || map.stopped
}

function formatMemory(mb: number): string {
  if (!mb) return '0'
  if (mb >= 1024) {
    const gb = mb / 1024
    return gb % 1 === 0 ? gb.toFixed(0) + ' GB' : gb.toFixed(1) + ' GB'
  }
  return mb + ' MB'
}

function formatDisk(mb: number): string {
  if (!mb) return '0'
  if (mb >= 1024) {
    const gb = mb / 1024
    return gb % 1 === 0 ? gb.toFixed(0) + ' GB' : gb.toFixed(1) + ' GB'
  }
  return mb + ' MB'
}

function formatMoney(value?: number | null): string {
  if (value === null || value === undefined) return '-'
  return `¥${Number(value).toFixed(2)}`
}

function formatDateTime(value?: string | null): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString()
}

function formatDateOnly(value?: string | null): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleDateString()
}

function formatBoolean(value?: boolean | null): string {
  if (value === null || value === undefined) return '-'
  return value ? t('common.enabled') : t('common.disabled')
}

function formatBandwidth(value?: string | null): string {
  if (!value) return '-'
  return String(value).replace(/Mbit/gi, 'Mbps').replace(/Gbit/gi, 'Gbps')
}

function formatSwapSize(sizeMb?: number | null): string {
  if (!sizeMb || sizeMb <= 0) return '-'
  return formatMemory(sizeMb)
}

function getInstanceTypeLabel(instance: Instance): string {
  return instance.instanceType === 'vm' ? t('common.instanceType.vm') : t('common.instanceType.container')
}

function getNetworkModeLabel(instance: Instance): string {
  const mode = instance.networkMode || instance.network_mode || 'nat'
  const key = `common.networkMode.${mode}`
  const translated = t(key)
  return translated === key ? t('common.networkMode.nat') : translated
}

function getExpiryValue(instance: Instance): string | null {
  return instance.expiresAt || instance.expires_at || null
}

function getSuspendReason(instance: Instance): string | null {
  return instance.suspendReason || instance.suspend_reason || null
}

function getTrafficSummary(instance: Instance): string {
  if (!instance.trafficData) return '-'
  if (instance.trafficData.monthlyLimitFormatted) {
    return `${instance.trafficData.monthlyUsedFormatted} / ${instance.trafficData.monthlyLimitFormatted}`
  }
  return `${instance.trafficData.monthlyUsedFormatted} / ${t('admin.hosts.trafficUnlimited')}`
}

function getTrafficPercentage(instance: Instance): number {
  return instance.trafficData?.percentage ? Math.min(instance.trafficData.percentage, 100) : 0
}

function getTrafficBarClass(instance: Instance): string {
  const percentage = instance.trafficData?.percentage ?? 0
  if (percentage >= 100) return 'bg-red-500'
  if (percentage >= 80) return 'bg-amber-500'
  return themeStore.isDark ? 'bg-blue-400' : 'bg-blue-500'
}

function getSummaryMeta(instance: Instance): string[] {
  const meta = [
    `CPU ${instance.cpu}%`,
    formatMemory(instance.memory),
    formatDisk(instance.disk)
  ]

  const swapLabel = formatSwapSize(instance.swapSize)
  if (swapLabel !== '-') {
    meta.push(`SWAP ${swapLabel}`)
  }

  return meta
}

function getQuotaLimit(instance: Instance, key: 'port' | 'snapshot' | 'site'): number | null {
  const detailLimit = instance.effective_quota_limit?.[key]
  if (detailLimit !== undefined && detailLimit !== null) {
    return detailLimit
  }

  if (key === 'port') return instance.port_limit ?? 20
  if (key === 'snapshot') return instance.snapshot_limit ?? 5
  return instance.site_limit ?? null
}

function getQuotaUsage(instance: Instance, key: 'port' | 'snapshot' | 'site'): number | null {
  const detailUsage = instance.quota_usage?.[key]
  if (detailUsage !== undefined && detailUsage !== null) {
    return detailUsage
  }

  const limit = getQuotaLimit(instance, key)
  const remaining = instance.remaining_quota?.[key]
  if (limit === null || limit === undefined || remaining === null || remaining === undefined) {
    return null
  }
  if (limit === 0) {
    return null
  }
  return Math.max(0, limit - remaining)
}

function formatQuotaPair(used: number | null, limit: number | null): string {
  if (used === null || used === undefined || limit === null || limit === undefined) {
    return '-'
  }
  if (limit === 0) {
    return `${used} / ∞`
  }
  return `${used} / ${limit}`
}

function getQuotaItems(instance: Instance): Array<{ label: string; value: string | number | null | undefined }> {
  return [
    {
      label: t('host.batchConfig.portLimit'),
      value: formatQuotaPair(getQuotaUsage(instance, 'port'), getQuotaLimit(instance, 'port'))
    },
    {
      label: t('host.batchConfig.snapshotLimit'),
      value: formatQuotaPair(getQuotaUsage(instance, 'snapshot'), getQuotaLimit(instance, 'snapshot'))
    },
    {
      label: t('host.batchConfig.siteLimit'),
      value: formatQuotaPair(getQuotaUsage(instance, 'site'), getQuotaLimit(instance, 'site'))
    }
  ]
}

function formatQuotaValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '-'
  if (typeof value === 'number' && value === 0) return t('common.unlimited')
  return String(value)
}

function canToggleSwap(instance: Instance): boolean {
  return alive && pageActive.value && !!sessionKey.value && authStore.user?.role === 'admin' &&
    ['running', 'stopped'].includes(instance.status) && instance.instanceType !== 'vm'
}

function getSwapDisplay(instance: Instance): string {
  const detail = getDetailConfig(instance.id)
  const enabled = detail?.swap.enabled ?? instance.swapEnabled ?? false
  const sizeMb = detail?.swap.sizeMb ?? instance.swapSize ?? null
  const sizeLabel = formatSwapSize(sizeMb)

  if (enabled) {
    return sizeLabel !== '-' ? `${t('common.enabled')} · ${sizeLabel}` : t('common.enabled')
  }

  if (sizeLabel !== '-') {
    return `${t('common.disabled')} · ${sizeLabel}`
  }

  return t('common.disabled')
}

function getExpirySummary(instance: Instance): string {
  const expiry = getExpiryValue(instance)
  if (!expiry) return t('billing.neverExpires')

  const expiresAt = new Date(expiry)
  if (Number.isNaN(expiresAt.getTime())) return '-'

  const diffMs = expiresAt.getTime() - Date.now()
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
  const dateLabel = formatDateOnly(expiry)

  if (diffDays < 0) {
    return `${t('billing.expired')} · ${dateLabel}`
  }

  return `${diffDays}${t('common.days')} · ${dateLabel}`
}

async function handleBatchConfigSuccess(): Promise<void> {
  await loadInstances()
  if (expandedInstanceId.value !== null && lastBatchConfigSelection.value.includes(expandedInstanceId.value)) {
    await loadInstanceDetailConfig(expandedInstanceId.value, true)
  }
}

async function syncSingleInstance(instance: Instance): Promise<void> {
  if (!canStartSingleAction(instance.id)) return
  const instanceId = instance.id, instanceName = instances.value.find(item => item.id === instanceId)!.name
  const current = captureSingleActionContext()
  setLoadingState(syncingInstanceIds, instanceId, true)
  delete singleActionErrors.value[instanceId]
  try {
    const result = await api.instances.syncStatus(instanceId)
    if (!current()) return
    if (result.success !== true || typeof result.statusChanged !== 'boolean') throw new Error(t('common.operationFailed'))
    if (result.statusChanged || result.ipv4Changed) {
      toast.success(t('admin.hosts.batchSyncSuccess', {
        synced: 1,
        changed: result.statusChanged ? 1 : 0
      }))
    } else {
      toast.info(t('admin.hosts.batchSyncNoChange', { synced: 1 }))
    }
    void loadInstances()
  } catch (err: any) {
    if (!current()) return
    singleActionErrors.value[instanceId] = `${instanceName}: ${t('admin.hosts.batchSyncFailed')}: ${translateError(err)}`
    toast.error(singleActionErrors.value[instanceId])
  } finally {
    setLoadingState(syncingInstanceIds, instanceId, false)
  }
}

async function toggleInstanceSwap(instance: Instance): Promise<void> {
  const target = instances.value.find(item => item.id === instance.id)
  if (!target || !canStartSingleAction(target.id) || !canToggleSwap(target)) return
  const instanceId = target.id, instanceName = target.name
  const current = captureSingleActionContext(), readCurrent = captureReadContext()
  // Cover the preparatory read too, so rapid clicks cannot queue multiple confirmations.
  setLoadingState(swapActionLoadingIds, instanceId, true)
  delete singleActionErrors.value[instanceId]
  try {
    const sequence = (detailSequences.get(instanceId) || 0) + 1
    await loadInstanceDetailConfig(instanceId, true)
    if (!current() || !readCurrent() || sequence !== detailSequences.get(instanceId)) return
    const currentInstance = instances.value.find(item => item.id === instanceId)
    const detail = getDetailConfig(instanceId)
    if (detailConfigErrors.value[instanceId]) throw new Error(detailConfigErrors.value[instanceId])
    if (!currentInstance || !canToggleSwap(currentInstance) || !detail?.swap.available ||
      typeof detail.swap.enabled !== 'boolean' || !Number.isFinite(detail.swap.sizeMb) || detail.swap.sizeMb < 0) return
    const enable = !detail.swap.enabled
    if (enable && detail.swap.sizeMb <= 0) return
    const confirmText = enable
      ? t('instanceConfig.swap.enableConfirmText', { size: formatSwapSize(detail.swap.sizeMb) })
      : t('instanceConfig.swap.disableConfirmText')
    if (!window.confirm(confirmText) || !current() || !readCurrent()) return
    const result = enable ? await api.instances.enableSwap(instanceId) : await api.instances.disableSwap(instanceId)
    if (!current()) return
    if (result.swapEnabled !== enable || !Number.isFinite(result.swapSize) || result.swapSize < 0) throw new Error(t('common.operationFailed'))
    const displayedInstance = instances.value.find(item => item.id === instanceId)
    if (displayedInstance) {
      displayedInstance.swapEnabled = result.swapEnabled
      displayedInstance.swapSize = result.swapSize
    }
    // Retire older config reads before displaying this committed result.
    detailSequences.set(instanceId, (detailSequences.get(instanceId) || 0) + 1)
    delete detailConfigs.value[instanceId]
    toast.success(enable ? t('instanceConfig.swap.enableSuccess') : t('instanceConfig.swap.disableSuccess'))
    if (loading.value) void loadInstances()
    else void loadInstanceDetailConfig(instanceId, true)
  } catch (err: any) {
    if (!current()) return
    singleActionErrors.value[instanceId] = `${instanceName}: ${translateError(err)}`
    toast.error(singleActionErrors.value[instanceId])
  } finally {
    setLoadingState(swapActionLoadingIds, instanceId, false)
  }
}

// 获取显示的IP地址：宿主机实例列表显示内网IPv4，如果是NAT+IPv6则显示内网IPv4和公网IPv6
function getDisplayIp(instance: Instance): { ipv4: string | null; ipv6: string | null } {
  const networkMode = instance.networkMode || instance.network_mode
  const ipv4 = instance.ipv4 || null
  
  // 如果是有独立 IPv6 的模式，显示内网IPv4和公网IPv6
  if (['nat_ipv6', 'ipv6_only'].includes(networkMode || '')) {
    return {
      ipv4: ipv4,
      ipv6: instance.ipv6 || null
    }
  }
  
  // 其他情况只显示内网IPv4
  return {
    ipv4: ipv4,
    ipv6: null
  }
}

function goToInstance(id: number) {
  // 传递 hostId 作为查询参数，用于返回时跳转到宿主机页面
  router.push({
    path: instanceDetailPath(id),
    query: { fromHost: props.hostId.toString() }
  })
}
</script>

<template>
  <div class="space-y-4">
    <SkeletonLoader v-if="loading" type="table" />
    <div v-if="loadError && !loading" role="alert" class="rounded-lg border border-red-300 dark:border-red-800 p-4 space-y-3">
      <p class="text-sm text-red-600 dark:text-red-400 break-words">{{ loadError }}</p>
      <button type="button" class="btn-secondary btn-sm" @click="loadInstances">{{ t('common.retry') }}</button>
    </div>
    <p v-if="recreateError && !showRecreateModal" role="alert" class="text-sm text-red-500 break-words">{{ recreateError }}</p>
    <p v-for="(error, id) in singleActionErrors" :key="id" role="alert" class="text-sm text-red-500 break-words">{{ error }}</p>

    <!-- 搜索栏 - 始终显示 -->
    <div v-if="!loading" class="flex items-center gap-2 flex-wrap">
      <div class="relative flex-1 max-w-md min-w-[200px]">
        <input
          v-model="searchQuery"
          type="text"
          :placeholder="t('admin.hosts.instanceSearchPlaceholder')"
          class="input w-full pl-10 pr-10"
          @keyup.enter="handleSearch"
        />
        <svg
          v-if="searchQuery"
          class="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 cursor-pointer"
          :class="themeStore.isDark ? 'text-gray-400 hover:text-gray-200' : 'text-gray-500 hover:text-gray-700'"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          @click="clearSearch"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
        <svg
          v-else
          class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
          :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-400'"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </div>
      <!-- 状态筛选下拉框 -->
      <div class="relative">
        <select
          v-model="statusFilter"
          class="h-[38px] pl-3 pr-8 rounded-lg border-0 ring-1 ring-inset focus:ring-2 focus:ring-primary cursor-pointer text-sm appearance-none"
          :class="themeStore.isDark 
            ? 'bg-gray-800 text-gray-300 ring-gray-700 hover:ring-gray-600' 
            : 'bg-white text-gray-700 ring-gray-200 hover:ring-gray-300'"
          @change="handleStatusChange"
        >
          <option v-for="opt in statusOptions" :key="opt.value" :value="opt.value">
            {{ t(opt.label) }}
          </option>
        </select>
        <svg 
          class="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none"
          :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-400'"
          fill="none" 
          stroke="currentColor" 
          viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
        </svg>
      </div>
      <button class="btn-primary h-[38px] px-4" @click="handleSearch">
        {{ t('admin.hosts.search') }}
      </button>
      <button 
        v-if="searchQuery" 
        class="btn-ghost h-[38px] px-4" 
        @click="clearSearch"
      >
        {{ t('common.reset') }}
      </button>
      <button class="btn-ghost h-[38px] px-4" @click="toggleSort">
        {{ t('instance.createdAt') }} {{ sortOrder === 'desc' ? '↓' : '↑' }}
      </button>
    </div>

    <template v-if="!loading">
      <!-- 空状态 -->
      <div v-if="!loadError && instances.length === 0" class="card p-12 text-center">
        <svg
          class="w-12 h-12 mx-auto mb-4"
          :class="themeStore.isDark ? 'text-gray-700' : 'text-gray-300'"
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
        <p class="text-themed-secondary">{{ t('admin.hosts.noInstances') }}</p>
      </div>

      <!-- 批量操作栏 - 始终显示（有实例时） -->
      <div
        v-if="instances.length > 0"
        class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3 rounded-lg"
        :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-100'"
      >
        <span class="text-sm text-themed-secondary whitespace-nowrap">
          {{ selectedCount > 0 ? t('admin.hosts.selectedCount', { count: selectedCount }) : t('admin.hosts.noInstanceSelected') }}
        </span>
        <div class="flex items-center gap-2 flex-wrap">
          <button class="btn-ghost btn-sm" :disabled="selectedCount === 0" @click="selectedIds.clear(); selectedIds = new Set()">
            {{ t('common.cancel') }}
          </button>
          <button
            class="btn-secondary btn-sm"
            :disabled="!canStartBatchStatus || showSuspendModal"
            @click="batchSyncStatus"
          >
            <svg v-if="isSyncing" class="w-4 h-4 mr-1 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            <svg v-else class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {{ isSyncing ? t('common.syncing') : t('admin.hosts.batchSyncStatus') }}
          </button>
          <button
            class="btn-sm inline-flex items-center rounded-lg"
            :class="!canStartBatchStatus
              ? (themeStore.isDark ? 'bg-gray-700 text-gray-500 cursor-not-allowed' : 'bg-gray-200 text-gray-400 cursor-not-allowed')
              : (themeStore.isDark ? 'bg-orange-600 hover:bg-orange-700 text-white' : 'bg-orange-500 hover:bg-orange-600 text-white')"
            :disabled="!canStartBatchStatus || showSuspendModal"
            @click="openBatchSuspendModal"
          >
            <svg v-if="isSuspending" class="w-4 h-4 mr-1 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            <svg v-else class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
            {{ t('admin.hosts.batchSuspend') }}
          </button>
          <button
            class="btn-sm inline-flex items-center rounded-lg"
            :class="!canStartBatchStatus
              ? (themeStore.isDark ? 'bg-gray-700 text-gray-500 cursor-not-allowed' : 'bg-gray-200 text-gray-400 cursor-not-allowed')
              : (themeStore.isDark ? 'bg-green-600 hover:bg-green-700 text-white' : 'bg-green-500 hover:bg-green-600 text-white')"
            :disabled="!canStartBatchStatus || showSuspendModal"
            @click="confirmBatchUnsuspend"
          >
            <svg v-if="isUnsuspending" class="w-4 h-4 mr-1 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            <svg v-else class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {{ t('admin.hosts.batchUnsuspend') }}
          </button>
          <button
            class="btn-secondary btn-sm"
            :disabled="selectedCount === 0"
            @click="openBatchConfigForSelection"
          >
            <svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            {{ t('host.batchConfig.button') }}
          </button>
          <button
            class="btn-sm inline-flex items-center rounded-lg"
            :class="[
              selectedCount === 0
                ? (themeStore.isDark ? 'bg-gray-700 text-gray-500 cursor-not-allowed' : 'bg-gray-200 text-gray-400 cursor-not-allowed')
                : (themeStore.isDark ? 'bg-indigo-600 hover:bg-indigo-700 text-white' : 'bg-indigo-500 hover:bg-indigo-600 text-white')
            ]"
            :disabled="selectedCount === 0"
            :title="selectedCount === 0 ? t('host.migrate.noInstancesSelected') : ''"
            @click="selectedCount > 0 && (showMigrateModal = true)"
          >
            <svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
            {{ t('host.migrate.button') }}
          </button>
          <button
            class="btn-sm inline-flex items-center rounded-lg"
            :class="[
              !canOpenGift
                ? (themeStore.isDark ? 'bg-gray-700 text-gray-500 cursor-not-allowed' : 'bg-gray-200 text-gray-400 cursor-not-allowed')
                : (themeStore.isDark ? 'bg-teal-600 hover:bg-teal-700 text-white' : 'bg-teal-500 hover:bg-teal-600 text-white')
            ]"
            :disabled="!canOpenGift || showGiftDaysModal"
            :title="selectedPaidCount === 0 ? t('host.giftDays.noPaidInstances') : ''"
            @click="openGiftDaysModal"
          >
            <svg v-if="isGifting" class="w-4 h-4 mr-1 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            <svg v-else class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" />
            </svg>
            {{ t('host.giftDays.button') }}
          </button>
          <button
            class="btn-secondary btn-sm"
            :disabled="!canOpenNotify || showNotifyModal"
            @click="openNotifyModal"
          >
            <svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            {{ t('host.notify.sendToUsers') }}
          </button>
          <button
            class="btn-danger btn-sm"
            :disabled="selectedCount === 0"
            @click="openBatchDeleteModal"
          >
            <svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            {{ t('admin.hosts.batchDelete') }}
          </button>
        </div>
      </div>

      <div v-if="batchActionError || batchActionFailures.length" role="alert" class="px-4 py-3 text-sm text-red-500 break-words">
        <p v-if="batchActionError">{{ batchActionError }}</p>
        <ul v-if="batchActionFailures.length" class="space-y-1">
          <li v-for="failure in batchActionFailures" :key="failure.id">{{ failure.name }}: {{ failure.error || t('common.operationFailed') }}</li>
        </ul>
      </div>

      <HostInstancesList
        :instances="instances"
        :selected-ids="selectedIds"
        :is-all-selected="isAllSelected"
        :is-partial-selected="isPartialSelected"
        :expanded-instance-id="expandedInstanceId"
        :detail-configs="detailConfigs"
        :detail-config-errors="detailConfigErrors"
        :detail-loading-ids="detailLoadingIds"
        :syncing-instance-ids="syncingInstanceIds"
        :swap-action-loading-ids="swapActionLoadingIds"
        :resetting-traffic-id="resettingTrafficId"
        :recreate-loading="recreateLoading || recreatePreparing"
        :recreate-target-id="recreateTarget?.id ?? null"
        :is-dark="themeStore.isDark"
        :get-paid-icon-type="getPaidIconType"
        :get-status-info="getStatusInfo"
        :format-memory="formatMemory"
        :format-disk="formatDisk"
        :get-display-ip="getDisplayIp"
        :can-recreate-instance="canRecreateInstance"
        :is-instance-expanded="isInstanceExpanded"
        :is-detail-loading="isDetailLoading"
        :is-instance-syncing="(id) => isInstanceSyncing(id) || isSwapActionLoading(id)"
        :is-swap-action-loading="(id) => isSwapActionLoading(id) || isInstanceSyncing(id)"
        :get-detail-config="getDetailConfig"
        :format-money="formatMoney"
        :format-date-time="formatDateTime"
        :format-boolean="formatBoolean"
        :format-bandwidth="formatBandwidth"
        :format-swap-size="formatSwapSize"
        :get-instance-type-label="getInstanceTypeLabel"
        :get-network-mode-label="getNetworkModeLabel"
        :get-expiry-value="getExpiryValue"
        :get-suspend-reason="getSuspendReason"
        :get-traffic-summary="getTrafficSummary"
        :get-traffic-percentage="getTrafficPercentage"
        :get-traffic-bar-class="getTrafficBarClass"
        :get-summary-meta="getSummaryMeta"
        :get-quota-items="getQuotaItems"
        :format-quota-value="formatQuotaValue"
        :can-toggle-swap="canToggleSwap"
        :get-swap-display="getSwapDisplay"
        :get-expiry-summary="getExpirySummary"
        @toggle-select="toggleSelect"
        @toggle-select-all="toggleSelectAll"
        @toggle-expand="(instance) => { void toggleExpandInstance(instance as Instance) }"
        @retry-detail="(id) => { void loadInstanceDetailConfig(id, true) }"
        @sync-instance="(instance) => { void syncSingleInstance(instance as Instance) }"
        @toggle-swap="(instance) => { void toggleInstanceSwap(instance as Instance) }"
        @open-single-config="openSingleConfigModal"
        @open-price="openPriceModal"
        @open-reset-traffic="openResetTrafficModal"
        @open-recreate="(instance) => { void openRecreateModal(instance as Instance) }"
        @open-delete="openSingleDeleteModal"
        @open-detail="goToInstance"
      />

      <!-- 分页 -->
      <div 
        v-if="total > 0" 
        class="flex items-center justify-between px-4 py-3 border-t"
        :class="themeStore.isDark ? 'border-gray-800' : 'border-gray-100'"
      >
        <div class="flex items-center gap-3">
          <span class="text-sm" :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-500'">
            {{ t('admin.users.totalRecords', { count: total }) }}
          </span>
          <select
            v-model="pageSize"
            class="text-sm rounded-md border-0 py-1 pl-2 pr-7 ring-1 ring-inset focus:ring-2 focus:ring-primary cursor-pointer"
            :class="themeStore.isDark 
              ? 'bg-gray-800 text-gray-300 ring-gray-700' 
              : 'bg-gray-50 text-gray-700 ring-gray-200'"
            @change="handlePageSizeChange"
          >
            <option :value="10">10 / {{ t('common.page') }}</option>
            <option :value="30">30 / {{ t('common.page') }}</option>
            <option :value="50">50 / {{ t('common.page') }}</option>
            <option :value="100">100 / {{ t('common.page') }}</option>
          </select>
        </div>
        <div v-if="totalPages > 1" class="flex items-center gap-1">
          <button
            :disabled="page <= 1"
            class="inline-flex items-center justify-center w-8 h-8 rounded-md text-sm transition-colors"
            :class="[
              page <= 1 
                ? 'opacity-40 cursor-not-allowed' 
                : themeStore.isDark 
                  ? 'hover:bg-gray-800 text-gray-400' 
                  : 'hover:bg-gray-100 text-gray-600'
            ]"
            @click="page--; loadInstances()"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div 
            class="flex items-center gap-1 px-3 py-1.5 rounded-md text-sm font-medium"
            :class="themeStore.isDark ? 'bg-gray-800 text-gray-300' : 'bg-gray-100 text-gray-700'"
          >
            <span>{{ page }}</span>
            <span :class="themeStore.isDark ? 'text-gray-600' : 'text-gray-400'">/</span>
            <span :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-500'">{{ totalPages }}</span>
          </div>
          <button
            :disabled="page >= totalPages"
            class="inline-flex items-center justify-center w-8 h-8 rounded-md text-sm transition-colors"
            :class="[
              page >= totalPages 
                ? 'opacity-40 cursor-not-allowed' 
                : themeStore.isDark 
                  ? 'hover:bg-gray-800 text-gray-400' 
                  : 'hover:bg-gray-100 text-gray-600'
            ]"
            @click="page++; loadInstances()"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

      <!-- 批量删除确认弹窗 -->
      <Teleport to="body">
        <Transition name="modal">
          <div v-if="showDeleteModal" class="modal-overlay">
            <div class="modal-backdrop" @click="!isDeleting && (showDeleteModal = false)"></div>
            <div ref="deleteDialog" class="modal-content max-w-md" role="dialog" aria-modal="true" aria-labelledby="host-delete-heading" @keydown="handleDeleteDialogKey">
              <div class="modal-header">
                <h3 id="host-delete-heading" class="modal-title text-error">{{ t('admin.hosts.batchDeleteTitle') }}</h3>
                <button type="button" :aria-label="t('common.close')" :disabled="isDeleting" class="text-themed-muted hover:text-themed" @click="showDeleteModal = false">
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div class="modal-body space-y-4">
                <div class="p-3 rounded-lg" :class="themeStore.isDark ? 'bg-red-500/10' : 'bg-red-50'">
                  <p class="text-sm text-error">{{ t('admin.hosts.batchDeleteWarning') }}</p>
                </div>
                <p class="text-sm text-themed-secondary">
                  {{ t('admin.hosts.batchDeleteConfirm', { count: effectiveDeleteCount }) }}
                </p>
                  
                <div class="space-y-2 text-sm text-themed-secondary">
                  <p>{{ t('admin.hosts.fullDeleteHint') }}</p>
                  <p>{{ t('admin.hosts.databaseOnlyDeleteHint') }}</p>
                </div>
                <fieldset v-if="authStore.user?.role === 'admin'" class="space-y-2" :disabled="isDeleting">
                  <legend class="text-sm font-medium text-themed mb-2">{{ t('admin.hosts.refundHandling') }}</legend>
                  <div class="flex flex-wrap gap-x-5 gap-y-2">
                    <label class="flex min-h-11 items-center gap-2 text-sm text-themed cursor-pointer"><input v-model="deleteRefund" type="radio" :value="false" name="delete-refund" />{{ t('admin.hosts.deleteWithoutRefund') }}</label>
                    <label class="flex min-h-11 items-center gap-2 text-sm text-themed cursor-pointer"><input v-model="deleteRefund" type="radio" :value="true" name="delete-refund" />{{ t('admin.hosts.deleteWithRefund') }}</label>
                  </div>
                </fieldset>
                <div v-if="deletePreviewError && deleteRefund" role="alert" class="space-y-2 text-sm text-error">
                  <p>{{ deletePreviewError }}</p>
                  <button type="button" class="btn-secondary" :disabled="isDeleting || deletePreviewLoading" @click="loadDeletePreview">{{ t('common.retry') }}</button>
                </div>
                <p v-if="deleteRequestError" role="alert" class="text-sm text-error break-words">{{ deleteRequestError }}</p>
                <ul v-if="deleteFailures.length" role="alert" class="space-y-2 text-sm text-error">
                  <li v-for="item in deleteFailures" :key="item.id" class="break-words">{{ item.name }} · {{ item.error }}</li>
                </ul>
                <!-- 退款提示区域 -->
                <div v-if="deletePreviewLoading" class="flex items-center justify-center py-4">
                  <svg class="w-5 h-5 animate-spin text-themed-muted" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                  </svg>
                  <span class="ml-2 text-sm text-themed-muted">{{ t('common.loading') }}</span>
                </div>
                <div v-else-if="deleteRefund && deletePreview && deletePreview.totalRefundAmount > 0" class="space-y-3">
                  <!-- 退款警告 -->
                  <div class="p-3 rounded-lg" :class="themeStore.isDark ? 'bg-orange-500/10' : 'bg-orange-50'">
                    <p class="text-sm text-orange-600 dark:text-orange-400">
                      {{ t('admin.hosts.batchDeleteRefundWarning') }}
                    </p>
                  </div>
                  <!-- 退款明细表格 -->
                  <div class="max-h-40 overflow-y-auto">
                    <table class="w-full text-sm">
                      <thead class="text-themed-muted text-xs">
                        <tr>
                          <th class="text-left py-1">{{ t('admin.hosts.instanceName') }}</th>
                          <th class="text-left py-1">{{ t('admin.hosts.instanceUser') }}</th>
                          <th class="text-right py-1">{{ t('admin.hosts.refundAmount') }}</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr v-for="item in deletePreview.instances.filter(i => i.isPaid && !i.isOwnInstance && i.refundAmount > 0)" :key="item.id" class="border-t border-themed-light">
                          <td class="py-1.5 text-themed">{{ item.name }}</td>
                          <td class="py-1.5 text-themed-secondary">{{ item.username }}</td>
                          <td class="py-1.5 text-right text-orange-600 dark:text-orange-400">¥{{ item.refundAmount.toFixed(2) }}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <!-- 总退款金额 -->
                  <div class="flex justify-between items-center pt-2 border-t border-themed-light">
                    <span class="text-sm font-medium text-themed">{{ t('admin.hosts.batchDeleteRefundTotal') }}</span>
                    <span class="text-base font-bold text-orange-600 dark:text-orange-400">¥{{ deletePreview.totalRefundAmount.toFixed(2) }}</span>
                  </div>
                </div>
                  
                <!-- 删除原因输入框 -->
                <div>
                  <label class="block text-sm font-medium text-themed-secondary mb-1">{{ t('admin.hosts.deleteReason') }}</label>
                  <textarea
                    v-model="deleteReason"
                    :disabled="isDeleting"
                    rows="3"
                    maxlength="500"
                    :placeholder="t('admin.hosts.deleteReasonPlaceholder')"
                    class="input w-full resize-none"
                  />
                  <p class="mt-1 text-xs text-themed-muted">{{ t('admin.hosts.deleteReasonHint') }}</p>
                </div>
              </div>
              <div class="modal-footer">
                <button class="btn-secondary" :disabled="isDeleting" @click="showDeleteModal = false">
                  {{ t('common.cancel') }}
                </button>
                <button
                  class="btn-warning"
                  :disabled="!canDelete"
                  @click="confirmBatchDelete(true)"
                >
                  <svg v-if="deletingMode === 'database'" class="w-4 h-4 mr-1 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                  </svg>
                  {{ deletingMode === 'database' ? t('common.loading') : t('admin.hosts.databaseOnlyDelete') }}
                </button>
                <button
                  class="btn-danger"
                  :disabled="!canDelete"
                  @click="confirmBatchDelete(false)"
                >
                  <svg v-if="deletingMode === 'full'" class="w-4 h-4 mr-1 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                  </svg>
                  {{ deletingMode === 'full' ? t('common.loading') : t('admin.hosts.confirmBatchDelete') }}
                </button>
              </div>
            </div>
          </div>
        </Transition>
      </Teleport>

      <!-- 批量封停确认弹窗 -->
      <Teleport to="body">
        <Transition name="modal">
          <div v-if="showSuspendModal" class="modal-overlay">
            <div class="modal-backdrop" @click="!isSuspending && (showSuspendModal = false)"></div>
            <div ref="suspendDialog" class="modal-content max-w-md" role="dialog" aria-modal="true" :aria-label="t('admin.hosts.batchSuspendTitle')" @keydown="handleSuspendDialogKey">
              <div class="modal-header">
                <h3 class="modal-title text-orange-500">{{ t('admin.hosts.batchSuspendTitle') }}</h3>
                <button class="text-themed-muted hover:text-themed" :disabled="isSuspending" :aria-label="t('common.close')" @click="showSuspendModal = false">
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div class="modal-body space-y-4">
                <div class="p-3 rounded-lg" :class="themeStore.isDark ? 'bg-orange-500/10' : 'bg-orange-50'">
                  <p class="text-sm" :class="themeStore.isDark ? 'text-orange-400' : 'text-orange-600'">{{ t('admin.hosts.batchSuspendWarning') }}</p>
                </div>
                <p class="text-sm text-themed-secondary">
                  {{ t('admin.hosts.batchSuspendConfirm', { count: suspendTargets.length }) }}
                </p>
                <!-- 封停原因输入框 -->
                <div>
                  <label class="block text-sm font-medium text-themed-secondary mb-1">{{ t('admin.hosts.suspendReason') }}</label>
                  <textarea
                    v-model="suspendReason"
                    :disabled="isSuspending"
                    rows="3"
                    maxlength="500"
                    :placeholder="t('admin.hosts.suspendReasonPlaceholder')"
                    class="input w-full resize-none"
                  />
                  <p class="mt-1 text-xs text-themed-muted">{{ suspendReason.length }}/500</p>
                </div>
                <p v-if="batchActionError" role="alert" class="text-sm text-red-500 break-words">{{ batchActionError }}</p>
              </div>
              <div class="modal-footer">
                <button class="btn-secondary" :disabled="isSuspending" @click="showSuspendModal = false">
                  {{ t('common.cancel') }}
                </button>
                <button
                  :disabled="!canConfirmSuspend"
                  class="text-white"
                  :class="themeStore.isDark ? 'bg-orange-600 hover:bg-orange-700 px-4 py-2 rounded-lg' : 'bg-orange-500 hover:bg-orange-600 px-4 py-2 rounded-lg'"
                  @click="confirmBatchSuspend"
                >
                  <svg v-if="isSuspending" class="w-4 h-4 mr-1 inline animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                  </svg>
                  {{ isSuspending ? t('common.loading') : t('admin.hosts.confirmBatchSuspend') }}
                </button>
              </div>
            </div>
          </div>
        </Transition>
      </Teleport>

      <!-- 批量赠送时长弹窗 -->
      <Teleport to="body">
        <Transition name="modal">
          <div v-if="showGiftDaysModal" class="modal-overlay">
            <div class="modal-backdrop" @click="!isGifting && (showGiftDaysModal = false)"></div>
            <div ref="giftDialog" class="modal-content max-w-md" role="dialog" aria-modal="true" :aria-label="t('host.giftDays.title')" @keydown="handleGiftDialogKey">
              <div class="modal-header">
                <h3 class="modal-title text-teal-500">{{ t('host.giftDays.title') }}</h3>
                <button class="text-themed-muted hover:text-themed" :disabled="isGifting" :aria-label="t('common.close')" @click="showGiftDaysModal = false">
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div class="modal-body space-y-4">
                <div class="p-3 rounded-lg" :class="themeStore.isDark ? 'bg-teal-500/10' : 'bg-teal-50'">
                  <p class="text-sm" :class="themeStore.isDark ? 'text-teal-400' : 'text-teal-600'">{{ t('host.giftDays.hint') }}</p>
                </div>
                <p class="text-sm text-themed-secondary">
                  {{ t('host.giftDays.confirm', { count: giftTargets.length }) }}
                </p>
                <div>
                  <label class="block text-sm font-medium text-themed-secondary mb-1">{{ t('host.giftDays.daysLabel') }}</label>
                  <input
                    v-model.number="giftDays"
                    :disabled="isGifting"
                    type="number"
                    step="1"
                    min="1"
                    max="365"
                    class="input w-full"
                  />
                  <p class="mt-1 text-xs text-themed-muted">{{ t('host.giftDays.daysRange') }}</p>
                </div>
                <p v-if="giftError" role="alert" class="text-sm text-red-500 break-words">{{ giftError }}</p>
                <ul v-if="giftFailures.length" role="alert" class="text-sm text-red-500 break-words space-y-1">
                  <li v-for="failure in giftFailures" :key="failure.instanceId">{{ failure.instanceName }}: {{ failure.error || t('common.operationFailed') }}</li>
                </ul>
              </div>
              <div class="modal-footer">
                <button class="btn-secondary" :disabled="isGifting" @click="showGiftDaysModal = false">
                  {{ t('common.cancel') }}
                </button>
                <button
                  :disabled="!canConfirmGift"
                  class="text-white"
                  :class="themeStore.isDark ? 'bg-teal-600 hover:bg-teal-700 px-4 py-2 rounded-lg' : 'bg-teal-500 hover:bg-teal-600 px-4 py-2 rounded-lg'"
                  @click="confirmGiftDays"
                >
                  <svg v-if="isGifting" class="w-4 h-4 mr-1 inline animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                  </svg>
                  {{ isGifting ? t('common.loading') : t('host.giftDays.confirmButton') }}
                </button>
              </div>
            </div>
          </div>
        </Transition>
      </Teleport>

      <!-- 发送通知弹窗 -->
      <Teleport to="body">
        <Transition name="modal">
          <div v-if="showNotifyModal" class="modal-overlay">
            <div class="modal-backdrop" @click="handleCloseNotifyModal"></div>
            <div ref="notifyDialog" class="modal-content max-w-lg" role="dialog" aria-modal="true" :aria-label="t('host.notify.title')" @keydown="handleNotifyDialogKey">
              <div class="modal-header">
                <h3 class="modal-title">{{ t('host.notify.title') }}</h3>
                <button class="text-themed-muted hover:text-themed" :disabled="isSendingNotify" :aria-label="t('common.close')" @click="handleCloseNotifyModal">
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div class="modal-body space-y-4">
                <div class="rounded-xl border px-4 py-3" :class="themeStore.isDark ? 'border-blue-500/30 bg-blue-500/10' : 'border-blue-200 bg-blue-50'">
                  <p class="text-sm font-medium" :class="themeStore.isDark ? 'text-blue-200' : 'text-blue-800'">
                    {{ t('host.notify.hintSelected', { count: notifyTargets.length }) }}
                  </p>
                  <p class="mt-1 text-xs leading-5" :class="themeStore.isDark ? 'text-blue-300/80' : 'text-blue-700/80'">
                    {{ t('host.notify.deliveryHint') }}
                  </p>
                </div>
                <div>
                  <label class="block text-sm font-medium text-themed-secondary mb-1">{{ t('host.notify.messageTitle') }}</label>
                  <input
                    v-model="notifyTitle"
                    type="text"
                    maxlength="200"
                    :placeholder="t('host.notify.titlePlaceholder')"
                    class="input w-full"
                  />
                  <p class="mt-1 text-xs text-themed-muted">{{ notifyTitle.length }}/200</p>
                </div>
                <div>
                  <label class="block text-sm font-medium text-themed-secondary mb-1">{{ t('host.notify.messageContent') }}</label>
                  <textarea
                    v-model="notifyContent"
                    rows="5"
                    maxlength="5000"
                    :placeholder="t('host.notify.contentPlaceholder')"
                    class="input w-full resize-none"
                  />
                  <p class="mt-1 text-xs text-themed-muted">{{ notifyContent.length }}/5000</p>
                </div>
                <label
                  class="flex items-start gap-3 rounded-xl border px-4 py-3 transition-colors cursor-pointer"
                  :class="notifySendEmail
                    ? (themeStore.isDark ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-emerald-200 bg-emerald-50')
                    : (themeStore.isDark ? 'border-gray-700 bg-gray-800/70 hover:border-gray-600' : 'border-gray-200 bg-gray-50 hover:border-gray-300')"
                >
                  <input
                    v-model="notifySendEmail"
                    type="checkbox"
                    class="mt-1 h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <div class="min-w-0">
                    <p class="text-sm font-medium text-themed">{{ t('host.notify.sendEmail') }}</p>
                    <p class="mt-1 text-xs leading-5 text-themed-muted">{{ t('host.notify.sendEmailHint') }}</p>
                  </div>
                </label>
                <p v-if="notifyError" role="alert" class="text-sm text-red-500 break-words">{{ notifyError }}</p>
              </div>
              <div class="modal-footer">
                <button class="btn-secondary" :disabled="isSendingNotify" @click="handleCloseNotifyModal">
                  {{ t('common.cancel') }}
                </button>
                <button
                  class="btn-primary"
                  :disabled="!canSendNotify"
                  @click="sendNotify"
                >
                  <svg v-if="isSendingNotify" class="w-4 h-4 mr-1 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                  </svg>
                  {{ isSendingNotify ? t('common.sending') : t('host.notify.send') }}
                </button>
              </div>
            </div>
          </div>
        </Transition>
      </Teleport>



      <!-- 修改续费价格弹窗 -->
      <Teleport to="body">
        <Transition name="modal">
          <div v-if="showPriceModal" class="modal-overlay">
            <div class="modal-backdrop" @click="!isUpdatingPrice && (showPriceModal = false)"></div>
            <div ref="priceDialog" class="modal-content max-w-md" role="dialog" aria-modal="true" :aria-label="t('host.price.modalTitle')" @keydown="handlePriceDialogKey">
              <div class="modal-header">
                <h3 class="modal-title">{{ t('host.price.modalTitle') }}</h3>
                <button class="text-themed-muted hover:text-themed" :disabled="isUpdatingPrice" :aria-label="t('common.close')" @click="showPriceModal = false">
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div class="modal-body space-y-4">
                <div class="p-3 rounded-lg" :class="themeStore.isDark ? 'bg-blue-500/10' : 'bg-blue-50'">
                  <p class="text-sm" :class="themeStore.isDark ? 'text-blue-300' : 'text-blue-700'">
                    {{ t('host.price.hint', { instance: priceModalTarget?.name }) }}
                  </p>
                </div>
                <div>
                  <label class="block text-sm font-medium text-themed-secondary mb-1">{{ t('host.price.currentPrice') }}</label>
                  <p class="text-lg font-semibold text-themed">¥{{ priceModalTarget?.billingPrice ? Number(priceModalTarget.billingPrice).toFixed(2) : '0.00' }}/{{ t('billing.month') }}</p>
                </div>
                <div>
                  <label class="block text-sm font-medium text-themed-secondary mb-1">{{ t('host.price.newPrice') }}</label>
                  <div class="flex items-center gap-2">
                    <span class="text-themed">¥</span>
                    <input
                      v-model.number="newPriceInput"
                      type="number"
                      min="0"
                      max="99999"
                      step="0.01"
                      class="input flex-1 min-w-0"
                      :placeholder="t('host.price.placeholder')"
                    />
                    <span class="text-themed-muted shrink-0">/{{ t('billing.month') }}</span>
                  </div>
                  <p class="mt-1 text-xs text-themed-muted">{{ t('host.price.effectHint') }}</p>
                </div>
                <p v-if="priceError" role="alert" class="text-sm text-red-500 break-words">{{ priceError }}</p>
              </div>
              <div class="modal-footer">
                <button class="btn-secondary" :disabled="isUpdatingPrice" @click="showPriceModal = false">
                  {{ t('common.cancel') }}
                </button>
                <button
                  class="btn-primary"
                  :disabled="!canUpdatePrice"
                  @click="updateRenewalPrice"
                >
                  <svg v-if="isUpdatingPrice" class="w-4 h-4 mr-1 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                  </svg>
                  {{ isUpdatingPrice ? t('common.saving') : t('common.save') }}
                </button>
              </div>
            </div>
          </div>
        </Transition>
      </Teleport>

      <!-- 重置流量确认弹窗 -->
      <Teleport to="body">
        <Transition name="modal">
          <div v-if="showResetTrafficModal" class="modal-overlay">
            <div class="modal-backdrop" @click="resettingTrafficId === null && (showResetTrafficModal = false)"></div>
            <div ref="resetTrafficDialog" class="modal-content max-w-md" role="dialog" aria-modal="true" :aria-label="t('admin.hosts.resetTrafficTitle')" @keydown="handleResetTrafficDialogKey">
              <div class="modal-header">
                <h3 class="modal-title">{{ t('admin.hosts.resetTrafficTitle') }}</h3>
                <button class="text-themed-muted hover:text-themed" :disabled="resettingTrafficId !== null" :aria-label="t('common.close')" @click="showResetTrafficModal = false">
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div class="modal-body space-y-4">
                <div class="p-3 rounded-lg" :class="themeStore.isDark ? 'bg-amber-500/10' : 'bg-amber-50'">
                  <p class="text-sm" :class="themeStore.isDark ? 'text-amber-300' : 'text-amber-700'">
                    {{ t('admin.hosts.resetTrafficWarning') }}
                  </p>
                </div>
                <p class="text-sm text-themed-secondary">
                  {{ t('admin.hosts.resetTrafficDesc', { instance: resetTrafficTarget?.name }) }}
                </p>
                <p v-if="resetTrafficError" role="alert" class="text-sm text-red-500 break-words">{{ resetTrafficError }}</p>
              </div>
              <div class="modal-footer">
                <button class="btn-secondary" :disabled="resettingTrafficId !== null" @click="showResetTrafficModal = false">
                  {{ t('common.cancel') }}
                </button>
                <button
                  class="btn-primary"
                  :disabled="!canResetTraffic"
                  @click="confirmResetTraffic"
                >
                  <svg v-if="resettingTrafficId !== null" class="w-4 h-4 mr-1 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                  </svg>
                  {{ resettingTrafficId !== null ? t('common.processing') : t('common.confirm') }}
                </button>
              </div>
            </div>
          </div>
        </Transition>
      </Teleport>
    </template>
  </div>

  <!-- 批量修改配置弹窗 -->
  <BatchConfigModal
    v-model:visible="showBatchConfigModal"
    :host-id="hostId"
    :selected-ids="effectiveBatchConfigSelection"
    :total-instance-count="total"
    @success="handleBatchConfigSuccess"
  />

  <!-- 批量迁移实例弹窗 -->
  <MigrateHostModal
    v-model:visible="showMigrateModal"
    :host-id="hostId"
    :host-name="hostName"
    :selected-ids="Array.from(selectedIds)"
    :instances="instances"
    @success="loadInstances"
  />

  <RecreateModal
    :visible="showRecreateModal"
    :loading="recreateLoading"
    :error="recreateError"
    :disabled="!recreateTarget || !recreateTargetIsCurrent(recreateTarget)"
    :available-images="availableImages"
    :ssh-keys="sshKeys"
    @update:visible="handleRecreateModalVisibleChange"
    @submit="doRecreate"
  />
</template>
