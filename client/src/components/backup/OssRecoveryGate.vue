<script setup lang="ts">
import { onMounted, onUnmounted, onActivated, onDeactivated, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api/admin'
import { useAuthStore } from '@/stores/auth'
import type { RecoveryReadiness } from '@/types/aliyun-oss'
defineProps<{ disabled: boolean }>()
const emit = defineEmits<{ ready: [value: boolean]; changed: []; editing: [value: boolean] }>()
const { t, te, locale } = useI18n()
const auth = useAuthStore()
const state = ref<RecoveryReadiness>(), refreshError = ref(''), refreshing = ref(false)
let disposed=false, inactive=false, generation=0, failures=0, nextAt=0, denied=false
let timer: ReturnType<typeof setInterval> | undefined
function capture() { const session=auth.captureAuthentication(),version=generation; return () => !disposed && !inactive && session.current() && version===generation }
function reset() { generation++;state.value=undefined;refreshError.value='';failures=0;nextAt=0;denied=false;emit('ready',false) }
let authentication=auth.captureAuthentication()
watch(()=>auth.token,()=>{if(!authentication.current()){reset();authentication=auth.captureAuthentication()}},{flush:'sync'})
function failureMessage(failure:any) {
  const code=failure?.response?.data?.code || failure?.code || 'REQUEST_FAILED'
  return te(`oss.review.gate.errors.${code}`)?t(`oss.review.gate.errors.${code}`):t('oss.review.gate.requestFailed',{code})
}
async function refresh() {
  if(disposed || inactive || refreshing.value || denied || Date.now()<nextAt)return
  const current=capture();refreshing.value=true
  try {
    const next=await api.aliyunOss.recoveryReadiness()
    if(current()){state.value=next;emit('ready',next.ready);refreshError.value='';failures=0;nextAt=0}
  } catch(failure:any) {
    if(current()){
      emit('ready',false);refreshError.value=failureMessage(failure)
      denied=[401,403].includes(failure?.response?.status || failure?.httpStatus)
      failures=Math.min(failures+1,6);nextAt=Date.now()+Math.min(300000,15000*2**(failures-1))
    }
  } finally {refreshing.value=false}
}
onDeactivated(()=>{inactive=true;reset()})
onActivated(()=>{if(inactive){inactive=false;void refresh()}})
onMounted(()=>{void refresh();timer=setInterval(()=>{void refresh()},15000)})
onUnmounted(()=>{disposed=true;reset();emit('editing',false);if(timer)clearInterval(timer)})
</script>

<template>
  <section class="recovery-gate" :aria-busy="refreshing">
    <h3>{{ t('oss.review.gate.title') }}</h3>
    <p v-if="state">{{ t('oss.review.gate.hosts', state.hosts) }}</p>
    <ul v-if="state" class="gate-checks">
      <li v-for="item in state.categories" :key="item.category"><div><span>{{ t(`oss.review.gate.${item.category}`) }}</span><p v-if="item.code && !['OSS_RECOVERY_SNAPSHOT_RECEIPT_MISSING','OSS_RECOVERY_DELIVERY_CHECK_PENDING'].includes(item.code)" class="gate-waiting">{{ failureMessage({code:item.code}) }}</p></div><span>{{ t(`oss.review.gate.${item.verified ? 'verified' : item.basis === 'snapshot' ? 'pending' : item.code ? 'incomplete' : 'pending'}`) }}</span></li>
    </ul>
    <div v-if="state?.legacyPending" class="gate-progress gate-orders" aria-live="polite">
      <strong>{{ t('oss.review.gate.legacyPending',{count:state.legacyPending}) }}</strong>
      <div v-for="item in state.legacyOrders" :key="item.id">
        <span>{{ item.id }}</span>
        <p>{{ item.code ? failureMessage({code:item.code}) : t('oss.review.gate.legacyChecking') }}</p>
        <small v-if="item.nextAt && ['OSS_RECOVERY_DELIVERY_UNVERIFIED','OSS_RECOVERY_EVIDENCE_STALE','OSS_RECOVERY_TRANSFER_PENDING'].includes(item.code||'')">{{ t('oss.review.gate.helperNext',{time:new Date(item.nextAt).toLocaleString(locale)}) }}</small>
      </div>
    </div>
    <div v-if="state?.checkoutPending" class="gate-progress gate-orders" aria-live="polite">
      <strong>{{ t('oss.review.gate.checkoutPending',{count:state.checkoutPending}) }}</strong>
      <div v-for="item in state.checkoutOrders" :key="item.id">
        <span>{{ item.id }}</span><p>{{ item.code ? failureMessage({code:item.code}) : t('oss.review.gate.legacyChecking') }}</p>
        <small v-if="item.checkedAt">{{ t('oss.review.gate.lastOrderCheck',{time:new Date(item.checkedAt).toLocaleString(locale)}) }}</small>
        <small v-if="item.nextAt && item.status==='retry'">{{ t('oss.review.gate.helperNext',{time:new Date(item.nextAt).toLocaleString(locale)}) }}</small>
      </div>
    </div>
    <div v-if="state?.deliveryPending" class="gate-progress gate-orders" aria-live="polite">
      <strong>{{ t('oss.review.automation.deliveryPending',{count:state.deliveryPending}) }}</strong>
      <div v-for="item in state.deliveryOrders" :key="item.instanceId">
        <span>{{ t('oss.review.automation.deliveryTarget',{host:item.hostId,instance:item.instanceId}) }} · {{ item.name }}</span>
        <p>{{ t(`oss.review.automation.deliverySteps.${item.step || 'management'}`) }}</p>
        <p v-if="item.code" class="gate-waiting">{{ failureMessage({code:item.code}) }}</p>
        <small v-if="item.nextAt">{{ t('oss.review.automation.next',{time:new Date(item.nextAt).toLocaleString(locale)}) }}</small>
      </div>
      <small v-if="state.deliveryPending > (state.deliveryOrders?.length || 0)">{{ t('oss.review.automation.deliveryMore') }}</small>
    </div>
    <div v-if="state?.automation?.length" class="gate-progress" aria-live="polite">
      <div v-for="progress in state.automation" :key="`${progress.category}:${progress.reference || ''}`">
        <strong>{{ progress.category === 'gateway-route' ? t('oss.review.automation.gatewayRoute',{id:progress.hostId}) : t(`oss.review.automation.${progress.category === 'gateway-check' ? 'gatewayCheck' : 'resumeCheck'}`) }}</strong>
        <p>{{ t(`oss.review.automation.states.${progress.status}`) }} · {{ t('oss.review.automation.attempts',{count:progress.attempt}) }}</p>
        <p v-if="progress.code" :class="progress.status === 'failed' ? 'gate-error' : 'gate-waiting'">{{ failureMessage({code:progress.code}) }}</p>
        <small v-if="progress.status === 'blocked' || progress.status === 'failed'">{{ t('oss.review.automation.preserved') }}</small>
        <small v-if="progress.category === 'gateway-route' && progress.nextAction">{{ t(`oss.review.automation.actions.${progress.nextAction}`) }}</small>
        <small v-if="progress.nextAt && (progress.category === 'gateway-check' || progress.status === 'retry')">{{ t('oss.review.automation.next',{time:new Date(progress.nextAt).toLocaleString(locale)}) }}</small>
      </div>
    </div>
    <p v-if="refreshError" role="alert" class="gate-error">{{ refreshError }}</p>

  </section>
</template>

<style scoped>
.recovery-gate { border-bottom:1px solid var(--oss-line); padding:16px 0 24px; }
.gate-progress { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr)); gap:16px; margin:16px 0; }
.gate-orders { grid-template-columns:1fr; }
.gate-waiting { color:#92400e; } .dark .gate-waiting { color:#fcd34d; }
.gate-progress p { margin:6px 0; } .gate-progress > strong { grid-column:1/-1; }
.gate-progress > div { padding:12px 0; border-top:1px solid var(--oss-line); overflow-wrap:anywhere; }
h3 { font-weight:600; font-size:16px; } p { line-height:1.6; margin:12px 0; color:var(--oss-muted); }
.gate-checks { list-style:none; padding:0; margin:12px 0 20px; }
.gate-checks li { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:16px; padding:10px 0; border-bottom:1px solid var(--oss-line); }
small { display:block; color:var(--oss-muted); } .gate-error { color:#b91c1c; } .dark .gate-error { color:#fca5a5; }
@media(max-width:640px) { .gate-progress { grid-template-columns:1fr; } .gate-checks li { gap:8px; } }
</style>
