<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api/admin'
import { useAuthStore } from '@/stores/auth'
import type { InstanceExpirySnapshot } from '@/types/instance-expiry'
import { expiryLocalInput, expiryUtcInput } from '@/utils/instance-expiry-date'

const props = defineProps<{ instanceId: number; instanceName: string; sessionKey: string; ownerId: number | undefined; hostId: number | undefined; incusId: string | undefined }>()
const emit = defineEmits<{ close: []; changed: [] }>()
const { t, te, locale } = useI18n()
const auth = useAuthStore()
const dialog = ref<HTMLDialogElement | null>(null)
const input = ref<HTMLInputElement | null>(null)
const snapshot = ref<InstanceExpirySnapshot | null>(null)
const value = ref(''), errorCode = ref('')
const busy = ref(false), saving = ref(false), mustReload = ref(false)
const zone = ref(Intl.DateTimeFormat().resolvedOptions().timeZone)
const target = computed(() => expiryUtcInput(value.value))
const timezone = computed(() => {
  const offset = new Intl.DateTimeFormat('en', { timeZone: zone.value, timeZoneName: 'shortOffset' }).formatToParts(new Date(target.value || snapshot.value?.expiresAt || Date.now())).find(part => part.type === 'timeZoneName')?.value
  return `${zone.value} (${offset})`
})
const past = computed(() => target.value !== null && Date.parse(target.value) <= Date.now())
const dirty = computed(() => snapshot.value !== null && target.value !== expiryUtcInput(expiryLocalInput(snapshot.value.expiresAt)))
const error = computed(() => t(te(`instanceExpiry.errors.${errorCode.value}`) ? `instanceExpiry.errors.${errorCode.value}` : 'instanceExpiry.errors.EXPIRY_SAVE_FAILED'))
const currentDate = computed(() => snapshot.value ? new Date(snapshot.value.expiresAt).toLocaleString(locale.value, {
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
}) : '—')
let alive = true, generation = 0
let controller: AbortController | undefined
const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
function context() {
  controller?.abort(); controller = new AbortController()
  const session = auth.captureAuthentication(), id = props.instanceId, version = ++generation
  const ownerId = props.ownerId, hostId = props.hostId, incusId = props.incusId
  return { id, signal: controller.signal, current: () => alive && version === generation && id === props.instanceId &&
    ownerId === props.ownerId && hostId === props.hostId && incusId === props.incusId &&
    !!auth.token && auth.isAdmin && session.aligned && session.current() }
}
function matchesTarget(result: InstanceExpirySnapshot) {
  return result.instanceId === props.instanceId && result.ownerId === props.ownerId &&
    result.hostId === props.hostId && result.incusId === props.incusId
}
function failureCode(error: unknown): string {
  const response = error as { code?: string; response?: { data?: { code?: string } } }
  const code = response?.code || response?.response?.data?.code || 'EXPIRY_SAVE_FAILED'
  return ['ADMIN_REQUIRED', 'UNAUTHORIZED', 'SESSION_INVALIDATED', 'ACCOUNT_BANNED', 'AUTHENTICATION_STATE_CHANGED'].includes(code) ? 'EXPIRY_ADMIN_REQUIRED' : code
}
function close() { if (!saving.value) emit('close') }
async function load() {
  const request = context()
  if (!request.current()) return
  snapshot.value = null; value.value = ''; errorCode.value = ''; busy.value = true; mustReload.value = false
  try {
    const result = await api.admin.getInstanceExpiry(request.id, request.signal)
    if (!matchesTarget(result)) throw { code: 'EXPIRY_CHANGED' }
    if (!/^[a-f0-9]{64}$/.test(result.revision) || !expiryLocalInput(result.expiresAt)) throw new Error('Invalid expiry response')
    if (request.current()) { zone.value = Intl.DateTimeFormat().resolvedOptions().timeZone; snapshot.value = result; value.value = expiryLocalInput(result.expiresAt) }
  } catch (error) { if (request.current()) errorCode.value = failureCode(error) }
  finally { if (request.current()) { busy.value = false; await nextTick(); if (request.current()) input.value?.focus() } }
}
async function save() {
  if (busy.value || saving.value || !snapshot.value || !dirty.value || mustReload.value) return
  if (zone.value !== Intl.DateTimeFormat().resolvedOptions().timeZone) { errorCode.value = 'EXPIRY_TIMEZONE_CHANGED'; mustReload.value = true; return }
  if (!target.value) { errorCode.value = 'EXPIRY_INVALID_DATE'; return }
  const request = context()
  if (!request.current()) return
  saving.value = true; errorCode.value = ''
  try {
    const expiresAt = target.value
    const result = await api.admin.setInstanceExpiry(request.id, { expiresAt, revision: snapshot.value.revision }, request.signal)
    if (!matchesTarget(result) || result.expiresAt !== expiresAt) throw new Error('Invalid expiry receipt')
    if (request.current()) { emit('changed'); emit('close') }
  } catch (error) {
    if (request.current()) { errorCode.value = failureCode(error); mustReload.value = true }
  } finally { if (request.current()) saving.value = false }
}
watch(() => [props.instanceId, props.ownerId, props.hostId, props.incusId, props.sessionKey, auth.user?.role], () => {
  generation++; controller?.abort(); snapshot.value = null; value.value = ''; errorCode.value = ''; emit('close')
}, { flush: 'sync' })
onMounted(() => { dialog.value?.showModal(); void load() })
onBeforeUnmount(() => {
  alive = false; generation++; controller?.abort(); dialog.value?.close()
  if (previousFocus?.isConnected) previousFocus.focus()
})
</script>

<template>
  <Teleport to="body">
    <dialog ref="dialog" class="expiry-dialog text-themed" aria-labelledby="expiry-title" aria-describedby="expiry-description" @cancel.prevent="close">
      <form class="p-5 sm:p-6 space-y-5" :aria-busy="busy || saving" @submit.prevent="save">
        <header>
          <h2 id="expiry-title" class="text-lg font-semibold">{{ t('instanceExpiry.title') }}</h2>
          <p class="mt-1 text-sm text-themed-muted break-all">{{ instanceName }} · #{{ instanceId }}</p>
        </header>
        <p id="expiry-description" class="text-sm text-themed-muted">{{ t('instanceExpiry.description') }}</p>
        <p v-if="busy" class="text-sm" role="status">{{ t('instanceExpiry.loading') }}</p>
        <template v-if="snapshot">
          <dl class="text-sm space-y-1"><dt class="text-themed-muted">{{ t('instanceExpiry.current') }}</dt><dd class="tabular-nums">{{ currentDate }}</dd></dl>
          <div>
            <label for="expiry-input" class="block text-sm font-medium mb-2">{{ t('instanceExpiry.next') }}</label>
            <input id="expiry-input" ref="input" v-model="value" class="input w-full min-h-11" type="datetime-local" step="1" min="2000-01-01T00:00:00" max="9999-12-31T23:59:59" required :disabled="busy || saving || mustReload" :aria-invalid="!!value && !target" aria-describedby="expiry-timezone expiry-effect expiry-invalid" />
            <p id="expiry-timezone" class="mt-2 text-xs text-themed-muted break-words">{{ t('instanceExpiry.timezone', { zone: timezone }) }}</p>
            <p v-if="value && !target" id="expiry-invalid" class="mt-2 text-sm text-rose-700 dark:text-rose-300" role="alert">{{ t('instanceExpiry.errors.EXPIRY_INVALID_DATE') }}</p>
          </div>
          <p id="expiry-effect" class="text-sm text-themed-muted">{{ t('instanceExpiry.effect') }}</p>
          <p v-if="past" class="text-sm text-amber-800 dark:text-amber-300">{{ t('instanceExpiry.past') }}</p>
        </template>
        <div v-if="errorCode" class="text-sm space-y-2">
          <p class="text-rose-700 dark:text-rose-300" role="alert">{{ error }}</p>
          <button type="button" class="expiry-secondary min-h-11" :disabled="busy || saving" @click="load">{{ t('instanceExpiry.retry') }}</button>
        </div>
        <footer class="flex justify-end flex-wrap gap-3">
          <button type="button" class="expiry-secondary min-h-11" :disabled="saving" @click="close">{{ t('instanceExpiry.cancel') }}</button>
          <button type="submit" class="expiry-save min-h-11" :disabled="busy || saving || !snapshot || !dirty || !target || mustReload">{{ t(saving ? 'instanceExpiry.saving' : 'instanceExpiry.save') }}</button>
        </footer>
      </form>
    </dialog>
  </Teleport>
</template>

<style scoped>
.expiry-dialog { --expiry-bg: #fff; --expiry-ink: #171717; --expiry-muted: #606060; --expiry-border: #d4d4d4; --expiry-disabled: #f5f5f5; width: min(30rem, calc(100vw - 2rem)); max-height: calc(100dvh - 2rem); margin: auto; padding: 0; border: 1px solid var(--expiry-border); border-radius: 1rem; background: var(--expiry-bg); color: var(--expiry-ink); overflow-y: auto; }
.expiry-dialog::backdrop { background: rgb(0 0 0 / 45%); }
:global(.dark .expiry-dialog) { --expiry-bg: #171717; --expiry-ink: #fafafa; --expiry-muted: #b4b4b4; --expiry-border: #525252; --expiry-disabled: #262626; color-scheme: dark; }
.expiry-dialog :is(button, input):focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }
.expiry-dialog .input:focus { border-color: currentColor; box-shadow: none; }
.expiry-dialog .input { background: var(--expiry-bg); color: var(--expiry-ink); border-color: var(--expiry-border); }
.expiry-dialog button { padding: 0.5rem 1rem; border-radius: 0.5rem; font-size: 0.875rem; font-weight: 500; border: 1px solid var(--expiry-border); }
.expiry-dialog .expiry-save { background: var(--expiry-ink); color: var(--expiry-bg); border-color: var(--expiry-ink); }
.expiry-dialog .expiry-secondary { background: var(--expiry-bg); color: var(--expiry-ink); }
.expiry-dialog button:disabled { background: var(--expiry-disabled); color: var(--expiry-muted); border-color: var(--expiry-border); cursor: not-allowed; }
.expiry-dialog .text-themed-muted { color: var(--expiry-muted); }
</style>
