<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api/admin'
import type { RecoveryCorrectionAccount, RecoveryCorrectionResponse } from '@/types/aliyun-oss'
const props = defineProps<{ userId: number; disabled: boolean }>()
const emit = defineEmits<{ close: []; applied: [value: RecoveryCorrectionResponse]; busy: [value: boolean] }>()
const { t, te, locale } = useI18n()
const text = (key: string, args?: Record<string, unknown>) => t(`oss.review.reconciliation.${key}`, args || {})
const dialog = ref<HTMLDialogElement>(), firstField = ref<HTMLInputElement>(), data = ref<RecoveryCorrectionAccount>()
const doing = ref(false), error = ref(''), targetBalance = ref(''), reference = ref(''), observedAt = ref(''), password = ref(''), totpCode = ref(''), confirmed = ref(false)
const requestId = crypto.randomUUID()
const choices = reactive<Record<number, { selected: boolean; expiry: string }>>({}), rechargeIds = ref<number[]>([])
let disposed = false
let opener: HTMLElement | null = null
const selected = computed(() => data.value?.instances.filter(row => choices[row.id]?.selected) || [])
const moneyValid = computed(() => /^(?:0|[1-9][0-9]{0,7})\.[0-9]{2}$/.test(targetBalance.value))
const cents = (value: string) => Number(value.replace('.', ''))
const delta = computed(() => moneyValid.value && data.value ? cents(targetBalance.value) - cents(data.value.account.balance) : 0)
const deltaText = computed(() => moneyValid.value ? `${delta.value > 0 ? '+' : delta.value < 0 ? '−' : ''}${(Math.abs(delta.value) / 100).toFixed(2)}` : '—')
const date = (value?: string | null) => value ? new Date(value).toLocaleString(locale.value) : '—'
const localTime = (value: string) => { const d = new Date(value); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 19) }
const reason = computed(() => {
  if (!data.value || data.value.hold.mode !== 'restore' || !data.value.hold.snapshot) return text('errors.OSS_RECONCILIATION_CONTEXT_CHANGED')
  const time = Date.parse(observedAt.value)
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:/-]{5,119}$/.test(reference.value) || !Number.isFinite(time) || time <= Date.parse(data.value.hold.snapshot.createdAt) || time > Date.now()) return text('needEvidence')
  if (!moneyValid.value) return text('needMoney')
  if (selected.value.length > 20 || rechargeIds.value.length > 20 || selected.value.some(row => !Number.isFinite(Date.parse(choices[row.id].expiry)) || Date.parse(choices[row.id].expiry) <= Date.parse(row.expiresAt!))) return text('needExpiry')
  if (!delta.value && !selected.value.length && !rechargeIds.value.length) return text('noChange')
  if (!confirmed.value) return text('needConfirmation')
  if (!password.value || data.value.requiresMfa && !/^[0-9]{6}$/.test(totpCode.value)) return text('needPassword')
  return ''
})
function failure(value: any) {
  const code = value?.response?.data?.code || value?.code || 'REQUEST_FAILED', key = `oss.review.reconciliation.errors.${code}`
  error.value = te(key) ? t(key) : t('oss.review.failed', { code })
}
async function load() {
  if (doing.value) return
  doing.value = true; error.value = ''; emit('busy', true)
  try {
    const result = await api.aliyunOss.recoveryCorrectionAccount(props.userId)
    if (disposed) return
    data.value = result; targetBalance.value = result.account.balance; confirmed.value = false; rechargeIds.value = []
    for (const row of result.instances) choices[row.id] = { selected: false, expiry: '' }
  } catch (value) { if (!disposed) failure(value) }
  finally { doing.value = false; emit('busy', false); await nextTick(); if (!disposed && data.value) firstField.value?.focus() }
}
async function submit() {
  if (doing.value || props.disabled || reason.value || !data.value) return
  const account = data.value
  const correction = { id: requestId, holdTaskId: account.hold.taskId, userId: account.account.id, reference: reference.value,
    observedAt: new Date(observedAt.value).toISOString(), expectedBalance: account.account.balance, targetBalance: targetBalance.value,
    expectedLatestLogId: account.account.latestBalanceLogId,
    instances: selected.value.map(row => ({ id: row.id, expectedVersion: row.version, expectedExpiresAt: row.expiresAt!, targetExpiresAt: new Date(choices[row.id].expiry).toISOString() })),
    recharges: account.recharges.filter(row => rechargeIds.value.includes(row.id)).map(row => ({ id: row.id, orderNo: row.orderNo, expectedStatus: row.status, expectedAmount: row.amount })) }
  const secret = password.value, code = totpCode.value
  password.value = ''; totpCode.value = ''; doing.value = true; error.value = ''; emit('busy', true)
  try { const result = await api.aliyunOss.reconcileRecovery(correction, secret, code); if (!disposed) emit('applied', result) }
  catch (value) { if (!disposed) failure(value) }
  finally { doing.value = false; emit('busy', false) }
}
function cancel(event?: Event) { event?.preventDefault(); if (doing.value) return; dialog.value?.close(); opener?.focus(); emit('close') }
function trapFocus(event: KeyboardEvent) {
  if (event.key !== 'Tab' || !dialog.value) return
  const controls = [...dialog.value.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href],[tabindex]')]
    .filter(element => !element.matches(':disabled,[tabindex="-1"]') && element.getClientRects().length > 0)
  const first = controls[0], last = controls.at(-1)
  if (first && (event.shiftKey && document.activeElement === first || !event.shiftKey && document.activeElement === last)) {
    event.preventDefault(); (event.shiftKey ? last : first)?.focus()
  }
}
onMounted(() => { opener = document.activeElement as HTMLElement; dialog.value?.showModal(); void load() })
onBeforeUnmount(() => { disposed = true; password.value = ''; totpCode.value = ''; if (dialog.value?.open) dialog.value.close(); opener?.focus(); emit('busy', false) })
</script>

<template>
  <dialog ref="dialog" class="correction-dialog" aria-labelledby="correction-title" @cancel="cancel" @keydown="trapFocus">
    <form :aria-busy="doing" @submit.prevent="submit">
      <div class="correction-heading"><h2 id="correction-title">{{ text('title') }}</h2><button type="button" :disabled="doing" @click="cancel()">{{ text('cancel') }}</button></div>
      <p>{{ text('boundary') }}</p>
      <p v-if="error" class="correction-error" role="alert">{{ error }}</p>
      <p v-if="!data && doing" role="status">{{ text('loading') }}</p>
      <button v-if="error" type="button" :disabled="doing || disabled" @click="load">{{ text('retry') }}</button>
      <template v-if="data">
        <dl class="account-summary"><div><dt>{{ text('account') }}</dt><dd>{{ data.account.username }}</dd></div><div><dt>{{ text('recordedBalance') }}</dt><dd class="num">{{ data.account.balance }}</dd></div><div><dt>{{ t('oss.review.snapshot') }}</dt><dd>{{ date(data.hold.snapshot?.createdAt) }}</dd></div></dl>
        <fieldset :disabled="doing || disabled" class="correction-fields">
          <label for="correction-balance">{{ text('targetBalance') }}<input id="correction-balance" ref="firstField" v-model.trim="targetBalance" inputmode="decimal" required maxlength="11" pattern="(?:0|[1-9][0-9]{0,7})\.[0-9]{2}" aria-describedby="correction-money-help" :aria-invalid="targetBalance.length > 0 && !moneyValid"><small id="correction-money-help">{{ text('moneyHint') }}</small></label>
          <div class="evidence-fields"><label for="correction-reference">{{ text('reference') }}<input id="correction-reference" v-model.trim="reference" required minlength="6" maxlength="120" aria-describedby="correction-reference-help"><small id="correction-reference-help">{{ text('referenceHint') }}</small></label><label for="correction-time">{{ text('observedAt') }}<input id="correction-time" v-model="observedAt" type="datetime-local" step="1" required :min="data.hold.snapshot ? localTime(data.hold.snapshot.createdAt) : undefined" aria-describedby="correction-time-help"><small id="correction-time-help">{{ text('timeHint') }}</small></label></div>
          <h3>{{ text('instances') }}</h3><p class="hint">{{ text('instancesHint') }}</p>
          <ul class="correction-list"><li v-for="row in data.instances" :key="row.id"><label class="choice" :for="`correction-instance-${row.id}`"><input :id="`correction-instance-${row.id}`" v-model="choices[row.id].selected" type="checkbox" :disabled="!row.eligible || selected.length >= 20 && !choices[row.id].selected"><span><strong>{{ row.name }}</strong><small>{{ text('recordedExpiry') }} {{ date(row.expiresAt) }}</small><small v-if="!row.eligible">{{ text('ineligible') }}</small></span></label><label v-if="choices[row.id].selected" :for="`correction-expiry-${row.id}`">{{ text('targetExpiry') }}<input :id="`correction-expiry-${row.id}`" v-model="choices[row.id].expiry" type="datetime-local" step="1" required :min="row.expiresAt ? localTime(row.expiresAt) : undefined"></label></li></ul>
          <p v-if="!data.instances.length" class="hint">{{ text('noInstances') }}</p><p v-if="data.instancesTruncated" class="hint">{{ text('truncated') }}</p>
          <h3>{{ text('recharges') }}</h3><p class="hint">{{ text('rechargesHint') }}</p>
          <ul class="correction-list"><li v-for="row in data.recharges" :key="row.id"><label class="choice" :for="`correction-recharge-${row.id}`"><input :id="`correction-recharge-${row.id}`" v-model="rechargeIds" type="checkbox" :value="row.id" :disabled="rechargeIds.length >= 20 && !rechargeIds.includes(row.id)"><span><strong>{{ row.orderNo }}</strong><small>{{ row.status }}</small></span><span class="num">{{ row.amount }}</span></label></li></ul>
          <p v-if="!data.recharges.length" class="hint">{{ text('noRecharges') }}</p><p v-if="data.rechargesTruncated" class="hint">{{ text('truncated') }}</p>
          <h3>{{ text('preview') }}</h3><div class="correction-preview"><span>{{ text('balanceChange') }}</span><strong class="num">{{ deltaText }}</strong><small>{{ text('selection', { instances: selected.length, recharges: rechargeIds.length }) }}</small></div>
          <label class="choice confirmation" for="correction-confirm"><input id="correction-confirm" v-model="confirmed" type="checkbox" required><span>{{ text('acknowledge') }}</span></label>
          <div class="evidence-fields"><label for="correction-password">{{ text('password') }}<input id="correction-password" v-model="password" type="password" autocomplete="current-password" required maxlength="256"></label><label v-if="data.requiresMfa" for="correction-mfa">{{ text('mfa') }}<input id="correction-mfa" v-model="totpCode" type="password" inputmode="numeric" autocomplete="one-time-code" required minlength="6" maxlength="6" pattern="[0-9]{6}"></label></div>
        </fieldset>
        <p id="correction-submit-help" class="hint" role="status">{{ reason }}</p>
        <div class="correction-actions"><button type="submit" class="primary" :disabled="doing || disabled || !!reason" aria-describedby="correction-submit-help">{{ text('submit') }}</button></div>
      </template>
    </form>
  </dialog>
</template>

<style scoped>
.correction-dialog { width: min(720px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); margin: auto; padding: 24px; border: 1px solid var(--oss-line); border-radius: 8px; background: var(--oss-bg); color: var(--oss-fg); color-scheme: light; overflow-y: auto; }
:global(.dark) .correction-dialog { color-scheme: dark; }
.correction-dialog::backdrop { background: rgb(0 0 0 / 45%); }
.correction-heading { display: flex; justify-content: space-between; align-items: center; gap: 16px; } h2 { font-size: 19px; font-weight: 600; } h3 { margin: 24px 0 8px; font-size: 16px; font-weight: 600; }
p { margin: 12px 0; line-height: 1.65; font-size: 14px; } .hint, small, dt { color: var(--oss-muted); } small { display: block; margin-top: 6px; font-size: 12px; line-height: 1.6; }
.account-summary { margin: 20px 0; border-block: 1px solid var(--oss-line); padding: 12px 0; } .account-summary > div { display: flex; justify-content: space-between; gap: 16px; padding: 4px 0; font-size: 13px; } dd { text-align: right; overflow-wrap: anywhere; }
.correction-fields { min-width: 0; border: 0; padding: 0; } label { display: block; font-size: 14px; font-weight: 500; } input:not([type="checkbox"]) { display: block; width: 100%; min-width: 0; min-height: 40px; margin-top: 8px; padding: 8px 10px; border: 1px solid var(--oss-line); border-radius: 6px; background: var(--oss-bg); color: var(--oss-fg); font: inherit; }
input[aria-invalid="true"] { border-color: #b91c1c; } .evidence-fields { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; margin-top: 20px; }
button { min-height: 40px; padding: 8px 12px; border: 1px solid var(--oss-line); border-radius: 6px; background: var(--oss-bg); color: var(--oss-fg); font-size: 13px; } button:disabled { opacity: .6; cursor: not-allowed; } button:focus-visible, input:focus-visible { outline: 2px solid var(--oss-fg); outline-offset: 3px; } .primary { background: var(--oss-fg); color: var(--oss-bg); }
.correction-list { margin: 0; padding: 0; list-style: none; } .correction-list li { padding: 12px 0; border-bottom: 1px solid var(--oss-line); } .correction-list li > label + label { margin: 12px 0 0 28px; }
.choice { display: flex; align-items: start; gap: 12px; min-height: 40px; line-height: 1.6; } .choice input { flex: none; width: 16px; height: 16px; margin-top: 4px; accent-color: var(--oss-fg); } .choice span { min-width: 0; font-size: 14px; } .choice strong { overflow-wrap: anywhere; font-weight: 500; } .choice .num { margin-left: auto; flex: none; }
.correction-preview { display: grid; grid-template-columns: 1fr auto; gap: 8px; padding: 14px 0; border-block: 1px solid var(--oss-line); } .correction-preview small { grid-column: 1 / -1; margin: 0; } .num { font-variant-numeric: tabular-nums; text-align: right; } .confirmation { margin-top: 20px; } .correction-actions { display: flex; justify-content: flex-end; margin-top: 16px; }
.correction-error { color: #b91c1c; } :global(.dark) .correction-error { color: #fca5a5; }
@media (max-width: 640px) { .correction-dialog { padding: 20px; } .evidence-fields { grid-template-columns: 1fr; } button, input:not([type="checkbox"]) { min-height: 44px; } .account-summary > div { align-items: baseline; } }
</style>
