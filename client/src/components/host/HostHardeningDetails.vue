<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useDialogFocus } from '@/composables/useDialogFocus'
import api from '@/api/admin'
import type { HardeningView, HardeningCheckView } from '@/types/security-hardening'

const props=defineProps<{ hostId:number; hostName:string; initial?:HardeningView }>()
const emit=defineEmits<{close:[]}>()
const {t,te,locale}=useI18n(),auth=useAuthStore(),route=useRoute()
const dialog=ref<HTMLDialogElement|null>(null),opened=ref(false),report=ref(props.initial),failed=ref(false),loading=ref(false)
const authentication=auth.captureAuthentication(),originalRoute=route.fullPath
let alive=true,sequence=0,timer:ReturnType<typeof setTimeout>|undefined
const current=()=>alive&&authentication.aligned&&authentication.current()&&auth.user?.role==='admin'&&route.fullPath===originalRoute
function close(){alive=false;sequence++;clearTimeout(timer);opened.value=false;dialog.value?.close();emit('close')}
useDialogFocus(dialog,()=>opened.value,close)
const label=(code:string,prefix='')=>te(`securityHardening.${prefix}${code}`)?t(`securityHardening.${prefix}${code}`):t('securityHardening.unknown')
const nextAction=()=>report.value?.diagnostic?.reason==='HARDENING_NATIVE_ACCEPTANCE_REQUIRED'?t('securityHardening.nativeAcceptanceNext'):
  report.value?.diagnostic?.reason==='HARDENING_BOOT_LAYOUT_UNSUPPORTED'?t('securityHardening.bootLayoutNext'):label(report.value?.diagnostic?.action||'')
const time=(value:string|null)=>value?new Date(value).toLocaleString(locale.value):'—'
const result=(value:HardeningCheckView)=>label(value.status)
async function refresh(){
  if(!current())return close()
  const generation=++sequence
  loading.value=true
  try{
    const value=await api.hostOnboarding.securityHardening(props.hostId)
    if(!current()||generation!==sequence)return
    if(value.hostId!==props.hostId||!['pending','retry','needs-maintenance','verified'].includes(value.status)||!Array.isArray(value.instances))throw Error('Invalid status')
    report.value=value;failed.value=false
  }catch{if(current()&&generation===sequence)failed.value=true}
  finally{if(current()&&generation===sequence){loading.value=false;timer=setTimeout(refresh,15000)}}
}
watch([()=>auth.token,()=>auth.user?.id,()=>auth.user?.role,()=>route.fullPath],()=>{if(!current())close()},{flush:'sync'})
function storageChanged(event:StorageEvent){if((event.key===null||event.key==='token')&&!current())close()}
onMounted(()=>{if(!current())return close();opened.value=true;dialog.value?.showModal();window.addEventListener('storage',storageChanged);void refresh()})
onBeforeUnmount(()=>{alive=false;sequence++;clearTimeout(timer);window.removeEventListener('storage',storageChanged);dialog.value?.close()})
</script>

<template>
  <Teleport to="body">
    <dialog ref="dialog" class="hardening-details" aria-labelledby="hardening-title" @cancel.prevent="close">
      <header><h2 id="hardening-title">{{t('securityHardening.title')}}</h2><p>{{t('securityHardening.host',{name:hostName})}}</p></header>
      <p>{{t('securityHardening.automatic')}}</p>
      <p v-if="failed" class="failure" role="alert">{{t('securityHardening.loadFailed')}}</p>
      <section v-if="report" :aria-busy="loading">
        <strong class="hardening-status" :class="report.status">{{label(report.status)}}</strong>
        <dl><dt>{{t('securityHardening.phase')}}</dt><dd>{{report.phase?label(report.phase,'phases.'):'—'}}</dd>
          <dt>{{t('securityHardening.checked')}}</dt><dd>{{time(report.checkedAt)}}</dd><dt>{{t('securityHardening.next')}}</dt><dd>{{time(report.nextCheckAt)}}</dd>
          <dt>{{t('securityHardening.attempts')}}</dt><dd>{{report.updateAttempts}} / 6</dd></dl>
        <section v-if="report.diagnostic" class="diagnostic">
          <h3>{{t('securityHardening.reason')}}</h3><p>{{label(report.diagnostic.reason,'reasons.')}}</p>
          <p v-if="report.diagnostic.instanceId">{{t('securityHardening.guest',{id:report.diagnostic.instanceId})}}</p>
          <h3>{{t('securityHardening.nextAction')}}</h3><p>{{nextAction()}}</p>
        </section>
        <section v-if="report.maintenance" class="diagnostic">
          <h3>{{t('securityHardening.maintenanceTitle')}}</h3>
          <p>{{label(report.maintenance.phase,'maintenancePhases.')}}</p>
          <p v-if="report.maintenance.reason">{{label(report.maintenance.reason,'reasons.')}}</p>
          <dl><dt>{{t('securityHardening.maintenanceStarted')}}</dt><dd>{{time(report.maintenance.startedAt)}}</dd>
            <dt>{{t('securityHardening.maintenanceDeadline')}}</dt><dd>{{time(report.maintenance.deadline)}}</dd></dl>
          <h3 v-if="report.maintenance.history?.length">{{t('securityHardening.actionHistory')}}</h3>
          <ol v-if="report.maintenance.history?.length" class="action-history">
            <li v-for="(event,index) in report.maintenance.history" :key="index">
              <time>{{time(event.at)}}</time><p>{{label(event.phase,'maintenancePhases.')}}</p>
              <p v-if="event.reason">{{label(event.reason,'reasons.')}}</p>
            </li>
          </ol>
        </section>
        <ul v-if="report.host" class="checks">
          <li v-for="(check,key) in report.host" :key="key"><div><span>{{t(`securityHardening.${key}`)}}</span><strong :class="check.status">{{result(check)}}</strong></div><p v-if="check.reason">{{label(check.reason,'reasons.')}}</p></li>
        </ul>
        <section v-for="guest in report.instances" :key="guest.instanceId"><h3>{{t('securityHardening.guest',{id:guest.instanceId})}}</h3>
          <ul class="checks"><li v-for="key in (['isolation','ssh'] as const)" :key="key"><div><span>{{t(`securityHardening.${key}`)}}</span><strong :class="guest[key].status">{{result(guest[key])}}</strong></div><p v-if="guest[key].reason">{{label(guest[key].reason!,'reasons.')}}</p></li></ul>
        </section>
        <section v-if="report.environment"><h3>{{t('securityHardening.environment')}}</h3><dl>
          <dt>{{t('securityHardening.architecture')}}</dt><dd>{{report.environment.architecture||'—'}}</dd>
          <dt>{{t('securityHardening.pageSize')}}</dt><dd>{{report.environment.pageSize===null?'—':`${report.environment.pageSize/1024} KiB`}}</dd>
          <dt>{{t('securityHardening.memory')}}</dt><dd>{{report.environment.memoryAvailableKiB===null?'—':`${Math.floor(report.environment.memoryAvailableKiB/1024)} MiB`}}</dd>
          <dt>{{t('securityHardening.pressure')}}</dt><dd>{{report.environment.memoryPressure===null?'—':`${report.environment.memoryPressure}%`}}</dd>
          <dt>{{t('securityHardening.disk')}}</dt><dd>{{report.environment.rootAvailableBytes===null?'—':`${Math.floor(report.environment.rootAvailableBytes/1048576)} MiB`}}</dd>
          <dt>{{t('securityHardening.inodes')}}</dt><dd>{{report.environment.rootAvailableInodes??'—'}}</dd>
        </dl></section>
      </section>
      <p v-else role="status">{{t('securityHardening.pending')}}</p>
      <footer><p>{{t('securityHardening.preserve')}}</p><button type="button" @click="close">{{t('common.close')}}</button></footer>
    </dialog>
  </Teleport>
</template>

<style scoped>
.hardening-details{width:min(620px,calc(100% - 24px));max-height:calc(100dvh - 24px);margin:auto;padding:24px;border:1px solid #d4d4d4;border-radius:12px;background:#fff;color:#171717;overflow-y:auto}
.hardening-details::backdrop{background:rgb(0 0 0 / .55)}
.action-history{list-style:none;padding:0}.action-history li{padding:8px 0}.action-history time{color:#737373;font-size:12px;font-variant-numeric:tabular-nums}.action-history p{margin:4px 0}
h2{font-size:20px;font-weight:600;margin:0}h3{font-size:14px;font-weight:600;margin:16px 0 8px}p,dl,li{font-size:14px;line-height:1.6;overflow-wrap:anywhere}p{color:#525252;margin:8px 0}dl{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.5fr);gap:8px 16px;margin:16px 0}dt{color:#525252}dd{margin:0;text-align:right;font-variant-numeric:tabular-nums}.checks{padding:0;list-style:none;margin:16px 0}.checks li{padding:12px 0;border-top:1px solid #e5e5e5}.checks li>div{display:flex;justify-content:space-between;gap:12px}.checks strong{font-size:13px;font-weight:500}.diagnostic{border:1px solid #d4d4d4;padding:0 16px 8px;border-radius:8px}.verified{color:#166534}.retry,.needs-maintenance{color:#92400e}.failure{color:#b91c1c}footer{border-top:1px solid #e5e5e5;padding-top:12px}button{display:block;margin-left:auto;min-height:44px;padding:8px 16px;border:1px solid #d4d4d4;border-radius:6px;background:transparent;color:inherit;font-size:14px}button:focus-visible{outline:2px solid currentColor;outline-offset:3px}
:global(.dark .hardening-details){background:#171717;color:#f5f5f5;border-color:#525252}:global(.dark .hardening-details p),:global(.dark .hardening-details dt){color:#bdbdbd}:global(.dark .hardening-details .checks li),:global(.dark .hardening-details footer){border-color:#404040}:global(.dark .hardening-details .diagnostic),:global(.dark .hardening-details button){border-color:#525252}:global(.dark .hardening-details .verified){color:#4ade80}:global(.dark .hardening-details .retry),:global(.dark .hardening-details .needs-maintenance){color:#fbbf24}:global(.dark .hardening-details .failure){color:#f87171}
@media(max-width:480px){.hardening-details{padding:18px}dl{grid-template-columns:minmax(0,1fr) minmax(0,1.3fr);gap:8px}}
</style>
