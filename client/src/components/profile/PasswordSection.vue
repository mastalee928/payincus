<script setup lang="ts">
import { computed, onActivated, onDeactivated, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api'
import { useAuthStore } from '@/stores/auth'
import SensitiveVerificationModal from '@/components/SensitiveVerificationModal.vue'
import { loginPath } from '@/utils/app-paths'

const { t } = useI18n()
const authStore = useAuthStore()
const reauthLoginPath = loginPath()

interface PasswordForm {
  currentPassword: string
  newPassword: string
  confirmPassword: string
}

const passwordForm = ref<PasswordForm>({
  currentPassword: '',
  newPassword: '',
  confirmPassword: ''
})
const passwordLoading = ref<boolean>(false)
const passwordError = ref<string>('')
const passwordSuccess = ref<boolean>(false)

// 验证模态框
const showVerificationModal = ref<boolean>(false)
const pendingPassword = ref<string>('')
const pendingCurrentPassword = ref<string>('')
let pendingContext: ReturnType<typeof requestContext> | null = null
let generation = 0, draft = 0
let alive = true
const active = ref(true)
const session = computed(() => {
  if (!authStore.token || !authStore.user) return ''
  let identity = authStore.token
  try {
    const payload = JSON.parse(atob(identity.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    if (typeof payload.sid === 'string') identity = payload.sid
  } catch { /* Legacy tokens retain their complete identity. */ }
  return `${authStore.user.id}:${authStore.user.role}:${identity}`
})
const available = computed(() => alive && active.value && !!session.value)
const reauthPending = ref(false)
const busy = computed(() => passwordLoading.value || showVerificationModal.value || reauthPending.value)
let reauthTimer: ReturnType<typeof setTimeout> | null = null
function clearTimers(): void {
  if (reauthTimer) clearTimeout(reauthTimer)
  reauthTimer = null
  reauthPending.value = false
}
function clearPending(): void {
  pendingContext = null
  pendingPassword.value = ''
  pendingCurrentPassword.value = ''
  showVerificationModal.value = false
}
function invalidateContext(): void {
  generation += 1
  clearTimers()
  clearPending()
  passwordForm.value = { currentPassword: '', newPassword: '', confirmPassword: '' }
  passwordError.value = ''
  passwordSuccess.value = false
}
function requestContext() {
  const currentGeneration = generation, currentDraft = draft, currentSession = session.value
  return { current: () => available.value && generation === currentGeneration && draft === currentDraft && session.value === currentSession }
}
watch(session, invalidateContext, { flush: 'sync' })
watch(passwordForm, () => { draft += 1; clearPending(); passwordError.value = ''; passwordSuccess.value = false }, { flush: 'sync', deep: true })
onActivated(() => { active.value = true })
onDeactivated(() => { active.value = false; invalidateContext() })
onUnmounted(() => { alive = false; invalidateContext() })
function closeVerification(): void {
  clearPending()
}
function confirmPasswordUpdate(): void {
  clearPending()
  clearTimers()
  passwordForm.value = { currentPassword: '', newPassword: '', confirmPassword: '' }
  passwordSuccess.value = true
  const currentGeneration = generation, currentSession = session.value
  const current = () => available.value && generation === currentGeneration && session.value === currentSession
  reauthPending.value = true
  reauthTimer = setTimeout(() => {
    reauthTimer = null
    if (!current()) return
    authStore.clearLocalAuth()
    window.location.href = reauthLoginPath
  }, 1000)
}

async function updatePassword(): Promise<void> {
  if (!available.value || busy.value) return
  passwordError.value = ''
  passwordSuccess.value = false

  if (passwordForm.value.newPassword !== passwordForm.value.confirmPassword) {
    passwordError.value = t('profile.password.mismatch')
    return
  }

  if (passwordForm.value.newPassword.length < 8) {
    passwordError.value = t('profile.password.tooShort')
    return
  }
  if (passwordForm.value.newPassword.length > 128) {
    passwordError.value = t('profile.password.tooLong')
    return
  }
  if (!/[A-Z]/.test(passwordForm.value.newPassword) || !/[a-z]/.test(passwordForm.value.newPassword) || !/[0-9]/.test(passwordForm.value.newPassword)) {
    passwordError.value = t('profile.password.tooWeak')
    return
  }
  if (!passwordForm.value.currentPassword) {
    passwordError.value = t('profile.password.currentPlaceholder')
    return
  }

  clearTimers()
  clearPending()
  passwordLoading.value = true
  const context = requestContext(), userId = authStore.user!.id, submitted = { ...passwordForm.value }
  try {
    const response = await api.users.update(userId, {
      password: submitted.newPassword,
      currentPassword: submitted.currentPassword
    })
    if (!context.current()) return
    if (typeof response?.message !== 'string' || !response.message.trim() || response.reauthRequired !== true) throw new Error(t('profile.password.updateFailed'))
    confirmPasswordUpdate()
  } catch (error: any) {
    if (!context.current()) return
    // 检查是否需要验证
    if (error?.code === 'VERIFICATION_REQUIRED' || error?.message?.includes('Sensitive operation requires verification')) {
      // 保存待修改的密码和当前密码，等待验证成功后使用
      pendingPassword.value = submitted.newPassword
      pendingCurrentPassword.value = submitted.currentPassword
      pendingContext = context
      showVerificationModal.value = true
      return
    }
    passwordError.value = error?.message || t('profile.password.updateFailed')
  } finally {
    passwordLoading.value = false
  }
}

// 验证成功后的处理
async function onVerificationSuccess(): Promise<void> {
  if (!available.value || passwordLoading.value || !showVerificationModal.value || !pendingContext?.current()) return
  const context = pendingContext, userId = authStore.user!.id, password = pendingPassword.value, currentPassword = pendingCurrentPassword.value
  showVerificationModal.value = false

  // 验证成功后，重新执行密码修改
  if (password && currentPassword) {
    passwordLoading.value = true
    try {
      const response = await api.users.update(userId, { password, currentPassword })
      if (!context.current()) return
      if (typeof response?.message !== 'string' || !response.message.trim() || response.reauthRequired !== true) throw new Error(t('profile.password.updateFailed'))
      confirmPasswordUpdate()
    } catch (error: any) {
      if (!context.current()) return
      passwordError.value = error?.message || t('profile.password.updateFailed')
      // 如果当前密码错误，清空待处理状态
      if (error?.code === 'INVALID_CREDENTIALS' || error?.message?.includes('Current password is incorrect')) {
        clearPending()
      }
    } finally {
      clearPending()
      passwordLoading.value = false
    }
  }
}
</script>

<template>
  <div class="card nimbus-section">
    <h2 class="nimbus-section-title mb-5">{{ $t('profile.password.title') }}</h2>
    <form class="space-y-4" @submit.prevent="updatePassword">
      <fieldset :disabled="busy" class="space-y-4">
        <div>
          <label class="block text-xs text-themed-muted mb-1.5">{{ $t('profile.password.current') }}</label>
          <input
            v-model="passwordForm.currentPassword"
            type="password"
            class="input"
            :placeholder="$t('profile.password.currentPlaceholder')"
            autocomplete="current-password"
          />
        </div>
        <div>
          <label class="block text-xs text-themed-muted mb-1.5">{{ $t('profile.password.new') }}</label>
          <input
            v-model="passwordForm.newPassword"
            type="password"
            minlength="8" maxlength="128" aria-describedby="profile-new-password-hint"
            class="input"
            :placeholder="$t('profile.password.new')"
            autocomplete="new-password"
          />
          <p id="profile-new-password-hint" class="mt-2 text-sm text-themed-muted">{{ $t('profile.password.newPlaceholder') }}</p>
        </div>
        <div>
          <label class="block text-xs text-themed-muted mb-1.5">{{ $t('profile.password.confirm') }}</label>
          <input
            v-model="passwordForm.confirmPassword"
            type="password"
            class="input"
            :placeholder="$t('profile.password.confirmPlaceholder')"
            autocomplete="new-password"
          />
        </div>
      </fieldset>

      <div v-if="passwordError" class="text-sm text-red-500">{{ passwordError }}</div>
      <div v-if="passwordSuccess" class="text-sm text-green-500">{{ $t('profile.password.updated') }}</div>

      <button
        type="submit"
        :disabled="busy || !passwordForm.currentPassword || !passwordForm.newPassword"
        class="btn-primary"
      >
        {{ passwordLoading ? $t('profile.password.updating') : $t('profile.password.update') }}
      </button>
    </form>

    <!-- 敏感操作验证弹窗 -->
    <SensitiveVerificationModal
      :show="showVerificationModal"
      operation-type="change_password"
      @close="closeVerification"
      @verified="onVerificationSuccess"
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
</style>
