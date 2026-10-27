<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api/admin'
import GatewayInstallationPanel from './GatewayInstallationPanel.vue'
import type { ManagementGateway, RemoteGatewayPreparation } from '@/types/management-gateway'
const { t, te } = useI18n()
const props = defineProps<{ purpose?: 'independent' | 'backup' | null }>()
const emit = defineEmits<{ select: [purpose: 'independent' | 'backup'] }>()
const selected = ref<'independent' | 'backup' | null>(null)
const roles = ['independent', 'backup'] as const
const gateways = ref<ManagementGateway[]>([]), loading = ref(true), busy = ref(false), error = ref('')
const preparations = ref<RemoteGatewayPreparation[]>([])
const name = ref(''), address = ref(''), hostname = ref(''), password = ref('')
const gatewayId = ref<string>(crypto.randomUUID()), requestId = ref<string>(crypto.randomUUID())
let disposed = false
const targetGateways = computed(() => gateways.value.filter(gateway => gateway.mode === 'remote' && !gateway.retiredAt))
const records = computed(() => targetGateways.value.map(gateway => {
  const installation = gateway.tasks.find(task => task.kind === 'install')
  const inspection = gateway.tasks.find(task => task.inspection)?.inspection
  const configuration = installation?.installationPreview?.configuration || inspection?.request
  const attempt = preparations.value.find(attempt => attempt.gatewayId === gateway.id)
  return { gateway, inspection, installation, configuration,
    hostname: installation?.installationPreview ? new URL(installation.installationPreview.configuration.consoleOrigin).hostname : attempt?.hostname || null,
    role: configuration?.slot === 'b' ? 'backup' : 'independent',
    blockers: installation?.installationReceipt ? [] : inspection?.report.blockers || [],
    canRetry: gateway.revision === '0' && !gateway.tasks.some(task => task.kind === 'install' &&
      (!['failed', 'cancelled'].includes(task.status) || task.steps.some(step =>
        ['install-components', 'verify-installation'].includes(step.key) && step.status !== 'pending'))) }
}))
function message(code?: string) {
  const key = `managementGateway.errors.${code}`
  return code && te(key) ? t(key) : `${t('gatewayEndpoint.extensions.failed')}${code ? ` (${code})` : ''}`
}
async function load() {
  try { const result = await api.hostOnboarding.managementGateways(); if (!disposed) { gateways.value = result.gateways; preparations.value = result.preparations || []; error.value = '' } }
  catch (failure) { if (!disposed) error.value = message((failure as { code?: string }).code) }
  finally { if (!disposed) loading.value = false }
}
watch(selected, () => { password.value = ''; name.value = ''; address.value = ''; hostname.value = ''; gatewayId.value = crypto.randomUUID(); requestId.value = crypto.randomUUID(); error.value = '' })
watch(() => props.purpose, value => { selected.value = value || null }, { immediate: true })
watch([name, address, hostname], () => { requestId.value = crypto.randomUUID() })
async function prepare() {
  if (busy.value || !selected.value) return
  busy.value = true; error.value = ''
  const secret = password.value; password.value = ''
  try {
    await api.hostOnboarding.prepareRemoteGateway({ requestId: requestId.value, gatewayId: gatewayId.value, name: name.value.trim() || hostname.value.trim(),
      purpose: selected.value, address: address.value.trim(), hostname: hostname.value.trim(), credentials: { password: secret } })
    if (!disposed) { await load(); selected.value = null; gatewayId.value = crypto.randomUUID(); requestId.value = crypto.randomUUID() }
  } catch (failure) {
    if (!disposed) {
      error.value = `${name.value || address.value} · ${message((failure as { code?: string }).code)}`
      try { const result = await api.hostOnboarding.managementGateways(); if (!disposed) { gateways.value = result.gateways; preparations.value = result.preparations || [] } } catch { /* Preserve the preparation failure. */ }
    }
  } finally { if (!disposed) busy.value = false }
}
async function retry(gateway: ManagementGateway) {
  const installation = gateway.tasks.find(task => task.kind === 'install')?.installationPreview?.configuration
  selected.value = (installation || gateway.tasks.find(task => task.inspection)?.inspection?.request)?.slot === 'b' ? 'backup' : 'independent'
  emit('select', selected.value)
  await nextTick()
  if (!disposed) {
    gatewayId.value = gateway.id; name.value = gateway.name
    address.value = gateway.target.ssh?.address || ''
    hostname.value = installation ? new URL(installation.consoleOrigin).hostname : preparations.value.find(attempt => attempt.gatewayId === gateway.id)?.hostname || ''
    password.value = ''
  }
}
async function restartPreparation(attempt: RemoteGatewayPreparation) {
  if (attempt.retryable === false) return
  selected.value = attempt.purpose
  emit('select', attempt.purpose)
  await nextTick()
  if (disposed) return
  name.value = attempt.name; address.value = attempt.address; hostname.value = attempt.hostname
  gatewayId.value = attempt.gatewayId; requestId.value = crypto.randomUUID(); password.value = ''
}
async function replaceCandidate(gateway: ManagementGateway) {
  if (busy.value) return
  busy.value = true; error.value = ''
  try {
    await api.hostOnboarding.restartGatewayCandidate(gateway.id)
    await retry(gateway)
    gatewayId.value = crypto.randomUUID(); requestId.value = crypto.randomUUID()
    await load()
  } catch (failure) { error.value = `${gateway.name} · ${message((failure as { code?: string }).code)}` }
  finally { busy.value = false }
}
onMounted(() => void load())
onUnmounted(() => { disposed = true; password.value = '' })
</script>
<template>
  <section v-if="selected || targetGateways.length || preparations.length || error || props.purpose === undefined" class="gateway-extensions card p-5 space-y-5" data-ui :aria-busy="busy || loading">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div><h3 class="text-base font-semibold text-themed">{{ t('gatewayEndpoint.extensions.title') }}</h3><p class="mt-1 text-sm text-themed-muted">{{ t('gatewayEndpoint.extensions.description') }}</p></div>
      <button type="button" class="btn-secondary" :disabled="loading || busy" @click="load">{{ t('gatewayEndpoint.reload') }}</button>
    </div>
    <p v-if="loading" role="status" class="text-sm text-themed-muted">{{ t('gatewayEndpoint.setup.loading') }}</p>
    <p v-if="error" role="alert" class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
    <article v-for="attempt in preparations" :key="attempt.requestId" class="border-t border-themed pt-3 space-y-1">
      <p class="text-sm font-medium text-themed break-words">{{ attempt.name }} · {{ attempt.address }}</p>
      <p class="text-sm text-red-700 dark:text-red-300">{{ t(`gatewayEndpoint.flow.steps.${attempt.step}`) }} · {{ message(attempt.code || undefined) }}</p>
      <p class="text-xs text-themed-muted">{{ new Date(attempt.updatedAt).toLocaleString() }} · {{ attempt.code }}</p>
      <button v-if="attempt.retryable !== false" type="button" class="btn-secondary" :disabled="busy" @click="restartPreparation(attempt)">{{ t('gatewayEndpoint.retry') }}</button>
      <p v-else class="text-sm text-themed-muted">{{ t('gatewayEndpoint.flow.preparationBlocked') }}</p>
    </article>
    <div v-if="props.purpose === undefined" class="grid gap-3 sm:grid-cols-2">
      <button v-for="role in roles" :key="role" type="button" class="btn-secondary text-left" :disabled="loading || busy" :aria-expanded="selected === role" aria-controls="remote-gateway-form" @click="selected = selected === role ? null : role">{{ t(`gatewayEndpoint.extensions.${role}.title`) }}</button>
    </div>
    <form v-if="selected" id="remote-gateway-form" class="space-y-4" @submit.prevent="prepare">
      <p class="text-sm text-themed-muted">{{ t(`gatewayEndpoint.extensions.${selected}.description`) }}</p>
      <fieldset :disabled="busy" class="grid gap-4 sm:grid-cols-2">
        <legend class="sr-only">{{ t(`gatewayEndpoint.extensions.${selected}.title`) }}</legend>
        <label class="block text-sm text-themed">{{ t('gatewayEndpoint.flow.optionalName') }}<input v-model="name" maxlength="80" class="input mt-2 w-full" autocomplete="off" /></label>
        <label class="block text-sm text-themed">{{ t('managementGateway.sshAddress') }}<input v-model="address" required maxlength="253" class="input mt-2 w-full" autocomplete="off" aria-describedby="remote-gateway-hint" /></label>
        <label class="block text-sm text-themed sm:col-span-2">{{ t('gatewayEndpoint.hostname') }}<input v-model.trim="hostname" required maxlength="253" class="input mt-2 w-full" autocomplete="off" aria-describedby="remote-gateway-domain-help" /></label>
        <label class="block text-sm text-themed sm:col-span-2">{{ t('gatewayEndpoint.extensions.rootPassword') }}<input v-model="password" required type="password" maxlength="1024" autocomplete="off" class="input mt-2 w-full" /></label>
      </fieldset>
      <p id="remote-gateway-hint" class="text-xs text-themed-muted">{{ t('gatewayEndpoint.extensions.automatic') }}</p>
      <p id="remote-gateway-domain-help" class="text-xs text-themed-muted">{{ t('gatewayEndpoint.flow.domainTarget') }}</p>
      <button type="submit" class="btn-primary" :disabled="busy">{{ t(busy ? 'gatewayEndpoint.setup.working' : 'gatewayEndpoint.extensions.prepare') }}</button>
    </form>
    <p v-if="!loading && !targetGateways.length" class="text-sm text-themed-muted">{{ t('gatewayEndpoint.extensions.empty') }}</p>
    <article v-for="record in records" :key="record.gateway.id" class="border-t border-themed pt-5 space-y-3">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div><h4 class="font-medium text-themed">{{ record.gateway.name }}</h4><p class="mt-1 text-sm text-themed-muted break-all">{{ t(`gatewayEndpoint.extensions.${record.role}.title`) }} · {{ record.gateway.target.ssh?.address }}</p></div>
        <button v-if="record.canRetry" type="button" class="btn-secondary" :disabled="busy" @click="retry(record.gateway)">{{ t('gatewayEndpoint.retry') }}</button>
        <button v-if="record.canRetry" type="button" class="btn-secondary" :disabled="busy" @click="replaceCandidate(record.gateway)">{{ t('gatewayEndpoint.flow.ddRetry') }}</button>
      </div>
      <p class="text-sm text-amber-700 dark:text-amber-300">{{ t(record.installation?.installationReceipt ? 'gatewayEndpoint.flow.installedCandidate' : 'gatewayEndpoint.flow.preparingCandidate') }}</p>
      <p class="text-sm text-themed-muted">{{ t('gatewayEndpoint.extensions.notReady') }}</p>
      <p v-if="record.hostname" class="text-sm text-themed-muted break-all">{{ t('gatewayEndpoint.hostname') }} · {{ record.hostname }}</p>
      <dl v-if="record.configuration && !record.installation?.installationPreview" class="grid gap-3 text-sm sm:grid-cols-2">
        <div><dt class="text-themed-muted">{{ t('managementGateway.network') }}</dt><dd class="text-themed tabular-nums break-all">{{ record.configuration.network }} · {{ record.configuration.address }}</dd></div>
        <div><dt class="text-themed-muted">{{ t('managementGateway.udp') }} / {{ t('managementGateway.https') }}</dt><dd class="text-themed tabular-nums">{{ record.configuration.listenPort }} / {{ record.configuration.consolePort }}</dd></div>
      </dl>
      <ul v-if="record.blockers.length" class="space-y-1 text-sm text-amber-700 dark:text-amber-300"><li v-for="code in record.blockers" :key="code">{{ message(code) }}</li></ul>
      <details class="text-sm"><summary class="cursor-pointer text-themed-muted">{{ t('managementGateway.machine') }}</summary><dl class="pt-2 space-y-2"><div><dt class="text-themed-muted">{{ t('managementGateway.machine') }}</dt><dd class="break-all font-mono text-themed">{{ record.gateway.target.machineId }}</dd></div><div><dt class="text-themed-muted">{{ t('managementGateway.fingerprint') }}</dt><dd class="break-all font-mono text-themed">{{ record.gateway.target.ssh?.fingerprint }}</dd></div></dl></details>
      <GatewayInstallationPanel :gateway="record.gateway" managed @changed="load" />
    </article>
  </section>
</template>
<style scoped>
.gateway-extensions { background: var(--bg-card); box-shadow: none; }
.gateway-extensions .btn-primary { background: var(--text-primary); color: var(--bg-primary); background-image: none; box-shadow: none; }
button:focus-visible, input:focus-visible, summary:focus-visible { outline: 2px solid var(--text-primary); outline-offset: 3px; }
button, input, summary { min-height: 44px; }
</style>
