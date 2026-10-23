<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api/admin'
import type { RecoveryHostProbe, RecoveryReviewReport, RecoveryReviewSection, RecoveryCorrectionResponse, RecoveryReconciliationHistory } from '@/types/aliyun-oss'
import OssRecoveryReconcile from './OssRecoveryReconcile.vue'

const props = defineProps<{ disabled: boolean }>()
const emit = defineEmits<{ busy: [value: boolean]; editing: [value: boolean] }>()
const { t, te, locale } = useI18n()
const report = ref<RecoveryReviewReport>(), section = ref<RecoveryReviewSection>('balances'), page = ref(1)
const doing = ref(false), error = ref(''), probes = ref<Record<number, RecoveryHostProbe>>({})
const editUser = ref<number>(), correctionBusy = ref(false), correctionResult = ref<RecoveryCorrectionResponse>(), history = ref<RecoveryReconciliationHistory>()
watch(editUser, value => emit('editing', value !== undefined))
const reportBusy = () => emit('busy', doing.value || correctionBusy.value)
const sections: RecoveryReviewSection[] = ['balances', 'instances', 'recharges', 'balanceLogs', 'poolOrders']
const pageCount = computed(() => Math.max(1, Math.ceil((report.value?.total || 0) / 20)))
let disposed = false
const date = (value?: string | null) => value ? new Date(value).toLocaleString(locale.value) : '—'
const probeHint = (code?: string | null) => code && te(`oss.review.probeHints.${code}`) ? t(`oss.review.probeHints.${code}`) : code
async function work(action: () => Promise<void>) {
  if (doing.value || props.disabled) return
  doing.value = true; error.value = ''; reportBusy()
  try { await action() } catch (failure: any) {
    if (!disposed) error.value = t('oss.review.failed', { code: failure?.response?.data?.code || failure?.code || 'REQUEST_FAILED' })
  } finally { doing.value = false; reportBusy() }
}
async function load(nextSection = section.value, nextPage = page.value) {
  await work(async () => {
    const result = await api.aliyunOss.recoveryReview(nextSection, nextPage)
    if (!disposed) { report.value = result; section.value = nextSection; page.value = nextPage }
  })
}
async function probe(id: number) {
  await work(async () => {
    const result = await api.aliyunOss.probeRecoveryHost(id)
    if (!disposed) probes.value[id] = result
  })
}
async function applied(value: RecoveryCorrectionResponse) {
  correctionResult.value = value; editUser.value = undefined; history.value = undefined
  await load()
  await nextTick(); document.querySelector<HTMLElement>(`[data-recovery-account="${value.result.userId}"]`)?.focus()
}
async function readHistory(nextPage = 1) { await work(async () => { history.value = await api.aliyunOss.recoveryReconciliations(nextPage) }) }
onMounted(() => { void load() })
onUnmounted(() => { disposed = true; emit('busy', false); emit('editing', false) })
</script>

<template>
  <section class="recovery-review" aria-labelledby="oss-review-title" :aria-busy="doing">
    <div class="review-heading"><h2 id="oss-review-title">{{ t('oss.review.title') }}</h2><button :disabled="doing || disabled" @click="load()">{{ t('oss.refresh') }}</button></div>
    <p>{{ t('oss.review.boundary') }}</p>
    <p v-if="error" role="alert" class="review-error">{{ error }}</p>
    <p v-if="correctionResult" role="status">{{ t(`oss.review.reconciliation.${correctionResult.replayed ? 'replayed' : 'completed'}`) }} <span>{{ correctionResult.id }}</span></p>
    <p v-if="!report && !error" role="status">{{ t('oss.review.loading') }}</p>
    <template v-if="report">
      <dl class="review-summary">
        <div><dt>{{ t('oss.review.snapshot') }}</dt><dd>{{ date(report.hold.snapshot?.createdAt) }}</dd></div>
        <div><dt>{{ t('oss.review.balanceTotal') }}</dt><dd class="num">{{ report.summary.balance }}</dd></div>
        <div><dt>{{ t('oss.review.instanceTotal') }}</dt><dd class="num">{{ report.summary.instances }}</dd></div>
      </dl>
      <p class="review-muted">{{ report.hold.mode === 'rollback' ? t('oss.review.rollbackData') : report.snapshotOnly ? t('oss.review.snapshotData') : t('oss.review.reconciliation.correctedData', { count: report.reconciliationCount }) }} · {{ t('oss.review.readAt') }} {{ date(report.checkedAt) }}</p>
      <h3>{{ t('oss.review.hosts') }}</h3>
      <p class="review-muted">{{ t('oss.review.hostBoundary') }}</p>
      <ul class="review-hosts">
        <li v-for="host in report.hosts" :key="host.id">
          <div>
            <strong>{{ host.name }}</strong><span>{{ host.managementSshHost || '—' }} · {{ t('oss.review.recordedStatus') }} {{ host.status }}</span>
            <span v-if="host.poolFaulted">{{ t('oss.review.quarantined') }}</span>
            <p v-if="probes[host.id]" role="status" :class="{ 'review-error': !probes[host.id].managementVerified || !probes[host.id].inventory?.inventoryMatched }">
              {{ probes[host.id].managementVerified ? t('oss.review.managementVerified') : t('oss.review.managementFailed') }}
              <template v-if="probes[host.id].inventory"> · {{ t('oss.review.inventory', { missing: probes[host.id].inventory!.missing.length, unexpected: probes[host.id].inventory!.unexpected.length }) }}</template>
              <span>{{ date(probes[host.id].checkedAt) }}</span>
              <span v-if="probes[host.id].code">{{ probeHint(probes[host.id].code) }}</span>
            </p>
          </div>
          <button :disabled="doing || disabled" @click="probe(host.id)">{{ t('oss.review.probe') }}</button>
        </li>
      </ul>
      <p v-if="!report.hosts.length" class="review-muted">{{ t('oss.review.noHosts') }}</p>
      <p v-if="report.hostsTruncated" class="review-muted">{{ t('oss.review.hostLimit') }}</p>
      <nav class="review-sections" :aria-label="t('oss.review.datasets')">
        <button v-for="item in sections" :key="item" :aria-pressed="section === item" :disabled="doing || disabled" @click="load(item, 1)">{{ t(`oss.review.sections.${item}`) }}</button>
      </nav>
      <div class="review-rows">
        <article v-for="row in report.rows" :key="row.id" class="review-row" :class="{ 'compact-money': section === 'balances', 'has-correction': section === 'balances' && report.hold.mode === 'restore' && !!report.hold.snapshot }">
          <div class="review-identity"><strong>{{ row.username || row.name || row.orderNo || `#${row.id}` }}</strong><span v-if="row.userId">{{ t('oss.review.userId') }} {{ row.userId }}</span><span v-if="row.status">{{ row.status }}</span></div>
          <div v-if="section === 'balances'" class="review-value num">{{ row.balance }}</div>
          <div v-else-if="section === 'instances'" class="review-value"><span>{{ t('oss.review.expiry') }} {{ date(row.expiresAt) }}</span><span>{{ t('oss.review.price') }} {{ row.billingPrice || '—' }} · {{ row.autoRenew ? t('oss.review.autoRenewOn') : t('oss.review.autoRenewOff') }}</span><span v-if="row.deletionBillingPending">{{ t('oss.review.cleanupPending') }}</span></div>
          <div v-else class="review-value num"><strong>{{ row.amount }}</strong><span v-if="section === 'balanceLogs'">{{ row.balanceBefore }} → {{ row.balanceAfter }} · {{ row.type }}</span><span>{{ date(row.createdAt) }}</span><span v-if="row.instanceId">{{ t('oss.review.instanceId') }} {{ row.instanceId }}</span></div>
          <button v-if="section === 'balances' && report.hold.mode === 'restore' && report.hold.snapshot" class="review-correction-action" :data-recovery-account="row.id" :disabled="doing || disabled" @click="editUser = Number(row.id)">{{ t('oss.review.reconciliation.open') }}</button>
        </article>
      </div>
      <p v-if="!report.rows.length" class="review-muted">{{ t('oss.review.empty') }}</p>
      <div class="review-pagination"><p>{{ t('oss.review.page', { page, pages: pageCount, total: report.total }) }}</p><div v-if="pageCount > 1"><button :disabled="doing || disabled || page <= 1" @click="load(section, page - 1)">{{ t('oss.review.previous') }}</button><button :disabled="doing || disabled || page >= pageCount" @click="load(section, page + 1)">{{ t('oss.review.next') }}</button></div></div>
      <h3>{{ t('oss.review.reconciliation.read') }}</h3><button :disabled="doing || disabled" @click="readHistory()">{{ t('oss.refresh') }}</button>
      <ul v-if="history" class="review-hosts"><li v-for="row in history.rows" :key="row.id"><div><strong>{{ row.reference }}</strong><span>{{ t('oss.review.userId') }} {{ row.userId }} · {{ date(row.createdAt) }}</span><span>{{ row.id }}</span></div><div class="num">{{ row.result.balanceBefore }} → {{ row.result.balanceAfter }}</div></li></ul>
      <p v-if="history && !history.rows.length" class="review-muted">{{ t('oss.review.reconciliation.emptyHistory') }}</p>
      <div v-if="history && history.total > history.pageSize" class="review-pagination"><p>{{ t('oss.review.page', { page: history.page, pages: Math.ceil(history.total / history.pageSize), total: history.total }) }}</p><div><button :disabled="doing || disabled || history.page <= 1" @click="readHistory(history.page - 1)">{{ t('oss.review.previous') }}</button><button :disabled="doing || disabled || history.page * history.pageSize >= history.total" @click="readHistory(history.page + 1)">{{ t('oss.review.next') }}</button></div></div>
    </template>
    <OssRecoveryReconcile v-if="editUser !== undefined" :user-id="editUser" :disabled="disabled" @close="editUser = undefined" @applied="applied" @busy="correctionBusy = $event; reportBusy()" />
  </section>
</template>

<style scoped>
.recovery-review { padding: 24px 0; border-top: 1px solid var(--oss-line); }
.review-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 20px; }
h2 { font-size: 19px; font-weight: 650; } h3 { margin: 24px 0 8px; font-size: 16px; font-weight: 600; }
p { margin: 8px 0; line-height: 1.65; } .review-muted, dt, .review-row span, .review-hosts span { color: var(--oss-muted); }
button { min-height: 40px; padding: 8px 12px; border: 1px solid var(--oss-line); border-radius: 6px; color: var(--oss-fg); background: var(--oss-bg); font-size: 13px; }
button:disabled { opacity: .55; cursor: not-allowed; } button:focus-visible { outline: 2px solid var(--oss-fg); outline-offset: 3px; }
/* Canvas width W = four fractional units + two 24px gaps. */
.review-summary { display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 24px; padding: 18px 0; border-bottom: 1px solid var(--oss-line); }
dt { font-size: 13px; } dd { margin: 6px 0 0; font-size: 18px; } .num { font-variant-numeric: tabular-nums; }
.review-hosts { list-style: none; padding: 0; margin: 0; } .review-hosts li { display: flex; align-items: start; justify-content: space-between; gap: 20px; padding: 14px 0; border-bottom: 1px solid var(--oss-line); }
.review-hosts li > div { min-width: 0; } .review-hosts button { flex-shrink: 0; } span { display: block; font-size: 13px; line-height: 1.6; } strong { font-weight: 600; overflow-wrap: anywhere; }
.review-error { color: #b91c1c; } :global(.dark) .review-error { color: #fca5a5; }
.review-sections { display: flex; flex-wrap: wrap; gap: 8px; margin: 24px 0 12px; }
.review-sections button[aria-pressed="true"] { color: var(--oss-bg); background: var(--oss-fg); border-color: var(--oss-fg); }
.review-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 20px; padding: 14px 0; border-bottom: 1px solid var(--oss-line); }
.review-value { text-align: right; overflow-wrap: anywhere; } .review-pagination { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-top: 16px; } .review-pagination > div { display: flex; gap: 8px; }
.review-row.compact-money.has-correction { grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; } .review-correction-action { white-space: nowrap; }
@media (max-width: 640px) { button { min-height: 44px; } .review-summary { grid-template-columns: 1fr; gap: 16px; } .review-summary > div { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; } dd { font-size: 16px; text-align: right; } .review-row { grid-template-columns: 1fr; gap: 6px; } .review-row.compact-money { grid-template-columns: minmax(0,1fr) auto; gap:16px; } .review-value { text-align: left; } .review-value.num { text-align: right; } .review-pagination { align-items: start; flex-direction: column; } }
</style>
