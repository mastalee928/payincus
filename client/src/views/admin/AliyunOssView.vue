<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api/admin'
import { useToast } from '@/stores/toast'
import type { OssBackup, OssConfig, OssDirectory, OssTask } from '@/types/aliyun-oss'
import OssRecoveryReview from '@/components/backup/OssRecoveryReview.vue'

const { t, te, locale } = useI18n()
const toast = useToast()
const loading = ref(true), busy = ref(false), loadError = ref(''), runtimeReady = ref(false), held = ref(false)
const config = ref<OssConfig | null>(null), tasks = ref<OssTask[]>([]), backups = ref<OssBackup[]>([])
const regions = ref<Array<{ id: string; name: string }>>([])
const form = reactive({ revision: '', enabled: false, region: 'oss-cn-hangzhou', bucket: '', prefix: 'payincus-backups/', accessKeyId: '', accessKeySecret: '', backupPassword: '', intervalHours: 24, retention: 3 })
const searchPrefix = ref(''), sourcePrefix = ref(''), restorePassword = ref(''), confirmation = ref('')
const bucketRows = ref<Array<{ name: string; region: string; creationDate: string }>>([]), bucketCursor = ref<string | null>(null)
const browseBucket = ref(''), browseRegion = ref('oss-cn-hangzhou'), browsePrefix = ref('')
const listing = ref<OssDirectory>({ directories: [], objects: [], nextCursor: null })
const modal = ref<HTMLDialogElement>(), modalKind = ref<'create' | 'delete' | 'preview' | 'restore' | 'resume' | 'rollback'>('create')
const newBucketName = ref(''), newBucketRegion = ref('oss-cn-hangzhou'), selectedPreview = ref<OssTask | null>(null)
const activeTask = ref<OssTask | null>(null)
const active = computed(() => activeTask.value !== null)
const reviewBusy = ref(false)
const reviewEditing = ref(false)
const disabled = computed(() => busy.value || active.value || reviewBusy.value || reviewEditing.value)
const dirty = computed(() => !config.value || Boolean(form.accessKeySecret || form.backupPassword) || ['enabled', 'region', 'bucket', 'prefix', 'accessKeyId', 'intervalHours', 'retention'].some(key => form[key as keyof typeof form] !== config.value![key as keyof OssConfig]))
const backupReady = computed(() => config.value?.bucket && config.value.hasBackupPassword && config.value.testedRevision === config.value.revision && !dirty.value)
const connectionForm = ref<HTMLFormElement>()
const saveThenTest = ref(false)
const actionError = ref('')
let poll: ReturnType<typeof setInterval> | undefined, polling = false, disposed = false
const date = (value?: string | null) => value ? new Date(value).toLocaleString(locale.value) : t('oss.notScheduled')
const size = (bytes: number) => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GiB` : `${(bytes / 1024 ** 2).toFixed(2)} MiB`
const errorText = (code?: string) => code && te(`oss.errors.${code}`) ? t(`oss.errors.${code}`) : `${t('oss.failed')}${code ? ` (${code})` : ''}`
function acceptConfig(value: OssConfig) {
  config.value = value
  Object.assign(form, { revision: value.revision, enabled: value.enabled, region: value.region, bucket: value.bucket, prefix: value.prefix, accessKeyId: value.accessKeyId, intervalHours: value.intervalHours, retention: value.retention, accessKeySecret: '', backupPassword: '' })
}
async function action(work: () => Promise<void>) {
  if (busy.value) return
  busy.value = true; actionError.value = ''
  try { await work() } catch (error: any) { actionError.value = errorText(error?.code || error?.response?.data?.code); toast.error(actionError.value) }
  finally { busy.value = false }
}
async function loadTasks() {
  const result = await api.aliyunOss.tasks()
  if (!disposed) { tasks.value = result.tasks; activeTask.value = result.activeTask ?? null; held.value = result.recoveryHeld }
}
async function loadBackups() {
  if (!config.value) return
  const result = await api.aliyunOss.backups(searchPrefix.value || undefined); backups.value = result.backups
}
async function initialize() {
  loading.value = true; loadError.value = ''; actionError.value = ''
  try {
    const [state, catalog] = await Promise.all([api.aliyunOss.config(), api.aliyunOss.regions()])
    if (state.config) acceptConfig(state.config)
    runtimeReady.value = state.runtimeReady; held.value = state.recoveryHeld; regions.value = catalog.regions
    await loadTasks()
  } catch (error: any) { loadError.value = errorText(error?.code || error?.response?.data?.code) }
  finally { loading.value = false }
}
onMounted(async () => {
  await initialize()
  poll = setInterval(async () => {
    if (polling || disposed || loadError.value) return
    polling = true
    try { await loadTasks() } catch { /* A restore intentionally stops the backend. Keep last observed state. */ }
    finally { polling = false }
  }, 5000)
})
onUnmounted(() => { disposed = true; if (poll) clearInterval(poll) })
function save() { return action(async () => { const result = await api.aliyunOss.save({ ...form }); acceptConfig(result.config); toast.success(t('oss.saved')) }) }
function test() {
  if (!connectionForm.value?.reportValidity()) return
  saveThenTest.value = true; connectionForm.value.requestSubmit()
}
async function submitSettings() {
  const shouldTest = saveThenTest.value; saveThenTest.value = false
  if (!shouldTest) return save()
  return action(async () => {
    if (dirty.value) { const saved = await api.aliyunOss.save({ ...form, enabled: false }); acceptConfig(saved.config) }
    const result = await api.aliyunOss.test(); acceptConfig(result.config)
    toast.success(t(config.value?.bucket ? 'oss.tested' : 'oss.credentialsTested'))
  })
}
async function listBuckets(cursor?: string) {
  const result = await api.aliyunOss.buckets(cursor); bucketRows.value = result.buckets; bucketCursor.value = result.nextCursor
}
async function listDirectory(prefix = '', cursor?: string) {
  listing.value = await api.aliyunOss.objects({ region: browseRegion.value, bucket: browseBucket.value, prefix, cursor }); browsePrefix.value = prefix
}
function chooseBucket(bucket: { name: string; region: string }) {
  return action(async () => { browseBucket.value = bucket.name; browseRegion.value = bucket.region; await listDirectory() })
}
function openModal(kind: typeof modalKind.value, preview?: OssTask) {
  modalKind.value = kind; confirmation.value = ''; restorePassword.value = ''; selectedPreview.value = preview || null
  newBucketRegion.value = form.region; modal.value?.showModal()
}
function closeModal() { if (busy.value) return; modal.value?.close(); restorePassword.value = ''; confirmation.value = '' }
function preview(backup: OssBackup) { sourcePrefix.value = backup.prefix; openModal('preview') }
async function submitModal() {
  await action(async () => {
    if (modalKind.value === 'create') { await api.aliyunOss.createBucket(newBucketRegion.value, newBucketName.value); await listBuckets() }
    if (modalKind.value === 'delete') { await api.aliyunOss.deleteBucket(browseRegion.value, browseBucket.value, confirmation.value); browseBucket.value = ''; await listBuckets() }
    if (modalKind.value === 'preview') await api.aliyunOss.preview(sourcePrefix.value, restorePassword.value)
    if (modalKind.value === 'restore' && selectedPreview.value) await api.aliyunOss.restore(selectedPreview.value.id, confirmation.value)
    if (modalKind.value === 'resume') await api.aliyunOss.resume(confirmation.value)
    if (modalKind.value === 'rollback') await api.aliyunOss.rollback(confirmation.value)
    modal.value?.close(); restorePassword.value = ''; confirmation.value = ''; await loadTasks(); toast.success(t('oss.success'))
  })
}
const modalTitle = computed(() => t(`oss.${({ create: 'newBucket', delete: 'deleteBucket', preview: 'preview', restore: 'restore', resume: 'resume', rollback: 'rollback' } as const)[modalKind.value]}`))
</script>

<template>
  <main class="oss-page" :aria-busy="loading || busy">
    <header class="oss-header"><div><h1>{{ t('oss.title') }}</h1><p>{{ t('oss.description') }}</p></div><button :disabled="busy" @click="initialize">{{ t('oss.refresh') }}</button></header>
    <p v-if="loadError" role="alert" class="oss-notice danger">{{ loadError }}</p>
    <p v-if="actionError" role="alert" class="oss-notice danger">{{ actionError }}</p>
    <template v-if="!loading && !loadError">
      <div v-if="!runtimeReady" class="oss-notice" role="status"><p>{{ t('oss.runtimeMissing') }}</p><a href="https://mastalee928.github.io/payincus/deployment/oss-backup" target="_blank" rel="noopener noreferrer">{{ t('oss.deploymentHelp') }}</a></div>
      <div v-if="held" class="oss-notice"><p>{{ t('oss.held') }}</p><div class="oss-actions"><button :disabled="disabled" @click="openModal('resume')">{{ t('oss.resume') }}</button><button :disabled="disabled" @click="openModal('rollback')">{{ t('oss.rollback') }}</button></div></div>
      <OssRecoveryReview v-if="held" :disabled="busy || active" @busy="reviewBusy = $event" @editing="reviewEditing = $event" />
      <form ref="connectionForm" @submit.prevent="submitSettings">
        <section aria-labelledby="oss-connection-title">
          <h2 id="oss-connection-title">{{ t('oss.connection') }}</h2><p class="hint">{{ t('oss.setupHint') }}</p>
          <fieldset :disabled="disabled || held" class="oss-fields">
            <label for="oss-key-id">{{ t('oss.keyId') }}<input id="oss-key-id" v-model="form.accessKeyId" required autocomplete="off" maxlength="128"></label>
            <label for="oss-key-secret">{{ t('oss.keySecret') }}<input id="oss-key-secret" v-model="form.accessKeySecret" type="password" :required="!config?.hasAccessKeySecret" :placeholder="config?.hasAccessKeySecret ? t('oss.retainedSecret') : ''" autocomplete="new-password" maxlength="256"></label>
          </fieldset>
          <div class="oss-actions"><button type="submit" class="primary" :disabled="disabled || held" @click="saveThenTest = false">{{ t('oss.save') }}</button><button type="button" :disabled="disabled || held" @click="test">{{ t('oss.saveAndTest') }}</button></div>
          <p class="hint">{{ t('oss.connectionTestHint') }}</p>
          <fieldset :disabled="disabled || held" class="oss-fields">
            <label for="oss-region">{{ t('oss.region') }}<select id="oss-region" v-model="form.region"><option v-for="region in regions" :key="region.id" :value="region.id">{{ locale.startsWith('zh') ? region.name : region.id }} — {{ region.id }}</option></select></label>
            <label for="oss-bucket">{{ t('oss.bucket') }}<input id="oss-bucket" v-model="form.bucket" pattern="[a-z0-9][a-z0-9\-]{1,61}[a-z0-9]" maxlength="63" autocomplete="off"></label>
          </fieldset>
          <div class="oss-actions"><button type="button" :disabled="disabled || !config || held" @click="action(() => listBuckets())">{{ t('oss.browse') }}</button><button type="button" :disabled="disabled || !config || held" @click="openModal('create')">{{ t('oss.newBucket') }}</button></div>
          <div v-if="bucketRows.length" class="bucket-list"><button v-for="bucket in bucketRows" :key="bucket.name" type="button" :disabled="busy" @click="chooseBucket(bucket)">{{ bucket.name }} <small>{{ bucket.region }}</small></button><button v-if="bucketCursor" type="button" :disabled="busy" @click="action(() => listBuckets(bucketCursor!))">{{ t('oss.loadMore') }}</button></div>
          <div v-if="browseBucket" class="oss-browser">
            <div class="oss-actions"><strong class="break-all">{{ browseBucket }}</strong><button type="button" :disabled="busy" @click="action(() => listDirectory())">{{ t('oss.root') }}</button><button type="button" :disabled="busy || !browsePrefix" @click="action(() => listDirectory(browsePrefix.split('/').slice(0, -2).join('/') + (browsePrefix.split('/').length > 2 ? '/' : '')))">{{ t('oss.parent') }}</button><button type="button" class="danger-text" :disabled="disabled || held || config?.bucket === browseBucket" @click="openModal('delete')">{{ t('oss.deleteBucket') }}</button></div>
            <p class="break-all">{{ t('oss.directory') }}: /{{ browsePrefix }}</p>
            <ul><li v-for="directory in listing.directories" :key="directory"><button type="button" :disabled="busy" @click="action(() => listDirectory(directory))">{{ directory }}</button></li><li v-for="object in listing.objects" :key="object.name"><span class="break-all">{{ object.name }}</span><small>{{ size(object.size) }}</small></li></ul>
            <p v-if="!listing.directories.length && !listing.objects.length" class="hint">{{ t('oss.emptyDirectory') }}</p>
            <div class="oss-actions"><button v-if="listing.nextCursor" type="button" :disabled="busy" @click="action(() => listDirectory(browsePrefix, listing.nextCursor!))">{{ t('oss.loadMore') }}</button><button type="button" :disabled="disabled || held || !browsePrefix" @click="form.bucket = browseBucket; form.region = browseRegion; form.prefix = browsePrefix">{{ t('oss.chooseDirectory') }}</button></div>
          </div>
        </section>
        <section aria-labelledby="oss-settings-title">
          <h2 id="oss-settings-title">{{ t('oss.settings') }}</h2>
          <fieldset :disabled="disabled || held" class="oss-fields">
            <label for="oss-prefix">{{ t('oss.prefix') }}<input id="oss-prefix" v-model="form.prefix" required maxlength="400" aria-describedby="oss-prefix-hint"><small id="oss-prefix-hint">{{ t('oss.prefixHint') }}</small></label>
            <label for="oss-password">{{ t('oss.password') }}<input id="oss-password" v-model="form.backupPassword" type="password" :required="form.enabled && !config?.hasBackupPassword" minlength="12" maxlength="256" autocomplete="new-password" :placeholder="config?.hasBackupPassword ? t('oss.retainedSecret') : ''" aria-describedby="oss-password-hint"><small id="oss-password-hint">{{ t('oss.passwordHint') }}</small></label>
            <label for="oss-interval">{{ t('oss.interval') }}<select id="oss-interval" v-model.number="form.intervalHours"><option v-for="hours in [1,3,6,12,24,72]" :key="hours" :value="hours">{{ t('oss.everyHours', { hours }) }}</option></select></label>
            <label for="oss-retention">{{ t('oss.retention') }}<select id="oss-retention" v-model.number="form.retention"><option v-for="count in [1,3,5]" :key="count" :value="count">{{ t('oss.keep', { count }) }}</option></select></label>
            <label class="oss-toggle" for="oss-enabled"><input id="oss-enabled" v-model="form.enabled" type="checkbox" :disabled="!runtimeReady || !config?.bucket || !config.hasBackupPassword || config.testedRevision !== config.revision">{{ t('oss.enabled') }}</label>
          </fieldset>
          <p class="hint">{{ t('oss.nextRun') }}: {{ date(config?.nextRunAt) }}</p>
          <p v-if="!backupReady" class="hint">{{ t('oss.needsTest') }}</p>
          <div class="oss-actions"><button type="submit" class="primary" :disabled="disabled || held" @click="saveThenTest = false">{{ t('oss.save') }}</button><button type="button" :disabled="disabled || held" @click="test">{{ t('oss.saveAndTest') }}</button><button type="button" :disabled="disabled || !runtimeReady || !backupReady || held" @click="action(async () => { await api.aliyunOss.backup(); await loadTasks() })">{{ t('oss.backupNow') }}</button></div>
        </section>
      </form>
      <section aria-labelledby="oss-backups-title">
        <h2 id="oss-backups-title">{{ t('oss.records') }}</h2>
        <form class="oss-search" @submit.prevent="action(loadBackups)"><label for="oss-search-prefix">{{ t('oss.searchPrefix') }}<input id="oss-search-prefix" v-model="searchPrefix" maxlength="400" :placeholder="config ? `${config.prefix}${config.installationId}/` : ''"></label><button :disabled="busy || !config">{{ t('oss.search') }}</button></form>
        <p v-if="!backups.length" class="hint">{{ t('oss.noBackups') }}</p>
        <ul class="backup-list"><li v-for="backup in backups" :key="backup.prefix"><div><strong>{{ date(backup.createdAt) }}</strong><p class="break-all">{{ backup.prefix }}</p><small>{{ t('oss.version') }} {{ backup.version }} · {{ size(backup.bytes) }}</small></div><button :disabled="disabled || !runtimeReady || held" @click="preview(backup)">{{ t('oss.preview') }}</button></li></ul>
      </section>
      <section aria-labelledby="oss-tasks-title"><h2 id="oss-tasks-title">{{ t('oss.tasks') }}</h2><ul class="backup-list"><li v-for="task in tasks" :key="task.id"><div><strong>{{ t(`oss.stages.${task.stage}`) }}</strong><small class="task-status" :class="{ 'danger-text': task.status === 'failed' }">{{ ['pending', 'running'].includes(task.status) && activeTask?.id !== task.id ? t('oss.review.reconciliation.taskCheckpoint') : t(`oss.statuses.${task.status}`) }} · {{ date(task.createdAt) }}</small><p v-if="task.error" class="danger-text">{{ errorText(task.error) }}</p><small class="break-all">{{ task.id }}</small></div><button v-if="task.preview && task.status === 'success'" :disabled="disabled || held || Date.parse(task.preview.expiresAt) < Date.now()" @click="openModal('restore', task)">{{ t('oss.restore') }}</button></li></ul></section>
    </template>
    <section aria-labelledby="oss-recovery-title" class="oss-recovery">
      <h2 id="oss-recovery-title">{{ t('oss.recoveryTitle') }}</h2>
      <p>{{ t('oss.packageInfo') }}</p>
      <details open><summary>{{ t('oss.usableTitle') }}</summary><ol><li v-for="index in 3" :key="index">{{ t(`oss.usableSteps.${index - 1}`) }}</li></ol></details>
      <details><summary>{{ t('oss.lostTitle') }}</summary><ol><li v-for="index in 3" :key="index">{{ t(`oss.lostSteps.${index - 1}`) }}</li></ol></details>
      <p>{{ t('oss.toolHint') }}</p>
      <div class="oss-actions"><a href="/recovery/恢复说明.md" download>{{ t('oss.downloadGuide') }}</a><a href="/recovery/payincus-recovery.py" download>{{ t('oss.downloadTool') }}</a></div>
      <p class="hint">{{ t('oss.recoveryBoundary') }}</p>
    </section>
    <dialog ref="modal" aria-labelledby="oss-modal-title" @cancel="busy ? $event.preventDefault() : closeModal()">
      <form @submit.prevent="submitModal">
        <h2 id="oss-modal-title">{{ modalTitle }}</h2>
        <template v-if="modalKind === 'create'"><p>{{ t('oss.createHint') }}</p><label for="oss-new-region">{{ t('oss.region') }}<select id="oss-new-region" v-model="newBucketRegion"><option v-for="region in regions" :key="region.id" :value="region.id">{{ locale.startsWith('zh') ? region.name : region.id }}</option></select></label><label for="oss-new-bucket">{{ t('oss.bucketName') }}<input id="oss-new-bucket" v-model="newBucketName" required pattern="[a-z0-9][a-z0-9-]{1,61}[a-z0-9]" maxlength="63"></label></template>
        <template v-if="modalKind === 'delete'"><p>{{ t('oss.deleteHint') }}</p><strong class="break-all">{{ browseBucket }}</strong><label for="oss-delete-confirm">{{ t('oss.nameConfirmation') }}<input id="oss-delete-confirm" v-model="confirmation" required autocomplete="off"></label></template>
        <template v-if="modalKind === 'preview'"><p>{{ t('oss.previewHint') }}</p><p class="break-all">{{ sourcePrefix }}</p><label for="oss-restore-password">{{ t('oss.restorePassword') }}<input id="oss-restore-password" v-model="restorePassword" type="password" required minlength="12" maxlength="256" autocomplete="new-password"></label></template>
        <template v-if="modalKind === 'restore'"><p class="danger-text">{{ t('oss.restoreWarning') }}</p><p>{{ t('oss.time') }}: {{ date(selectedPreview?.preview?.createdAt) }}</p><p>{{ t('oss.expires') }}: {{ date(selectedPreview?.preview?.expiresAt) }}</p><code class="break-all">RESTORE {{ selectedPreview?.id }}</code><label for="oss-restore-confirm">{{ t('oss.restoreConfirmation') }}<input id="oss-restore-confirm" v-model="confirmation" required autocomplete="off"></label></template>
        <template v-if="modalKind === 'resume'"><p>{{ t('oss.resumeHint') }}</p><code>RESUME AFTER RECONCILIATION</code><label for="oss-resume-confirm">{{ t('oss.restoreConfirmation') }}<input id="oss-resume-confirm" v-model="confirmation" required autocomplete="off"></label></template>
        <template v-if="modalKind === 'rollback'"><p>{{ t('oss.rollbackHint') }}</p><code>ROLLBACK RESTORE</code><label for="oss-rollback-confirm">{{ t('oss.restoreConfirmation') }}<input id="oss-rollback-confirm" v-model="confirmation" required autocomplete="off"></label></template>
        <div class="oss-actions"><button type="button" :disabled="busy" @click="closeModal">{{ t('oss.cancel') }}</button><button type="submit" class="primary" :disabled="busy || (modalKind === 'delete' && confirmation !== browseBucket) || (modalKind === 'restore' && confirmation !== `RESTORE ${selectedPreview?.id}`) || (modalKind === 'resume' && confirmation !== 'RESUME AFTER RECONCILIATION') || (modalKind === 'rollback' && confirmation !== 'ROLLBACK RESTORE')">{{ t('oss.confirm') }}</button></div>
      </form>
    </dialog>
  </main>
</template>

<style scoped>
.oss-page { --oss-bg: #fff; --oss-fg: #171717; --oss-muted: #525252; --oss-line: #d4d4d4; max-width: 1120px; margin: 0 auto; padding: 24px; color: var(--oss-fg); background: var(--oss-bg); }
:global(.dark .oss-page) { --oss-bg: #0a0a0a; --oss-fg: #fafafa; --oss-muted: #b3b3b3; --oss-line: #454545; }
.oss-header { display: flex; justify-content: space-between; align-items: start; gap: 24px; margin-bottom: 24px; }
.oss-header > button { flex-shrink: 0; white-space: nowrap; }
h1 { font-size: 28px; font-weight: 650; letter-spacing: -.02em; } h2 { font-size: 19px; font-weight: 650; margin-bottom: 16px; }
p { line-height: 1.65; margin: 8px 0; max-width: 75ch; } .hint, small, .oss-header p { color: var(--oss-muted); } small { display: block; font-size: 12px; line-height: 1.5; }
section { padding: 28px 0; border-top: 1px solid var(--oss-line); } .oss-fields { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 22px 28px; padding: 0; border: 0; margin: 20px 0; }
label { display: flex; flex-direction: column; gap: 8px; font-size: 14px; font-weight: 500; min-width: 0; }
input, select { background: var(--oss-bg); color: var(--oss-fg); border: 1px solid var(--oss-line); border-radius: 8px; padding: 10px 12px; width: 100%; min-width: 0; font: inherit; caret-color: var(--oss-fg); }
input::placeholder { color: var(--oss-muted); opacity: 1; } button { border: 1px solid var(--oss-line); border-radius: 8px; background: var(--oss-bg); color: var(--oss-fg); padding: 9px 14px; font-size: 13px; font-weight: 550; cursor: pointer; min-height: 40px; }
button:hover:not(:disabled) { background: color-mix(in srgb, var(--oss-fg) 8%, var(--oss-bg)); } button.primary { background: var(--oss-fg); color: var(--oss-bg); border-color: var(--oss-fg); } button.primary:hover:not(:disabled) { opacity: .85; }
button:disabled, fieldset:disabled { opacity: .55; cursor: not-allowed; } :is(button,input,select):focus-visible { outline: 2px solid var(--oss-fg); outline-offset: 3px; }
.oss-actions { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin-top: 18px; } .oss-toggle { flex-direction: row; align-items: center; } .oss-toggle input { width: 18px; height: 18px; accent-color: var(--oss-fg); }
.oss-notice { padding: 14px 18px; background: var(--oss-bg); border: 1px solid var(--oss-line); border-radius: 10px; margin: 16px 0; }
.danger-text, .danger { color: #b91c1c; } :global(.dark .oss-page :is(.danger-text,.danger)) { color: #fca5a5; }
.bucket-list { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 18px; } .oss-browser { margin-top: 20px; padding: 18px; border: 1px solid var(--oss-line); border-radius: 10px; } ul { list-style: none; padding: 0; margin: 0; } .oss-browser li { display: flex; justify-content: space-between; gap: 16px; padding: 8px 0; }
.oss-search { display: flex; gap: 12px; align-items: end; margin: 18px 0; } .oss-search label { flex: 1; }
.backup-list li { display: flex; justify-content: space-between; align-items: center; gap: 20px; padding: 18px 0; border-bottom: 1px solid var(--oss-line); } .backup-list li > div { min-width: 0; } .backup-list li > button { flex-shrink: 0; } .task-status { margin-top: 6px; font-variant-numeric: tabular-nums; } .break-all { overflow-wrap: anywhere; }
dialog { background: var(--oss-bg); color: var(--oss-fg); width: min(540px, calc(100% - 32px)); border: 1px solid var(--oss-line); border-radius: 14px; padding: 26px; margin: auto; max-height: calc(100dvh - 32px); overflow-y: auto; } dialog::backdrop { background: rgb(0 0 0 / .55); } dialog label { margin-top: 18px; } dialog .oss-actions { justify-content: flex-end; } code { font-size: 13px; }
::selection { background: var(--oss-fg); color: var(--oss-bg); }
.oss-recovery details { margin: 20px 0; max-width: 75ch; } .oss-recovery summary { cursor: pointer; font-weight: 600; padding: 6px 0; } .oss-recovery ol { padding-left: 24px; margin-top: 12px; } .oss-recovery li { line-height: 1.7; margin: 10px 0; } .oss-recovery a { color: var(--oss-fg); text-decoration: underline; text-underline-offset: 4px; padding: 8px 0; } .oss-recovery :is(a,summary):focus-visible { outline: 2px solid var(--oss-fg); outline-offset: 3px; }
@media (max-width: 640px) { .oss-page { padding: 16px; } h1 { font-size: 24px; } .oss-fields { grid-template-columns: 1fr; } .oss-header { gap: 12px; } .oss-search { flex-direction: column; align-items: stretch; } .backup-list li { flex-direction: column; align-items: stretch; } .oss-browser { padding: 12px; } }
</style>
