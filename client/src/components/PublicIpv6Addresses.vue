<script setup lang="ts">
import { onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, Copy } from 'lucide-vue-next'
import { useToast } from '@/stores/toast'

defineProps<{ addresses: string[]; status?: string; showEmpty?: boolean }>()
const { t } = useI18n()
const toast = useToast()
const copied = ref('')
let timer: ReturnType<typeof setTimeout> | undefined
async function copy(address: string) {
  try {
    await navigator.clipboard.writeText(address)
    copied.value = address
    clearTimeout(timer)
    timer = setTimeout(() => { copied.value = '' }, 2000)
  } catch { toast.error(t('common.copyFailed')) }
}
onUnmounted(() => clearTimeout(timer))
</script>

<template>
  <div class="min-w-0 space-y-2">
    <ul v-if="addresses.length" class="space-y-1.5" :aria-label="t('ipv6Delivery.title')">
      <li v-for="(address, index) in addresses" :key="address" class="flex items-start gap-2">
        <div class="min-w-0 flex-1 py-1">
          <code class="text-sm font-mono text-themed break-all">{{ address }}</code>
          <span v-if="addresses.length > 1 && index === 0" class="ml-2 text-xs text-themed-muted">{{ t('ipv6Delivery.primary') }}</span>
        </div>
        <button type="button" class="btn-secondary shrink-0 p-2" :aria-label="t('ipv6Delivery.copyAddress', { address })" :title="t('common.copy')" @click="copy(address)">
          <Check v-if="copied === address" :size="16" class="text-green-600 dark:text-green-400" aria-hidden="true" />
          <Copy v-else :size="16" aria-hidden="true" />
        </button>
      </li>
    </ul>
    <p v-else-if="showEmpty && status !== 'pending' && status !== 'failed'" class="text-sm text-themed-muted">{{ t('ipv6Delivery.empty') }}</p>
    <p v-if="status === 'pending' || status === 'failed'" role="status" class="text-sm text-amber-700 dark:text-amber-300">{{ t(status === 'failed' ? 'ipv6Delivery.customerFailed' : 'ipv6Delivery.customerPending') }}</p>
    <span class="sr-only" aria-live="polite">{{ copied ? t('common.copied') : '' }}</span>
  </div>
</template>
