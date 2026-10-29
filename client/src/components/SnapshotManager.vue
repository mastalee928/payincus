<script setup lang="ts">
import { ref, watch, onBeforeUnmount, onMounted, onActivated, onDeactivated, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api'
import { useToast } from '@/stores/toast'
import { useThemeStore } from '@/stores/theme'
import { useAuthStore } from '@/stores/auth'
import { formatDate } from '@/utils/formatters'
import type { Snapshot, SnapshotPolicy, CreateSnapshotRequest, UpdateSnapshotPolicyRequest } from '@/types/api'

const { t } = useI18n()

interface Props {
  instanceId: string | number
  instanceName?: string
  instanceStatus?: string
  snapshotLimit?: number | null
}

const props = withDefaults(defineProps<Props>(), {
  instanceName: '',
  instanceStatus: '',
  snapshotLimit: null
})

// 配额状态
const hasQuota = computed<boolean>(() => props.snapshotLimit !== null && props.snapshotLimit !== undefined)
const quotaUsed = computed<number>(() => snapshots.value.length)
const quotaRemaining = computed<number>(() => hasQuota.value ? Math.max(0, (props.snapshotLimit || 0) - quotaUsed.value) : 0)
const isQuotaFull = computed<boolean>(() => hasQuota.value && quotaRemaining.value <= 0)

const toast = useToast()
const themeStore = useThemeStore()
const authStore = useAuthStore()

// 快照列表
const snapshots = ref<Snapshot[]>([])
const loading = ref<boolean>(true)

// 创建快照弹窗
const showCreateModal = ref<boolean>(false)
interface CreateForm {
  name: string
  description: string
}
const createForm = ref<CreateForm>({ name: '', description: '' })
const createLoading = ref<boolean>(false)

// 自动快照策略
const policy = ref<SnapshotPolicy | null>(null)
const showPolicyModal = ref<boolean>(false)
const policyForm = ref<UpdateSnapshotPolicyRequest>({ enabled: false, intervalMinutes: 360 })
const policyLoading = ref<boolean>(false)



const canRestore = computed<boolean>(() => {
  const s = props.instanceStatus?.toLowerCase()
  return s === 'stopped'
})

const instanceIdNum = computed<number>(() => Number(props.instanceId))
const pageError = ref('')
const retryLoading = ref(false)
const actionLoading = ref(false)
let generation = 0
let snapshotSequence = 0
let policySequence = 0
let disposed = false
const active = ref(false)
const session = computed(() => {
  if (!authStore.token || !authStore.user) return ''
  let identity = authStore.token
  try {
    const payload = JSON.parse(atob(identity.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    if (typeof payload.sid === 'string') identity = payload.sid
  } catch { /* Legacy tokens retain their complete identity. */ }
  return `${authStore.user.id}:${authStore.user.role}:${identity}`
})
const available = computed(() => !disposed && active.value && !!session.value && Number.isSafeInteger(instanceIdNum.value) && instanceIdNum.value > 0)
const current = (id: number, version: number) => available.value && id === instanceIdNum.value && version === generation
const operationPending = computed(() => Boolean(policy.value?.operation))
const busy = computed(() => createLoading.value || policyLoading.value || retryLoading.value || actionLoading.value)
let draftVersion = 0
watch([createForm, policyForm, showCreateModal, showPolicyModal], () => { draftVersion++ }, { deep: true, flush: 'sync' })
function mutationContext(id: number, version: number) {
  const draft = draftVersion
  return () => current(id, version) && draft === draftVersion
}
function openCreateModal(): void {
  if (!available.value || busy.value || operationPending.value || !hasQuota.value || isQuotaFull.value) return
  showCreateModal.value = true
}
function closeCreateModal(): void { if (!busy.value) showCreateModal.value = false }
function openPolicyModal(): void {
  if (!available.value || busy.value) return
  if (policy.value) policyForm.value = { enabled: Boolean(policy.value.enabled), intervalMinutes: policy.value.interval_minutes }
  showPolicyModal.value = true
}
function closePolicyModal(): void { if (!busy.value) showPolicyModal.value = false }

function invalidateContext(): void {
  generation++
  snapshotSequence++
  policySequence++
  snapshots.value = []
  policy.value = null
  pageError.value = ''
  showCreateModal.value = false
  showPolicyModal.value = false
  createForm.value = { name: '', description: '' }
  policyForm.value = { enabled: false, intervalMinutes: 360 }
  loading.value = false
  // In-flight mutations retain their busy flag until their own finally settles.
}
watch([instanceIdNum, session], () => {
  invalidateContext()
  if (available.value) void refresh()
}, { immediate: true, flush: 'sync' })
function activate(): void {
  if (disposed || active.value) return
  active.value = true
  void refresh()
}
onMounted(activate)
onActivated(activate)
onDeactivated(() => { active.value = false; invalidateContext() })
onBeforeUnmount(() => { disposed = true; active.value = false; invalidateContext() })

async function refresh(): Promise<void> {
  if (!available.value) return
  pageError.value = ''
  await Promise.all([loadSnapshots(), loadPolicy()])
}

async function loadSnapshots(): Promise<void> {
  if (!available.value) return
  const id = instanceIdNum.value, version = generation, sequence = ++snapshotSequence
  loading.value = true
  try {
    const res = await api.instances.getSnapshots(id)
    if (current(id, version) && sequence === snapshotSequence) snapshots.value = Array.isArray(res) ? res : []
  } catch {
    if (current(id, version) && sequence === snapshotSequence) pageError.value = t('snapshot.loadFailed')
  } finally {
    if (current(id, version) && sequence === snapshotSequence) loading.value = false
  }
}

async function loadPolicy(): Promise<void> {
  if (!available.value) return
  const id = instanceIdNum.value, version = generation, sequence = ++policySequence
  try {
    const res = await api.instances.getSnapshotPolicy(id)
    if (!current(id, version) || sequence !== policySequence) return
    policy.value = res
    if (res && !showPolicyModal.value && !busy.value) policyForm.value = { enabled: Boolean(res.enabled), intervalMinutes: res.interval_minutes }
  } catch {
    if (current(id, version) && sequence === policySequence) pageError.value = t('snapshot.loadFailed')
  }
}

async function retryOperation(): Promise<void> {
  const operation = policy.value?.operation
  if (!available.value || !operation || busy.value) return
  const id = instanceIdNum.value, version = generation
  const owns = mutationContext(id, version), operationId = operation.id
  retryLoading.value = true
  pageError.value = ''
  try {
    await api.instances.retrySnapshotOperation(id, operationId)
    if (!owns()) return
    await Promise.all([loadSnapshots(), loadPolicy()])
    if (owns() && !policy.value?.operation) toast.success(t('snapshot.recoveryComplete'))
  } catch (err: any) {
    if (owns()) { pageError.value = err?.message || t('snapshot.loadFailed'); await loadPolicy() }
  } finally { retryLoading.value = false }
}

async function createSnapshot(): Promise<void> {
  if (!available.value || !createForm.value.name || busy.value || operationPending.value) return
  const id = instanceIdNum.value, version = generation
  const owns = mutationContext(id, version)
  createLoading.value = true
  const payload: CreateSnapshotRequest = { name: createForm.value.name, description: createForm.value.description || undefined }
  try {
    await api.instances.createSnapshot(id, payload)
    if (!owns()) return
    toast.success(t('snapshot.messages.createSuccess'))
    showCreateModal.value = false
    createForm.value = { name: '', description: '' }
    await loadSnapshots()
  } catch (err: any) {
    if (owns()) { pageError.value = err?.message || String(err); toast.error(t('snapshot.messages.createFailed')); await loadPolicy() }
  } finally { createLoading.value = false }
}

async function deleteSnapshot(snapshot: Snapshot): Promise<void> {
  if (!available.value || busy.value || operationPending.value || !confirm(t('snapshot.messages.deleteConfirm', { name: snapshot.name }))) return
  const id = instanceIdNum.value, version = generation
  const snapshotId = snapshot.id, owns = mutationContext(id, version)
  actionLoading.value = true
  try {
    await api.instances.deleteSnapshot(id, snapshotId)
    if (!owns()) return
    snapshots.value = snapshots.value.filter(s => s.id !== snapshotId)
    toast.success(t('snapshot.messages.deleteSuccess'))
  } catch (err: any) {
    if (owns()) { pageError.value = err?.message || String(err); await Promise.all([loadSnapshots(), loadPolicy()]) }
  } finally { actionLoading.value = false }
}

async function restoreSnapshot(snapshot: Snapshot): Promise<void> {
  if (!available.value || busy.value || operationPending.value) return
  if (!canRestore.value) { toast.warning(t('snapshot.messages.stopInstanceFirst')); return }
  if (!confirm(t('snapshot.messages.restoreConfirm', { name: snapshot.name }))) return
  const id = instanceIdNum.value, version = generation
  const snapshotId = snapshot.id, owns = mutationContext(id, version)
  actionLoading.value = true
  try {
    await api.instances.restoreSnapshot(id, snapshotId)
    if (owns()) toast.success(t('snapshot.messages.restoreSuccess'))
  } catch (err: any) {
    if (owns()) { pageError.value = err?.message || String(err); await loadPolicy() }
  } finally { actionLoading.value = false }
}

async function updatePolicy(payload: UpdateSnapshotPolicyRequest): Promise<void> {
  if (!available.value || busy.value) return
  const id = instanceIdNum.value, version = generation
  const submitted = { ...payload }, owns = mutationContext(id, version)
  policyLoading.value = true
  try {
    await api.instances.updateSnapshotPolicy(id, submitted)
    if (!owns()) return
    toast.success(t(submitted.enabled ? 'snapshot.messages.policySaved' : 'snapshot.messages.policyDisabled'))
    showPolicyModal.value = false
    await loadPolicy()
  } catch (err: any) {
    if (owns()) { pageError.value = err?.message || String(err); toast.error(t('snapshot.messages.policySaveFailed')) }
  } finally { policyLoading.value = false }
}
async function savePolicy(): Promise<void> { await updatePolicy({ ...policyForm.value }) }
async function disableAutoPolicy(): Promise<void> { await updatePolicy({ enabled: false, intervalMinutes: policyForm.value.intervalMinutes }) }

// 获取间隔时间的显示文本
function getIntervalLabel(minutes: number): string {
  const intervalMap: Record<number, string> = {
    10: t('snapshot.policyModal.intervalOptions.min10'),
    60: t('snapshot.policyModal.intervalOptions.hour1'),
    360: t('snapshot.policyModal.intervalOptions.hour6'),
    1440: t('snapshot.policyModal.intervalOptions.hour24')
  }
  return intervalMap[minutes] || `${minutes} ${t('snapshot.minutes')}`
}
</script>

<template>
  <div class="card">
    <div
      class="flex items-center justify-between p-4 border-b"
      :class="themeStore.isDark ? 'border-gray-800' : 'border-gray-200'"
    >
      <div>
        <h2
          class="text-sm font-medium"
          :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'"
        >
          {{ t('snapshot.title') }}
        </h2>
        <p
          class="text-xs mt-0.5"
          :class="themeStore.isDark ? 'text-gray-600' : 'text-gray-500'"
        >
          {{ policy?.enabled ? t('snapshot.autoPolicy') : t('snapshot.manual') }}
        </p>
      </div>
      <div class="flex items-center gap-2">
        <span v-if="hasQuota" class="text-xs text-themed-muted">
          {{ quotaUsed }}/{{ snapshotLimit }}
        </span>
        <button
          class="btn-ghost btn-sm"
          :title="t('snapshot.autoSettings')" :aria-label="t('snapshot.autoSettings')"
          :disabled="!available || busy"
          @click="openPolicyModal"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </button>
        <button
          :disabled="!available || busy || !hasQuota || isQuotaFull || operationPending"
          :class="['btn-ghost btn-sm', (!hasQuota || isQuotaFull) && 'opacity-50 cursor-not-allowed']"
          :title="!hasQuota ? t('snapshot.noQuota') : isQuotaFull ? t('snapshot.quotaFull') : t('snapshot.createSnapshot')"
          @click="openCreateModal"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
          </svg>
          {{ t('snapshot.create') }}
        </button>
      </div>
    </div>

    <div v-if="pageError" class="mx-4 mt-4 text-sm text-error" role="alert">{{ pageError }}</div>
    <div v-if="policy?.operation" class="mx-4 mt-4 p-3 border border-amber-500/40 rounded-lg" aria-live="polite" :aria-busy="retryLoading">
      <p class="font-medium text-sm">{{ t('snapshot.recoveryTitle') }}</p>
      <p class="text-sm mt-1 break-words">{{ policy.operation.error || t('snapshot.recoveryPending') }}</p>
      <p class="text-xs text-themed-muted mt-2">{{ t('snapshot.recoveryHint') }}</p>
      <div class="flex flex-wrap gap-2 mt-2">
        <button type="button" class="btn-secondary min-h-11" :disabled="!available || busy" @click="retryOperation">
          {{ retryLoading ? t('snapshot.retryingRecovery') : t('snapshot.retryRecovery') }}
        </button>
        <button type="button" class="btn-ghost min-h-11" :disabled="!available || busy" @click="refresh">{{ t('snapshot.refresh') }}</button>
      </div>
    </div>

    <!-- 自动快照策略提醒横幅 -->
    <div
      v-if="policy?.enabled"
      class="mx-4 mt-4 p-3 rounded-lg flex items-center justify-between gap-3"
      :class="themeStore.isDark ? 'bg-green-500/10 border border-green-500/20' : 'bg-green-50 border border-green-200'"
    >
      <div class="flex items-center gap-3">
        <div
          class="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
          :class="themeStore.isDark ? 'bg-green-500/20' : 'bg-green-100'"
        >
          <svg class="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <div>
          <p class="text-sm font-medium" :class="themeStore.isDark ? 'text-green-400' : 'text-green-700'">
            {{ t('snapshot.autoPolicyEnabled') }}
          </p>
          <p class="text-xs" :class="themeStore.isDark ? 'text-green-500/70' : 'text-green-600'">
            {{ t('snapshot.currentPolicy') }}: {{ getIntervalLabel(policy.interval_minutes) }}
          </p>
        </div>
      </div>
      <button
        class="btn-ghost btn-sm flex-shrink-0"
        :class="themeStore.isDark ? 'text-green-400 hover:bg-green-500/20' : 'text-green-600 hover:bg-green-100'"
        :disabled="!available || busy"
        @click="disableAutoPolicy"
      >
        <svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
        {{ t('snapshot.disableAutoPolicy') }}
      </button>
    </div>

    <div v-if="loading" class="p-4 animate-pulse">
      <div v-for="i in 2" :key="i" class="flex items-center gap-3 py-3">
        <div
          class="w-8 h-8 rounded"
          :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-200'"
        ></div>
        <div class="flex-1 space-y-2">
          <div
            class="h-3 rounded w-1/3"
            :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-200'"
          ></div>
          <div
            class="h-2 rounded w-1/4"
            :class="themeStore.isDark ? 'bg-gray-800/50' : 'bg-gray-200/50'"
          ></div>
        </div>
      </div>
    </div>

    <div
      v-else-if="snapshots.length === 0"
      class="p-8 text-center text-sm"
      :class="themeStore.isDark ? 'text-gray-600' : 'text-gray-500'"
    >
      <svg
        class="w-10 h-10 mx-auto mb-2 opacity-50"
        fill="none" stroke="currentColor" viewBox="0 0 24 24"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
      <template v-if="!hasQuota">
        <p class="text-yellow-500 mb-1">{{ t('snapshot.noQuotaAllocated') }}</p>
        <p class="text-xs">{{ t('snapshot.allocateQuotaHint') }}</p>
      </template>
      <template v-else>
        {{ t('snapshot.noSnapshots') }}
      </template>
    </div>

    <div
      v-else
      class="divide-y"
      :class="themeStore.isDark ? 'divide-gray-800' : 'divide-gray-100'"
    >
      <div
        v-for="snapshot in snapshots"
        :key="snapshot.id"
        class="flex items-center justify-between p-4 transition-colors"
        :class="themeStore.isDark ? 'hover:bg-gray-900/50' : 'hover:bg-gray-50'"
      >
        <div class="flex items-center gap-3">
          <div
            class="w-8 h-8 rounded-lg flex items-center justify-center"
            :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-100'"
          >
            <svg class="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <div>
            <div
              class="text-sm"
              :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'"
            >
              {{ snapshot.name }}
            </div>
            <div
              class="text-xs"
              :class="themeStore.isDark ? 'text-gray-600' : 'text-gray-500'"
            >
              {{ formatDate(snapshot.created_at) }}
              <span v-if="snapshot.stateful" class="ml-2 text-yellow-500">{{ t('snapshot.statefulSnapshot') }}</span>
            </div>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <button
            :disabled="!available || busy || !canRestore || operationPending"
            :class="['btn-ghost btn-sm', !canRestore && 'opacity-50 cursor-not-allowed']"
            :title="canRestore ? t('snapshot.restore') : t('snapshot.stopInstanceFirst')"
            @click="restoreSnapshot(snapshot)"
          >
            {{ t('snapshot.restore') }}
          </button>
          <button
            class="btn-ghost btn-sm text-error"
            :title="t('snapshot.delete')"
            :disabled="!available || busy || operationPending" @click="deleteSnapshot(snapshot)"
          >
            {{ t('snapshot.delete') }}
          </button>
        </div>
      </div>
    </div>

    <!-- 创建快照弹窗 -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showCreateModal" class="modal-overlay">
          <div class="modal-backdrop" @click="closeCreateModal"></div>
          <div class="modal-content">
            <div class="modal-header">
              <h3 class="modal-title">{{ t('snapshot.createModal.title') }}</h3>
              <button class="text-themed-muted hover:text-themed" :disabled="busy" @click="closeCreateModal">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form class="modal-body" @submit.prevent="createSnapshot">
              <div>
                <label class="block text-xs text-themed-muted mb-1.5">{{ t('snapshot.createModal.name') }} <span class="text-error">{{ t('snapshot.createModal.nameRequired') }}</span></label>
                <input v-model="createForm.name" type="text" class="input" :disabled="busy" :placeholder="t('snapshot.createModal.namePlaceholder')" required />
              </div>
              <div>
                <label class="block text-xs text-themed-muted mb-1.5">{{ t('snapshot.createModal.description') }}</label>
                <input v-model="createForm.description" type="text" class="input" :disabled="busy" :placeholder="t('snapshot.createModal.descriptionPlaceholder')" />
              </div>
            </form>
            <div class="modal-footer">
              <button class="btn-secondary" :disabled="busy" @click="closeCreateModal">{{ t('snapshot.createModal.cancel') }}</button>
              <button :disabled="!available || busy || !createForm.name" class="btn-primary" @click="createSnapshot">
                {{ createLoading ? t('snapshot.createModal.creating') : t('snapshot.createModal.create') }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 自动快照策略弹窗 -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showPolicyModal" class="modal-overlay">
          <div class="modal-backdrop" @click="closePolicyModal"></div>
          <div class="modal-content">
            <div class="modal-header">
              <h3 class="modal-title">{{ t('snapshot.policyModal.title') }}</h3>
              <button class="text-themed-muted hover:text-themed" :disabled="busy" @click="closePolicyModal">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form class="modal-body" @submit.prevent="savePolicy">
              <label class="flex items-center gap-2 cursor-pointer">
                <input
                  v-model="policyForm.enabled"
                  type="checkbox"
                  :disabled="busy"
                  class="w-4 h-4 rounded"
                  :class="themeStore.isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-300'"
                />
                <span class="text-sm text-themed">{{ t('snapshot.policyModal.enable') }}</span>
              </label>

              <div v-if="policyForm.enabled" class="space-y-4 pt-2">
                <div>
                  <label class="block text-xs text-themed-muted mb-1.5">{{ t('snapshot.policyModal.interval') }}</label>
                  <select v-model="policyForm.intervalMinutes" class="input" :disabled="busy">
                    <option :value="10">{{ t('snapshot.policyModal.intervalOptions.min10') }}</option>
                    <option :value="60">{{ t('snapshot.policyModal.intervalOptions.hour1') }}</option>
                    <option :value="360">{{ t('snapshot.policyModal.intervalOptions.hour6') }}</option>
                    <option :value="1440">{{ t('snapshot.policyModal.intervalOptions.hour24') }}</option>
                  </select>
                </div>
                <p class="text-xs text-themed-muted">
                  {{ t('snapshot.policyModal.quotaFromPackage', { limit: snapshotLimit || 0 }) }}
                </p>
              </div>
            </form>
            <div class="modal-footer">
              <button class="btn-secondary" :disabled="busy" @click="closePolicyModal">{{ t('snapshot.policyModal.cancel') }}</button>
              <button :disabled="!available || busy" class="btn-primary" @click="savePolicy">
                {{ policyLoading ? t('snapshot.policyModal.saving') : t('snapshot.policyModal.save') }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
