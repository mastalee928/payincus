<script setup lang="ts">
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api/admin'
import { useAuthStore } from '@/stores/auth'
import type { HostAbuseOverview, HostAbusePolicy } from '@/types/host-abuse-policy'
const { t, te } = useI18n(), auth = useAuthStore()
const overview = ref<HostAbuseOverview | null>(null)
const draft = ref<HostAbusePolicy>({ revision: 0, blockBt: false, blockMining: false })
const loading = ref(true), busy = ref<'save' | 'retry' | ''>(''), error = ref(''), loadError = ref(''), notice = ref('')
const stalePolicy = ref(false)
const search = ref(''), state = ref('attention'), page = ref(1)
let active = true, disposed = false, sequence = 0, initialized = false, timer: ReturnType<typeof setTimeout> | undefined
const dirty = computed(() => !!overview.value && (draft.value.blockBt !== overview.value.policy.blockBt || draft.value.blockMining !== overview.value.policy.blockMining))
const retryCount = computed(() => overview.value ? overview.value.summary.pending + overview.value.summary.retrying + overview.value.summary.offline : 0)
const allowed = () => active && !disposed && auth.user?.role === 'admin' && !!auth.token
function message(failure: unknown) {
  const code = (failure as { code?: string })?.code
  return t(code === 'ABUSE_POLICY_CHANGED' ? 'hostAbuse.changed' : code === 'FORBIDDEN' ? 'hostAbuse.forbidden' : 'hostAbuse.actionFailed')
}
function date(value: string) { return new Date(value).toLocaleString() }
async function refresh(resetDraft = false) {
  if (!allowed() || busy.value) return
  const authentication = auth.captureAuthentication(), request = ++sequence
  if (!authentication.aligned) return
  const current = () => allowed() && authentication.current() && request === sequence
  try {
    const value = await api.hosts.abusePolicy({ page: page.value, search: search.value.trim(), state: state.value })
    if (!current()) return
    const keepDraft = initialized && dirty.value && !resetDraft
    overview.value = value; page.value = value.page; loadError.value = ''
    if (!keepDraft) draft.value = { ...value.policy }
    if (resetDraft) { stalePolicy.value = false; error.value = '' }
    initialized = true
  } catch { if (current()) loadError.value = t('hostAbuse.loadFailed') }
  finally {
    if (current()) {
      loading.value = false
      clearTimeout(timer)
      timer = setTimeout(() => { if (document.visibilityState === 'visible') void refresh(); else schedule() }, 10000)
    }
  }
}
function schedule() { clearTimeout(timer); if (allowed()) timer = setTimeout(() => void refresh(), 10000) }
async function mutate(kind: 'save' | 'retry') {
  if (!allowed() || busy.value || loading.value || !overview.value) return
  const authentication = auth.captureAuthentication()
  if (!authentication.aligned) return
  const submitted = { ...draft.value }, revision = overview.value.policy.revision
  const request = ++sequence
  clearTimeout(timer); busy.value = kind; error.value = ''; notice.value = ''; stalePolicy.value = false
  const current = () => allowed() && authentication.current() && request === sequence
  try {
    if (kind === 'save') {
      const policy = await api.hosts.saveAbusePolicy(submitted)
      if (!current()) return
      draft.value = { ...policy }; overview.value.policy = { ...policy }; notice.value = t('hostAbuse.saved')
    } else {
      const result = await api.hosts.retryAbusePolicy(revision)
      if (!current()) return
      notice.value = t('hostAbuse.retried', result)
      const rejected = result.results.find(row => !row.success && ['FORBIDDEN', 'ABUSE_POLICY_CHANGED'].includes(row.code || ''))
      if (rejected) { error.value = message(rejected); stalePolicy.value = rejected.code === 'ABUSE_POLICY_CHANGED' }
    }
  } catch (failure) { if (current()) { error.value = message(failure); stalePolicy.value = (failure as { code?: string }).code === 'ABUSE_POLICY_CHANGED' } }
  finally { if (current()) { busy.value = ''; await refresh() } }
}
function filter() { page.value = 1; void refresh() }
watch(() => [auth.user?.id, auth.user?.role, auth.token], () => {
  ++sequence; clearTimeout(timer); overview.value = null; initialized = false; loading.value = true
  draft.value = { revision: 0, blockBt: false, blockMining: false }; error.value = ''; notice.value = ''; busy.value = ''
  stalePolicy.value = false; loadError.value = ''
  if (allowed()) void refresh(true)
})
onMounted(() => void refresh(true))
onActivated(() => { if (!active) { active = true; void refresh() } })
onDeactivated(() => { active = false; ++sequence; clearTimeout(timer); busy.value = '' })
onUnmounted(() => { disposed = true; ++sequence; clearTimeout(timer) })
</script>
<template>
  <section class="abuse-policy card p-5 space-y-5" :aria-busy="loading || !!busy">
    <div><h2 class="text-lg font-semibold text-themed">{{ t('hostAbuse.title') }}</h2><p class="mt-1 text-sm text-themed-muted">{{ t('hostAbuse.description') }}</p></div>
    <form class="space-y-4" @submit.prevent="mutate('save')">
      <fieldset class="grid gap-4 sm:grid-cols-2" :disabled="loading || !!busy || !overview">
        <label v-for="key in (['blockBt', 'blockMining'] as const)" :key="key" class="flex items-start gap-3 cursor-pointer py-2">
          <input v-model="draft[key]" type="checkbox" class="mt-1 h-5 w-5 shrink-0 accent-black dark:accent-white" :data-abuse-toggle="key" />
          <span><span class="block text-sm font-medium text-themed">{{ t(`hostAbuse.${key}`) }}</span><span class="mt-1 block text-sm text-themed-muted">{{ t(key === 'blockBt' ? 'hostAbuse.btHint' : 'hostAbuse.miningHint') }}</span></span>
        </label>
      </fieldset>
      <p class="text-sm text-themed-muted">{{ t('hostAbuse.scope') }}</p>
      <div class="flex flex-wrap gap-3">
        <button type="submit" class="btn-primary" :disabled="loading || !!busy || !overview || (!!overview.policy.revision && !dirty && !overview.summary.conflict)">{{ t(busy === 'save' ? 'hostAbuse.saving' : 'hostAbuse.save') }}</button>
        <button type="button" class="btn-secondary" :disabled="loading || !!busy || !retryCount || !overview?.policy.revision" @click="mutate('retry')">{{ t(busy === 'retry' ? 'hostAbuse.retrying' : 'hostAbuse.retry') }}</button>
        <button type="button" class="btn-secondary" :disabled="!!busy" @click="refresh()">{{ t('hostAbuse.refresh') }}</button>
      </div>
    </form>
    <p v-if="error || loadError" role="alert" class="text-sm text-red-700 dark:text-red-300">{{ error || loadError }}</p>
    <button v-if="stalePolicy" type="button" class="btn-secondary" :disabled="!!busy" @click="refresh(true)">{{ t('hostAbuse.reloadPolicy') }}</button>
    <p v-if="notice" role="status" class="text-sm text-themed">{{ notice }}</p>
    <div v-if="overview" class="space-y-2" role="status">
      <p v-if="!overview.policy.revision" class="text-sm text-themed-muted">{{ t('hostAbuse.notConfigured') }}</p>
      <p v-else class="text-sm font-medium text-themed">{{ t('hostAbuse.summary', overview.summary) }}</p>
      <p class="text-sm text-themed-muted">{{ t('hostAbuse.automatic') }}</p>
      <p v-if="overview.summary.conflict" class="text-sm text-amber-800 dark:text-amber-300">{{ t('hostAbuse.conflicts') }}</p>
      <p v-if="overview.summary.unsupported && overview.policy.revision" class="text-sm text-amber-800 dark:text-amber-300">{{ t('hostAbuse.upgrade') }}</p>
    </div>
    <details v-if="overview" class="border-t border-themed pt-4">
      <summary class="cursor-pointer text-sm font-medium text-themed">{{ t('hostAbuse.details') }}</summary>
      <div class="mt-4 space-y-4">
        <form class="abuse-filters gap-3" @submit.prevent="filter">
          <input v-model="search" type="search" maxlength="100" class="input flex-1 min-w-0" :aria-label="t('hostAbuse.search')" :placeholder="t('hostAbuse.search')" @change="filter" />
          <select v-model="state" class="input" :aria-label="t('hostAbuse.filter')" @change="filter">
            <option value="attention">{{ t('hostAbuse.attention') }}</option><option value="all">{{ t('hostAbuse.all') }}</option>
            <option v-for="value in (['applied', 'pending', 'retrying', 'offline', 'unsupported', 'conflict'] as const)" :key="value" :value="value">{{ t(`hostAbuse.states.${value}`) }}</option>
          </select>
        </form>
        <p v-if="!overview.hosts.length" class="text-sm text-themed-muted">{{ t(overview.summary.total ? (search.trim() || state !== 'attention' ? 'hostAbuse.noMatches' : 'hostAbuse.empty') : 'hostAbuse.noHosts') }}</p>
        <ul class="divide-y divide-themed max-h-[32rem] overflow-y-auto">
          <li v-for="host in overview.hosts" :key="host.id" class="py-3 space-y-2">
            <div class="flex flex-wrap justify-between gap-2"><span class="text-sm font-medium text-themed break-all">{{ host.name }} <span class="text-themed-muted">#{{ host.id }}</span></span><span class="text-sm" :class="host.state === 'applied' ? 'text-green-800 dark:text-green-300' : host.state === 'retrying' ? 'text-amber-800 dark:text-amber-300' : 'text-themed-muted'">{{ t(`hostAbuse.states.${host.state}`) }}</span></div>
            <p v-if="host.errorCode" class="text-sm text-themed-muted">{{ te(`hostAbuse.errors.${host.errorCode}`) ? t(`hostAbuse.errors.${host.errorCode}`) : t('hostAbuse.actionFailed') }}</p>
            <p v-if="host.queueErrorCode" class="text-sm text-amber-800 dark:text-amber-300">{{ t('hostAbuse.queueFailure') }} · {{ te(`hostAbuse.errors.${host.queueErrorCode}`) ? t(`hostAbuse.errors.${host.queueErrorCode}`) : t('hostAbuse.actionFailed') }}<template v-if="host.queueErrorAt"> · {{ date(host.queueErrorAt) }}</template></p>
            <p v-if="host.attempts" class="text-sm text-themed-muted">{{ t('hostAbuse.attempts', { count: host.attempts }) }}<template v-if="host.nextRetryAt"> · {{ t('hostAbuse.nextRetry', { time: date(host.nextRetryAt) }) }}</template></p>
            <p v-if="host.checkedAt" class="text-sm text-themed-muted">{{ t('hostAbuse.lastCheck', { time: date(host.checkedAt) }) }}</p>
          </li>
        </ul>
        <div v-if="overview.pages > 1" class="flex flex-wrap items-center justify-between gap-3">
          <p class="text-sm text-themed-muted">{{ t('hostAbuse.page', { page: overview.page, pages: overview.pages, total: overview.total }) }}</p>
          <div class="flex gap-2"><button type="button" class="btn-secondary" :disabled="page <= 1 || !!busy" @click="page--; refresh()">{{ t('hostAbuse.previous') }}</button><button type="button" class="btn-secondary" :disabled="page >= overview.pages || !!busy" @click="page++; refresh()">{{ t('hostAbuse.next') }}</button></div>
        </div>
      </div>
    </details>
  </section>
</template>
<style scoped>
.abuse-policy { box-shadow: none !important; }
.abuse-policy button, .abuse-policy input:not([type='checkbox']), .abuse-policy select, .abuse-policy summary { min-height: 44px; }
.abuse-policy summary { align-content: center; }
.abuse-policy button { box-shadow: none !important; transition: none !important; }
.abuse-policy .btn-primary { background: #111 !important; color: #fff !important; box-shadow: none !important; }
:global(.dark .abuse-policy .btn-primary) { background: #fff !important; color: #111 !important; }
.abuse-policy .btn-primary::before { display: none !important; }
:global(.dark .abuse-policy .text-themed-muted) { color: #a3a3a3 !important; }
.abuse-policy :focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }
.abuse-filters { display: grid; grid-template-columns: minmax(0, 1fr); }
@media (min-width: 640px) { .abuse-filters { grid-template-columns: minmax(0, 1fr) 14rem; } }
</style>
