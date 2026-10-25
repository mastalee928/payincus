<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api/admin'
import type { GatewayEndpointStatus, GatewayDnsHost } from '@/types/gateway-endpoint'
const { t, te, locale } = useI18n()
const hostname = ref(''), status = ref<GatewayEndpointStatus | null>(null), hosts = ref<GatewayDnsHost[]>([])
const loading = ref(true), busy = ref(false), error = ref(''), loadError = ref(''), notice = ref(''), search = ref(''), page = ref(1)
const saving = ref(false)
let disposed = false, timer: ReturnType<typeof setTimeout> | undefined
const pending = computed(() => hosts.value.filter(h => h.state === 'queued' || h.running || h.state === 'running').length)
const failed = computed(() => hosts.value.filter(h => state(h) === 'failed').length)
const complete = computed(() => hosts.value.filter(h => h.installed).length)
const filtered = computed(() => hosts.value.filter(h => h.name.toLowerCase().includes(search.value.toLowerCase())))
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / 20)))
const visible = computed(() => filtered.value.slice((page.value - 1) * 20, page.value * 20))
function reason(code?: string | null, fallback = 'gatewayEndpoint.hostFailed') {
  const key = `gatewayEndpoint.errors.${code}`
  return code && te(key) ? t(key) : t(fallback)
}
async function refresh(initial = false) {
  try {
    const [endpoint, list] = await Promise.all([api.hostOnboarding.gatewayEndpoint(), api.hostOnboarding.gatewayDnsHosts()])
    if (disposed) return
    status.value = endpoint; hosts.value = list.hosts; loadError.value = ''
    if (initial) hostname.value = endpoint.endpoint?.hostname || ''
    page.value = Math.min(page.value, pages.value)
  } catch (failure) { if (!disposed) { const code = (failure as { code?: string }).code; loadError.value = code && te(`gatewayEndpoint.errors.${code}`) ? reason(code) : t('gatewayEndpoint.loadFailed') } }
  finally { if (!disposed) loading.value = false }
}
async function save() {
  if (busy.value || loading.value) return
  busy.value = true; saving.value = true; error.value = ''; notice.value = ''
  try {
    status.value = await api.hostOnboarding.saveGatewayEndpoint({ hostname: hostname.value.trim() })
    notice.value = t('gatewayEndpoint.saved'); await refresh()
  } catch (failure) { error.value = reason((failure as { code?: string }).code, 'gatewayEndpoint.saveFailed') }
  finally { busy.value = false; saving.value = false }
}
async function synchronize(failedOnly = false, host?: GatewayDnsHost) {
  if (busy.value || !status.value?.endpoint) return
  busy.value = true; error.value = ''
  try {
    if (host) await api.hostOnboarding.installGatewayDnsHost(host.id)
    else await api.hostOnboarding.synchronizeGatewayDnsHosts(failedOnly)
    notice.value = t('gatewayEndpoint.queued'); await refresh()
  } catch (failure) { error.value = reason((failure as { code?: string }).code); await refresh() }
  finally { busy.value = false }
}
function state(host: GatewayDnsHost) {
  return host.installed ? 'succeeded' : host.running ? 'running' : host.state === 'queued' || host.state === 'running' ? host.state : host.error ? 'failed' : !host.eligible ? 'unavailable' : 'not_started'
}
async function poll() {
  if (disposed) return
  if (document.visibilityState === 'visible' && !busy.value) await refresh()
  if (!disposed) timer = setTimeout(() => void poll(), 5000)
}
onMounted(async () => { await refresh(true); void poll() })
onUnmounted(() => { disposed = true; clearTimeout(timer) })
</script>
<template>
  <section class="gateway-domain space-y-5" data-ui :aria-busy="loading || busy">
    <div><h3 class="text-base font-semibold text-themed">{{ t('gatewayEndpoint.title') }}</h3><p class="mt-1 text-sm text-themed-muted">{{ t('gatewayEndpoint.description') }}</p></div>
    <form class="flex flex-col gap-3 sm:flex-row sm:items-end" @submit.prevent="save">
      <label class="block flex-1 text-sm text-themed">{{ t('gatewayEndpoint.hostname') }}
        <input v-model="hostname" required maxlength="253" autocomplete="off" class="input mt-2 w-full" aria-describedby="gateway-domain-help gateway-domain-error" :aria-invalid="!!error" />
      </label>
      <button type="submit" class="btn-primary shrink-0" :disabled="loading || busy">{{ t(saving ? 'gatewayEndpoint.saving' : 'gatewayEndpoint.save') }}</button>
    </form>
    <p id="gateway-domain-help" class="text-xs text-themed-muted">{{ t('gatewayEndpoint.hint') }}</p>
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
      <input v-if="hosts.length > 20" v-model="search" type="search" class="input w-full sm:max-w-sm" :aria-label="t('gatewayEndpoint.search')" :placeholder="t('gatewayEndpoint.search')" @input="page = 1" />
      <p v-if="!hosts.length && !loading" class="text-sm text-themed-muted">{{ t('gatewayEndpoint.noHosts') }}</p>
      <ul class="divide-y divide-themed">
        <li v-for="host in visible" :key="host.id" class="py-3 flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium text-themed break-words">{{ host.name }}</p>
            <p class="mt-1 text-sm" :class="state(host) === 'failed' ? 'text-red-700 dark:text-red-300' : state(host) === 'succeeded' ? 'text-green-700 dark:text-green-300' : 'text-themed-muted'">{{ t(`gatewayEndpoint.states.${state(host)}`) }}</p>
            <p v-if="host.error" class="mt-1 text-sm text-themed-muted">{{ t(`gatewayEndpoint.steps.${host.step === 'install' ? 'install' : 'connect'}`) }} · {{ reason(host.error) }}</p>
            <p v-if="host.updatedAt" class="mt-1 text-xs text-themed-muted">{{ new Date(host.updatedAt).toLocaleString(locale) }}</p>
          </div>
          <button v-if="host.eligible && !host.installed && !['queued','running'].includes(state(host))" type="button" class="btn-secondary shrink-0" :disabled="busy || !status?.endpoint" @click="synchronize(false, host)">{{ t('gatewayEndpoint.retry') }}</button>
        </li>
      </ul>
      <div v-if="pages > 1" class="flex items-center justify-between gap-3 text-sm text-themed-muted">
        <button type="button" class="btn-secondary" :disabled="page === 1" @click="page--">{{ t('gatewayEndpoint.previous') }}</button><span>{{ page }} / {{ pages }}</span><button type="button" class="btn-secondary" :disabled="page === pages" @click="page++">{{ t('gatewayEndpoint.next') }}</button>
      </div>
    </div>
  </section>
</template>
<style scoped>
button:focus-visible, input:focus-visible { outline: 2px solid var(--text-primary); outline-offset: 3px; }
@media (max-width: 640px) { button, input { min-height: 44px; } }
</style>
