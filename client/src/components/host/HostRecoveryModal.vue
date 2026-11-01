<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api/admin'
import type { HostRecoveryReport } from '@/types/host-pool'
import HostRecoveryProgress from './HostRecoveryProgress.vue'

const props = defineProps<{ hostId: number; hostName: string }>()
const emit = defineEmits<{ close: []; changed: [] }>()
const { t } = useI18n()
const report = ref<HostRecoveryReport | null>(null)
const loading = ref(false)
const error = ref(false)
let poll: ReturnType<typeof setInterval> | undefined
let disposed = false
async function check() {
  if (loading.value) return
  loading.value = true
  try {
    const result = await api.hostOnboarding.inspectRecovery(props.hostId)
    if (disposed) return
    report.value = result; error.value = false
    if (!result.quarantined || result.automaticCleanup?.status === 'done' || result.automaticSourceRecovery?.status === 'done') emit('changed')
  } catch { if (!disposed) error.value = true }
  finally { loading.value = false }
}
onMounted(() => {
  void check()
  poll = setInterval(() => { if (!report.value || report.value.quarantined || error.value) void check() }, 5000)
})
onUnmounted(() => { disposed = true; if (poll) clearInterval(poll) })
</script>

<template>
  <Teleport to="body">
    <div class="modal-overlay host-recovery" @keydown.esc="emit('close')">
      <div class="modal-backdrop" @click="emit('close')"></div>
      <div class="modal-content max-w-xl max-h-[90dvh] flex flex-col overflow-hidden" role="dialog" aria-modal="true" aria-labelledby="host-recovery-title">
        <div class="modal-header"><h2 id="host-recovery-title" class="modal-title break-words">{{ t('automaticRecovery.title') }} · {{ hostName }}</h2></div>
        <div class="modal-body min-h-0 overflow-y-auto space-y-4">
          <p class="text-sm text-themed-muted">{{ t('automaticRecovery.description') }}</p>
          <p v-if="loading && !report" class="text-sm text-themed" role="status">{{ t('automaticRecovery.checking') }}</p>
          <HostRecoveryProgress v-if="report" :report="report" />
          <p v-if="error" class="text-sm text-amber-700 dark:text-amber-300" role="status">{{ t('automaticRecovery.readRetry') }}</p>
        </div>
        <div class="modal-footer">
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
  .host-recovery .modal-content { box-shadow: none !important; }
  .host-recovery .modal-backdrop { background: rgb(0 0 0 / 55%) !important; backdrop-filter: none !important; }
  .host-recovery .btn-primary { background: #111 !important; color: #fff !important; box-shadow: none !important; }
  :global(.dark .host-recovery .btn-primary) { background: #fff !important; color: #111 !important; box-shadow: none !important; }
}
.modal-header, .modal-footer { flex-shrink: 0; }
.modal-footer button { min-height: 44px; }
.modal-footer button:focus-visible { outline: 2px solid var(--text-primary); outline-offset: 2px; }
.btn-primary::before { display: none !important; }
</style>
