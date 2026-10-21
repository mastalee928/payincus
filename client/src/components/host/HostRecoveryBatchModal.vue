<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api/admin'
import { inspectRecoveryBatch, recoverRecoveryBatch, type RecoveryBatchItem } from '@/utils/hostRecoveryBatch'

const props = defineProps<{ hosts: Array<{ id: number; name: string }> }>()
const emit = defineEmits<{ close: []; changed: [] }>()
const { t, te } = useI18n()
const dialog = ref<HTMLDialogElement>()
const busy = ref(false), acknowledged = ref(false)
const items = reactive<RecoveryBatchItem[]>(props.hosts.map(host => ({ ...host, status: 'pending', report: null, error: '' })))
const ready = computed(() => items.filter(item => item.status === 'ready' && item.report?.canRecover))
const cleanupNeeded = computed(() => ready.value.some(item => item.report?.needsCleanup))
const completed = computed(() => items.filter(item => item.status === 'recovered').length)
const inspected = computed(() => items.filter(item => !['pending', 'checking'].includes(item.status)).length)
function statusClass(status: RecoveryBatchItem['status']) {
  return status === 'recovered' ? 'success' : status === 'blocked' ? 'warning' : status === 'failed' ? 'danger' : ''
}
function errorText(code: string) {
  const key = 'hostPoolOps.recovery.errors.' + code
  return te(key) ? t(key) : t('hostPoolOps.recovery.failed')
}
async function check() {
  if (busy.value) return
  busy.value = true; acknowledged.value = false
  try { await inspectRecoveryBatch(items, api.hostOnboarding) }
  finally { busy.value = false }
}
async function recover() {
  if (busy.value || !ready.value.length || (cleanupNeeded.value && !acknowledged.value)) return
  busy.value = true
  try { await recoverRecoveryBatch(items, api.hostOnboarding, acknowledged.value) }
  finally { busy.value = false; acknowledged.value = false; emit('changed') }
}
function close() { if (!busy.value) emit('close') }
onMounted(async () => { await nextTick(); dialog.value?.showModal(); void check() })
</script>

<template>
  <Teleport to="body">
    <dialog ref="dialog" class="recovery-batch" aria-labelledby="recovery-batch-title" @cancel="busy ? $event.preventDefault() : close()">
      <form @submit.prevent="recover">
        <header>
          <h2 id="recovery-batch-title">{{ t('hostPoolOps.recovery.batch.title', { count: items.length }) }}</h2>
          <p>{{ t('hostPoolOps.recovery.batch.description') }}</p>
          <p role="status">{{ t('hostPoolOps.recovery.batch.progress', { checked: inspected, total: items.length, ready: ready.length, recovered: completed }) }}</p>
        </header>
        <ul class="recovery-batch-list" :aria-busy="busy">
          <li v-for="item in items" :key="item.id">
            <div class="recovery-batch-row"><strong>{{ item.name }} · #{{ item.id }}</strong><span :class="statusClass(item.status)">{{ t('hostPoolOps.recovery.batch.status.' + item.status) }}</span></div>
            <ul v-if="item.report?.blockers.length"><li v-for="reason in item.report.blockers" :key="reason">{{ t('hostPoolOps.recovery.blockers.' + reason) }}</li></ul>
            <p v-if="item.report?.mode === 'preserve' && item.report.canRecover">{{ t('hostPoolOps.recovery.preserve') }}</p>
            <template v-if="item.report?.needsCleanup">
              <p v-for="instance in item.report.instances" :key="instance.name">{{ instance.name }} · {{ t(instance.removable ? 'hostPoolOps.recovery.stoppedOld' : 'hostPoolOps.recovery.manualReview') }}</p>
              <p v-if="item.report.forwardCount">{{ t('hostPoolOps.recovery.forwards', { count: item.report.forwardCount }) }}</p>
            </template>
            <p v-if="item.error" class="danger" role="alert">{{ errorText(item.error) }}</p>
          </li>
        </ul>
        <label v-if="cleanupNeeded" class="recovery-batch-ack"><input v-model="acknowledged" type="checkbox" :disabled="busy" /><span>{{ t('hostPoolOps.recovery.acknowledge') }}</span></label>
        <footer>
          <button type="button" class="btn-secondary" :disabled="busy" @click="close">{{ t('common.close') }}</button>
          <button type="button" class="btn-secondary" :disabled="busy || completed === items.length" @click="check">{{ t('hostPoolOps.recovery.recheck') }}</button>
          <button type="submit" :class="cleanupNeeded ? 'btn-danger' : 'btn-primary'" :disabled="busy || !ready.length || (cleanupNeeded && !acknowledged)">{{ busy ? t('hostPoolOps.recovery.batch.working') : t('hostPoolOps.recovery.batch.restoreReady', { count: ready.length }) }}</button>
        </footer>
      </form>
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
