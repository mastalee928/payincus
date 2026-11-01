<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { ManagedHost } from '@/types/host-pool'
defineProps<{ state: ManagedHost['managementRepair'] }>()
const { t, te } = useI18n()
</script>

<template>
  <p v-if="state && state.status !== 'done'" class="text-sm break-words" :class="state.status === 'blocked' ? 'text-red-700 dark:text-red-300' : 'text-amber-700 dark:text-amber-300'" role="status">
    {{ t('hostInventory.managementRepair.' + state.status) }}
    <span v-if="state.error && te('hostInventory.managementRepair.errors.' + state.error)" class="block">{{ t('hostInventory.managementRepair.errors.' + state.error) }}</span>
    <span v-if="state.nextAttemptAt" class="block text-themed-muted">{{ t('hostInventory.managementRepair.next', { time: new Date(state.nextAttemptAt).toLocaleTimeString() }) }}</span>
  </p>
</template>
