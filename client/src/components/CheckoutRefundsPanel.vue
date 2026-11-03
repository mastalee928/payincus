<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api'
import { useAuthStore } from '@/stores/auth'
import { translateError } from '@/utils/errorHandler'
import { formatPublicPrice } from '@/utils/poolCatalog'
const props = defineProps<{ active: boolean }>()
const { t } = useI18n(), auth = useAuthStore()
const methodLabel = (method: string) => ['alipay','wxpay','qqpay','bank','jdpay'].includes(method) ? t(`wallet.paymentMethods.${method}`) : method
const rows = ref<Awaited<ReturnType<typeof api.checkout.refunds>>['refunds']>([]), receipts = ref<Record<string,string>>({}), error = ref(''), busy = ref(false)
let generation=0,alive=true
function context() {
  const version = generation, authentication = auth.captureAuthentication()
  return () => alive && props.active && version === generation && authentication.aligned && authentication.current()
}
async function load() {
  const current = context()
  try { const result = await api.checkout.refunds(); if (current()) { rows.value = result.refunds; error.value = '' } }
  catch (err) { if (current()) error.value = translateError(err) }
}
async function complete(id: string) {
  if (!props.active || busy.value || (receipts.value[id]?.trim().length ?? 0) < 6) return
  const current = context()
  busy.value = true; error.value = ''
  try { await api.checkout.completeRefund(id, receipts.value[id].trim()); if (current()) { delete receipts.value[id]; await load() } }
  catch (err) { if (current()) error.value = translateError(err) }
  finally { if (current()) busy.value = false }
}
watch(()=>[props.active,auth.user?.id,auth.token],()=>{generation++;rows.value=[];receipts.value={};error.value='';busy.value=false;if(props.active)void load()},{immediate:true})
onBeforeUnmount(()=>{alive=false;generation++})
</script>
<template>
  <section v-if="rows.length || error" class="checkout-refunds"><h2>{{ t('checkout.refunds') }}</h2><p>{{ t('checkout.refundAdminHint') }}</p><p v-if="error" role="alert" class="text-red-600">{{ error }}</p><article v-for="row in rows" :key="row.id"><div><strong>¥{{ formatPublicPrice(row.amountCents) }}</strong><small>{{ row.payment.providerName }} · {{ methodLabel(row.payment.method) }} · {{ row.receipt.tradeNo }}</small><small>{{ t('checkout.orderNumber') }} {{ row.orderId }} · #{{ row.order.userId }}</small></div><label :for="`refund-${row.id}`">{{ t('checkout.receipt') }}</label><input :id="`refund-${row.id}`" v-model="receipts[row.id]" class="input" maxlength="500" /><button type="button" class="btn btn-primary" :disabled="busy || (receipts[row.id]?.trim().length ?? 0) < 6" @click="complete(row.id)">{{ t('checkout.recordRefund') }}</button></article></section>
</template>
<style scoped>
.checkout-refunds{padding:20px;border:1px solid var(--border-color);border-radius:12px;margin-bottom:24px}h2{font-size:16px;font-weight:600}p,small,label{font-size:13px;color:var(--text-secondary);line-height:1.6}small{display:block;overflow-wrap:anywhere}article{display:grid;gap:10px;padding:18px 0;border-bottom:1px solid var(--border-color)}input,button{min-height:44px}button{justify-self:start}
</style>
