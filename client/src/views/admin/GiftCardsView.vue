<script setup lang="ts">
import { computed, onMounted, onActivated, onDeactivated, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useI18n } from 'vue-i18n'
import api from '@/api/admin'
import { useToast } from '@/stores/toast'
import type { GiftCardRecord, GiftCardStats, GiftCardStatus } from '@/types/api'

const { t, locale } = useI18n()
const toast = useToast()
const auth = useAuthStore(), route = useRoute()
const pageNumber = ref(1), total = ref(0), pageSize = 100
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)))
const loadError = ref(''), mutationBusy = ref(false)
const writing = computed(() => saving.value || mutationBusy.value)
let active = false, alive = true, generation = 0, sequence = 0
const sessionKey = computed(() => {
  let identity = auth.token || ''
  try { identity = JSON.parse(atob(identity.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sid || identity } catch { /* Legacy token identity. */ }
  return JSON.stringify([auth.user?.id, auth.user?.role, identity])
})
function context() {
  const authentication = auth.captureAuthentication(), key = sessionKey.value, version = generation
  const query = JSON.stringify([route.fullPath, statusFilter.value, revealCode.value, pageNumber.value])
  return () => alive && active && route.path === '/admin/gift-cards' && !!auth.token && auth.user?.role === 'admin' &&
    authentication.aligned && authentication.current() && key === sessionKey.value && version === generation &&
    query === JSON.stringify([route.fullPath, statusFilter.value, revealCode.value, pageNumber.value])
}
function clearView() {
  generation++; sequence++
  records.value = []; stats.value = null; selectedIds.value = new Set()
  total.value = 0; loading.value = false; loadError.value = ''; batchResult.value = null
}
function goPage(next: number) {
  if (loading.value || next < 1 || next > totalPages.value || next === pageNumber.value) return
  generation++
  pageNumber.value = next
  void loadData()
}

const records = ref<GiftCardRecord[]>([])
const stats = ref<GiftCardStats | null>(null)
const loading = ref(false)
const saving = ref(false)
const selectedIds = ref<Set<number>>(new Set())
const statusFilter = ref<GiftCardStatus | ''>('')
const revealCode = ref(false)
const batchResult = ref<{ batchId: string; codes: GiftCardRecord[] } | null>(null)

const form = ref({
  faceValue: 10,
  balanceValue: null as number | null,
  count: 1,
  expiresAt: '',
  remark: ''
})

const selectedCount = computed(() => selectedIds.value.size)
const statusOptions = computed<Array<{ value: GiftCardStatus | ''; label: string }>>(() => [
  { value: '', label: t('giftCards.status.all') },
  { value: 'active', label: t('giftCards.status.active') },
  { value: 'used', label: t('giftCards.status.used') },
  { value: 'disabled', label: t('giftCards.status.disabled') },
  { value: 'expired', label: t('giftCards.status.expired') }
])

function formatMoney(value: number): string {
  return new Intl.NumberFormat(locale.value, {
    style: 'currency',
    currency: 'CNY',
    maximumFractionDigits: 2
  }).format(value || 0)
}

function formatDate(value?: string | null): string {
  if (!value) return t('giftCards.neverExpires')
  return new Date(value).toLocaleString(locale.value)
}

function statusLabel(status: GiftCardStatus): string {
  return t(`giftCards.status.${status}`)
}

function statusClass(status: GiftCardStatus): string {
  return {
    active: 'text-green-600 dark:text-green-400',
    used: 'text-themed-muted',
    disabled: 'text-gray-400 dark:text-gray-500',
    expired: 'text-rose-600 dark:text-rose-400'
  }[status]
}

async function loadData(): Promise<void> {
  const current = context(), request = ++sequence
  if (!current()) return
  const valid = () => current() && request === sequence
  loading.value = true; loadError.value = ''; records.value = []; selectedIds.value = new Set()
  try {
    const [listResponse, statsResponse] = await Promise.all([
      api.giftCards.list({ page: pageNumber.value, pageSize, status: statusFilter.value || undefined, revealCode: revealCode.value }),
      api.giftCards.stats()
    ])
    if (!valid()) return
    total.value = listResponse.total
    if (pageNumber.value > totalPages.value) {
      pageNumber.value = totalPages.value
      await loadData()
      return
    }
    records.value = listResponse.records
    stats.value = statsResponse
  } catch (err: any) {
    if (valid()) loadError.value = t('giftCardsAdmin.toast.loadFailed', { message: err?.message || String(err) })
  } finally {
    if (valid()) loading.value = false
  }
}

async function createCards(): Promise<void> {
  const current = context()
  if (writing.value || !current()) return
  const count = Number(form.value.count)
  const faceValue = Number(form.value.faceValue)
  const balanceValue = form.value.balanceValue === null || form.value.balanceValue === undefined
    ? undefined
    : Number(form.value.balanceValue)
  if (!Number.isFinite(faceValue) || faceValue <= 0 || !Number.isSafeInteger(count) || count < 1) {
    toast.warning(t('giftCardsAdmin.toast.invalidCreateForm'))
    return
  }

  saving.value = true
  try {
    const payload = {
      faceValue,
      balanceValue,
      expiresAt: form.value.expiresAt || null,
      remark: form.value.remark.trim() || undefined
    }
    if (count === 1) {
      const response = await api.giftCards.generate(payload)
      if (!current()) return
      batchResult.value = { batchId: '', codes: [response.giftCard] }
      toast.success(t('giftCardsAdmin.toast.created'))
    } else {
      const response = await api.giftCards.batch({ ...payload, count })
      if (!current()) return
      batchResult.value = { batchId: response.batchId, codes: response.codes }
      toast.success(t('giftCardsAdmin.toast.batchCreated', { count: response.count }))
    }
    await loadData()
  } catch (err: any) {
    if (current()) toast.error(t('giftCardsAdmin.toast.createFailed', { message: err?.message || String(err) }))
  } finally {
    saving.value = false
  }
}

async function mutateCards(action: () => Promise<unknown>, success: (response: any) => string, failure: string): Promise<void> {
  const current = context()
  if (writing.value || loading.value || !current()) return
  mutationBusy.value = true
  try {
    const response = await action()
    if (!current()) return
    toast.success(success(response))
    await loadData()
  } catch (err: any) {
    if (current()) toast.error(t(failure, { message: err?.message || String(err) }))
  } finally { mutationBusy.value = false }
}
function updateCardStatus(card: GiftCardRecord): Promise<void> {
  const enable = card.status === 'disabled'
  return mutateCards(() => enable ? api.giftCards.enable(card.id) : api.giftCards.disable(card.id),
    () => t(enable ? 'giftCardsAdmin.toast.enabled' : 'giftCardsAdmin.toast.disabled'), 'giftCardsAdmin.toast.updateFailed')
}
async function deleteCard(card: GiftCardRecord): Promise<void> {
  if (writing.value || !context()() || !confirm(t('giftCardsAdmin.confirm.deleteOne', { code: card.codeMasked || card.code }))) return
  await mutateCards(() => api.giftCards.delete(card.id), () => t('giftCardsAdmin.toast.deleted'), 'giftCardsAdmin.toast.deleteFailed')
}
async function batchDisable(): Promise<void> {
  const ids = Array.from(selectedIds.value)
  if (writing.value || !context()() || ids.length === 0 || !confirm(t('giftCardsAdmin.confirm.disableSelected', { count: ids.length }))) return
  await mutateCards(() => api.giftCards.batchDisable(ids), response => t('giftCardsAdmin.toast.batchDisabled', { count: response.count }), 'giftCardsAdmin.toast.batchDisableFailed')
}
async function batchDelete(): Promise<void> {
  const ids = Array.from(selectedIds.value)
  if (writing.value || !context()() || ids.length === 0 || !confirm(t('giftCardsAdmin.confirm.deleteSelected', { count: ids.length }))) return
  await mutateCards(() => api.giftCards.batchDelete(ids), response => t('giftCardsAdmin.toast.batchDeleted', { count: response.count }), 'giftCardsAdmin.toast.batchDeleteFailed')
}

function toggleSelected(id: number, checked: boolean): void {
  const next = new Set(selectedIds.value)
  if (checked) next.add(id)
  else next.delete(id)
  selectedIds.value = next
}

async function copyCodes(codes: GiftCardRecord[]): Promise<void> {
  await navigator.clipboard.writeText(codes.map(card => card.code).join('\n'))
  toast.success(t('giftCards.toast.copied'))
}

watch([sessionKey, () => route.fullPath, statusFilter, revealCode], () => {
  clearView(); pageNumber.value = 1
  if (active) void loadData()
}, { flush: 'sync' })
function activate() { if (!active) { active = true; void loadData() } }
function deactivate() { active = false; clearView() }
onMounted(activate)
onActivated(activate)
onDeactivated(deactivate)
onBeforeUnmount(() => { alive = false; deactivate() })
</script>

<template>
  <div class="kawaii-page space-y-6 animate-fade-in">
    <div class="page-header">
      <div class="flex items-center gap-3">
        <span class="gc-title-icon">
          <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7" d="M21 11.25v8.25a1.5 1.5 0 0 1-1.5 1.5H5.25a1.5 1.5 0 0 1-1.5-1.5v-8.25M12 4.875A2.625 2.625 0 1 0 9.375 7.5H12m0-2.625V7.5m0-2.625A2.625 2.625 0 1 1 14.625 7.5H12M4.5 7.5h15a1.5 1.5 0 0 1 1.5 1.5v1.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 10.5V9a1.5 1.5 0 0 1 1.5-1.5Zm3.75 3.75v9.75m7.5-9.75v9.75" />
          </svg>
        </span>
        <div>
          <h1 class="page-title">{{ t('giftCardsAdmin.title') }}</h1>
          <p class="page-description">{{ t('giftCardsAdmin.description') }}</p>
        </div>
      </div>
      <button class="btn btn-secondary" :disabled="loading" @click="loadData">
        <svg class="h-4 w-4" :class="{ 'animate-spin': loading }" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M4 4v5h.58m15.36 2A8 8 0 0 0 5.07 8.11M20 20v-5h-.58m0 0A8 8 0 0 1 4.06 12.03" />
        </svg>
        {{ loading ? t('giftCards.loading') : t('giftCards.refresh') }}
      </button>
    </div>

    <div v-if="stats" class="grid gap-4 md:grid-cols-4">
      <div class="card gc-stat p-4">
        <div class="gc-stat-label">{{ t('giftCardsAdmin.stats.active') }}</div>
        <div class="gc-stat-value">{{ stats.active }}</div>
      </div>
      <div class="card gc-stat p-4">
        <div class="gc-stat-label">{{ t('giftCardsAdmin.stats.used') }}</div>
        <div class="gc-stat-value">{{ stats.used }}</div>
      </div>
      <div class="card gc-stat p-4">
        <div class="gc-stat-label">{{ t('giftCardsAdmin.stats.outstanding') }}</div>
        <div class="gc-stat-value">{{ formatMoney(stats.outstandingValue) }}</div>
      </div>
      <div class="card gc-stat p-4">
        <div class="gc-stat-label">{{ t('giftCardsAdmin.stats.redeemed') }}</div>
        <div class="gc-stat-value">{{ formatMoney(stats.totalRedeemedValue) }}</div>
      </div>
    </div>

    <section class="card p-6">
      <div class="mb-4 flex items-center gap-2 border-b border-themed pb-4">
        <svg class="h-4 w-4 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        <h2 class="text-base font-semibold text-themed">{{ t('giftCardsAdmin.generateTitle') }}</h2>
      </div>
      <div class="grid gap-4 lg:grid-cols-6">
        <label class="space-y-1.5">
          <span class="gc-field-label">{{ t('giftCardsAdmin.faceValueLabel') }}</span>
          <input v-model.number="form.faceValue" class="input" type="number" min="0.01" max="10000" step="0.01" :placeholder="t('giftCardsAdmin.faceValuePlaceholder')" />
        </label>
        <label class="space-y-1.5">
          <span class="gc-field-label">{{ t('giftCardsAdmin.balanceValueLabel') }}</span>
          <input v-model.number="form.balanceValue" class="input" type="number" min="0.01" max="10000" step="0.01" :placeholder="t('giftCardsAdmin.balanceValuePlaceholder')" />
        </label>
        <label class="space-y-1.5">
          <span class="gc-field-label">{{ t('giftCardsAdmin.countLabel') }}</span>
          <input v-model.number="form.count" class="input" type="number" min="1" max="500" step="1" :placeholder="t('giftCardsAdmin.countPlaceholder')" />
        </label>
        <label class="space-y-1.5 lg:col-span-2">
          <span class="gc-field-label">{{ t('giftCardsAdmin.expiresAtLabel') }}</span>
          <input v-model="form.expiresAt" class="input" type="datetime-local" />
        </label>
        <label class="space-y-1.5 lg:col-span-5">
          <span class="gc-field-label">{{ t('giftCardsAdmin.remarkLabel') }}</span>
          <input v-model="form.remark" class="input" maxlength="200" :placeholder="t('giftCards.remarkPlaceholder')" />
        </label>
        <div class="flex items-end">
          <button class="btn btn-primary w-full" :disabled="writing" @click="createCards">
            {{ saving ? t('giftCards.generating') : t('giftCards.generate') }}
          </button>
        </div>
      </div>
    </section>

    <section v-if="batchResult" class="gc-result">
      <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <div class="flex items-center gap-2 font-medium text-themed">
            <svg class="h-4 w-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="m4.5 12.75 6 6 9-13.5" />
            </svg>
            {{ t('giftCardsAdmin.batchResultTitle') }}
          </div>
          <div v-if="batchResult.batchId" class="mt-1 font-mono text-xs text-themed-muted">{{ t('giftCardsAdmin.batchId', { batchId: batchResult.batchId }) }}</div>
        </div>
        <button class="btn btn-secondary btn-sm" @click="copyCodes(batchResult.codes)">{{ t('giftCardsAdmin.copyAll') }}</button>
      </div>
      <pre class="gc-code-block">{{ batchResult.codes.map(card => card.code).join('\n') }}</pre>
    </section>

    <section class="card overflow-hidden">
      <div class="flex flex-col gap-3 border-b border-themed p-4 lg:flex-row lg:items-center lg:justify-between">
        <div class="flex flex-col gap-3 sm:flex-row">
          <select v-model="statusFilter" class="input w-full sm:w-44">
            <option v-for="item in statusOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
          </select>
          <label class="flex h-10 items-center gap-2 text-sm text-themed">
            <input v-model="revealCode" type="checkbox" class="h-4 w-4 rounded text-accent" />
            {{ t('giftCardsAdmin.revealCode') }}
          </label>
        </div>
        <div class="flex gap-2">
          <button class="btn btn-secondary btn-sm" :disabled="selectedCount === 0 || writing || loading" @click="batchDisable">{{ t('giftCardsAdmin.batchDisable') }}</button>
          <button class="btn btn-sm text-rose-600 hover:bg-rose-500/10 dark:text-rose-400" :disabled="selectedCount === 0 || writing || loading" @click="batchDelete">{{ t('giftCardsAdmin.batchDelete') }}</button>
        </div>
      </div>

      <div v-if="loadError" role="alert" class="flex flex-wrap items-center justify-between gap-3 p-4 text-sm text-themed">
        <span>{{ loadError }}</span>
        <button data-gift-retry class="btn btn-secondary min-h-[44px]" @click="loadData">{{ t('common.retry') }}</button>
      </div>
      <div class="space-y-3 p-4 lg:hidden">
        <div v-for="card in records" :key="card.id" class="rounded-lg border border-themed bg-themed-surface p-4">
          <div class="flex items-start gap-3">
            <input type="checkbox" class="mt-1 h-4 w-4 rounded text-accent" :checked="selectedIds.has(card.id)" @change="toggleSelected(card.id, ($event.target as HTMLInputElement).checked)" />
            <div class="min-w-0 flex-1">
              <div class="flex items-start justify-between gap-3">
                <code class="break-all font-mono text-xs text-themed">{{ card.code }}</code>
                <span class="gc-pill shrink-0" :class="statusClass(card.status)"><span class="gc-dot"></span>{{ statusLabel(card.status) }}</span>
              </div>
              <div class="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div class="gc-cell-label">{{ t('giftCards.amount') }}</div>
                  <div class="font-medium tabular-nums text-themed">{{ formatMoney(card.balanceValue) }}</div>
                  <div class="text-xs text-themed-muted">{{ t('giftCardsAdmin.faceValue', { amount: formatMoney(card.faceValue) }) }}</div>
                </div>
                <div>
                  <div class="gc-cell-label">{{ t('giftCards.expiresAt') }}</div>
                  <div class="text-themed">{{ formatDate(card.expiresAt) }}</div>
                </div>
              </div>
              <div class="mt-3 space-y-1 text-xs text-themed-muted">
                <div>{{ t('giftCardsAdmin.createdBy', { user: card.createdBy?.username || '-' }) }}</div>
                <div>{{ t('giftCardsAdmin.owner', { user: card.owner?.username || '-' }) }}</div>
                <div>{{ t('giftCardsAdmin.usedBy', { user: card.usedBy?.username || '-' }) }}</div>
              </div>
              <div class="mt-4 flex flex-wrap gap-2">
                <button v-if="card.status === 'active' || card.status === 'disabled'" class="btn btn-secondary btn-sm" :disabled="writing || loading" @click="updateCardStatus(card)">
                  {{ card.status === 'disabled' ? t('giftCardsAdmin.enable') : t('giftCardsAdmin.disable') }}
                </button>
                <button v-if="card.status !== 'used'" class="btn btn-danger btn-sm" :disabled="writing || loading" @click="deleteCard(card)">{{ t('giftCardsAdmin.delete') }}</button>
              </div>
            </div>
          </div>
        </div>
        <div v-if="!loading && records.length === 0" class="py-8 text-center text-themed-muted">{{ t('giftCards.empty') }}</div>
      </div>

      <div class="hidden overflow-hidden lg:block">
        <table class="w-full table-fixed text-sm">
          <thead>
            <tr class="border-b border-themed">
              <th class="w-[4%] px-4 py-3"></th>
              <th class="gc-th w-[28%]">{{ t('giftCards.code') }}</th>
              <th class="gc-th w-[14%]">{{ t('giftCards.amount') }}</th>
              <th class="gc-th w-[12%]">{{ t('giftCards.statusTitle') }}</th>
              <th class="gc-th w-[20%]">{{ t('giftCardsAdmin.createdAndUsed') }}</th>
              <th class="gc-th w-[12%]">{{ t('giftCards.expiresAt') }}</th>
              <th class="gc-th w-[10%]">{{ t('giftCards.action') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="card in records" :key="card.id" class="gc-row border-b border-themed">
              <td class="px-4 py-3">
                <input type="checkbox" class="h-4 w-4 rounded text-accent" :checked="selectedIds.has(card.id)" @change="toggleSelected(card.id, ($event.target as HTMLInputElement).checked)" />
              </td>
              <td class="px-4 py-3 font-mono text-xs text-themed">
                <span class="block truncate">{{ card.code }}</span>
              </td>
              <td class="px-4 py-3 text-themed">
                <div class="font-medium tabular-nums">{{ formatMoney(card.balanceValue) }}</div>
                <div class="text-xs text-themed-muted">{{ t('giftCardsAdmin.faceValue', { amount: formatMoney(card.faceValue) }) }}</div>
              </td>
              <td class="px-4 py-3">
                <span class="gc-pill" :class="statusClass(card.status)"><span class="gc-dot"></span>{{ statusLabel(card.status) }}</span>
              </td>
              <td class="px-4 py-3 text-xs text-themed-muted">
                <div class="truncate">{{ t('giftCardsAdmin.createdBy', { user: card.createdBy?.username || '-' }) }}</div>
                <div class="truncate">{{ t('giftCardsAdmin.owner', { user: card.owner?.username || '-' }) }}</div>
                <div class="truncate">{{ t('giftCardsAdmin.usedBy', { user: card.usedBy?.username || '-' }) }}</div>
              </td>
              <td class="px-4 py-3 text-themed-muted">{{ formatDate(card.expiresAt) }}</td>
              <td class="px-4 py-3">
                <div class="flex flex-wrap gap-2">
                  <button v-if="card.status === 'active' || card.status === 'disabled'" class="btn btn-secondary btn-sm" :disabled="writing || loading" @click="updateCardStatus(card)">
                    {{ card.status === 'disabled' ? t('giftCardsAdmin.enable') : t('giftCardsAdmin.disable') }}
                  </button>
                  <button v-if="card.status !== 'used'" class="btn btn-danger btn-sm" :disabled="writing || loading" @click="deleteCard(card)">{{ t('giftCardsAdmin.delete') }}</button>
                </div>
              </td>
            </tr>
            <tr v-if="!loading && records.length === 0">
              <td colspan="7" class="py-8 text-center text-themed-muted">{{ t('giftCards.empty') }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="flex flex-wrap items-center justify-between gap-3 border-t border-themed p-4 text-sm text-themed">
        <span>{{ t('orders.totalRecords', { count: total }) }}</span>
        <div class="flex items-center gap-3">
          <button data-gift-prev class="btn btn-secondary min-h-[44px]" :disabled="loading || pageNumber <= 1" @click="goPage(pageNumber - 1)">{{ t('orders.prevPage') }}</button>
          <span aria-live="polite" class="tabular-nums">{{ pageNumber }} / {{ totalPages }}</span>
          <button data-gift-next class="btn btn-secondary min-h-[44px]" :disabled="loading || pageNumber >= totalPages" @click="goPage(pageNumber + 1)">{{ t('orders.nextPage') }}</button>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.gc-title-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 0.75rem;
  color: var(--kawaii-primary);
  background: color-mix(in srgb, var(--kawaii-primary) 12%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--kawaii-primary) 28%, transparent);
}

.gc-stat {
  position: relative;
  overflow: hidden;
}

.gc-stat::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 2.25rem;
  height: 2px;
  background: var(--kawaii-primary);
  border-radius: 0 0 2px 0;
}

.gc-stat-label {
  font-size: 0.75rem;
  font-weight: 500;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--kawaii-faint);
}

.gc-stat-value {
  margin-top: 0.5rem;
  font-size: 1.5rem;
  font-weight: 600;
  line-height: 1.1;
  color: var(--kawaii-text);
  font-variant-numeric: tabular-nums;
}

.gc-field-label {
  display: block;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--kawaii-muted);
}

.gc-cell-label {
  font-size: 0.6875rem;
  color: var(--kawaii-faint);
}

.gc-result {
  border-radius: 0.75rem;
  border: 1px solid color-mix(in srgb, var(--kawaii-primary) 28%, var(--kawaii-line));
  background: color-mix(in srgb, var(--kawaii-primary) 7%, var(--kawaii-surface));
  padding: 1rem;
  font-size: 0.875rem;
  color: var(--kawaii-text);
}

.gc-code-block {
  margin-top: 0.75rem;
  max-height: 14rem;
  overflow: auto;
  border-radius: 0.5rem;
  border: 1px solid var(--kawaii-line);
  background: var(--kawaii-surface);
  padding: 0.75rem;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  font-size: 0.75rem;
  line-height: 1.6;
  color: var(--kawaii-muted);
}

.gc-th {
  padding: 0.75rem 1rem;
  text-align: left;
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--kawaii-faint);
}

.gc-row {
  transition: background-color 0.12s ease;
}

.gc-row:hover {
  background: color-mix(in srgb, var(--kawaii-primary) 5%, transparent);
}

.gc-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.125rem 0.5rem;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 500;
  white-space: nowrap;
  border: 1px solid color-mix(in srgb, currentColor 32%, transparent);
  background: color-mix(in srgb, currentColor 10%, transparent);
}

.gc-dot {
  width: 0.375rem;
  height: 0.375rem;
  border-radius: 9999px;
  background: currentColor;
}

@media (prefers-reduced-motion: reduce) {
  .gc-row {
    transition: none;
  }
}
</style>
