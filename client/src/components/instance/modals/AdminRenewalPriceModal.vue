<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api/admin'
import { useAuthStore } from '@/stores/auth'
import type { InstanceRenewalPriceSnapshot } from '@/types/instance-renewal-price'

const props = defineProps<{ instanceId: number; instanceName: string; sessionKey: string; ownerId: number | undefined; hostId: number | undefined; incusId: string | undefined }>()
const emit = defineEmits<{ close: []; changed: [] }>()
const { t, te } = useI18n()
const auth = useAuthStore()
const dialog = ref<HTMLDialogElement | null>(null)
const input = ref<HTMLInputElement | null>(null)
const heading = ref<HTMLElement | null>(null)
const snapshot = ref<InstanceRenewalPriceSnapshot | null>(null)
const value = ref(''), errorCode = ref('')
const busy = ref(false), saving = ref(false), mustReload = ref(false)
const target = computed(() => /^(?:0|[1-9]\d{0,5})(?:\.\d{1,2})?$/.test(value.value) && Number(value.value) <= 100000 ? Number(value.value).toFixed(2) : null)
const dirty = computed(() => snapshot.value !== null && (target.value !== snapshot.value.price || !snapshot.value.final))
const error = computed(() => t(te(`instanceRenewalPrice.errors.${errorCode.value}`) ? `instanceRenewalPrice.errors.${errorCode.value}` : 'instanceRenewalPrice.errors.RENEWAL_PRICE_SAVE_FAILED'))
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
function matchesTarget(result: InstanceRenewalPriceSnapshot) {
  return result.instanceId === props.instanceId && result.ownerId === props.ownerId &&
    result.hostId === props.hostId && result.incusId === props.incusId
}
function failureCode(error: unknown): string {
  const response = error as { code?: string; response?: { data?: { code?: string } } }
  const code = response?.code || response?.response?.data?.code || 'RENEWAL_PRICE_SAVE_FAILED'
  return ['ADMIN_REQUIRED', 'UNAUTHORIZED', 'SESSION_INVALIDATED', 'ACCOUNT_BANNED', 'AUTHENTICATION_STATE_CHANGED'].includes(code) ? 'RENEWAL_PRICE_ADMIN_REQUIRED' : code
}
function close() { if (!saving.value) emit('close') }
function onDialogKeydown(event: KeyboardEvent) {
  if (event.key !== 'Tab' || !dialog.value) return
  const controls = [...dialog.value.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]')]
    .filter(control => control.getClientRects().length > 0)
  const first = controls[0], last = controls.at(-1)
  if (!first || !last) { event.preventDefault(); heading.value?.focus(); return }
  if (event.shiftKey && (document.activeElement === first || !controls.includes(document.activeElement as HTMLElement))) {
    event.preventDefault(); last.focus()
  } else if (!event.shiftKey && (document.activeElement === last || !controls.includes(document.activeElement as HTMLElement))) {
    event.preventDefault(); first.focus()
  }
}
async function load() {
  const request = context()
  if (!request.current()) return
  snapshot.value = null; value.value = ''; errorCode.value = ''; busy.value = true; mustReload.value = false
  try {
    const result = await api.admin.getInstanceRenewalPrice(request.id, request.signal)
    if (!matchesTarget(result)) throw { code: 'RENEWAL_PRICE_CHANGED' }
    if (!/^[a-f0-9]{64}$/.test(result.revision) || !/^(?:0|[1-9]\d{0,5})\.\d{2}$/.test(result.price) || Number(result.price) > 100000 || typeof result.final !== 'boolean' || !Number.isSafeInteger(result.billingCycle) || result.billingCycle < 1 || result.billingCycle > 24) throw new Error('Invalid renewal price response')
    if (request.current()) { snapshot.value = result; value.value = result.price }
  } catch (error) { if (request.current()) errorCode.value = failureCode(error) }
  finally { if (request.current()) { busy.value = false; await nextTick(); if (request.current()) input.value?.focus() } }
}
async function save() {
  if (busy.value || saving.value || !snapshot.value || !dirty.value || mustReload.value) return
  if (!target.value) { errorCode.value = 'RENEWAL_PRICE_INVALID'; return }
  const request = context()
  if (!request.current()) return
  saving.value = true; errorCode.value = ''
  try {
    const price = target.value, cycle = snapshot.value.billingCycle
    const result = await api.admin.setInstanceRenewalPrice(request.id, { price, revision: snapshot.value.revision }, request.signal)
    if (!matchesTarget(result) || result.price !== price || result.final !== true || result.billingCycle !== cycle ||
      !/^[a-f0-9]{64}$/.test(result.revision)) throw new Error('Invalid renewal price receipt')
    if (request.current()) { emit('changed'); emit('close') }
  } catch (error) {
    if (request.current()) { errorCode.value = failureCode(error); mustReload.value = true }
  } finally { if (request.current()) saving.value = false }
}
watch(() => [props.instanceId, props.ownerId, props.hostId, props.incusId, props.sessionKey, auth.user?.role], () => {
  generation++; controller?.abort(); snapshot.value = null; value.value = ''; errorCode.value = ''; emit('close')
}, { flush: 'sync' })
onMounted(() => { dialog.value?.showModal(); heading.value?.focus({ preventScroll: true }); void load() })
onBeforeUnmount(() => {
  alive = false; generation++; controller?.abort(); dialog.value?.close()
  if (previousFocus?.isConnected) previousFocus.focus()
})
</script>

<template>
  <Teleport to="body">
    <dialog ref="dialog" class="renewal-price-dialog text-themed" aria-labelledby="renewal-price-title" aria-describedby="renewal-price-description" @cancel.prevent="close" @keydown="onDialogKeydown">
      <form class="p-5 sm:p-6 space-y-5" :aria-busy="busy || saving" @submit.prevent="save">
        <header>
          <h2 id="renewal-price-title" ref="heading" tabindex="-1" class="text-lg font-semibold outline-none">{{ t('instanceRenewalPrice.title') }}</h2>
          <p class="mt-1 text-sm text-themed-muted break-all">{{ instanceName }} · #{{ instanceId }}</p>
        </header>
        <p id="renewal-price-description" class="text-sm text-themed-muted">{{ t('instanceRenewalPrice.description') }}</p>
        <p v-if="busy" class="text-sm" role="status">{{ t('instanceRenewalPrice.loading') }}</p>
        <template v-if="snapshot">
          <dl class="text-sm space-y-1"><dt class="text-themed-muted">{{ t('instanceRenewalPrice.current') }}</dt><dd class="tabular-nums text-base font-semibold">¥{{ snapshot.price }} <span class="text-sm font-normal text-themed-muted">/ {{ t('instanceRenewalPrice.cycle', { months: snapshot.billingCycle }) }}</span></dd></dl>
          <p v-if="!snapshot.final" class="text-xs text-themed-muted">{{ t('instanceRenewalPrice.base') }}</p>
          <div>
            <label for="renewal-price-input" class="block text-sm font-medium mb-2">{{ t('instanceRenewalPrice.next') }}</label>
            <input id="renewal-price-input" ref="input" v-model="value" class="input w-full min-h-11 tabular-nums" type="text" inputmode="decimal" maxlength="9" required autocomplete="off" :disabled="busy || saving || mustReload" :aria-invalid="!!value && !target" aria-describedby="renewal-price-effect renewal-price-invalid" />
            <p v-if="value && !target" id="renewal-price-invalid" class="mt-2 text-sm text-rose-700 dark:text-rose-300" role="alert">{{ t('instanceRenewalPrice.errors.RENEWAL_PRICE_INVALID') }}</p>
          </div>
          <p id="renewal-price-effect" class="text-sm text-themed-muted">{{ t('instanceRenewalPrice.effect') }}</p>
          <p v-if="target === '0.00'" class="text-sm text-amber-800 dark:text-amber-300">{{ t('instanceRenewalPrice.zero') }}</p>
        </template>
        <div v-if="errorCode" class="text-sm space-y-2">
          <p class="text-rose-700 dark:text-rose-300" role="alert">{{ error }}</p>
          <button type="button" class="renewal-price-secondary min-h-11" :disabled="busy || saving" @click="load">{{ t('instanceRenewalPrice.retry') }}</button>
        </div>
        <footer class="flex justify-end flex-wrap gap-3">
          <button type="button" class="renewal-price-secondary min-h-11" :disabled="saving" @click="close">{{ t('instanceRenewalPrice.cancel') }}</button>
          <button type="submit" class="renewal-price-save min-h-11" :disabled="busy || saving || !snapshot || !dirty || !target || mustReload">{{ t(saving ? 'instanceRenewalPrice.saving' : 'instanceRenewalPrice.save') }}</button>
        </footer>
      </form>
    </dialog>
  </Teleport>
</template>

<style scoped>
.renewal-price-dialog { --renewal-price-bg: #fff; --renewal-price-ink: #171717; --renewal-price-muted: #606060; --renewal-price-border: #d4d4d4; --renewal-price-disabled: #f5f5f5; width: min(30rem, calc(100vw - 2rem)); max-height: calc(100dvh - 2rem); margin: auto; padding: 0; border: 1px solid var(--renewal-price-border); border-radius: 1rem; background: var(--renewal-price-bg); color: var(--renewal-price-ink); overflow-y: auto; }
.renewal-price-dialog::backdrop { background: rgb(0 0 0 / 45%); }
:global(.dark .renewal-price-dialog) { --renewal-price-bg: #171717; --renewal-price-ink: #fafafa; --renewal-price-muted: #b4b4b4; --renewal-price-border: #525252; --renewal-price-disabled: #262626; color-scheme: dark; }
.renewal-price-dialog :is(button, input):focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }
.renewal-price-dialog .input:focus { border-color: currentColor; box-shadow: none; }
.renewal-price-dialog .input { background: var(--renewal-price-bg); color: var(--renewal-price-ink); border-color: var(--renewal-price-border); }
.renewal-price-dialog button { padding: 0.5rem 1rem; border-radius: 0.5rem; font-size: 0.875rem; font-weight: 500; border: 1px solid var(--renewal-price-border); }
.renewal-price-dialog .renewal-price-save { background: var(--renewal-price-ink); color: var(--renewal-price-bg); border-color: var(--renewal-price-ink); }
.renewal-price-dialog .renewal-price-secondary { background: var(--renewal-price-bg); color: var(--renewal-price-ink); }
.renewal-price-dialog button:disabled { background: var(--renewal-price-disabled); color: var(--renewal-price-muted); border-color: var(--renewal-price-border); cursor: not-allowed; }
.renewal-price-dialog .text-themed-muted { color: var(--renewal-price-muted); }
</style>
