<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api/admin'
import type { HostRecoveryReport } from '@/types/host-pool'
import HostRecoveryProgress from './HostRecoveryProgress.vue'

const props = defineProps<{ hosts: Array<{ id: number; name: string }> }>()
const emit = defineEmits<{ close: []; changed: [] }>()
const { t } = useI18n()
const dialog = ref<HTMLDialogElement>()
const items = reactive(props.hosts.map(host => ({ ...host, report: null as HostRecoveryReport | null, error: false })))
let busy = false, disposed = false
let poll: ReturnType<typeof setTimeout> | undefined
async function check() {
  if (busy || disposed) return
  busy = true
  try {
    for (const item of items) {
      if (disposed) return
      if (item.report && !item.report.quarantined && !item.error) continue
      try {
        const report = await api.hostOnboarding.inspectRecovery(item.id)
        if (disposed) return
        item.report = report; item.error = false
        if (!report.quarantined) emit('changed')
      } catch { if (!disposed) item.error = true }
    }
  } finally {
    busy = false
    if (!disposed && items.some(item => !item.report || item.report.quarantined || item.error)) poll = setTimeout(check, 5000)
  }
}
onMounted(async () => { await nextTick(); if (!disposed) { dialog.value?.showModal(); void check() } })
onUnmounted(() => { disposed = true; clearTimeout(poll) })
</script>

<template>
  <Teleport to="body">
    <dialog ref="dialog" class="recovery-batch" aria-labelledby="recovery-batch-title" @cancel="emit('close')">
      <header>
        <h2 id="recovery-batch-title">{{ t('automaticRecovery.title') }} · {{ hosts.length }}</h2>
        <p>{{ t('automaticRecovery.description') }}</p>
      </header>
      <ul class="recovery-batch-list">
        <li v-for="item in items" :key="item.id">
          <div class="recovery-batch-row"><strong>{{ item.name }} · #{{ item.id }}</strong></div>
          <HostRecoveryProgress v-if="item.report" :report="item.report" />
          <p v-else-if="!item.error" role="status">{{ t('automaticRecovery.checking') }}</p>
          <p v-if="item.error" class="warning" role="status">{{ t('automaticRecovery.readRetry') }}</p>
        </li>
      </ul>
      <footer><button type="button" class="btn-secondary" @click="emit('close')">{{ t('common.close') }}</button></footer>
    </dialog>
  </Teleport>
</template>

<style scoped>
.recovery-batch { width: min(720px, calc(100% - 32px)); max-height: calc(100dvh - 32px); margin: auto; padding: 24px; border: 1px solid var(--kawaii-line); border-radius: 14px; color: var(--kawaii-text); background: var(--kawaii-surface); overflow-y: auto; }
.recovery-batch::backdrop { background: rgb(0 0 0 / .55); }
h2 { margin: 0 0 12px; font-size: 20px; font-weight: 600; }
p, li, label { font-size: 14px; line-height: 1.7; overflow-wrap: anywhere; }
header p { margin: 8px 0; color: var(--kawaii-muted); }
.recovery-batch-list { margin: 20px 0; padding: 0; list-style: none; }
.recovery-batch-list > li { padding: 16px 0; border-top: 1px solid var(--kawaii-line); }
.recovery-batch-row { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px 16px; }
.recovery-batch-list ul { margin: 8px 0 0; padding-left: 20px; }
.recovery-batch-list p { margin: 8px 0 0; }
.recovery-batch-ack { display: flex; align-items: start; gap: 12px; margin: 20px 0; }
.recovery-batch-ack input { margin-top: 5px; flex-shrink: 0; }
footer { display: flex; flex-wrap: wrap; justify-content: end; gap: 10px; margin-top: 24px; }
button:focus-visible { outline: 2px solid var(--kawaii-text); outline-offset: 3px; }
.success { color: #15803d; } .warning { color: #a16207; } .danger { color: #b91c1c; }
:global(.dark) .success { color: #86efac; } :global(.dark) .warning { color: #fcd34d; } :global(.dark) .danger { color: #fca5a5; }
</style>
