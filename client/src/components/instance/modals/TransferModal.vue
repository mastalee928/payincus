<script setup lang="ts">
import { ref, shallowRef, computed, watch, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api'
import { useThemeStore } from '@/stores/theme'
import { useToast } from '@/stores/toast'
import { useConfigStore } from '@/stores/config'
import { useAuthStore } from '@/stores/auth'
import { translateError } from '@/utils/errorHandler'
import SensitiveVerificationModal from '@/components/SensitiveVerificationModal.vue'

const props = defineProps<{
  show: boolean
  instance: {
    id: number
    name: string
    cpu: number
    memory: number
    disk: number
    dedicatedIpv4?: boolean
  }
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'success'): void
}>()

const { t } = useI18n()
const themeStore = useThemeStore()
const toast = useToast()
const configStore = useConfigStore()
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

// 表单状态
const targetUsername = ref('')
const remark = ref('')
const searchLoading = ref(false)
// Keep a submitted request busy until it settles, including after close/reopen.
const pendingTransfers = ref(0)
const transferLoading = computed(() => pendingTransfers.value > 0)
const verificationAttempt = shallowRef<{
  key: number; instanceId: number; verified: () => void; close: () => void
} | null>(null)
const searchError = ref('')

// 用户余额
const userBalance = ref<number>(0)
const loadingBalance = ref(false)

// 目标用户信息
interface TargetUser {
  id: number
  username: string
  status: string
}
const targetUser = ref<TargetUser | null>(null)

let alive = true
let generation = 0
let searchSequence = 0
let draftRevision = 0
let verificationSequence = 0
function captureContext() {
  const currentGeneration = generation, session = sessionKey.value, instanceId = props.instance.id
  return { instanceId, current: () => alive && props.show && !!session && session === sessionKey.value &&
    currentGeneration === generation && instanceId === props.instance.id && Number.isSafeInteger(instanceId) && instanceId > 0 }
}
// 转移手续费（从配置获取）
const transferFee = computed(() => configStore.transferFee || 0)

// 余额是否足够
const hasEnoughBalance = computed(() => {
  if (transferFee.value <= 0) return true
  return userBalance.value >= transferFee.value
})

// 用户状态检查（用户存在且未被封禁且余额足够）
const canTransfer = computed(() => {
  return alive && props.show && !!sessionKey.value && Number.isSafeInteger(props.instance.id) && props.instance.id > 0 &&
    !searchLoading.value && !loadingBalance.value && !transferLoading.value && !verificationAttempt.value &&
    targetUser.value !== null && targetUser.value.username === targetUsername.value.trim() && targetUser.value.status === 'active' && hasEnoughBalance.value
})

watch(targetUsername, () => {
  searchSequence++
  searchLoading.value = false
  targetUser.value = null
  searchError.value = ''
}, { flush: 'sync' })
watch([targetUsername, remark, () => targetUser.value?.id, () => targetUser.value?.status, transferFee], () => {
  draftRevision++
  verificationAttempt.value = null
}, { flush: 'sync' })

// Each opening, instance and authenticated session owns its reads and draft.
watch([() => props.show, () => props.instance.id, sessionKey], async () => {
  generation++
  searchSequence++
  draftRevision++
  targetUsername.value = ''
  remark.value = ''
  targetUser.value = null
  searchError.value = ''
  searchLoading.value = false
  userBalance.value = 0
  loadingBalance.value = false
  verificationAttempt.value = null
  const context = captureContext()
  if (context.current()) {
    // 加载用户余额
    if (transferFee.value > 0) {
      loadingBalance.value = true
      try {
        const res = await api.billing.getUserBalance()
        if (context.current()) userBalance.value = Number.isFinite(res.balance.balance) ? res.balance.balance : 0
      } catch {
        if (context.current()) userBalance.value = 0
      } finally {
        if (context.current()) loadingBalance.value = false
      }
    }
  }
}, { immediate: true, flush: 'sync' })

onBeforeUnmount(() => { alive = false; generation++; verificationAttempt.value = null })

async function searchUser() {
  if (!targetUsername.value.trim() || searchLoading.value || transferLoading.value) return
  const context = captureContext()
  if (!context.current()) return
  const sequence = ++searchSequence
  const searchedUsername = targetUsername.value.trim()
  const current = () => context.current() && sequence === searchSequence && targetUsername.value.trim() === searchedUsername
  
  searchLoading.value = true
  searchError.value = ''
  targetUser.value = null
  
  try {
    const response = await api.transfers.searchUser(searchedUsername)
    if (current() && response.user?.username === searchedUsername) targetUser.value = response.user
  } catch (error: any) {
    if (!current()) return
    if (error?.code === 'USER_NOT_FOUND') {
      searchError.value = t('transfer.modal.userNotFound')
    } else if (error?.code === 'TRANSFER_TO_SELF') {
      searchError.value = t('transfer.modal.cannotTransferToSelf')
    } else if (error?.code === 'TRANSFER_TO_BANNED') {
      searchError.value = t('transfer.modal.userBanned')
    } else {
      searchError.value = error?.message || t('common.error')
    }
  } finally {
    if (current()) searchLoading.value = false
  }
}

async function handleTransfer() {
  if (!targetUser.value || !canTransfer.value || transferLoading.value) return
  const context = captureContext(), revision = draftRevision
  const draft = { instanceId: context.instanceId, username: targetUser.value.username, remark: remark.value || undefined,
    current: () => context.current() && revision === draftRevision }
  await submitTransfer(draft)
}

async function submitTransfer(draft: { instanceId: number; username: string; remark?: string; current: () => boolean }) {
  if (!draft.current() || !canTransfer.value || transferLoading.value) return
  pendingTransfers.value++
  try {
    await api.transfers.create(draft.instanceId, draft.username, draft.remark)
    if (!draft.current()) return
    toast.success(t('transfer.messages.transferSuccess'))
    emit('success')
    emit('close')
  } catch (error: any) {
    if (!draft.current()) return
    if (error?.code === 'VERIFICATION_REQUIRED') {
      const attempt = { key: ++verificationSequence, instanceId: draft.instanceId,
        close: () => { if (verificationAttempt.value === attempt) verificationAttempt.value = null },
        verified: () => {
          if (verificationAttempt.value !== attempt || !draft.current()) return
          verificationAttempt.value = null
          void submitTransfer(draft)
        },
      }
      verificationAttempt.value = attempt
    }
    else toast.error(translateError(error))
  } finally {
    pendingTransfers.value--
  }
}


function formatMemory(mb: number) {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  return `${mb} MB`
}

// 硬盘格式化（1024进制）
function formatDisk(mb: number) {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  return `${mb} MB`
}
</script>

<template>
  <div 
    v-if="show"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
    @click.self="!transferLoading && emit('close')"
  >
    <div 
      class="w-full max-w-lg p-6 rounded-lg shadow-xl max-h-[90vh] overflow-y-auto"
      :class="themeStore.isDark ? 'bg-gray-900' : 'bg-white'"
      role="dialog" aria-modal="true" aria-labelledby="user-push-title"
    >
      <h3 id="user-push-title" class="text-lg font-medium mb-4">{{ $t('transfer.modal.title') }}</h3>
      <p class="mb-4 text-sm text-themed-muted">{{ t('transfer.modal.requestHint') }}</p>
      
      <div class="space-y-4">
        <!-- Instance Info -->
        <div 
          class="p-3 rounded-lg"
          :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-100'"
        >
          <div class="font-medium">{{ instance.name }}</div>
          <div class="text-sm text-gray-500 mt-1">
            {{ instance.dedicatedIpv4 ? `${instance.cpu / 100} ${t('instance.selector.cores')}` : `${instance.cpu}% CPU` }} · {{ formatMemory(instance.memory) }} · {{ formatDisk(instance.disk) }}
          </div>
        </div>

        <!-- Target User Search -->
        <div>
          <label class="block text-sm font-medium mb-1">{{ $t('transfer.modal.targetUser') }}</label>
          <div class="flex gap-2">
            <input
              v-model="targetUsername"
              type="text"
              class="input flex-1"
              maxlength="64" :disabled="transferLoading" autocomplete="off"
              :placeholder="$t('transfer.modal.targetUserPlaceholder')"
              @keyup.enter="searchUser"
            />
            <button 
              class="btn-secondary"
              :disabled="searchLoading || transferLoading || !targetUsername.trim()"
              @click="searchUser"
            >
              {{ searchLoading ? '...' : $t('transfer.modal.searchUser') }}
            </button>
          </div>
          <p v-if="searchError" class="text-sm text-red-500 mt-1">{{ searchError }}</p>
        </div>

        <!-- Target User Info -->
        <div 
          v-if="targetUser"
          class="p-4 rounded-lg border"
          :class="themeStore.isDark ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-200'"
        >
          <div class="flex items-center justify-between mb-2">
            <div class="font-medium">{{ targetUser.username }}</div>
            <span 
              :class="[
                'badge',
                targetUser.status === 'active' ? 'badge-success' : 'badge-danger'
              ]"
            >
              {{ targetUser.status === 'active' ? t('admin.users.active') : t('admin.users.banned') }}
            </span>
          </div>

          <!-- User Status Check -->
          <div 
            v-if="canTransfer"
            class="mt-2 p-2 rounded text-sm"
            :class="themeStore.isDark ? 'bg-green-900/30 text-green-400' : 'bg-green-100 text-green-700'"
          >
            {{ $t('transfer.modal.canTransfer') }}
          </div>
        </div>

        <!-- Remark -->
        <div>
          <label class="block text-sm font-medium mb-1">{{ $t('transfer.modal.remark') }}</label>
          <textarea
            v-model="remark"
            maxlength="200" :disabled="transferLoading"
            class="input w-full h-20 resize-none"
            :placeholder="$t('transfer.modal.remarkPlaceholder')"
          ></textarea>
        </div>

        <!-- Transfer Fee Info -->
        <div 
          v-if="transferFee > 0"
          class="p-3 rounded-lg text-sm space-y-2"
          :class="themeStore.isDark ? 'bg-blue-900/20 border border-blue-800' : 'bg-blue-50 border border-blue-200'"
        >
          <div class="flex items-center justify-between">
            <span :class="themeStore.isDark ? 'text-blue-300' : 'text-blue-700'">
              {{ $t('transfer.modal.feeLabel') }}
            </span>
            <span class="font-medium" :class="themeStore.isDark ? 'text-blue-200' : 'text-blue-800'">
              ¥{{ transferFee.toFixed(2) }}
            </span>
          </div>
          <div class="flex items-center justify-between">
            <span :class="themeStore.isDark ? 'text-blue-300' : 'text-blue-700'">
              {{ $t('transfer.modal.balanceLabel') }}
            </span>
            <span 
              class="font-medium"
              :class="hasEnoughBalance 
                ? (themeStore.isDark ? 'text-green-400' : 'text-green-600')
                : (themeStore.isDark ? 'text-red-400' : 'text-red-600')"
            >
              <template v-if="loadingBalance">...</template>
              <template v-else>¥{{ userBalance.toFixed(2) }}</template>
            </span>
          </div>
          <!-- Insufficient Balance Warning -->
          <div 
            v-if="!hasEnoughBalance && !loadingBalance"
            class="pt-2 border-t"
            :class="themeStore.isDark ? 'border-red-800' : 'border-red-200'"
          >
            <p class="text-red-500">{{ $t('transfer.modal.insufficientBalance') }}</p>
          </div>
          <!-- Fee Refund Hint -->
          <p 
            class="text-xs"
            :class="themeStore.isDark ? 'text-blue-400/70' : 'text-blue-600/70'"
          >
            {{ $t('transfer.modal.feeRefundHint') }}
          </p>
        </div>

        <!-- Warning -->
        <div 
          class="p-3 rounded-lg text-sm"
          :class="themeStore.isDark ? 'bg-yellow-900/30 text-yellow-300' : 'bg-yellow-50 text-yellow-800'"
        >
          <div class="flex items-start gap-2">
            <svg class="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span>{{ t(instance.dedicatedIpv4 ? 'transfer.modal.dedicatedWarning' : 'transfer.modal.deleteWarning') }}</span>
          </div>
        </div>

        <!-- Actions -->
        <div class="flex justify-end gap-2 pt-2">
          <button class="btn-ghost" :disabled="transferLoading" @click="emit('close')">
            {{ $t('common.cancel') }}
          </button>
          <button 
            class="btn-primary"
            :disabled="!targetUser || !canTransfer || transferLoading"
            @click="handleTransfer"
          >
            {{ transferLoading ? $t('transfer.modal.transferring') : $t('transfer.modal.confirmTransfer') }}
          </button>
        </div>
      </div>
    </div>
  </div>
  <SensitiveVerificationModal
    v-if="verificationAttempt" :key="verificationAttempt.key" :show="true"
    operation-type="transfer_instance" :resource-id="verificationAttempt.instanceId"
    @close="verificationAttempt.close" @verified="verificationAttempt.verified"
  />
</template>
