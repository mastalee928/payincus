<script setup lang="ts">
/**
 * LoginHistorySection - 登录历史记录组件
 * 显示用户的登录历史，包括 IP、地理位置、设备信息等
 */
import { ref, onMounted, computed, watch, onActivated, onDeactivated, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api'
import FlagIcon from '@/components/FlagIcon.vue'
import { normalizeCountryName } from '@/utils/countryDisplay'
import { useAuthStore } from '@/stores/auth'

const { t, locale } = useI18n()
const auth = useAuthStore()

interface LoginRecord {
  id: number
  ip: string
  country: string | null
  region: string | null
  city: string | null
  isp: string | null
  timezone: string | null
  userAgent: string | null
  createdAt: string
}

const loading = ref(false)
const records = ref<LoginRecord[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = 3
const totalPages = computed(() => Math.ceil(total.value / pageSize))
const loadError = ref(false), ready = ref(false), active = ref(false)
let alive = true, generation = 0, readSequence = 0
const session = computed(() => {
  if (!auth.user || !auth.token || !Number.isSafeInteger(auth.user.id) || auth.user.id < 1) return ''
  let identity = auth.token
  try {
    const payload = JSON.parse(atob(identity.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    if (typeof payload.sid === 'string' && payload.sid) identity = payload.sid
  } catch { /* Legacy tokens retain their full identity. */ }
  return `${auth.user.id}:${auth.user.role}:${identity}`
})
const available = computed(() => alive && active.value && !!session.value)
function invalidateContext(): void {
  generation++
  readSequence++
  records.value = []
  total.value = 0
  page.value = 1
  loading.value = false
  ready.value = false
  loadError.value = false
}
watch(session, () => { invalidateContext(); if (available.value) void loadRecords() }, { flush: 'sync' })
watch(page, () => { readSequence++; records.value = []; ready.value = false; loadError.value = false }, { flush: 'sync' })
function activate(): void {
  if (!alive || active.value) return
  active.value = true
  void loadRecords()
}
onMounted(activate)
onActivated(activate)
onDeactivated(() => { active.value = false; invalidateContext() })
onBeforeUnmount(() => { alive = false; active.value = false; invalidateContext() })
const HIDDEN_LOGIN_VALUE = '已隐藏'
const normalizedCountryLabels = computed(() => ({
  mainlandChina: t('common.countries.cn'),
  hongKong: t('common.countries.hk'),
  macau: t('common.countries.mo'),
  taiwan: t('common.countries.tw')
}))

// 国家名称到国家代码的映射（常用国家）
const countryCodeMap: Record<string, string> = {
  'China': 'cn',
  'United States': 'us',
  'Japan': 'jp',
  'South Korea': 'kr',
  'Singapore': 'sg',
  'Macau': 'mo',
  'China Macau': 'mo',
  'Hong Kong': 'hk',
  'China Hong Kong': 'hk',
  'Taiwan': 'tw',
  'China Taiwan': 'tw',
  'Germany': 'de',
  'United Kingdom': 'gb',
  'France': 'fr',
  'Netherlands': 'nl',
  'Russia': 'ru',
  'Canada': 'ca',
  'Australia': 'au',
  'India': 'in',
  'Brazil': 'br'
}

async function loadRecords() {
  if (!available.value || !Number.isSafeInteger(page.value) || page.value < 1) return
  const selectedPage = page.value, identity = session.value, version = generation, sequence = ++readSequence
  const current = () => available.value && identity === session.value && version === generation && sequence === readSequence && selectedPage === page.value
  loading.value = true
  loadError.value = false
  try {
    const result = await api.auth.getLoginHistory({ page: selectedPage, pageSize })
    if (!current()) return
    if (!result || !Array.isArray(result.records) || result.records.length > pageSize || !result.records.every(validRecord) ||
      new Set(result.records.map(record => record.id)).size !== result.records.length ||
      !Number.isSafeInteger(result.total) || result.total < 0 || result.page !== selectedPage || result.pageSize !== pageSize ||
      result.totalPages !== Math.ceil(result.total / pageSize) || (result.total === 0 && result.records.length > 0)) throw new Error('Invalid login history response')
    if (selectedPage > Math.max(1, result.totalPages)) {
      total.value = result.total
      page.value = Math.max(1, result.totalPages)
      await loadRecords()
      return
    }
    records.value = result.records
    total.value = result.total
    ready.value = true
  } catch {
    if (current()) loadError.value = true
  } finally {
    if (current()) loading.value = false
  }
}

function validRecord(value: unknown): value is LoginRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as LoginRecord
  return Number.isSafeInteger(record.id) && record.id > 0 && typeof record.ip === 'string' && !!record.ip.trim() &&
    typeof record.createdAt === 'string' && !!record.createdAt.trim() && Number.isFinite(Date.parse(record.createdAt)) &&
    ['country', 'region', 'city', 'isp', 'timezone', 'userAgent'].every(field => {
      const entry = record[field as keyof LoginRecord]
      return entry === null || typeof entry === 'string'
    })
}

function getCountryCode(country: string | null): string | null {
  if (!country) return null
  return countryCodeMap[country] || null
}

function isHiddenRecord(record: LoginRecord): boolean {
  return record.ip === HIDDEN_LOGIN_VALUE
}

function formatLocation(record: LoginRecord): string {
  if (isHiddenRecord(record)) return HIDDEN_LOGIN_VALUE

  const parts: string[] = []
  const normalizedCountry = normalizeCountryName(record.country, normalizedCountryLabels.value)
  if (normalizedCountry) parts.push(normalizedCountry)
  if (record.region) parts.push(record.region)
  if (record.city) parts.push(record.city)
  return parts.length > 0 ? parts.join(', ') : '-'
}

function formatDevice(userAgent: string | null): string {
  if (!userAgent) return '-'
  
  // 简单解析 User-Agent
  if (userAgent.includes('Android')) return 'Android'
  if (userAgent.includes('iPhone') || userAgent.includes('iPad')) return 'iOS'
  if (userAgent.includes('Windows')) return 'Windows'
  if (userAgent.includes('Mac OS')) return 'macOS'
  if (userAgent.includes('Linux')) return 'Linux'
  
  return userAgent.substring(0, 30) + (userAgent.length > 30 ? '...' : '')
}

function formatBrowser(userAgent: string | null): string {
  if (!userAgent) return '-'
  
  if (userAgent.includes('Opera') || userAgent.includes('OPR')) return 'Opera'
  if (userAgent.includes('Edg')) return 'Edge'
  if (userAgent.includes('Firefox') || userAgent.includes('FxiOS')) return 'Firefox'
  if (userAgent.includes('Chrome') || userAgent.includes('CriOS')) return 'Chrome'
  if (userAgent.includes('Safari')) return 'Safari'
  
  return '-'
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr)
  // 支援 zh-CN, zh-TW, en 三種語言
  const localeMap: Record<string, string> = {
    'zh-CN': 'zh-CN',
    'zh-TW': 'zh-TW',
    'en': 'en-US'
  }
  const localeCode = localeMap[locale.value] || 'en-US'
  return date.toLocaleString(localeCode, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function goToPage(newPage: number) {
  if (available.value && Number.isSafeInteger(newPage) && newPage >= 1 && newPage <= totalPages.value && newPage !== page.value) {
    page.value = newPage
    loadRecords()
  }
}

</script>

<template>
  <div class="card nimbus-section">
    <div class="flex items-center justify-between mb-5">
      <div>
        <h2 class="nimbus-section-title">{{ t('profile.loginHistory.title') }}</h2>
        <p class="nimbus-section-desc">{{ t('profile.loginHistory.description') }}</p>
      </div>
      <button
        class="btn-ghost btn-sm"
        :disabled="loading"
        @click="loadRecords"
      >
        {{ t('common.refresh') }}
      </button>
    </div>

    <p v-if="loadError" role="alert" data-history-error class="mb-3 text-sm text-red-600 dark:text-red-400">
      {{ t('common.loadFailed') }}
      <button type="button" class="btn-ghost btn-sm ml-2" :disabled="loading" @click="loadRecords">{{ t('common.retry') }}</button>
    </p>

    <!-- 加载中 -->
    <div v-if="loading && records.length === 0" class="py-6 text-center">
      <div class="inline-block animate-spin rounded-full h-5 w-5 border-b-2 border-primary-500"></div>
    </div>

    <!-- 空状态 -->
    <div v-else-if="ready && !loadError && records.length === 0" data-history-empty class="text-sm text-themed-muted text-center py-6 border border-dashed border-themed rounded-lg">
      <svg class="w-8 h-8 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      {{ t('profile.loginHistory.empty') }}
    </div>

    <!-- 登录记录列表 -->
    <div v-else-if="records.length > 0 || totalPages > 1" class="space-y-2">
      <div
        v-for="record in records"
        :key="record.id"
        class="p-3.5 bg-themed-tertiary border border-themed rounded-xl"
      >
        <div class="flex items-start justify-between">
          <div class="flex-1 min-w-0">
            <!-- IP 和位置 -->
            <div class="flex items-center gap-2 mb-1">
              <FlagIcon
                v-if="!isHiddenRecord(record) && getCountryCode(record.country)"
                :code="getCountryCode(record.country)!"
                class="w-4 h-3 flex-shrink-0"
              />
              <code class="text-sm font-mono text-themed tabular-nums">{{ record.ip }}</code>
            </div>
            
            <!-- 地理位置 -->
            <div class="text-sm text-themed-muted mb-1">
              {{ formatLocation(record) }}
              <span v-if="!isHiddenRecord(record) && record.isp" class="text-themed-faint"> · {{ record.isp }}</span>
            </div>
            
            <!-- 设备和浏览器 -->
            <div v-if="!isHiddenRecord(record)" class="text-xs text-themed-faint">
              {{ formatDevice(record.userAgent) }} · {{ formatBrowser(record.userAgent) }}
            </div>
          </div>
          
          <!-- 时间 -->
          <div class="text-right text-sm text-themed-muted flex-shrink-0 ml-4 tabular-nums">
            {{ formatTime(record.createdAt) }}
          </div>
        </div>
      </div>

      <!-- 分页 -->
      <div v-if="totalPages > 1" class="flex items-center justify-center gap-2 pt-3">
        <button
          class="btn-ghost btn-sm"
          :disabled="page === 1 || loading"
          @click="goToPage(page - 1)"
        >
          {{ t('common.previous') }}
        </button>
        <span class="text-sm text-themed-muted tabular-nums">
          {{ page }} / {{ totalPages }}
        </span>
        <button
          class="btn-ghost btn-sm"
          :disabled="page >= totalPages || loading"
          @click="goToPage(page + 1)"
        >
          {{ t('common.next') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.nimbus-section {
  border-radius: 16px;
  padding: 1.5rem;
}

.nimbus-section-title {
  font-size: 0.9375rem;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--kawaii-text);
}

.nimbus-section-desc {
  margin-top: 0.15rem;
  font-size: 0.75rem;
  color: var(--kawaii-muted);
}
</style>
