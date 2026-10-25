<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api/admin'
import { formatLogContent } from '@/utils/log-format'
import type { ExpiryHistoryItem, ExpiryHistoryQuery, ExpiryHistoryResponse } from '@/types/expiry-enforcement'
const { t, te, locale } = useI18n()
const form = ref({ startDate: '', endDate: '', username: '', email: '', search: '' })
const expandedFilters = ref(false)
const result = ref<ExpiryHistoryResponse | null>(null), loading = ref(false), error = ref('')
let applied: ExpiryHistoryQuery = {}
function date(value: string | null) { return value ? new Date(value).toLocaleString(locale.value) : '—' }
function actionName(item: ExpiryHistoryItem) {
  const names: Record<string, string> = {
    'system.expiry_enforcement_started': 'runStarted', 'system.expiry_enforcement': 'runFinished',
    'instance.auto_renew': 'renew', 'instance.auto_renew_failed': 'renew',
    'instance.suspended_expired': 'suspend', 'instance.deleted_expired': 'delete', 'instance.expiry_stop_reconciled': 'stopVerified'
  }
  return t(`expiryEnforcement.history.${names[item.action] || 'event'}`)
}
function displayedResult(item: ExpiryHistoryItem) { return item.action.startsWith('system.expiry_enforcement') && !item.run ? 'warning' : item.result }
function outcome(item: ExpiryHistoryItem) { return t(`expiryEnforcement.history.${item.run && !item.run.finishedAt ? 'started' : displayedResult(item) === 'success' ? 'success' : displayedResult(item) === 'failed' ? 'failed' : 'warning'}`) }
function description(item: ExpiryHistoryItem) {
  if (item.run) return item.run.finishedAt ? t('expiryEnforcement.history.runSummary', { count: item.run.failureCount }) : t('expiryEnforcement.history.runBeginning')
  if (item.action.startsWith('system.expiry_enforcement')) return t('expiryEnforcement.history.unreadableSummary')
  const name = item.content.match(/(?:instance|实例)\s*["「]([^"」]+)["」]/i)?.[1] || t('expiryEnforcement.history.unnamed')
  if (item.action === 'instance.auto_renew') {
    const values = item.content.match(/for (\d+) month\(s\), amount: (.+)$/)
    return values ? t('expiryEnforcement.history.renewCompleted', { name, months: values[1], amount: values[2] }) : formatLogContent(item.content)
  }
  if (item.action === 'instance.auto_renew_failed') {
    const reason = item.content.replace(/^Auto-renew failed for instance "[^"]+":\s*/i, '')
    return t('expiryEnforcement.history.renewFailed', { name, reason: /insufficient balance|余额不足/i.test(reason) ? t('expiryEnforcement.history.lowBalance') : formatLogContent(reason) })
  }
  if (item.action === 'instance.suspended_expired') return t(item.result === 'warning' ? 'expiryEnforcement.history.stopPending' : 'expiryEnforcement.history.suspendCompleted', { name })
  if (item.action === 'instance.deleted_expired') return t('expiryEnforcement.history.deleteCompleted', { name })
  if (item.action === 'instance.expiry_stop_reconciled') return t('expiryEnforcement.history.stopCompleted', { name })
  return formatLogContent(item.content)
}
function failure(code: string | null) { const key = `expiryEnforcement.errorCodes.${code}`; return code ? t(te(key) ? key : 'expiryEnforcement.history.checkDetails') : '' }
async function load(page = 1) {
  if (loading.value) return
  loading.value = true; error.value = ''
  try { result.value = await api.admin.expiryEnforcementHistory({ ...applied, page, pageSize: 20 }) }
  catch (cause) {
    const code = (cause as { code?: string }).code
    error.value = t(code === 'EXPIRY_LOG_RANGE_INVALID' ? 'expiryEnforcement.history.invalidRange' : 'expiryEnforcement.history.loadFailed')
  } finally { loading.value = false }
}
function search() {
  if (loading.value) return
  const from = form.value.startDate ? new Date(form.value.startDate) : null, to = form.value.endDate ? new Date(form.value.endDate) : null
  if ((from && !Number.isFinite(from.getTime())) || (to && !Number.isFinite(to.getTime())) || (from && to && from > to)) { error.value = t('expiryEnforcement.history.invalidRange'); return }
  applied = { startDate: from?.toISOString(), endDate: to?.toISOString(),
    username: form.value.username.trim() || undefined, email: form.value.email.trim() || undefined, search: form.value.search.trim() || undefined }
  void load()
}
function reset() { if (loading.value) return; form.value = { startDate: '', endDate: '', username: '', email: '', search: '' }; applied = {}; void load() }
onMounted(() => { void load() })
</script>
<template>
  <div class="expiry-history space-y-5" :aria-busy="loading">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0 flex-1"><h3 class="text-base font-semibold text-themed">{{ t('expiryEnforcement.history.title') }}</h3><p class="mt-1 text-sm text-themed-muted">{{ t('expiryEnforcement.history.description', { days: result?.retentionDays || 90 }) }}</p></div>
      <button type="button" class="btn-secondary" :disabled="loading" @click="load(result?.page || 1)">{{ t('expiryEnforcement.history.refresh') }}</button>
    </div>
    <form class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" @submit.prevent="search">
      <button type="button" class="btn-secondary sm:hidden" :aria-expanded="expandedFilters" aria-controls="expiry-history-filters" @click="expandedFilters = !expandedFilters">{{ t(expandedFilters ? 'expiryEnforcement.history.hideFilters' : 'expiryEnforcement.history.showFilters') }}</button>
      <div id="expiry-history-filters" class="grid-cols-1 gap-3 sm:col-span-2 sm:grid-cols-2 xl:col-span-4 xl:grid-cols-4" :class="expandedFilters ? 'grid' : 'hidden sm:grid'">
        <label class="space-y-1 text-sm text-themed-muted"><span>{{ t('expiryEnforcement.history.from') }}</span><input v-model="form.startDate" type="datetime-local" class="input w-full" /></label>
        <label class="space-y-1 text-sm text-themed-muted"><span>{{ t('expiryEnforcement.history.to') }}</span><input v-model="form.endDate" type="datetime-local" class="input w-full" /></label>
        <label class="space-y-1 text-sm text-themed-muted"><span>{{ t('expiryEnforcement.history.username') }}</span><input v-model="form.username" type="text" maxlength="128" class="input w-full" :placeholder="t('expiryEnforcement.history.usernameHint')" /></label>
        <label class="space-y-1 text-sm text-themed-muted"><span>{{ t('expiryEnforcement.history.email') }}</span><input v-model="form.email" type="text" inputmode="email" maxlength="254" class="input w-full" :placeholder="t('expiryEnforcement.history.emailHint')" /></label>
      </div>
      <label class="space-y-1 text-sm text-themed-muted sm:col-span-2 xl:col-span-3"><span>{{ t('expiryEnforcement.history.keyword') }}</span><input v-model="form.search" type="search" maxlength="256" class="input w-full" :placeholder="t('expiryEnforcement.history.keywordHint')" /></label>
      <div class="flex items-end gap-2"><button type="submit" class="btn-primary" :disabled="loading">{{ t('expiryEnforcement.history.search') }}</button><button type="button" class="btn-secondary" :disabled="loading" @click="reset">{{ t('expiryEnforcement.history.reset') }}</button></div>
    </form>
    <p v-if="error" role="alert" class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
    <p v-if="loading" role="status" class="text-sm text-themed-muted">{{ t('expiryEnforcement.history.loading') }}</p>
    <template v-if="result">
      <p class="text-sm text-themed-muted" role="status">{{ t('expiryEnforcement.history.total', { count: result.total }) }}</p>
      <div v-if="!result.items.length" class="rounded-lg border border-themed px-5 py-8 text-sm text-themed-muted">{{ t('expiryEnforcement.history.empty') }}</div>
      <div v-else>
        <div class="space-y-3 md:hidden">
          <article v-for="item in result.items" :key="item.id" class="rounded-lg border border-themed p-4 space-y-2">
            <div class="flex items-center justify-between gap-3"><p class="text-sm font-medium text-themed">{{ actionName(item) }}</p><span class="text-sm" :class="displayedResult(item) === 'failed' ? 'text-red-700 dark:text-red-300' : displayedResult(item) === 'success' ? 'text-green-700 dark:text-green-300' : 'text-amber-700 dark:text-amber-300'">{{ outcome(item) }}</span></div>
            <p class="text-xs text-themed-muted">{{ date(item.createdAt) }}</p>
            <p class="break-words text-sm text-themed">{{ item.username || t('expiryEnforcement.history.system') }}<span v-if="item.email" class="mt-1 block text-themed-muted">{{ item.email }}</span></p>
            <p class="break-words whitespace-pre-wrap text-sm text-themed">{{ description(item) }}</p>
            <details v-if="item.run" class="text-sm"><summary class="cursor-pointer text-themed-muted">{{ t('expiryEnforcement.history.details') }}</summary><p class="mt-2 text-themed-muted">{{ t('expiryEnforcement.started') }}：{{ date(item.run.startedAt) }}<br />{{ t('expiryEnforcement.finished') }}：{{ date(item.run.finishedAt) }}</p><p v-if="item.run.lastError" class="mt-2 text-red-700 dark:text-red-300">{{ failure(item.run.lastError) }}</p></details>
          </article>
        </div>
        <div class="hidden overflow-hidden rounded-lg border border-themed md:block">
          <table class="w-full table-fixed text-left text-sm">
            <colgroup><col style="width: 20%" /><col style="width: 12%" /><col style="width: 26%" /><col style="width: 42%" /></colgroup>
            <thead class="border-b border-themed text-xs text-themed-muted"><tr><th class="p-3 font-medium">{{ t('expiryEnforcement.history.time') }}</th><th class="p-3 font-medium">{{ t('expiryEnforcement.history.outcome') }}</th><th class="p-3 font-medium">{{ t('expiryEnforcement.history.user') }}</th><th class="p-3 font-medium">{{ t('expiryEnforcement.history.detail') }}</th></tr></thead>
            <tbody class="divide-y divide-themed">
              <tr v-for="item in result.items" :key="item.id" class="align-top">
                <td class="p-3 text-themed-muted">{{ date(item.createdAt) }}</td>
                <td class="p-3" :class="displayedResult(item) === 'failed' ? 'text-red-700 dark:text-red-300' : displayedResult(item) === 'success' ? 'text-green-700 dark:text-green-300' : 'text-amber-700 dark:text-amber-300'">{{ outcome(item) }}</td>
                <td class="p-3 break-words text-themed">{{ item.username || t('expiryEnforcement.history.system') }}<span v-if="item.email" class="mt-1 block text-xs text-themed-muted">{{ item.email }}</span></td>
                <td class="p-3"><p class="font-medium text-themed">{{ actionName(item) }}</p><p class="mt-1 whitespace-pre-wrap break-words text-themed-muted">{{ description(item) }}</p><details v-if="item.run" class="mt-2"><summary class="cursor-pointer text-xs text-themed-muted">{{ t('expiryEnforcement.history.details') }}</summary><p class="mt-2 text-xs text-themed-muted">{{ t('expiryEnforcement.started') }}：{{ date(item.run.startedAt) }}<br />{{ t('expiryEnforcement.finished') }}：{{ date(item.run.finishedAt) }}</p><p v-if="item.run.lastError" class="mt-2 text-red-700 dark:text-red-300">{{ failure(item.run.lastError) }}</p></details></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div v-if="result.totalPages > 1" class="flex flex-wrap items-center justify-between gap-3">
        <p class="text-sm text-themed-muted">{{ t('expiryEnforcement.history.page', { page: result.page, pages: result.totalPages }) }}</p>
        <div class="flex gap-2"><button type="button" class="btn-secondary" :disabled="loading || result.page <= 1" @click="load(result.page - 1)">{{ t('expiryEnforcement.history.previous') }}</button><button type="button" class="btn-secondary" :disabled="loading || result.page >= result.totalPages" @click="load(result.page + 1)">{{ t('expiryEnforcement.history.next') }}</button></div>
      </div>
    </template>
  </div>
</template>
<style scoped>
.expiry-history .input { min-width: 0; }
.expiry-history th { background: var(--bg-primary); }
summary:focus-visible, input:focus-visible, button:focus-visible { outline: 2px solid var(--text-primary); outline-offset: 3px; }
@media (max-width: 640px) { input, button, summary { min-height: 44px; } summary { display: flex; align-items: center; } }
</style>
