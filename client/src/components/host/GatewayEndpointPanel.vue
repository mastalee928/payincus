<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api/admin'
import type { GatewayEndpointStatus, GatewayDnsHost } from '@/types/gateway-endpoint'
const { t } = useI18n()
const hostname = ref(''), port = ref(51820), status = ref<GatewayEndpointStatus | null>(null)
const loading = ref(false), saving = ref(false), error = ref(''), saved = ref(false)
const hosts = ref<GatewayDnsHost[]>([]), hostId = ref<string | null>(null)
let disposed = false
async function load() {
  if (loading.value || saving.value || hostId.value) return
  loading.value = true; error.value = ''
  try {
    const result = await api.hostOnboarding.gatewayEndpoint()
    const list = await api.hostOnboarding.gatewayDnsHosts()
    if (!disposed) { status.value = result; hosts.value = list.hosts; hostname.value = result.endpoint?.hostname || ''; port.value = result.endpoint?.port || Number(result.effectiveEndpoint?.split(':').pop()) || 51820 }
  } catch { if (!disposed) error.value = t('gatewayEndpoint.loadFailed') }
  finally { if (!disposed) loading.value = false }
}
async function save() {
  if (saving.value || loading.value || hostId.value || !status.value) return
  saving.value = true; error.value = ''; saved.value = false
  try {
    const result = await api.hostOnboarding.saveGatewayEndpoint({ hostname: hostname.value.trim(), port: port.value })
    if (!disposed) { status.value = result; hostname.value = result.endpoint?.hostname || ''; saved.value = true }
  } catch { if (!disposed) error.value = t('gatewayEndpoint.saveFailed') }
  finally { if (!disposed) saving.value = false }
}
onMounted(() => void load())
async function install(host: GatewayDnsHost) {
  if (hostId.value || saving.value || loading.value || !status.value?.endpoint || !host.eligible || host.running) return
  hostId.value = host.id; error.value = ''
  try {
    await api.hostOnboarding.installGatewayDnsHost(host.id)
    const list = await api.hostOnboarding.gatewayDnsHosts()
    if (!disposed) hosts.value = list.hosts
  } catch { if (!disposed) error.value = t('gatewayEndpoint.hostFailed') }
  finally { if (!disposed) hostId.value = null }
}
onUnmounted(() => { disposed = true })
</script>
<template>
  <section class="card p-4 space-y-4" data-ui :aria-busy="loading || saving || !!hostId" aria-labelledby="gateway-endpoint-title">
    <div class="flex flex-wrap justify-between items-start gap-3">
      <h3 id="gateway-endpoint-title" class="text-base font-semibold text-themed">{{ t('gatewayEndpoint.title') }}</h3>
      <button type="button" class="btn-secondary" :disabled="loading || saving || !!hostId" @click="load">{{ t('gatewayEndpoint.reload') }}</button>
    </div>
    <p class="text-sm text-themed-muted">{{ t('gatewayEndpoint.description') }}</p>
    <p v-if="error" role="alert" class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
    <p v-if="status?.effectiveEndpoint" class="text-sm text-themed break-all">{{ t('gatewayEndpoint.current') }} · {{ status.effectiveEndpoint }}</p>
    <form class="space-y-3" @submit.prevent="save">
      <fieldset class="grid grid-cols-1 sm:grid-cols-3 gap-3" :disabled="loading || saving || !!hostId || !status" aria-describedby="gateway-endpoint-hint">
        <legend class="sr-only">{{ t('gatewayEndpoint.title') }}</legend>
        <label class="block text-sm text-themed sm:col-span-2">{{ t('gatewayEndpoint.hostname') }}<input v-model="hostname" required maxlength="253" autocomplete="off" class="input mt-1 w-full" @input="saved = false" /></label>
        <label class="block text-sm text-themed">{{ t('gatewayEndpoint.port') }}<input v-model.number="port" required type="number" min="1" max="65535" class="input mt-1 w-full" @input="saved = false" /></label>
      </fieldset>
      <p id="gateway-endpoint-hint" class="text-xs text-themed-muted">{{ t('gatewayEndpoint.hint') }}</p>
      <button type="submit" class="btn-secondary" :disabled="loading || saving || !!hostId || !status">{{ t(saving ? 'gatewayEndpoint.saving' : 'gatewayEndpoint.save') }}</button>
    </form>
    <p v-if="saved" role="status" class="text-sm text-themed">{{ t('gatewayEndpoint.saved') }}</p>
    <p v-else class="text-xs text-amber-700 dark:text-amber-300">{{ t('gatewayEndpoint.pending') }}</p>
    <div v-if="status" class="space-y-3">
      <h4 class="text-sm font-semibold text-themed">{{ t('gatewayEndpoint.hosts') }}</h4>
      <p v-if="!hosts.length" class="text-sm text-themed-muted">{{ t('gatewayEndpoint.noHosts') }}</p>
      <ul class="space-y-3">
        <li v-for="host in hosts" :key="host.id" class="flex flex-wrap justify-between items-center gap-3">
          <div class="min-w-0 text-sm">
            <p class="text-themed break-words">{{ host.name }} <span class="text-themed-muted">· {{ host.managementIp || '—' }}</span></p>
            <p :class="host.installed ? 'text-themed-muted' : 'text-amber-700 dark:text-amber-300'">{{ t(!host.eligible ? 'gatewayEndpoint.unavailable' : host.installed && host.endpoint === status.effectiveEndpoint ? 'gatewayEndpoint.installed' : 'gatewayEndpoint.notInstalled') }}</p>
            <p v-if="host.error" class="text-xs text-amber-700 dark:text-amber-300">{{ t('gatewayEndpoint.hostFailed') }}</p>
          </div>
          <button type="button" class="btn-secondary" :disabled="!!hostId || saving || loading || !status.endpoint || !host.eligible || host.running" @click="install(host)">{{ t(hostId === host.id || host.running ? 'gatewayEndpoint.installing' : 'gatewayEndpoint.install') }}</button>
        </li>
      </ul>
    </div>
  </section>
</template>
<style scoped>
section { box-shadow: none !important; }
button:focus-visible, input:focus-visible { outline: 2px solid var(--text-primary); outline-offset: 3px; }
@media (max-width: 640px) { button, input { min-height: 44px; } }
</style>
