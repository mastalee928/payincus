<script setup lang="ts">
import { computed, ref, onMounted, onActivated, onDeactivated, onUnmounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api'
import { useAuthStore } from '@/stores/auth'
import SensitiveVerificationModal from '@/components/SensitiveVerificationModal.vue'

const { t } = useI18n()
const authStore = useAuthStore()
const active = ref(false)
const session = computed(() => {
  if (!authStore.token || !authStore.user) return ''
  let identity = authStore.token
  try {
    const payload = JSON.parse(atob(identity.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    if (typeof payload.sid === 'string') identity = payload.sid
  } catch { /* Legacy tokens retain their full identity. */ }
  return `${authStore.user.id}:${authStore.user.role}:${identity}`
})
const available = computed(() => active.value && !!session.value)
const scope = computed(() => `${active.value}:${session.value}`)
let generation = 0, draftGeneration = 0
let successTimer: ReturnType<typeof setTimeout> | undefined
function clearSuccess() {
  clearTimeout(successTimer)
  successTimer = undefined
  success.value = ''
}
function showSuccess(message: string, duration: number) {
  clearSuccess()
  success.value = message
  const current = generation
  successTimer = setTimeout(() => { if (current === generation) success.value = ''; successTimer = undefined }, duration)
}
const loading = ref(false)
const showVerificationModal = ref(false)
const busy = computed(() => loading.value || showVerificationModal.value)
let pendingDisable: { password: string; code: string; context: ReturnType<typeof writeContext> } | null = null
function clearPendingDisable() {
  pendingDisable = null
  showVerificationModal.value = false
}
const enabled = ref(false)
const setupMode = ref(false)
const disableMode = ref(false)
const regenerateMode = ref(false)

// 设置数据
const qrCode = ref('')
const secret = ref('')
const recoveryCodes = ref<string[]>([])
const verifyCode = ref('')

// 禁用数据
const disablePassword = ref('')
const disableCode = ref('')

// 恢复码状态
const recoveryCodesStatus = ref<{ total: number; remaining: number; used: number } | null>(null)

// 重新生成数据
const regeneratePassword = ref('')
const regenerateCode = ref('')
const newRecoveryCodes = ref<string[]>([])
const validVerificationCode = (value: unknown) => typeof value === 'string' && /^\d{6}$/.test(value)
function validRecoveryCodes(value: unknown): value is string[] {
  return Array.isArray(value) && value.length === 8 && value.every(code => typeof code === 'string' && /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) && new Set(value).size === value.length
}
const canEnable = computed(() => !busy.value && available.value && statusReady.value && !statusLoading.value && validVerificationCode(verifyCode.value))
const canDisable = computed(() => !busy.value && available.value && statusReady.value && !statusLoading.value && !!disablePassword.value && validVerificationCode(disableCode.value))
const canRegenerate = computed(() => !busy.value && available.value && statusReady.value && !statusLoading.value && !!regeneratePassword.value && validVerificationCode(regenerateCode.value))

const error = ref('')
const success = ref('')
const statusLoading = ref(false)
const statusReady = ref(false)
const statusError = ref('')
const recoveryStatusLoading = ref(false)
const recoveryStatusError = ref('')
let statusRequest = 0, recoveryStatusRequest = 0
function invalidateRecoveryStatus() {
  recoveryStatusRequest += 1
  recoveryStatusLoading.value = false
  recoveryStatusError.value = ''
  recoveryCodesStatus.value = null
}
watch(enabled, invalidateRecoveryStatus, { flush: 'sync' })
function invalidateContext(reload = true) {
  generation += 1
  clearPendingDisable()
  statusRequest += 1
  statusReady.value = false
  statusLoading.value = false
  statusError.value = ''
  enabled.value = false
  invalidateRecoveryStatus()
  setupMode.value = false; disableMode.value = false; regenerateMode.value = false
  qrCode.value = ''; secret.value = ''; recoveryCodes.value = []; newRecoveryCodes.value = []
  verifyCode.value = ''; disablePassword.value = ''; disableCode.value = ''; regeneratePassword.value = ''; regenerateCode.value = ''
  error.value = ''; clearSuccess()
  if (reload && available.value) void loadStatus()
}
watch(scope, () => invalidateContext(), { flush: 'sync' })
watch([setupMode, disableMode, regenerateMode, verifyCode, disablePassword, disableCode, regeneratePassword, regenerateCode], () => {
  draftGeneration += 1
  clearPendingDisable()
  error.value = ''
}, { flush: 'sync' })
function writeContext() {
  const currentGeneration = generation, currentDraft = draftGeneration, currentScope = scope.value
  clearSuccess()
  return {
    current: () => available.value && currentGeneration === generation && currentDraft === draftGeneration && currentScope === scope.value,
    finish: () => {
      loading.value = false
      if (currentGeneration !== generation && available.value) void loadStatus()
    }
  }
}

async function loadStatus() {
  if (busy.value || !available.value) return
  const request = ++statusRequest
  recoveryStatusRequest += 1
  statusReady.value = false
  statusLoading.value = true
  statusError.value = ''
  error.value = ''
  clearSuccess()
  enabled.value = false
  recoveryCodesStatus.value = null
  recoveryStatusLoading.value = false
  recoveryStatusError.value = ''
  try {
    const res = await api.auth.get2FAStatus()
    if (request !== statusRequest) return
    if (typeof res?.enabled !== 'boolean') throw new Error(t('profile.twoFactorAuth.getStatusFailed'))
    enabled.value = res.enabled
    statusReady.value = true
    if (res.enabled) void loadRecoveryCodesStatus()
  } catch (e: any) {
    if (request === statusRequest) statusError.value = e.message || t('profile.twoFactorAuth.getStatusFailed')
  } finally {
    if (request === statusRequest) statusLoading.value = false
  }
}

async function loadRecoveryCodesStatus() {
  if (!available.value || !statusReady.value || !enabled.value) return
  const request = ++recoveryStatusRequest
  recoveryStatusLoading.value = true
  recoveryStatusError.value = ''
  recoveryCodesStatus.value = null
  try {
    const res = await api.auth.getRecoveryCodes()
    if (request !== recoveryStatusRequest) return
    if (!res || ![res.total, res.remaining, res.used].every(value => Number.isSafeInteger(value) && value >= 0) || res.remaining + res.used !== res.total) throw new Error(t('profile.twoFactorAuth.getStatusFailed'))
    recoveryCodesStatus.value = res
  } catch (e: any) {
    if (request === recoveryStatusRequest) recoveryStatusError.value = e.message || t('profile.twoFactorAuth.getStatusFailed')
  } finally {
    if (request === recoveryStatusRequest) recoveryStatusLoading.value = false
  }
}

async function startSetup() {
  if (!available.value || busy.value || !statusReady.value || statusLoading.value) return
  const context = writeContext()
  invalidateRecoveryStatus()
  loading.value = true
  error.value = ''
  try {
    const res = await api.auth.setup2FA()
    if (!context.current()) return
    if (typeof res?.secret !== 'string' || !res.secret.trim() || typeof res.qrCode !== 'string' || !res.qrCode.startsWith('data:image/png;base64,') || !validRecoveryCodes(res.recoveryCodes)) throw new Error(t('profile.twoFactorAuth.initFailed'))
    qrCode.value = res.qrCode
    secret.value = res.secret
    recoveryCodes.value = res.recoveryCodes
    setupMode.value = true
  } catch (e: any) {
    if (context.current()) error.value = e.message || t('profile.twoFactorAuth.initFailed')
  } finally {
    context.finish()
  }
}

async function confirmEnable() {
  if (!available.value || busy.value || !statusReady.value || statusLoading.value) return
  if (!validVerificationCode(verifyCode.value)) {
    error.value = t('profile.twoFactorAuth.enterCodeError')
    return
  }
  const context = writeContext(), code = verifyCode.value
  loading.value = true
  invalidateRecoveryStatus()
  error.value = ''
  try {
    const res = await api.auth.enable2FA(code)
    if (!context.current()) return
    if (typeof res?.message !== 'string' || !res.message.trim()) throw new Error(t('profile.twoFactorAuth.verifyFailed'))
    enabled.value = true
    setupMode.value = false
    qrCode.value = ''; secret.value = ''; recoveryCodes.value = []; verifyCode.value = ''
    showSuccess(t('profile.twoFactorAuth.enabledSuccess'), 3000)
  } catch (e: any) {
    if (context.current()) error.value = e.message || t('profile.twoFactorAuth.verifyFailed')
  } finally {
    context.finish()
  }
}

async function confirmDisable() {
  if (!available.value || busy.value || !statusReady.value || statusLoading.value) return
  if (!disablePassword.value || !validVerificationCode(disableCode.value)) {
    error.value = t('profile.twoFactorAuth.fillPasswordAndCode')
    return
  }
  const context = writeContext(), password = disablePassword.value, code = disableCode.value
  await submitDisable(password, code, context, true)
}

async function submitDisable(password: string, code: string, context: ReturnType<typeof writeContext>, allowVerification: boolean) {
  loading.value = true
  invalidateRecoveryStatus()
  error.value = ''
  try {
    const res = await api.auth.disable2FA(password, code)
    if (!context.current()) return
    if (typeof res?.message !== 'string' || !res.message.trim()) throw new Error(t('profile.twoFactorAuth.disableFailed'))
    enabled.value = false
    disableMode.value = false
    disablePassword.value = ''
    disableCode.value = ''
    recoveryCodesStatus.value = null
    showSuccess(t('profile.twoFactorAuth.disabledSuccess'), 3000)
  } catch (e: any) {
    if (!context.current()) return
    if (allowVerification && e?.code === 'VERIFICATION_REQUIRED') {
      pendingDisable = { password, code, context }
      showVerificationModal.value = true
      return
    }
    error.value = e.message || t('profile.twoFactorAuth.disableFailed')
  } finally {
    context.finish()
  }
}

async function onDisableVerified() {
  if (loading.value || !showVerificationModal.value || !pendingDisable?.context.current()) return
  const submitted = pendingDisable
  clearPendingDisable()
  await submitDisable(submitted.password, submitted.code, submitted.context, false)
}

function closeDisableVerification() {
  clearPendingDisable()
  disablePassword.value = ''
  disableCode.value = ''
}

async function confirmRegenerate() {
  if (!available.value || busy.value || !statusReady.value || statusLoading.value) return
  if (!regeneratePassword.value || !validVerificationCode(regenerateCode.value)) {
    error.value = t('profile.twoFactorAuth.fillPasswordAndCode')
    return
  }
  const context = writeContext(), password = regeneratePassword.value, code = regenerateCode.value
  loading.value = true
  invalidateRecoveryStatus()
  error.value = ''
  try {
    const res = await api.auth.regenerateRecoveryCodes(password, code)
    if (!context.current()) return
    if (!validRecoveryCodes(res?.recoveryCodes)) throw new Error(t('profile.twoFactorAuth.regenerateFailed'))
    newRecoveryCodes.value = res.recoveryCodes
    regeneratePassword.value = ''; regenerateCode.value = ''
    void loadRecoveryCodesStatus()
    showSuccess(t('profile.twoFactorAuth.codesRegenerated'), 5000)
  } catch (e: any) {
    if (context.current()) error.value = e.message || t('profile.twoFactorAuth.regenerateFailed')
  } finally {
    context.finish()
  }
}

function cancelRegenerate() {
  if (busy.value) return
  regenerateMode.value = false
  regeneratePassword.value = ''
  regenerateCode.value = ''
  newRecoveryCodes.value = []
  error.value = ''
}

function cancelSetup() {
  if (busy.value) return
  setupMode.value = false
  qrCode.value = ''
  secret.value = ''
  recoveryCodes.value = []
  verifyCode.value = ''
  error.value = ''
}

function cancelDisable() {
  if (busy.value) return
  disableMode.value = false
  disablePassword.value = ''
  disableCode.value = ''
  error.value = ''
}

function openDisable() {
  if (!busy.value && statusReady.value && !statusLoading.value) disableMode.value = true
}

function openRegenerate() {
  if (!busy.value && statusReady.value && !statusLoading.value) regenerateMode.value = true
}

onMounted(() => { active.value = true })
onActivated(() => { active.value = true })
onDeactivated(() => { active.value = false })
onUnmounted(() => { active.value = false; invalidateContext(false) })
</script>

<template>
  <div class="card nimbus-section">
    <h2 class="nimbus-section-title mb-5">{{ $t('profile.twoFactorAuth.title') }}</h2>

    <p v-if="statusLoading" class="text-sm text-themed-muted">{{ $t('common.loading') }}</p>
    <div v-else-if="statusError" role="alert" class="text-sm text-red-400 break-words">
      {{ statusError }} <button :disabled="busy" class="underline ml-2" @click="loadStatus">{{ $t('common.retry') }}</button>
    </div>
    <!-- Status display -->
    <div v-else-if="statusReady && !setupMode && !disableMode && !regenerateMode" class="space-y-4">
      <div class="flex items-center justify-between">
        <div>
          <span class="text-sm text-themed-primary">{{ $t('profile.twoFactorAuth.status') }}：</span>
          <span :class="enabled ? 'text-green-400' : 'text-yellow-400'" class="text-sm font-medium">
            {{ enabled ? $t('profile.twoFactorAuth.enabled') : $t('profile.twoFactorAuth.notEnabled') }}
          </span>
        </div>
        <button 
          v-if="!enabled"
          :disabled="busy"
          class="btn-primary text-sm"
          @click="startSetup"
        >
          {{ loading ? $t('profile.twoFactorAuth.loading') : $t('profile.twoFactorAuth.enable') }}
        </button>
        <button 
          v-else
          :disabled="busy"
          class="btn-secondary text-sm"
          @click="openDisable"
        >
          {{ $t('profile.twoFactorAuth.disable') }}
        </button>
      </div>
      <p class="text-xs text-themed-muted">
        {{ $t('profile.twoFactorAuth.description') }}
      </p>

      <!-- Recovery codes status -->
      <p v-if="recoveryStatusLoading" class="text-sm text-themed-muted">{{ $t('common.loading') }}</p>
      <div v-else-if="recoveryStatusError" role="alert" class="text-sm text-red-400 break-words">
        {{ recoveryStatusError }} <button :disabled="busy" class="underline ml-2" @click="loadRecoveryCodesStatus">{{ $t('common.retry') }}</button>
      </div>
      <div v-if="enabled && recoveryCodesStatus" class="mt-4 p-3 bg-themed-tertiary rounded">
        <div class="flex items-center justify-between mb-2">
          <span class="text-sm text-themed-primary">{{ $t('profile.twoFactorAuth.recoveryCodesStatus') }}</span>
          <button
            :disabled="busy"
            class="text-xs text-primary-500 hover:text-primary-400 transition-colors"
            @click="openRegenerate"
          >
            {{ $t('profile.twoFactorAuth.regenerate') }}
          </button>
        </div>
        <div class="flex items-center space-x-4 text-xs">
          <span class="text-themed-muted tabular-nums">
            {{ $t('profile.twoFactorAuth.remaining') }}: <span class="text-themed-primary font-medium">{{ recoveryCodesStatus.remaining }}</span> / {{ recoveryCodesStatus.total }}
          </span>
          <span v-if="recoveryCodesStatus.used > 0" class="text-yellow-500 tabular-nums">
            {{ $t('profile.twoFactorAuth.used') }}: {{ recoveryCodesStatus.used }}
          </span>
        </div>
        <p v-if="recoveryCodesStatus.remaining <= 2" class="text-xs text-red-400 mt-2">
          {{ $t('profile.twoFactorAuth.lowCodesWarning') }}
        </p>
      </div>
    </div>

    <!-- Setup mode -->
    <div v-if="setupMode" class="space-y-4">
      <div class="text-sm text-themed-primary mb-2">{{ $t('profile.twoFactorAuth.setup') }}</div>
      
      <div class="flex flex-col items-center space-y-3">
        <p class="text-xs text-themed-muted text-center">
          {{ $t('profile.twoFactorAuth.scanQrCode') }}
        </p>
        <img v-if="qrCode" :src="qrCode" alt="2FA QR Code" class="w-48 h-48 bg-white p-2 rounded" />
        <div class="text-xs text-themed-muted">
          {{ $t('profile.twoFactorAuth.manualEntry') }}：<code class="bg-themed-tertiary px-2 py-1 rounded text-themed-primary">{{ secret }}</code>
        </div>
      </div>

      <div v-if="recoveryCodes.length" class="mt-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded">
        <p class="text-xs text-yellow-400 mb-2">{{ $t('profile.twoFactorAuth.saveRecoveryCodes') }}：</p>
        <div class="grid grid-cols-2 gap-1">
          <code v-for="code in recoveryCodes" :key="code" class="text-xs text-themed-primary bg-themed-tertiary px-2 py-1 rounded">
            {{ code }}
          </code>
        </div>
      </div>

      <div class="mt-4">
        <label class="block text-xs text-themed-muted mb-1.5">{{ $t('profile.twoFactorAuth.enterCode') }}</label>
        <input 
          v-model="verifyCode"
          :disabled="busy"
          type="text"
          maxlength="6"
          class="input"
          :placeholder="$t('profile.twoFactorAuth.codePlaceholder')"
        />
      </div>

      <div class="flex space-x-3">
        <button :disabled="!canEnable" class="btn-primary" @click="confirmEnable">
          {{ loading ? $t('profile.twoFactorAuth.verifying') : $t('profile.twoFactorAuth.confirmEnable') }}
        </button>
        <button :disabled="busy" class="btn-secondary" @click="cancelSetup">{{ $t('profile.twoFactorAuth.cancel') }}</button>
      </div>
    </div>

    <!-- Disable mode -->
    <div v-if="disableMode" class="space-y-4">
      <div class="text-sm text-themed-primary mb-2">{{ $t('profile.twoFactorAuth.disableTitle') }}</div>
      <p class="text-xs text-themed-muted">{{ $t('profile.twoFactorAuth.disableDesc') }}</p>
      
      <div>
        <label class="block text-xs text-themed-muted mb-1.5">{{ $t('profile.twoFactorAuth.password') }}</label>
        <input 
          v-model="disablePassword"
          :disabled="busy"
          type="password"
          class="input"
          :placeholder="$t('profile.twoFactorAuth.passwordPlaceholder')"
        />
      </div>
      <div>
        <label class="block text-xs text-themed-muted mb-1.5">{{ $t('profile.twoFactorAuth.verificationCode') }}</label>
        <input 
          v-model="disableCode"
          :disabled="busy"
          type="text"
          maxlength="6"
          class="input"
          :placeholder="$t('profile.twoFactorAuth.codePlaceholder')"
        />
      </div>

      <div class="flex space-x-3">
        <button :disabled="!canDisable" class="btn-danger" @click="confirmDisable">
          {{ loading ? $t('profile.twoFactorAuth.processing') : $t('profile.twoFactorAuth.confirmDisable') }}
        </button>
        <button :disabled="busy" class="btn-secondary" @click="cancelDisable">{{ $t('profile.twoFactorAuth.cancel') }}</button>
      </div>
    </div>

    <!-- Regenerate recovery codes mode -->
    <div v-if="regenerateMode" class="space-y-4">
      <div class="text-sm text-themed-primary mb-2">{{ $t('profile.twoFactorAuth.regenerateTitle') }}</div>
      <p class="text-xs text-themed-muted">{{ $t('profile.twoFactorAuth.regenerateDesc') }}</p>
      
      <!-- Show new codes if generated -->
      <div v-if="newRecoveryCodes.length" class="p-3 bg-green-500/10 border border-green-500/30 rounded">
        <p class="text-xs text-green-400 mb-2">✓ {{ $t('profile.twoFactorAuth.newCodesGenerated') }}：</p>
        <div class="grid grid-cols-2 gap-1">
          <code v-for="code in newRecoveryCodes" :key="code" class="text-xs text-themed-primary bg-themed-tertiary px-2 py-1 rounded">
            {{ code }}
          </code>
        </div>
        <button :disabled="busy" class="btn-primary text-sm mt-3" @click="cancelRegenerate">{{ $t('profile.twoFactorAuth.done') }}</button>
      </div>

      <!-- Input form -->
      <template v-else>
        <div>
          <label class="block text-xs text-themed-muted mb-1.5">{{ $t('profile.twoFactorAuth.password') }}</label>
          <input 
            v-model="regeneratePassword"
            :disabled="busy"
            type="password"
            class="input"
            :placeholder="$t('profile.twoFactorAuth.passwordPlaceholder')"
          />
        </div>
        <div>
          <label class="block text-xs text-themed-muted mb-1.5">{{ $t('profile.twoFactorAuth.verificationCode') }}</label>
          <input 
            v-model="regenerateCode"
            :disabled="busy"
            type="text"
            maxlength="6"
            class="input"
            :placeholder="$t('profile.twoFactorAuth.codePlaceholder')"
          />
        </div>

        <div class="flex space-x-3">
          <button :disabled="!canRegenerate" class="btn-primary" @click="confirmRegenerate">
            {{ loading ? $t('profile.twoFactorAuth.generating') : $t('profile.twoFactorAuth.confirmGenerate') }}
          </button>
          <button :disabled="busy" class="btn-secondary" @click="cancelRegenerate">{{ $t('profile.twoFactorAuth.cancel') }}</button>
        </div>
      </template>
    </div>

    <!-- Messages -->
    <div v-if="error" class="mt-3 text-sm text-red-400">{{ error }}</div>
    <div v-if="success" class="mt-3 text-sm text-green-400">{{ success }}</div>
    <SensitiveVerificationModal
      :show="showVerificationModal"
      operation-type="disable_2fa"
      @close="closeDisableVerification"
      @verified="onDisableVerified"
    />
  </div>
</template>

<style scoped>
.nimbus-section {
  border-radius: 16px;
  padding: 1.5rem;
}

.nimbus-section-title {
  font-size: 0.9375rem;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--kawaii-text);
}
.nimbus-section .text-themed-primary,
.nimbus-section .btn-secondary {
  color: var(--kawaii-text) !important;
}
.nimbus-section .btn-danger {
  color: #b91c1c !important;
}
:global(.dark) .nimbus-section .btn-danger {
  color: #fca5a5 !important;
}
</style>
