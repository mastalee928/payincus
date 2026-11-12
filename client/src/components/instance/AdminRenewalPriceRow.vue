<script setup lang="ts">
import { useI18n } from 'vue-i18n'
defineProps<{ price: number | null | undefined; cycle: number | null | undefined; canEdit?: boolean }>()
const emit = defineEmits<{ edit: [] }>()
const { t } = useI18n()
</script>
<template>
  <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
    <dt class="text-themed-muted">{{ t('instanceRenewalPrice.label') }}</dt>
    <dd class="flex flex-wrap items-center justify-end gap-1 text-sm tabular-nums">
      <span>¥{{ Number(price ?? 0).toFixed(2) }} / {{ t('instanceRenewalPrice.cycle', { months: cycle || 1 }) }}</span>
      <button v-if="canEdit" type="button" class="renewal-price-edit inline-flex items-center justify-center min-h-11 min-w-11 rounded-md text-themed-muted hover:text-themed focus-visible:outline focus-visible:outline-2" :aria-label="t('instanceRenewalPrice.edit')" :title="t('instanceRenewalPrice.edit')" @click="emit('edit')">
        <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m16 3 5 5M4 16l-1 5 5-1L21 7a2 2 0 0 0-5-5Z" /></svg>
      </button>
    </dd>
  </div>
</template>
