<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { HostRecoveryReport } from '@/types/host-pool'

defineProps<{ report: HostRecoveryReport }>()
const { t } = useI18n()
function reasonText(reason: string) {
  const value = reason.toUpperCase()
  const key = /RECOVERY_HELD/.test(value) ? 'protected'
    : /AUTHORITY|AUTHORIZATION/.test(value) ? 'authority'
    : /BUSY|TASK/.test(value) ? 'busy'
    : /DISK|VOLUME|SNAPSHOT/.test(value) ? 'storage'
    : /IDENTITY|UNKNOWN|PROJECT|EVIDENCE|MISMATCH/.test(value) ? 'identity'
    : /OFFLINE|UNREACHABLE|CONNECT/.test(value) ? 'connection'
    : /NETWORK|FORWARD|PROTOCOL/.test(value) ? 'network' : 'pending'
  return t('automaticRecovery.' + key)
}
</script>

<template>
  <div class="space-y-2 text-sm" role="status">
    <template v-if="report.automaticSourceRecovery">
      <p class="font-medium text-themed">{{ t(report.automaticSourceRecovery.status === 'done' ? 'hostInventory.managementRepair.sourceDone' : 'hostInventory.managementRepair.sourceRetry') }}</p>
      <p v-if="report.automaticSourceRecovery.error" class="text-amber-700 dark:text-amber-300">{{ reasonText(report.automaticSourceRecovery.error) }}</p>
      <p v-if="report.automaticSourceRecovery.nextAttemptAt && report.automaticSourceRecovery.status !== 'done'" class="text-themed-muted">{{ t('hostPoolOps.recovery.auto.next', { time: new Date(report.automaticSourceRecovery.nextAttemptAt).toLocaleString() }) }}</p>
    </template>
    <template v-if="report.automaticCleanup && report.mode === 'preserve' && !report.automaticSourceRecovery">
      <p class="font-medium text-themed">{{ t(report.quarantined ? 'automaticRecovery.checking' : 'automaticRecovery.complete') }}</p>
      <p v-if="!report.quarantined" class="text-themed-muted">{{ t('hostPoolOps.recovery.preserve') }}</p>
    </template>
    <template v-else-if="report.automaticCleanup">
      <p class="font-medium text-themed">{{ t('hostPoolOps.recovery.auto.' + report.automaticCleanup.status) }}</p>
      <p v-if="report.automaticCleanup.status !== 'done'" class="text-themed-muted">{{ t('hostPoolOps.recovery.auto.description') }}</p>
      <p v-if="report.automaticCleanup.nextAttemptAt && report.automaticCleanup.status !== 'done'" class="text-themed-muted">{{ t('hostPoolOps.recovery.auto.next', { time: new Date(report.automaticCleanup.nextAttemptAt).toLocaleString() }) }}</p>
      <p v-if="report.automaticCleanup.error" class="break-words text-amber-700 dark:text-amber-300">{{ [...new Set(report.automaticCleanup.error.split(',').map(reasonText))].join('；') }}</p>
    </template>
    <template v-if="!report.automaticCleanup && !report.automaticSourceRecovery">
      <p class="font-medium text-themed">{{ t(report.quarantined ? 'automaticRecovery.checking' : 'automaticRecovery.complete') }}</p>
      <ul v-if="report.quarantined && report.blockers.length" class="space-y-2">
        <li v-for="reason in [...new Set(report.blockers.map(reasonText))]" :key="reason" class="text-amber-700 dark:text-amber-300">{{ reason }}</li>
      </ul>
    </template>
  </div>
</template>
