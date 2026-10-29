<script setup lang="ts">
import { ref, computed, watch, onMounted, onActivated, onDeactivated, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import { useToast } from '@/stores/toast'
import UserAvatar from '@/components/UserAvatar.vue'
import ChangeEmailModal from '@/components/profile/ChangeEmailModal.vue'
import type { User } from '@/types/api'

const { t } = useI18n()
const authStore = useAuthStore()
const themeStore = useThemeStore()
const toast = useToast()
const userDetails = ref<User | null>(null)
const loading = ref<boolean>(true)

// 头像风格相关 - 所有可用风格
const avatarStyles = [
  'adventurer', 'adventurerNeutral', 'avataaars', 'avataaarsNeutral',
  'bigEars', 'bigEarsNeutral', 'bigSmile', 'bottts', 'botttsNeutral',
  'croodles', 'croodlesNeutral', 'dylan', 'funEmoji', 'glass', 'icons',
  'identicon', 'initials', 'lorelei', 'loreleiNeutral', 'micah', 'miniavs',
  'notionists', 'notionistsNeutral', 'openPeeps', 'personas', 'pixelArt',
  'pixelArtNeutral', 'rings', 'shapes', 'thumbs'
] as const

const selectedAvatarStyle = ref<string>(authStore.user?.avatarStyle || '')
const savingAvatar = ref(false)
const avatarExpanded = ref(false)
const showChangeEmailModal = ref(false)
const avatarError = ref('')
const detailError = ref('')
const active = ref(false)
let alive = true, generation = 0, detailSequence = 0
const session = computed(() => {
  if (!authStore.user || !authStore.token) return ''
  let identity = authStore.token
  try {
    const payload = JSON.parse(atob(identity.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    if (typeof payload.sid === 'string') identity = payload.sid
  } catch { /* Legacy tokens retain their complete identity. */ }
  return `${authStore.user.id}:${authStore.user.role}:${identity}`
})
const available = computed(() => alive && active.value && !!session.value)
function invalidateContext(): void {
  generation++
  detailSequence++
  userDetails.value = null
  loading.value = false
  selectedAvatarStyle.value = authStore.user?.avatarStyle || ''
  avatarError.value = ''
  detailError.value = ''
  avatarExpanded.value = false
  showChangeEmailModal.value = false
}
watch(session, () => { invalidateContext(); if (available.value) void loadUserDetails() }, { flush: 'sync' })
function activate(): void {
  if (!alive || active.value) return
  active.value = true
  void loadUserDetails()
}
onMounted(activate)
onActivated(activate)
onDeactivated(() => { active.value = false; invalidateContext() })
onBeforeUnmount(() => { alive = false; active.value = false; invalidateContext() })

// 获取风格的国际化名称
function getStyleLabel(style: string): string {
  return t(`profile.avatar.styles.${style}`)
}

const hasAvatarChanged = computed(() => {
  return selectedAvatarStyle.value !== (authStore.user?.avatarStyle || '')
})

async function saveAvatarStyle(): Promise<void> {
  if (!available.value || savingAvatar.value || !hasAvatarChanged.value || !avatarStyles.includes(selectedAvatarStyle.value as typeof avatarStyles[number])) return
  const userId = authStore.user!.id, submittedStyle = selectedAvatarStyle.value, version = generation
  const current = () => available.value && version === generation && userId === authStore.user?.id
  savingAvatar.value = true
  avatarError.value = ''
  try {
    const response = await api.users.update(userId, { avatarStyle: submittedStyle })
    if (!current()) return
    if (typeof response?.message !== 'string' || !response.message.trim()) throw new Error(t('profile.avatar.saveFailed'))
    // 更新本地 store
    if (authStore.user) {
      authStore.user.avatarStyle = submittedStyle
    }
    toast.success(t('profile.avatar.saveSuccess'))
  } catch {
    if (!current()) return
    avatarError.value = t('profile.avatar.saveFailed')
    toast.error(avatarError.value)
  } finally {
    savingAvatar.value = false
  }
}

async function loadUserDetails(): Promise<void> {
  if (!available.value) return
  const userId = authStore.user!.id, version = generation, sequence = ++detailSequence
  const current = () => available.value && version === generation && sequence === detailSequence && userId === authStore.user?.id
  loading.value = true
  detailError.value = ''
  try {
    const response = await api.users.get(userId)
    if (!current()) return
    const user = (response as { user?: User }).user
    if (!user || user.id !== userId) throw new Error(t('common.loadFailed'))
    userDetails.value = user
  } catch {
    if (!current()) return
    userDetails.value = null
    detailError.value = t('common.loadFailed')
  } finally {
    if (current()) loading.value = false
  }
}

function handleEmailUpdated(email: string): void {
  if (!available.value || !showChangeEmailModal.value) return
  if (authStore.user) {
    authStore.user.email = email
  }
  if (userDetails.value) {
    userDetails.value.email = email
  }
  showChangeEmailModal.value = false
}


defineExpose({ loadUserDetails })
</script>

<template>
  <!-- 账户信息 -->
  <div class="card nimbus-section">
    <div class="flex items-start justify-between mb-5">
      <div>
        <h2 class="nimbus-section-title">{{ $t('profile.account.title') }}</h2>
        <p class="nimbus-section-desc">{{ authStore.user?.username }}</p>
      </div>
      <UserAvatar
        :username="authStore.user?.username || ''" 
        :email="authStore.user?.email"
        :avatar-style="authStore.user?.avatarStyle || ''"
        :size="56"
      />
    </div>
    <div v-if="detailError" class="mb-4 text-sm text-error" role="alert">
      <p>{{ detailError }}</p>
      <button type="button" class="btn-secondary min-h-11 mt-2" :disabled="!available || loading" @click="loadUserDetails">{{ t('common.retry') }}</button>
    </div>
    <dl class="space-y-0 text-sm">
      <div class="flex items-center justify-between py-3 border-b border-themed">
        <dt class="text-themed-muted">{{ $t('profile.account.username') }}</dt>
        <dd class="flex flex-wrap items-center justify-end gap-2 text-themed font-medium">
          <span>{{ authStore.user?.username }}</span>
          <span
            class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium tabular-nums"
            :class="themeStore.isDark ? 'bg-gray-800 text-gray-300' : 'bg-gray-100 text-gray-600'"
          >
            {{ $t('profile.account.uid') }} {{ authStore.user?.id }}
          </span>
        </dd>
      </div>
      <div class="flex items-center justify-between py-3 border-b border-themed">
        <dt class="text-themed-muted">{{ $t('profile.account.role') }}</dt>
        <dd>
          <span :class="['badge', authStore.isAdmin ? 'badge-warning' : 'badge-success']">
            {{ authStore.isAdmin ? $t('profile.account.admin') : $t('profile.account.user') }}
          </span>
        </dd>
      </div>
      <div class="flex items-center justify-between py-3 border-b border-themed">
        <dt class="text-themed-muted">{{ $t('profile.account.email') }}</dt>
        <dd class="flex flex-wrap items-center justify-end gap-3">
          <span class="text-themed-secondary">{{ authStore.user?.email || $t('profile.account.notSet') }}</span>
          <button
            type="button"
            class="btn-secondary btn-sm"
            :disabled="!available || savingAvatar"
            @click="showChangeEmailModal = true"
          >
            {{ authStore.user?.email ? $t('profile.account.changeEmail') : $t('profile.account.bindEmail') }}
          </button>
        </dd>
      </div>
      <!-- 头像风格入口 -->
      <div class="py-3">
        <button
          class="w-full flex items-center justify-between text-left"
          :disabled="!available || savingAvatar"
          @click="avatarExpanded = !avatarExpanded"
        >
          <span class="text-themed-muted">{{ $t('profile.avatar.title') }}</span>
          <svg
            class="w-4 h-4 text-themed-muted transition-transform duration-200"
            :class="{ 'rotate-180': avatarExpanded }"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        <!-- 展开的头像选择区域 -->
        <div
          v-show="avatarExpanded"
          class="mt-4 pt-4 border-t border-themed"
        >
          <div class="flex flex-col sm:flex-row items-start gap-6 mb-4">
            <!-- 预览 -->
            <div class="flex-shrink-0 flex flex-col items-center gap-2">
              <UserAvatar 
                :username="authStore.user?.username || ''"
                :email="authStore.user?.email" 
                :avatar-style="selectedAvatarStyle"
                :prefer-badge="false"
                :size="96"
              />
              <span class="text-sm text-themed-secondary">{{ getStyleLabel(selectedAvatarStyle) }}</span>
            </div>
            <!-- 风格选择 -->
            <div class="flex-1 w-full">
              <div class="grid grid-cols-5 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-2">
                <button
                  v-for="style in avatarStyles"
                  :key="style"
                  class="flex flex-col items-center gap-1 p-1.5 rounded-lg border-2 transition-all"
                  :class="[
                    selectedAvatarStyle === style
                      ? 'border-primary-500 bg-primary-500/10'
                      : 'border-transparent hover:border-gray-300 dark:hover:border-gray-600'
                  ]"
                  :title="getStyleLabel(style)"
                  :disabled="!available || savingAvatar"
                  @click="selectedAvatarStyle = style"
                >
                  <UserAvatar 
                    :username="authStore.user?.username || ''"
                    :email="authStore.user?.email" 
                    :avatar-style="style"
                    :prefer-badge="false"
                    :size="32"
                  />
                </button>
              </div>
            </div>
          </div>
          <p v-if="avatarError" class="text-sm text-error mb-3" role="alert">{{ avatarError }}</p>
          <div class="flex justify-end">
            <button
              class="btn btn-primary text-sm"
              :disabled="!available || !hasAvatarChanged || savingAvatar"
              @click="saveAvatarStyle"
            >
              {{ savingAvatar ? $t('common.saving') : $t('common.save') }}
            </button>
          </div>
        </div>
      </div>
    </dl>
  </div>

  <ChangeEmailModal
    :show="showChangeEmailModal"
    @close="showChangeEmailModal = false"
    @updated="handleEmailUpdated"
  />
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

.nimbus-section-desc {
  margin-top: 0.15rem;
  font-size: 0.75rem;
  color: var(--kawaii-muted);
}
</style>
