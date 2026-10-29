<script setup lang="ts">
import { computed, onMounted, onActivated, onDeactivated, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api'
import { useToast } from '@/stores/toast'
import { useThemeStore } from '@/stores/theme'
import { useAuthStore } from '@/stores/auth'
import DistroIcon from '@/components/icons/DistroIcon.vue'
import type { HostImagePolicy, SystemImage } from '@/types/api'

interface Props {
  hostId: number
  hostName: string
}

const props = defineProps<Props>()

const { t } = useI18n()
const toast = useToast()
const themeStore = useThemeStore()
const authStore = useAuthStore()

const loading = ref(true)
const saving = ref(false)
const searchQuery = ref('')
const useDefaultMode = ref(true)
const selectedImageIds = ref<number[]>([])
const images = ref<SystemImage[]>([])
const hostArchitecture = ref<'x86_64' | 'aarch64'>('x86_64')
const hostInstanceType = ref<'container' | 'vm' | 'both'>('container')
const policyReady = ref(false), policyError = ref(''), saveError = ref(''), active = ref(false)
let currentWrite: (() => boolean) | null = null
let alive = true, generation = 0, readSequence = 0, draftGeneration = 0
const session = computed(() => {
  if (!authStore.user || !authStore.token || !Number.isSafeInteger(authStore.user.id) || authStore.user.id < 1) return ''
  let identity = authStore.token
  try {
    const payload = JSON.parse(atob(identity.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    if (typeof payload.sid === 'string' && payload.sid) identity = payload.sid
  } catch { /* Legacy tokens retain their complete identity. */ }
  return `${authStore.user.id}:${authStore.user.role}:${identity}`
})
const available = computed(() => alive && active.value && !!session.value && Number.isSafeInteger(props.hostId) && props.hostId > 0)
const editingDisabled = computed(() => !available.value || loading.value || saving.value || !policyReady.value || !!policyError.value)
function context() {
  const hostId = props.hostId, identity = session.value, version = generation
  return { hostId, current: () => available.value && hostId === props.hostId && identity === session.value && version === generation }
}
watch([useDefaultMode, () => selectedImageIds.value.join(',')], () => { draftGeneration++ }, { flush: 'sync' })

function validPolicy(value: unknown, hostId: number): value is HostImagePolicy {
  if (!value || typeof value !== 'object') return false
  const row = value as HostImagePolicy
  return row.success === true && row.host?.id === hostId && typeof row.host.name === 'string' &&
    ['x86_64', 'aarch64'].includes(row.host.architecture) && ['container', 'vm', 'both'].includes(row.host.instanceType) &&
    typeof row.useDefault === 'boolean' && Array.isArray(row.allowedImageIds) &&
    row.allowedImageIds.every(id => Number.isSafeInteger(id) && id > 0) && new Set(row.allowedImageIds).size === row.allowedImageIds.length &&
    Array.isArray(row.images) && row.images.every(image => image && Number.isSafeInteger(image.id) && image.id > 0 &&
      typeof image.name === 'string' && typeof image.remoteAlias === 'string' && typeof image.icon === 'string' && typeof image.osType === 'string' &&
      ['x86_64', 'aarch64'].includes(image.architecture) && (image.instanceType === undefined || ['container', 'vm', 'both'].includes(image.instanceType))) &&
    new Set(row.images.map(image => image.id)).size === row.images.length &&
    row.allowedImageIds.every(id => row.images.some(image => image.id === id)) &&
    (!row.useDefault || row.allowedImageIds.length === 0)
}
function applyPolicy(response: HostImagePolicy) {
  useDefaultMode.value = response.useDefault
  selectedImageIds.value = [...response.allowedImageIds]
  images.value = response.images.map(image => ({ ...image }))
  hostArchitecture.value = response.host.architecture
  hostInstanceType.value = response.host.instanceType
  policyReady.value = true
}

const selectedCount = computed(() => selectedImageIds.value.length)

const filteredImages = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) return images.value

  return images.value.filter(image =>
    image.name.toLowerCase().includes(query) ||
    image.remoteAlias.toLowerCase().includes(query) ||
    image.icon.toLowerCase().includes(query)
  )
})

const canSave = computed(() => {
  if (editingDisabled.value) return false
  if (useDefaultMode.value) return true
  return selectedCount.value > 0 && selectedImageIds.value.every(id => images.value.some(image => image.id === id))
})

function isSelected(imageId: number): boolean {
  return selectedImageIds.value.includes(imageId)
}

function toggleImage(imageId: number): void {
  if (editingDisabled.value || !images.value.some(image => image.id === imageId)) return
  if (useDefaultMode.value) {
    useDefaultMode.value = false
  }

  if (isSelected(imageId)) {
    selectedImageIds.value = selectedImageIds.value.filter(id => id !== imageId)
    return
  }

  selectedImageIds.value = [...selectedImageIds.value, imageId]
}

function formatInstanceType(instanceType?: 'container' | 'vm' | 'both'): string {
  if (instanceType === 'container') return t('admin.images.typeContainer')
  if (instanceType === 'vm') return t('admin.images.typeVm')
  return t('admin.images.typeBoth')
}

async function loadPolicy(): Promise<void> {
  if (!available.value || currentWrite?.()) return
  const target = context(), sequence = ++readSequence, draft = draftGeneration
  const owns = () => target.current() && sequence === readSequence
  loading.value = true
  policyError.value = ''
  try {
    const response = await api.hosts.getImagePolicy(target.hostId)
    if (!owns() || draft !== draftGeneration) return
    if (!validPolicy(response, target.hostId)) throw Error(t('admin.hosts.imagePolicy.loadFailed'))
    applyPolicy(response)
  } catch (err: any) {
    if (owns() && draft === draftGeneration) policyError.value = t('admin.hosts.imagePolicy.loadFailed') + ': ' + (err?.message || String(err))
  } finally {
    if (owns()) loading.value = false
  }
}

async function savePolicy(): Promise<void> {
  if (!canSave.value) return
  const target = context(), draft = draftGeneration
  const payload = { useDefault: useDefaultMode.value, imageIds: useDefaultMode.value ? [] : [...selectedImageIds.value] }
  const owns = () => target.current() && draft === draftGeneration
  saving.value = true
  currentWrite = target.current
  readSequence++; loading.value = false; saveError.value = ''
  try {
    const response = await api.hosts.updateImagePolicy(target.hostId, payload)
    if (!owns()) return
    if (!validPolicy(response, target.hostId) || typeof response.message !== 'string' || !response.message.trim() ||
      response.useDefault !== payload.useDefault || (!payload.useDefault &&
        (response.allowedImageIds.length !== payload.imageIds.length || !payload.imageIds.every(id => response.allowedImageIds.includes(id))))) {
      throw Error(t('admin.hosts.imagePolicy.saveFailed'))
    }
    applyPolicy(response)
    toast.success(t('admin.hosts.imagePolicy.saveSuccess'))
  } catch (err: any) {
    if (owns()) saveError.value = t('admin.hosts.imagePolicy.saveFailed') + ': ' + (err?.message || String(err))
  } finally {
    currentWrite = null
    saving.value = false
  }
}

function invalidatePolicy() {
  generation++; readSequence++
  searchQuery.value = ''
  policyReady.value = false; policyError.value = ''; saveError.value = ''; loading.value = false
  useDefaultMode.value = true; selectedImageIds.value = []; images.value = []
}
watch([() => props.hostId, session], () => { invalidatePolicy(); if (available.value) void loadPolicy() }, { flush: 'sync' })
function activate() {
  if (!alive || active.value) return
  active.value = true
  if (available.value) void loadPolicy()
}
onMounted(activate)
onActivated(activate)
onDeactivated(() => { active.value = false; invalidatePolicy() })
onBeforeUnmount(() => { alive = false; active.value = false; invalidatePolicy() })
</script>

<template>
  <div class="host-images space-y-6">
    <div
      class="card p-5"
      :class="themeStore.isDark ? 'border border-gray-800' : 'border border-gray-200'"
    >
      <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div class="space-y-2">
          <div class="flex flex-wrap items-center gap-2">
            <h3 class="text-base font-medium text-themed">{{ t('admin.hosts.imagePolicy.title') }}</h3>
            <span
              v-if="policyReady"
              class="px-2 py-1 text-xs rounded-full"
              :class="themeStore.isDark ? 'bg-gray-800 text-gray-300' : 'bg-gray-100 text-gray-700'"
            >
              {{ t('admin.images.fields.architecture') }}: {{ hostArchitecture }}
            </span>
            <span
              v-if="policyReady"
              class="px-2 py-1 text-xs rounded-full"
              :class="themeStore.isDark ? 'bg-gray-800 text-gray-300' : 'bg-gray-100 text-gray-700'"
            >
              {{ t('admin.images.fields.instanceType') }}: {{ formatInstanceType(hostInstanceType) }}
            </span>
          </div>
          <p class="text-sm text-themed-muted">{{ t('admin.hosts.imagePolicy.description', { name: props.hostName }) }}</p>
        </div>
        <button class="btn-secondary whitespace-nowrap" :disabled="!available || loading || saving" :aria-busy="loading" @click="loadPolicy">
          {{ t('admin.images.refresh') }}
        </button>
      </div>
    </div>

    <div v-if="policyError" data-host-policy-error class="card p-5 space-y-3" role="alert">
      <p class="text-sm text-themed break-words">{{ policyError }}</p>
      <button type="button" class="btn-secondary" :disabled="loading || saving || !available" @click="loadPolicy">{{ t('common.retry') }}</button>
    </div>
    <div v-if="loading && !policyReady" class="card p-10 text-center text-themed-muted" role="status">
      <div class="loading-spinner w-8 h-8 mx-auto"></div>
      <p class="mt-4">{{ t('common.loading') }}</p>
    </div>

    <template v-else-if="policyReady">
      <div class="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <button
          type="button"
          class="card p-5 text-left transition-colors"
          :disabled="editingDisabled"
          :aria-pressed="useDefaultMode"
          :class="useDefaultMode
            ? (themeStore.isDark ? 'border border-blue-500 bg-blue-900/10' : 'border border-blue-300 bg-blue-50')
            : (themeStore.isDark ? 'border border-gray-800 hover:border-gray-700' : 'border border-gray-200 hover:border-gray-300')"
          @click="useDefaultMode = true"
        >
          <div class="flex items-center justify-between gap-3">
            <div>
              <h4 class="text-sm font-medium text-themed">{{ t('admin.hosts.imagePolicy.defaultMode') }}</h4>
              <p class="mt-1 text-xs text-themed-muted">{{ t('admin.hosts.imagePolicy.defaultDesc') }}</p>
            </div>
            <div
              class="w-5 h-5 rounded-full border flex items-center justify-center"
              :class="useDefaultMode
                ? 'border-accent bg-accent text-white dark:text-black'
                : (themeStore.isDark ? 'border-gray-700' : 'border-gray-300')"
            >
              <svg class="w-3 h-3" :class="{ 'opacity-0': !useDefaultMode }" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 111.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
              </svg>
            </div>
          </div>
        </button>

        <button
          type="button"
          class="card p-5 text-left transition-colors"
          :disabled="editingDisabled"
          :aria-pressed="!useDefaultMode"
          :class="!useDefaultMode
            ? (themeStore.isDark ? 'border border-blue-500 bg-blue-900/10' : 'border border-blue-300 bg-blue-50')
            : (themeStore.isDark ? 'border border-gray-800 hover:border-gray-700' : 'border border-gray-200 hover:border-gray-300')"
          @click="useDefaultMode = false"
        >
          <div class="flex items-center justify-between gap-3">
            <div>
              <h4 class="text-sm font-medium text-themed">{{ t('admin.hosts.imagePolicy.restrictedMode') }}</h4>
              <p class="mt-1 text-xs text-themed-muted">{{ t('admin.hosts.imagePolicy.restrictedDesc') }}</p>
            </div>
            <div
              class="w-5 h-5 rounded-full border flex items-center justify-center"
              :class="!useDefaultMode
                ? 'border-accent bg-accent text-white dark:text-black'
                : (themeStore.isDark ? 'border-gray-700' : 'border-gray-300')"
            >
              <svg class="w-3 h-3" :class="{ 'opacity-0': useDefaultMode }" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 111.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
              </svg>
            </div>
          </div>
        </button>
      </div>

      <div class="card p-5 space-y-4">
        <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div class="space-y-1">
            <p class="text-sm font-medium text-themed">{{ t('admin.hosts.imagePolicy.selectableImages') }}</p>
            <p class="text-xs text-themed-muted">
              {{ useDefaultMode ? t('admin.hosts.imagePolicy.defaultHint') : t('admin.hosts.imagePolicy.selectedCount', { count: selectedCount }) }}
            </p>
          </div>
          <input
            v-model="searchQuery"
            type="text"
            class="input lg:w-80"
            :aria-label="t('admin.hosts.imagePolicy.searchPlaceholder')"
            :placeholder="t('admin.hosts.imagePolicy.searchPlaceholder')"
          />
        </div>

        <div v-if="!useDefaultMode && selectedCount === 0" class="text-sm text-orange-500 dark:text-orange-400">
          {{ t('admin.hosts.imagePolicy.emptySelection') }}
        </div>

        <div v-if="images.length === 0" class="py-10 text-center text-themed-muted">
          <p>{{ t('admin.hosts.imagePolicy.noImages') }}</p>
        </div>

        <div v-else-if="filteredImages.length === 0" class="py-10 text-center text-themed-muted">
          {{ t('common.noSearchResults') }}
        </div>

        <div v-else class="grid grid-cols-1 xl:grid-cols-2 gap-3">
          <button
            v-for="image in filteredImages"
            :key="image.id"
            type="button"
            class="rounded-xl border p-4 text-left transition-colors"
            :disabled="editingDisabled"
            :aria-pressed="isSelected(image.id)"
            :class="[
              isSelected(image.id)
                ? (themeStore.isDark ? 'border-blue-500 bg-blue-900/10' : 'border-blue-300 bg-blue-50')
                : (themeStore.isDark ? 'border-gray-800 hover:border-gray-700' : 'border-gray-200 hover:border-gray-300'),
              useDefaultMode ? 'opacity-70' : ''
            ]"
            @click="toggleImage(image.id)"
          >
            <div class="flex items-start gap-3">
              <DistroIcon :distro="image.icon" :size="32" class="flex-shrink-0" />
              <div class="min-w-0 flex-1 space-y-2">
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <div class="text-sm font-medium text-themed truncate">{{ image.name }}</div>
                    <div class="text-xs text-themed-muted break-all">{{ image.remoteAlias }}</div>
                  </div>
                  <div
                    class="w-5 h-5 rounded-full border flex-shrink-0 flex items-center justify-center"
                    :class="isSelected(image.id)
                      ? 'border-accent bg-accent text-white dark:text-black'
                      : (themeStore.isDark ? 'border-gray-700' : 'border-gray-300')"
                  >
                    <svg class="w-3 h-3" :class="{ 'opacity-0': !isSelected(image.id) }" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                      <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 111.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                    </svg>
                  </div>
                </div>

                <div class="flex flex-wrap items-center gap-2">
                  <span
                    class="px-2 py-1 text-xs rounded-full"
                    :class="themeStore.isDark ? 'bg-gray-800 text-gray-300' : 'bg-gray-100 text-gray-700'"
                  >
                    {{ formatInstanceType(image.instanceType) }}
                  </span>
                  <span
                    class="px-2 py-1 text-xs rounded-full"
                    :class="themeStore.isDark ? 'bg-gray-800 text-gray-300' : 'bg-gray-100 text-gray-700'"
                  >
                    {{ image.architecture }}
                  </span>
                </div>
              </div>
            </div>
          </button>
        </div>
      </div>

      <div class="flex justify-end">
        <button class="btn-primary" :disabled="!canSave" :aria-busy="saving" @click="savePolicy">
          <span v-if="saving" class="loading-spinner w-4 h-4 mr-2"></span>
          {{ saving ? t('common.loading') : t('common.save') }}
        </button>
      </div>
      <p v-if="saveError" data-host-policy-save-error class="text-sm text-themed break-words" role="alert">{{ saveError }}</p>
    </template>
  </div>
</template>

<style scoped>
.host-images { --text-primary: #111111; --text-secondary: #555555; --bg-tertiary: #eeeeee; }
.dark .host-images { --text-primary: #ffffff; --text-secondary: #b4b4b4; --bg-tertiary: #222222; }
.host-images .card,
.host-images button {
  box-shadow: none !important;
  background-image: none !important;
}
.host-images button:focus-visible,
.host-images input:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 3px;
}
.host-images button:disabled { cursor: not-allowed; }
.host-images [aria-pressed="true"] {
  border-color: var(--text-primary);
  background-color: var(--bg-tertiary);
}
.host-images [aria-pressed="true"] .bg-accent {
  background-color: var(--text-primary);
  border-color: var(--text-primary);
  color: var(--bg-tertiary);
}
.host-images .btn-primary {
  background-color: var(--text-primary) !important;
  border-color: var(--text-primary) !important;
  color: var(--bg-tertiary) !important;
}
.host-images .text-xs { font-size: 13px; }
.host-images .text-themed-muted { color: var(--text-secondary); }
@media (max-width: 640px) {
  .host-images button, .host-images input { min-height: 44px; }
  .host-images .text-xs { font-size: 13px; }
}
@media (prefers-reduced-motion: reduce) {
  .host-images *, .host-images .loading-spinner { transition: none; animation: none; }
}
</style>
