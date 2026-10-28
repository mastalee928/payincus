<script setup lang="ts">
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api/admin'
import type { ExpiryEnforcementStatus } from '@/types/expiry-enforcement'
import ExpiryEnforcementHistory from './ExpiryEnforcementHistory.vue'
import { useAuthStore } from '@/stores/auth'
const props = withDefaults(defineProps<{ active?: boolean }>(), { active: true })
const { t, te, locale } = useI18n()
const auth = useAuthStore()
// Callback identity only; the server remains responsible for authorization.
const sessionKey = computed(() => {
  if (!auth.token || !auth.isAdmin) return ''
  let identity = auth.token
  try {
    const payload = JSON.parse(atob(auth.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    if (typeof payload.sid === 'string') identity = payload.sid
  } catch { /* Preserve the full identity of legacy tokens. */ }
  return `${auth.user?.id}:${identity}`
})
const status = ref<ExpiryEnforcementStatus | null>(null), loading = ref(false), busy = ref(false), error = ref('')
const showHistory = ref(false), historyOpened = ref(false)
const mounted = ref(false), activated = ref(true), pageVisible = ref(document.visibilityState === 'visible')
const panelVisible = computed(() => mounted.value && activated.value && props.active && pageVisible.value && !!sessionKey.value)
const pollingActive = computed(() => panelVisible.value && !showHistory.value)
function openHistory() { historyOpened.value = true; showHistory.value = true }
let disposed = false, sequence = 0, timer: ReturnType<typeof setTimeout> | undefined
let readController: AbortController | undefined
const stateKey = computed(() => status.value?.recoveryHeld ? 'held' : status.value?.running ? 'running' : status.value?.enabled ? 'enabled' : 'disabled')
const failureMessage = computed(() => {
  const key = `expiryEnforcement.errorCodes.${status.value?.lastError}`
  return status.value?.lastError ? t(te(key) ? key : 'expiryEnforcement.actionFailed') : ''
})
function date(value: string | null | undefined) { return value ? new Date(value).toLocaleString(locale.value) : t('expiryEnforcement.never') }
function isCurrent(current: number) { return !disposed && pollingActive.value && current === sequence }
function schedule() {
  clearTimeout(timer)
  if (!disposed && pollingActive.value) timer = setTimeout(() => void refresh(), status.value?.running ? 5000 : 15000)
}
async function refresh() {
  if (disposed || !pollingActive.value || loading.value || busy.value) return
  clearTimeout(timer)
  const current = ++sequence; loading.value = true
  const controller = new AbortController(); readController = controller
  try {
    const data = await api.admin.expiryEnforcementStatus(controller.signal)
    if (isCurrent(current)) { status.value = data; error.value = '' }
  } catch { if (isCurrent(current)) error.value = t('expiryEnforcement.loadFailed') }
  finally { if (isCurrent(current)) { readController = undefined; loading.value = false; schedule() } }
}
async function action(kind: 'start' | 'run') {
  if (disposed || !pollingActive.value || busy.value || loading.value || !status.value || status.value.running || status.value.recoveryHeld) return
  clearTimeout(timer)
  const current = ++sequence
  busy.value = true; error.value = ''
  try {
    const data = await (kind === 'start' ? api.admin.startExpiryEnforcement() : api.admin.runExpiryEnforcement())
    if (isCurrent(current)) status.value = data
  } catch { if (isCurrent(current)) error.value = t('expiryEnforcement.actionFailed') }
  finally {
    // Leaving the panel must not release an in-flight mutation's duplicate gate.
    if (!disposed) {
      busy.value = false
      if (isCurrent(current)) schedule()
      else if (pollingActive.value) void refresh()
    }
  }
}
watch([pollingActive, sessionKey], () => {
  sequence++; clearTimeout(timer); readController?.abort(); readController = undefined
  loading.value = false; status.value = null; error.value = ''
  if (pollingActive.value) void refresh()
}, { flush: 'sync' })
function visibilityChanged() { pageVisible.value = document.visibilityState === 'visible' }
onMounted(() => { document.addEventListener('visibilitychange', visibilityChanged); visibilityChanged(); mounted.value = true })
onActivated(() => { activated.value = true })
onDeactivated(() => { activated.value = false })
onUnmounted(() => { disposed = true; sequence++; clearTimeout(timer); readController?.abort(); document.removeEventListener('visibilitychange', visibilityChanged) })
</script>
<template>
  <section class="expiry-enforcement card mb-6 p-5 space-y-4" data-ui :aria-busy="busy || loading" aria-labelledby="expiry-enforcement-title">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <h2 id="expiry-enforcement-title" class="text-base font-semibold text-themed">{{ t('expiryEnforcement.title') }}</h2>
      <button v-if="!showHistory" type="button" class="btn-secondary" :disabled="busy || loading" @click="refresh">{{ t('expiryEnforcement.refresh') }}</button>
    </div>
    <div class="flex gap-5 border-b border-themed text-sm">
      <button type="button" class="pb-2" :class="!showHistory ? 'border-b-2 border-current font-semibold text-themed' : 'text-themed-muted'" :aria-pressed="!showHistory" @click="showHistory = false">{{ t('expiryEnforcement.history.status') }}</button>
      <button type="button" class="pb-2" :class="showHistory ? 'border-b-2 border-current font-semibold text-themed' : 'text-themed-muted'" :aria-pressed="showHistory" @click="openHistory">{{ t('expiryEnforcement.history.query') }}</button>
    </div>
    <ExpiryEnforcementHistory v-if="historyOpened" v-show="showHistory" :key="sessionKey" :active="panelVisible && showHistory" />
    <div v-show="!showHistory" class="space-y-4">
      <p class="text-sm text-themed-muted">{{ t('expiryEnforcement.description') }}</p>
      <p v-if="error" role="alert" class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
      <template v-if="status">
        <p role="status" class="text-sm" :class="status.recoveryHeld || !status.enabled ? 'text-amber-700 dark:text-amber-300' : 'text-themed'">{{ t(`expiryEnforcement.${stateKey}`) }}</p>
        <dl class="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2 xl:grid-cols-4">
          <div><dt class="text-themed-muted">{{ t('expiryEnforcement.started') }}</dt><dd class="text-themed">{{ date(status.lastStartedAt) }}</dd></div>
          <div><dt class="text-themed-muted">{{ t('expiryEnforcement.finished') }}</dt><dd class="text-themed">{{ date(status.lastFinishedAt) }}</dd></div>
          <div><dt class="text-themed-muted">{{ t('expiryEnforcement.next') }}</dt><dd class="text-themed">{{ date(status.nextRunAt) }}</dd></div>
          <div><dt class="text-themed-muted">{{ t('expiryEnforcement.failures') }}</dt><dd class="text-themed tabular-nums">{{ status.failureCount }}</dd></div>
        </dl>
        <p v-if="failureMessage" role="status" class="text-sm text-amber-700 dark:text-amber-300">{{ failureMessage }}</p>
        <p v-if="status.historyError" role="alert" class="text-sm text-red-700 dark:text-red-300">{{ t('expiryEnforcement.history.saveFailed') }}</p>
        <div class="flex flex-wrap gap-3">
          <button v-if="!status.enabled" type="button" class="btn-secondary" :disabled="busy || loading || status.running || status.recoveryHeld" @click="action('start')">{{ t('expiryEnforcement.start') }}</button>
          <button type="button" class="btn-secondary" :disabled="busy || loading || status.running || status.recoveryHeld" @click="action('run')">{{ t(busy ? 'expiryEnforcement.pending' : 'expiryEnforcement.run') }}</button>
        </div>
      </template>
      <p class="text-xs text-themed-muted">{{ t('expiryEnforcement.noBackend') }}</p>
    </div>
  </section>
</template>
<style scoped>
.expiry-enforcement { --text-primary: #111; --text-secondary: #525252; --bg-primary: #fff; --bg-secondary: #f5f5f5; --border-color: #e5e5e5; box-shadow: none !important; }
:global(.dark .expiry-enforcement) { --text-primary: #fff; --text-secondary: #b4b4b4; --bg-primary: #111; --bg-secondary: #1a1a1a; --border-color: #333; }
.expiry-enforcement :deep(.btn-primary) { background: var(--text-primary) !important; color: var(--bg-primary) !important; box-shadow: none !important; }
.expiry-enforcement :deep(.btn-primary::before) { display: none !important; }
.expiry-enforcement :deep(button.btn-primary:not(:disabled):hover), .expiry-enforcement :deep(button.btn-primary:not(:disabled):active) { background: var(--text-primary) !important; color: var(--bg-primary) !important; }
.expiry-enforcement :deep(.btn-secondary) { background: var(--bg-primary) !important; color: var(--text-primary) !important; box-shadow: none !important; }
.expiry-enforcement :deep(.text-themed-muted) { color: var(--text-secondary); }
.expiry-enforcement button:focus-visible { outline: 2px solid var(--text-primary); outline-offset: 3px; }
@media (max-width: 640px) { .expiry-enforcement :deep(button) { min-height: 44px; } }
</style>
