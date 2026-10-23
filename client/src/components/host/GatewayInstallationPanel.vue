<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api/admin'
import type { GatewayBootstrapMaterial, GatewayInstallationConfiguration, GatewayManagementTask, ManagementGateway } from '@/types/management-gateway'

const props = defineProps<{ gateway: ManagementGateway }>()
const emit = defineEmits<{ changed: [] }>()
const { t, te, locale } = useI18n()
const expanded = ref(false), busy = ref(false), refreshing = ref(false), error = ref('')
const task = ref<GatewayManagementTask | null>(null)
const configuration = ref<GatewayInstallationConfiguration>({ slot: 'a', network: '', address: '', listenPort: 51820, consolePort: 18443, consoleOrigin: '' })
const credentialType = ref<'password' | 'privateKey'>('password'), credential = ref('')
const requestId = ref<string>(crypto.randomUUID())
const dialog = ref<HTMLDialogElement | null>(null), passwordInput = ref<HTMLInputElement | null>(null)
const dialogAction = ref<'confirm' | 'bootstrap'>('confirm'), password = ref(''), totpCode = ref(''), confirmation = ref(''), dialogError = ref('')
const dialogTask = ref<{ id: string; planHash: string } | null>(null)
const material = ref<GatewayBootstrapMaterial | null>(null)
let disposed = false, sequence = 0, pollTimer: ReturnType<typeof setTimeout> | undefined, clockTimer: ReturnType<typeof setInterval> | undefined
let returnFocus: HTMLElement | null = null
const now = ref(Date.now())
const preview = computed(() => task.value?.installationPreview || null)
const preparing = computed(() => task.value?.status === 'awaiting_confirmation' && ['queued', 'running'].includes(task.value.preparationState || ''))
const needsPolling = computed(() => preparing.value || ['queued', 'running'].includes(task.value?.status || ''))
const canPrepare = computed(() => props.gateway.mode !== 'existing' && props.gateway.revision === '0' && !needsPolling.value &&
  (!task.value || ['failed', 'cancelled'].includes(task.value.status)) &&
  !task.value?.steps.some(step => ['install-components', 'verify-installation'].includes(step.key) && step.status !== 'pending'))
const canConfirm = computed(() => task.value?.status === 'awaiting_confirmation' && task.value.preparationState === 'ready' &&
  preview.value?.installable === true && preview.value.planHash === task.value.planHash && preview.value.expiresAt > now.value)
const canCancel = computed(() => task.value && ['awaiting_confirmation', 'queued', 'failed'].includes(task.value.status) &&
  task.value.steps.every(step => step.status === 'pending'))
const canRetrieve = computed(() => task.value?.status === 'succeeded' && !!task.value.bootstrapExpiresAt &&
  new Date(task.value.bootstrapExpiresAt).getTime() > now.value && !material.value)
const expectedConfirmation = computed(() => dialogTask.value ? `CONFIRM ${dialogTask.value.id}` : '')
const status = computed(() => preparing.value ? 'preparing' : task.value?.status === 'awaiting_confirmation' && preview.value && !preview.value.installable ? 'blocked' :
  task.value?.status === 'awaiting_confirmation' && preview.value && preview.value.expiresAt <= now.value ? 'expired' : task.value?.status || 'not_started')
const statusClass = computed(() => status.value === 'succeeded' ? 'text-green-700 dark:text-green-300' :
  ['failed', 'needs_review'].includes(status.value) ? 'text-red-700 dark:text-red-300' : 'text-themed-muted')
function message(code?: string | null) {
  const key = `managementGateway.errors.${code}`
  return code && te(key) ? t(key) : t('managementGateway.installFallback')
}
function date(value: string | number) { return new Date(value).toLocaleString(locale.value) }
function applyTask(value: GatewayManagementTask) {
  if (['failed', 'cancelled'].includes(value.status) && value.status !== task.value?.status) requestId.value = crypto.randomUUID()
  task.value = value
  if (value.installationPreview) configuration.value = { ...value.installationPreview.configuration }
}
watch(() => props.gateway.tasks, tasks => {
  if (busy.value || refreshing.value) return
  const value = task.value ? tasks.find(item => item.id === task.value!.id) : tasks.find(item => item.kind === 'install')
  if (value && (!task.value || Date.parse(value.updatedAt) >= Date.parse(task.value.updatedAt))) applyTask(value)
}, { immediate: true })
watch(configuration, () => { requestId.value = crypto.randomUUID() }, { deep: true })
watch(credentialType, () => { credential.value = '' })
watch(expanded, value => { if (!value) { credential.value = ''; material.value = null } })
watch(() => props.gateway.target.machineId, () => { credential.value = ''; material.value = null; clearDialog() })

async function refreshTask() {
  if (!task.value || refreshing.value || busy.value) return
  const id = task.value.id, current = ++sequence
  refreshing.value = true
  try {
    const data = await api.hostOnboarding.gatewayTask(id)
    if (!disposed && current === sequence && task.value?.id === id) {
      const changed = task.value.status !== data.status
      applyTask(data); error.value = ''
      if (changed && !needsPolling.value) emit('changed')
    }
  } catch (failure) { if (!disposed && current === sequence) error.value = message((failure as { code?: string }).code) }
  finally { if (!disposed && current === sequence) refreshing.value = false }
}
async function poll() {
  if (disposed) return
  if (needsPolling.value && document.visibilityState === 'visible') await refreshTask()
  if (!disposed) pollTimer = setTimeout(() => void poll(), 5000)
}
async function prepare() {
  if (busy.value || refreshing.value || !canPrepare.value) return
  busy.value = true; error.value = ''; sequence++
  const secret = credential.value; credential.value = ''
  try {
    const data = await api.hostOnboarding.prepareGatewayInstallation({ requestId: requestId.value, gatewayId: props.gateway.id,
      configuration: { ...configuration.value }, ...(props.gateway.mode === 'local' ? {} : { credentials: { [credentialType.value]: secret } }) })
    if (!disposed) { applyTask(data); emit('changed') }
  } catch (failure) { if (!disposed) error.value = message((failure as { code?: string }).code) }
  finally { if (!disposed) busy.value = false }
}
async function cancel() {
  if (busy.value || refreshing.value || !canCancel.value || !task.value) return
  busy.value = true; error.value = ''; sequence++
  try {
    const data = await api.hostOnboarding.cancelGatewayInstallation(task.value.id)
    if (!disposed) { applyTask(data); credential.value = ''; emit('changed') }
  } catch (failure) { if (!disposed) error.value = message((failure as { code?: string }).code) }
  finally { if (!disposed) busy.value = false }
}
async function openDialog(action: 'confirm' | 'bootstrap') {
  if (busy.value || refreshing.value || !task.value || (action === 'confirm' ? !canConfirm.value : !canRetrieve.value)) return
  clearDialog(); dialogAction.value = action; dialogTask.value = { id: task.value.id, planHash: task.value.planHash }
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  await nextTick(); dialog.value?.showModal(); passwordInput.value?.focus()
}
function clearDialog() { password.value = ''; totpCode.value = ''; confirmation.value = ''; dialogError.value = ''; dialogTask.value = null }
function closeDialog() { if (!busy.value) dialog.value?.close() }
function dialogClosed() {
  // A queued close event may arrive after the same dialog has been reopened.
  if (dialog.value?.open) return
  clearDialog(); returnFocus?.focus(); returnFocus = null
}
async function submitDialog() {
  const selected = dialogTask.value
  if (busy.value || refreshing.value || !selected || !password.value) return
  if (selected.id !== task.value?.id || (dialogAction.value === 'confirm' &&
    (!canConfirm.value || selected.planHash !== task.value.planHash || confirmation.value !== expectedConfirmation.value))) {
    dialogError.value = t('managementGateway.planChanged'); return
  }
  const authorization = { password: password.value, ...(totpCode.value ? { totpCode: totpCode.value } : {}) }
  const phrase = confirmation.value, action = dialogAction.value
  password.value = ''; totpCode.value = ''; confirmation.value = ''; dialogError.value = ''; busy.value = true; sequence++
  try {
    if (action === 'confirm') {
      const data = await api.hostOnboarding.confirmGatewayInstallation(selected.id, { ...authorization, planHash: selected.planHash, confirmation: phrase })
      if (!disposed) applyTask(data)
    } else {
      const data = await api.hostOnboarding.retrieveGatewayBootstrap(selected.id, authorization)
      if (!disposed) {
        material.value = data
        if (task.value) task.value = { ...task.value, bootstrapExpiresAt: null }
      }
    }
    if (!disposed) { dialog.value?.close(); emit('changed') }
  } catch (failure) { if (!disposed) dialogError.value = message((failure as { code?: string }).code) }
  finally { if (!disposed) busy.value = false }
}
function base32(seed: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = 0, value = 0, output = ''
  for (const byte of atob(seed)) {
    value = (value << 8) | byte.charCodeAt(0); bits += 8
    while (bits >= 5) { bits -= 5; output += alphabet[(value >>> bits) & 31] }
  }
  if (bits) output += alphabet[(value << (5 - bits)) & 31]
  return output
}
const authenticatorKey = computed(() => material.value ? base32(material.value.totpSeed) : '')
function downloadMaterial() {
  if (!material.value || !task.value) return
  const data = { gatewayId: props.gateway.id, taskId: task.value.id, consoleOrigin: preview.value?.configuration.consoleOrigin,
    consoleCertificateSha256: task.value.installationReceipt?.consoleCertificateSha256, ...material.value, authenticatorKey: authenticatorKey.value }
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a'); link.href = url; link.download = `payincus-gateway-${props.gateway.id}-recovery.json`
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
onMounted(() => {
  const inspection = props.gateway.tasks.find(item => item.inspection)?.inspection
  if (!preview.value && inspection) {
    // The persisted report includes server identity fields; only desired settings
    // belong in an installation request's strict schema.
    const { slot, network, address, listenPort, consolePort } = inspection.request
    configuration.value = { slot, network, address, listenPort, consolePort, consoleOrigin: '' }
  }
  clockTimer = setInterval(() => { now.value = Date.now() }, 1000)
  void poll()
})
onUnmounted(() => {
  disposed = true; sequence++; clearTimeout(pollTimer); clearInterval(clockTimer)
  credential.value = ''; material.value = null; clearDialog(); dialog.value?.close()
})
</script>

<template>
  <div class="gateway-installation space-y-3">
    <button type="button" class="btn-secondary" :aria-expanded="expanded" :aria-controls="`gateway-installation-${gateway.id}`" :disabled="busy" @click="expanded = !expanded">
      {{ t('managementGateway.installation') }} · {{ t(`managementGateway.installStatus.${status}`) }}
    </button>
    <section v-if="expanded" :id="`gateway-installation-${gateway.id}`" class="space-y-4" :aria-busy="busy || refreshing">
      <h4 class="font-semibold text-themed">{{ t('managementGateway.installation') }}</h4>
      <p v-if="error" role="alert" class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
      <p v-if="gateway.mode === 'existing' || gateway.revision !== '0' && !task" class="text-sm text-themed-muted">{{ t('managementGateway.attachRequired') }}</p>
      <form v-if="canPrepare" class="space-y-4" @submit.prevent="prepare">
        <fieldset :disabled="busy || refreshing" class="space-y-4">
          <legend class="sr-only">{{ t('managementGateway.preparePlan') }}</legend>
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <label class="block text-sm text-themed">{{ t('managementGateway.slot') }}<select v-model="configuration.slot" class="input mt-1 w-full"><option value="a">A</option><option value="b">B</option></select></label>
            <label class="block text-sm text-themed">{{ t('managementGateway.network') }}<input v-model="configuration.network" required maxlength="18" class="input mt-1 w-full font-mono" /></label>
            <label class="block text-sm text-themed">{{ t('managementGateway.address') }}<input v-model="configuration.address" required maxlength="15" class="input mt-1 w-full font-mono" /></label>
            <label class="block text-sm text-themed">{{ t('managementGateway.udp') }}<input v-model.number="configuration.listenPort" required type="number" min="1024" max="65535" class="input mt-1 w-full" /></label>
            <label class="block text-sm text-themed">{{ t('managementGateway.https') }}<input v-model.number="configuration.consolePort" required type="number" min="1024" max="65535" class="input mt-1 w-full" /></label>
            <label class="block text-sm text-themed">{{ t('managementGateway.consoleOrigin') }}<input v-model="configuration.consoleOrigin" required type="url" maxlength="300" :aria-describedby="`gateway-origin-hint-${gateway.id}`" class="input mt-1 w-full" /></label>
          </div>
          <p :id="`gateway-origin-hint-${gateway.id}`" class="text-xs text-themed-muted">{{ t('managementGateway.consoleOriginHint') }}</p>
          <div v-if="gateway.mode !== 'local'" class="space-y-3">
            <p class="text-sm text-themed-muted break-all">{{ t('managementGateway.sshAddress') }} · {{ gateway.target.ssh?.address }}:{{ gateway.target.ssh?.port }}</p>
            <label class="block text-sm text-themed">{{ t('managementGateway.auth') }}<select v-model="credentialType" class="input mt-1 w-full sm:max-w-xs"><option value="password">{{ t('managementGateway.password') }}</option><option value="privateKey">{{ t('managementGateway.privateKey') }}</option></select></label>
            <label class="block text-sm text-themed">{{ t('managementGateway.credential') }}
              <input v-if="credentialType === 'password'" v-model="credential" required type="password" maxlength="1024" autocomplete="off" class="input mt-1 w-full" />
              <textarea v-else v-model="credential" required maxlength="32768" rows="4" spellcheck="false" autocomplete="off" class="input mt-1 w-full font-mono" />
            </label>
            <p class="text-xs text-themed-muted">{{ t('managementGateway.installCredentialHint') }}</p>
          </div>
        </fieldset>
        <button type="submit" class="btn-secondary" :disabled="busy || refreshing">{{ t('managementGateway.preparePlan') }}</button>
        <p class="text-xs text-themed-muted">{{ t('managementGateway.prepareHint') }}</p>
      </form>
      <template v-if="task">
        <div class="flex flex-wrap justify-between items-center gap-3">
          <p role="status" class="text-sm" :class="statusClass">{{ t(`managementGateway.installStatus.${status}`) }}</p>
          <button type="button" class="btn-secondary" :disabled="busy || refreshing" @click="refreshTask">{{ t('managementGateway.refreshTask') }}</button>
        </div>
        <p class="text-xs text-themed-muted break-all">{{ t('managementGateway.taskId') }} · {{ task.id }} · {{ date(task.updatedAt) }}</p>
        <p v-if="task.errorCode" role="alert" class="text-sm text-red-700 dark:text-red-300">{{ message(task.errorCode) }}</p>
        <section v-if="preview" class="space-y-3">
          <h5 class="font-semibold text-themed">{{ t('managementGateway.plan') }}</h5>
          <dl class="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <div><dt class="text-themed-muted">{{ t('managementGateway.machine') }}</dt><dd class="font-mono text-themed break-all">{{ preview.target.machineId }}</dd></div>
            <div><dt class="text-themed-muted">{{ t('managementGateway.verifiedPackage') }}</dt><dd class="text-themed">{{ preview.package.version }} · {{ preview.package.architecture }}</dd></div>
            <div><dt class="text-themed-muted">{{ t('managementGateway.sourceCommit') }}</dt><dd class="font-mono text-themed break-all">{{ preview.package.sourceCommit }}</dd></div>
            <div><dt class="text-themed-muted">{{ t('managementGateway.planExpires') }}</dt><dd class="text-themed">{{ date(preview.expiresAt) }}</dd></div>
            <div><dt class="text-themed-muted">{{ t('managementGateway.network') }}</dt><dd class="text-themed">{{ preview.configuration.network }} · {{ preview.configuration.address }}</dd></div>
            <div><dt class="text-themed-muted">{{ t('managementGateway.consoleOrigin') }}</dt><dd class="text-themed break-all">{{ preview.configuration.consoleOrigin }}</dd></div>
            <div><dt class="text-themed-muted">{{ t('managementGateway.udp') }} / {{ t('managementGateway.https') }}</dt><dd class="text-themed tabular-nums">{{ preview.configuration.listenPort }} / {{ preview.configuration.consolePort }}</dd></div>
            <div><dt class="text-themed-muted">{{ t('managementGateway.planHash') }}</dt><dd class="font-mono text-themed break-all">{{ preview.planHash }}</dd></div>
          </dl>
          <details>
            <summary class="text-sm text-themed">{{ t('managementGateway.changes') }}</summary>
            <dl class="mt-3 space-y-2 text-sm">
              <div><dt class="text-themed-muted">{{ t('managementGateway.installDirectories') }}</dt><dd class="font-mono text-themed break-all">{{ preview.changes.packageDirectory }}<br />{{ preview.changes.stateDirectory }}</dd></div>
              <div><dt class="text-themed-muted">{{ t('managementGateway.services') }}</dt><dd class="font-mono text-themed break-all">{{ preview.changes.services.join(' · ') }}</dd></div>
              <div><dt class="text-themed-muted">{{ t('managementGateway.interface') }}</dt><dd class="font-mono text-themed">{{ preview.changes.interface }}</dd></div>
            </dl>
          </details>
          <p class="text-xs text-themed-muted">{{ t('managementGateway.installEffects') }}</p>
          <ul v-if="preview.blockers.length" class="space-y-1 text-sm text-amber-700 dark:text-amber-300"><li v-for="code in preview.blockers" :key="code">{{ message(code) }}</li></ul>
        </section>
        <ol v-if="task.steps.length" class="space-y-2 text-sm">
          <li v-for="step in task.steps" :key="step.key" class="flex flex-wrap justify-between gap-2">
            <span class="text-themed">{{ t(`managementGateway.steps.${step.key}`) }}</span><span class="text-themed-muted">{{ t(`managementGateway.stepStatus.${step.status}`) }}</span>
          </li>
        </ol>
        <p v-if="task.status === 'needs_review'" class="text-sm text-amber-700 dark:text-amber-300">{{ t('managementGateway.reviewRequired') }}</p>
        <div class="flex flex-wrap gap-3">
          <button v-if="canConfirm" type="button" class="btn-primary" :disabled="busy || refreshing" @click="openDialog('confirm')">{{ t('managementGateway.confirmInstall') }}</button>
          <button v-if="canCancel" type="button" class="btn-secondary" :disabled="busy || refreshing" @click="cancel">{{ t('managementGateway.cancelTask') }}</button>
          <button v-if="canRetrieve" type="button" class="btn-secondary" :disabled="busy || refreshing" @click="openDialog('bootstrap')">{{ t('managementGateway.retrieveMaterial') }}</button>
        </div>
        <section v-if="task.installationReceipt" class="space-y-2">
          <h5 class="font-semibold text-themed">{{ t('managementGateway.receipt') }}</h5>
          <p class="text-sm text-themed-muted">{{ t('managementGateway.installedReadOnly') }}</p>
          <p class="text-xs text-themed-muted break-all">{{ t('managementGateway.certificateHash') }} · {{ task.installationReceipt.consoleCertificateSha256 }}</p>
          <ul class="space-y-1 text-sm text-amber-700 dark:text-amber-300"><li v-for="code in task.installationReceipt.blockers" :key="code">{{ t(`managementGateway.readiness.${code}`) }}</li></ul>
          <p v-if="task.bootstrapExpiresAt" class="text-xs text-themed-muted">{{ t('managementGateway.materialExpires') }} · {{ date(task.bootstrapExpiresAt) }}</p>
          <p v-else-if="!material" class="text-xs text-themed-muted">{{ t('managementGateway.materialUnavailable') }}</p>
        </section>
      </template>
      <section v-if="material" class="space-y-3" aria-live="polite">
        <h5 class="font-semibold text-themed">{{ t('managementGateway.recoveryMaterial') }}</h5>
        <p class="text-sm text-amber-700 dark:text-amber-300">{{ t('managementGateway.materialWarning') }}</p>
        <dl class="space-y-2 text-sm">
          <div><dt class="text-themed-muted">{{ t('managementGateway.gatewayUsername') }}</dt><dd class="font-mono text-themed break-all">{{ material.username }}</dd></div>
          <div><dt class="text-themed-muted">{{ t('managementGateway.gatewayPassword') }}</dt><dd class="font-mono text-themed break-all">{{ material.password }}</dd></div>
          <div><dt class="text-themed-muted">{{ t('managementGateway.authenticatorKey') }}</dt><dd class="font-mono text-themed break-all">{{ authenticatorKey }}</dd></div>
          <div><dt class="text-themed-muted">{{ t('managementGateway.recoveryCodes') }}</dt><dd class="font-mono text-themed break-all"><ul><li v-for="code in material.recoveryCodes" :key="code">{{ code }}</li></ul></dd></div>
        </dl>
        <div class="flex flex-wrap gap-3"><button type="button" class="btn-secondary" @click="downloadMaterial">{{ t('managementGateway.downloadMaterial') }}</button><button type="button" class="btn-secondary" @click="material = null">{{ t('managementGateway.savedMaterial') }}</button></div>
      </section>
    </section>
    <dialog ref="dialog" class="gateway-install-dialog" :aria-labelledby="`gateway-dialog-title-${gateway.id}`" :aria-describedby="`gateway-dialog-hint-${gateway.id}`" @close="dialogClosed" @cancel="busy && $event.preventDefault()">
      <form class="space-y-4" @submit.prevent="submitDialog">
        <h4 :id="`gateway-dialog-title-${gateway.id}`" class="text-lg font-semibold text-themed">{{ t(dialogAction === 'confirm' ? 'managementGateway.confirmInstall' : 'managementGateway.retrieveMaterial') }}</h4>
        <p :id="`gateway-dialog-hint-${gateway.id}`" class="text-sm text-themed-muted">{{ t(dialogAction === 'confirm' ? 'managementGateway.confirmHint' : 'managementGateway.retrieveHint') }}</p>
        <p class="text-xs text-themed-muted break-all">{{ gateway.name }} · {{ gateway.target.machineId }}</p>
        <p v-if="dialogError" :id="`gateway-dialog-error-${gateway.id}`" role="alert" class="text-sm text-red-700 dark:text-red-300">{{ dialogError }}</p>
        <fieldset :disabled="busy" class="space-y-3" :aria-describedby="dialogError ? `gateway-dialog-error-${gateway.id}` : undefined">
          <legend class="sr-only">{{ t('managementGateway.reauthenticate') }}</legend>
          <label class="block text-sm text-themed">{{ t('managementGateway.currentPassword') }}<input ref="passwordInput" v-model="password" type="password" required maxlength="256" autocomplete="off" class="input mt-1 w-full" /></label>
          <label class="block text-sm text-themed">{{ t('managementGateway.currentTotp') }}<input v-model="totpCode" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="off" class="input mt-1 w-full" /></label>
          <label v-if="dialogAction === 'confirm'" class="block text-sm text-themed">{{ t('managementGateway.confirmPhrase') }}<span class="block font-mono break-all mt-1">{{ expectedConfirmation }}</span><input v-model="confirmation" required autocomplete="off" maxlength="44" :pattern="expectedConfirmation" class="input mt-2 w-full font-mono" /></label>
        </fieldset>
        <div class="flex flex-wrap gap-3"><button type="submit" class="btn-primary" :disabled="busy">{{ t(busy ? 'managementGateway.submitting' : dialogAction === 'confirm' ? 'managementGateway.confirmInstall' : 'managementGateway.retrieveMaterial') }}</button><button type="button" class="btn-secondary" :disabled="busy" @click="closeDialog">{{ t('common.cancel') }}</button></div>
      </form>
    </dialog>
  </div>
</template>

<style scoped>
.gateway-install-dialog { width: min(36rem, calc(100% - 2rem)); max-height: calc(100dvh - 2rem); overflow-y: auto; padding: 1.5rem; border: 1px solid var(--border-color); border-radius: .75rem; background: var(--bg-primary); color: var(--text-primary); }
.gateway-install-dialog::backdrop { background: rgb(0 0 0 / .5); }
.gateway-installation summary { cursor: pointer; padding-block: .5rem; }
</style>
