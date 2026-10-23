<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api/admin'
import GatewayInstallationPanel from './GatewayInstallationPanel.vue'
import type { GatewayInspectionConfiguration, GatewayManagementList, GatewayInspectionResult, ManagementGateway } from '@/types/management-gateway'
const { t, te, locale } = useI18n()
const list = ref<GatewayManagementList | null>(null)
const loading = ref(true), busy = ref(false), error = ref('')
const mode = ref<'local' | 'remote' | 'existing'>('local')
const gatewayId = ref<string>(crypto.randomUUID()), requestId = ref<string>(crypto.randomUUID())
const name = ref(''), sshAddress = ref(''), sshPort = ref(22), fingerprint = ref('')
const authType = ref<'password' | 'privateKey'>('password'), credential = ref('')
const configuration = ref<GatewayInspectionConfiguration>({ slot: 'a', network: '', address: '', listenPort: 51820, consolePort: 18443 })
const result = ref<GatewayInspectionResult | null>(null)
const nameInput = ref<HTMLInputElement | null>(null)
let disposed = false, loadSequence = 0
const report = computed(() => result.value?.report || null)
function message(code: string | null | undefined) {
  const key = `managementGateway.errors.${code}`
  return code && te(key) ? t(key) : t('managementGateway.fallback')
}
function resetRequest() { requestId.value = crypto.randomUUID(); result.value = null; error.value = '' }
function modeChanged() { credential.value = ''; resetRequest() }
async function refresh() {
  const sequence = ++loadSequence
  loading.value = true
  try { const data = await api.hostOnboarding.managementGateways(); if (!disposed && sequence === loadSequence) { list.value = data; error.value = '' } }
  catch (failure) { if (!disposed && sequence === loadSequence) error.value = message((failure as { code?: string }).code) }
  finally { if (!disposed && sequence === loadSequence) loading.value = false }
}
async function inspect() {
  if (busy.value) return
  busy.value = true; error.value = ''
  const secret = credential.value; credential.value = ''
  try {
    const data = await api.hostOnboarding.inspectGateway({ requestId: requestId.value, gatewayId: gatewayId.value, name: name.value.trim(), mode: mode.value,
      target: mode.value === 'local' ? null : { address: sshAddress.value.trim(), port: sshPort.value, fingerprint: fingerprint.value.trim() },
      configuration: { ...configuration.value }, ...(mode.value === 'local' ? {} : { credentials: { [authType.value]: secret } }) })
    if (!disposed) { result.value = data; await refresh() }
  } catch (failure) { if (!disposed) error.value = message((failure as { code?: string }).code) }
  finally { if (!disposed) busy.value = false }
}
async function selectGateway(gateway: ManagementGateway) {
  if (busy.value) return
  gatewayId.value = gateway.id; name.value = gateway.name; mode.value = gateway.mode; credential.value = ''
  sshAddress.value = gateway.target.ssh?.address || ''; sshPort.value = gateway.target.ssh?.port || 22; fingerprint.value = gateway.target.ssh?.fingerprint || ''
  const inspection = gateway.tasks.find(task => task.inspection)?.inspection
  if (inspection) {
    const { slot, network, address, listenPort, consolePort } = inspection.request
    configuration.value = { slot, network, address, listenPort, consolePort }
  }
  resetRequest()
  const task = gateway.tasks.find(item => item.inspection)
  if (task?.inspection) result.value = { task, report: task.inspection.report, canWrite: false, duplicate: false }
  await nextTick(); nameInput.value?.focus()
}
async function newTarget() {
  if (busy.value) return
  gatewayId.value = crypto.randomUUID(); name.value = ''; sshAddress.value = ''; fingerprint.value = ''; credential.value = ''
  resetRequest()
  await nextTick(); nameInput.value?.focus()
}
function date(value: number) { return new Date(value).toLocaleString(locale.value) }
onMounted(() => void refresh())
onUnmounted(() => { disposed = true; credential.value = '' })
</script>

<template>
  <section class="gateway-panel space-y-4" data-ui :aria-busy="busy || loading">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 class="text-xl font-semibold text-themed">{{ t('managementGateway.title') }}</h2>
        <p class="mt-1 text-sm text-themed-muted">{{ t('managementGateway.description') }}</p>
      </div>
      <button type="button" class="btn-secondary" :disabled="busy || loading" @click="refresh">{{ t('managementGateway.refresh') }}</button>
    </div>
    <p v-if="list" class="text-xs text-themed-muted break-all">{{ t('managementGateway.scope') }} · {{ list.platformId }}</p>
    <p class="text-sm text-amber-700 dark:text-amber-300">{{ t('managementGateway.noStandby') }}</p>
    <p v-if="error" id="gateway-form-error" role="alert" class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
    <form class="card p-4 space-y-4" :aria-describedby="error ? 'gateway-form-error' : undefined" @submit.prevent="inspect">
      <fieldset class="space-y-4" :disabled="busy">
        <legend class="sr-only">{{ t('managementGateway.inspect') }}</legend>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label class="block text-sm text-themed">{{ t('managementGateway.name') }}<input ref="nameInput" v-model="name" required maxlength="80" class="input mt-1 w-full" @input="resetRequest" /></label>
          <label class="block text-sm text-themed">{{ t('managementGateway.mode') }}
            <select v-model="mode" class="input mt-1 w-full" aria-describedby="gateway-mode-hint" @change="modeChanged">
              <option value="local">{{ t('managementGateway.local') }}</option><option value="remote">{{ t('managementGateway.remote') }}</option><option value="existing">{{ t('managementGateway.existing') }}</option>
            </select>
          </label>
        </div>
        <p id="gateway-mode-hint" class="text-xs text-themed-muted">{{ t(mode === 'local' ? 'managementGateway.localHint' : 'managementGateway.remoteHint') }}</p>
        <div v-if="mode !== 'local'" class="space-y-4">
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label class="block text-sm text-themed">{{ t('managementGateway.sshAddress') }}<input v-model="sshAddress" required maxlength="253" class="input mt-1 w-full" autocomplete="off" @input="resetRequest" /></label>
            <label class="block text-sm text-themed">{{ t('managementGateway.sshPort') }}<input v-model.number="sshPort" required type="number" min="1" max="65535" class="input mt-1 w-full" @input="resetRequest" /></label>
          </div>
          <label class="block text-sm text-themed">{{ t('managementGateway.fingerprint') }}<input v-model="fingerprint" required pattern="SHA256:[A-Za-z0-9+/]{43}" maxlength="50" class="input mt-1 w-full font-mono" aria-describedby="gateway-fingerprint-hint" @input="resetRequest" /></label>
          <p id="gateway-fingerprint-hint" class="text-xs text-themed-muted">{{ t('managementGateway.fingerprintHint') }}</p>
          <label class="block text-sm text-themed">{{ t('managementGateway.auth') }}<select v-model="authType" class="input mt-1 w-full sm:max-w-xs" @change="credential = ''"><option value="password">{{ t('managementGateway.password') }}</option><option value="privateKey">{{ t('managementGateway.privateKey') }}</option></select></label>
          <label class="block text-sm text-themed">{{ t('managementGateway.credential') }}
            <input v-if="authType === 'password'" v-model="credential" required type="password" maxlength="1024" autocomplete="off" class="input mt-1 w-full" aria-describedby="gateway-credential-hint" />
            <textarea v-else v-model="credential" required maxlength="32768" rows="4" spellcheck="false" autocomplete="off" class="input mt-1 w-full font-mono" aria-describedby="gateway-credential-hint" />
          </label>
          <p id="gateway-credential-hint" class="text-xs text-themed-muted">{{ t('managementGateway.credentialHint') }}</p>
        </div>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <label class="block text-sm text-themed">{{ t('managementGateway.slot') }}<select v-model="configuration.slot" class="input mt-1 w-full" @change="resetRequest"><option value="a">A</option><option value="b">B</option></select></label>
          <label class="block text-sm text-themed">{{ t('managementGateway.network') }}<input v-model="configuration.network" required maxlength="18" class="input mt-1 w-full font-mono" placeholder="10.250.1.0/24" @input="resetRequest" /></label>
          <label class="block text-sm text-themed">{{ t('managementGateway.address') }}<input v-model="configuration.address" required maxlength="15" class="input mt-1 w-full font-mono" placeholder="10.250.1.1" @input="resetRequest" /></label>
          <label class="block text-sm text-themed">{{ t('managementGateway.udp') }}<input v-model.number="configuration.listenPort" required type="number" min="1024" max="65535" class="input mt-1 w-full" @input="resetRequest" /></label>
          <label class="block text-sm text-themed">{{ t('managementGateway.https') }}<input v-model.number="configuration.consolePort" required type="number" min="1024" max="65535" class="input mt-1 w-full" @input="resetRequest" /></label>
        </div>
      </fieldset>
      <div class="flex flex-wrap gap-3 items-center">
        <button type="submit" class="btn-primary" :disabled="busy || loading || !list">{{ t(busy ? 'managementGateway.inspecting' : 'managementGateway.inspect') }}</button>
        <button type="button" class="btn-secondary" :disabled="busy" @click="newTarget">{{ t('managementGateway.newTarget') }}</button>
      </div>
      <p class="text-xs text-themed-muted">{{ t('managementGateway.next') }}</p>
    </form>
    <section v-if="report" class="card p-4 space-y-3" aria-live="polite">
      <h3 class="text-base font-semibold text-themed">{{ t('managementGateway.report') }} · {{ t(report.blockers.length ? 'managementGateway.blocked' : 'managementGateway.clear') }}</h3>
      <dl class="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <div><dt class="text-themed-muted">{{ t('managementGateway.machine') }}</dt><dd class="font-mono break-all text-themed">{{ report.machineId }}</dd></div>
        <div><dt class="text-themed-muted">{{ t('managementGateway.system') }}</dt><dd class="text-themed">{{ report.osId }} · {{ report.architecture }}</dd></div>
        <div><dt class="text-themed-muted">{{ t('managementGateway.memory') }} / {{ t('managementGateway.disk') }}</dt><dd class="tabular-nums text-themed">{{ report.memoryMiB.toLocaleString() }} / {{ report.diskAvailableMiB.toLocaleString() }} MiB</dd></div>
        <div><dt class="text-themed-muted">{{ t('managementGateway.inspected') }}</dt><dd class="text-themed">{{ date(report.inspectedAt) }}</dd></div>
      </dl>
      <ul v-if="report.blockers.length" class="space-y-1 text-sm text-amber-700 dark:text-amber-300"><li v-for="code in report.blockers" :key="code">{{ message(code) }}</li></ul>
    </section>
    <p v-if="loading" role="status" class="text-sm text-themed-muted">{{ t('common.loading') }}</p>
    <p v-else-if="list && !list.gateways.length" class="text-sm text-themed-muted">{{ t('managementGateway.empty') }}</p>
    <ul v-if="list?.gateways.length" class="space-y-3">
      <li v-for="gateway in list.gateways" :key="gateway.id" class="card p-4 space-y-2">
        <div class="flex flex-wrap justify-between gap-3 items-center"><h3 class="font-semibold text-themed">{{ gateway.name }}</h3><button type="button" class="btn-secondary" :disabled="busy" @click="selectGateway(gateway)">{{ t('managementGateway.again') }}</button></div>
        <p class="text-xs text-themed-muted break-all">{{ t('managementGateway.machine') }} · {{ gateway.target.machineId }}</p>
        <template v-if="gateway.tasks[0]?.kind === 'inspect'">
          <p class="text-sm text-themed">{{ t(gateway.tasks[0].inspection ? gateway.tasks[0].inspection.report.blockers.length ? 'managementGateway.blocked' : 'managementGateway.clear' : 'managementGateway.pending') }}</p>
          <ul v-if="gateway.tasks[0].inspection" class="space-y-1 text-sm text-amber-700 dark:text-amber-300"><li v-for="code in gateway.tasks[0].inspection.report.blockers" :key="code">{{ message(code) }}</li></ul>
          <p v-if="gateway.tasks[0].errorCode" class="text-sm text-red-700 dark:text-red-300">{{ message(gateway.tasks[0].errorCode) }}</p>
        </template>
        <GatewayInstallationPanel :gateway="gateway" @changed="refresh" />
      </li>
    </ul>
  </section>
</template>

<style scoped>
.gateway-panel { --text-primary: #111; --text-secondary: #555; --bg-primary: #fff; --bg-secondary: #f5f5f5; --border-color: #dedede; }
:global(.dark .gateway-panel) { --text-primary: #fff; --text-secondary: #b4b4b4; --bg-primary: #080808; --bg-secondary: #161616; --border-color: #333; }
.gateway-panel .card { background: var(--bg-primary) !important; box-shadow: none !important; }
.gateway-panel .btn-primary { background: var(--text-primary) !important; color: var(--bg-primary) !important; box-shadow: none !important; }
.gateway-panel .text-themed-muted { color: var(--text-secondary); }
.gateway-panel :is(input, select, textarea, button) { box-shadow: none !important; }
.gateway-panel .input::placeholder { color: var(--text-secondary); opacity: 1; }
.gateway-panel .input:focus-visible, .gateway-panel button:focus-visible { outline: 2px solid var(--text-primary); outline-offset: 3px; }
@media (max-width: 640px) {
  .gateway-panel .input, .gateway-panel button { min-height: 44px; }
}
</style>
