<script setup lang="ts">
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api/admin'
import { useAuthStore } from '@/stores/auth'
import type { GatewayEndpointStatus, GatewayDnsHost } from '@/types/gateway-endpoint'
const { t, te, locale } = useI18n()
const auth = useAuthStore()
const emit = defineEmits<{ changed: [hostname: string] }>()
withDefaults(defineProps<{ manageDomain?: boolean }>(), { manageDomain: true })
const hostname = ref(''), status = ref<GatewayEndpointStatus | null>(null), hosts = ref<GatewayDnsHost[]>([])
const loading = ref(true), busy = ref(false), error = ref(''), loadError = ref(''), notice = ref(''), search = ref(''), page = ref(1)
const saving = ref(false)
const password = ref('')
const showAll = ref(false), savedHostname = ref('')
let disposed = false, active = true, sequence = 0, pollGeneration = 0, timer: ReturnType<typeof setTimeout> | undefined
const available = () => active && !disposed && !!auth.token && auth.user?.role === 'admin'
const pending = computed(() => hosts.value.filter(h => h.state === 'queued' || h.running || h.state === 'running').length)
const failed = computed(() => hosts.value.filter(h => state(h) === 'failed').length)
const complete = computed(() => hosts.value.filter(h => h.installed).length)
const filtered = computed(() => hosts.value.filter(h => (showAll.value || !h.installed) && h.name.toLowerCase().includes(search.value.toLowerCase())))
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / 20)))
const visible = computed(() => filtered.value.slice((page.value - 1) * 20, page.value * 20))
function reason(code?: string | null, fallback = 'gatewayEndpoint.hostFailed') {
  const changeKey = `gatewayEndpoint.change.errors.${code}`
  if (code && te(changeKey)) return t(changeKey)
  const key = `gatewayEndpoint.errors.${code}`
  return code && te(key) ? t(key) : t(fallback)
}
async function refresh(initial = false) {
  if (!available() || busy.value) return
  const authentication = auth.captureAuthentication(), request = ++sequence
  if (!authentication.aligned) return
  const current = () => available() && authentication.current() && request === sequence
  try {
    const [endpoint, list] = await Promise.all([api.hostOnboarding.gatewayEndpoint(), api.hostOnboarding.gatewayDnsHosts()])
    if (!current()) return
    status.value = endpoint; hosts.value = list.hosts; loadError.value = ''; emit('changed', endpoint.endpoint?.hostname || '')
    const untouched = hostname.value === savedHostname.value
    if (initial) hostname.value = endpoint.endpoint?.hostname || ''
    if (initial || untouched) { hostname.value = endpoint.endpoint?.hostname || ''; savedHostname.value = endpoint.endpoint?.hostname || '' }
    page.value = Math.min(page.value, pages.value)
  } catch (failure) { if (current()) { const code = (failure as { code?: string }).code; loadError.value = code && te(`gatewayEndpoint.errors.${code}`) ? reason(code) : t('gatewayEndpoint.loadFailed') } }
  finally { if (current()) loading.value = false }
}
async function save() {
  if (busy.value || loading.value || !available()) return
  const authentication = auth.captureAuthentication(), request = ++sequence
  if (!authentication.aligned) return
  const submitted = hostname.value.trim(), previous = savedHostname.value
  const current = () => available() && authentication.current() && request === sequence
  busy.value = true; saving.value = true; error.value = ''; notice.value = ''
  try {
    const value = await api.hostOnboarding.saveGatewayEndpoint({ hostname: submitted, expectedHostname: previous,
      ...(status.value?.needsChannelUpgrade && status.value.channelTarget === 'remote' ? { credentials: { password: password.value } } : {}) })
    if (!current()) return
    status.value = value; savedHostname.value = value.endpoint?.hostname || ''; password.value = ''
    notice.value = t('gatewayEndpoint.saved'); busy.value = false; saving.value = false; await refresh()
  } catch (failure) { if (current()) { error.value = reason((failure as { code?: string }).code, 'gatewayEndpoint.saveFailed'); password.value = '' } }
  finally { if (current()) { busy.value = false; saving.value = false } }
}
async function synchronize(failedOnly = false, host?: GatewayDnsHost) {
  if (busy.value || !status.value?.endpoint || !available()) return
  const authentication = auth.captureAuthentication(), request = ++sequence
  if (!authentication.aligned) return
  const current = () => available() && authentication.current() && request === sequence
  busy.value = true; error.value = ''
  try {
    if (host) await api.hostOnboarding.installGatewayDnsHost(host.id)
    else await api.hostOnboarding.synchronizeGatewayDnsHosts(failedOnly)
    if (current()) { notice.value = t('gatewayEndpoint.queued'); busy.value = false; await refresh() }
  } catch (failure) { if (current()) { error.value = reason((failure as { code?: string }).code); busy.value = false; await refresh() } }
  finally { if (current()) busy.value = false }
}
function state(host: GatewayDnsHost) {
  return host.installed ? 'succeeded' : host.running ? 'running' : host.state === 'queued' || host.state === 'running' ? host.state : host.error ? 'failed' : !host.eligible ? 'unavailable' : 'not_started'
}
async function poll(generation: number) {
  if (!available() || generation !== pollGeneration) return
  if (document.visibilityState === 'visible' && !busy.value) await refresh()
  if (available() && generation === pollGeneration) timer = setTimeout(() => void poll(generation), 5000)
}
function stopPolling() { ++pollGeneration; clearTimeout(timer) }
async function startPolling() {
  stopPolling()
  const generation = pollGeneration
  await refresh(true)
  if (available() && generation === pollGeneration) timer = setTimeout(() => void poll(generation), 5000)
}
onMounted(() => void startPolling())
watch(() => [auth.user?.id, auth.user?.role, auth.token], () => { ++sequence; stopPolling(); status.value = null; hosts.value = []; hostname.value = ''; savedHostname.value = ''; password.value = ''; busy.value = false; saving.value = false; loading.value = true; notice.value = ''; error.value = ''; loadError.value = ''; if (available()) void startPolling() })
onActivated(() => { if (!active) { active = true; void startPolling() } })
onDeactivated(() => { active = false; ++sequence; stopPolling(); busy.value = false; saving.value = false; password.value = '' })
onUnmounted(() => { disposed = true; ++sequence; stopPolling(); password.value = '' })
</script>
<template>
  <section class="gateway-domain space-y-5" :aria-busy="loading || busy">
    <div v-if="manageDomain"><h3 class="text-base font-semibold text-themed">{{ t('gatewayEndpoint.title') }}</h3><p class="mt-1 text-sm text-themed-muted">{{ t('gatewayEndpoint.description') }}</p></div>
    <form v-if="manageDomain" class="flex flex-col gap-3 sm:flex-row sm:items-end" @submit.prevent="save">
      <label class="block flex-1 text-sm text-themed">{{ t('gatewayEndpoint.hostname') }}
        <input v-model="hostname" required maxlength="253" autocomplete="off" class="input mt-2 w-full" aria-describedby="gateway-domain-help gateway-domain-error" :aria-invalid="!!error" :disabled="busy || loading" />
      </label>
      <label v-if="status?.needsChannelUpgrade && status.channelTarget === 'remote'" class="block flex-1 text-sm text-themed">{{ t('gatewayEndpoint.change.password') }}
        <input v-model="password" type="password" required maxlength="1024" autocomplete="off" class="input mt-2 w-full" :disabled="busy || loading" />
      </label>
      <button type="submit" class="btn-primary shrink-0" :disabled="loading || busy">{{ t(saving ? 'gatewayEndpoint.saving' : 'gatewayEndpoint.save') }}</button>
    </form>
    <p v-if="manageDomain" id="gateway-domain-help" class="text-sm text-themed-muted">{{ t('gatewayEndpoint.change.hint') }}</p>
    <p v-if="status?.needsChannelUpgrade" class="text-sm text-themed-muted">{{ t(status.channelTarget === 'remote' ? 'gatewayEndpoint.change.credentials' : 'gatewayEndpoint.change.errors.GATEWAY_DNS_LOCAL_HELPER_OUTDATED') }}</p>
    <p v-if="status?.channelError" role="status" class="text-sm text-amber-800 dark:text-amber-300">{{ reason(status.channelError) }}</p>
    <p v-if="error" id="gateway-domain-error" role="alert" class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
    <div v-if="loadError" role="alert" class="flex flex-wrap items-center gap-2 text-sm text-themed-muted"><span>{{ loadError }}</span><button type="button" class="btn-secondary" @click="refresh()">{{ t('gatewayEndpoint.reload') }}</button></div>
    <p v-if="notice" role="status" class="text-sm text-themed">{{ notice }}</p>
    <div class="border-t border-themed pt-5 space-y-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div><h4 class="text-sm font-semibold text-themed">{{ t('gatewayEndpoint.hosts') }}</h4><p class="mt-1 text-sm text-themed-muted" role="status">{{ t('gatewayEndpoint.summary', { complete, total: hosts.length, pending, failed }) }}</p></div>
        <div class="flex flex-wrap gap-2">
          <button type="button" class="btn-secondary" :disabled="busy || !status?.endpoint" @click="synchronize()">{{ t('gatewayEndpoint.synchronize') }}</button>
          <button v-if="failed" type="button" class="btn-secondary" :disabled="busy" @click="synchronize(true)">{{ t('gatewayEndpoint.retryFailed') }}</button>
        </div>
      </div>
      <details>
        <summary class="cursor-pointer text-sm font-medium text-themed">{{ t('gatewayEndpoint.change.details') }}</summary>
        <div class="flex flex-wrap gap-3 mt-3">
          <input v-model="search" type="search" class="input flex-1 min-w-0" :aria-label="t('gatewayEndpoint.search')" :placeholder="t('gatewayEndpoint.search')" @input="page = 1" />
          <label class="flex items-center gap-2 text-sm text-themed"><input v-model="showAll" type="checkbox" @change="page = 1" />{{ t('gatewayEndpoint.change.showAll') }}</label>
        </div>
        <p v-if="hosts.length && !filtered.length" class="mt-3 text-sm text-themed-muted">{{ t(search.trim() ? 'gatewayEndpoint.change.noMatches' : 'gatewayEndpoint.change.none') }}</p>
        <p v-if="!hosts.length && !loading" class="text-sm text-themed-muted">{{ t('gatewayEndpoint.noHosts') }}</p>
        <ul class="divide-y divide-themed">
          <li v-for="host in visible" :key="host.id" class="py-3 flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium text-themed break-words">{{ host.name }}</p>
              <p class="mt-1 text-sm" :class="state(host) === 'failed' ? 'text-red-700 dark:text-red-300' : state(host) === 'succeeded' ? 'text-green-700 dark:text-green-300' : 'text-themed-muted'">{{ t(`gatewayEndpoint.states.${state(host)}`) }}</p>
              <p v-if="host.error" class="mt-1 text-sm text-themed-muted">{{ t(`gatewayEndpoint.steps.${host.step === 'install' ? 'install' : 'connect'}`) }} · {{ reason(host.error) }}</p>
              <p v-if="host.state === 'queued' && host.retryAt" class="mt-1 text-sm text-themed-muted">{{ t('gatewayEndpoint.change.attempts', { count: host.attempt || 0 }) }} · {{ t('gatewayEndpoint.change.nextRetry', { time: new Date(host.retryAt).toLocaleTimeString(locale) }) }}</p>
              <p v-else-if="host.state === 'failed' && host.error" class="mt-1 text-xs text-themed-muted">{{ t('gatewayEndpoint.flow.retryStopped') }}</p>
              <p v-if="host.updatedAt" class="mt-1 text-xs text-themed-muted">{{ new Date(host.updatedAt).toLocaleString(locale) }}</p>
            </div>
            <button v-if="host.eligible && !host.installed && !['queued','running'].includes(state(host))" type="button" class="btn-secondary shrink-0" :disabled="busy || !status?.endpoint" @click="synchronize(false, host)">{{ t('gatewayEndpoint.retry') }}</button>
          </li>
        </ul>
        <div v-if="pages > 1" class="flex items-center justify-between gap-3 text-sm text-themed-muted">
          <button type="button" class="btn-secondary" :disabled="page === 1" @click="page--">{{ t('gatewayEndpoint.previous') }}</button><span>{{ page }} / {{ pages }}</span><button type="button" class="btn-secondary" :disabled="page === pages" @click="page++">{{ t('gatewayEndpoint.next') }}</button>
        </div>
      </details>
    </div>
  </section>
</template>
<style scoped>
button:focus-visible, input:focus-visible, summary:focus-visible { outline: 2px solid var(--text-primary); outline-offset: 3px; }
button, input:not([type='checkbox']), summary { min-height: 44px; }
summary { align-content: center; }
.gateway-domain button { box-shadow: none !important; }
.gateway-domain .btn-primary { background: #111 !important; color: #fff !important; }
:global(.dark .gateway-domain .btn-primary) { background: #fff !important; color: #111 !important; }
.gateway-domain .btn-primary::before { display: none !important; }
:global(.dark .gateway-domain .text-themed-muted) { color: #a3a3a3 !important; }
</style>
