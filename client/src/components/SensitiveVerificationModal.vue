<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount, nextTick, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { useThemeStore } from '@/stores/theme'
import api from '@/api'
import { useToast } from '@/stores/toast'
import { useAuthStore } from '@/stores/auth'

const { t } = useI18n()
const themeStore = useThemeStore()
const toast = useToast()
const authStore = useAuthStore()
const sessionKey = computed(() => {
  if (!authStore.token || !authStore.user) return ''
  let identity = authStore.token
  try {
    const payload = JSON.parse(atob(identity.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    if (typeof payload.sid === 'string') identity = payload.sid
  } catch { /* Legacy tokens retain their full identity. */ }
  return `${authStore.user.id}:${authStore.user.role}:${identity}`
})

interface Props {
  show: boolean
  operationType: string
  resourceId?: number
  onSuccess?: () => void
}

const props = defineProps<Props>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'verified'): void
}>()

// 状态
const step = ref<'request' | 'verify'>('request')
const loading = ref(false)
const verificationCode = ref('')
const channel = ref<'email' | 'telegram' | 'discord' | 'webhook' | null>(null)
const target = ref<string | null>(null)
const expiresAt = ref<string | null>(null)
const countdown = ref(0)
const error = ref('')
const dialog = ref<HTMLElement | null>(null)
const dialogId = useId()
let returnFocus: HTMLElement | null = null
watch(() => props.show, async show => {
  if (props.operationType !== 'disable_2fa') return
  if (show) {
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    await nextTick()
    if (props.show) dialog.value?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true })
  } else {
    const previous = returnFocus
    returnFocus = null
    await nextTick()
    if (!props.show && previous?.isConnected) previous.focus({ preventScroll: true })
  }
}, { flush: 'sync' })
function handleDialogKey(event: KeyboardEvent) {
  if (props.operationType !== 'disable_2fa') return
  if (event.key === 'Escape') { event.preventDefault(); close(); return }
  if (event.key !== 'Tab') return
  const controls = Array.from(dialog.value?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]') || [])
  const first = controls[0], last = controls.at(-1)
  if (!first) { event.preventDefault(); dialog.value?.focus(); return }
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}

let countdownTimer: ReturnType<typeof setInterval> | null = null
let alive = true
let active = false
let generation = 0
function captureContext() {
  const currentGeneration = generation, session = sessionKey.value
  const operationType = props.operationType, resourceId = props.resourceId
  return { operationType, resourceId, current: () => alive && active && props.show && !!session &&
    session === sessionKey.value && currentGeneration === generation &&
    operationType === props.operationType && resourceId === props.resourceId }
}

// 操作类型显示名称
const operationName = computed(() => {
  const names: Record<string, string> = {
    delete_instance: t('sensitiveVerification.operationTypes.delete_instance'),
    reinstall_instance: t('sensitiveVerification.operationTypes.reinstall_instance'),
    transfer_instance: t('sensitiveVerification.operationTypes.transfer_instance'),
    delete_snapshot: t('sensitiveVerification.operationTypes.delete_snapshot'),
    delete_backup: t('sensitiveVerification.operationTypes.delete_backup'),
    change_password: t('sensitiveVerification.operationTypes.change_password'),
    disable_2fa: t('sensitiveVerification.operationTypes.disable_2fa'),
    change_email: t('sensitiveVerification.operationTypes.change_email'),
    delete_account: t('sensitiveVerification.operationTypes.delete_account')
  }
  return names[props.operationType] || props.operationType
})

// 渠道显示名称
const channelName = computed(() => {
  if (!channel.value) return ''
  const names: Record<string, string> = {
    email: t('sensitiveVerification.channels.email'),
    telegram: 'Telegram',
    discord: 'Discord',
    webhook: 'Webhook'
  }
  return names[channel.value] || channel.value
})

// 重置状态
function resetState() {
  generation++
  loading.value = false
  step.value = 'request'
  verificationCode.value = ''
  channel.value = null
  target.value = null
  expiresAt.value = null
  countdown.value = 0
  error.value = ''
  if (countdownTimer) {
    clearInterval(countdownTimer)
    countdownTimer = null
  }
}

// 监听弹窗显示状态
watch([() => props.show, () => props.operationType, () => props.resourceId, sessionKey], () => {
  active = props.show
  resetState()
}, { immediate: true, flush: 'sync' })

// 请求验证码
async function requestCode() {
  const context = captureContext()
  if (!context.current() || loading.value || countdown.value > 0) return
  loading.value = true
  error.value = ''
  
  try {
    const response = await api.verification.request(context.operationType, context.resourceId)
    if (!context.current()) return
    if (response.success === true && response.required === false) {
      emit('verified')
      return
    }
    channel.value = response.channel
    target.value = response.maskedTarget || response.target || null
    expiresAt.value = response.expiresAt ?? null
    step.value = 'verify'
    
    // Current servers report remaining resend time separately from code expiry.
    countdown.value = typeof response.resendAfter === 'number' && Number.isSafeInteger(response.resendAfter) && response.resendAfter >= 0
      ? response.resendAfter : 60
    if (countdownTimer) clearInterval(countdownTimer)
    countdownTimer = setInterval(() => {
      if (!context.current()) return
      countdown.value--
      if (countdown.value <= 0) {
        if (countdownTimer) {
          clearInterval(countdownTimer)
          countdownTimer = null
        }
      }
    }, 1000)
    
    if (response.alreadySent === true) toast.info(t(channel.value === 'email' ? 'sensitiveVerification.codeAlreadySent' : 'sensitiveVerification.codeAlreadySentNotification'))
    else toast.success(t('sensitiveVerification.codeSent'))
  } catch (err: any) {
    if (!context.current()) return
    error.value = err?.message || String(err)
  } finally {
    if (context.current()) loading.value = false
  }
}

// 验证
async function verify() {
  const context = captureContext()
  if (!context.current() || loading.value || step.value !== 'verify') return
  if (verificationCode.value.length !== 6) {
    error.value = t('sensitiveVerification.invalidCode')
    return
  }
  
  loading.value = true
  error.value = ''
  
  try {
    const response = await api.verification.verify(context.operationType, verificationCode.value, context.resourceId)
    if (!context.current()) return
    if (response.verified !== true) {
      error.value = t('sensitiveVerification.invalidCode')
      return
    }
    toast.success(t('sensitiveVerification.verifySuccess'))
    emit('verified')
  } catch (err: any) {
    if (!context.current()) return
    error.value = err?.message || String(err)
  } finally {
    if (context.current()) loading.value = false
  }
}

// 关闭弹窗
function close() {
  active = false
  resetState()
  emit('close')
}

// 组件卸载时清理定时器
onBeforeUnmount(() => {
  alive = false
  active = false
  resetState()
})
</script>

<template>
  <Teleport to="body">
    <Transition name="modal" :css="operationType !== 'disable_2fa'">
      <div v-if="show" class="modal-overlay" :class="{ 'two-factor-verification': operationType === 'disable_2fa' }">
        <div class="modal-backdrop" @click="close" />
        <div ref="dialog" class="modal-content max-w-md" role="dialog" aria-modal="true" :aria-labelledby="`${dialogId}-title`" :aria-busy="loading" tabindex="-1" @keydown="handleDialogKey">
          <div class="modal-header">
            <h3 :id="`${dialogId}-title`" class="modal-title">{{ t('sensitiveVerification.title') }}</h3>
            <button
              type="button"
              :aria-label="t('common.close')"
              class="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              @click="close"
            >
              <svg aria-hidden="true" class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          
          <div class="modal-body">
            <!-- 步骤 1: 请求验证码 -->
            <div v-if="step === 'request'" class="space-y-4">
              <div class="p-4 rounded-lg" :class="themeStore.isDark ? 'bg-yellow-900/20 border border-yellow-500/30' : 'bg-yellow-50 border border-yellow-200'">
                <div class="flex items-start gap-3">
                  <svg class="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <div>
                    <p class="text-sm font-medium" :class="themeStore.isDark ? 'text-yellow-400' : 'text-yellow-800'">
                      {{ t('sensitiveVerification.description') }}
                    </p>
                    <p class="text-sm mt-1" :class="themeStore.isDark ? 'text-yellow-500/80' : 'text-yellow-700'">
                      {{ t('sensitiveVerification.operationLabel') }}: <strong>{{ operationName }}</strong>
                    </p>
                  </div>
                </div>
              </div>
              
              <p class="text-sm text-themed-secondary">
                {{ t('sensitiveVerification.requestHint') }}
              </p>
              
              <div v-if="error" role="alert" class="text-sm text-red-500">{{ error }}</div>
            </div>
            
            <!-- 步骤 2: 输入验证码 -->
            <div v-else class="space-y-4">
              <div class="text-center">
                <p class="text-sm text-themed-secondary mb-2">
                  {{ t('sensitiveVerification.codeSentTo', { channel: channelName }) }}
                </p>
                <p v-if="target" class="text-sm font-medium text-themed">{{ target }}</p>
              </div>
              
              <div>
                <label :for="`${dialogId}-code`" class="block text-sm text-themed-secondary mb-1.5">
                  {{ t('sensitiveVerification.enterCode') }}
                </label>
                <input
                  :id="`${dialogId}-code`"
                  v-model="verificationCode"
                  type="text"
                  maxlength="6"
                  inputmode="numeric" autocomplete="one-time-code"
                  :aria-invalid="!!error" :aria-describedby="error ? `${dialogId}-error` : undefined"
                  :disabled="loading"
                  class="input text-center text-2xl tracking-widest font-mono"
                  :placeholder="t('sensitiveVerification.codePlaceholder')"
                  @keyup.enter="verify"
                />
              </div>
              
              <div class="flex items-center justify-between text-sm">
                <button
                  v-if="countdown > 0"
                  type="button"
                  class="text-themed-muted cursor-not-allowed"
                  disabled
                >
                  {{ t('sensitiveVerification.resendIn', { seconds: countdown }) }}
                </button>
                <button
                  v-else
                  type="button"
                  class="text-blue-500 hover:text-blue-400"
                  :disabled="loading"
                  @click="requestCode"
                >
                  {{ t('sensitiveVerification.resendCode') }}
                </button>
              </div>
              
              <div v-if="error" :id="`${dialogId}-error`" role="alert" class="text-sm text-red-500">{{ error }}</div>
            </div>
          </div>
          
          <div class="modal-footer">
            <button class="btn-secondary" @click="close">{{ t('common.cancel') }}</button>
            <button
              v-if="step === 'request'"
              class="btn-primary"
              :disabled="loading"
              @click="requestCode"
            >
              {{ loading ? t('sensitiveVerification.sendingCode') : t('sensitiveVerification.sendCode') }}
            </button>
            <button
              v-else
              class="btn-primary"
              :disabled="loading || verificationCode.length !== 6"
              @click="verify"
            >
              {{ loading ? t('sensitiveVerification.verifying') : t('sensitiveVerification.verify') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.two-factor-verification .modal-content {
  background: var(--kawaii-bg) !important;
  color: var(--kawaii-text);
  border: 1px solid var(--kawaii-line) !important;
  border-radius: 12px !important;
  animation: none;
  transform: none;
  backdrop-filter: none;
  box-shadow: 0 16px 40px rgb(0 0 0 / 0.15) !important;
}
.two-factor-verification .modal-body,
.two-factor-verification .modal-header,
.two-factor-verification .modal-footer {
  background: var(--kawaii-bg) !important;
}
.two-factor-verification .modal-backdrop {
  background: rgb(0 0 0 / 0.4) !important;
  backdrop-filter: none;
}
.two-factor-verification .modal-title {
  font-size: 1rem;
  line-height: 1.5;
}
.two-factor-verification .modal-header button {
  min-height: 44px;
  min-width: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.two-factor-verification .modal-footer button,
.two-factor-verification .modal-body button {
  min-height: 44px;
}
.two-factor-verification .modal-body button {
  color: var(--kawaii-text) !important;
}
.two-factor-verification .input {
  background: var(--kawaii-bg) !important;
  border: 1px solid var(--kawaii-line) !important;
  border-radius: 8px !important;
  box-shadow: none !important;
  min-height: 48px;
}
.two-factor-verification .btn-primary {
  background: var(--kawaii-text) !important;
  color: var(--kawaii-bg) !important;
  border: 1px solid var(--kawaii-text) !important;
  box-shadow: none !important;
}
.two-factor-verification .btn-secondary {
  background: var(--kawaii-bg) !important;
  color: var(--kawaii-text) !important;
  border: 1px solid var(--kawaii-line) !important;
  box-shadow: none !important;
}
.two-factor-verification button:focus-visible,
.two-factor-verification input:focus-visible {
  outline: 2px solid var(--kawaii-text);
  outline-offset: 3px;
}
</style>
