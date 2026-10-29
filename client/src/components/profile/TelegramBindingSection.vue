<script setup lang="ts">
import { computed, onMounted, ref, watch, onActivated, onDeactivated, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api'
import { useToast } from '@/stores/toast'
import { useAuthStore } from '@/stores/auth'
import type { TelegramBindingStatus } from '@/types/api'

const { locale, t } = useI18n()
const toast = useToast()
const auth = useAuthStore()

const loading = ref(false)
const generating = ref(false)
const unlinking = ref(false)
const savingNotify = ref(false)
const bindUrl = ref('')
const expiresAt = ref('')
const status = ref<TelegramBindingStatus>({
  enabled: false,
  configured: false,
  botUsername: null,
  binding: null
})
const ready = ref(false), readError = ref(false), operationFailure = ref<'generateFailed' | 'unlinkFailed' | 'notifySaveFailed' | ''>(''), active = ref(false)
const operationError = computed(() => operationFailure.value ? t(`profile.telegramBinding.${operationFailure.value}`, { error: t('common.operationFailed') }) : '')
let alive = true, generation = 0, readSequence = 0, linkGeneration = 0, targetGeneration = 0
let expiryTimer: ReturnType<typeof setTimeout> | null = null
const session = computed(() => {
  if (!auth.user || !auth.token || !Number.isSafeInteger(auth.user.id) || auth.user.id < 1) return ''
  let identity = auth.token
  try {
    const payload = JSON.parse(atob(identity.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    if (typeof payload.sid === 'string' && payload.sid) identity = payload.sid
  } catch { /* Legacy tokens retain their full identity. */ }
  return `${auth.user.id}:${auth.user.role}:${identity}`
})
const available = computed(() => alive && active.value && !!session.value)
const mutationBusy = computed(() => generating.value || unlinking.value || savingNotify.value)
const canMutate = computed(() => available.value && ready.value && isAvailable.value && !readError.value && !loading.value && !mutationBusy.value)
const target = computed(() => JSON.stringify([status.value.enabled, status.value.configured, status.value.botUsername, status.value.binding?.telegramUserId, status.value.binding?.boundAt]))
function clearLink(): void {
  linkGeneration++
  if (expiryTimer) clearTimeout(expiryTimer)
  expiryTimer = null
  bindUrl.value = ''
  expiresAt.value = ''
}
function invalidateContext(): void {
  generation++
  readSequence++
  status.value = { enabled: false, configured: false, botUsername: null, binding: null }
  ready.value = false
  loading.value = false
  readError.value = false
  operationFailure.value = ''
  clearLink()
}
watch(session, () => { invalidateContext(); if (available.value) void loadBinding() }, { flush: 'sync' })
watch(target, () => { targetGeneration++; operationFailure.value = ''; clearLink() }, { flush: 'sync' })
function activate(): void {
  if (!alive || active.value) return
  active.value = true
  void loadBinding()
}
onMounted(activate)
onActivated(activate)
onDeactivated(() => { active.value = false; invalidateContext() })
onBeforeUnmount(() => { alive = false; active.value = false; invalidateContext() })

function validStatus(value: unknown): value is TelegramBindingStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as TelegramBindingStatus
  if (typeof candidate.enabled !== 'boolean' || typeof candidate.configured !== 'boolean' ||
    (candidate.botUsername !== null && typeof candidate.botUsername !== 'string')) return false
  if (candidate.binding === null) return true
  const binding = candidate.binding
  return !!binding && typeof binding === 'object' && !Array.isArray(binding) && typeof binding.telegramUserId === 'string' &&
    !!binding.telegramUserId && typeof binding.notifyEnabled === 'boolean' && typeof binding.boundAt === 'string' && Number.isFinite(Date.parse(binding.boundAt)) &&
    ['telegramUsername', 'firstName', 'lastName', 'notifyLastError', 'notifyLastErrorAt'].every(field => {
      const entry = binding[field as keyof typeof binding]
      return entry === null || typeof entry === 'string'
    })
}
function validMessage(value: unknown): value is { message: string } {
  return !!value && typeof value === 'object' && !Array.isArray(value) && typeof (value as { message?: unknown }).message === 'string' &&
    !!(value as { message: string }).message.trim()
}

const isAvailable = computed(() => status.value.enabled && status.value.configured)
const binding = computed(() => status.value.binding)
const botLabel = computed(() => status.value.botUsername ? `@${status.value.botUsername}` : 'Telegram Bot')
const telegramDisplayName = computed(() => {
  const current = binding.value
  if (!current) return ''
  if (current.telegramUsername) return `@${current.telegramUsername}`
  const fullName = [current.firstName, current.lastName].filter(Boolean).join(' ')
  return fullName || `ID ${current.telegramUserId}`
})

function formatDate(value: string): string {
  const localeMap: Record<string, string> = {
    'zh-CN': 'zh-CN',
    'zh-TW': 'zh-TW',
    en: 'en-US'
  }

  return new Date(value).toLocaleString(localeMap[locale.value] || 'en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

async function loadBinding(): Promise<void> {
  if (!available.value) return
  const version = generation, identity = session.value, sequence = ++readSequence
  const current = () => available.value && version === generation && identity === session.value && sequence === readSequence
  loading.value = true
  readError.value = false
  try {
    const response = await api.telegram.getBinding()
    if (!current()) return
    if (!validStatus(response)) throw new Error('Invalid Telegram binding status')
    status.value = response
    ready.value = true
  } catch {
    if (current()) readError.value = true
  } finally {
    if (current()) loading.value = false
  }
}

async function createBindToken(): Promise<void> {
  if (!canMutate.value || binding.value) return
  const version = generation, identity = session.value, submittedTarget = target.value, targetVersion = targetGeneration
  const current = () => available.value && version === generation && identity === session.value && submittedTarget === target.value && targetVersion === targetGeneration
  generating.value = true
  operationFailure.value = ''
  readSequence++
  clearLink()
  try {
    const response = await api.telegram.createBindToken()
    if (!current()) return
    if (!response || typeof response.bindUrl !== 'string' || typeof response.expiresAt !== 'string') throw new Error('Invalid binding link')
    const url = new URL(response.bindUrl), deadline = Date.parse(response.expiresAt)
    if (url.protocol !== 'https:' || url.host !== 't.me' || url.username || url.password || url.hash ||
      url.pathname !== `/${status.value.botUsername}` || [...url.searchParams.keys()].length !== 1 ||
      !/^bind_[A-Za-z0-9_-]{43}$/.test(url.searchParams.get('start') || '') || !Number.isFinite(deadline) ||
      deadline <= Date.now() || deadline - Date.now() > 600000) throw new Error('Invalid binding link')
    bindUrl.value = response.bindUrl
    expiresAt.value = response.expiresAt
    const linkVersion = linkGeneration
    expiryTimer = setTimeout(() => { if (current() && linkVersion === linkGeneration) clearLink() }, Math.max(1, deadline - Date.now()))
    toast.success(t('profile.telegramBinding.generated'))
  } catch {
    if (current()) { operationFailure.value = 'generateFailed'; toast.error(operationError.value) }
  } finally {
    generating.value = false
  }
}

async function copyBindUrl(): Promise<void> {
  if (!available.value || !bindUrl.value || Date.parse(expiresAt.value) <= Date.now()) return
  const content = bindUrl.value, version = generation, linkVersion = linkGeneration
  const current = () => available.value && version === generation && linkVersion === linkGeneration && content === bindUrl.value
  try {
    await navigator.clipboard.writeText(content)
    if (current()) toast.success(t('profile.telegramBinding.copied'))
  } catch {
    if (current()) toast.error(t('profile.telegramBinding.copyFailed'))
  }
}

async function unlinkTelegram(): Promise<void> {
  if (!canMutate.value || !binding.value) return
  const version = generation, identity = session.value, submittedTarget = target.value, targetVersion = targetGeneration
  const current = () => available.value && version === generation && identity === session.value && submittedTarget === target.value && targetVersion === targetGeneration
  if (!confirm(t('profile.telegramBinding.confirmUnlink'))) return
  if (!current() || !canMutate.value) return

  unlinking.value = true
  operationFailure.value = ''
  readSequence++
  try {
    const response = await api.telegram.unlink()
    if (!current()) return
    if (!validMessage(response)) throw new Error('Unconfirmed Telegram unlink')
    clearLink()
    toast.success(t('profile.telegramBinding.unlinked'))
    await loadBinding()
  } catch {
    if (current()) { operationFailure.value = 'unlinkFailed'; toast.error(operationError.value) }
  } finally {
    unlinking.value = false
  }
}

async function toggleNotify(enabled: boolean): Promise<void> {
  if (!canMutate.value || !binding.value || typeof enabled !== 'boolean' || enabled === binding.value.notifyEnabled) return
  const version = generation, identity = session.value, submittedTarget = target.value, targetVersion = targetGeneration
  const current = () => available.value && version === generation && identity === session.value && submittedTarget === target.value && targetVersion === targetGeneration
  savingNotify.value = true
  operationFailure.value = ''
  readSequence++
  try {
    const response = await api.telegram.setNotification(enabled)
    if (!current()) return
    if (!validMessage(response) || response.notifyEnabled !== enabled) throw new Error('Unconfirmed Telegram notification change')
    readSequence++
    loading.value = false
    if (status.value.binding) {
      status.value.binding.notifyEnabled = response.notifyEnabled
      if (response.notifyEnabled) {
        status.value.binding.notifyLastError = null
        status.value.binding.notifyLastErrorAt = null
      }
    }
    toast.success(t(response.notifyEnabled ? 'profile.telegramBinding.notifyEnabledToast' : 'profile.telegramBinding.notifyDisabledToast'))
  } catch {
    if (current()) { operationFailure.value = 'notifySaveFailed'; toast.error(operationError.value) }
  } finally {
    savingNotify.value = false
  }
}

function handleNotifyChange(event: Event): void {
  const input = event.target as HTMLInputElement
  const enabled = input.checked
  input.checked = binding.value?.notifyEnabled ?? false
  void toggleNotify(enabled)
}

defineExpose({ loadBinding })
</script>

<template>
  <div class="card nimbus-section">
    <div class="flex items-start justify-between gap-4 mb-5">
      <div>
        <h2 class="nimbus-section-title">{{ t('profile.telegramBinding.title') }}</h2>
        <p class="nimbus-section-desc">
          {{ t('profile.telegramBinding.description') }}
        </p>
      </div>
      <button class="btn-ghost btn-sm shrink-0 whitespace-nowrap" :disabled="loading" @click="loadBinding">
        {{ loading ? t('profile.telegramBinding.refreshing') : t('profile.telegramBinding.refresh') }}
      </button>
    </div>

    <p v-if="readError" role="alert" data-tg-read-error class="mb-3 text-sm text-red-600 dark:text-red-400">
      {{ t('common.loadFailed') }}
      <button type="button" class="btn-ghost btn-sm ml-2" :disabled="loading" @click="loadBinding">{{ t('common.retry') }}</button>
    </p>
    <p v-if="operationError" role="alert" data-tg-operation-error class="mb-3 text-sm text-red-600 dark:text-red-400">{{ operationError }}</p>

    <div v-if="loading" class="p-4 bg-themed-tertiary border border-themed rounded-xl animate-pulse">
      <div class="h-4 bg-themed-secondary rounded w-1/3 mb-3"></div>
      <div class="h-3 bg-themed-secondary rounded w-2/3"></div>
    </div>

    <div v-else-if="ready && !readError && !isAvailable" class="p-4 bg-themed-tertiary border border-themed rounded-xl">
      <div class="text-sm text-themed font-medium">{{ t('profile.telegramBinding.unavailableTitle') }}</div>
      <p class="text-xs text-themed-muted mt-1">
        {{ t('profile.telegramBinding.unavailableDescription') }}
      </p>
    </div>

    <div v-else-if="binding" class="p-4 bg-themed-tertiary border border-themed rounded-xl">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div class="min-w-0 break-words">
          <div class="text-sm text-themed font-medium">{{ t('profile.telegramBinding.boundTitle', { name: telegramDisplayName }) }}</div>
          <p class="text-xs text-themed-muted mt-1 tabular-nums">
            {{ t('profile.telegramBinding.telegramId', { id: binding.telegramUserId }) }}
          </p>
          <p class="text-xs text-themed-muted mt-1 tabular-nums">
            {{ t('profile.telegramBinding.boundAt', { date: formatDate(binding.boundAt) }) }}
          </p>
          <p class="text-xs text-themed-muted mt-1">
            {{ t('profile.telegramBinding.joinHint', { bot: botLabel }) }}
            <code class="px-1 py-0.5 rounded bg-themed-secondary">/join</code>
          </p>
          <label class="mt-2 inline-flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              class="w-4 h-4 rounded"
              :checked="binding.notifyEnabled"
              :disabled="!canMutate"
              @change="handleNotifyChange"
            />
            <span class="text-xs text-themed">{{ t('profile.telegramBinding.notifyLabel') }}</span>
            <span v-if="savingNotify" role="status" class="text-xs text-themed-muted">{{ t('common.saving') }}</span>
          </label>
          <p class="text-xs text-themed-muted mt-1">{{ t('profile.telegramBinding.notifyHint') }}</p>
          <p v-if="binding.notifyLastError" class="text-xs text-amber-600 dark:text-amber-400 mt-1 break-all">
            {{ t('profile.telegramBinding.notifyErrorHint', { error: binding.notifyLastError }) }}
          </p>
        </div>
        <button class="btn-ghost btn-sm text-error" :disabled="!canMutate" @click="unlinkTelegram">
          {{ unlinking ? t('profile.telegramBinding.unlinking') : t('profile.telegramBinding.unlink') }}
        </button>
      </div>
    </div>

    <div v-else-if="ready && !readError && isAvailable" class="space-y-4">
      <div class="p-4 bg-themed-tertiary border border-themed rounded-xl">
        <div class="text-sm text-themed font-medium">{{ t('profile.telegramBinding.unboundTitle') }}</div>
        <p class="text-xs text-themed-muted mt-1">
          {{ t('profile.telegramBinding.unboundDescription', { bot: botLabel }) }}
        </p>
      </div>

      <div class="flex flex-col sm:flex-row gap-2">
        <button class="btn-secondary btn-sm" :disabled="!canMutate" @click="createBindToken">
          {{ generating ? t('profile.telegramBinding.generating') : t('profile.telegramBinding.generate') }}
        </button>
        <a
          v-if="bindUrl"
          class="btn-primary btn-sm text-center"
          :href="bindUrl"
          target="_blank"
          rel="noopener noreferrer"
        >
          {{ t('profile.telegramBinding.openTelegram') }}
        </a>
        <button v-if="bindUrl" class="btn-ghost btn-sm" @click="copyBindUrl">
          {{ t('profile.telegramBinding.copyLink') }}
        </button>
      </div>

      <div v-if="bindUrl" class="p-3 rounded-lg bg-themed-secondary/50 border border-themed">
        <p class="text-xs text-themed-muted mb-2">
          {{ t('profile.telegramBinding.linkHint') }}
        </p>
        <p class="break-all text-xs text-themed">{{ bindUrl }}</p>
        <p v-if="expiresAt" class="text-xs text-themed-muted mt-2 tabular-nums">
          {{ t('profile.telegramBinding.expiresAt', { date: formatDate(expiresAt) }) }}
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.nimbus-section {
  border-radius: 16px;
  padding: 1.5rem;
  background: var(--kawaii-surface) !important;
  box-shadow: none !important;
}

.nimbus-section .text-themed-muted {
  color: var(--kawaii-muted) !important;
}

.nimbus-section :is(.btn-primary, .btn-secondary, .btn-ghost) {
  color: var(--kawaii-text) !important;
  background-image: none !important;
  box-shadow: none !important;
  transform: none !important;
}

.nimbus-section .btn-primary {
  background-color: var(--kawaii-text) !important;
  color: var(--kawaii-surface) !important;
}

.nimbus-section .btn-primary::before {
  content: none !important;
}

.nimbus-section .text-error {
  color: #b91c1c !important;
}

.dark .nimbus-section .text-error {
  color: #f87171 !important;
}

.nimbus-section :is(button, a):focus-visible,
.nimbus-section input:focus-visible {
  outline: 2px solid var(--kawaii-text);
  outline-offset: 3px;
}

.nimbus-section input {
  accent-color: var(--kawaii-text);
}

.nimbus-section .text-xs {
  font-size: 0.8125rem;
  line-height: 1.25rem;
}

@media (max-width: 640px) {
  .nimbus-section :is(.btn-primary, .btn-secondary, .btn-ghost),
  .nimbus-section label {
    min-height: 44px;
  }
}

.nimbus-section-title {
  font-size: 0.9375rem;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--kawaii-text);
}

.nimbus-section-desc {
  margin-top: 0.15rem;
  font-size: 0.8125rem;
  color: var(--kawaii-muted);
}
</style>
