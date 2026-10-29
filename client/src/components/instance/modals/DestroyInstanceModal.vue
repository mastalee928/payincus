<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useThemeStore } from '@/stores/theme'
import DestroyEmailVerificationFields from '@/components/instance/DestroyEmailVerificationFields.vue'
import { useDialogFocus } from '@/composables/useDialogFocus'

const { t } = useI18n()
const themeStore = useThemeStore()

interface DestroyInfo {
  canDestroy: boolean
  cannotDestroyReason: string
  isFreeInstance: boolean
  isFirstTime: boolean
  rules: {
    feeRate: number
  }
  refund: {
    remainingDays: number
    remainingValue: number
    feeRate: number
    feeAmount: number
    refundAmount: number
    destroyCount: number
    maxRefundable: number
  }
  instance: {
    id: number
    name: string
    hostName: string
    planName: string | null
  }
}

interface Props {
  visible: boolean
  loading: boolean
  destroyInfo: DestroyInfo | null
  error?: string
  /** 父组件解析好的 OCI 机型名（E2 / ARM），当前方案行优先展示 */
  machineShape?: string
  regionLabel?: string
}

interface Emits {
  (e: 'update:visible', value: boolean): void
  (e: 'destroy', emailCode: string): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const emailCode = ref('')
const dialogRoot = ref<HTMLElement | null>(null)
useDialogFocus(dialogRoot, () => props.visible, close)

// 是否可以执行销毁
const canExecuteDestroy = computed(() => {
  if (!props.destroyInfo) return false
  return props.destroyInfo.canDestroy && /^\d{6}$/.test(emailCode.value) && !props.loading
})

// 重置状态
watch([() => props.visible, () => props.destroyInfo?.instance.id], () => { emailCode.value = '' }, { flush: 'sync' })

function close() {
  if (props.loading) return
  emit('update:visible', false)
}

function handleDestroy() {
  if (canExecuteDestroy.value) {
    emit('destroy', emailCode.value)
  }
}

</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <!-- Backdrop -->
      <div 
        class="absolute inset-0"
        :class="themeStore.isDark ? 'bg-black/60' : 'bg-black/30'"
        @click="close"
      ></div>
      
      <!-- Modal -->
      <div 
        ref="dialogRoot" tabindex="-1"
        class="destroy-instance-dialog relative w-full max-w-lg border rounded-xl shadow-xl max-h-[90vh] overflow-y-auto"
        role="dialog" aria-modal="true" aria-labelledby="destroy-instance-title"
        :class="'bg-themed-surface border-themed'"
      >
        <!-- Header -->
        <div 
          class="flex items-center justify-between p-5 border-b sticky top-0 z-10"
          :class="'border-themed bg-themed-surface'"
        >
          <div class="flex items-center gap-3">
            <div>
              <svg class="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </div>
            <h3 
              id="destroy-instance-title"
              class="text-base font-medium"
              :class="themeStore.isDark ? 'text-gray-100' : 'text-gray-900'"
            >
              {{ t('instance.destroy.title') }}
            </h3>
          </div>
          <button 
            type="button" :disabled="loading" :aria-label="t('common.close')" class="min-h-11 min-w-11"
            :class="themeStore.isDark ? 'text-gray-500 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600'" 
            @click="close"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        <div class="p-5 space-y-4">
          <!-- Loading state -->
          <div v-if="!destroyInfo" class="flex items-center justify-center py-8">
            <svg class="w-8 h-8 animate-spin text-blue-500" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>

          <template v-else>
            <!-- Warning -->
            <div class="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
              <div class="flex items-start gap-2">
                <svg class="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <p class="text-sm text-red-700 dark:text-red-400 font-medium">
                  {{ destroyInfo.isFreeInstance ? t('instance.destroy.warningFree') : t('instance.destroy.warning') }}
                </p>
              </div>
            </div>

            <!-- Cannot destroy reason -->
            <div 
              v-if="!destroyInfo.canDestroy" 
              class="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20"
            >
              <div class="flex items-start gap-2">
                <svg class="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p 
                  class="text-sm font-medium"
                  :class="themeStore.isDark ? 'text-yellow-400' : 'text-yellow-600'"
                >
                  {{ destroyInfo.cannotDestroyReason || t('instance.destroy.cannotDestroy') }}
                </p>
              </div>
            </div>

            <!-- Instance Info -->
            <div 
              class="rounded-lg p-3 space-y-2"
              :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-50'"
            >
              <p 
                class="text-xs font-medium mb-2 text-themed-muted"
              >
                {{ t('instance.destroy.instanceInfo') }}
              </p>
              <table class="w-full table-fixed text-sm text-left">
                <thead class="text-themed-muted"><tr><th class="w-1/2 pb-2 font-medium">{{ t('instance.destroy.instanceName') }}</th><th class="w-1/2 pb-2 font-medium">{{ t('instance.card.region') }}</th></tr></thead>
                <tbody class="text-themed"><tr><td class="align-top break-words pr-3">{{ destroyInfo.instance.name }}<span class="block text-xs text-themed-muted">{{ t('instance.destroy.instanceNumber', { id: destroyInfo.instance.id }) }}</span></td><td class="align-top break-words">{{ regionLabel || '—' }}</td></tr></tbody>
              </table>
            </div>

            <DestroyEmailVerificationFields v-if="destroyInfo.canDestroy" v-model="emailCode" :instance-ids="[destroyInfo.instance.id]" :disabled="loading" />
            <p v-if="error" role="alert" class="text-sm leading-relaxed text-red-600 dark:text-red-400">{{ error }}</p>

            <!-- Action buttons -->
            <div class="flex justify-end gap-3 pt-2">
              <button 
                type="button" 
                class="btn-secondary min-h-11" :disabled="loading"
                @click="close"
              >
                {{ t('instance.destroy.cancel') }}
              </button>
              <button 
                :disabled="!canExecuteDestroy"
                class="btn-danger min-h-11 destroy-confirm"
                @click="handleDestroy"
              >
                <svg v-if="loading" class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                {{ loading ? t('instance.destroy.destroying') : t('instance.destroy.confirmButton') }}
              </button>
            </div>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style>
.destroy-instance-dialog .text-themed-muted { color: #525252 !important; }
.dark .destroy-instance-dialog .text-themed-muted { color: #b4b4b4 !important; }
.destroy-instance-dialog .destroy-confirm { background-color: #b91c1c !important; color: #fff !important; }
.destroy-instance-dialog .destroy-confirm:hover:not(:disabled) { background-color: #991b1b !important; }
.destroy-instance-dialog .destroy-confirm:disabled { background-color: #e5e5e5 !important; color: #525252 !important; opacity: 1; }
.dark .destroy-instance-dialog .destroy-confirm:disabled { background-color: #262626 !important; color: #b4b4b4 !important; }
</style>
