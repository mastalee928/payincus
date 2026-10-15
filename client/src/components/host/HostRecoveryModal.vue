<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api/admin'
import type { HostRecoveryReport } from '@/types/host-pool'
import { useToast } from '@/stores/toast'

const props = defineProps<{ hostId: number; hostName: string }>()
const emit = defineEmits<{ close: []; changed: []; ssh: [] }>()
const { t, te } = useI18n()
const toast = useToast()
const report = ref<HostRecoveryReport | null>(null)
const loading = ref(false)
const saving = ref(false)
const acknowledged = ref(false)
const error = ref('')
function showError(value: unknown) {
  const data = (value as { response?: { data?: { code?: string; report?: HostRecoveryReport } } })?.response?.data
  const key = 'hostPoolOps.recovery.errors.' + data?.code
  error.value = te(key) ? t(key) : t('hostPoolOps.recovery.failed')
  if (data?.report) report.value = data.report
  acknowledged.value = false
}
async function check() {
  if (loading.value || saving.value) return
  loading.value = true; error.value = ''; acknowledged.value = false
  try { report.value = await api.hostOnboarding.inspectRecovery(props.hostId) }
  catch (value) { report.value = null; showError(value) }
  finally { loading.value = false }
}
async function recover() {
  if (!report.value?.canRecover || saving.value || loading.value || (report.value.needsCleanup && !acknowledged.value)) return
  saving.value = true; error.value = ''
  try {
    await api.hostOnboarding.recover(props.hostId, { confirmation: report.value.confirmation, acknowledgeCleanup: acknowledged.value })
    toast.success(t('hostPoolOps.recovery.success'))
    emit('changed'); emit('close')
  } catch (value) { showError(value); emit('changed') }
  finally { saving.value = false }
}
function close() { if (!saving.value) emit('close') }
onMounted(() => void check())
</script>

<template>
  <Teleport to="body">
    <div class="modal-overlay" @keydown.esc="close">
      <div class="modal-backdrop" @click="close"></div>
      <form class="modal-content max-w-xl max-h-[90dvh] flex flex-col overflow-hidden" role="dialog" aria-modal="true" aria-labelledby="host-recovery-title" @submit.prevent="recover">
        <div class="modal-header"><h2 id="host-recovery-title" class="modal-title">{{ t('hostPoolOps.recovery.title') }} · {{ hostName }}</h2></div>
        <div class="modal-body min-h-0 overflow-y-auto space-y-4">
          <p class="text-sm text-themed-muted">{{ t('hostPoolOps.recovery.description') }}</p>
          <p v-if="loading" class="text-sm text-themed" role="status">{{ t('hostPoolOps.recovery.checking') }}</p>
          <template v-else-if="report">
            <p class="text-sm font-medium" :class="report.canRecover ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'">{{ t(report.canRecover ? 'hostPoolOps.recovery.ready' : 'hostPoolOps.recovery.blocked') }}</p>
            <ul v-if="report.blockers.length" class="list-disc pl-5 space-y-2 text-sm text-themed">
              <li v-for="reason in report.blockers" :key="reason">{{ t('hostPoolOps.recovery.blockers.' + reason) }}</li>
            </ul>
            <div v-if="report.instances.length" class="rounded-lg border border-themed p-3 space-y-2">
              <p class="text-sm font-medium text-themed">{{ t('hostPoolOps.recovery.oldSystems') }}</p>
              <p v-for="instance in report.instances" :key="instance.name" class="text-sm break-all text-themed-muted">{{ instance.name }} · {{ t(instance.removable ? 'hostPoolOps.recovery.stoppedOld' : 'hostPoolOps.recovery.manualReview') }}</p>
            </div>
            <p v-if="report.forwardCount" class="text-sm text-themed-muted">{{ t('hostPoolOps.recovery.forwards', { count: report.forwardCount }) }}</p>
            <p v-if="report.canRecover && !report.needsCleanup" class="text-sm text-themed-muted">{{ t('hostPoolOps.recovery.empty') }}</p>
            <label v-if="report.canRecover && report.needsCleanup" class="flex items-start gap-3 rounded-lg border border-red-200 dark:border-red-900 p-3 text-sm text-themed">
              <input v-model="acknowledged" type="checkbox" class="mt-1" :disabled="saving" />
              <span>{{ t('hostPoolOps.recovery.acknowledge') }}</span>
            </label>
          </template>
          <p v-if="error" class="text-sm text-red-600 dark:text-red-400" role="alert">{{ error }}</p>
        </div>
        <div class="modal-footer flex-wrap gap-2">
          <button type="button" class="btn-secondary" :disabled="saving" @click="close">{{ t('common.close') }}</button>
          <button v-if="report?.blockers.length" type="button" class="btn-secondary" :disabled="saving" @click="emit('ssh')">SSH</button>
          <button type="button" class="btn-secondary" :disabled="saving || loading" @click="check">{{ t('hostPoolOps.recovery.recheck') }}</button>
          <button type="submit" class="text-sm" :class="report?.needsCleanup ? 'btn-danger' : 'btn-primary'" :disabled="saving || loading || !report?.canRecover || (report.needsCleanup && !acknowledged)">
            {{ saving ? t('hostPoolOps.recovery.recovering') : t(report?.needsCleanup ? 'hostPoolOps.recovery.cleanup' : 'hostPoolOps.recovery.release') }}
          </button>
        </div>
      </form>
    </div>
  </Teleport>
</template>
