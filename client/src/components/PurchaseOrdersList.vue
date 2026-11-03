<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api'
import { useAuthStore } from '@/stores/auth'
import { formatPublicPrice } from '@/utils/poolCatalog'
const props = defineProps<{ active: boolean }>()
const { t } = useI18n(), auth = useAuthStore()
const rows = ref<Awaited<ReturnType<typeof api.checkout.list>>['orders']>([]), error = ref(false), busy = ref(false), next = ref<string | null>(null)
let generation = 0, alive = true
async function load(more = false) {
  if (!props.active || busy.value) return
  const current = ++generation, authentication = auth.captureAuthentication()
  busy.value = true; error.value = false
  try { const result = await api.checkout.list(more ? next.value ?? undefined : undefined)
    if (alive && props.active && current === generation && authentication.current()) { rows.value = more ? [...rows.value,...result.orders] : result.orders; next.value = result.next }
  } catch { if (current === generation) error.value = true }
  finally { if (current === generation) busy.value = false }
}
watch(() => [props.active,auth.user?.id,auth.token], () => { generation++; rows.value=[]; next.value=null; busy.value=false; if (props.active) void load() }, { immediate: true })
onBeforeUnmount(() => { alive=false; generation++ })
</script>
<template>
  <section class="purchase-list" :aria-label="t('checkout.purchaseOrders')">
    <header><h2>{{ t('checkout.purchaseOrders') }}</h2><button type="button" :disabled="busy" @click="load()">{{ t('common.refresh') }}</button></header>
    <p v-if="error" role="alert">{{ t('common.loadFailed') }}</p>
    <p v-else-if="!rows.length">{{ busy ? t('common.loading') : t('checkout.empty') }}</p>
    <article v-for="order in rows" :key="order.id"><div><strong>{{ order.display.map(item => item.namePrefix).join(', ') }}</strong><small>{{ new Date(order.createdAt).toLocaleString() }}</small></div><span>{{ t(`checkout.states.${order.status}`) }}</span><b>¥{{ formatPublicPrice(order.totalCents) }}</b><router-link :to="{ path: '/order/confirm', query: { checkout: order.id } }">{{ t('checkout.viewOrder') }}</router-link></article>
    <button v-if="next" type="button" :disabled="busy" @click="load(true)">{{ t('checkout.more') }}</button>
  </section>
</template>
<style scoped>
.purchase-list{border:1px solid var(--border-color);border-radius:12px;padding:20px;margin-bottom:24px;color:var(--text-primary)}header{display:flex;align-items:center;justify-content:space-between;gap:12px}h2{font-size:16px;font-weight:600}button,a{min-height:44px;display:inline-flex;align-items:center;font-size:13px;text-decoration:underline}article{display:grid;grid-template-columns:minmax(0,1fr) minmax(110px,180px) 100px 90px;align-items:center;gap:16px;border-top:1px solid var(--border-color);padding:12px 0;font-size:14px}article strong{display:block;overflow-wrap:anywhere}small{display:block;color:var(--text-secondary);margin-top:5px}b{font-variant-numeric:tabular-nums;text-align:right}article>a{justify-self:end}p{font-size:14px;color:var(--text-secondary);padding:12px 0}@media(max-width:700px){article{grid-template-columns:minmax(0,1fr) auto;gap:8px}article>span{font-size:12px}article>b{text-align:left}article>a{grid-column:2}}
</style>
