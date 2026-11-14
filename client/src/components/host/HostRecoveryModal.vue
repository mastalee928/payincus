<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api/admin'
import type { HostRecoveryReport } from '@/types/host-pool'
import HostRecoveryProgress from './HostRecoveryProgress.vue'
import { useDialogFocus } from '@/composables/useDialogFocus'

const props = defineProps<{ hostId: number; hostName: string }>()
const emit = defineEmits<{ close: []; changed: [] }>()
const { t } = useI18n()
const report = ref<HostRecoveryReport | null>(null)
const loading = ref(false)
const error = ref(false)
const verifying = ref(false)
const verifyError = ref(false)
const verificationRequested = ref(false)
const dialog = ref<HTMLElement | null>(null)
const visible = ref(false)
useDialogFocus(dialog, () => visible.value, () => emit('close'))
let poll: ReturnType<typeof setInterval> | undefined
let disposed = false
let generation = 0
let readSequence = 0
async function check(force = false) {
  if (disposed || (loading.value && !force)) return
  const hostId = props.hostId, current = generation, sequence = ++readSequence
  const active = () => !disposed && current === generation && sequence === readSequence
  loading.value = true
  try {
    const result = await api.hostOnboarding.inspectRecovery(hostId)
    if (!active()) return
    if (result.hostId !== hostId) throw Error('RECOVERY_HOST_MISMATCH')
    report.value = result; error.value = false
    if (!result.quarantined) verificationRequested.value = false
    if (!result.quarantined || result.automaticCleanup?.status === 'done' || result.automaticSourceRecovery?.status === 'done') emit('changed')
  } catch { if (active()) error.value = true }
  finally { if (active()) loading.value = false }
}
async function verifyNow() {
  if (verifying.value || disposed) return
  const hostId = props.hostId, current = generation
  const active = () => !disposed && current === generation
  verifying.value = true; verifyError.value = false; verificationRequested.value = false
  try {
    const result = await api.hostOnboarding.checkRecoveryNow(hostId)
    if (!active()) return
    if (result.accepted !== true) throw Error('RECOVERY_CHECK_NOT_ACCEPTED')
    verificationRequested.value = true
    void check(true)
  } catch { if (active()) verifyError.value = true }
  finally { if (active()) verifying.value = false }
}
watch(() => props.hostId, () => {
  generation++; readSequence++
  report.value = null; loading.value = false; error.value = false
  verifying.value = false; verifyError.value = false; verificationRequested.value = false
  void check()
})
onMounted(() => {
  visible.value = true
  void check()
  poll = setInterval(() => { if (!report.value || report.value.quarantined || error.value) void check() }, 5000)
})
onUnmounted(() => { disposed = true; generation++; if (poll) clearInterval(poll) })
</script>

<template>
  <Teleport to="body">
    <div class="modal-overlay host-recovery">
      <div class="modal-backdrop" @click="emit('close')"></div>
      <div ref="dialog" class="modal-content max-w-xl max-h-[90dvh] flex flex-col overflow-hidden" role="dialog" aria-modal="true" aria-labelledby="host-recovery-title" tabindex="-1">
        <div class="modal-header"><h2 id="host-recovery-title" class="modal-title break-words">{{ t('automaticRecovery.title') }} · {{ hostName }}</h2></div>
        <div class="modal-body min-h-0 overflow-y-auto space-y-4">
          <p class="text-sm text-themed-muted">{{ t('automaticRecovery.description') }}</p>
          <p v-if="loading && !report" class="text-sm text-themed" role="status">{{ t('automaticRecovery.checking') }}</p>
          <HostRecoveryProgress v-if="report" :report="report" />
          <p v-if="error" class="text-sm text-amber-700 dark:text-amber-300" role="status">{{ t('automaticRecovery.readRetry') }}</p>
          <p v-if="verifyError" class="text-sm text-amber-700 dark:text-amber-300" role="status">{{ t('automaticRecovery.verifyFailed') }}</p>
          <p v-else-if="verificationRequested" class="text-sm text-themed-muted" role="status">{{ t('automaticRecovery.verifyRequested') }}</p>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn-primary" :disabled="verifying" :aria-busy="verifying" @click="verifyNow">{{ t(verifying ? 'automaticRecovery.verifying' : 'automaticRecovery.verify') }}</button>
          <button type="button" class="btn-secondary" @click="emit('close')">{{ t('common.close') }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* Match the machine pool's neutral theme, including the shared theme's layered overrides. */
@layer base.pool {
  .host-recovery .modal-content,
  .host-recovery .modal-header,
  .host-recovery .modal-body,
  .host-recovery .modal-footer { background: #fff !important; background-image: none !important; }
  :global(.dark .host-recovery .modal-content),
  :global(.dark .host-recovery .modal-header),
  :global(.dark .host-recovery .modal-body),
  :global(.dark .host-recovery .modal-footer) { background: #111 !important; background-image: none !important; }
  .host-recovery .text-themed-muted { color: #666 !important; }
  :global(.dark .host-recovery .text-themed-muted) { color: #aaa !important; }
  .host-recovery .modal-content { box-shadow: none !important; animation: none !important; }
  .host-recovery .modal-footer { flex-direction: row !important; justify-content: flex-end !important; }
  .host-recovery .modal-footer button { width: auto !important; flex: 0 0 auto !important; }
  .host-recovery .modal-backdrop { background: rgb(0 0 0 / 55%) !important; backdrop-filter: none !important; }
  .host-recovery .btn-primary { background: #111 !important; color: #fff !important; box-shadow: none !important; }
  :global(.dark .host-recovery .btn-primary) { background: #fff !important; color: #111 !important; box-shadow: none !important; }
}
.modal-header, .modal-footer { flex-shrink: 0; }
.modal-footer button { min-height: 44px; }
.modal-footer button:focus-visible { outline: 2px solid var(--text-primary); outline-offset: 2px; }
.btn-primary::before { display: none !important; }
</style>
