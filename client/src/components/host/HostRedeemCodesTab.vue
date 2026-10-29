<script setup lang="ts">
import { ref, onMounted, onActivated, onDeactivated, onUnmounted, watch, computed, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useThemeStore } from '@/stores/theme'
import { useToast } from '@/stores/toast'
import { useAuthStore } from '@/stores/auth'
import { translateError } from '@/utils/errorHandler'
import api from '@/api'

const { t } = useI18n()
const themeStore = useThemeStore()
const toast = useToast()
const authStore = useAuthStore()

interface Props {
  hostId: number
}

const props = defineProps<Props>()
let alive = true
const pageActive = ref(false)
let listSequence = 0
let optionsSequence = 0
let usagesSequence = 0
let contextGeneration = 0
let createGeneration = 0
let deleteGeneration = 0
const sessionKey = computed(() => {
  if (!authStore.token || !authStore.user) return ''
  let identity = authStore.token
  try {
    const payload = JSON.parse(atob(identity.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    if (typeof payload.sid === 'string') identity = payload.sid
  } catch { /* Legacy tokens retain their complete identity. */ }
  return `${authStore.user.id}:${authStore.user.role}:${identity}`
})
const canRead = computed(() => alive && pageActive.value && !!sessionKey.value && Number.isSafeInteger(props.hostId) && props.hostId > 0)

// 兑换码类型
interface RedeemCode {
  id: number
  code: string
  codeType: 'c' | 'r' | 'd' | 't' | 'p'
  codeValue: number
  maxUses: number
  usedCount: number
  expiresAt: string | null
  enabled: boolean
  remark: string | null
  batchId: string | null
  createdAt: string
}

// 状态
const loading = ref(true)
const loadError = ref('')
const optionsError = ref('')
const optionsLoading = ref(false)
const optionsReady = ref(false)
const codes = ref<RedeemCode[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
const enabledFilter = ref<'all' | 'true' | 'false'>('all')

// 创建兑换码
const showCreateModal = ref(false)
const creating = ref(false)
const createError = ref('')
const actionError = ref('')
const togglingId = ref<number | null>(null)
const createForm = ref({
  codeType: 'c' as 'c' | 'r' | 'd' | 't',
  codeValue: 0,
  maxUses: 1,
  expiresAt: '',
  remark: '',
  batchCount: 1
})

// 可选值
const codeOptions = ref<{
  types: Array<{ value: string; label: string; unit: string }>
  ranges: Record<string, { min: number; max: number; unit: string }>
}>({
  types: [
    { value: 'c', label: 'CPU', unit: '%' },
    { value: 'r', label: 'Memory', unit: 'MB' },
    { value: 'd', label: 'Disk', unit: 'MB' },
    { value: 't', label: 'Traffic', unit: 'GB' }
  ],
  ranges: {
    c: { min: 1, max: 100, unit: '%' },
    r: { min: 1, max: 65536, unit: 'MB' },
    d: { min: 1, max: 1048576, unit: 'MB' },
    t: { min: 1, max: 10240, unit: 'GB' }
  }
})

// 批量创建结果
const showBatchResultModal = ref(false)
const batchCreatedCodes = ref<string[]>([])
const batchCreatedBatchId = ref<string | null>(null)
const copiedBatch = ref(false)
const batchCopyError = ref('')
let batchCopySequence = 0
let batchDialogGeneration = 0
let batchCopyTimer: ReturnType<typeof setTimeout> | undefined
const batchResultDialog = ref<HTMLElement | null>(null)
let batchReturnFocus: HTMLElement | null = null
watch(showBatchResultModal, async open => {
  batchDialogGeneration++
  batchCopySequence++
  clearTimeout(batchCopyTimer)
  copiedBatch.value = false
  batchCopyError.value = ''
  if (open) batchReturnFocus = writeReturnFocus ?? document.activeElement as HTMLElement | null
  await nextTick()
  if (open && showBatchResultModal.value) batchResultDialog.value?.focus()
  else if (!showBatchResultModal.value && batchReturnFocus?.isConnected) batchReturnFocus.focus()
}, { flush: 'sync' })
function handleBatchResultKey(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); showBatchResultModal.value = false; return }
  if (event.key !== 'Tab') return
  const controls = [...(batchResultDialog.value?.querySelectorAll<HTMLElement>('button,[tabindex="0"]') ?? [])]
    .filter(element => !element.matches(':disabled') && element.getClientRects().length > 0)
  const first = controls[0], last = controls.at(-1)
  if (!first) { event.preventDefault(); batchResultDialog.value?.focus(); return }
  if (event.shiftKey && (document.activeElement === first || document.activeElement === batchResultDialog.value)) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && (document.activeElement === last || document.activeElement === batchResultDialog.value)) { event.preventDefault(); first.focus() }
}

// 使用记录
const showUsagesModal = ref(false)
const usagesLoading = ref(false)
const selectedCode = ref<RedeemCode | null>(null)
const usages = ref<Array<{
  id: number
  user: { id: number; username: string }
  instance: { id: number; name: string }
  usedAt: string
}>>([])
const usagesTotal = ref(0)
const usagesPage = ref(1)
const usagesError = ref('')
const usagesDialog = ref<HTMLElement | null>(null)
let usagesReturnFocus: HTMLElement | null = null
watch(showUsagesModal, async open => {
  if (open) usagesReturnFocus = document.activeElement as HTMLElement | null
  await nextTick()
  if (open && showUsagesModal.value) usagesDialog.value?.focus()
  else if (!showUsagesModal.value && usagesReturnFocus?.isConnected) usagesReturnFocus.focus()
})
function handleUsagesKey(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); showUsagesModal.value = false; return }
  if (event.key !== 'Tab') return
  const controls = [...(usagesDialog.value?.querySelectorAll<HTMLElement>('button,[tabindex="0"]') ?? [])]
    .filter(element => !element.matches(':disabled') && element.getClientRects().length > 0)
  const first = controls[0], last = controls.at(-1)
  if (!first) { event.preventDefault(); usagesDialog.value?.focus(); return }
  if (event.shiftKey && (document.activeElement === first || document.activeElement === usagesDialog.value)) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && (document.activeElement === last || document.activeElement === usagesDialog.value)) { event.preventDefault(); first.focus() }
}

// 选择和删除
const selectedIds = ref<Set<number>>(new Set())
const showDeleteModal = ref(false)
const deleting = ref(false)
const deleteTargets = ref<Array<{ id: number; code: string }>>([])
const writeBusy = computed(() => creating.value || deleting.value || togglingId.value !== null)
const canStartWrite = computed(() => canRead.value && !loading.value && !writeBusy.value)
watch(showCreateModal, () => { createGeneration++ }, { flush: 'sync' })
watch(showDeleteModal, () => { deleteGeneration++ }, { flush: 'sync' })
function captureWrite(kind: 'create' | 'toggle' | 'delete') {
  const hostId = props.hostId, session = sessionKey.value, generation = contextGeneration
  const dialogGeneration = kind === 'create' ? createGeneration : deleteGeneration
  return { hostId, current: () => canRead.value && hostId === props.hostId && session === sessionKey.value && generation === contextGeneration &&
    (kind === 'toggle' || kind === 'create' && showCreateModal.value && dialogGeneration === createGeneration ||
      kind === 'delete' && showDeleteModal.value && dialogGeneration === deleteGeneration) }
}
function invalidateEarlierList() { listSequence++; loading.value = false }
function closeCreateModal() { if (!creating.value) showCreateModal.value = false }
function closeDeleteModal() { if (!deleting.value) showDeleteModal.value = false }
const createDialog = ref<HTMLElement | null>(null)
const deleteDialog = ref<HTMLElement | null>(null)
let writeReturnFocus: HTMLElement | null = null
watch([showCreateModal, showDeleteModal], async ([createOpen, deleteOpen], [wasCreateOpen, wasDeleteOpen]) => {
  if ((createOpen || deleteOpen) && !wasCreateOpen && !wasDeleteOpen) writeReturnFocus = document.activeElement as HTMLElement | null
  await nextTick()
  if (createOpen && showCreateModal.value) createDialog.value?.focus()
  else if (deleteOpen && showDeleteModal.value) deleteDialog.value?.focus()
  else if (!showCreateModal.value && !showDeleteModal.value && !showBatchResultModal.value && writeReturnFocus?.isConnected) writeReturnFocus.focus()
})
function handleWriteDialogKey(event: KeyboardEvent, kind: 'create' | 'delete') {
  if (event.key === 'Escape') { event.preventDefault(); kind === 'create' ? closeCreateModal() : closeDeleteModal(); return }
  if (event.key !== 'Tab') return
  const dialog = kind === 'create' ? createDialog.value : deleteDialog.value
  const controls = [...(dialog?.querySelectorAll<HTMLElement>('button,input,select,[tabindex="0"]') ?? [])]
    .filter(element => !element.matches(':disabled') && element.getClientRects().length > 0)
  const first = controls[0], last = controls.at(-1)
  if (!first) { event.preventDefault(); dialog?.focus(); return }
  if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) { event.preventDefault(); first.focus() }
}

// 复制状态
const copiedCode = ref<number | null>(null)
const copyError = ref('')
let copySequence = 0
let copyTimer: ReturnType<typeof setTimeout> | undefined
function resetCopyFeedback() {
  copySequence++
  batchCopySequence++
  clearTimeout(copyTimer)
  clearTimeout(batchCopyTimer)
  copiedCode.value = null
  copiedBatch.value = false
  copyError.value = ''
  batchCopyError.value = ''
}

function resetUsages() {
  usagesSequence++
  usages.value = []
  usagesTotal.value = 0
  usagesPage.value = 1
  usagesLoading.value = false
  usagesError.value = ''
}
watch([showUsagesModal, () => selectedCode.value?.id], resetUsages, { flush: 'sync' })
function resetReadContext() {
  contextGeneration++
  resetCopyFeedback()
  listSequence++
  optionsSequence++
  codes.value = []
  total.value = 0
  page.value = 1
  selectedIds.value.clear()
  loading.value = false
  loadError.value = ''
  optionsLoading.value = false
  optionsReady.value = false
  optionsError.value = ''
  createError.value = ''
  actionError.value = ''
  deleteTargets.value = []
  showCreateModal.value = false
  showBatchResultModal.value = false
  batchCreatedCodes.value = []
  batchCreatedBatchId.value = null
  copiedBatch.value = false
  copiedCode.value = null
  showDeleteModal.value = false
  showUsagesModal.value = false
  selectedCode.value = null
  resetUsages()
}
watch([() => props.hostId, sessionKey], () => { resetReadContext(); void loadCodes(); void loadOptions() }, { flush: 'sync' })
function activateReads() {
  if (!alive || pageActive.value) return
  pageActive.value = true
  void loadCodes()
  void loadOptions()
}
onMounted(activateReads)
onActivated(activateReads)
onDeactivated(() => { pageActive.value = false; resetReadContext() })
onUnmounted(() => { alive = false; pageActive.value = false; resetReadContext() })

watch(enabledFilter, () => {
  contextGeneration++
  resetCopyFeedback()
  page.value = 1
  selectedIds.value.clear()
  showDeleteModal.value = false
  showUsagesModal.value = false
  void loadCodes()
}, { flush: 'sync' })

// 计算选中所有
const allSelected = computed(() => {
  return codes.value.length > 0 && codes.value.every(c => selectedIds.value.has(c.id))
})

// 获取当前类型的范围限制
const currentRange = computed(() => {
  return codeOptions.value.ranges[createForm.value.codeType] || { min: 1, max: 100, unit: '' }
})

async function loadCodes() {
  if (!canRead.value || !Number.isSafeInteger(page.value) || page.value < 1 || !['all', 'true', 'false'].includes(enabledFilter.value)) return
  const sequence = ++listSequence, hostId = props.hostId, session = sessionKey.value
  const requestedPage = page.value, filter = enabledFilter.value
  const current = () => canRead.value && sequence === listSequence && hostId === props.hostId && session === sessionKey.value &&
    requestedPage === page.value && filter === enabledFilter.value
  loading.value = true
  loadError.value = ''
  try {
    const params: { limit: number; offset: number; enabled?: boolean } = {
      limit: pageSize,
      offset: (requestedPage - 1) * pageSize
    }
    if (enabledFilter.value !== 'all') {
      params.enabled = enabledFilter.value === 'true'
    }
    const res = await api.hosts.getRedeemCodes(hostId, params)
    if (!current()) return
    if (!Array.isArray(res?.codes) || !Number.isSafeInteger(res.total) || res.total < 0 || res.codes.length > pageSize ||
      res.codes.some(code => !code || !Number.isSafeInteger(code.id) || code.id <= 0 || typeof code.code !== 'string' || !code.code ||
        !['c', 'r', 'd', 't', 'p'].includes(code.codeType) || !Number.isSafeInteger(code.codeValue) || code.codeValue <= 0 ||
        !Number.isSafeInteger(code.maxUses) || code.maxUses < 1 || !Number.isSafeInteger(code.usedCount) || code.usedCount < 0 ||
        typeof code.enabled !== 'boolean' || (filter !== 'all' && code.enabled !== (filter === 'true')) ||
        typeof code.createdAt !== 'string' || !Number.isFinite(Date.parse(code.createdAt)) ||
        (code.expiresAt !== null && (typeof code.expiresAt !== 'string' || !Number.isFinite(Date.parse(code.expiresAt)))) ||
        (code.remark !== null && typeof code.remark !== 'string') || (code.batchId !== null && typeof code.batchId !== 'string')) ||
      new Set(res.codes.map(code => code.id)).size !== res.codes.length) throw new Error(t('redeemCodes.loadFailed'))
    const lastPage = Math.max(1, Math.ceil(res.total / pageSize))
    if (requestedPage > lastPage) {
      page.value = lastPage
      selectedIds.value.clear()
      await loadCodes()
      return
    }
    codes.value = res.codes
    total.value = res.total
    selectedIds.value = new Set([...selectedIds.value].filter(id => res.codes.some(code => code.id === id)))
  } catch (err: unknown) {
    if (!current()) return
    codes.value = []
    total.value = 0
    selectedIds.value.clear()
    loadError.value = t('redeemCodes.loadFailed') + ': ' + translateError(err)
  } finally {
    if (current()) loading.value = false
  }
}

async function loadOptions() {
  if (!canRead.value) return
  const sequence = ++optionsSequence, hostId = props.hostId, session = sessionKey.value
  const current = () => canRead.value && sequence === optionsSequence && hostId === props.hostId && session === sessionKey.value
  optionsLoading.value = true
  optionsReady.value = false
  optionsError.value = ''
  try {
    const res = await api.hosts.getRedeemCodeOptions()
    if (!current()) return
    const types = ['c', 'r', 'd', 't']
    if (!Array.isArray(res?.types) || res.types.length !== types.length || !res.ranges ||
      types.some(type => res.types.filter(item => item?.value === type && typeof item.label === 'string' && typeof item.unit === 'string').length !== 1 ||
        !res.ranges[type] || !Number.isSafeInteger(res.ranges[type].min) || res.ranges[type].min < 1 ||
        !Number.isSafeInteger(res.ranges[type].max) || res.ranges[type].max < res.ranges[type].min || typeof res.ranges[type].unit !== 'string')) {
      throw new Error(t('redeemCodes.loadFailed'))
    }
    codeOptions.value = res
    optionsReady.value = true
  } catch (err: unknown) {
    if (!current()) return
    optionsError.value = t('redeemCodes.loadFailed') + ': ' + translateError(err)
  } finally {
    if (current()) optionsLoading.value = false
  }
}

function openCreateModal() {
  if (!canStartWrite.value || !optionsReady.value || showCreateModal.value || showDeleteModal.value || showBatchResultModal.value) return
  createError.value = ''
  createForm.value = {
    codeType: 'c',
    codeValue: codeOptions.value.ranges.c.min,
    maxUses: 1,
    expiresAt: '',
    remark: '',
    batchCount: 1
  }
  showCreateModal.value = true
}

// 当类型变化时重置数值为该类型的最小值
watch(() => createForm.value.codeType, () => {
  const range = codeOptions.value.ranges[createForm.value.codeType]
  if (range) {
    createForm.value.codeValue = range.min
  }
}, { flush: 'sync' })

async function handleCreate() {
  if (!canStartWrite.value || !optionsReady.value || !showCreateModal.value) return
  const context = captureWrite('create')
  const draft = { ...createForm.value }
  createError.value = ''
  if (!createForm.value.codeValue) {
    createError.value = t('redeemCodes.selectValue')
    return
  }

  // 验证数值是否在允许范围内
  const range = currentRange.value
  if (createForm.value.codeValue < range.min || createForm.value.codeValue > range.max) {
    createError.value = t('redeemCodes.valueOutOfRange', { min: range.min, max: range.max })
    return
  }

  // 确保是整数
  if (!Number.isSafeInteger(draft.codeValue)) {
    createError.value = t('redeemCodes.valueMustBeInteger')
    return
  }
  if (!['c', 'r', 'd', 't'].includes(draft.codeType) || !Number.isSafeInteger(draft.batchCount) || draft.batchCount < 1 || draft.batchCount > 100 ||
    (draft.batchCount === 1 && (!Number.isSafeInteger(draft.maxUses) || draft.maxUses < 1 || draft.maxUses > 1000)) ||
    typeof draft.remark !== 'string' || draft.remark.trim().length > 200 || [...draft.remark.trim()].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
    typeof draft.expiresAt !== 'string' || (draft.expiresAt !== '' && !Number.isFinite(Date.parse(draft.expiresAt)))) {
    createError.value = t('redeemCodes.invalidCreateFields')
    return
  }

  creating.value = true
  try {
    const data: Parameters<typeof api.hosts.createRedeemCode>[1] = {
      codeType: draft.codeType,
      codeValue: draft.codeValue,
      remark: draft.remark.trim() || undefined
    }

    if (draft.expiresAt) {
      data.expiresAt = new Date(draft.expiresAt).toISOString()
    }

    if (draft.batchCount > 1) {
      data.batchCount = draft.batchCount
    } else {
      data.maxUses = draft.maxUses
    }

    const res = await api.hosts.createRedeemCode(context.hostId, data)
    if (!context.current()) return
    if (!res || typeof res.message !== 'string' || !res.message || (draft.batchCount > 1
      ? !Array.isArray(res.codes) || res.codes.length !== draft.batchCount || res.codes.some(code => typeof code !== 'string' || !code) ||
        new Set(res.codes).size !== res.codes.length || res.count !== draft.batchCount || typeof res.batchId !== 'string' || !res.batchId
      : typeof res.code !== 'string' || !res.code || !Number.isSafeInteger(res.id) || (res.id ?? 0) <= 0)) throw new Error(t('common.operationFailed'))
    invalidateEarlierList()
    
    if (res.codes && res.codes.length > 0) {
      // 批量创建成功
      batchCreatedCodes.value = res.codes
      batchCreatedBatchId.value = res.batchId || null
      showCreateModal.value = false
      showBatchResultModal.value = true
      toast.success(t('redeemCodes.batchCreateSuccess', { count: res.count }))
    } else if (res.code) {
      // 单个创建成功
      toast.success(t('redeemCodes.createSuccess'))
      showCreateModal.value = false
    }
    
    await loadCodes()
  } catch (err: unknown) {
    if (context.current()) createError.value = translateError(err)
  } finally {
    creating.value = false
  }
}

async function toggleEnabled(code: RedeemCode) {
  if (!canStartWrite.value || showCreateModal.value || showDeleteModal.value || !codes.value.includes(code)) return
  const context = captureWrite('toggle'), targetId = code.id, targetCode = code.code, enabled = !code.enabled
  togglingId.value = targetId
  actionError.value = ''
  try {
    const res = await api.hosts.updateRedeemCode(context.hostId, targetId, {
      enabled
    })
    if (!context.current()) return
    if (!res || typeof res.message !== 'string' || !res.message) throw new Error(t('common.operationFailed'))
    invalidateEarlierList()
    const currentCode = codes.value.find(item => item.id === targetId && item.code === targetCode)
    if (currentCode) currentCode.enabled = enabled
    toast.success(t(enabled ? 'redeemCodes.enabled' : 'redeemCodes.disabled'))
    await loadCodes()
  } catch (err: unknown) {
    if (context.current()) actionError.value = translateError(err)
  } finally {
    togglingId.value = null
  }
}

function openUsages(code: RedeemCode) {
  if (!canRead.value || loading.value || !codes.value.includes(code)) return
  resetUsages()
  selectedCode.value = code
  usages.value = []
  usagesTotal.value = 0
  showUsagesModal.value = true
  loadUsages()
}

async function loadUsages() {
  if (!canRead.value || !showUsagesModal.value || !selectedCode.value || !Number.isSafeInteger(selectedCode.value.id) || selectedCode.value.id <= 0) return
  const sequence = ++usagesSequence, hostId = props.hostId, session = sessionKey.value, codeId = selectedCode.value.id, requestedPage = usagesPage.value
  const current = () => canRead.value && sequence === usagesSequence && showUsagesModal.value && hostId === props.hostId &&
    session === sessionKey.value && selectedCode.value?.id === codeId && requestedPage === usagesPage.value
  usagesLoading.value = true
  usagesError.value = ''
  try {
    const res = await api.hosts.getRedeemCodeUsages(hostId, codeId, { limit: pageSize, offset: (requestedPage - 1) * pageSize })
    if (!current()) return
    if (!Array.isArray(res?.usages) || !Number.isSafeInteger(res.total) || res.total < 0 || res.usages.length > pageSize ||
      res.usages.some(usage => !usage || !Number.isSafeInteger(usage.id) || usage.id <= 0 ||
        !usage.user || !Number.isSafeInteger(usage.user.id) || usage.user.id <= 0 || typeof usage.user.username !== 'string' ||
        !usage.instance || !Number.isSafeInteger(usage.instance.id) || usage.instance.id <= 0 || typeof usage.instance.name !== 'string' ||
        typeof usage.usedAt !== 'string' || !Number.isFinite(Date.parse(usage.usedAt))) ||
      new Set(res.usages.map(usage => usage.id)).size !== res.usages.length) throw new Error(t('redeemCodes.loadFailed'))
    const lastPage = Math.max(1, Math.ceil(res.total / pageSize))
    if (requestedPage > lastPage) { usagesPage.value = lastPage; await loadUsages(); return }
    usages.value = res.usages
    usagesTotal.value = res.total
  } catch (err: unknown) {
    if (!current()) return
    usages.value = []
    usagesTotal.value = 0
    usagesError.value = t('redeemCodes.loadFailed') + ': ' + translateError(err)
  } finally {
    if (current()) usagesLoading.value = false
  }
}
function changeUsagesPage(direction: number) {
  const nextPage = usagesPage.value + direction
  if (!canRead.value || usagesLoading.value || !Number.isSafeInteger(nextPage) || nextPage < 1 || nextPage > Math.ceil(usagesTotal.value / pageSize)) return
  usagesPage.value = nextPage
  void loadUsages()
}

function toggleSelect(id: number) {
  if (!canRead.value || loading.value || !codes.value.some(code => code.id === id)) return
  if (selectedIds.value.has(id)) {
    selectedIds.value.delete(id)
  } else {
    selectedIds.value.add(id)
  }
}

function toggleSelectAll() {
  if (!canRead.value || loading.value) return
  if (allSelected.value) {
    selectedIds.value.clear()
  } else {
    codes.value.forEach(c => selectedIds.value.add(c.id))
  }
}

function openDeleteModal() {
  if (!canStartWrite.value || showCreateModal.value || showDeleteModal.value || selectedIds.value.size === 0) return
  const targets = codes.value.filter(code => selectedIds.value.has(code.id))
  if (targets.length !== selectedIds.value.size) return
  deleteTargets.value = targets.map(({ id, code }) => ({ id, code }))
  actionError.value = ''
  showDeleteModal.value = true
}

async function confirmDelete() {
  if (!canStartWrite.value || !showDeleteModal.value || !deleteTargets.value.length ||
    deleteTargets.value.some(target => !codes.value.some(code => code.id === target.id && code.code === target.code))) return
  const context = captureWrite('delete'), targets = deleteTargets.value.map(target => ({ ...target }))
  actionError.value = ''
  deleting.value = true
  try {
    const res = await api.hosts.batchDeleteRedeemCodes(context.hostId, targets.map(target => target.id))
    if (!context.current()) return
    if (!res || typeof res.message !== 'string' || !res.message || res.count !== targets.length) throw new Error(t('common.operationFailed'))
    invalidateEarlierList()
    toast.success(t('redeemCodes.deleteSuccess', { count: res.count }))
    selectedIds.value = new Set([...selectedIds.value].filter(id => !targets.some(target => target.id === id)))
    showDeleteModal.value = false
    await loadCodes()
  } catch (err: unknown) {
    if (!context.current()) return
    actionError.value = translateError(err)
    // Used or concurrently removed codes can leave a partial server result.
    // Refresh their actual state before another explicit deletion attempt.
    if (err && typeof err === 'object' && 'code' in err && ['REDEEM_CODE_USED', 'REDEEM_CODE_NOT_FOUND'].includes(String(err.code))) {
      invalidateEarlierList()
      showDeleteModal.value = false
      await loadCodes()
    }
  } finally {
    deleting.value = false
  }
}

async function copyCode(code: string, id: number) {
  if (!canRead.value || loading.value || !codes.value.some(item => item.id === id && item.code === code)) return
  const sequence = ++copySequence, generation = contextGeneration, hostId = props.hostId, session = sessionKey.value
  const current = () => canRead.value && sequence === copySequence && generation === contextGeneration && hostId === props.hostId &&
    session === sessionKey.value && codes.value.some(item => item.id === id && item.code === code)
  clearTimeout(copyTimer)
  copiedCode.value = null
  copyError.value = ''
  try {
    await navigator.clipboard.writeText(code)
    if (!current()) return
    copiedCode.value = id
    copyTimer = setTimeout(() => { if (current()) copiedCode.value = null }, 2000)
  } catch {
    if (current()) copyError.value = t('common.copyFailed')
  }
}

async function copyBatchCodes() {
  if (!canRead.value || !showBatchResultModal.value || !batchCreatedCodes.value.length) return
  const sequence = ++batchCopySequence, generation = contextGeneration, dialogGeneration = batchDialogGeneration
  const hostId = props.hostId, session = sessionKey.value, text = batchCreatedCodes.value.join('\n'), batchId = batchCreatedBatchId.value
  const current = () => canRead.value && showBatchResultModal.value && sequence === batchCopySequence && generation === contextGeneration &&
    dialogGeneration === batchDialogGeneration && hostId === props.hostId && session === sessionKey.value &&
    batchId === batchCreatedBatchId.value && text === batchCreatedCodes.value.join('\n')
  clearTimeout(batchCopyTimer)
  copiedBatch.value = false
  batchCopyError.value = ''
  try {
    await navigator.clipboard.writeText(text)
    if (!current()) return
    copiedBatch.value = true
    batchCopyTimer = setTimeout(() => { if (current()) copiedBatch.value = false }, 2000)
  } catch {
    if (current()) batchCopyError.value = t('common.copyFailed')
  }
}

function getTypeLabel(type: string): string {
  const typeInfo = codeOptions.value.types.find(t => t.value === type)
  return typeInfo ? `${typeInfo.label}` : type
}

function getTypeUnit(type: string): string {
  const typeInfo = codeOptions.value.types.find(t => t.value === type)
  return typeInfo?.unit || ''
}

function formatValue(type: string, value: number): string {
  const unit = getTypeUnit(type)
  if (type === 'r' || type === 'd') {
    if (value >= 1024) {
      const gb = value / 1024
      return gb % 1 === 0 ? `${gb.toFixed(0)} GB` : `${gb.toFixed(1)} GB`
    }
  }
  return `${value} ${unit}`
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString()
}

function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false
  return new Date(expiresAt) < new Date()
}

function goToPrevPage() {
  if (canRead.value && !loading.value && page.value > 1) {
    contextGeneration++
    resetCopyFeedback()
    page.value--
    selectedIds.value.clear()
    showDeleteModal.value = false
    showUsagesModal.value = false
    loadCodes()
  }
}

function goToNextPage() {
  if (canRead.value && !loading.value && page.value * pageSize < total.value) {
    contextGeneration++
    resetCopyFeedback()
    page.value++
    selectedIds.value.clear()
    showDeleteModal.value = false
    showUsagesModal.value = false
    loadCodes()
  }
}
</script>

<template>
  <div class="space-y-4">
    <p v-if="copyError" role="alert" class="text-sm text-red-500 break-words">{{ copyError }}</p>
    <!-- 工具栏 -->
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex flex-wrap items-center gap-3">
        <label class="md:hidden flex items-center gap-2 text-sm text-themed-secondary">
          <input type="checkbox" :checked="allSelected" :disabled="!canRead || loading || !codes.length" :aria-label="t('redeemCodes.selectAll')" @change="toggleSelectAll">
          {{ t('common.all') }}
        </label>
        <!-- 筛选器 -->
        <select
          v-model="enabledFilter"
          :aria-label="t('redeemCodes.filterAll')"
          :disabled="!canRead"
          :class="[
            'px-3 py-1.5 text-sm rounded-lg border focus:outline-none focus:ring-1',
            themeStore.isDark
              ? 'bg-gray-800 border-gray-700 text-gray-200 focus:ring-blue-500'
              : 'bg-white border-gray-300 text-gray-700 focus:ring-blue-500'
          ]"
        >
          <option value="all">{{ t('redeemCodes.filterAll') }}</option>
          <option value="true">{{ t('redeemCodes.filterEnabled') }}</option>
          <option value="false">{{ t('redeemCodes.filterDisabled') }}</option>
        </select>

        <!-- 批量删除按钮 -->
        <button
          v-if="selectedIds.size > 0"
          :disabled="!canStartWrite || showCreateModal || showDeleteModal"
          :class="[
            'flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors',
            themeStore.isDark
              ? 'bg-red-600/20 text-red-400 hover:bg-red-600/30'
              : 'bg-red-50 text-red-600 hover:bg-red-100'
          ]"
          @click="openDeleteModal"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
          {{ t('redeemCodes.deleteSelected', { count: selectedIds.size }) }}
        </button>
      </div>

      <!-- 创建按钮 -->
      <button
        :disabled="!canStartWrite || !optionsReady || showCreateModal || showDeleteModal || showBatchResultModal"
        :class="[
          'flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg transition-colors',
          themeStore.isDark
            ? 'bg-accent text-white dark:text-black hover:opacity-90'
            : 'bg-accent text-white dark:text-black hover:opacity-90'
        ]"
        @click="openCreateModal"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 4v16m8-8H4" />
        </svg>
        {{ t('redeemCodes.create') }}
      </button>
    </div>

    <p v-if="actionError && !showDeleteModal" role="alert" class="text-sm text-red-500 break-words">{{ actionError }}</p>
    <div v-if="optionsError" role="alert" data-options-error class="text-sm text-red-500 break-words">
      {{ optionsError }}
      <button class="btn-secondary ml-2" :disabled="!canRead || optionsLoading" @click="loadOptions">{{ t('common.retry') }}</button>
    </div>

    <!-- 列表 -->
    <div
      :class="[
        'rounded-xl border overflow-hidden',
        themeStore.isDark ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'
      ]"
    >
      <!-- 加载状态 -->
      <div v-if="loading" class="p-8 text-center">
        <div class="inline-block w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
      </div>

      <div v-else-if="loadError" role="alert" data-list-error class="p-6 text-sm text-red-500 break-words">
        {{ loadError }}
        <button class="btn-secondary ml-2" :disabled="!canRead" @click="loadCodes">{{ t('common.retry') }}</button>
      </div>

      <!-- 空状态 -->
      <div v-else-if="codes.length === 0" class="p-8 text-center">
        <svg class="w-12 h-12 mx-auto mb-3" :class="themeStore.isDark ? 'text-gray-600' : 'text-gray-400'" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
        </svg>
        <p :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-500'">{{ t('redeemCodes.empty') }}</p>
      </div>

      <!-- 列表内容 -->
      <template v-else>
        <table class="redeem-table w-full table-fixed">
          <colgroup><col style="width: 6%"><col style="width: 34%"><col style="width: 16%"><col style="width: 12%"><col style="width: 20%"><col style="width: 12%"></colgroup>
          <thead :class="themeStore.isDark ? 'bg-gray-800/50' : 'bg-gray-50'">
            <tr>
              <th class="px-4 py-3 text-left">
                <input
                  type="checkbox"
                  :checked="allSelected"
                  :aria-label="t('redeemCodes.selectAll')"
                  class="rounded"
                  @change="toggleSelectAll"
                />
              </th>
              <th :class="['px-4 py-3 text-left text-xs font-medium uppercase tracking-wider', themeStore.isDark ? 'text-gray-400' : 'text-gray-500']">
                {{ t('redeemCodes.code') }}
              </th>
              <th :class="['px-4 py-3 text-left text-xs font-medium uppercase tracking-wider', themeStore.isDark ? 'text-gray-400' : 'text-gray-500']">
                {{ t('redeemCodes.type') }}
              </th>
              <th :class="['px-4 py-3 text-left text-xs font-medium uppercase tracking-wider', themeStore.isDark ? 'text-gray-400' : 'text-gray-500']">
                {{ t('redeemCodes.usage') }}
              </th>
              <th :class="['px-4 py-3 text-left text-xs font-medium uppercase tracking-wider', themeStore.isDark ? 'text-gray-400' : 'text-gray-500']">
                {{ t('redeemCodes.status') }}
              </th>
              <th :class="['px-4 py-3 text-right text-xs font-medium uppercase tracking-wider', themeStore.isDark ? 'text-gray-400' : 'text-gray-500']">
                {{ t('redeemCodes.actions') }}
              </th>
            </tr>
          </thead>
          <tbody :class="themeStore.isDark ? 'divide-gray-800' : 'divide-gray-200'" class="divide-y">
            <tr v-for="code in codes" :key="code.id" :class="themeStore.isDark ? 'hover:bg-gray-800/50' : 'hover:bg-gray-50'">
              <td class="px-4 py-3">
                <input
                  type="checkbox"
                  :checked="selectedIds.has(code.id)"
                  :aria-label="code.code"
                  class="rounded"
                  @change="toggleSelect(code.id)"
                />
              </td>
              <td class="px-4 py-3">
                <div class="flex items-center gap-2 min-w-0">
                  <code :class="['text-sm font-mono break-all min-w-0', themeStore.isDark ? 'text-gray-300' : 'text-gray-700']">{{ code.code }}</code>
                  <button
                    :class="[
                      'p-1 rounded transition-colors shrink-0',
                      themeStore.isDark ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-gray-200 text-gray-500'
                    ]"
                    :title="t('common.copy')"
                    :aria-label="t('common.copy')"
                    @click="copyCode(code.code, code.id)"
                  >
                    <svg v-if="copiedCode === code.id" class="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                    </svg>
                    <svg v-else class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </button>
                </div>
                <p v-if="code.remark" :class="['text-xs mt-1', themeStore.isDark ? 'text-gray-500' : 'text-gray-400']">{{ code.remark }}</p>
                <p v-if="code.batchId" :class="['text-xs mt-0.5', themeStore.isDark ? 'text-blue-500' : 'text-blue-500']">
                  {{ t('redeemCodes.batch') }}: {{ code.batchId.slice(0, 8) }}
                </p>
              </td>
              <td class="px-4 py-3" :data-label="t('redeemCodes.type')">
                <span :class="['inline-flex items-center px-2 py-0.5 rounded text-xs font-medium', themeStore.isDark ? 'bg-blue-900/30 text-blue-400' : 'bg-blue-100 text-blue-800']">
                  {{ getTypeLabel(code.codeType) }} +{{ formatValue(code.codeType, code.codeValue) }}
                </span>
              </td>
              <td class="px-4 py-3" :data-label="t('redeemCodes.usage')">
                <button
                  :class="[
                    'text-sm hover:underline',
                    themeStore.isDark ? 'text-gray-300' : 'text-gray-700'
                  ]"
                  @click="openUsages(code)"
                >
                  {{ code.usedCount }} / {{ code.maxUses }}
                </button>
              </td>
              <td class="px-4 py-3" :data-label="t('redeemCodes.status')">
                <div class="flex flex-col gap-1">
                  <span
                    v-if="isExpired(code.expiresAt)"
                    :class="['inline-flex items-center px-2 py-0.5 rounded text-xs font-medium', themeStore.isDark ? 'bg-gray-700 text-gray-400' : 'bg-gray-100 text-gray-600']"
                  >
                    {{ t('redeemCodes.expired') }}
                  </span>
                  <span
                    v-else-if="code.usedCount >= code.maxUses"
                    :class="['inline-flex items-center px-2 py-0.5 rounded text-xs font-medium', themeStore.isDark ? 'bg-gray-700 text-gray-400' : 'bg-gray-100 text-gray-600']"
                  >
                    {{ t('redeemCodes.exhausted') }}
                  </span>
                  <span
                    v-else-if="code.enabled"
                    :class="['inline-flex items-center px-2 py-0.5 rounded text-xs font-medium', themeStore.isDark ? 'bg-green-900/30 text-green-400' : 'bg-green-100 text-green-800']"
                  >
                    {{ t('redeemCodes.active') }}
                  </span>
                  <span
                    v-else
                    :class="['inline-flex items-center px-2 py-0.5 rounded text-xs font-medium', themeStore.isDark ? 'bg-yellow-900/30 text-yellow-400' : 'bg-yellow-100 text-yellow-800']"
                  >
                    {{ t('redeemCodes.paused') }}
                  </span>
                  <span v-if="code.expiresAt && !isExpired(code.expiresAt)" :class="['text-xs', themeStore.isDark ? 'text-gray-500' : 'text-gray-400']">
                    {{ t('redeemCodes.expiresAt') }}: {{ formatDate(code.expiresAt) }}
                  </span>
                </div>
              </td>
              <td class="px-4 py-3 text-right" :data-label="t('redeemCodes.actions')">
                <button
                  :disabled="!canStartWrite || showCreateModal || showDeleteModal"
                  :class="[
                    'px-2 py-1 text-xs font-medium rounded transition-colors',
                    code.enabled
                      ? (themeStore.isDark ? 'bg-yellow-600/20 text-yellow-400 hover:bg-yellow-600/30' : 'bg-yellow-50 text-yellow-600 hover:bg-yellow-100')
                      : (themeStore.isDark ? 'bg-green-600/20 text-green-400 hover:bg-green-600/30' : 'bg-green-50 text-green-600 hover:bg-green-100')
                  ]"
                  @click="toggleEnabled(code)"
                >
                  {{ code.enabled ? t('redeemCodes.disable') : t('redeemCodes.enable') }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>

        <!-- 分页 -->
        <div v-if="total > pageSize" :class="['flex items-center justify-between px-4 py-3 border-t', themeStore.isDark ? 'border-gray-800' : 'border-gray-200']">
          <span :class="['text-sm', themeStore.isDark ? 'text-gray-400' : 'text-gray-500']">
            {{ t('common.pageInfo', { current: page, total: Math.ceil(total / pageSize), count: total }) }}
          </span>
          <div class="flex gap-2">
            <button
              :disabled="!canRead || loading || page <= 1"
              :class="[
                'px-3 py-1 text-sm rounded-lg transition-colors',
                page <= 1
                  ? 'opacity-50 cursor-not-allowed'
                  : (themeStore.isDark ? 'hover:bg-gray-800' : 'hover:bg-gray-100'),
                themeStore.isDark ? 'text-gray-400' : 'text-gray-600'
              ]"
              @click="goToPrevPage"
            >
              {{ t('common.previous') }}
            </button>
            <button
              :disabled="!canRead || loading || page * pageSize >= total"
              :class="[
                'px-3 py-1 text-sm rounded-lg transition-colors',
                page * pageSize >= total
                  ? 'opacity-50 cursor-not-allowed'
                  : (themeStore.isDark ? 'hover:bg-gray-800' : 'hover:bg-gray-100'),
                themeStore.isDark ? 'text-gray-400' : 'text-gray-600'
              ]"
              @click="goToNextPage"
            >
              {{ t('common.next') }}
            </button>
          </div>
        </div>
      </template>
    </div>

    <!-- 创建兑换码弹窗 -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showCreateModal" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" @click.self="closeCreateModal">
          <div ref="createDialog" role="dialog" aria-modal="true" :aria-label="t('redeemCodes.createTitle')" tabindex="-1" :class="['w-full max-w-md max-h-[90vh] overflow-y-auto rounded-xl shadow-xl', themeStore.isDark ? 'bg-gray-900' : 'bg-white']" @keydown="handleWriteDialogKey($event, 'create')">
            <div :class="['flex items-center justify-between px-6 py-4 border-b', themeStore.isDark ? 'border-gray-800' : 'border-gray-200']">
              <h3 :class="['text-lg font-semibold', themeStore.isDark ? 'text-white' : 'text-gray-900']">{{ t('redeemCodes.createTitle') }}</h3>
              <button :disabled="creating" :aria-label="t('common.close')" :class="themeStore.isDark ? 'text-gray-400 hover:text-gray-200' : 'text-gray-500 hover:text-gray-700'" @click="closeCreateModal">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <fieldset class="px-6 py-4 space-y-4 min-w-0" :disabled="creating">
              <!-- 资源类型 -->
              <div>
                <label for="redeem-resource-type" :class="['block text-sm font-medium mb-1', themeStore.isDark ? 'text-gray-300' : 'text-gray-700']">{{ t('redeemCodes.resourceType') }}</label>
                <select
                  id="redeem-resource-type"
                  v-model="createForm.codeType"
                  :class="[
                    'w-full px-3 py-2 rounded-lg border focus:outline-none focus:ring-1',
                    themeStore.isDark
                      ? 'bg-gray-800 border-gray-700 text-white focus:ring-blue-500'
                      : 'bg-white border-gray-300 text-gray-900 focus:ring-blue-500'
                  ]"
                >
                  <option v-for="type in codeOptions.types" :key="type.value" :value="type.value">
                    {{ type.label }} ({{ type.unit }})
                  </option>
                </select>
              </div>

              <!-- 资源数值 -->
              <div>
                <label for="redeem-resource-value" :class="['block text-sm font-medium mb-1', themeStore.isDark ? 'text-gray-300' : 'text-gray-700']">{{ t('redeemCodes.resourceValue') }}</label>
                <div class="flex items-center gap-2">
                  <input
                    id="redeem-resource-value"
                    v-model.number="createForm.codeValue"
                    type="number"
                    :min="currentRange.min"
                    :max="currentRange.max"
                    :class="[
                      'flex-1 min-w-0 px-3 py-2 rounded-lg border focus:outline-none focus:ring-1',
                      themeStore.isDark
                        ? 'bg-gray-800 border-gray-700 text-white focus:ring-blue-500'
                        : 'bg-white border-gray-300 text-gray-900 focus:ring-blue-500'
                    ]"
                  />
                  <span :class="['text-sm font-medium', themeStore.isDark ? 'text-gray-400' : 'text-gray-500']">
                    {{ currentRange.unit }}
                  </span>
                </div>
                <p :class="['text-xs mt-1', themeStore.isDark ? 'text-gray-500' : 'text-gray-400']">
                  {{ t('redeemCodes.valueRange', { min: currentRange.min, max: currentRange.max }) }}
                </p>
              </div>

              <!-- 批量数量 -->
              <div>
                <label for="redeem-batch-count" :class="['block text-sm font-medium mb-1', themeStore.isDark ? 'text-gray-300' : 'text-gray-700']">{{ t('redeemCodes.batchCount') }}</label>
                <input
                  id="redeem-batch-count"
                  v-model.number="createForm.batchCount"
                  type="number"
                  min="1"
                  max="100"
                  :class="[
                    'w-full px-3 py-2 rounded-lg border focus:outline-none focus:ring-1',
                    themeStore.isDark
                      ? 'bg-gray-800 border-gray-700 text-white focus:ring-blue-500'
                      : 'bg-white border-gray-300 text-gray-900 focus:ring-blue-500'
                  ]"
                />
                <p :class="['text-xs mt-1', themeStore.isDark ? 'text-gray-500' : 'text-gray-400']">{{ t('redeemCodes.batchCountHint') }}</p>
              </div>

              <!-- 最大使用次数（仅单个创建时显示） -->
              <div v-if="createForm.batchCount <= 1">
                <label for="redeem-max-uses" :class="['block text-sm font-medium mb-1', themeStore.isDark ? 'text-gray-300' : 'text-gray-700']">{{ t('redeemCodes.maxUses') }}</label>
                <input
                  id="redeem-max-uses"
                  v-model.number="createForm.maxUses"
                  type="number"
                  min="1"
                  max="1000"
                  :class="[
                    'w-full px-3 py-2 rounded-lg border focus:outline-none focus:ring-1',
                    themeStore.isDark
                      ? 'bg-gray-800 border-gray-700 text-white focus:ring-blue-500'
                      : 'bg-white border-gray-300 text-gray-900 focus:ring-blue-500'
                  ]"
                />
              </div>

              <!-- 过期时间 -->
              <div>
                <label for="redeem-expires-at" :class="['block text-sm font-medium mb-1', themeStore.isDark ? 'text-gray-300' : 'text-gray-700']">{{ t('redeemCodes.expiresAt') }}</label>
                <input
                  id="redeem-expires-at"
                  v-model="createForm.expiresAt"
                  type="datetime-local"
                  :class="[
                    'w-full px-3 py-2 rounded-lg border focus:outline-none focus:ring-1',
                    themeStore.isDark
                      ? 'bg-gray-800 border-gray-700 text-white focus:ring-blue-500'
                      : 'bg-white border-gray-300 text-gray-900 focus:ring-blue-500'
                  ]"
                />
                <p :class="['text-xs mt-1', themeStore.isDark ? 'text-gray-500' : 'text-gray-400']">{{ t('redeemCodes.expiresAtHint') }}</p>
              </div>

              <!-- 备注 -->
              <div>
                <label for="redeem-remark" :class="['block text-sm font-medium mb-1', themeStore.isDark ? 'text-gray-300' : 'text-gray-700']">{{ t('redeemCodes.remark') }}</label>
                <input
                  id="redeem-remark"
                  v-model="createForm.remark"
                  type="text"
                  maxlength="200"
                  :placeholder="t('redeemCodes.remarkPlaceholder')"
                  :class="[
                    'w-full px-3 py-2 rounded-lg border focus:outline-none focus:ring-1',
                    themeStore.isDark
                      ? 'bg-gray-800 border-gray-700 text-white placeholder-gray-500 focus:ring-blue-500'
                      : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400 focus:ring-blue-500'
                  ]"
                />
              </div>
            </fieldset>
            <p v-if="createError" role="alert" class="px-6 pb-3 text-sm text-red-500 break-words">{{ createError }}</p>

            <div :class="['flex justify-end gap-3 px-6 py-4 border-t', themeStore.isDark ? 'border-gray-800' : 'border-gray-200']">
              <button
                :class="[
                  'px-4 py-2 text-sm font-medium rounded-lg transition-colors',
                  themeStore.isDark
                    ? 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                ]"
                :disabled="creating"
                @click="closeCreateModal"
              >
                {{ t('common.cancel') }}
              </button>
              <button
                :disabled="!canStartWrite || !optionsReady"
                :class="[
                  'px-4 py-2 text-sm font-medium rounded-lg transition-colors',
                  creating ? 'opacity-50 cursor-not-allowed' : '',
                  themeStore.isDark
                    ? 'bg-accent text-white dark:text-black hover:opacity-90'
                    : 'bg-accent text-white dark:text-black hover:opacity-90'
                ]"
                @click="handleCreate"
              >
                <span v-if="creating" class="flex items-center gap-2">
                  <span class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                  {{ t('common.creating') }}
                </span>
                <span v-else>{{ t('common.create') }}</span>
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 批量创建结果弹窗 -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showBatchResultModal" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" @click.self="showBatchResultModal = false">
          <div ref="batchResultDialog" data-batch-result role="dialog" aria-modal="true" :aria-label="t('redeemCodes.batchResult')" tabindex="-1" :class="['w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden rounded-xl shadow-xl', themeStore.isDark ? 'bg-gray-900' : 'bg-white']" @keydown="handleBatchResultKey">
            <div :class="['flex shrink-0 items-center justify-between px-6 py-4 border-b', themeStore.isDark ? 'border-gray-800' : 'border-gray-200']">
              <h3 :class="['text-lg font-semibold', themeStore.isDark ? 'text-white' : 'text-gray-900']">{{ t('redeemCodes.batchResult') }}</h3>
              <button :aria-label="t('common.close')" :class="themeStore.isDark ? 'text-gray-400 hover:text-gray-200' : 'text-gray-500 hover:text-gray-700'" @click="showBatchResultModal = false">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div class="px-6 py-4 min-h-0 overflow-y-auto">
              <!-- 批次 ID -->
              <div v-if="batchCreatedBatchId" :class="['mb-4 p-3 rounded-lg', themeStore.isDark ? 'bg-blue-900/30' : 'bg-blue-50']">
                <p :class="['text-sm', themeStore.isDark ? 'text-blue-400' : 'text-blue-600']">
                  <span class="font-medium">{{ t('redeemCodes.batchId') }}:</span>
                  <code :class="['ml-2 px-2 py-0.5 rounded break-all', themeStore.isDark ? 'bg-blue-900/50' : 'bg-blue-100']">{{ batchCreatedBatchId }}</code>
                </p>
                <p :class="['text-xs mt-1', themeStore.isDark ? 'text-blue-500' : 'text-blue-500']">
                  {{ t('redeemCodes.batchLimitHint') }}
                </p>
              </div>
              <div :class="['p-4 rounded-lg font-mono text-sm max-h-80 overflow-y-auto', themeStore.isDark ? 'bg-gray-800 text-gray-300' : 'bg-gray-100 text-gray-700']">
                <div v-for="(code, index) in batchCreatedCodes" :key="index" class="py-0.5 break-all">{{ code }}</div>
              </div>
            </div>

            <p v-if="batchCopyError" role="alert" class="shrink-0 px-6 pb-3 text-sm text-red-500 break-words">{{ batchCopyError }}</p>
            <div :class="['flex shrink-0 justify-end gap-3 px-6 py-4 border-t', themeStore.isDark ? 'border-gray-800' : 'border-gray-200']">
              <button
                :class="[
                  'flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors',
                  copiedBatch
                    ? (themeStore.isDark ? 'bg-green-600 text-white' : 'bg-green-600 text-white')
                    : (themeStore.isDark ? 'bg-accent text-white dark:text-black hover:opacity-90' : 'bg-accent text-white dark:text-black hover:opacity-90')
                ]"
                @click="copyBatchCodes"
              >
                <svg v-if="copiedBatch" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                </svg>
                <svg v-else class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                {{ copiedBatch ? t('common.copied') : t('redeemCodes.copyAll') }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 使用记录弹窗 -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showUsagesModal" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" @click.self="showUsagesModal = false">
          <div ref="usagesDialog" role="dialog" aria-modal="true" :aria-label="t('redeemCodes.usageRecords')" tabindex="-1" :class="['w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl shadow-xl', themeStore.isDark ? 'bg-gray-900' : 'bg-white']" @keydown="handleUsagesKey">
            <div :class="['flex items-center justify-between px-6 py-4 border-b', themeStore.isDark ? 'border-gray-800' : 'border-gray-200']">
              <h3 :class="['text-lg font-semibold', themeStore.isDark ? 'text-white' : 'text-gray-900']">{{ t('redeemCodes.usageRecords') }}</h3>
              <button :aria-label="t('common.close')" :class="themeStore.isDark ? 'text-gray-400 hover:text-gray-200' : 'text-gray-500 hover:text-gray-700'" @click="showUsagesModal = false">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div class="px-6 py-4">
              <div v-if="usagesLoading" class="py-8 text-center">
                <div class="inline-block w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
              </div>
              <div v-else-if="usagesError" role="alert" data-usages-error class="py-4 text-sm text-red-500 break-words">
                {{ usagesError }}
                <button class="btn-secondary ml-2" :disabled="!canRead" @click="loadUsages">{{ t('common.retry') }}</button>
              </div>
              <div v-else-if="usages.length === 0" class="py-8 text-center">
                <p :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-500'">{{ t('redeemCodes.noUsages') }}</p>
              </div>
              <div v-else class="space-y-3 max-h-80 overflow-y-auto">
                <div
                  v-for="usage in usages"
                  :key="usage.id"
                  :class="['flex flex-wrap items-center justify-between gap-2 p-3 rounded-lg break-words', themeStore.isDark ? 'bg-gray-800' : 'bg-gray-100']"
                >
                  <div class="min-w-0">
                    <p :class="['font-medium', themeStore.isDark ? 'text-white' : 'text-gray-900']">{{ usage.user.username }}</p>
                    <p :class="['text-sm', themeStore.isDark ? 'text-gray-400' : 'text-gray-500']">{{ usage.instance.name }}</p>
                  </div>
                  <span :class="['text-sm', themeStore.isDark ? 'text-gray-500' : 'text-gray-400']">{{ formatDate(usage.usedAt) }}</span>
                </div>
              </div>
              <div v-if="usagesTotal > pageSize" class="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm text-themed-secondary">
                <span>{{ t('common.pageInfo', { current: usagesPage, total: Math.ceil(usagesTotal / pageSize), count: usagesTotal }) }}</span>
                <div class="flex gap-2">
                  <button class="btn-secondary btn-sm" :disabled="!canRead || usagesLoading || usagesPage <= 1" @click="changeUsagesPage(-1)">{{ t('common.previous') }}</button>
                  <button class="btn-secondary btn-sm" :disabled="!canRead || usagesLoading || usagesPage * pageSize >= usagesTotal" @click="changeUsagesPage(1)">{{ t('common.next') }}</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 删除确认弹窗 -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showDeleteModal" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" @click.self="closeDeleteModal">
          <div ref="deleteDialog" role="dialog" aria-modal="true" :aria-label="t('redeemCodes.confirmDelete')" tabindex="-1" :class="['w-full max-w-sm max-h-[90vh] overflow-y-auto rounded-xl shadow-xl', themeStore.isDark ? 'bg-gray-900' : 'bg-white']" @keydown="handleWriteDialogKey($event, 'delete')">
            <div class="p-6 text-center">
              <div :class="['w-12 h-12 mx-auto mb-4 rounded-full flex items-center justify-center', themeStore.isDark ? 'bg-red-900/30' : 'bg-red-100']">
                <svg class="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h3 :class="['text-lg font-semibold mb-2', themeStore.isDark ? 'text-white' : 'text-gray-900']">{{ t('redeemCodes.confirmDelete') }}</h3>
              <p :class="['text-sm mb-6', themeStore.isDark ? 'text-gray-400' : 'text-gray-500']">
                {{ t('redeemCodes.confirmDeleteMessage', { count: deleteTargets.length }) }}
              </p>
              <p v-if="actionError" role="alert" class="mb-4 text-sm text-red-500 break-words">{{ actionError }}</p>
              <div class="flex gap-3">
                <button
                  :class="[
                    'flex-1 px-4 py-2 text-sm font-medium rounded-lg transition-colors',
                    themeStore.isDark
                      ? 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  ]"
                  :disabled="deleting"
                  @click="closeDeleteModal"
                >
                  {{ t('common.cancel') }}
                </button>
                <button
                  :disabled="!canStartWrite"
                  :class="[
                    'flex-1 px-4 py-2 text-sm font-medium rounded-lg transition-colors',
                    deleting ? 'opacity-50 cursor-not-allowed' : '',
                    themeStore.isDark
                      ? 'bg-red-600 text-white hover:bg-red-500'
                      : 'bg-red-600 text-white hover:bg-red-700'
                  ]"
                  @click="confirmDelete"
                >
                  {{ deleting ? t('common.deleting') : t('common.delete') }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.redeem-table td { overflow-wrap: anywhere; }
@media (max-width: 767px) {
  .redeem-table colgroup,
  .redeem-table thead { display: none; }
  .redeem-table,
  .redeem-table tbody { display: block; }
  .redeem-table tr { display: grid; grid-template-columns: 2rem minmax(0, 1fr); padding: 0.75rem; }
  .redeem-table td { display: block; min-width: 0; padding: 0.5rem 0; }
  .redeem-table td:nth-child(n + 3) { grid-column: 2; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5rem; text-align: start; }
  .redeem-table td[data-label]::before { content: attr(data-label); color: var(--text-secondary); font-size: 0.75rem; }
}
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
</style>
