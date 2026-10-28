<script setup lang="ts">
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import api, {
  type VipBenefitReward,
  type VipBenefitRewardInput,
  type VipBenefitRewardType,
  type VipLevelRule,
  type UserVipMetric
} from '@/api/admin'
import SkeletonLoader from '@/components/SkeletonLoader.vue'
import { useToast } from '@/stores/toast'
import { useAuthStore } from '@/stores/auth'
import type { Package } from '@/types/api'
import { normalizeVipBadgeStyle, getVipBadgeInlineStyle } from '@/utils/vipBadge'

interface PackagePlanOption {
  id: number
  name: string
  price: number
  billingCycle: number
  isActive: boolean
  isSoldOut: boolean
}

interface EditableReward {
  localId: number
  id: number | null
  level: number
  type: VipBenefitRewardType
  title: string
  description: string
  claimLimit: number
  sortOrder: number
  enabled: boolean
  amount: number
  packageId: number | null
  packageName: string | null
  planId: number | null
  planName: string | null
  days: number
  quantity: number
}

const { t } = useI18n()
const toast = useToast()
const auth = useAuthStore()
const mounted = ref(false), activated = ref(true)
const sessionKey = computed(() => {
  if (!auth.token || !auth.user || auth.user.role !== 'admin') return ''
  let identity = auth.token
  try {
    const payload = JSON.parse(atob(identity.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    if (typeof payload.sid === 'string') identity = payload.sid
  } catch { /* Legacy tokens retain their full identity. */ }
  return `${auth.user.id}:${auth.user.role}:${identity}`
})
const active = computed(() => mounted.value && activated.value && !!sessionKey.value)
let disposed = false, contextSequence = 0, readSequence = 0
function currentContext(context: number) { return !disposed && active.value && context === contextSequence }

const loading = ref(true)
const saving = ref(false)
const ready = ref(false)
const loadError = ref('')
const saveError = ref('')
const reloadRequired = ref(false)
const editorDisabled = computed(() => !active.value || !ready.value || loading.value || saving.value || reloadRequired.value)
const rules = ref<VipLevelRule[]>([])
const userMetric = ref<UserVipMetric>('totalRecharge')
const rewards = ref<EditableReward[]>([])
const deletedRewardIds = ref<number[]>([])
const packages = ref<Package[]>([])
const packagePlans = ref<Record<number, PackagePlanOption[]>>({})
const plansLoading = ref<Record<number, boolean>>({})
let tempId = -1

const enabledRules = computed(() => rules.value.filter(rule => rule.enabled))
const packageOptions = computed(() => packages.value.filter(pkg => pkg.active === 1))

const rewardsByLevel = computed(() => {
  const map = new Map<number, EditableReward[]>()
  for (const reward of rewards.value) {
    const list = map.get(reward.level) || []
    list.push(reward)
    map.set(reward.level, list)
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.sortOrder - b.sortOrder || a.localId - b.localId)
  }
  return map
})

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function toPositiveInt(value: unknown, fallback = 1): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

function formatCurrency(value: number): string {
  return `¥${toNumber(value).toFixed(2)}`
}

function getPackageName(packageId: number | null | undefined): string | null {
  if (!packageId) return null
  return packages.value.find(pkg => pkg.id === packageId)?.name || null
}

function getPlanName(packageId: number | null | undefined, planId: number | null | undefined): string | null {
  if (!packageId || !planId) return null
  return packagePlans.value[packageId]?.find(plan => plan.id === planId)?.name || null
}

function mapReward(reward: VipBenefitReward): EditableReward {
  return {
    localId: reward.id,
    id: reward.id,
    level: reward.level,
    type: reward.type,
    title: reward.title,
    description: reward.description || '',
    claimLimit: reward.claimLimit || 1,
    sortOrder: reward.sortOrder || 0,
    enabled: reward.enabled !== false,
    amount: toNumber(reward.config?.amount),
    packageId: reward.config?.packageId ? Number(reward.config.packageId) : null,
    packageName: reward.config?.packageName || null,
    planId: reward.config?.planId ? Number(reward.config.planId) : null,
    planName: reward.config?.planName || null,
    days: toPositiveInt(reward.config?.days, 30),
    quantity: toPositiveInt(reward.config?.quantity, 1)
  }
}

function newReward(level: number): EditableReward {
  return {
    localId: tempId--,
    id: null,
    level,
    type: 'balance',
    title: `VIP${level} ${t('admin.vipBenefits.rewardDefaultTitle')}`,
    description: '',
    claimLimit: 1,
    sortOrder: (rewardsByLevel.value.get(level)?.length || 0) * 10 + 10,
    enabled: true,
    amount: 0,
    packageId: null,
    packageName: null,
    planId: null,
    planName: null,
    days: 30,
    quantity: 1
  }
}

function addReward(level: number): void {
  if (editorDisabled.value) return
  rewards.value.push(newReward(level))
}

function removeReward(reward: EditableReward): void {
  if (editorDisabled.value) return
  if (reward.id) {
    deletedRewardIds.value.push(reward.id)
  }
  rewards.value = rewards.value.filter(item => item.localId !== reward.localId)
}

async function ensurePlans(packageId: number | null | undefined): Promise<void> {
  if (!active.value || !packageId || packagePlans.value[packageId] || plansLoading.value[packageId]) return
  const context = contextSequence, request = readSequence
  const current = () => currentContext(context) && request === readSequence
  plansLoading.value = { ...plansLoading.value, [packageId]: true }
  try {
    const response = await api.packages.getPlans(packageId, { activeOnly: true })
    if (!current()) return
    packagePlans.value = {
      ...packagePlans.value,
      [packageId]: response.plans || []
    }
  } catch (error: any) {
    if (!current()) return
    toast.error(error?.message || t('admin.vipBenefits.loadPlansFailed'))
  } finally {
    if (current()) plansLoading.value = { ...plansLoading.value, [packageId]: false }
  }
}

async function handlePackageChange(reward: EditableReward): Promise<void> {
  if (editorDisabled.value) return
  reward.packageId = reward.packageId ? Number(reward.packageId) : null
  reward.packageName = getPackageName(reward.packageId)
  reward.planId = null
  reward.planName = null
  await ensurePlans(reward.packageId)
}

function handlePlanChange(reward: EditableReward): void {
  if (editorDisabled.value) return
  reward.planId = reward.planId ? Number(reward.planId) : null
  reward.packageName = getPackageName(reward.packageId)
  reward.planName = getPlanName(reward.packageId, reward.planId)
}

function normalizeRewardPayload(reward: EditableReward): VipBenefitRewardInput {
  const base = {
    level: reward.level,
    type: reward.type,
    title: reward.title.trim(),
    description: reward.description.trim() || null,
    claimLimit: Math.max(1, Math.floor(toNumber(reward.claimLimit, 1))),
    sortOrder: Math.max(0, Math.floor(toNumber(reward.sortOrder))),
    enabled: reward.enabled
  }

  if (reward.type === 'balance') {
    return {
      ...base,
      config: {
        amount: Math.round(toNumber(reward.amount) * 100) / 100
      }
    }
  }
  if (reward.type === 'points') {
    return {
      ...base,
      config: {
        amount: Math.max(1, Math.floor(toNumber(reward.amount)))
      }
    }
  }

  return {
    ...base,
    config: {
      packageId: reward.packageId,
      packageName: getPackageName(reward.packageId) || reward.packageName,
      planId: reward.planId,
      planName: getPlanName(reward.packageId, reward.planId) || reward.planName,
      days: Math.max(1, Math.floor(toNumber(reward.days, 30))),
      quantity: Math.max(1, Math.min(10, Math.floor(toNumber(reward.quantity, 1))))
    }
  }
}

function validateRewards(): boolean {
  for (const reward of rewards.value) {
    if (!reward.title.trim()) {
      toast.error(t('admin.vipBenefits.titleRequired', { level: reward.level }))
      return false
    }
    if (toPositiveInt(reward.claimLimit, 0) <= 0) {
      toast.error(t('admin.vipBenefits.claimLimitInvalid', { level: reward.level }))
      return false
    }
    if ((reward.type === 'balance' || reward.type === 'points') && toNumber(reward.amount) <= 0) {
      toast.error(t('admin.vipBenefits.amountInvalid', { level: reward.level }))
      return false
    }
    if (reward.type === 'balance' && (Math.round(toNumber(reward.amount) * 100) <= 0 || toNumber(reward.amount) > 99999999.99)) {
      toast.error(t('admin.vipBenefits.amountInvalid', { level: reward.level }))
      return false
    }
    if (reward.type === 'instance') {
      if (!reward.packageId || !reward.planId) {
        toast.error(t('admin.vipBenefits.instancePlanRequired', { level: reward.level }))
        return false
      }
      if (toPositiveInt(reward.days, 0) <= 0 || toPositiveInt(reward.quantity, 0) <= 0) {
        toast.error(t('admin.vipBenefits.instanceQuantityInvalid', { level: reward.level }))
        return false
      }
    }
  }
  return true
}

async function loadData(): Promise<boolean> {
  if (!active.value) return false
  const context = contextSequence, request = ++readSequence
  const current = () => currentContext(context) && request === readSequence
  loading.value = true
  ready.value = false
  loadError.value = ''
  packagePlans.value = {}
  plansLoading.value = {}
  try {
    const [rulesResponse, rewardsResponse, packagesResponse] = await Promise.all([
      api.admin.getVipLevelRules('user'),
      api.admin.getVipBenefitRewards(),
      api.packages.list({ all: true, scope: 'official' })
    ])
    if (!current()) return false
    userMetric.value = rulesResponse.userMetric === 'totalConsume' ? 'totalConsume' : 'totalRecharge'
    rules.value = rulesResponse.rules || []
    rewards.value = (rewardsResponse.rewards || []).map(mapReward)
    packages.value = packagesResponse.packages || []
    deletedRewardIds.value = []

    const packageIds = new Set<number>()
    for (const reward of rewards.value) {
      if (reward.packageId) packageIds.add(reward.packageId)
    }
    await Promise.all(Array.from(packageIds).map(id => ensurePlans(id)))
    if (!current()) return false
    ready.value = true
    reloadRequired.value = false
    saveError.value = ''
    return true
  } catch (error: any) {
    if (current()) loadError.value = error?.message || t('admin.vipBenefits.loadFailed')
    return false
  } finally {
    if (current()) loading.value = false
  }
}

async function saveRewards(): Promise<void> {
  if (editorDisabled.value || !validateRewards()) return
  const context = contextSequence
  const removals = [...deletedRewardIds.value]
  const updates = rewards.value.map(reward => ({ localId: reward.localId, id: reward.id, payload: normalizeRewardPayload(reward) }))
  saving.value = true
  saveError.value = ''
  try {
    for (const id of removals) {
      await api.admin.deleteVipBenefitReward(id)
      if (!currentContext(context)) return
      deletedRewardIds.value = deletedRewardIds.value.filter(value => value !== id)
    }

    for (const reward of updates) {
      if (reward.id) {
        await api.admin.updateVipBenefitReward(reward.id, reward.payload)
      } else {
        const response = await api.admin.createVipBenefitReward(reward.payload)
        if (!currentContext(context)) return
        if (!Number.isSafeInteger(response.reward?.id) || response.reward.id <= 0) throw new Error(t('admin.vipBenefits.saveFailed'))
        const draft = rewards.value.find(item => item.localId === reward.localId)
        if (draft) draft.id = response.reward.id
      }
      if (!currentContext(context)) return
    }

    reloadRequired.value = true
    const refreshed = await loadData()
    if (currentContext(context) && refreshed) toast.success(t('admin.vipBenefits.saveSuccess'))
  } catch (error: any) {
    if (!currentContext(context)) return
    reloadRequired.value = true
    saveError.value = error?.message || t('admin.vipBenefits.saveFailed')
  } finally {
    saving.value = false
    // Returning to a cached page during a write waits for its outcome before reading again.
    if (!currentContext(context) && active.value && !disposed) void loadData()
  }
}

function retryLoad(): void {
  if (!active.value || saving.value || loading.value) return
  void loadData()
}

function rewardPreview(reward: EditableReward): string {
  if (reward.type === 'balance') {
    return formatCurrency(toNumber(reward.amount))
  }
  if (reward.type === 'points') {
    return t('admin.vipBenefits.pointsPreview', { amount: Math.floor(toNumber(reward.amount)) })
  }
  const planName = getPlanName(reward.packageId, reward.planId) || reward.planName || t('admin.vipBenefits.selectPlan')
  return t('admin.vipBenefits.instancePreviewWithPlan', { plan: planName, days: reward.days, quantity: reward.quantity })
}

watch([active, sessionKey], () => {
  contextSequence++
  readSequence++
  ready.value = false
  loadError.value = ''
  saveError.value = ''
  reloadRequired.value = false
  rules.value = []
  rewards.value = []
  deletedRewardIds.value = []
  packages.value = []
  packagePlans.value = {}
  plansLoading.value = {}
  loading.value = active.value
  if (active.value && !saving.value) void loadData()
}, { flush: 'sync' })
onMounted(() => { mounted.value = true })
onActivated(() => { activated.value = true })
onDeactivated(() => { activated.value = false })
onUnmounted(() => { disposed = true; contextSequence++; readSequence++ })
</script>

<template>
  <div class="space-y-4">
    <div class="card p-5">
      <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div class="min-w-0">
          <h2 class="text-lg font-semibold text-themed">{{ t('admin.vipBenefits.title') }}</h2>
          <p class="mt-1 text-sm text-themed-muted">{{ t('admin.vipBenefits.description') }}</p>
        </div>
        <button class="btn btn-primary self-start lg:self-auto" :disabled="editorDisabled" @click="saveRewards">
          {{ saving ? t('common.saving') : t('admin.vipBenefits.save') }}
        </button>
      </div>

      <div class="mt-4 grid gap-3 text-sm md:grid-cols-3">
        <div class="rounded border border-themed bg-themed-secondary/30 p-3">
          <div class="font-semibold text-themed">{{ t('admin.vipBenefits.balanceTitle') }}</div>
          <div class="mt-1 text-xs text-themed-muted">{{ t('admin.vipBenefits.balanceDesc') }}</div>
        </div>
        <div class="rounded border border-themed bg-themed-secondary/30 p-3">
          <div class="font-semibold text-themed">{{ t('admin.vipBenefits.pointsTitle') }}</div>
          <div class="mt-1 text-xs text-themed-muted">{{ t('admin.vipBenefits.pointsDesc') }}</div>
        </div>
        <div class="rounded border border-themed bg-themed-secondary/30 p-3">
          <div class="font-semibold text-themed">{{ t('admin.vipBenefits.instanceTitle') }}</div>
          <div class="mt-1 text-xs text-themed-muted">{{ t('admin.vipBenefits.instanceDesc') }}</div>
        </div>
      </div>
    </div>

    <div v-if="loadError || reloadRequired" class="card p-5" role="alert">
      <p class="break-words text-sm text-red-600 dark:text-red-400">{{ loadError || saveError }}</p>
      <p v-if="reloadRequired" class="mt-2 text-sm text-themed-muted">{{ t('admin.vipBenefits.reloadRequired') }}</p>
      <button class="btn btn-secondary mt-3" type="button" :disabled="loading || saving" @click="retryLoad">
        {{ reloadRequired ? t('admin.vipBenefits.reloadSaved') : t('common.retry') }}
      </button>
    </div>

    <div v-if="loading" class="card p-6">
      <SkeletonLoader type="table" :rows="5" />
    </div>

    <div v-else-if="ready && enabledRules.length === 0" class="card p-8 text-center text-sm text-themed-muted">
      {{ t('admin.vipBenefits.noEnabledLevels') }}
    </div>

    <fieldset v-else-if="ready" class="min-w-0 space-y-4" :disabled="editorDisabled">
      <section v-for="rule in enabledRules" :key="rule.level" class="card overflow-hidden">
        <div class="flex flex-col gap-3 border-b border-themed px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div class="flex items-center gap-3">
            <span
              class="inline-flex items-center rounded-full border px-3 py-1 text-sm font-semibold"
              :style="getVipBadgeInlineStyle(normalizeVipBadgeStyle(rule.badgeStyle || rule.benefits?.badgeStyle, rule.level))"
            >
              VIP{{ rule.level }}
            </span>
            <div>
              <div class="font-semibold text-themed">{{ t('admin.vipBenefits.levelTitle', { level: rule.level }) }}</div>
              <div class="text-xs text-themed-muted">{{ t('admin.vipBenefits.levelHint') }}</div>
            </div>
          </div>
          <button class="btn btn-secondary self-start lg:self-auto" type="button" @click="addReward(rule.level)">
            {{ t('admin.vipBenefits.addReward') }}
          </button>
        </div>

        <div v-if="(rewardsByLevel.get(rule.level) || []).length === 0" class="p-6 text-sm text-themed-muted">
          {{ t('admin.vipBenefits.noRewardsForLevel') }}
        </div>

        <div v-else class="grid gap-4 p-5 xl:grid-cols-2">
          <article
            v-for="reward in rewardsByLevel.get(rule.level) || []"
            :key="reward.localId"
            class="rounded border border-themed p-4"
          >
            <div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="rounded-full bg-themed-secondary px-2.5 py-1 text-xs font-medium text-themed">
                    {{ t(`admin.vipBenefits.types.${reward.type}`) }}
                  </span>
                  <span class="text-xs text-themed-muted">{{ rewardPreview(reward) }}</span>
                </div>
                <label class="mt-3 block text-xs font-medium text-themed-muted">{{ t('admin.vipBenefits.rewardTitle') }}</label>
                <input v-model="reward.title" class="input mt-1" maxlength="80" />
              </div>
              <button class="btn btn-ghost text-red-500 hover:text-red-600" type="button" @click="removeReward(reward)">
                {{ t('common.delete') }}
              </button>
            </div>

            <div class="grid gap-3 md:grid-cols-2">
              <div>
                <label class="mb-1.5 block text-xs font-medium text-themed-muted">{{ t('admin.vipBenefits.rewardType') }}</label>
                <select v-model="reward.type" class="input">
                  <option value="balance">{{ t('admin.vipBenefits.types.balance') }}</option>
                  <option value="points">{{ t('admin.vipBenefits.types.points') }}</option>
                  <option value="instance">{{ t('admin.vipBenefits.types.instance') }}</option>
                </select>
              </div>
              <div>
                <label class="mb-1.5 block text-xs font-medium text-themed-muted">{{ t('admin.vipBenefits.claimLimit') }}</label>
                <input v-model="reward.claimLimit" type="number" min="1" max="100" step="1" class="input" />
              </div>
              <div>
                <label class="mb-1.5 block text-xs font-medium text-themed-muted">{{ t('admin.vipBenefits.sortOrder') }}</label>
                <input v-model="reward.sortOrder" type="number" min="0" step="1" class="input" />
              </div>
              <label class="flex items-center gap-2 pt-6 text-sm text-themed">
                <input v-model="reward.enabled" type="checkbox" class="rounded border-themed text-primary-600 focus:ring-primary-500" />
                {{ reward.enabled ? t('admin.vipBenefits.enabled') : t('admin.vipBenefits.disabled') }}
              </label>
            </div>

            <div class="mt-3">
              <label class="mb-1.5 block text-xs font-medium text-themed-muted">{{ t('admin.vipBenefits.rewardDescription') }}</label>
              <textarea v-model="reward.description" class="input min-h-20 resize-y" maxlength="300"></textarea>
            </div>

            <div v-if="reward.type === 'balance' || reward.type === 'points'" class="mt-3">
              <label class="mb-1.5 block text-xs font-medium text-themed-muted">
                {{ reward.type === 'balance' ? t('admin.vipBenefits.balanceAmount') : t('admin.vipBenefits.pointsAmount') }}
              </label>
              <input
                v-model="reward.amount"
                type="number"
                min="0"
                :step="reward.type === 'balance' ? '0.01' : '1'"
                class="input"
              />
            </div>

            <div v-else class="mt-3 grid gap-3 md:grid-cols-2">
              <div>
                <label class="mb-1.5 block text-xs font-medium text-themed-muted">{{ t('admin.vipBenefits.package') }}</label>
                <select v-model.number="reward.packageId" class="input" @change="handlePackageChange(reward)">
                  <option :value="0">{{ t('admin.vipBenefits.selectPackage') }}</option>
                  <option v-for="pkg in packageOptions" :key="pkg.id" :value="pkg.id">{{ pkg.name }}</option>
                </select>
              </div>
              <div>
                <label class="mb-1.5 block text-xs font-medium text-themed-muted">{{ t('admin.vipBenefits.plan') }}</label>
                <select
                  v-model.number="reward.planId"
                  class="input"
                  :disabled="!reward.packageId || plansLoading[reward.packageId]"
                  @change="handlePlanChange(reward)"
                >
                  <option :value="0">
                    {{ plansLoading[reward.packageId || 0] ? t('common.loading') : t('admin.vipBenefits.selectPlan') }}
                  </option>
                  <option v-for="plan in packagePlans[reward.packageId || 0] || []" :key="plan.id" :value="plan.id">
                    {{ plan.name }} · {{ formatCurrency(plan.price) }}
                  </option>
                </select>
              </div>
              <div>
                <label class="mb-1.5 block text-xs font-medium text-themed-muted">{{ t('admin.vipBenefits.instanceDays') }}</label>
                <input v-model="reward.days" type="number" min="1" step="1" class="input" />
              </div>
              <div>
                <label class="mb-1.5 block text-xs font-medium text-themed-muted">{{ t('admin.vipBenefits.instanceQuantity') }}</label>
                <input v-model="reward.quantity" type="number" min="1" max="10" step="1" class="input" />
              </div>
            </div>
          </article>
        </div>
      </section>

      <div class="flex justify-end">
        <button class="btn btn-primary" :disabled="editorDisabled" @click="saveRewards">
          {{ saving ? t('common.saving') : t('admin.vipBenefits.save') }}
        </button>
      </div>
    </fieldset>
  </div>
</template>
