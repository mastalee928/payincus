<script setup lang="ts">
import { ref, onMounted, onActivated, onDeactivated, onUnmounted, computed, watch, nextTick } from 'vue'
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

interface StoragePool {
  name: string
  driver: string
  description: string
  status: string
  purpose?: 'instance_data' | 'instance_storage' | null
  config: Record<string, string>
  usedBy: number
  space?: { used: number; total: number } | null
}

interface Props {
  hostId: number
}

const props = defineProps<Props>()
let alive = true
const pageActive = ref(false)
let readSequence = 0
let contextGeneration = 0
let createGeneration = 0
let editGeneration = 0
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

const loading = ref(true)
const loadError = ref('')
const loadWarning = ref('')
const pools = ref<StoragePool[]>([])
const showCreateModal = ref(false)
const creating = ref(false)
const deleting = ref<string | null>(null)

// 编辑模态框状态
const showEditModal = ref(false)
const editing = ref(false)
const createError = ref('')
const editError = ref('')
const deleteError = ref('')
const createDialog = ref<HTMLElement | null>(null)
const editDialog = ref<HTMLElement | null>(null)
let returnFocus: HTMLElement | null = null
watch([showCreateModal, showEditModal], async ([createOpen, editOpen], [wasCreateOpen, wasEditOpen]) => {
  if ((createOpen || editOpen) && !wasCreateOpen && !wasEditOpen) returnFocus = document.activeElement as HTMLElement | null
  await nextTick()
  if (createOpen && showCreateModal.value) createDialog.value?.focus()
  else if (editOpen && showEditModal.value) editDialog.value?.focus()
  else if (!showCreateModal.value && !showEditModal.value && returnFocus?.isConnected) returnFocus.focus()
})
function handleDialogKey(event: KeyboardEvent, kind: 'create' | 'edit') {
  if (event.key === 'Escape') { event.preventDefault(); kind === 'create' ? closeCreateModal() : closeEditModal(); return }
  if (event.key !== 'Tab') return
  const dialog = kind === 'create' ? createDialog.value : editDialog.value
  const controls = [...(dialog?.querySelectorAll<HTMLElement>('button,input,select,textarea,[tabindex="0"]') ?? [])]
    .filter(element => !element.matches(':disabled') && element.getClientRects().length > 0)
  const first = controls[0], last = controls.at(-1)
  if (!first) { event.preventDefault(); dialog?.focus(); return }
  if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) { event.preventDefault(); first.focus() }
}
const writeBusy = computed(() => creating.value || editing.value || deleting.value !== null)
const canStartWrite = computed(() => canRead.value && !loading.value && !writeBusy.value)
let editingPoolName: string | null = null
watch(showCreateModal, () => { createGeneration++ }, { flush: 'sync' })
watch(showEditModal, () => { editGeneration++ }, { flush: 'sync' })
function captureWrite(kind: 'create' | 'edit' | 'delete') {
  const hostId = props.hostId, session = sessionKey.value, generation = contextGeneration
  const dialogGeneration = kind === 'create' ? createGeneration : editGeneration
  return { hostId, current: () => canRead.value && generation === contextGeneration && hostId === props.hostId && session === sessionKey.value &&
    (kind === 'delete' || kind === 'create' && showCreateModal.value && dialogGeneration === createGeneration ||
      kind === 'edit' && showEditModal.value && dialogGeneration === editGeneration) }
}
function closeCreateModal() { if (!creating.value) showCreateModal.value = false }
function closeEditModal() { if (!editing.value) showEditModal.value = false }
function invalidateEarlierReads() { readSequence++; loading.value = false }
const editForm = ref({
  name: '',
  driver: '',
  currentSize: '',
  newSizeValue: '',
  newSizeUnit: 'GiB' as 'GiB' | 'TiB',
  description: '',
  purpose: 'instance_data' as 'instance_data' | 'instance_storage'
})

// 单位选项
const sizeUnits = ['GiB', 'TiB']

// 创建模式：create = 创建新存储池，import = 导入已有存储池
const createMode = ref<'create' | 'import'>('create')

// 导入模式下的驱动类型
const importDriver = ref<'zfs' | 'lvm' | 'btrfs' | 'dir'>('zfs')
// 底层存储源名称（如 ZFS 池名、LVM VG 名、目录路径）
const importSource = ref('')

// 表单
const form = ref({
  name: '',
  driver: 'lvm' as 'zfs' | 'lvm' | 'btrfs' | 'dir',
  source: '',
  sizeValue: '',
  sizeUnit: 'GiB' as 'GiB' | 'TiB',
  zfsPoolName: '',
  lvmVgName: '',
  lvmUseThinpool: true,
  description: '',
  purpose: 'instance_data' as 'instance_data' | 'instance_storage'
})

// 驱动选项
const driverOptions = [
  { value: 'lvm', label: 'LVM', desc: 'admin.hosts.storage.lvmDesc' },
  { value: 'zfs', label: 'ZFS', desc: 'admin.hosts.storage.zfsDesc' },
  { value: 'btrfs', label: 'Btrfs', desc: 'admin.hosts.storage.btrfsDesc' },
  { value: 'dir', label: 'DIR', desc: 'admin.hosts.storage.dirDesc' }
]

const selectedDriverDesc = computed(() => {
  const opt = driverOptions.find(d => d.value === form.value.driver)
  return opt ? t(opt.desc) : ''
})

// 使用 Loop 文件模式（不指定 source）- ZFS/LVM/Btrfs 都支持
const useLoop = ref(false)

watch(() => form.value.driver, () => {
  // 重置部分字段
  form.value.source = ''
  form.value.sizeValue = ''
  form.value.sizeUnit = 'GiB'
  form.value.zfsPoolName = ''
  form.value.lvmVgName = ''
  useLoop.value = false
})

watch(useLoop, (enabled) => {
  if (enabled) {
    form.value.source = ''
  } else {
    form.value.sizeValue = ''
    form.value.sizeUnit = 'GiB'
  }
})

// 切换创建模式时重置表单
watch(createMode, () => {
  form.value.source = ''
  form.value.sizeValue = ''
  form.value.zfsPoolName = ''
  form.value.lvmVgName = ''
  useLoop.value = false
  importSource.value = ''
  importDriver.value = 'zfs'
})

function resetReadContext() {
  contextGeneration++
  readSequence++
  pools.value = []
  loading.value = false
  loadError.value = ''
  loadWarning.value = ''
  showCreateModal.value = false
  showEditModal.value = false
  createError.value = ''
  editError.value = ''
  deleteError.value = ''
  editingPoolName = null
}
watch([() => props.hostId, sessionKey], () => { resetReadContext(); void loadPools() }, { flush: 'sync' })
function activateReads() {
  if (!alive || pageActive.value) return
  pageActive.value = true
  void loadPools()
}
onMounted(activateReads)
onActivated(activateReads)
onDeactivated(() => { pageActive.value = false; resetReadContext() })
onUnmounted(() => { alive = false; pageActive.value = false; resetReadContext() })

async function loadPools() {
  if (!canRead.value) return
  const sequence = ++readSequence, hostId = props.hostId, session = sessionKey.value
  const current = () => canRead.value && sequence === readSequence && hostId === props.hostId && session === sessionKey.value
  loading.value = true
  loadError.value = ''
  loadWarning.value = ''
  try {
    const res = await api.hosts.getStoragePools(hostId)
    if (!current()) return
    if (!Array.isArray(res?.pools) || res.pools.some(pool => !pool || typeof pool.name !== 'string' || !pool.name ||
      typeof pool.driver !== 'string' || typeof pool.status !== 'string' || !pool.config || typeof pool.config !== 'object' ||
      Array.isArray(pool.config) || !Number.isSafeInteger(pool.usedBy) || pool.usedBy < 0) ||
      new Set(res.pools.map(pool => pool.name)).size !== res.pools.length) throw new Error(t('admin.hosts.storage.loadFailed'))
    pools.value = res.pools
    loadWarning.value = typeof res.warning === 'string' ? res.warning : ''
  } catch (err: unknown) {
    if (!current()) return
    pools.value = []
    loadError.value = t('admin.hosts.storage.loadFailed') + ': ' + translateError(err)
  } finally {
    if (current()) loading.value = false
  }
}

function openCreateModal() {
  if (!canStartWrite.value || showEditModal.value || showCreateModal.value) return
  createError.value = ''
  createMode.value = 'create'
  form.value = {
    name: '',
    driver: 'lvm',
    source: '',
    sizeValue: '',
    sizeUnit: 'GiB',
    zfsPoolName: '',
    lvmVgName: '',
    lvmUseThinpool: true,
    description: '',
    purpose: 'instance_data'
  }
  useLoop.value = false
  importDriver.value = 'zfs'
  importSource.value = ''
  showCreateModal.value = true
}

async function createPool() {
  if (!canStartWrite.value || !showCreateModal.value) return
  const context = captureWrite('create')
  createError.value = ''
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(form.value.name)) {
    createError.value = t('admin.hosts.storage.nameRequired')
    return
  }

  creating.value = true
  try {
    // 模式2：导入已有存储池
    if (createMode.value === 'import') {
      // Btrfs 和 DIR 类型必须提供底层存储源
      if ((importDriver.value === 'btrfs' || importDriver.value === 'dir') && !importSource.value) {
        createError.value = t('admin.hosts.storage.importSourceRequired')
        return
      }
      
      const result = await api.hosts.createStoragePool(context.hostId, {
        name: form.value.name,
        driver: importDriver.value,
        existingSource: importSource.value || undefined,
        description: form.value.description || undefined,
        purpose: form.value.purpose,
        useExisting: true
      })
      if (!context.current()) return
      if (!result || typeof result.message !== 'string' || !result.message) throw new Error(t('admin.hosts.storage.createFailed'))
      invalidateEarlierReads()
      if (result.imported) {
        toast.success(t('admin.hosts.storage.importSuccess'))
      } else {
        toast.success(t('admin.hosts.storage.linkSuccess'))
      }
      showCreateModal.value = false
      await loadPools()
      return
    }

    // 模式1：创建新存储池
    // 验证 - ZFS/LVM/Btrfs 都支持 Loop 文件
    const supportsLoop = ['zfs', 'lvm', 'btrfs'].includes(form.value.driver)
    if (supportsLoop) {
      if (!useLoop.value && !form.value.source) {
        createError.value = t('admin.hosts.storage.sourceRequired')
        return
      }
      if (useLoop.value && !form.value.sizeValue) {
        createError.value = t('admin.hosts.storage.sizeRequired')
        return
      }
    } else if (form.value.driver === 'dir') {
      if (!form.value.source) {
        createError.value = t('admin.hosts.storage.pathRequired')
        return
      }
    }

    // 组合大小字符串
    const sizeStr = (supportsLoop && useLoop.value && form.value.sizeValue)
      ? `${form.value.sizeValue}${form.value.sizeUnit}`
      : undefined

    const result = await api.hosts.createStoragePool(context.hostId, {
      name: form.value.name,
      driver: form.value.driver,
      source: supportsLoop && useLoop.value ? undefined : form.value.source || undefined,
      size: sizeStr,
      useLoop: supportsLoop ? useLoop.value : undefined,
      zfsPoolName: form.value.driver === 'zfs' ? form.value.zfsPoolName || undefined : undefined,
      lvmVgName: form.value.driver === 'lvm' ? form.value.lvmVgName || undefined : undefined,
      lvmUseThinpool: form.value.driver === 'lvm' ? form.value.lvmUseThinpool : undefined,
      description: form.value.description || undefined,
      purpose: form.value.purpose
    })
    if (!context.current()) return
    if (!result || typeof result.message !== 'string' || !result.message) throw new Error(t('admin.hosts.storage.createFailed'))
    invalidateEarlierReads()
    toast.success(t('admin.hosts.storage.createSuccess'))
    showCreateModal.value = false
    await loadPools()
  } catch (err: unknown) {
    if (!context.current()) return
    createError.value = t('admin.hosts.storage.createFailed') + ': ' + translateError(err)
  } finally {
    creating.value = false
  }
}

async function deletePool(poolName: string) {
  const pool = pools.value.find(pool => pool.name === poolName)
  if (!canStartWrite.value || showCreateModal.value || showEditModal.value || !pool || pool.usedBy > 0 || pool.status !== 'Created' || loadWarning.value) return
  const context = captureWrite('delete')
  if (!confirm(t('admin.hosts.storage.deleteConfirm', { name: poolName }))) {
    return
  }

  deleting.value = poolName
  deleteError.value = ''
  try {
    const result = await api.hosts.deleteStoragePool(context.hostId, poolName)
    if (!context.current()) return
    if (!result || typeof result.message !== 'string' || !result.message) throw new Error(t('admin.hosts.storage.deleteFailed'))
    invalidateEarlierReads()
    pools.value = pools.value.filter(pool => pool.name !== poolName)
    toast.success(t('admin.hosts.storage.deleteSuccess'))
    await loadPools()
  } catch (err: unknown) {
    if (!context.current()) return
    deleteError.value = t('admin.hosts.storage.deleteFailed') + ': ' + translateError(err)
  } finally {
    deleting.value = null
  }
}

function formatBytes(bytes: number | undefined | null): string {
  if (bytes === undefined || bytes === null || isNaN(bytes)) return '-'
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

function hasValidSpaceInfo(pool: StoragePool): boolean {
  return !!(pool.space && 
    typeof pool.space.total === 'number' && pool.space.total > 0 &&
    typeof pool.space.used === 'number' && !isNaN(pool.space.used))
}

function getUsagePercent(pool: StoragePool): number {
  if (!hasValidSpaceInfo(pool)) return 0
  return Math.round((pool.space!.used / pool.space!.total) * 100)
}

// 打开编辑模态框
function openEditModal(pool: StoragePool) {
  if (!canStartWrite.value || showCreateModal.value || showEditModal.value || !pools.value.includes(pool)) return
  editingPoolName = pool.name
  editError.value = ''
  editForm.value = {
    name: pool.name,
    driver: pool.driver,
    currentSize: pool.config.size || '',
    newSizeValue: '',
    newSizeUnit: 'GiB',
    description: pool.description || '',
    purpose: pool.purpose || 'instance_data'
  }
  showEditModal.value = true
}

// 提交编辑
async function submitEdit() {
  if (!canStartWrite.value || !showEditModal.value || !editingPoolName || editForm.value.name !== editingPoolName ||
    !pools.value.some(pool => pool.name === editingPoolName)) return
  const context = captureWrite('edit'), poolName = editingPoolName
  editError.value = ''
  const data: { size?: string; description?: string; purpose?: 'instance_data' | 'instance_storage' } = {}
  
  // 只有填写了新大小才提交
  if (editForm.value.newSizeValue) {
    data.size = `${editForm.value.newSizeValue}${editForm.value.newSizeUnit}`
  }
  // 描述可以为空，也提交
  data.description = editForm.value.description
  // 存储用途
  data.purpose = editForm.value.purpose

  editing.value = true
  try {
    const result = await api.hosts.updateStoragePool(context.hostId, poolName, data)
    if (!context.current()) return
    if (!result || typeof result.message !== 'string' || !result.message) throw new Error(t('admin.hosts.storage.updateFailed'))
    invalidateEarlierReads()
    toast.success(t('admin.hosts.storage.updateSuccess'))
    showEditModal.value = false
    await loadPools()
  } catch (err: unknown) {
    if (!context.current()) return
    editError.value = t('admin.hosts.storage.updateFailed') + ': ' + translateError(err)
  } finally {
    editing.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h3 class="text-lg font-medium text-themed">{{ t('admin.hosts.storage.title') }}</h3>
        <p class="text-sm text-themed-secondary mt-1">{{ t('admin.hosts.storage.subtitle') }}</p>
      </div>
      <button class="btn-primary" :disabled="!canStartWrite || showCreateModal || showEditModal" @click="openCreateModal">
        <svg class="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
        </svg>
        {{ t('admin.hosts.storage.create') }}
      </button>
    </div>

    <p v-if="deleteError" role="alert" class="text-sm text-red-500 break-words">{{ deleteError }}</p>

    <!-- Loading -->
    <div v-if="loading" class="card p-8 text-center">
      <svg class="w-8 h-8 animate-spin mx-auto text-themed-muted" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
      </svg>
      <p class="mt-2 text-themed-muted">{{ t('common.loading') }}</p>
    </div>

    <!-- Empty State -->
    <div v-else-if="loadError" role="alert" class="card p-5 space-y-3">
      <p class="text-sm text-red-500 break-words">{{ loadError }}</p>
      <button class="btn-secondary" :disabled="!canRead" @click="loadPools">{{ t('common.retry') }}</button>
    </div>

    <div v-else-if="pools.length === 0" class="card p-8 text-center">
      <p v-if="loadWarning" role="status" class="mb-4 text-sm text-amber-600 dark:text-amber-400 break-words">{{ loadWarning }}</p>
      <svg class="w-12 h-12 mx-auto text-themed-muted mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
      </svg>
      <p class="text-themed-secondary">{{ t('admin.hosts.storage.empty') }}</p>
      <button class="btn-primary mt-4" :disabled="!canStartWrite || showCreateModal || showEditModal" @click="openCreateModal">
        {{ t('admin.hosts.storage.create') }}
      </button>
    </div>

    <!-- Pool List -->
    <div v-else class="space-y-4">
      <p v-if="loadWarning" role="status" class="text-sm text-amber-600 dark:text-amber-400 break-words">{{ loadWarning }}</p>
      <div
        v-for="pool in pools"
        :key="pool.name"
        class="card p-4"
      >
        <div class="flex items-start justify-between">
          <div class="flex-1 min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-medium text-themed break-all">{{ pool.name }}</span>
              <span class="badge badge-default text-xs uppercase">{{ pool.driver }}</span>
              <span
                v-if="pool.purpose"
                :class="[
                  'badge text-xs',
                  pool.purpose === 'instance_data' ? 'badge-primary' : 'badge-secondary'
                ]"
              >
                {{ pool.purpose === 'instance_data' ? t('admin.hosts.storage.purposeSystemDisk') : t('admin.hosts.storage.purposeStorageDisk') }}
              </span>
              <span
                :class="[
                  'w-2 h-2 rounded-full',
                  pool.status === 'Created' ? 'bg-green-500' : 'bg-gray-400'
                ]"
              ></span>
            </div>
            <p v-if="pool.description" class="text-sm text-themed-secondary mt-1 break-words">{{ pool.description }}</p>
            
            <!-- 使用量 -->
            <div v-if="hasValidSpaceInfo(pool)" class="mt-3">
              <div class="flex items-center justify-between text-xs text-themed-muted mb-1">
                <span>{{ formatBytes(pool.space?.used) }} / {{ formatBytes(pool.space?.total) }}</span>
                <span>{{ getUsagePercent(pool) }}%</span>
              </div>
              <div class="h-1.5 rounded-full overflow-hidden" :class="themeStore.isDark ? 'bg-gray-700' : 'bg-gray-200'">
                <div
                  class="h-full rounded-full transition-all"
                  :class="getUsagePercent(pool) > 90 ? 'bg-red-500' : getUsagePercent(pool) > 70 ? 'bg-yellow-500' : 'bg-green-500'"
                  :style="{ width: getUsagePercent(pool) + '%' }"
                ></div>
              </div>
            </div>

            <!-- 配置信息 -->
            <div class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-themed-muted break-all">
              <span v-if="pool.config.source">
                <span class="text-themed-secondary">Source:</span> {{ pool.config.source }}
              </span>
              <span v-if="pool.config.size">
                <span class="text-themed-secondary">Size:</span> {{ pool.config.size }}
              </span>
              <span v-if="pool.config['zfs.pool_name']">
                <span class="text-themed-secondary">ZFS Pool:</span> {{ pool.config['zfs.pool_name'] }}
              </span>
              <span v-if="pool.config['lvm.vg_name']">
                <span class="text-themed-secondary">VG:</span> {{ pool.config['lvm.vg_name'] }}
              </span>
            </div>

            <!-- 使用者 -->
            <div v-if="pool.usedBy > 0" class="mt-2 text-xs text-themed-muted">
              <span class="text-themed-secondary">{{ t('admin.hosts.storage.usedBy') }}:</span>
              {{ pool.usedBy }} {{ t('admin.hosts.storage.volumes') }}
            </div>
          </div>

          <div class="flex items-center gap-2 ml-4">
            <!-- 编辑按钮 -->
            <button
              class="btn-secondary btn-sm"
              :disabled="!canStartWrite || showCreateModal || showEditModal"
              :aria-label="t('common.edit')"
              @click="openEditModal(pool)"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
            <!-- 删除按钮 -->
            <button
              class="btn-danger btn-sm"
              :disabled="!canStartWrite || showCreateModal || showEditModal || pool.usedBy > 0 || pool.status !== 'Created' || !!loadWarning"
              :aria-label="t('common.delete')"
              @click="deletePool(pool.name)"
            >
              <svg v-if="deleting === pool.name" class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
              <svg v-else class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Create Modal -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showCreateModal" class="modal-overlay">
          <div class="modal-backdrop" @click="closeCreateModal"></div>
          <div ref="createDialog" class="modal-content max-w-lg max-h-[90vh] overflow-y-auto" role="dialog" aria-modal="true" :aria-label="t('admin.hosts.storage.createTitle')" tabindex="-1" @keydown="handleDialogKey($event, 'create')">
            <div class="modal-header">
              <h3 class="modal-title">{{ t('admin.hosts.storage.createTitle') }}</h3>
              <button class="text-themed-muted hover:text-themed" :disabled="creating" :aria-label="t('common.close')" @click="closeCreateModal">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <fieldset class="modal-body space-y-4 min-w-0" :disabled="creating">
              <!-- 模式切换 - 分段按钮组样式 -->
              <div class="inline-flex items-center gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-lg w-full">
                <button
                  type="button"
                  :class="[
                    'flex-1 px-3 py-1.5 text-sm font-medium rounded-md transition-all',
                    createMode === 'create'
                      ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                      : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                  ]"
                  @click="createMode = 'create'"
                >
                  {{ t('admin.hosts.storage.modeCreate') }}
                </button>
                <button
                  type="button"
                  :class="[
                    'flex-1 px-3 py-1.5 text-sm font-medium rounded-md transition-all',
                    createMode === 'import'
                      ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                      : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                  ]"
                  @click="createMode = 'import'"
                >
                  {{ t('admin.hosts.storage.modeImport') }}
                </button>
              </div>

              <!-- 模式说明 -->
              <p class="text-xs text-themed-muted">
                {{ createMode === 'create' ? t('admin.hosts.storage.modeCreateHint') : t('admin.hosts.storage.modeImportHint') }}
              </p>

              <!-- 名称 -->
              <div>
                <label class="block text-xs text-themed-muted mb-1.5">{{ t('admin.hosts.storage.poolName') }}</label>
                <input
                  v-model="form.name"
                  type="text"
                  class="input"
                  placeholder="default"
                  pattern="^[a-zA-Z0-9_-]+$"
                  @input="form.name = form.name.replace(/[^a-zA-Z0-9_-]/g, '')"
                />
              </div>

              <!-- 导入模式的配置 -->
              <template v-if="createMode === 'import'">
                <!-- 驱动类型 -->
                <div>
                  <label class="block text-xs text-themed-muted mb-1.5">{{ t('admin.hosts.storage.driver') }}</label>
                  <select v-model="importDriver" class="input">
                    <option v-for="opt in driverOptions" :key="opt.value" :value="opt.value">
                      {{ opt.label }}
                    </option>
                  </select>
                </div>

                <!-- 底层存储源 -->
                <div>
                  <label class="block text-xs text-themed-muted mb-1.5">
                    {{ importDriver === 'zfs' ? t('admin.hosts.storage.importZfsSource') :
                      importDriver === 'lvm' ? t('admin.hosts.storage.importLvmSource') :
                      importDriver === 'btrfs' ? t('admin.hosts.storage.importBtrfsSource') :
                      t('admin.hosts.storage.importDirSource') }}
                    <span v-if="importDriver === 'btrfs' || importDriver === 'dir'" class="text-red-500">*</span>
                  </label>
                  <input
                    v-model="importSource"
                    type="text"
                    class="input"
                    :placeholder="importDriver === 'zfs' ? 'incus-pool' :
                      importDriver === 'lvm' ? 'incus-vg' :
                      importDriver === 'btrfs' ? '/dev/sdb' :
                      '/mnt/storage'"
                  />
                  <p class="text-xs text-themed-muted mt-1">
                    {{ importDriver === 'zfs' ? t('admin.hosts.storage.importZfsHint') :
                      importDriver === 'lvm' ? t('admin.hosts.storage.importLvmHint') :
                      importDriver === 'btrfs' ? t('admin.hosts.storage.importBtrfsHint') :
                      t('admin.hosts.storage.importDirHint') }}
                  </p>
                </div>
              </template>

              <!-- 创建新池模式的配置 -->
              <template v-if="createMode === 'create'">
                <!-- 驱动类型 -->
                <div>
                  <label class="block text-xs text-themed-muted mb-1.5">{{ t('admin.hosts.storage.driver') }}</label>
                  <select v-model="form.driver" class="input">
                    <option v-for="opt in driverOptions" :key="opt.value" :value="opt.value">
                      {{ opt.label }}
                    </option>
                  </select>
                  <p class="text-xs text-themed-muted mt-1">{{ selectedDriverDesc }}</p>
                </div>

                <!-- ZFS 配置 -->
                <template v-if="form.driver === 'zfs'">
                  <div class="flex items-center gap-2">
                    <input id="useLoop" v-model="useLoop" type="checkbox" class="checkbox" />
                    <label for="useLoop" class="text-sm text-themed">{{ t('admin.hosts.storage.useLoop') }}</label>
                  </div>
                  <div v-if="!useLoop">
                    <label class="block text-xs text-themed-muted mb-1.5">{{ t('admin.hosts.storage.source') }}</label>
                    <input v-model="form.source" type="text" class="input" placeholder="/dev/disk/by-id/nvme-xxx" />
                    <p class="text-xs text-themed-muted mt-1">{{ t('admin.hosts.storage.zfsSourceHint') }}</p>
                  </div>
                  <div v-else>
                    <label class="block text-xs text-themed-muted mb-1.5">{{ t('admin.hosts.storage.size') }}</label>
                    <div class="flex gap-2">
                      <input
                        v-model="form.sizeValue"
                        type="number"
                        min="1"
                        class="input flex-1"
                        placeholder="50"
                      />
                      <select v-model="form.sizeUnit" class="input w-24">
                        <option v-for="unit in sizeUnits" :key="unit" :value="unit">{{ unit }}</option>
                      </select>
                    </div>
                    <p class="text-xs text-themed-muted mt-1">{{ t('admin.hosts.storage.loopSizeHint') }}</p>
                  </div>
                  <div>
                    <label class="block text-xs text-themed-muted mb-1.5">{{ t('admin.hosts.storage.zfsPoolName') }}</label>
                    <input v-model="form.zfsPoolName" type="text" class="input" placeholder="incus-pool" />
                    <p class="text-xs text-themed-muted mt-1">{{ t('admin.hosts.storage.zfsPoolNameHint') }}</p>
                  </div>
                </template>

                <!-- LVM 配置 -->
                <template v-if="form.driver === 'lvm'">
                  <div class="flex items-center gap-2">
                    <input id="useLoopLvm" v-model="useLoop" type="checkbox" class="checkbox" />
                    <label for="useLoopLvm" class="text-sm text-themed">{{ t('admin.hosts.storage.useLoop') }}</label>
                  </div>
                  <div v-if="!useLoop">
                    <label class="block text-xs text-themed-muted mb-1.5">{{ t('admin.hosts.storage.source') }}</label>
                    <input v-model="form.source" type="text" class="input" placeholder="/dev/sdb" />
                    <p class="text-xs text-themed-muted mt-1">{{ t('admin.hosts.storage.lvmSourceHint') }}</p>
                  </div>
                  <div v-else>
                    <label class="block text-xs text-themed-muted mb-1.5">{{ t('admin.hosts.storage.size') }}</label>
                    <div class="flex gap-2">
                      <input
                        v-model="form.sizeValue"
                        type="number"
                        min="1"
                        class="input flex-1"
                        placeholder="50"
                      />
                      <select v-model="form.sizeUnit" class="input w-24">
                        <option v-for="unit in sizeUnits" :key="unit" :value="unit">{{ unit }}</option>
                      </select>
                    </div>
                    <p class="text-xs text-themed-muted mt-1">{{ t('admin.hosts.storage.loopSizeHint') }}</p>
                  </div>
                  <div>
                    <label class="block text-xs text-themed-muted mb-1.5">{{ t('admin.hosts.storage.lvmVgName') }}</label>
                    <input v-model="form.lvmVgName" type="text" class="input" placeholder="incus-vg" />
                  </div>
                  <div class="flex items-center gap-2">
                    <input id="lvmUseThinpool" v-model="form.lvmUseThinpool" type="checkbox" class="checkbox" />
                    <label for="lvmUseThinpool" class="text-sm text-themed">{{ t('admin.hosts.storage.lvmUseThinpool') }}</label>
                  </div>
                  <p class="text-xs text-themed-muted">{{ t('admin.hosts.storage.lvmThinpoolHint') }}</p>
                </template>

                <!-- Btrfs 配置 -->
                <template v-if="form.driver === 'btrfs'">
                  <div class="flex items-center gap-2">
                    <input id="useLoopBtrfs" v-model="useLoop" type="checkbox" class="checkbox" />
                    <label for="useLoopBtrfs" class="text-sm text-themed">{{ t('admin.hosts.storage.useLoop') }}</label>
                  </div>
                  <div v-if="!useLoop">
                    <label class="block text-xs text-themed-muted mb-1.5">{{ t('admin.hosts.storage.source') }}</label>
                    <input v-model="form.source" type="text" class="input" placeholder="/dev/sdb" />
                    <p class="text-xs text-themed-muted mt-1">{{ t('admin.hosts.storage.btrfsSourceHint') }}</p>
                  </div>
                  <div v-else>
                    <label class="block text-xs text-themed-muted mb-1.5">{{ t('admin.hosts.storage.size') }}</label>
                    <div class="flex gap-2">
                      <input
                        v-model="form.sizeValue"
                        type="number"
                        min="1"
                        class="input flex-1"
                        placeholder="50"
                      />
                      <select v-model="form.sizeUnit" class="input w-24">
                        <option v-for="unit in sizeUnits" :key="unit" :value="unit">{{ unit }}</option>
                      </select>
                    </div>
                    <p class="text-xs text-themed-muted mt-1">{{ t('admin.hosts.storage.loopSizeHint') }}</p>
                  </div>
                </template>

                <!-- DIR 配置 -->
                <template v-if="form.driver === 'dir'">
                  <div>
                    <label class="block text-xs text-themed-muted mb-1.5">{{ t('admin.hosts.storage.dirPath') }}</label>
                    <input v-model="form.source" type="text" class="input" placeholder="/mnt/data/incus-storage" />
                    <p class="text-xs text-themed-muted mt-1">{{ t('admin.hosts.storage.dirPathHint') }}</p>
                  </div>
                </template>
              </template> <!-- end of createMode === 'create' -->

              <!-- 存储用途 -->
              <div class="border-t border-themed pt-4">
                <label class="block text-xs text-themed-muted mb-2">{{ t('admin.hosts.storage.purpose') }}</label>
                <div class="space-y-2">
                  <label class="flex items-center gap-2 cursor-pointer">
                    <input v-model="form.purpose" type="radio" value="instance_data" class="radio" />
                    <span class="text-sm text-themed">{{ t('admin.hosts.storage.forInstances') }}</span>
                  </label>
                  <p class="text-xs text-themed-muted ml-5">{{ t('admin.hosts.storage.forInstancesHint') }}</p>
                  <label class="flex items-center gap-2 cursor-pointer">
                    <input v-model="form.purpose" type="radio" value="instance_storage" class="radio" />
                    <span class="text-sm text-themed">{{ t('admin.hosts.storage.forVolumes') }}</span>
                  </label>
                  <p class="text-xs text-themed-muted ml-5">{{ t('admin.hosts.storage.forVolumesHint') }}</p>
                </div>
              </div>

              <!-- 描述 -->
              <div>
                <label class="block text-xs text-themed-muted mb-1.5">{{ t('admin.hosts.storage.description') }}</label>
                <input v-model="form.description" type="text" class="input" :placeholder="t('common.notSet')" />
              </div>
            </fieldset>

            <p v-if="createError" role="alert" class="px-5 pb-3 text-sm text-red-500 break-words">{{ createError }}</p>
            <div class="modal-footer">
              <button class="btn-secondary" :disabled="creating" @click="closeCreateModal">{{ t('common.cancel') }}</button>
              <button class="btn-primary" :disabled="!canStartWrite || !form.name" @click="createPool">
                <svg v-if="creating" class="w-4 h-4 animate-spin mr-1.5" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
                {{ t('common.create') }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Edit Modal -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showEditModal" class="modal-overlay">
          <div class="modal-backdrop" @click="closeEditModal"></div>
          <div ref="editDialog" class="modal-content max-w-md max-h-[90vh] overflow-y-auto" role="dialog" aria-modal="true" :aria-label="t('admin.hosts.storage.editTitle')" tabindex="-1" @keydown="handleDialogKey($event, 'edit')">
            <div class="modal-header">
              <h3 class="modal-title">{{ t('admin.hosts.storage.editTitle') }}</h3>
              <button class="text-themed-muted hover:text-themed" :disabled="editing" :aria-label="t('common.close')" @click="closeEditModal">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <fieldset class="modal-body space-y-4 min-w-0" :disabled="editing">
              <!-- 存储池名称（只读） -->
              <div>
                <label class="block text-xs text-themed-muted mb-1.5">{{ t('admin.hosts.storage.poolName') }}</label>
                <input :value="editForm.name" type="text" class="input" disabled />
              </div>

              <!-- 驱动类型（只读） -->
              <div>
                <label class="block text-xs text-themed-muted mb-1.5">{{ t('admin.hosts.storage.driver') }}</label>
                <input :value="editForm.driver.toUpperCase()" type="text" class="input" disabled />
              </div>

              <!-- 当前大小 -->
              <div v-if="editForm.currentSize">
                <label class="block text-xs text-themed-muted mb-1.5">{{ t('admin.hosts.storage.currentSize') }}</label>
                <input :value="editForm.currentSize" type="text" class="input" disabled />
              </div>

              <!-- 新大小（扩容） -->
              <div>
                <label class="block text-xs text-themed-muted mb-1.5">{{ t('admin.hosts.storage.newSize') }}</label>
                <div class="flex gap-2">
                  <input
                    v-model="editForm.newSizeValue"
                    type="number"
                    min="1"
                    class="input flex-1"
                    placeholder="100"
                  />
                  <select v-model="editForm.newSizeUnit" class="input w-24">
                    <option v-for="unit in sizeUnits" :key="unit" :value="unit">{{ unit }}</option>
                  </select>
                </div>
                <p class="text-xs text-themed-muted mt-1">{{ t('admin.hosts.storage.newSizeHint') }}</p>
              </div>

              <!-- 描述 -->
              <div>
                <label class="block text-xs text-themed-muted mb-1.5">{{ t('admin.hosts.storage.description') }}</label>
                <input v-model="editForm.description" type="text" class="input" :placeholder="t('common.notSet')" />
              </div>
              
              <!-- 存储用途 -->
              <div class="border-t border-themed pt-4">
                <label class="block text-xs text-themed-muted mb-2">{{ t('admin.hosts.storage.purpose') }}</label>
                <div class="space-y-2">
                  <label class="flex items-center gap-2 cursor-pointer">
                    <input v-model="editForm.purpose" type="radio" value="instance_data" class="radio" />
                    <span class="text-sm text-themed">{{ t('admin.hosts.storage.forInstances') }}</span>
                  </label>
                  <p class="text-xs text-themed-muted ml-5">{{ t('admin.hosts.storage.forInstancesHint') }}</p>
                  <label class="flex items-center gap-2 cursor-pointer">
                    <input v-model="editForm.purpose" type="radio" value="instance_storage" class="radio" />
                    <span class="text-sm text-themed">{{ t('admin.hosts.storage.forVolumes') }}</span>
                  </label>
                  <p class="text-xs text-themed-muted ml-5">{{ t('admin.hosts.storage.forVolumesHint') }}</p>
                </div>
              </div>
            </fieldset>

            <p v-if="editError" role="alert" class="px-5 pb-3 text-sm text-red-500 break-words">{{ editError }}</p>
            <div class="modal-footer">
              <button class="btn-secondary" :disabled="editing" @click="closeEditModal">{{ t('common.cancel') }}</button>
              <button class="btn-primary" :disabled="!canStartWrite" @click="submitEdit">
                <svg v-if="editing" class="w-4 h-4 animate-spin mr-1.5" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
                {{ t('common.save') }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
