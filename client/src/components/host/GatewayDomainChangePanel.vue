<script setup lang="ts">
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api/admin'
import { useAuthStore } from '@/stores/auth'
import type { GatewayDomainStatus } from '@/types/management-gateway'
const props = defineProps<{ gatewayId: string }>()
const { t, te } = useI18n(), auth = useAuthStore()
const status = ref<GatewayDomainStatus | null>(null), hostname = ref(''), password = ref(''), expected = ref('')
const busy = ref(false), loading = ref(true), error = ref(''), loadError = ref(''), notice = ref(''), open = ref(false)
const requestId = ref<string>(crypto.randomUUID())
let lastIntent = ''
const intent = () => JSON.stringify([props.gatewayId, expected.value, hostname.value.trim().toLowerCase()])
let active = true, disposed = false, sequence = 0, timer: ReturnType<typeof setTimeout> | undefined
const running = computed(() => ['queued', 'running', 'retrying'].includes(status.value?.state || ''))
const allowed = () => active && !disposed && auth.user?.role === 'admin' && !!auth.token
function message(code?: string | null) {
  const key = `gatewayEndpoint.change.errors.${code}`
  return code && te(key) ? t(key) : `${t('gatewayEndpoint.change.error')}${code ? ` (${code})` : ''}`
}
async function load(reset = false) {
  if (!allowed() || busy.value) return
  const target = props.gatewayId, authentication = auth.captureAuthentication(), request = ++sequence
  if (!authentication.aligned) return
  const current = () => allowed() && target === props.gatewayId && authentication.current() && request === sequence
  try {
    const value = await api.hostOnboarding.gatewayDomain(target)
    if (!current()) return
    status.value = value; loadError.value = ''
    if (reset || !open.value) { hostname.value = value.desiredHostname || value.hostname; expected.value = value.hostname }
  } catch { if (current()) loadError.value = t('gatewayEndpoint.change.loadFailed') }
  finally {
    if (current()) {
      loading.value = false; clearTimeout(timer)
      timer = setTimeout(() => { if (document.visibilityState === 'visible') void load(); else schedule() }, running.value ? 3000 : 15000)
    }
  }
}
function schedule() { clearTimeout(timer); if (allowed()) timer = setTimeout(() => void load(), 15000) }
async function save() {
  if (!allowed() || loading.value || busy.value || running.value || !status.value || !hostname.value.trim()) return
  const authentication = auth.captureAuthentication(), target = props.gatewayId, request = ++sequence
  if (!authentication.aligned) return
  if (lastIntent !== intent()) { requestId.value = crypto.randomUUID(); lastIntent = intent() }
  const input = { hostname: hostname.value.trim(), expectedHostname: expected.value, requestId: requestId.value,
    ...(status.value.credentialsRequired ? { credentials: { password: password.value } } : {}) }
  const current = () => allowed() && target === props.gatewayId && authentication.current() && request === sequence
  busy.value = true; clearTimeout(timer); error.value = ''; notice.value = ''
  try {
    const value = await api.hostOnboarding.changeGatewayDomain(target, input)
    if (!current()) return
    status.value = value; password.value = ''; notice.value = t('gatewayEndpoint.change.saved'); open.value = false
  } catch (failure) { if (current()) { error.value = message((failure as { code?: string }).code); password.value = '' } }
  finally { if (current()) { busy.value = false; void load() } }
}
function edit() {
  if (!status.value) return
  hostname.value = status.value.desiredHostname || status.value.hostname; expected.value = status.value.hostname
  requestId.value = status.value.state === 'failed' && status.value.requestId ? status.value.requestId : crypto.randomUUID()
  lastIntent = intent(); error.value = ''; notice.value = ''; open.value = true
}
function reset() { ++sequence; clearTimeout(timer); status.value = null; hostname.value = ''; expected.value = ''; password.value = ''; error.value = ''; loadError.value = ''; notice.value = ''; lastIntent = ''; requestId.value = crypto.randomUUID(); busy.value = false; loading.value = true; open.value = false; if (allowed()) void load(true) }
watch(() => [props.gatewayId, auth.user?.id, auth.user?.role, auth.token], reset)
onMounted(() => void load(true))
onActivated(() => { if (!active) { active = true; void load() } })
onDeactivated(() => { active = false; ++sequence; clearTimeout(timer); password.value = ''; busy.value = false })
onUnmounted(() => { disposed = true; ++sequence; clearTimeout(timer); password.value = '' })
</script>
<template>
  <section class="gateway-domain-change space-y-3" :aria-busy="busy || loading">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div><h5 class="text-sm font-medium text-themed">{{ t('gatewayEndpoint.change.title') }}</h5><p v-if="status" class="mt-1 text-sm text-themed-muted break-all">{{ t('gatewayEndpoint.change.current') }} · {{ status.hostname }}</p></div>
      <button v-if="!open" type="button" class="btn-secondary" :disabled="busy || loading || running || !status" @click="edit">{{ t(status?.state === 'failed' ? 'gatewayEndpoint.change.retry' : 'gatewayEndpoint.change.open') }}</button>
    </div>
    <p class="text-sm text-themed-muted">{{ t('gatewayEndpoint.change.consoleScope') }}</p>
    <form v-if="open && status" class="space-y-3" @submit.prevent="save">
      <label class="block text-sm text-themed">{{ t('gatewayEndpoint.change.next') }}<input v-model="hostname" required maxlength="253" autocomplete="off" class="input mt-2 w-full" :disabled="busy || running" /></label>
      <p class="text-sm text-themed-muted">{{ t('gatewayEndpoint.change.hint') }}</p>
      <template v-if="status.credentialsRequired"><p class="text-sm text-themed-muted">{{ t('gatewayEndpoint.change.credentials') }}</p><label class="block text-sm text-themed">{{ t('gatewayEndpoint.change.password') }}<input v-model="password" type="password" required maxlength="1024" autocomplete="off" class="input mt-2 w-full" :disabled="busy" /></label></template>
      <button type="submit" class="btn-primary" :disabled="busy || running || !hostname.trim() || (hostname.trim() === status.hostname && status.state !== 'failed')">{{ t(busy ? 'gatewayEndpoint.change.working' : 'gatewayEndpoint.change.apply') }}</button>
    </form>
    <p v-if="error || loadError" role="alert" class="text-sm text-red-700 dark:text-red-300">{{ error || loadError }}</p>
    <p v-if="notice" role="status" class="text-sm text-themed">{{ notice }}</p>
    <div v-if="status && status.state !== 'idle'" role="status" class="space-y-2">
      <p class="text-sm font-medium" :class="status.state === 'succeeded' ? 'text-green-800 dark:text-green-300' : status.state === 'failed' ? 'text-red-700 dark:text-red-300' : 'text-themed-muted'">{{ t(`gatewayEndpoint.change.states.${status.state}`) }}<template v-if="status.desiredHostname"> · {{ status.desiredHostname }}</template></p>
      <p v-if="status.errorCode" class="text-sm text-themed-muted">{{ message(status.errorCode) }}</p>
      <p v-if="status.attempt" class="text-sm text-themed-muted">{{ t('gatewayEndpoint.change.attempts', { count: status.attempt }) }}<template v-if="status.retryAt"> · {{ t('gatewayEndpoint.change.nextRetry', { time: new Date(status.retryAt).toLocaleString() }) }}</template></p>
      <p v-if="status.state !== 'succeeded'" class="text-sm text-themed-muted">{{ t('gatewayEndpoint.change.failures') }}</p>
    </div>
    <button v-if="error || loadError" type="button" class="btn-secondary" :disabled="busy" @click="load(true)">{{ t('gatewayEndpoint.change.refresh') }}</button>
  </section>
</template>
<style scoped>
button, input { min-height: 44px; }
:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }
.gateway-domain-change button { box-shadow: none !important; transition: none !important; }
.gateway-domain-change .btn-primary { background: #111 !important; color: #fff !important; }
:global(.dark .gateway-domain-change .btn-primary) { background: #fff !important; color: #111 !important; }
.gateway-domain-change .btn-primary::before { display: none !important; }
:global(.dark .gateway-domain-change .text-themed-muted) { color: #a3a3a3 !important; }
</style>
