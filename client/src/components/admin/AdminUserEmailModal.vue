<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api/admin'
import { useAuthStore } from '@/stores/auth'
import type { AdminUserEmailSnapshot } from '@/types/admin-user-email'
const props = defineProps<{ userId: number; username: string; sessionKey: string }>()
const emit = defineEmits<{ close: []; changed: [value: AdminUserEmailSnapshot] }>()
const { t, te } = useI18n(), auth = useAuthStore()
const dialog = ref<HTMLDialogElement | null>(null), input = ref<HTMLInputElement | null>(null)
const snapshot = ref<AdminUserEmailSnapshot | null>(null), value = ref(''), errorCode = ref('')
const loading = ref(false), saving = ref(false), mustReload = ref(false)
const normalized = computed(() => value.value.trim().toLowerCase())
const dirty = computed(() => !!normalized.value && normalized.value !== snapshot.value?.email?.trim().toLowerCase())
const error = computed(() => t(te(`adminUserEmail.errors.${errorCode.value}`) ? `adminUserEmail.errors.${errorCode.value}` : 'adminUserEmail.errors.ADMIN_EMAIL_FAILED'))
let alive = true, generation = 0, controller: AbortController | undefined
const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
function context() {
  controller?.abort(); controller = new AbortController()
  const session = auth.captureAuthentication(), id = props.userId, version = ++generation
  const current = () => alive && version === generation && id === props.userId &&
    !!auth.token && auth.isAdmin && auth.user?.id !== id && session.aligned && session.current()
  return { id, signal: controller.signal, current, finish: () => {
    // A stale response must not leave the old dialog permanently stuck saving.
    // A newer request owns its own flags; never clear or close that request here.
    if (!alive || version !== generation) return
    loading.value = false; saving.value = false
    if (!current()) emit('close')
  } }
}
function matches(result: AdminUserEmailSnapshot) {
  return result?.userId === props.userId && result.username === props.username && /^[a-f0-9]{64}$/.test(result.revision) &&
    (result.email === null || typeof result.email === 'string')
}
function codeOf(error: unknown) {
  const response = error as { code?: string; response?: { data?: { code?: string } } }
  const code = response?.code || response?.response?.data?.code || 'ADMIN_EMAIL_FAILED'
  return ['ADMIN_REQUIRED', 'UNAUTHORIZED', 'SESSION_INVALIDATED', 'ACCOUNT_BANNED', 'AUTHENTICATION_STATE_CHANGED'].includes(code) ? 'ADMIN_EMAIL_FORBIDDEN' : code
}
function close() { if (!saving.value) emit('close') }
async function load() {
  const request = context(); if (!request.current()) { request.finish(); return }
  snapshot.value = null; value.value = ''; errorCode.value = ''; loading.value = true; mustReload.value = false
  try {
    const result = await api.users.getEmail(request.id, request.signal)
    if (!matches(result)) throw new Error('Invalid email snapshot')
    if (request.current()) snapshot.value = result
  } catch (error) { if (request.current()) errorCode.value = codeOf(error) }
  finally { request.finish(); if (request.current()) { await nextTick(); if (request.current()) input.value?.focus() } }
}
async function save() {
  if (loading.value || saving.value || !snapshot.value || !dirty.value || mustReload.value) return
  if (!input.value?.checkValidity()) { input.value?.reportValidity(); return }
  const request = context(); if (!request.current()) { request.finish(); return }
  const email = normalized.value
  saving.value = true; errorCode.value = ''
  try {
    const result = await api.users.setEmail(request.id, { email, revision: snapshot.value.revision }, request.signal)
    if (!matches(result) || result.email !== email) throw new Error('Invalid email receipt')
    if (request.current()) { emit('changed', result); emit('close') }
  } catch (error) {
    if (request.current()) {
      errorCode.value = codeOf(error)
      mustReload.value = !['ADMIN_EMAIL_INVALID', 'ADMIN_EMAIL_TAKEN', 'ADMIN_EMAIL_DOMAIN', 'ADMIN_EMAIL_UNCHANGED'].includes(errorCode.value)
    }
  } finally { request.finish() }
}
watch(() => [props.userId, props.username, props.sessionKey, auth.user?.role], () => {
  generation++; controller?.abort(); snapshot.value = null; value.value = ''; emit('close')
}, { flush: 'sync' })
onMounted(() => { dialog.value?.showModal(); void load() })
onBeforeUnmount(() => { alive = false; generation++; controller?.abort(); dialog.value?.close(); if (previousFocus?.isConnected) previousFocus.focus() })
</script>

<template>
  <Teleport to="body">
    <dialog ref="dialog" class="email-dialog text-themed" aria-labelledby="email-title" aria-describedby="email-description" @cancel.prevent="close">
      <form class="p-5 sm:p-6 space-y-5" :aria-busy="loading || saving" @submit.prevent="save">
        <header><h2 id="email-title" class="text-lg font-semibold">{{ t('adminUserEmail.title') }}</h2><p class="mt-1 text-sm text-themed-muted break-all">{{ username }} · #{{ userId }}</p></header>
        <p id="email-description" class="text-sm text-themed-muted">{{ t('adminUserEmail.description') }}</p>
        <p v-if="loading" role="status" class="text-sm">{{ t('adminUserEmail.loading') }}</p>
        <template v-if="snapshot">
          <dl class="text-sm space-y-1"><dt class="text-themed-muted">{{ t('adminUserEmail.current') }}</dt><dd class="break-all">{{ snapshot.email || t('adminUserEmail.none') }}</dd></dl>
          <div><label for="admin-email-input" class="block text-sm font-medium mb-2">{{ t('adminUserEmail.next') }}</label>
            <input id="admin-email-input" ref="input" v-model="value" type="email" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="254" required class="input w-full min-h-11" :disabled="saving || mustReload" aria-describedby="email-effect" />
          </div>
          <p id="email-effect" class="text-sm text-themed-muted">{{ t('adminUserEmail.effect') }}</p>
        </template>
        <div v-if="errorCode" class="text-sm space-y-2"><p role="alert" class="text-rose-700 dark:text-rose-300">{{ error }}</p>
          <button v-if="mustReload || !snapshot" type="button" class="email-secondary min-h-11" :disabled="loading || saving" @click="load">{{ t('adminUserEmail.retry') }}</button>
        </div>
        <footer class="flex justify-end flex-wrap gap-3">
          <button type="button" class="email-secondary min-h-11" :disabled="saving" @click="close">{{ t('adminUserEmail.cancel') }}</button>
          <button type="submit" class="email-save min-h-11" :disabled="loading || saving || !snapshot || !dirty || mustReload">{{ t(saving ? 'adminUserEmail.saving' : 'adminUserEmail.save') }}</button>
        </footer>
      </form>
    </dialog>
  </Teleport>
</template>

<style scoped>
.email-dialog { --email-bg: #fff; --email-ink: #171717; --email-muted: #606060; --email-border: #d4d4d4; --email-disabled: #f5f5f5; width: min(30rem, calc(100vw - 2rem)); max-height: calc(100dvh - 2rem); margin: auto; padding: 0; border: 1px solid var(--email-border); border-radius: 1rem; background: var(--email-bg); color: var(--email-ink); overflow-y: auto; }
.email-dialog::backdrop { background: rgb(0 0 0 / 45%); }
:global(.dark .email-dialog) { --email-bg: #171717; --email-ink: #fafafa; --email-muted: #b4b4b4; --email-border: #525252; --email-disabled: #262626; color-scheme: dark; }
.email-dialog :is(button, input):focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }
.email-dialog .input:focus { border-color: currentColor; box-shadow: none; }
.email-dialog .input { background: var(--email-bg); color: var(--email-ink); border-color: var(--email-border); }
.email-dialog button { padding: .5rem 1rem; border-radius: .5rem; font-size: .875rem; font-weight: 500; border: 1px solid var(--email-border); }
.email-dialog .email-save { background: var(--email-ink); color: var(--email-bg); border-color: var(--email-ink); }
.email-dialog .email-secondary { background: var(--email-bg); color: var(--email-ink); }
.email-dialog button:disabled { background: var(--email-disabled); color: var(--email-muted); border-color: var(--email-border); cursor: not-allowed; }
.email-dialog .text-themed-muted { color: var(--email-muted); }
</style>
