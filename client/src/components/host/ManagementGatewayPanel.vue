<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api/admin'
import GatewayEndpointPanel from './GatewayEndpointPanel.vue'
import GatewayExtensionEntrypoints from './GatewayExtensionEntrypoints.vue'
import type { GatewaySetupProgress } from '@/types/gateway-endpoint'
import type { OnboardingGatewayStatus } from '@/types/api'
const { t, te } = useI18n()
const task = ref<GatewaySetupProgress | null>(null)
const busy = ref(false), error = ref(''), available = ref(true)
const loading = ref(true)
const reconnecting = ref(false)
const gateway = ref<OnboardingGatewayStatus | null>(null)
const hostname = ref(''), savedHostname = ref(''), expanded = ref(true)
const selected = ref<'local' | 'independent' | 'backup' | null>(null)
const hasCurrent = computed(() => gateway.value?.local !== undefined)
const configured = computed(() => gateway.value?.ready && gateway.value.local && !!savedHostname.value)
let disposed = false, timer: ReturnType<typeof setTimeout> | undefined
const running = computed(() => reconnecting.value || ['queued', 'running'].includes(task.value?.state || ''))
const capacity = computed(() => { const bits = Number(gateway.value?.gateway?.network.split('/')[1]); return Number.isInteger(bits) && bits >= 16 && bits <= 30 ? 2 ** (32 - bits) - 3 : null })
function message(code?: string | null) {
  if (code === 'SIMPLE_GATEWAY_MIGRATION_REQUIRED') return t('gatewayEndpoint.flow.localMigrationBlocked')
  const key = `gatewayEndpoint.setup.errors.${code}`
  return code && te(key) ? t(key) : code && te(`gatewayEndpoint.errors.${code}`) ? t(`gatewayEndpoint.errors.${code}`) : t('gatewayEndpoint.setup.errors.SIMPLE_GATEWAY_FAILED')
}
async function start() {
  if (loading.value || busy.value || running.value || gateway.value?.local === false) return
  busy.value = true; error.value = ''; expanded.value = true
  try {
    task.value = await api.hostOnboarding.configureControllerGateway({ requestId: crypto.randomUUID() })
    sessionStorage.setItem('gatewaySetupTask', task.value.id)
  } catch (failure) { error.value = message((failure as { code?: string }).code) }
  finally { busy.value = false }
}
async function poll() {
  if (disposed) return
  if (task.value?.id && (running.value || task.value.state === 'awaiting_confirmation') && document.visibilityState === 'visible') {
    try { task.value = await api.hostOnboarding.controllerGatewayTask(task.value.id); reconnecting.value = false; if (task.value.state === 'succeeded') await loadGateway() }
    catch (failure) {
      const code = (failure as { code?: string }).code
      if (code === 'GATEWAY_WEB_SESSION_REQUIRED' || code === 'SIMPLE_GATEWAY_ADMIN_REQUIRED') error.value = message(code)
      else reconnecting.value = true
    }
  }
  if (!disposed) timer = setTimeout(() => void poll(), 3000)
}
async function loadGateway() {
  try {
    const [value, endpoint] = await Promise.all([api.hostOnboarding.gatewaySetupStatus(), api.hostOnboarding.gatewayEndpoint()])
    if (!disposed) { gateway.value = value.gateway; savedHostname.value = endpoint.endpoint?.hostname || ''; hostname.value = savedHostname.value; if (configured.value) expanded.value = false }
  }
  catch (failure) { if (!disposed) gateway.value = { ...gateway.value, ready: false, code: (failure as { code?: string }).code } }
}
async function confirm() {
  if (busy.value || !hostname.value.trim() || !task.value?.plan) return
  if (task.value.plan.expiresAt <= Date.now()) { error.value = message('SIMPLE_GATEWAY_PLAN_EXPIRED'); return }
  busy.value = true; error.value = ''
  try { task.value = await api.hostOnboarding.confirmControllerGateway(task.value.id, task.value.plan.planHash, hostname.value.trim()); if (task.value.state === 'succeeded') await loadGateway() }
  catch (failure) { error.value = message((failure as { code?: string }).code) }
  finally { busy.value = false }
}
async function saveDomain() {
  if (busy.value || !hostname.value.trim()) return
  busy.value = true; error.value = ''
  try { const endpoint = await api.hostOnboarding.saveGatewayEndpoint({ hostname: hostname.value.trim() }); savedHostname.value = endpoint.endpoint?.hostname || ''; await loadGateway() }
  catch (failure) { error.value = message((failure as { code?: string }).code) }
  finally { busy.value = false }
}
onMounted(async () => {
  try {
    const status = await api.hostOnboarding.gatewaySetupStatus()
    available.value = status.available; task.value = status.latest; gateway.value = status.gateway
    const endpoint = await api.hostOnboarding.gatewayEndpoint()
    savedHostname.value = endpoint.endpoint?.hostname || ''
    hostname.value = savedHostname.value
    if (configured.value) expanded.value = false
    const id = sessionStorage.getItem('gatewaySetupTask')
    if (!task.value && id) task.value = await api.hostOnboarding.controllerGatewayTask(id)
  } catch (failure) { const code = (failure as { code?: string }).code; error.value = code && te(`gatewayEndpoint.setup.errors.${code}`) ? message(code) : t('gatewayEndpoint.loadFailed') }
  finally { loading.value = false }
  void poll()
})
onUnmounted(() => { disposed = true; clearTimeout(timer) })
</script>
<template>
  <section class="management-gateway space-y-6" data-ui>
    <div><h2 id="gateway-setup-heading" tabindex="-1" class="text-xl font-semibold text-themed">{{ t('gatewayEndpoint.flow.title') }}</h2><p class="mt-1 text-sm text-themed-muted">{{ t('gatewayEndpoint.flow.description') }}</p></div>
    <div v-if="hasCurrent" class="card p-5 space-y-3">
      <div class="flex flex-wrap justify-between gap-3"><h3 class="text-base font-semibold text-themed">{{ t('gatewayEndpoint.flow.current') }}</h3><button type="button" class="btn-secondary" :disabled="busy || running" @click="loadGateway">{{ t('gatewayEndpoint.reload') }}</button></div>
      <p class="text-lg font-semibold text-themed">{{ t(gateway?.local ? 'gatewayEndpoint.flow.local' : 'gatewayEndpoint.flow.remote') }}</p>
      <p class="text-sm text-themed-muted break-all">{{ savedHostname || gateway?.gateway?.sshHost || gateway?.target || t('gatewayEndpoint.flow.domainMissing') }}</p>
      <div v-if="gateway" role="status" class="space-y-1">
        <p class="text-sm font-medium" :class="gateway.ready ? 'text-green-700 dark:text-green-300' : 'text-amber-700 dark:text-amber-300'">{{ t(gateway.ready ? 'onboarding.gatewayReady' : 'onboarding.gatewayUnavailable') }}</p>
        <p v-if="!gateway.ready && gateway.code" class="text-sm text-themed-muted">{{ te(`onboarding.errors.${gateway.code}`) ? t(`onboarding.errors.${gateway.code}`) : gateway.code }}</p>
        <p v-if="capacity !== null" class="text-sm text-themed-muted">{{ t('gatewayEndpoint.setup.currentCapacity', { count: capacity }) }}</p>
      </div>
      <p class="text-sm text-amber-700 dark:text-amber-300">{{ t('gatewayEndpoint.flow.standbyUnavailable') }}</p>
    </div>
    <fieldset class="space-y-3" :disabled="loading || busy || running">
      <legend class="text-base font-semibold text-themed">{{ t(hasCurrent ? 'gatewayEndpoint.flow.change' : 'gatewayEndpoint.flow.choose') }}</legend>
      <div class="grid gap-3 sm:grid-cols-2">
        <button v-for="mode in (['local', 'independent'] as const)" :key="mode" type="button" class="btn-secondary text-left" :aria-pressed="selected === mode" aria-controls="gateway-configuration" @click="selected = selected === mode ? null : mode; expanded = true">{{ t(mode === 'local' ? 'gatewayEndpoint.flow.local' : 'gatewayEndpoint.flow.remote') }}</button>
      </div>
      <button v-if="hasCurrent" type="button" class="btn-secondary" :aria-pressed="selected === 'backup'" aria-controls="gateway-configuration" @click="selected = selected === 'backup' ? null : 'backup'">{{ t('gatewayEndpoint.flow.prepareStandby') }}</button>
    </fieldset>
    <p v-if="hasCurrent && selected && selected !== 'backup'" class="text-sm text-themed-muted">{{ t('gatewayEndpoint.flow.handover') }}</p>
    <p v-if="error" id="gateway-setup-error" role="alert" class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
    <div id="gateway-configuration" class="space-y-6">
      <details v-if="selected === 'local' || running || task?.state === 'awaiting_confirmation'" class="card p-5 space-y-4" :open="expanded" :aria-busy="busy || running" @toggle="expanded = ($event.target as HTMLDetailsElement).open">
        <summary class="cursor-pointer text-sm font-semibold" :class="configured ? 'text-green-700 dark:text-green-300' : 'text-themed'">{{ t(configured ? 'gatewayEndpoint.setup.states.succeeded' : 'gatewayEndpoint.setup.targetLocal') }}</summary>
        <div class="space-y-4 pt-4">
          <p class="text-sm text-themed">{{ t('gatewayEndpoint.setup.targetLocal') }}</p>
          <p v-if="!available" role="status" class="text-sm text-amber-700 dark:text-amber-300">{{ t('gatewayEndpoint.setup.unavailable') }}</p>
          <p v-if="loading" role="status" class="text-sm text-themed-muted">{{ t('gatewayEndpoint.setup.loading') }}</p>
          <p v-if="gateway?.local === false" role="status" class="text-sm text-amber-700 dark:text-amber-300">{{ t('gatewayEndpoint.flow.localMigrationBlocked') }}</p>
          <button type="button" class="btn-primary" :disabled="loading || busy || running || !available || gateway?.local === false" @click="start">{{ t(busy || running ? 'gatewayEndpoint.setup.working' : 'gatewayEndpoint.setup.start') }}</button>
          <label v-if="task?.plan || gateway?.ready" class="block text-sm text-themed">{{ t('gatewayEndpoint.hostname') }}
            <input v-model.trim="hostname" required maxlength="253" autocomplete="off" class="input mt-2 w-full" aria-describedby="gateway-setup-domain-help" :disabled="busy || running || gateway?.local === false" />
          </label>
          <p v-if="task?.plan || gateway?.ready" id="gateway-setup-domain-help" class="text-xs text-themed-muted">{{ t('gatewayEndpoint.hint') }}</p>
          <button v-if="gateway?.ready && gateway.local && task?.state !== 'awaiting_confirmation' && !running" type="button" class="btn-secondary" :disabled="busy || !hostname || hostname === savedHostname" @click="saveDomain">{{ t('gatewayEndpoint.save') }}</button>
        </div>
        <div v-if="task?.state === 'awaiting_confirmation' && task.plan" class="rounded-lg bg-themed-secondary p-4 space-y-3">
          <h3 class="text-sm font-semibold text-themed">{{ t('gatewayEndpoint.setup.review') }}</h3>
          <p class="text-sm text-themed">{{ t('gatewayEndpoint.setup.targetLocal') }}</p>
          <p class="text-sm text-themed-muted">{{ t('gatewayEndpoint.setup.capacity', { count: task.plan.hostCapacity }) }}</p>
          <p class="text-sm text-themed-muted">{{ t('gatewayEndpoint.setup.planDescription') }}</p>
          <button type="button" class="btn-primary" :disabled="busy || reconnecting || !hostname || gateway?.local === false" @click="confirm">{{ t('gatewayEndpoint.setup.confirm') }}</button>
        </div>
      </details>
      <div v-if="task" class="space-y-2" role="status" aria-live="polite">
        <p class="text-xs text-themed-muted">{{ t('gatewayEndpoint.setup.lastAttempt') }} · {{ new Date(task.updatedAt).toLocaleString() }}</p>
        <p class="text-sm font-medium" :class="task.state === 'succeeded' ? 'text-green-700 dark:text-green-300' : ['failed','needs_review'].includes(task.state) ? 'text-red-700 dark:text-red-300' : 'text-themed'">{{ t(`gatewayEndpoint.setup.states.${task.state}`) }}</p>
        <p class="text-sm text-themed-muted">{{ t(`gatewayEndpoint.setup.steps.${task.step}`) }}</p>
        <p v-if="task.errorCode" class="text-sm text-themed">{{ message(task.errorCode) }}</p>
        <p v-if="reconnecting" class="text-sm text-themed-muted">{{ t('gatewayEndpoint.setup.reconnecting') }}</p>
        <p v-if="task.hostCapacity" class="text-sm text-themed-muted">{{ t('gatewayEndpoint.setup.capacity', { count: task.hostCapacity }) }}</p>
      </div>
      <GatewayExtensionEntrypoints :purpose="selected === 'local' ? null : selected" @select="selected = $event" />
    </div>
    <section v-if="hasCurrent" class="card p-5"><GatewayEndpointPanel :manage-domain="false" /></section>
    <details class="card p-5 space-y-3"><summary class="cursor-pointer text-sm font-semibold text-themed">{{ t('gatewayEndpoint.flow.recovery') }}</summary><div class="pt-3 space-y-3 text-sm text-themed-muted"><p>{{ t('gatewayEndpoint.flow.standbyMeaning') }}</p><p>{{ t('gatewayEndpoint.flow.recoverController') }}</p><p>{{ t('gatewayEndpoint.flow.recoverGateway') }}</p><p>{{ t('gatewayEndpoint.flow.switchBack') }}</p><p class="text-amber-700 dark:text-amber-300">{{ t('gatewayEndpoint.flow.recoveryPending') }}</p></div></details>
  </section>
</template>
<style scoped>
.management-gateway { --text-primary: #111; --text-secondary: #525252; --bg-primary: #fff; --bg-secondary: #f5f5f5; --border-color: #e5e5e5; color: var(--text-primary); }
:global(.dark .management-gateway) { --text-primary: #fff; --text-secondary: #b4b4b4; --bg-primary: #111; --bg-secondary: #1a1a1a; --border-color: #333; }
.management-gateway :deep(.card) { background: var(--bg-primary); box-shadow: none !important; }
.management-gateway :deep(.text-themed-muted) { color: var(--text-secondary); }
.management-gateway :deep(.btn-primary) { background: var(--text-primary) !important; color: var(--bg-primary) !important; box-shadow: none !important; }
.management-gateway :deep(.btn-primary::before) { display: none !important; }
.management-gateway :deep(.btn-secondary) { background: var(--bg-primary); color: var(--text-primary); box-shadow: none !important; }
.management-gateway :deep(button:not(:disabled):hover) { opacity: .85; }
.management-gateway :deep(button:not(:disabled):active) { transform: translateY(1px); }
.management-gateway button[aria-pressed="true"] { border-color: var(--text-primary); background: var(--bg-secondary); font-weight: 600; }
button:focus-visible, input:focus-visible, summary:focus-visible { outline: 2px solid var(--text-primary); outline-offset: 3px; }
summary { min-height: 44px; display: list-item; align-content: center; }
@media (max-width: 640px) { button, input { min-height: 44px; } }
@media (prefers-reduced-motion: reduce) { .management-gateway :deep(button) { transition: none; transform: none !important; } }
</style>
