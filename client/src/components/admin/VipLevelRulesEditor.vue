<script setup lang="ts">
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import api, { type UserVipMetric, type VipConditionMode, type VipLevelRule, type VipRuleType } from '@/api/admin'
import SkeletonLoader from '@/components/SkeletonLoader.vue'
import { useToast } from '@/stores/toast'
import { useAuthStore } from '@/stores/auth'
import { getDefaultVipBadgeStyle, getVipBadgeInlineStyle, normalizeVipBadgeStyle, type VipBadgeStyle } from '@/utils/vipBadge'

interface EditableVipRule {
  level: number
  enabled: boolean
  conditionMode: VipConditionMode
  badgeStyle: VipBadgeStyle
  benefits: Record<string, unknown>
  minRecharge: string | number | null
  minConsume: string | number | null
  minHostingIncome: string | number | null
  minHostingInstances: string | number | null
}

const props = defineProps<{
  type: VipRuleType
}>()

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
const editorDisabled = computed(() => !active.value || loading.value || saving.value || !ready.value)
const maxLevel = ref(10)
const rules = ref<EditableVipRule[]>([])
const userMetric = ref<UserVipMetric>('totalRecharge')

const isUserRules = computed(() => props.type === 'user')
const title = computed(() => isUserRules.value ? t('admin.vipRules.userTitle') : t('admin.vipRules.hostingTitle'))
const description = computed(() => isUserRules.value ? t('admin.vipRules.userDescription') : t('admin.vipRules.hostingDescription'))
const userMetricThresholdLabel = computed(() => userMetric.value === 'totalRecharge'
  ? t('admin.vipRules.minRecharge')
  : t('admin.vipRules.minConsume')
)

function emptyRule(level: number): EditableVipRule {
  return {
    level,
    enabled: false,
    conditionMode: 'any',
    badgeStyle: getDefaultVipBadgeStyle(level),
    benefits: {},
    minRecharge: '',
    minConsume: '',
    minHostingIncome: '',
    minHostingInstances: ''
  }
}

function toInputValue(value: number | null | undefined): string {
  return value === null || value === undefined || value <= 0 ? '' : String(value)
}

function mapApiRule(rule: VipLevelRule): EditableVipRule {
  return {
    level: rule.level,
    enabled: rule.enabled,
    conditionMode: rule.conditionMode,
    badgeStyle: normalizeVipBadgeStyle(rule.badgeStyle || rule.benefits?.badgeStyle, rule.level),
    benefits: rule.benefits || {},
    minRecharge: toInputValue(rule.minRecharge),
    minConsume: toInputValue(rule.minConsume),
    minHostingIncome: toInputValue(rule.minHostingIncome),
    minHostingInstances: toInputValue(rule.minHostingInstances)
  }
}

function normalizeInputValue(value: string | number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value).trim()
}

function parseOptionalNumber(value: string | number | null | undefined): number | null {
  const trimmed = normalizeInputValue(value)
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function parseOptionalInteger(value: string | number | null | undefined): number | null {
  const trimmed = normalizeInputValue(value)
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function hasInvalidPositiveNumber(value: string | number | null | undefined): boolean {
  const trimmed = normalizeInputValue(value)
  if (!trimmed) return false
  const parsed = Number(trimmed)
  return !Number.isFinite(parsed) || parsed <= 0
}

function isValidHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value)
}

function hasCondition(rule: EditableVipRule): boolean {
  if (isUserRules.value) {
    return userMetric.value === 'totalRecharge'
      ? parseOptionalNumber(rule.minRecharge) !== null
      : parseOptionalNumber(rule.minConsume) !== null
  }
  return parseOptionalNumber(rule.minHostingIncome) !== null || parseOptionalInteger(rule.minHostingInstances) !== null
}

function buildPayload(): VipLevelRule[] {
  return rules.value
    .map(rule => ({
      type: props.type,
      level: rule.level,
      enabled: rule.enabled,
      conditionMode: isUserRules.value ? 'any' : rule.conditionMode,
      userMetric: isUserRules.value ? userMetric.value : undefined,
      minRecharge: isUserRules.value && userMetric.value === 'totalRecharge' ? parseOptionalNumber(rule.minRecharge) : null,
      minConsume: isUserRules.value && userMetric.value === 'totalConsume' ? parseOptionalNumber(rule.minConsume) : null,
      minHostingIncome: isUserRules.value ? null : parseOptionalNumber(rule.minHostingIncome),
      minHostingInstances: isUserRules.value ? null : parseOptionalInteger(rule.minHostingInstances),
      benefits: {
        ...rule.benefits,
        badgeStyle: normalizeVipBadgeStyle(rule.badgeStyle, rule.level)
      }
    }))
}

function hydrateRules(apiRules: VipLevelRule[]) {
  const ruleMap = new Map(apiRules.map(rule => [rule.level, mapApiRule(rule)]))
  rules.value = Array.from({ length: maxLevel.value }, (_, index) => {
    const level = index + 1
    return ruleMap.get(level) || emptyRule(level)
  })
}

async function loadRules() {
  if (disposed || !active.value || saving.value) return
  const context = contextSequence, request = ++readSequence, type = props.type
  const current = () => currentContext(context) && request === readSequence
  loading.value = true
  ready.value = false
  loadError.value = ''
  try {
    const response = await api.admin.getVipLevelRules(type)
    if (!current()) return
    if (response.type !== type || !Array.isArray(response.rules)) throw new Error(t('admin.vipRules.unknownError'))
    maxLevel.value = response.maxLevel || 10
    if (isUserRules.value) {
      userMetric.value = response.userMetric === 'totalConsume' ? 'totalConsume' : 'totalRecharge'
    }
    hydrateRules(response.rules || [])
    ready.value = true
  } catch (error: any) {
    if (current()) loadError.value = t('admin.vipRules.loadFailed', { message: error?.message || t('admin.vipRules.unknownError') })
  } finally {
    if (current()) loading.value = false
  }
}

async function saveRules() {
  if (editorDisabled.value) return
  for (const rule of rules.value) {
    if (isUserRules.value) {
      const thresholdValue = userMetric.value === 'totalRecharge' ? rule.minRecharge : rule.minConsume
      if (hasInvalidPositiveNumber(thresholdValue)) {
        toast.error(t('admin.vipRules.moneyThresholdInvalid', { level: rule.level }))
        return
      }
    } else if (hasInvalidPositiveNumber(rule.minHostingIncome)) {
      toast.error(t('admin.vipRules.moneyThresholdInvalid', { level: rule.level }))
      return
    }

    if (rule.enabled && !hasCondition(rule)) {
      toast.error(t('admin.vipRules.conditionRequired', { level: rule.level }))
      return
    }
    if (!isUserRules.value && normalizeInputValue(rule.minHostingInstances) && parseOptionalInteger(rule.minHostingInstances) === null) {
      toast.error(t('admin.vipRules.instanceThresholdInvalid', { level: rule.level }))
      return
    }
    if (!isValidHexColor(rule.badgeStyle.backgroundColor) || !isValidHexColor(rule.badgeStyle.textColor)) {
      toast.error(t('admin.vipRules.colorInvalid', { level: rule.level }))
      return
    }
  }

  const context = contextSequence, type = props.type
  const payload = buildPayload()
  const options = isUserRules.value ? { userMetric: userMetric.value } : undefined
  saving.value = true
  saveError.value = ''
  try {
    const response = await api.admin.updateVipLevelRules(
      type,
      payload,
      options
    )
    if (!currentContext(context)) return
    if (response.type !== type || !Array.isArray(response.rules)) throw new Error(t('admin.vipRules.unknownError'))
    if (isUserRules.value) {
      userMetric.value = response.userMetric === 'totalConsume' ? 'totalConsume' : 'totalRecharge'
    }
    hydrateRules(response.rules || [])
    toast.success(t('admin.vipRules.saveSuccess'))
  } catch (error: any) {
    if (currentContext(context)) saveError.value = error?.message || t('admin.vipRules.saveFailed')
  } finally {
    saving.value = false
    if (!disposed && active.value && !currentContext(context)) void loadRules()
  }
}

function retryLoad() {
  if (!loading.value && !saving.value) void loadRules()
}

watch([active, sessionKey, () => props.type], () => {
  contextSequence++
  readSequence++
  ready.value = false
  rules.value = []
  maxLevel.value = 10
  userMetric.value = 'totalRecharge'
  loadError.value = ''
  saveError.value = ''
  loading.value = active.value
  if (active.value && !saving.value) void loadRules()
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
          <h2 class="text-lg font-semibold text-themed">{{ title }}</h2>
          <p class="mt-1 text-sm text-themed-muted">{{ description }}</p>
        </div>
        <button class="btn btn-primary self-start lg:self-auto" :disabled="editorDisabled" @click="saveRules">
          {{ saving ? t('common.saving') : t('admin.vipRules.save') }}
        </button>
      </div>

      <fieldset
        v-if="isUserRules"
        class="mt-5 rounded-lg border border-themed bg-themed-secondary/30 p-4"
        :disabled="editorDisabled"
      >
        <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div class="text-sm font-semibold text-themed">{{ t('admin.vipRules.userMetricTitle') }}</div>
            <div class="mt-1 text-xs text-themed-muted">{{ t('admin.vipRules.userMetricHint') }}</div>
          </div>
          <div class="inline-grid grid-cols-2 gap-1 rounded-lg border border-themed bg-themed-primary p-1">
            <button
              type="button"
              class="rounded-md px-3 py-2 text-sm font-medium transition-colors"
              :class="userMetric === 'totalRecharge' ? 'bg-themed-secondary text-themed shadow-sm' : 'text-themed-muted hover:text-themed'"
              @click="userMetric = 'totalRecharge'"
            >
              {{ t('admin.vipRules.metricRecharge') }}
            </button>
            <button
              type="button"
              class="rounded-md px-3 py-2 text-sm font-medium transition-colors"
              :class="userMetric === 'totalConsume' ? 'bg-themed-secondary text-themed shadow-sm' : 'text-themed-muted hover:text-themed'"
              @click="userMetric = 'totalConsume'"
            >
              {{ t('admin.vipRules.metricConsume') }}
            </button>
          </div>
        </div>
      </fieldset>
    </div>

    <div v-if="loadError || saveError" class="card p-5" role="alert">
      <p class="break-words text-sm text-red-600 dark:text-red-400">{{ loadError || saveError }}</p>
      <button v-if="loadError" class="btn btn-secondary mt-3" type="button" :disabled="loading || saving" @click="retryLoad">{{ t('common.retry') }}</button>
    </div>

    <div v-if="loading" class="card p-6">
      <SkeletonLoader type="table" :rows="6" />
    </div>

    <fieldset v-else-if="ready" class="card min-w-0 overflow-hidden" :disabled="editorDisabled">
      <div class="space-y-3 p-4 lg:hidden">
        <div
          v-for="rule in rules"
          :key="rule.level"
          class="rounded-lg border border-themed bg-themed-surface p-4 shadow-sm"
        >
          <div class="flex items-start justify-between gap-3">
            <span
              class="inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold"
              :style="getVipBadgeInlineStyle(rule.badgeStyle)"
            >
              VIP{{ rule.level }}
            </span>
            <label class="inline-flex items-center gap-2 text-sm text-themed">
              <input v-model="rule.enabled" type="checkbox" class="rounded border-themed text-primary-600 focus:ring-primary-500" />
              {{ rule.enabled ? t('common.enabled') : t('common.disabled') }}
            </label>
          </div>

          <div class="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label class="text-xs text-themed-muted">
              {{ t('admin.vipRules.badgeBgColor') }}
              <div class="mt-1 flex items-center gap-2">
                <input
                  v-model="rule.badgeStyle.backgroundColor"
                  type="color"
                  class="h-9 w-10 shrink-0 rounded border border-themed bg-transparent p-1"
                  :aria-label="t('admin.vipRules.badgeBgColor')"
                />
                <input
                  v-model.trim="rule.badgeStyle.backgroundColor"
                  type="text"
                  maxlength="7"
                  class="input min-w-0 flex-1 font-mono text-sm"
                  placeholder="#FEF3C7"
                />
              </div>
            </label>
            <label class="text-xs text-themed-muted">
              {{ t('admin.vipRules.badgeTextColor') }}
              <div class="mt-1 flex items-center gap-2">
                <input
                  v-model="rule.badgeStyle.textColor"
                  type="color"
                  class="h-9 w-10 shrink-0 rounded border border-themed bg-transparent p-1"
                  :aria-label="t('admin.vipRules.badgeTextColor')"
                />
                <input
                  v-model.trim="rule.badgeStyle.textColor"
                  type="text"
                  maxlength="7"
                  class="input min-w-0 flex-1 font-mono text-sm"
                  placeholder="#92400E"
                />
              </div>
            </label>
            <label v-if="!isUserRules" class="text-xs text-themed-muted">
              {{ t('admin.vipRules.mode') }}
              <select v-model="rule.conditionMode" class="input mt-1 w-full">
                <option value="any">{{ t('admin.vipRules.modeAny') }}</option>
                <option value="all">{{ t('admin.vipRules.modeAll') }}</option>
              </select>
            </label>
            <label v-if="isUserRules" class="text-xs text-themed-muted">
              {{ userMetricThresholdLabel }}
              <input
                v-if="userMetric === 'totalRecharge'"
                v-model="rule.minRecharge"
                type="number"
                min="0"
                step="0.01"
                class="input mt-1 w-full"
                :placeholder="t('admin.vipRules.noLimit')"
              />
              <input
                v-else
                v-model="rule.minConsume"
                type="number"
                min="0"
                step="0.01"
                class="input mt-1 w-full"
                :placeholder="t('admin.vipRules.noLimit')"
              />
            </label>
            <label v-if="!isUserRules" class="text-xs text-themed-muted">
              {{ t('admin.vipRules.minHostingIncome') }}
              <input
                v-model="rule.minHostingIncome"
                type="number"
                min="0"
                step="0.01"
                class="input mt-1 w-full"
                :placeholder="t('admin.vipRules.noLimit')"
              />
            </label>
            <label v-if="!isUserRules" class="text-xs text-themed-muted">
              {{ t('admin.vipRules.minHostingInstances') }}
              <input
                v-model="rule.minHostingInstances"
                type="number"
                min="0"
                step="1"
                class="input mt-1 w-full"
                :placeholder="t('admin.vipRules.noLimit')"
              />
            </label>
          </div>
        </div>
      </div>

      <div class="hidden overflow-hidden lg:block">
        <table class="w-full table-fixed divide-y divide-themed">
          <thead class="bg-themed-secondary/40">
            <tr>
              <th class="w-[10%] px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-themed-muted">
                {{ t('admin.vipRules.level') }}
              </th>
              <th class="w-[20%] px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-themed-muted">
                {{ t('admin.vipRules.badgeBgColor') }}
              </th>
              <th class="w-[20%] px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-themed-muted">
                {{ t('admin.vipRules.badgeTextColor') }}
              </th>
              <th class="w-[14%] px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-themed-muted">
                {{ t('admin.vipRules.enabled') }}
              </th>
              <th
                v-if="!isUserRules"
                class="w-[14%] px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-themed-muted"
              >
                {{ t('admin.vipRules.mode') }}
              </th>
              <th
                v-if="isUserRules"
                class="w-[36%] px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-themed-muted"
              >
                {{ userMetricThresholdLabel }}
              </th>
              <th
                v-if="!isUserRules"
                class="w-[16%] px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-themed-muted"
              >
                {{ t('admin.vipRules.minHostingIncome') }}
              </th>
              <th
                v-if="!isUserRules"
                class="w-[16%] px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-themed-muted"
              >
                {{ t('admin.vipRules.minHostingInstances') }}
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-themed bg-themed-primary">
            <tr v-for="rule in rules" :key="rule.level" class="hover:bg-themed-hover">
              <td class="px-4 py-4">
                <span
                  class="inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold"
                  :style="getVipBadgeInlineStyle(rule.badgeStyle)"
                >
                  VIP{{ rule.level }}
                </span>
              </td>
              <td class="px-4 py-4">
                <div class="flex items-center gap-2">
                  <input
                    v-model="rule.badgeStyle.backgroundColor"
                    type="color"
                    class="h-9 w-10 shrink-0 rounded border border-themed bg-transparent p-1"
                    :aria-label="t('admin.vipRules.badgeBgColor')"
                  />
                  <input
                    v-model.trim="rule.badgeStyle.backgroundColor"
                    type="text"
                    maxlength="7"
                    class="input min-w-0 flex-1 font-mono text-sm"
                    placeholder="#FEF3C7"
                  />
                </div>
              </td>
              <td class="px-4 py-4">
                <div class="flex items-center gap-2">
                  <input
                    v-model="rule.badgeStyle.textColor"
                    type="color"
                    class="h-9 w-10 shrink-0 rounded border border-themed bg-transparent p-1"
                    :aria-label="t('admin.vipRules.badgeTextColor')"
                  />
                  <input
                    v-model.trim="rule.badgeStyle.textColor"
                    type="text"
                    maxlength="7"
                    class="input min-w-0 flex-1 font-mono text-sm"
                    placeholder="#92400E"
                  />
                </div>
              </td>
              <td class="px-4 py-4">
                <label class="inline-flex items-center gap-2 text-sm text-themed">
                  <input v-model="rule.enabled" type="checkbox" class="rounded border-themed text-primary-600 focus:ring-primary-500" />
                  {{ rule.enabled ? t('common.enabled') : t('common.disabled') }}
                </label>
              </td>
              <td v-if="!isUserRules" class="px-4 py-4">
                <select v-model="rule.conditionMode" class="input w-full">
                  <option value="any">{{ t('admin.vipRules.modeAny') }}</option>
                  <option value="all">{{ t('admin.vipRules.modeAll') }}</option>
                </select>
              </td>
              <td v-if="isUserRules" class="px-4 py-4">
                <input
                  v-if="userMetric === 'totalRecharge'"
                  v-model="rule.minRecharge"
                  type="number"
                  min="0"
                  step="0.01"
                  class="input w-full"
                  :placeholder="t('admin.vipRules.noLimit')"
                />
                <input
                  v-else
                  v-model="rule.minConsume"
                  type="number"
                  min="0"
                  step="0.01"
                  class="input w-full"
                  :placeholder="t('admin.vipRules.noLimit')"
                />
              </td>
              <td v-if="!isUserRules" class="px-4 py-4">
                <input
                  v-model="rule.minHostingIncome"
                  type="number"
                  min="0"
                  step="0.01"
                  class="input w-full"
                  :placeholder="t('admin.vipRules.noLimit')"
                />
              </td>
              <td v-if="!isUserRules" class="px-4 py-4">
                <input
                  v-model="rule.minHostingInstances"
                  type="number"
                  min="0"
                  step="1"
                  class="input w-full"
                  :placeholder="t('admin.vipRules.noLimit')"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </fieldset>
  </div>
</template>
