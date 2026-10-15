<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api/admin'

const props = defineProps<{ instanceId: number; instanceName: string }>()
const emit = defineEmits<{ close: []; changed: [] }>()
const { t } = useI18n()
const hosts = ref<Array<{ id: number; name: string; natPublicIp: string | null }>>([])
const backups = ref<Array<{ id: number; remoteFileName: string | null; finishedAt: string | null }>>([])
const task = ref<{ id: number; status: string; progress: string | null; error: string | null } | null>(null)
const targetId = ref<number | ''>('')
const backupId = ref<number | ''>('')
const acknowledged = ref(false)
const saving = ref(false)
const error = ref('')
const busy = computed(() => saving.value || ['PENDING', 'PROCESSING'].includes(task.value?.status || ''))
let timer: ReturnType<typeof setTimeout> | undefined
let disposed = false
async function refresh() {
  try {
    const result = await api.hostOnboarding.replacementOptions(props.instanceId)
    if (disposed) return
    hosts.value = result.hosts; backups.value = result.backups; task.value = result.task
    if (result.task?.status === 'COMPLETED') emit('changed')
  } catch { error.value = t('dedicated.replacement.loadFailed') }
  finally { if (!disposed) timer = setTimeout(() => void refresh(), 4000) }
}
async function submit() {
  if (!targetId.value || busy.value) return
  saving.value = true; error.value = ''
  try {
    await api.hostOnboarding.replaceHost(props.instanceId, { targetHostId: targetId.value, backupUploadId: backupId.value || null, acknowledgeRebuild: acknowledged.value })
    clearTimeout(timer); await refresh(); emit('changed')
  } catch (e: any) { error.value = e?.response?.data?.error || e?.message || t('dedicated.replacement.failed') }
  finally { saving.value = false }
}
onMounted(() => void refresh())
onUnmounted(() => { disposed = true; clearTimeout(timer) })
</script>

<template>
  <Teleport to="body">
    <div class="modal-overlay">
      <div class="modal-backdrop" @click="emit('close')"></div>
      <form class="modal-content max-w-lg" role="dialog" aria-modal="true" aria-labelledby="replacement-title" @submit.prevent="submit">
        <div class="modal-header"><h2 id="replacement-title" class="modal-title">{{ t('dedicated.replacement.title') }} · {{ instanceName }}</h2></div>
        <div class="modal-body space-y-4">
          <p class="text-sm text-themed-muted">{{ t('dedicated.replacement.description') }}</p>
          <label class="block text-sm text-themed">{{ t('dedicated.replacement.target') }}
            <select v-model="targetId" class="input w-full mt-2" :disabled="busy"><option value="">{{ t('dedicated.replacement.choose') }}</option><option v-for="host in hosts" :key="host.id" :value="host.id">{{ host.name }} · {{ host.natPublicIp }}</option></select>
          </label>
          <p v-if="!hosts.length && !busy" class="text-sm text-amber-600">{{ t('dedicated.replacement.noStock') }}</p>
          <label class="block text-sm text-themed">{{ t('dedicated.replacement.restore') }}
            <select v-model="backupId" class="input w-full mt-2" :disabled="busy"><option value="">{{ t('dedicated.replacement.rebuild') }}</option><option v-for="backup in backups" :key="backup.id" :value="backup.id">{{ backup.finishedAt }} · {{ backup.remoteFileName }}</option></select>
          </label>
          <label v-if="!backupId" class="flex gap-2 text-sm text-themed"><input v-model="acknowledged" type="checkbox" :disabled="busy" />{{ t('dedicated.replacement.acknowledge') }}</label>
          <p v-if="task" class="text-sm" :class="task.status === 'FAILED' ? 'text-red-600' : 'text-themed'">{{ t('dedicated.replacement.status.' + task.status) }}<span v-if="task.error">：{{ task.error }}</span></p>
          <p v-if="error" role="alert" class="text-sm text-red-600">{{ error }}</p>
        </div>
        <div class="modal-footer"><button type="button" class="btn-secondary" @click="emit('close')">{{ t('common.close') }}</button><button type="submit" class="btn-primary" :disabled="busy || !targetId || (!backupId && !acknowledged)">{{ t('dedicated.replacement.submit') }}</button></div>
      </form>
    </div>
  </Teleport>
</template>
