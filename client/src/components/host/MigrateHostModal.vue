<script setup lang="ts">
import { ref, computed, watch, onMounted, onActivated, onDeactivated, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useThemeStore } from '@/stores/theme'
import { useToast } from '@/stores/toast'
import api from '@/api'
import { useAuthStore } from '@/stores/auth'
import DistroIcon from '@/components/icons/DistroIcon.vue'
import type { SystemImage } from '@/types/api'
import { translateError } from '@/utils/errorHandler'

const { t } = useI18n()
const themeStore = useThemeStore()
const toast = useToast()
const authStore = useAuthStore()

interface InstanceInfo {
  id: number
  name: string
  packagePlanId?: number | null
}

interface Props {
  visible: boolean
  hostId: number
  hostName?: string
  selectedIds: number[]
  instances?: InstanceInfo[]  // 实例信息，用于判断是否有付费实例
}

interface Host {
  id: number
  name: string
  status: string
  location?: string | null
  countryCode?: string
  instanceCount?: number
}

interface Plan {
  id: number
  name: string
  packageId: number
  packageName: string
  price: number
  billingCycle: number
}

const props = defineProps<Props>()
const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
  (e: 'success'): void
}>()
let alive = true
const pageActive = ref(false)
let hostsSequence = 0
let plansSequence = 0
let imagesSequence = 0
const sessionKey = computed(() => {
  if (!authStore.token || !authStore.user) return ''
  let identity = authStore.token
  try {
    const payload = JSON.parse(atob(identity.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    if (typeof payload.sid === 'string') identity = payload.sid
  } catch { /* Legacy tokens retain their complete identity. */ }
  return `${authStore.user.id}:${authStore.user.role}:${identity}`
})
const canRead = computed(() => alive && pageActive.value && props.visible && !!sessionKey.value && Number.isSafeInteger(props.hostId) && props.hostId > 0)
const selectedSnapshot = ref<InstanceInfo[]>([])
const selectionValid = ref(false)
const hostsError = ref('')
const plansError = ref('')
const imagesError = ref('')

// 目标节点列表
const hosts = ref<Host[]>([])
const loadingHosts = ref(false)

// 目标节点的方案列表
const plans = ref<Plan[]>([])
const loadingPlans = ref(false)

// 目标系统镜像列表
const images = ref<SystemImage[]>([])
const loadingImages = ref(false)

// 选中的目标节点
const targetHostId = ref<number | null>(null)

// 选中的目标系统
const targetImage = ref<string>('')

// 选中的目标方案（付费实例必选）
const targetPlanId = ref<number | null>(null)

// 提交状态
const isSubmitting = ref(false)

// 结果状态
const showResult = ref(false)
const result = ref<{
  success: boolean
  message: string
  successCount: number
  failedCount: number
  results: Array<{ id: number; name: string; success: boolean; error?: string }>
} | null>(null)

// 计算可选节点（排除当前节点，只显示在线节点）
const availableHosts = computed(() => {
  return hosts.value.filter(h => h.id !== props.hostId && h.status === 'online')
})

// 计算是否有付费实例需要迁移
const hasPaidInstances = computed(() => {
  return selectedSnapshot.value.some(i => i.packagePlanId !== null && i.packagePlanId !== undefined)
})

// 是否可以提交
const canSubmit = computed(() => {
  if (!canRead.value || !selectionValid.value || isSubmitting.value || loadingHosts.value || loadingPlans.value || loadingImages.value ||
    hostsError.value || imagesError.value || (hasPaidInstances.value && plansError.value)) return false
  if (!availableHosts.value.some(host => host.id === targetHostId.value)) return false
  if (!images.value.some(image => image.remoteAlias === targetImage.value)) return false
  if (hasPaidInstances.value && !plans.value.some(plan => plan.id === targetPlanId.value)) return false
  return true
})
function resetReadContext() {
  hostsSequence++
  plansSequence++
  imagesSequence++
  hosts.value = []
  plans.value = []
  images.value = []
  loadingHosts.value = false
  loadingPlans.value = false
  loadingImages.value = false
  hostsError.value = ''
  plansError.value = ''
  imagesError.value = ''
  targetHostId.value = null
  targetImage.value = ''
  targetPlanId.value = null
  selectedSnapshot.value = []
  selectionValid.value = false
  showResult.value = false
  result.value = null
}
function beginReads() {
  if (!canRead.value) return
  const ids = [...props.selectedIds]
  const validIds = ids.length > 0 && ids.length <= 30 && ids.every(id => Number.isSafeInteger(id) && id > 0) && new Set(ids).size === ids.length
  selectedSnapshot.value = (props.instances ?? []).filter(instance => ids.includes(instance.id)).map(instance => ({ ...instance }))
  selectionValid.value = validIds && selectedSnapshot.value.length === ids.length
  void loadHosts()
}
watch([() => props.visible, () => props.hostId, sessionKey], () => { resetReadContext(); beginReads() }, { flush: 'sync' })
function activateReads() {
  if (!alive || pageActive.value) return
  pageActive.value = true
  beginReads()
}
onMounted(activateReads)
onActivated(activateReads)
onDeactivated(() => { pageActive.value = false; resetReadContext() })
onUnmounted(() => { alive = false; pageActive.value = false; resetReadContext() })
function canReadDestination(hostId: number) {
  return canRead.value && !loadingHosts.value && !hostsError.value && Number.isSafeInteger(hostId) && hostId > 0 &&
    targetHostId.value === hostId && availableHosts.value.some(host => host.id === hostId)
}

// 加载节点列表
async function loadHosts() {
  if (!canRead.value) return
  const sequence = ++hostsSequence, sourceHostId = props.hostId, session = sessionKey.value
  const current = () => canRead.value && sequence === hostsSequence && sourceHostId === props.hostId && session === sessionKey.value
  loadingHosts.value = true
  hostsError.value = ''
  try {
    // 管理员只加载官方自营节点；非管理员只加载自己的节点
    const params: Record<string, unknown> = { pageSize: 100 }
    if (authStore.isAdmin) {
      params.scope = 'official'
    } else {
      params.mine = 'true'
    }
    const loaded: Host[] = [], seen = new Set<number>()
    let nextPage = 1
    while (current()) {
      const res = await api.hosts.list({ ...params, page: nextPage })
      if (!current()) return
      if (!Array.isArray(res?.hosts) || res.page !== nextPage || res.pageSize !== 100 || !Number.isSafeInteger(res.total) || res.total < 0 ||
        !Number.isSafeInteger(res.totalPages) || res.totalPages < 0 || res.totalPages !== Math.ceil(res.total / 100) || res.hosts.length > 100 ||
        res.hosts.some(host => !host || !Number.isSafeInteger(host.id) || host.id <= 0 || typeof host.name !== 'string' ||
          typeof host.status !== 'string' || (host.location != null && typeof host.location !== 'string'))) throw new Error(t('host.migrate.loadHostsFailed'))
      for (const host of res.hosts) {
        if (seen.has(host.id)) throw new Error(t('host.migrate.loadHostsFailed'))
        seen.add(host.id)
        loaded.push(host)
      }
      if (nextPage >= res.totalPages) break
      if (res.hosts.length !== 100 || nextPage >= 1000) throw new Error(t('host.migrate.loadHostsFailed'))
      nextPage++
    }
    if (!current()) return
    hosts.value = loaded
    if (!availableHosts.value.some(host => host.id === targetHostId.value)) targetHostId.value = null
  } catch (err: unknown) {
    if (!current()) return
    hosts.value = []
    targetHostId.value = null
    hostsError.value = t('host.migrate.loadHostsFailed') + ': ' + translateError(err)
  } finally {
    if (current()) loadingHosts.value = false
  }
}

// 加载目标节点的方案列表
async function loadPlans(hostId: number) {
  if (!canReadDestination(hostId) || !hasPaidInstances.value) return
  const sequence = ++plansSequence, session = sessionKey.value, previousSelection = targetPlanId.value
  const current = () => canRead.value && sequence === plansSequence && hostId === targetHostId.value && session === sessionKey.value
  loadingPlans.value = true
  plansError.value = ''
  try {
    const res = await api.hosts.getHostPlans(hostId)
    if (!current()) return
    if (!Array.isArray(res?.plans) || res.plans.some(plan => !plan || !Number.isSafeInteger(plan.id) || plan.id <= 0 ||
      !Number.isSafeInteger(plan.packageId) || plan.packageId <= 0 || typeof plan.name !== 'string' || typeof plan.packageName !== 'string' ||
      !Number.isSafeInteger(plan.price) || plan.price < 0 || !Number.isSafeInteger(plan.billingCycle) || plan.billingCycle < 1) ||
      new Set(res.plans.map(plan => plan.id)).size !== res.plans.length) throw new Error(t('host.migrate.loadPlansFailed'))
    plans.value = res.plans
    if (targetPlanId.value === previousSelection && !res.plans.some(plan => plan.id === previousSelection)) targetPlanId.value = null
  } catch (err: unknown) {
    if (!current()) return
    plans.value = []
    targetPlanId.value = null
    plansError.value = t('host.migrate.loadPlansFailed') + ': ' + translateError(err)
  } finally {
    if (current()) loadingPlans.value = false
  }
}

// 加载目标节点可用的系统镜像
async function loadImages(hostId: number) {
  if (!canReadDestination(hostId)) return
  const sequence = ++imagesSequence, session = sessionKey.value, previousSelection = targetImage.value
  const current = () => canRead.value && sequence === imagesSequence && hostId === targetHostId.value && session === sessionKey.value
  loadingImages.value = true
  imagesError.value = ''
  try {
    const res = await api.images.getSystemImages(undefined, undefined, hostId)
    if (!current()) return
    if (res?.success !== true || !Array.isArray(res.images) || res.images.some(image => !image || !Number.isSafeInteger(image.id) || image.id <= 0 ||
      typeof image.name !== 'string' || typeof image.remoteAlias !== 'string' || !image.remoteAlias || !['x86_64', 'aarch64'].includes(image.architecture)) ||
      new Set(res.images.map(image => image.id)).size !== res.images.length) throw new Error(t('host.migrate.loadImagesFailed'))
    images.value = res.images
    if (targetImage.value === previousSelection && !res.images.some(image => image.remoteAlias === previousSelection)) targetImage.value = images.value[0]?.remoteAlias || ''
  } catch (err: unknown) {
    if (!current()) return
    images.value = []
    targetImage.value = ''
    imagesError.value = t('host.migrate.loadImagesFailed') + ': ' + translateError(err)
  } finally {
    if (current()) loadingImages.value = false
  }
}

// 提交迁移
async function handleSubmit() {
  if (!canSubmit.value) return
  if (!targetHostId.value) {
    toast.error(t('host.migrate.selectTargetRequired'))
    return
  }

  if (!targetImage.value) {
    toast.error(t('host.migrate.selectImageRequired'))
    return
  }

  if (hasPaidInstances.value && !targetPlanId.value) {
    toast.error(t('host.migrate.selectPlanRequired'))
    return
  }

  if (selectedSnapshot.value.length === 0) {
    toast.error(t('host.migrate.noInstancesSelected'))
    return
  }

  isSubmitting.value = true
  try {
    const res = await api.hosts.migrateInstances(
      props.hostId,
      selectedSnapshot.value.map(instance => instance.id),
      targetHostId.value,
      targetImage.value,
      hasPaidInstances.value ? targetPlanId.value ?? undefined : undefined
    )
    result.value = {
      success: res.failedCount === 0,
      message: res.message,
      successCount: res.successCount,
      failedCount: res.failedCount,
      results: res.results
    }
    showResult.value = true

    if (res.successCount > 0) {
      emit('success')
    }
  } catch (err: any) {
    toast.error(t('host.migrate.failed') + ': ' + (err?.message || String(err)))
  } finally {
    isSubmitting.value = false
  }
}

// 关闭弹窗
function closeModal() {
  if (isSubmitting.value) return
  emit('update:visible', false)
  resetReadContext()
}

// 监听目标节点变化，加载方案列表
watch(targetHostId, (newHostId) => {
  plansSequence++
  imagesSequence++
  plans.value = []
  images.value = []
  targetPlanId.value = null
  targetImage.value = ''
  loadingPlans.value = false
  loadingImages.value = false
  plansError.value = ''
  imagesError.value = ''
  if (newHostId) {
    loadImages(newHostId)
  } else {
    images.value = []
    targetImage.value = ''
  }

  if (newHostId && hasPaidInstances.value) {
    loadPlans(newHostId)
  } else {
    plans.value = []
    targetPlanId.value = null
  }
}, { flush: 'sync' })
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="visible" class="modal-overlay">
        <div class="modal-backdrop" @click="closeModal"></div>
        <div class="modal-content max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
          <!-- 标题栏 -->
          <div class="modal-header">
            <h3 class="modal-title">{{ t('host.migrate.title') }}</h3>
            <button class="text-themed-muted hover:text-themed" :disabled="isSubmitting" @click="closeModal">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <!-- 内容区域 -->
          <div class="modal-body overflow-y-auto flex-1">
            <!-- 结果显示 -->
            <template v-if="showResult && result">
              <div class="text-center py-4">
                <div
                  v-if="result.failedCount === 0"
                  class="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center"
                  :class="themeStore.isDark ? 'bg-green-900/30' : 'bg-green-100'"
                >
                  <svg class="w-8 h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div
                  v-else
                  class="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center"
                  :class="themeStore.isDark ? 'bg-yellow-900/30' : 'bg-yellow-100'"
                >
                  <svg class="w-8 h-8 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <p class="text-lg font-medium text-themed mb-2">{{ result.message }}</p>
                <p class="text-sm text-themed-secondary">
                  {{ t('host.migrate.resultSummary', { success: result.successCount, failed: result.failedCount }) }}
                </p>

                <!-- 失败详情 -->
                <div
                  v-if="result.failedCount > 0"
                  class="mt-4 text-left rounded-lg p-3 max-h-40 overflow-y-auto"
                  :class="themeStore.isDark ? 'bg-red-900/20' : 'bg-red-50'"
                >
                  <p class="text-sm font-medium text-red-500 mb-2">{{ t('host.migrate.failedInstances') }}:</p>
                  <ul class="text-xs space-y-1">
                    <li
                      v-for="item in result.results.filter(r => !r.success)"
                      :key="item.id"
                      class="text-themed-secondary"
                    >
                      <span class="font-mono">{{ item.name }}</span>: {{ item.error }}
                    </li>
                  </ul>
                </div>
              </div>
            </template>

            <!-- 表单 -->
            <template v-else>
              <!-- 已选实例数量 -->
              <div
                class="flex items-center gap-2 p-3 rounded-lg"
                :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-100'"
              >
                <svg class="w-5 h-5 text-themed-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                <span class="text-sm text-themed">
                  {{ t('host.migrate.selectedCount', { count: selectedSnapshot.length }) }}
                </span>
              </div>

              <!-- 目标节点选择 -->
              <div>
                <label for="migrate-target-host" class="block text-sm font-medium text-themed-secondary mb-2">
                  {{ t('host.migrate.targetNode') }}
                </label>
                <select
                  id="migrate-target-host"
                  v-model="targetHostId"
                  class="input w-full"
                  :disabled="!canRead || loadingHosts || isSubmitting"
                >
                  <option :value="null" disabled>{{ t('host.migrate.selectTarget') }}</option>
                  <option
                    v-for="host in availableHosts"
                    :key="host.id"
                    :value="host.id"
                  >
                    {{ host.name }}{{ host.location ? ` (${host.location})` : '' }}
                    - {{ host.instanceCount || 0 }} {{ t('host.migrate.instances') }}
                  </option>
                </select>
                <p v-if="loadingHosts" class="text-xs text-themed-muted mt-1">
                  {{ t('common.loading') }}...
                </p>
                <div v-if="hostsError" role="alert" data-hosts-error class="mt-2 text-sm text-red-500 break-words">
                  {{ hostsError }}
                  <button class="btn-secondary mt-2" :disabled="loadingHosts || !canRead || isSubmitting" @click="loadHosts">{{ t('common.retry') }}</button>
                </div>
              </div>

              <!-- 目标系统选择 -->
              <div v-if="targetHostId">
                <label for="migrate-target-image" class="block text-sm font-medium text-themed-secondary mb-2">
                  {{ t('host.migrate.targetImage') }} <span class="text-red-500">*</span>
                </label>
                <select
                  id="migrate-target-image"
                  v-model="targetImage"
                  class="input w-full"
                  :disabled="!canRead || isSubmitting || loadingHosts || loadingImages || images.length === 0"
                >
                  <option value="" disabled>{{ t('host.migrate.selectImage') }}</option>
                  <option
                    v-for="image in images"
                    :key="image.id"
                    :value="image.remoteAlias"
                  >
                    {{ image.name }} ({{ image.remoteAlias }})
                  </option>
                </select>
                <div v-if="targetImage" class="mt-2 flex items-center gap-2 text-xs text-themed-muted">
                  <DistroIcon
                    :distro="images.find(image => image.remoteAlias === targetImage)?.icon || targetImage"
                    :size="16"
                    class="flex-shrink-0"
                  />
                  <span>{{ t('host.migrate.imageHint') }}</span>
                </div>
                <p v-if="loadingImages" class="text-xs text-themed-muted mt-1">
                  {{ t('common.loading') }}...
                </p>
                <div v-else-if="imagesError" role="alert" data-images-error class="mt-2 text-sm text-red-500 break-words">
                  {{ imagesError }}
                  <button class="btn-secondary mt-2" :disabled="!canRead || isSubmitting" @click="loadImages(targetHostId)">{{ t('common.retry') }}</button>
                </div>
                <p v-else-if="images.length === 0" class="text-xs text-red-500 mt-1">
                  {{ t('host.migrate.noImageAvailable') }}
                </p>
              </div>

              <!-- 目标方案选择（付费实例必选） -->
              <div v-if="hasPaidInstances && targetHostId">
                <label for="migrate-target-plan" class="block text-sm font-medium text-themed-secondary mb-2">
                  {{ t('host.migrate.targetPlan') }} <span class="text-red-500">*</span>
                </label>
                <select
                  id="migrate-target-plan"
                  v-model="targetPlanId"
                  class="input w-full"
                  :disabled="!canRead || isSubmitting || loadingHosts || loadingPlans || plans.length === 0"
                >
                  <option :value="null" disabled>{{ t('host.migrate.selectPlan') }}</option>
                  <option
                    v-for="plan in plans"
                    :key="plan.id"
                    :value="plan.id"
                  >
                    {{ plan.packageName }} - {{ plan.name }} (¥{{ (plan.price / 100).toFixed(2) }}/{{ plan.billingCycle }}{{ t('common.month') }})
                  </option>
                </select>
                <p v-if="loadingPlans" class="text-xs text-themed-muted mt-1">
                  {{ t('common.loading') }}...
                </p>
                <div v-else-if="plansError" role="alert" data-plans-error class="mt-2 text-sm text-red-500 break-words">
                  {{ plansError }}
                  <button class="btn-secondary mt-2" :disabled="!canRead || isSubmitting" @click="loadPlans(targetHostId)">{{ t('common.retry') }}</button>
                </div>
                <p v-else-if="plans.length === 0" class="text-xs text-red-500 mt-1">
                  {{ t('host.migrate.noPlanAvailable') }}
                </p>
                <p v-else class="text-xs text-themed-muted mt-1">
                  {{ t('host.migrate.planHint') }}
                </p>
              </div>

              <!-- 警告提示 -->
              <div
                class="flex items-start gap-2 p-3 rounded-lg"
                :class="themeStore.isDark ? 'bg-yellow-900/20' : 'bg-yellow-50'"
              >
                <svg class="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div class="text-sm text-themed-secondary">
                  <p class="font-medium text-yellow-600 dark:text-yellow-400 mb-1">
                    {{ t('host.migrate.warning') }}
                  </p>
                  <ul class="list-disc list-inside space-y-0.5 text-xs">
                    <li>{{ t('host.migrate.warningCloudInit') }}</li>
                    <li>{{ t('host.migrate.warningImage') }}</li>
                    <li>{{ t('host.migrate.warningIp') }}</li>
                    <li>{{ t('host.migrate.warningNotify') }}</li>
                  </ul>
                </div>
              </div>
            </template>
          </div>

          <!-- 底部按钮 -->
          <div class="modal-footer">
            <template v-if="showResult">
              <button class="btn-secondary" @click="closeModal">
                {{ t('common.close') }}
              </button>
            </template>
            <template v-else>
              <button class="btn-secondary" :disabled="isSubmitting" @click="closeModal">
                {{ t('common.cancel') }}
              </button>
              <button
                class="btn-primary"
                :disabled="!canSubmit || isSubmitting || loadingHosts || loadingPlans || loadingImages"
                @click="handleSubmit"
              >
                <svg v-if="isSubmitting" class="w-4 h-4 mr-1 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
                {{ isSubmitting ? t('host.migrate.migrating') : t('host.migrate.confirm') }}
              </button>
            </template>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* 使用全局 modal 过渡动画，无需额外样式 */
</style>
