<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api'
import { useAuthStore } from '@/stores/auth'

const props = defineProps<{ instanceIds: number[]; disabled?: boolean }>()
const code = defineModel<string>({ default: '' })
const { t } = useI18n(), auth = useAuthStore(), inputId = useId()
const sending = ref(false), error = ref(''), sentTo = ref(''), remaining = ref(0)
let timer: ReturnType<typeof setInterval> | null = null
let generation = 0, alive = true
const session = computed(() => {
  if (!auth.user || !auth.token) return ''
  let identity = auth.token
  try { const payload = JSON.parse(atob(identity.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); identity = payload.sid || identity } catch { /* Retain legacy token identity. */ }
  return `${auth.user.id}:${auth.user.role}:${auth.user.email || ''}:${identity}`
})
const targets = computed(() => JSON.stringify([...props.instanceIds].sort((a, b) => a - b)))
const maskedEmail = computed(() => {
  const email = auth.user?.email
  if (!email) return ''
  const [local, domain] = email.split('@')
  return `${local.slice(0, 2)}***@${domain}`
})
function reset() {
  generation++; code.value = ''; error.value = ''; sentTo.value = ''; sending.value = false; remaining.value = 0
  if (timer) clearInterval(timer)
  timer = null
}
watch([session, targets], reset, { flush: 'sync' })
onBeforeUnmount(() => { alive = false; reset() })
async function send() {
  if (!alive || !session.value || sending.value || props.disabled || remaining.value > 0 || !maskedEmail.value || !props.instanceIds.length) return
  const currentGeneration = generation, currentSession = session.value, currentTargets = targets.value
  const current = () => alive && currentGeneration === generation && currentSession === session.value && currentTargets === targets.value
  sending.value = true; error.value = ''; code.value = ''
  try {
    const result = await api.billing.requestDestroyVerification([...props.instanceIds])
    if (!current()) return
    if (result.success !== true || (result.channel !== undefined && result.channel !== 'email') ||
      typeof result.maskedTarget !== 'string' || !result.maskedTarget.trim() ||
      !Number.isInteger(result.resendAfter) || result.resendAfter < 1 || result.resendAfter > 600) throw new Error(t('instance.destroy.emailSendFailed'))
    sentTo.value = result.maskedTarget
    const deadline = Date.now() + result.resendAfter * 1000
    remaining.value = result.resendAfter
    if (timer) clearInterval(timer)
    timer = setInterval(() => {
      remaining.value = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
      if (remaining.value === 0 && timer) { clearInterval(timer); timer = null }
    }, 1000)
  } catch (err: any) {
    if (current()) error.value = err?.code === 'SEND_FAILED' ? t('instance.destroy.emailSendFailed') : err?.message || t('instance.destroy.emailSendFailed')
  } finally { if (current()) sending.value = false }
}
</script>

<template>
  <div class="destroy-email-fields space-y-3" data-destroy-email>
    <div>
      <label :for="inputId" class="block text-sm font-medium text-themed">{{ t('instance.destroy.emailCodeLabel') }}</label>
      <p :id="inputId + '-hint'" class="mt-1 text-sm leading-relaxed text-themed-muted">
        {{ maskedEmail ? t('instance.destroy.emailCodeHint', { email: maskedEmail }) : t('instance.destroy.emailMissing') }}
      </p>
    </div>
    <div class="flex flex-col gap-2 sm:flex-row">
      <input
        :id="inputId" v-model="code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6"
        :disabled="disabled || sending || !maskedEmail" :aria-describedby="inputId + '-hint'"
        class="input min-h-11 min-w-0 flex-1 text-base tabular-nums"
        :placeholder="t('sensitiveVerification.codePlaceholder')"
      />
      <button type="button" class="btn-secondary min-h-11 shrink-0" :disabled="disabled || sending || remaining > 0 || !maskedEmail" @click="send">
        {{ sending ? t('sensitiveVerification.sendingCode') : remaining > 0 ? t('sensitiveVerification.resendIn', { seconds: remaining }) : sentTo ? t('sensitiveVerification.resendCode') : t('sensitiveVerification.sendCode') }}
      </button>
    </div>
    <p v-if="sentTo" role="status" class="text-sm leading-relaxed text-themed-muted">{{ t('instance.destroy.emailSent', { email: sentTo }) }}</p>
    <p v-if="error" role="alert" class="text-sm leading-relaxed text-red-600 dark:text-red-400">{{ error }}</p>
  </div>
</template>

<style>
.destroy-email-fields .text-themed-muted { color: #525252 !important; }
.destroy-email-fields .input::placeholder { color: #525252 !important; }
.dark .destroy-email-fields .text-themed-muted,
.dark .destroy-email-fields .input::placeholder { color: #b4b4b4 !important; }
</style>
