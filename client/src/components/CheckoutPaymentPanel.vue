<script setup lang="ts">
import { computed, onMounted, onActivated, onDeactivated, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { Check, CircleAlert, Loader2, ArrowUpRight, ArrowLeft, Wallet } from 'lucide-vue-next'
import api from '@/api'
import type { CheckoutOrder } from '@/types/checkout'
import { useAuthStore } from '@/stores/auth'
import { translateError } from '@/utils/errorHandler'
import { formatPublicPrice } from '@/utils/poolCatalog'
import { localizePoolRegionName } from '@/utils/poolRegionCatalog'
import CheckoutOrderResult from './CheckoutOrderResult.vue'
import PaymentMethodIcon from './PaymentMethodIcon.vue'
import { paymentDisplayName } from '@/utils/paymentDisplay'

const props = defineProps<{ id: string }>()
const emit = defineEmits<{ paid: [order: CheckoutOrder]; closed: [order: CheckoutOrder] }>()
const { t, locale } = useI18n(), route = useRoute(), auth = useAuthStore()
const order = ref<CheckoutOrder | null>(null), error = ref(''), busy = ref(false), checking = ref(false)
const providers = ref<Awaited<ReturnType<typeof api.billing.getPaymentProviders>>['providers']>([])
const walletBalance = ref<number | null>(null)
const balanceLabel = computed(() => `${t('cart.balance')}(${walletBalance.value === null ? '—' : `￥${walletBalance.value.toFixed(2)}`})`)
const configurationReady = ref(false)
const choice = ref('balance'), now = ref(Date.now())
let alive = true, active = false, generation = 0, sequence = 0, initializedChoice = false
let timer: ReturnType<typeof setTimeout> | undefined, clock: ReturnType<typeof setInterval> | undefined
function context() { const captured = auth.captureAuthentication(), id = props.id, version = generation; return () => alive && active && version === generation && captured.aligned && captured.current() && props.id === id }
const options = computed(() => providers.value.filter(p => ['yipay','upaypro','heleket','antom'].includes(p.type)).flatMap(provider =>
  (provider.type === 'yipay' ? (provider.methods?.length ? provider.methods : ['alipay']) : ['']).map(method => ({ provider, method,
    key: `${provider.id}:${method}`, label: paymentDisplayName(method, provider.name, t) }))))
const selected = computed(() => options.value.find(option => option.key === choice.value))
const payment = computed(() => order.value?.payments.find(row => row.providerId === selected.value?.provider.id && row.method === (selected.value?.provider.type === 'upaypro' ? row.method : selected.value?.method)))
const paidPayment = computed(() => order.value?.payments.find(row => row.id === order.value?.paymentId))
const paidLabel = computed(() => paidPayment.value ? paymentDisplayName(paidPayment.value.method, paidPayment.value.providerName, t) : t('cart.balance'))
const remaining = computed(() => Math.max(0, Math.ceil((Date.parse(order.value?.expiresAt || '') - now.value) / 1000)))
const open = computed(() => order.value?.status === 'pending' && remaining.value > 0)
const displayStatus = computed(() => order.value?.status === 'pending' && !open.value ? 'expired' : order.value?.status)
const quote = computed(() => {
  const amount = order.value?.totalCents ?? 0
  if (!selected.value) return { fee: 0, total: amount }
  if (payment.value) return { fee: payment.value.feeCents, total: payment.value.payableCents }
  const p = selected.value.provider, methodFee = p.methodFees?.[selected.value.method]
  const fee = Math.round(Number((amount / 100 * Number(methodFee?.feeRate ?? p.feeRate ?? 0) + Number(methodFee?.feeFixed ?? p.feeFixed ?? 0)).toFixed(2)) * 100)
  return { fee, total: amount + fee }
})
const insufficient = computed(() => choice.value === 'balance' && walletBalance.value !== null && Math.round(walletBalance.value * 100) < (order.value?.totalCents ?? 0))
const unavailable = computed(() => choice.value === 'balance' ? walletBalance.value === null : !selected.value || (payment.value?.status === 'uncertain' && !payment.value.payUrl))
const busyLabel = computed(() => busy.value ? t('checkout.processing') : payment.value?.payUrl ? t('checkout.continuePayment') : t('cart.pay'))
const choiceStorageKey = () => `payincus.checkout-choice.${auth.user?.id}.${props.id}`
function accept(value: CheckoutOrder) {
  if (value.id !== props.id) throw Error(t('cart.statusFailed'))
  order.value = value
  if (['cancelled','expired'].includes(value.status)) emit('closed', value)
  if (!initializedChoice) {
    const latest = value.payments.at(-1)
    let saved: string | null = null
    try { saved = sessionStorage.getItem(choiceStorageKey()) } catch { /* Storage can be disabled. */ }
    const initial = saved || (typeof route.query.payment === 'string' ? route.query.payment : latest ? `${latest.providerId}:${options.value.find(o => o.provider.id === latest.providerId && (o.method === latest.method || o.provider.type !== 'yipay'))?.method ?? ''}` : 'balance')
    if (initial === 'balance' || options.value.some(o => o.key === initial)) choice.value = initial
    initializedChoice = true
  }
  if (value.paidAt) emit('paid', value)
}
async function refresh(manual = false) {
  if (!active || busy.value) return
  clearTimeout(timer)
  const current = context(), seq = ++sequence
  if (manual) checking.value = true
  try {
    const result = manual ? await api.checkout.verify(props.id) : await api.checkout.get(props.id)
    if (current() && seq === sequence) { accept(result); if (manual) error.value = '' }
  } catch (err) { if (current() && seq === sequence) error.value = translateError(err) }
  finally {
    if (current() && seq === sequence) {
      checking.value = false
      if (!order.value || ['pending','paid','fulfilling','partial','refund_pending'].includes(order.value.status) ||
        order.value.result?.instances.some(row => row.refundPending || row.publicIpUpdating || (['running','stopped'].includes(row.status) && !row.host))) timer = setTimeout(() => void refresh(), 4000)
    }
  }
}
async function pay() {
  if (!open.value || busy.value || insufficient.value || unavailable.value) return
  const current = context(), key = choice.value, option = selected.value
  sequence++; clearTimeout(timer); busy.value = true; error.value = ''
  try {
    const result = key === 'balance' ? await api.checkout.balance(props.id) : option ? await api.checkout.payment(props.id, option.provider.id, option.method || undefined) : null
    if (result && current()) {
      accept(result)
      if (key === 'balance') {
        void auth.fetchCurrentUser()
        walletBalance.value = null
        void api.billing.getUserBalance().then(value => { if (current()) walletBalance.value = value.balance.balance }).catch(() => {})
      }
      else if (choice.value === key && result.status === 'pending') {
        const attempt = result.payments.find(row => row.providerId === option?.provider.id && (!option.method || row.method === option.method))
        if (attempt?.payUrl) window.location.assign(attempt.payUrl)
      }
    }
  } catch (err) { if (current()) error.value = translateError(err) }
  finally { if (current()) { busy.value = false; void refresh() } }
}
async function cancel() {
  if (!open.value || busy.value) return
  const current = context(); sequence++; clearTimeout(timer); busy.value = true; error.value = ''
  try { const result = await api.checkout.cancel(props.id); if (current()) accept(result) }
  catch (err) { if (current()) error.value = translateError(err) }
  finally { if (current()) { busy.value = false; void refresh() } }
}
watch(choice, () => {
  error.value = ''
  if (initializedChoice && active && order.value) try { sessionStorage.setItem(choiceStorageKey(), choice.value) } catch { /* Optional choice preference. */ }
})
async function initialize() {
  if (!active) return
  clearInterval(clock); clearTimeout(timer)
  const current = context()
  configurationReady.value = false
  clock = setInterval(() => { now.value = Date.now() },1000)
  await Promise.all([
    api.billing.getPaymentProviders().then(result => { if (current()) providers.value = result.providers }),
    api.billing.getUserBalance().then(result => { if (current()) walletBalance.value = result.balance.balance })
  ]).then(() => { if (current()) configurationReady.value = true }).catch(err => { if (current()) error.value = translateError(err) })
  if (current()) {
    await refresh()
    if (current() && route.query.paymentFailed === '1' && order.value?.status === 'pending') error.value = t('checkout.paymentFailed')
  }
}
function reset() {
  generation++; sequence++; clearTimeout(timer); clearInterval(clock)
  order.value = null; providers.value = []; walletBalance.value = null
  configurationReady.value = false
  busy.value = false; checking.value = false; error.value = ''; choice.value = 'balance'; initializedChoice = false
}
function activate() { if (active) return; active = true; reset(); void initialize() }
onMounted(activate); onActivated(activate)
onDeactivated(() => { active = false; reset() })
watch(() => [props.id, auth.user?.id, auth.token], () => { reset(); if (active) void initialize() })
onBeforeUnmount(() => { alive = false; active = false; reset() })
</script>

<template>
  <section class="purchase-payment" :aria-busy="busy">
    <header class="payment-heading"><div><h1>{{ t('cart.confirmTitle') }}</h1><p class="order-number">{{ t('checkout.orderNumber') }} {{ id }}</p></div><router-link to="/orders">{{ t('checkout.allOrders') }}</router-link></header>
    <div v-if="error" class="payment-error" role="alert">{{ error }}<button v-if="!configurationReady" type="button" class="payment-cancel" @click="initialize">{{ t('common.refresh') }}</button></div>
    <div v-if="!order" class="payment-loading" role="status"><Loader2 class="animate-spin motion-reduce:animate-none" :size="22" />{{ t('common.loading') }}</div>
    <template v-else>
      <p v-if="order.paidAt" class="payment-receipt">{{ paidLabel }} · {{ t('checkout.paidAmount') }} <strong>¥{{ formatPublicPrice(paidPayment?.payableCents ?? order.totalCents) }}</strong></p>
      <div v-if="!order.result?.instances.length" class="payment-state" :class="order.status === 'completed' ? 'success' : !open ? 'closed' : ''" role="status" aria-live="polite">
        <Check v-if="order.status === 'completed'" :size="20" /><Loader2 v-else-if="['paid','fulfilling'].includes(order.status)" :size="18" class="animate-spin motion-reduce:animate-none" /><CircleAlert v-else-if="!open" :size="20" />
        <div><h2>{{ t(`checkout.states.${displayStatus}`) }}</h2><p v-if="open">{{ t('checkout.expires', { time: `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2,'0')}` }) }}</p><p v-else-if="order.error">{{ order.error }}</p></div>
      </div>
      <CheckoutOrderResult v-if="order.result?.instances.length" :order="order.result" embedded @refresh="refresh()" />
      <div v-else class="payment-layout">
        <section class="payment-items" :aria-label="t('cart.items')">
          <article v-for="(item,index) in order.items" :key="index" class="payment-item">
            <div><h2>{{ item.namePrefix }}</h2><p v-if="item.regionName">{{ localizePoolRegionName(item.regionName, item.countryCode || '', locale) }}</p><p>{{ item.resourcePreset }} · {{ item.image }}</p><p>{{ item.memoryMiB }} MiB · {{ item.diskGiB }} GiB · {{ t('cart.count', { count: item.quantity }) }}</p><p>{{ t('cart.line.monthly') }} ¥{{ formatPublicPrice(item.monthlyPrice) }}<template v-if="item.setupFee"> · {{ t('cart.line.setup') }} ¥{{ formatPublicPrice(item.setupFee) }}</template></p></div>
            <strong>¥{{ formatPublicPrice((item.monthlyPrice + item.setupFee) * item.quantity) }}</strong>
          </article>
        </section>
        <section class="payment-checkout" :aria-label="t('cart.paymentMethod')">
          <h2>{{ open ? t('cart.paymentMethod') : t('cart.summary') }}</h2>
          <div v-if="open" class="payment-options" role="group" :aria-label="t('cart.paymentMethod')">
            <button type="button" :disabled="busy" :aria-pressed="choice === 'balance'" :class="choice === 'balance' ? 'selected' : ''" @click="choice = 'balance'"><Wallet :size="18" /><span>{{ balanceLabel }}</span><Check v-if="choice === 'balance'" :size="16" /></button>
            <button v-for="option in options" :key="option.key" type="button" :disabled="busy" :aria-pressed="choice === option.key" :class="choice === option.key ? 'selected' : ''" @click="choice = option.key"><PaymentMethodIcon :method="option.method || option.provider.methods?.[0]" :provider-type="option.provider.type" /><span>{{ option.label }}</span><Check v-if="choice === option.key" :size="16" /></button>
          </div>
          <dl><div><dt>{{ t('checkout.productTotal') }}</dt><dd>¥{{ formatPublicPrice(order.totalCents) }}</dd></div><div v-if="open && quote.fee"><dt>{{ t('wallet.feeNote') }}</dt><dd>¥{{ formatPublicPrice(quote.fee) }}</dd></div></dl>
          <div class="payment-total"><span>{{ open ? t('wallet.payableAmount') : t('checkout.productTotal') }}</span><strong>¥{{ formatPublicPrice(open ? quote.total : order.totalCents) }}</strong></div>
          <template v-if="open">
            <p v-if="insufficient" class="payment-error">{{ t('checkout.insufficient') }}</p>
            <p v-else-if="payment?.payUrl" class="payment-hint">{{ t('checkout.waiting', { method: selected?.label }) }}</p>
            <p v-else-if="payment?.status === 'uncertain'" class="payment-error">{{ t('checkout.uncertain') }}</p>
            <button type="button" class="payment-primary" :disabled="busy || insufficient || unavailable" @click="pay"><Loader2 v-if="busy" :size="18" class="animate-spin motion-reduce:animate-none" />{{ busyLabel }}<ArrowUpRight v-if="payment?.payUrl" :size="16" /></button>
            <button v-if="payment" type="button" class="payment-secondary" :disabled="checking || busy" @click="refresh(true)">{{ checking ? t('cart.gatewayChecking') : t('checkout.checkPayment') }}</button>
            <button type="button" class="payment-cancel" :disabled="busy" @click="cancel">{{ t('checkout.cancelOrder') }}</button>
          </template>
          <router-link v-else-if="!order.paidAt" to="/purchase" class="payment-primary"><ArrowLeft :size="16" />{{ t('cart.goShopping') }}</router-link>
          <p v-else-if="['paid','fulfilling'].includes(order.status)" class="payment-hint">{{ t('checkout.automaticDelivery') }}</p>
        </section>
      </div>
      <div v-if="order.refunds.length" class="payment-refunds"><h2>{{ t('checkout.refunds') }}</h2><p v-for="refund in order.refunds" :key="refund.id">{{ t(refund.refundedToBalance ? 'checkout.refundStates.balance' : `checkout.refundStates.${refund.status}`) }} <strong>¥{{ formatPublicPrice(refund.amountCents) }}</strong></p></div>
    </template>
  </section>
</template>

<style scoped>
.purchase-payment{width:100%;color:var(--text-primary);max-width:1120px;margin:0 auto;padding:24px 0 48px}.payment-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;margin-bottom:24px}.payment-heading h1{font-size:24px;font-weight:600;line-height:1.3}.payment-heading a{font-size:14px;text-decoration:underline;white-space:nowrap;min-height:44px;padding:12px 0}.order-number{font-size:12px;color:var(--text-secondary);margin-top:8px;overflow-wrap:anywhere}.payment-state{display:flex;align-items:center;gap:12px;border:1px solid var(--border-color);border-radius:12px;padding:18px 20px;margin:0 0 24px;background:var(--bg-secondary)}h2{font-size:16px;font-weight:600}.payment-state p,.payment-hint{font-size:14px;color:var(--text-secondary);line-height:1.6;margin-top:6px}.payment-state.success>svg{color:#16a34a}.payment-state.closed{color:var(--text-secondary)}.payment-layout{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:24px;align-items:start}.payment-items{min-width:0}.payment-item{display:flex;justify-content:space-between;gap:20px;padding:24px 0;border-bottom:1px solid var(--border-color)}.payment-item:first-child{padding-top:8px}.payment-item p{font-size:13px;line-height:1.7;color:var(--text-secondary);overflow-wrap:anywhere}.payment-item h2{overflow-wrap:anywhere}.payment-item strong{white-space:nowrap;font-variant-numeric:tabular-nums;font-size:18px}.payment-checkout{padding:24px;border:1px solid var(--border-color);border-radius:12px;background:var(--bg-secondary)}.payment-options{display:grid;gap:8px;margin-top:18px}.payment-options button{min-height:52px;display:flex;gap:12px;align-items:center;text-align:left;border:1px solid var(--border-color);border-radius:8px;padding:12px;background:var(--bg-primary);font-size:14px}.payment-options button.selected{border-color:var(--text-primary);box-shadow:inset 0 0 0 1px var(--text-primary)}.payment-options button>span{flex:1;min-width:0;overflow-wrap:anywhere}.payment-options small{display:block;color:var(--text-secondary);font-size:12px;margin-top:3px}dl{margin-top:24px;display:grid;gap:10px;font-size:14px}dl>div,.payment-total{display:flex;justify-content:space-between;gap:16px}dt{color:var(--text-secondary)}dd{font-variant-numeric:tabular-nums}.payment-total{border-top:1px solid var(--border-color);padding-top:18px;margin:18px 0 24px;align-items:baseline}.payment-total>span{font-size:14px}.payment-total strong{font-size:28px;letter-spacing:-.03em;font-variant-numeric:tabular-nums}.payment-primary,.payment-secondary{width:100%;min-height:48px;display:flex;align-items:center;justify-content:center;gap:8px;border-radius:8px;padding:12px 16px;font-size:14px;font-weight:600;text-align:center}.payment-primary{background:var(--text-primary);color:var(--bg-primary);margin-top:16px}.payment-secondary{border:1px solid var(--border-color);margin-top:10px}.payment-cancel{display:block;font-size:13px;text-decoration:underline;min-height:44px;margin:8px auto 0}.payment-error{color:#b91c1c;font-size:14px;line-height:1.6;margin:12px 0}.payment-refunds{padding:20px;border:1px solid var(--border-color);border-radius:12px;margin-top:24px}.payment-refunds p{display:flex;justify-content:space-between;gap:20px;margin-top:12px;font-size:14px}.payment-loading{padding:48px;display:flex;justify-content:center;gap:12px}button:disabled{opacity:.5;cursor:not-allowed}button:focus-visible,a:focus-visible{outline:2px solid var(--text-primary);outline-offset:3px}@media(max-width:760px){.purchase-payment{padding-top:12px}.payment-layout{grid-template-columns:1fr}.payment-heading h1{font-size:22px}.payment-heading{gap:12px}.payment-checkout{padding:20px}.payment-item{padding:18px 0}.payment-item strong{font-size:16px}.payment-state{padding:16px}}
.dark .payment-error{color:#fca5a5}.payment-options button>svg{flex-shrink:0}.payment-heading>div{min-width:0}.payment-item>div{min-width:0}
.payment-receipt{margin:-8px 0 24px;color:var(--text-secondary);font-size:14px;line-height:1.6}.payment-receipt strong{color:var(--text-primary);font-variant-numeric:tabular-nums}.payment-total{flex-wrap:wrap}.payment-total strong{margin-left:auto;overflow-wrap:anywhere;min-width:0}.payment-item{flex-wrap:wrap}.payment-item>div{flex:1 1 180px}.payment-item strong{margin-left:auto}
</style>
