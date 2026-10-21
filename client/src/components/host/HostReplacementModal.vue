<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api/admin'
import { localizePoolRegionName } from '@/utils/poolRegionCatalog'

const props = defineProps<{ instanceId: number; instanceName: string; allowOtherRegions?: boolean }>()
const emit = defineEmits<{ close: []; changed: [] }>()
const { t, locale } = useI18n()
const hosts = ref<Array<{ id: number; name: string; natPublicIp: string | null; countryCode: string | null; regionGroupEntry: { name: string } | null }>>([])
const backups = ref<Array<{ id: number; remoteFileName: string | null; finishedAt: string | null }>>([])
const task = ref<{ id: number; status: string; progress: string | null; error: string | null } | null>(null)
const targetId = ref<number | ''>('')
const backupId = ref<number | ''>('')
const acknowledged = ref(false)
const saving = ref(false)
const error = ref('')
const allRegions = ref(false)
const loading = ref(true)
const dialog = ref<HTMLDialogElement | null>(null)
const busy = computed(() => saving.value || ['PENDING', 'PROCESSING'].includes(task.value?.status || ''))
let timer: ReturnType<typeof setTimeout> | undefined
let disposed = false
let refreshSequence = 0
let notifiedTaskId: number | undefined
async function refresh() {
  clearTimeout(timer)
  const sequence = ++refreshSequence
  loading.value = true
  try {
    const result = await api.hostOnboarding.replacementOptions(props.instanceId, allRegions.value)
    if (disposed || sequence !== refreshSequence) return
    hosts.value = result.hosts; backups.value = result.backups; task.value = result.task
    error.value = ''
    if (!result.hosts.some(host => host.id === targetId.value)) targetId.value = ''
    if (result.task?.status === 'COMPLETED' && notifiedTaskId !== result.task.id) {
      notifiedTaskId = result.task.id
      emit('changed')
    }
  } catch { if (!disposed && sequence === refreshSequence) { hosts.value = []; error.value = t('dedicated.replacement.loadFailed') } }
  finally { if (!disposed && sequence === refreshSequence) { loading.value = false; timer = setTimeout(() => void refresh(), 4000) } }
}
function changeScope() { targetId.value = ''; hosts.value = []; void refresh() }
async function submit() {
  if (!targetId.value || busy.value || loading.value || (!backupId.value && !acknowledged.value)) return
  saving.value = true; error.value = ''
  try {
    await api.hostOnboarding.replaceHost(props.instanceId, { targetHostId: targetId.value, backupUploadId: backupId.value || null, acknowledgeRebuild: acknowledged.value, allRegions: allRegions.value })
    clearTimeout(timer); await refresh(); emit('changed')
  } catch (e: any) { error.value = e?.response?.data?.error || e?.message || t('dedicated.replacement.failed') }
  finally { saving.value = false }
}
onMounted(() => { dialog.value?.showModal(); void refresh() })
onUnmounted(() => { disposed = true; clearTimeout(timer); dialog.value?.close() })
</script>

<template>
  <Teleport to="body">
    <dialog ref="dialog" class="replacement-dialog modal-content max-w-lg" aria-labelledby="replacement-title" aria-describedby="replacement-description" @cancel.prevent="!saving && emit('close')" @click="!saving && $event.target === dialog && emit('close')">
      <form :aria-busy="busy || loading" @submit.prevent="submit">
        <div class="modal-header"><h2 id="replacement-title" class="modal-title">{{ t(allowOtherRegions ? 'dedicated.replacement.manageTitle' : 'dedicated.replacement.title') }} · {{ instanceName }}</h2></div>
        <div class="modal-body space-y-4">
          <p id="replacement-description" class="text-sm text-themed-muted">{{ t(allowOtherRegions ? 'dedicated.replacement.manageDescription' : 'dedicated.replacement.description') }}</p>
          <p id="replacement-data" class="text-sm text-amber-600">{{ t('dedicated.replacement.dataBoundary') }}</p>
          <label v-if="allowOtherRegions" class="block text-sm text-themed">{{ t('dedicated.replacement.scope') }}
            <select v-model="allRegions" class="input w-full mt-2" :disabled="busy" @change="changeScope"><option :value="false">{{ t('dedicated.replacement.sameRegion') }}</option><option :value="true">{{ t('dedicated.replacement.allRegions') }}</option></select>
          </label>
          <label class="block text-sm text-themed">{{ t('dedicated.replacement.target') }}
            <select v-model="targetId" required class="input w-full mt-2" :disabled="busy || loading"><option value="">{{ t('dedicated.replacement.choose') }}</option><option v-for="host in hosts" :key="host.id" :value="host.id">{{ localizePoolRegionName(host.regionGroupEntry?.name || host.countryCode || '', host.countryCode, locale) }} · {{ host.name }} · {{ host.natPublicIp }}</option></select>
          </label>
          <p v-if="loading" role="status" class="text-sm text-themed-muted">{{ t('common.loading') }}</p>
          <p v-else-if="!hosts.length && !busy && !error" class="text-sm text-amber-600">{{ t('dedicated.replacement.noStock') }}</p>
          <label class="block text-sm text-themed">{{ t('dedicated.replacement.restore') }}
            <select v-model="backupId" class="input w-full mt-2" :disabled="busy" aria-describedby="replacement-data"><option value="">{{ t('dedicated.replacement.rebuild') }}</option><option v-for="backup in backups" :key="backup.id" :value="backup.id">{{ backup.finishedAt }} · {{ backup.remoteFileName }}</option></select>
          </label>
          <label v-if="!backupId" class="flex gap-2 text-sm text-themed"><input v-model="acknowledged" type="checkbox" :disabled="busy" />{{ t('dedicated.replacement.acknowledge') }}</label>
          <p v-if="task" role="status" class="text-sm" :class="task.status === 'FAILED' ? 'text-red-600' : 'text-themed'">{{ t('dedicated.replacement.status.' + task.status) }}<span v-if="task.error">：{{ task.error }}</span></p>
          <p v-if="error" role="alert" class="text-sm text-red-600">{{ error }}</p>
        </div>
        <div class="modal-footer"><button type="button" class="btn-secondary" :disabled="saving" @click="emit('close')">{{ t('common.close') }}</button><button type="submit" class="btn-primary" :disabled="busy || loading || !targetId || (!backupId && !acknowledged)">{{ t('dedicated.replacement.submit') }}</button></div>
      </form>
    </dialog>
  </Teleport>
</template>

<style scoped>
.replacement-dialog { width: calc(100% - 2rem); margin: auto; max-height: calc(100dvh - 2rem); overflow-y: auto; }
.replacement-dialog::backdrop { background: rgb(0 0 0 / 55%); }
</style>
