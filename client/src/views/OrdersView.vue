<script setup lang="ts">
import { computed, onMounted, onActivated, onDeactivated, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import api from '@/api'
import { useReveal } from '@/composables/useReveal'
import { useDialogFocus } from '@/composables/useDialogFocus'

const revealRoot = ref<HTMLElement | null>(null)
useReveal(revealRoot)

const { t, locale } = useI18n()

type OrderSourceType = 'recharge' | 'instance_billing'

interface OrderItem {
  userId: number
  id: string
  sourceType: OrderSourceType
  sourceId: number
  orderNo: string
  title: string
  status: string
  rawStatus: string
  amount: number
  actualAmount: number | null
  fee: number
  provider: { id: number; name: string; type: string } | null
  paymentMethod: string | null
  tradeNo: string | null
  failReason: string | null
  instance: {
    id: number
    name: string
    displayName: string | null
    packagePlan?: { id: number; name: string; package?: { id: number; name: string } | null } | null
  } | null
  months: number | null
  periodStart: string | null
  periodEnd: string | null
  remark: string | null
  createdAt: string
  completedAt: string | null
  expiredAt: string | null
}

const orders = ref<OrderItem[]>([])
const selectedOrder = ref<OrderItem | null>(null)
const loading = ref(false)
const detailLoading = ref(false)
const error = ref('')
const page = ref(1)
const pageSize = ref(10)
const total = ref(0)
const type = ref('')
const status = ref('')
const authStore = useAuthStore(), route = useRoute()
const active = ref(false), loaded = ref(false), detailError = ref('')
const detailRoot = ref<HTMLElement | null>(null)
let alive = true, generation = 0, listSequence = 0, detailSequence = 0
const session = computed(() => {
  if (!authStore.token || !authStore.user || authStore.user.role !== 'user' || !Number.isSafeInteger(authStore.user.id) || authStore.user.id < 1) return ''
  let identity = authStore.token
  try {
    const payload = JSON.parse(atob(identity.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    if (typeof payload.sid === 'string' && payload.sid) identity = payload.sid
  } catch { /* Legacy access tokens retain their complete identity. */ }
  return `${authStore.user.id}:${authStore.user.role}:${identity}`
})
const available = computed(() => alive && active.value && !!session.value && route.path === '/orders')
const queryKey = computed(() => JSON.stringify([session.value, route.path, page.value, pageSize.value, type.value, status.value]))
function closeDetail() { selectedOrder.value = null }
watch(() => selectedOrder.value?.id, () => { detailSequence++; detailLoading.value = false; detailError.value = '' }, { flush: 'sync' })
useDialogFocus(detailRoot, () => !!selectedOrder.value, closeDetail)
watch(detailRoot, element => { if (element && selectedOrder.value) element.querySelector<HTMLElement>('button')?.focus() }, { flush: 'post' })
function invalidate() {
  generation++; listSequence++; detailSequence++
  orders.value = []; total.value = 0; loaded.value = false; loading.value = false; error.value = ''
  closeDetail(); detailLoading.value = false; detailError.value = ''
}
watch([page, pageSize, type, status], invalidate, { flush: 'sync' })
watch([session, () => route.path], () => {
  invalidate(); page.value = 1; type.value = ''; status.value = ''
  if (available.value) void loadOrders()
}, { flush: 'sync' })
function activate() { if (active.value || !alive) return; active.value = true; if (available.value) void loadOrders() }
onMounted(activate)
onActivated(activate)
onDeactivated(() => { active.value = false; invalidate() })
onBeforeUnmount(() => { alive = false; active.value = false; invalidate() })

function validOrder(value: unknown): value is OrderItem {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as OrderItem
  return item.userId === authStore.user?.id && ['recharge', 'instance_billing'].includes(item.sourceType) &&
    Number.isSafeInteger(item.sourceId) && item.sourceId > 0 && item.id === `${item.sourceType}:${item.sourceId}` &&
    typeof item.orderNo === 'string' && typeof item.status === 'string' && typeof item.rawStatus === 'string' &&
    typeof item.title === 'string' && typeof item.createdAt === 'string' &&
    [item.amount, item.fee].every(value => typeof value === 'number' && Number.isFinite(value)) &&
    (item.actualAmount === null || (typeof item.actualAmount === 'number' && Number.isFinite(item.actualAmount)))
}

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))

const typeOptions = computed(() => [
  { value: '', label: t('orders.typeAll') },
  { value: 'recharge', label: t('orders.typeRecharge') },
  { value: 'instance_billing', label: t('orders.typeInstanceBilling') }
])

const statusOptions = computed(() => {
  if (type.value === 'instance_billing') {
    return [
      { value: '', label: t('orders.statusAll') },
      { value: 'newPurchase', label: t('orders.billingNewPurchase') },
      { value: 'renew', label: t('orders.billingRenew') },
      { value: 'upgrade', label: t('orders.billingUpgrade') },
      { value: 'downgrade', label: t('orders.billingDowngrade') },
      { value: 'refund', label: t('orders.billingRefund') },
      { value: 'transfer_fee', label: t('orders.billingTransferFee') }
    ]
  }

  return [
    { value: '', label: t('orders.statusAll') },
    { value: 'pending', label: t('orders.rechargePending') },
    { value: 'paid', label: t('orders.rechargePaid') },
    { value: 'completed', label: t('orders.rechargeCompleted') },
    { value: 'failed', label: t('orders.rechargeFailed') },
    { value: 'cancelled', label: t('orders.rechargeCancelled') },
    { value: 'refunded', label: t('orders.rechargeRefunded') }
  ]
})

function formatMoney(value: number | null | undefined): string {
  return `¥${Number(value || 0).toFixed(2)}`
}

function formatTime(value: string | null | undefined): string {
  if (!value) return '-'
  return new Date(value).toLocaleString(locale.value, { hour12: false })
}

function statusLabel(order: OrderItem): string {
  switch (order.status) {
    case 'completed': return t('orders.statusCompleted')
    case 'pending': return t('orders.statusPending')
    case 'failed': return t('orders.statusFailed')
    case 'cancelled': return t('orders.statusCancelled')
    case 'refunded': return t('orders.statusRefunded')
    default: return order.rawStatus
  }
}

function statusClass(statusValue: string): string {
  if (statusValue === 'completed') return 'bg-green-50 text-green-700 border-green-200'
  if (statusValue === 'pending') return 'bg-yellow-50 text-yellow-700 border-yellow-200'
  if (statusValue === 'refunded') return 'bg-gray-50 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700'
  if (statusValue === 'failed' || statusValue === 'cancelled') return 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/20'
  return 'bg-gray-50 text-gray-700 border-gray-200'
}

function sourceLabel(sourceType: OrderSourceType): string {
  return sourceType === 'recharge' ? t('orders.sourceRecharge') : t('orders.sourceInstanceBilling')
}

function orderTitle(order: OrderItem): string {
  if (order.sourceType === 'recharge') return t('orders.titleRecharge')
  switch (order.rawStatus) {
    case 'newPurchase': return t('orders.titleNewPurchase')
    case 'renew': return t('orders.titleRenew')
    case 'upgrade': return t('orders.titleUpgrade')
    case 'downgrade': return t('orders.titleDowngrade')
    case 'refund': return t('orders.titleRefund')
    case 'transfer_fee': return t('orders.titleTransferFee')
    default: return order.title
  }
}

function instanceName(order: OrderItem): string {
  if (!order.instance) return '-'
  return order.instance.displayName || order.instance.name
}

async function loadOrders() {
  if (!available.value) return
  const authentication = authStore.captureAuthentication()
  if (!authentication.aligned) return
  invalidate()
  const key = queryKey.value, version = generation, sequence = ++listSequence
  const params = { page: page.value, pageSize: pageSize.value, type: type.value || undefined, status: status.value || undefined }
  const current = () => available.value && authentication.current() && key === queryKey.value && version === generation && sequence === listSequence
  loading.value = true
  error.value = ''
  try {
    const res = await api.orders.list(params)
    if (!current()) return
    if (!res || !Array.isArray(res.orders) || res.orders.length > params.pageSize || !res.orders.every(validOrder) ||
      new Set(res.orders.map(item => item.id)).size !== res.orders.length || !Number.isSafeInteger(res.total) || res.total < res.orders.length ||
      res.page !== params.page || res.pageSize !== params.pageSize) throw new Error(t('orders.loadFailed'))
    const lastPage = Math.max(1, Math.ceil(res.total / params.pageSize))
    if (params.page > lastPage) {
      page.value = lastPage
      await loadOrders()
      return
    }
    orders.value = res.orders as OrderItem[]
    total.value = res.total
    loaded.value = true
  } catch (err: any) {
    if (current()) error.value = err?.message || t('orders.loadFailed')
  } finally {
    if (current()) loading.value = false
  }
}

async function openDetail(order: OrderItem) {
  if (!available.value || !loaded.value || loading.value || !orders.value.includes(order) || !validOrder(order)) return
  detailSequence++; detailLoading.value = false; detailError.value = ''
  selectedOrder.value = { ...order }
  await loadDetail()
}

async function loadDetail() {
  if (!available.value || !selectedOrder.value || detailLoading.value) return
  const authentication = authStore.captureAuthentication()
  if (!authentication.aligned) return
  const target = selectedOrder.value, key = queryKey.value, version = generation, sequence = ++detailSequence
  const current = () => available.value && authentication.current() && key === queryKey.value && version === generation && sequence === detailSequence && selectedOrder.value?.id === target.id
  detailLoading.value = true
  detailError.value = ''
  try {
    const res = await api.orders.detail(target.sourceType, target.sourceId)
    if (!current()) return
    if (!validOrder(res?.order) || res.order.id !== target.id) throw new Error(t('orders.loadFailed'))
    selectedOrder.value = res.order as OrderItem
  } catch (err: any) {
    if (current()) detailError.value = err?.message || t('orders.loadFailed')
  } finally {
    if (current()) detailLoading.value = false
  }
}

function applyFilters() {
  page.value = 1
  void loadOrders()
}

function clearFilters() {
  type.value = ''
  status.value = ''
  applyFilters()
}

function goPage(nextPage: number) {
  if (nextPage < 1 || nextPage > totalPages.value || nextPage === page.value) return
  page.value = nextPage
  void loadOrders()
}

</script>

<template>
  <div ref="revealRoot" class="space-y-5 animate-fade-in">
    <header data-reveal class="page-header flex-col gap-4 sm:flex-row sm:items-center sm:gap-0">
      <div>
        <h1 class="page-title">{{ $t('orders.title') }}</h1>
        <p class="page-description">{{ $t('orders.description') }}</p>
      </div>
      <button class="btn btn-secondary w-full justify-center gap-2 sm:w-auto" :disabled="loading" @click="loadOrders">
        <svg class="h-4 w-4" :class="{ 'animate-spin': loading }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M21 12a9 9 0 1 1-2.64-6.36" />
          <polyline points="21 3 21 9 15 9" />
        </svg>
        {{ $t('orders.refresh') }}
      </button>
    </header>

    <section data-reveal class="nimbus-lift rounded-xl border border-themed bg-themed-surface p-4 shadow-sm">
      <div class="grid gap-3 md:grid-cols-[180px_180px_auto]">
        <select v-model="type" class="input" @change="status = ''; applyFilters()">
          <option v-for="item in typeOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
        </select>
        <select v-model="status" class="input" @change="applyFilters">
          <option v-for="item in statusOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
        </select>
        <button class="btn btn-secondary justify-self-start" @click="clearFilters">{{ $t('orders.reset') }}</button>
      </div>
    </section>

    <div v-if="error" class="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300">
      <svg class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <span>{{ error }}</span>
    </div>

    <section data-reveal class="overflow-hidden rounded-xl border border-themed bg-themed-surface shadow-sm">
      <div v-if="loading" class="p-10 text-center text-sm text-themed-muted">{{ $t('orders.loading') }}</div>
      <div v-else-if="orders.length === 0" class="flex flex-col items-center gap-3 px-6 py-14 text-center">
        <div class="flex h-14 w-14 items-center justify-center rounded-2xl border border-themed bg-themed-secondary text-themed-muted">
          <svg class="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M5 4h11l3 3v13H5z" />
            <path d="M9 12h6M9 16h6M9 8h3" />
          </svg>
        </div>
        <div class="text-sm text-themed-muted">{{ $t('orders.empty') }}</div>
      </div>
      <div v-else class="space-y-3 p-4 lg:hidden">
        <div
          v-for="order in orders"
          :key="order.id"
          class="rounded-lg border border-themed bg-themed-surface p-4 shadow-sm"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="truncate text-sm font-semibold text-themed" :title="orderTitle(order)">{{ orderTitle(order) }}</div>
              <div class="mt-1 truncate font-mono text-xs text-themed-muted" :title="order.orderNo">{{ order.orderNo }}</div>
            </div>
            <span :class="['inline-flex shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium', statusClass(order.status)]">
              {{ statusLabel(order) }}
            </span>
          </div>

          <div class="mt-4 grid grid-cols-2 gap-2 text-sm">
            <div class="rounded-lg bg-themed-secondary px-3 py-2">
              <div class="text-[11px] font-medium uppercase tracking-wide text-themed-muted">{{ $t('orders.colType') }}</div>
              <div class="mt-1 truncate text-themed">{{ sourceLabel(order.sourceType) }}</div>
            </div>
            <div class="rounded-lg bg-themed-secondary px-3 py-2">
              <div class="text-[11px] font-medium uppercase tracking-wide text-themed-muted">{{ $t('orders.colAmount') }}</div>
              <div class="mt-1 font-mono font-semibold tabular-nums text-themed">{{ formatMoney(order.amount) }}</div>
            </div>
            <div class="rounded-lg bg-themed-secondary px-3 py-2">
              <div class="text-[11px] font-medium uppercase tracking-wide text-themed-muted">{{ $t('orders.colInstance') }}</div>
              <div class="mt-1 truncate text-themed" :title="instanceName(order)">{{ instanceName(order) }}</div>
            </div>
            <div class="rounded-lg bg-themed-secondary px-3 py-2">
              <div class="text-[11px] font-medium uppercase tracking-wide text-themed-muted">{{ $t('orders.colTime') }}</div>
              <div class="mt-1 text-xs text-themed">{{ formatTime(order.createdAt) }}</div>
            </div>
          </div>

          <div class="mt-4 flex justify-end">
            <button class="btn btn-sm btn-secondary" @click="openDetail(order)">{{ $t('orders.detail') }}</button>
          </div>
        </div>
      </div>
      <div v-if="orders.length > 0" class="hidden overflow-hidden lg:block">
        <table class="w-full table-fixed divide-y divide-themed">
          <thead class="bg-themed-tertiary">
            <tr class="text-left text-xs font-semibold uppercase tracking-wide text-themed-muted">
              <th class="w-[25%] px-4 py-3">{{ $t('orders.colOrder') }}</th>
              <th class="w-[12%] px-4 py-3">{{ $t('orders.colType') }}</th>
              <th class="w-[11%] px-4 py-3">{{ $t('orders.colAmount') }}</th>
              <th class="w-[11%] px-4 py-3">{{ $t('orders.colStatus') }}</th>
              <th class="w-[17%] px-4 py-3">{{ $t('orders.colInstance') }}</th>
              <th class="w-[16%] px-4 py-3">{{ $t('orders.colTime') }}</th>
              <th class="w-[8%] px-4 py-3 text-right">{{ $t('orders.colActions') }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-themed">
            <tr v-for="order in orders" :key="order.id" class="text-sm transition-colors hover:bg-themed-hover">
              <td class="px-4 py-3">
                <div class="truncate font-medium text-themed" :title="orderTitle(order)">{{ orderTitle(order) }}</div>
                <div class="truncate font-mono text-xs text-themed-muted" :title="order.orderNo">{{ order.orderNo }}</div>
              </td>
              <td class="px-4 py-3 text-themed-muted">
                <div class="truncate">{{ sourceLabel(order.sourceType) }}</div>
              </td>
              <td class="px-4 py-3 font-mono font-medium tabular-nums text-themed whitespace-nowrap">{{ formatMoney(order.amount) }}</td>
              <td class="px-4 py-3">
                <span :class="['inline-flex max-w-full rounded-full border px-2 py-0.5 text-xs font-medium', statusClass(order.status)]">{{ statusLabel(order) }}</span>
              </td>
              <td class="px-4 py-3 text-themed-muted">
                <div class="truncate" :title="instanceName(order)">{{ instanceName(order) }}</div>
              </td>
              <td class="px-4 py-3 text-themed-muted whitespace-nowrap">{{ formatTime(order.createdAt) }}</td>
              <td class="px-4 py-3 text-right whitespace-nowrap">
                <button class="btn btn-sm btn-secondary" @click="openDetail(order)">{{ $t('orders.detail') }}</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="flex flex-col items-stretch justify-between gap-3 border-t border-themed px-4 py-3 text-sm text-themed-muted sm:flex-row sm:items-center">
        <span>{{ $t('orders.totalRecords', { count: total }) }}</span>
        <div class="grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:flex">
          <button class="btn btn-sm btn-secondary justify-center" :disabled="page <= 1" @click="goPage(page - 1)">{{ $t('orders.prevPage') }}</button>
          <span class="min-w-[72px] text-center font-mono tabular-nums">{{ page }} / {{ totalPages }}</span>
          <button class="btn btn-sm btn-secondary justify-center" :disabled="page >= totalPages" @click="goPage(page + 1)">{{ $t('orders.nextPage') }}</button>
        </div>
      </div>
    </section>

    <Teleport to="body">
      <div v-if="selectedOrder" class="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm" style="backdrop-filter: none" @click.self="closeDetail">
        <aside ref="detailRoot" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="order-detail-title" class="order-detail-drawer flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-themed bg-themed-surface shadow-2xl">
          <div class="flex items-start justify-between gap-4 border-b border-themed bg-themed p-6">
            <div class="min-w-0">
              <h2 id="order-detail-title" class="truncate text-xl font-semibold text-themed">{{ orderTitle(selectedOrder) }}</h2>
              <p class="mt-1 truncate font-mono text-sm text-themed-muted">{{ selectedOrder.orderNo }}</p>
            </div>
            <button type="button" class="btn btn-sm btn-secondary gap-1.5 min-h-11" @click="closeDetail">
              <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
              {{ $t('orders.close') }}
            </button>
          </div>

          <div v-if="detailLoading" class="p-6 text-sm text-themed-muted">{{ $t('orders.detailLoading') }}</div>
          <div v-else-if="detailError" role="alert" class="p-6 space-y-3">
            <p class="text-sm text-themed break-words">{{ detailError }}</p>
            <button type="button" data-order-detail-retry class="btn btn-secondary min-h-11" @click="loadDetail">{{ $t('common.retry') }}</button>
          </div>
          <dl v-else class="grid gap-px bg-themed-secondary p-px text-sm">
            <div class="grid grid-cols-3 gap-3 bg-themed-surface px-6 py-3"><dt class="text-themed-muted">{{ $t('orders.fieldStatus') }}</dt><dd class="col-span-2 text-themed"><span :class="['inline-flex rounded-full border px-2 py-0.5 text-xs font-medium', statusClass(selectedOrder.status)]">{{ statusLabel(selectedOrder) }}</span></dd></div>
            <div class="grid grid-cols-3 gap-3 bg-themed-surface px-6 py-3"><dt class="text-themed-muted">{{ $t('orders.fieldAmount') }}</dt><dd class="col-span-2 font-mono tabular-nums text-themed">{{ formatMoney(selectedOrder.amount) }}</dd></div>
            <div class="grid grid-cols-3 gap-3 bg-themed-surface px-6 py-3"><dt class="text-themed-muted">{{ $t('orders.fieldActualAmount') }}</dt><dd class="col-span-2 font-mono tabular-nums text-themed">{{ selectedOrder.actualAmount === null ? '-' : formatMoney(selectedOrder.actualAmount) }}</dd></div>
            <div class="grid grid-cols-3 gap-3 bg-themed-surface px-6 py-3"><dt class="text-themed-muted">{{ $t('orders.fieldFee') }}</dt><dd class="col-span-2 font-mono tabular-nums text-themed">{{ formatMoney(selectedOrder.fee) }}</dd></div>
            <div class="grid grid-cols-3 gap-3 bg-themed-surface px-6 py-3"><dt class="text-themed-muted">{{ $t('orders.fieldChannel') }}</dt><dd class="col-span-2 text-themed">{{ selectedOrder.provider?.name || selectedOrder.paymentMethod || '-' }}</dd></div>
            <div class="grid grid-cols-3 gap-3 bg-themed-surface px-6 py-3"><dt class="text-themed-muted">{{ $t('orders.fieldTradeNo') }}</dt><dd class="col-span-2 break-all font-mono text-themed">{{ selectedOrder.tradeNo || '-' }}</dd></div>
            <div class="grid grid-cols-3 gap-3 bg-themed-surface px-6 py-3"><dt class="text-themed-muted">{{ $t('orders.fieldInstance') }}</dt><dd class="col-span-2 text-themed">{{ instanceName(selectedOrder) }}</dd></div>
            <div class="grid grid-cols-3 gap-3 bg-themed-surface px-6 py-3"><dt class="text-themed-muted">{{ $t('orders.fieldPeriod') }}</dt><dd class="col-span-2 text-themed">{{ selectedOrder.months ? $t('orders.monthsCount', { count: selectedOrder.months }) : '-' }}</dd></div>
            <div class="grid grid-cols-3 gap-3 bg-themed-surface px-6 py-3"><dt class="text-themed-muted">{{ $t('orders.fieldPeriodStart') }}</dt><dd class="col-span-2 text-themed">{{ formatTime(selectedOrder.periodStart) }}</dd></div>
            <div class="grid grid-cols-3 gap-3 bg-themed-surface px-6 py-3"><dt class="text-themed-muted">{{ $t('orders.fieldPeriodEnd') }}</dt><dd class="col-span-2 text-themed">{{ formatTime(selectedOrder.periodEnd) }}</dd></div>
            <div class="grid grid-cols-3 gap-3 bg-themed-surface px-6 py-3"><dt class="text-themed-muted">{{ $t('orders.fieldCreatedAt') }}</dt><dd class="col-span-2 text-themed">{{ formatTime(selectedOrder.createdAt) }}</dd></div>
            <div class="grid grid-cols-3 gap-3 bg-themed-surface px-6 py-3"><dt class="text-themed-muted">{{ $t('orders.fieldCompletedAt') }}</dt><dd class="col-span-2 text-themed">{{ formatTime(selectedOrder.completedAt) }}</dd></div>
            <div class="grid grid-cols-3 gap-3 bg-themed-surface px-6 py-3"><dt class="text-themed-muted">{{ $t('orders.fieldFailReason') }}</dt><dd class="col-span-2 text-themed">{{ selectedOrder.failReason || '-' }}</dd></div>
            <div class="grid grid-cols-3 gap-3 bg-themed-surface px-6 py-3"><dt class="text-themed-muted">{{ $t('orders.fieldRemark') }}</dt><dd class="col-span-2 text-themed">{{ selectedOrder.remark || '-' }}</dd></div>
          </dl>
        </aside>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.order-detail-drawer { --order-muted: #aaa; }
:global(.light .order-detail-drawer) { --order-muted: #666; }
.order-detail-drawer .text-themed-muted { color: var(--order-muted); }
.order-detail-drawer .btn {
  min-height: 44px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  background-image: none;
  box-shadow: none;
  transform: none;
}
.order-detail-drawer .btn:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; box-shadow: none; }
.order-detail-drawer dd { min-width: 0; overflow-wrap: anywhere; }
.nimbus-lift {
  transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
}

.nimbus-lift:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 18px -8px rgba(15, 23, 42, 0.28);
}

@media (prefers-reduced-motion: reduce) {
  .nimbus-lift,
  .nimbus-lift:hover {
    transform: none;
    transition: none;
  }
}
</style>
