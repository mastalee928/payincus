<script setup lang="ts">
/**
 * 结算页（一机一卖购物车）
 *
 * 打开时重新拉商品目录，逐行比对：已下架、价格变动、库存不足都提前标出来；
 * 真正的裁决在付款事务里（整单全有或全无）。允许删行、改数量、改前缀，不允许改配置。
 */
import { computed, nextTick, onMounted, onActivated, onDeactivated, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ArrowLeft, ArrowRight, Check, CreditCard, Cpu, HardDrive, KeyRound, Loader2, LockKeyhole, MemoryStick, Minus, Plus, ShoppingBag, Trash2, Wallet } from 'lucide-vue-next'
import api from '@/api'
import FlagIcon from '@/components/FlagIcon.vue'
import CheckoutOrderResult from '@/components/CheckoutOrderResult.vue'
import { useCartStore, type CartItem } from '@/stores/cart'
import { useConfigStore } from '@/stores/config'
import { useAuthStore } from '@/stores/auth'
import type { SshKey } from '@/types/api'
import type { PoolCheckoutResult } from '@/types/host-pool'
import TurnstileWidget from '@/components/TurnstileWidget.vue'
import { useThemeStore } from '@/stores/theme'
import { translateError } from '@/utils/errorHandler'
import { validateName } from '@/utils/validation'
import {
  buildPoolInstanceNames,
  formatMemoryMiB,
  formatPublicPrice,
  presetLabel,
  type PoolCatalogProduct,
  type PoolCatalogRegion
} from '@/utils/poolCatalog'
import { localizePoolRegionName } from '@/utils/poolRegionCatalog'

defineOptions({ name: 'CheckoutView' })

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const { t, locale } = useI18n()
const themeStore = useThemeStore()
const cartStore = useCartStore()
const configStore = useConfigStore()
const sshKeys = ref<SshKey[]>([])

const regions = ref<PoolCatalogRegion[]>([])
const loading = ref(true)
const paying = ref(false)
const error = ref('')
const sshKeyId = ref<number | null>(null)
/** 付款被拒后服务端给出的真实余量，覆盖目录里的数字 */
const serverAvailable = ref<Record<number, number>>({})
/** 认证方式：整单共用。key = 选一把 SSH 密钥；password = 系统生成 root 密码。 */
const authMode = ref<'key' | 'password'>('key')
const orderResult = ref<PoolCheckoutResult | null>(null)
const turnstileToken = ref('')
const turnstileRef = ref<InstanceType<typeof TurnstileWidget> | null>(null)
const turnstileRequired = computed(() => configStore.turnstileEnabled && !!configStore.turnstileSiteKey)
const acceptPrices = ref(false)
const maxInstances = ref(100)
/**
 * 支付方式：'balance' 走现有余额扣款；数字是后台已启用渠道的 id。
 * 选渠道时按整单金额创建充值单（服务端把手续费补足到账不少于订单额），到账后仍由余额完成
 * 整单扣款与开通 —— 购买订单本身没有新增任何支付状态。
 */
const payProviders = ref<Array<{ id: number; name: string; type: string }>>([])
const payChoice = ref<'balance' | number>('balance')
const gatewayBusy = ref(false)
const gatewayError = ref('')
const gatewayCredited = ref(false)
const gatewayOrder = ref<{
  orderNo: string
  providerName: string
  payableCents: number
  actualAmountCents: number
  payUrl: string | null
  manualInstructions: string | null
} | null>(null)
type GatewayIntent = { requestId: string; providerId: number; amount: number }
const volatileGatewayIntents = new Map<number, GatewayIntent>()
function gatewayIntent(account: number, providerId: number, amount: number): GatewayIntent {
  let saved: GatewayIntent | null = volatileGatewayIntents.get(account) ?? null
  try { saved ??= JSON.parse(sessionStorage.getItem(`payincus.checkout-payment-intent.${account}`) || 'null') } catch { /* Use memory fallback. */ }
  if (!saved || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(saved.requestId) || !Number.isSafeInteger(saved.providerId) || saved.providerId < 1 || !Number.isFinite(saved.amount) || saved.amount <= 0) {
    saved = { requestId: crypto.randomUUID(), providerId, amount }
  }
  volatileGatewayIntents.set(account, saved)
  try { sessionStorage.setItem(`payincus.checkout-payment-intent.${account}`, JSON.stringify(saved)) } catch { /* Same-tab retry still works. */ }
  return saved
}
function clearGatewayIntent(account: number) {
  volatileGatewayIntents.delete(account)
  try { sessionStorage.removeItem(`payincus.checkout-payment-intent.${account}`) } catch { /* Receipt is authoritative. */ }
}
let pollTimer: ReturnType<typeof setTimeout> | undefined
let gatewayPollTimer: ReturnType<typeof setTimeout> | undefined
let disposed = false
const active = ref(false), catalogReady = ref(false)
let generation = 0, pollSequence = 0, gatewaySequence = 0
const session = computed(() => {
  if (!authStore.token || !authStore.user) return ''
  let identity = authStore.token
  try { const payload = JSON.parse(atob(identity.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); if (payload.sid) identity = payload.sid } catch { /* Keep legacy token identity. */ }
  return `${authStore.user.id}:${identity}`
})
function context() {
  const version = generation, authentication = authStore.captureAuthentication()
  return () => !disposed && active.value && !!session.value && route.path === '/checkout' && version === generation && authentication.aligned && authentication.current()
}
function resetContext() {
  generation++; pollSequence++; gatewaySequence++
  clearTimeout(pollTimer); clearTimeout(gatewayPollTimer)
  orderResult.value = null; regions.value = []; sshKeys.value = []; sshKeyId.value = null; serverAvailable.value = {}
  loading.value = false; catalogReady.value = false; paying.value = false; error.value = ''; acceptPrices.value = false
  gatewayOrder.value = null; gatewayBusy.value = false; gatewayCredited.value = false; gatewayError.value = ''; payProviders.value = []; payChoice.value = 'balance'
  turnstileToken.value = ''; volatileIntent = null
}
async function pollOrder() {
  clearTimeout(pollTimer)
  const current = context(), batchId = orderResult.value?.batchId, sequence = ++pollSequence
  const valid = () => current() && sequence === pollSequence && orderResult.value?.batchId === batchId
  if (!batchId || !valid()) return
  try {
    const result = await api.instances.getPoolOrder(batchId)
    if (valid() && result.batchId === batchId) { orderResult.value = result; error.value = '' }
  } catch { if (valid()) error.value = t('cart.statusFailed') }
  if (valid() && orderResult.value) {
    const pending = orderResult.value.instances.some(instance => instance.status === 'creating' || instance.refundPending || instance.publicIpUpdating)
    pollTimer = setTimeout(() => void pollOrder(), pending ? 4000 : 30000)
  }
}
async function acceptOrder(result: PoolCheckoutResult, submitted: CartItem[], account: number, requestId: string) {
  if (result.batchId !== requestId) throw Error(t('cart.statusFailed'))
  clearCheckoutIntent(account, requestId)
  try { sessionStorage.removeItem(`payincus.checkout-payment.${account}`) } catch { /* Receipt is authoritative. */ }
  orderResult.value = result
  // Only remove exactly what this request purchased; another tab or action may
  // have added or edited a line while the server was accepting the order.
  for (const item of submitted) {
    const current = cartStore.items.find(row => row.key === item.key)
    if (current && JSON.stringify(current) === JSON.stringify(item)) cartStore.remove(item.key, item)
  }
  await router.replace({ path: '/checkout', query: { order: result.batchId } })
}
function activate() { active.value = true }
onMounted(activate); onActivated(activate)
onDeactivated(() => { active.value = false })
onUnmounted(() => { disposed = true; resetContext() })

interface CheckoutRow {
  item: CartItem
  region: PoolCatalogRegion | null
  live: PoolCatalogProduct | null
  offSale: boolean
  priceChanged: boolean
  available: number
  stockShort: boolean
  names: string[]
  nameError: string
  subtotalCents: number
}

function findLive(poolPriceId: number): { region: PoolCatalogRegion; product: PoolCatalogProduct } | null {
  for (const region of regions.value) {
    const product = region.products.find(entry => entry.id === poolPriceId)
    if (product) return { region, product }
  }
  return null
}

/** 区域行标题按当前语言展示：优先活体目录名（「机型分组 · 地区」映射回静态目录），目录外原样返回。 */
const rowRegionLabel = (row: CheckoutRow) => localizePoolRegionName(
  row.region?.name ?? row.item.snapshot.regionName,
  row.region?.countryCode ?? row.item.snapshot.countryCode,
  locale.value
)

const rows = computed<CheckoutRow[]>(() => {
  const seenNames = new Set<string>()
  // 同一商品可能被加进购物车多次（多行）；库存要按该商品的总需求量比对，
  // 否则「两行各 1 台、池子只剩 1 台」会被逐行判成不缺货，付款被拒时也找不到行可提示。
  const requestedByProduct = new Map<number, number>()
  for (const item of cartStore.items) {
    requestedByProduct.set(item.poolPriceId, (requestedByProduct.get(item.poolPriceId) ?? 0) + item.quantity)
  }
  return cartStore.items.map(item => {
    const found = findLive(item.poolPriceId)
    const live = found?.product ?? null
    const unitCents = live ? live.monthlyPrice + live.setupFee : 0
    const priceChanged = !!live && (live.monthlyPrice !== item.snapshot.monthlyPrice || live.setupFee !== item.snapshot.setupFee)
    const available = serverAvailable.value[item.poolPriceId] ?? live?.idle ?? 0
    const requested = requestedByProduct.get(item.poolPriceId) ?? item.quantity
    const names = buildPoolInstanceNames(item.namePrefix.trim(), item.quantity)

    let nameError = ''
    for (const name of names) {
      const validation = validateName(name)
      if (!validation.valid) { nameError = validation.message || t('cart.nameInvalid'); break }
      if (seenNames.has(name)) { nameError = t('cart.nameDuplicate', { name }); break }
      seenNames.add(name)
    }

    return {
      item,
      region: found?.region ?? null,
      live,
      offSale: !live,
      priceChanged,
      available,
      stockShort: !!live && available < requested,
      names,
      nameError,
      subtotalCents: unitCents * item.quantity
    }
  })
})

const totalQuantity = computed(() => cartStore.totalQuantity)
const totalCents = computed(() => rows.value.reduce((sum, row) => sum + row.subtotalCents, 0))
const monthlyTotalCents = computed(() => rows.value.reduce((sum, row) => sum + (row.live?.monthlyPrice ?? 0) * row.item.quantity, 0))
const setupTotalCents = computed(() => rows.value.reduce((sum, row) => sum + (row.live?.setupFee ?? 0) * row.item.quantity, 0))
const tooMany = computed(() => totalQuantity.value > maxInstances.value)
/** 有问题的行：已下架 / 库存不足 / 名称不合法。付款时会就地拦下并引导处理。 */
const problemRows = computed(() => rows.value.filter(row => row.offSale || row.stockShort || !!row.nameError))
/** 付款按钮只在「空车 / 未选密钥 / 付款中 / 加载中」时禁用；缺货等问题留给点击时就地引导。 */
const canPay = computed(() => active.value && !!session.value && catalogReady.value && rows.value.length > 0 && (authMode.value === 'password' || sshKeyId.value !== null) && !paying.value && !loading.value)

/** 正在抖动的行 key，用于「滚到那一行并抖一下」的提示。 */
const shakingKey = ref<string | null>(null)

/** 滚到该行并左右抖一下，提醒用户处理这一行。 */
function highlightRow(key: string): void {
  const el = document.getElementById(`cart-row-${key}`)
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  shakingKey.value = null
  // 下一帧再设，保证连续点同一行也能重新触发动画。
  void nextTick(() => { shakingKey.value = key })
  window.setTimeout(() => { if (shakingKey.value === key) shakingKey.value = null }, 900)
}

async function loadCatalog(): Promise<void> {
  const current = context()
  catalogReady.value = false
  const response = await api.packages.getPublicCatalog()
  if (!current()) return
  if (!Array.isArray(response.regions)) throw Error(t('common.loadFailed'))
  regions.value = response.regions || []
  maxInstances.value = response.maxInstances ?? 100
  serverAvailable.value = {}
  catalogReady.value = true
}

async function initialize() {
  const current = context()
  if (!current()) return
  loading.value = true
  try {
    if (typeof route.query.order === 'string') {
      const id = route.query.order, result = await api.instances.getPoolOrder(id)
      if (!current()) return
      if (result.batchId !== id) throw Error(t('cart.statusFailed'))
      orderResult.value = result
      void pollOrder()
      return
    }
    await Promise.all([configStore.loadPublicConfig(), api.sshKeys.list().then(result => { if (current()) sshKeys.value = result.keys }), loadCatalog()])
    if (!current()) return
    void api.billing.getPaymentProviders()
      .then(result => { if (current()) payProviders.value = result.providers })
      .catch(() => { if (current()) payProviders.value = [] })
    if (sshKeys.value.length > 0) sshKeyId.value = sshKeys.value[0].id
    else authMode.value = 'password'
    await restoreGatewayOrder()
  } catch (err) {
    if (current()) { catalogReady.value = false; error.value = translateError(err) }
  } finally {
    if (current()) loading.value = false
  }
}
watch([session, active, () => route.fullPath], () => {
  resetContext()
  const version = generation
  void nextTick(() => { if (version === generation) void initialize() })
}, { flush: 'sync' })

function updateQuantity(row: CheckoutRow, value: number): void {
  const upper = Math.max(1, Math.min(row.available || 1, maxInstances.value))
  cartStore.setQuantity(row.item.key, Math.min(Math.max(1, Math.floor(value || 1)), upper))
}

watch(() => rows.value.map(row => row.live ? `${row.live.id}:${row.live.monthlyPrice}:${row.live.setupFee}` : '').join('|'), () => { acceptPrices.value = false })

let volatileIntent: { id: string; fingerprint: string; account: number } | null = null
function clearCheckoutIntent(account: number, id: string) {
  if (volatileIntent?.account === account && volatileIntent.id === id) volatileIntent = null
  try {
    const key = `payincus.checkout.${account}`
    if (JSON.parse(sessionStorage.getItem(key) || 'null')?.id === id) sessionStorage.removeItem(key)
  } catch { /* An acknowledged purchase remains successful if storage was blocked later. */ }
}
function checkoutRequestId(payload: unknown, account: number): string {
  const key = `payincus.checkout.${account}`
  const fingerprint = JSON.stringify(payload)
  if (volatileIntent?.account === account && volatileIntent.fingerprint === fingerprint) return volatileIntent.id
  try {
    const previous = JSON.parse(sessionStorage.getItem(key) || 'null')
    if (previous?.fingerprint === fingerprint && typeof previous.id === 'string') { volatileIntent = { ...previous, account }; return previous.id }
    const id = crypto.randomUUID()
    volatileIntent = { id, fingerprint, account }
    sessionStorage.setItem(key, JSON.stringify(volatileIntent))
    return id
  } catch { volatileIntent = { id: crypto.randomUUID(), fingerprint, account }; return volatileIntent.id }
}

async function pay(): Promise<void> {
  if (!canPay.value) return
  const account = authStore.user?.id, authentication = authStore.captureAuthentication()
  if (!account || !authentication.aligned) return
  const available = context()
  const current = () => available() && authentication.current() && authStore.user?.id === account

  if (tooMany.value) {
    error.value = t('cart.tooMany', { max: maxInstances.value })
    return
  }

  // 缺货 / 已下架 / 名称不合法：不直接拒付，滚到第一行问题商品并抖一下，就地提示。
  const problem = problemRows.value[0]
  if (problem) {
    error.value = ''
    highlightRow(problem.item.key)
    return
  }

  if (rows.value.some(row => row.priceChanged) && !acceptPrices.value) { error.value = t('cart.acceptPricesRequired'); return }
  const verificationToken = turnstileRef.value?.getToken() || turnstileToken.value
  if (turnstileRequired.value && !verificationToken) { error.value = t('instance.createPage.turnstileRequired'); return }
  paying.value = true
  error.value = ''
  const payload = {
      items: rows.value.map(row => ({
        poolPriceId: row.item.poolPriceId,
        quantity: row.item.quantity,
        namePrefix: row.item.namePrefix.trim(),
        image: row.item.image,
        customInitCommandIds: row.item.customInitCommandIds.length > 0 ? row.item.customInitCommandIds : undefined
      })),
      sshKeyId: authMode.value === 'key' ? sshKeyId.value ?? undefined : undefined,
      expectedTotal: totalCents.value
  }
  const submitted = JSON.parse(JSON.stringify(cartStore.items)) as CartItem[]
  const requestId = checkoutRequestId(payload, account)
  try {
    const result = await api.instances.poolOrder({ ...payload, requestId, turnstileToken: verificationToken || undefined })
    if (!current()) return
    await acceptOrder(result, submitted, account, requestId)
  } catch (err: any) {
    if (!current()) return
    const data = err?.response?.data ?? err
    const code = data?.code
    if (code === 'POOL_STOCK_SHORT' && Array.isArray(data?.shortages)) {
      const next: Record<number, number> = {}
      for (const shortage of data.shortages as Array<{ poolPriceId: number; available: number }>) {
        next[shortage.poolPriceId] = shortage.available
      }
      serverAvailable.value = next
      error.value = t('cart.stockShortError')
      // 按服务端给的真实余量重算后，滚到第一行缺货商品并抖动。
      await nextTick()
      if (!current()) return
      const firstShort = rows.value.find(row => row.stockShort)
      if (firstShort) highlightRow(firstShort.item.key)
    } else if (code === 'POOL_PRICE_CHANGED') {
      await loadCatalog().catch(() => {})
      if (!current()) return
      error.value = t('cart.priceChangedError')
      // 滚到第一行价格变动的商品并抖动，告诉用户是哪里变了。
      await nextTick()
      if (!current()) return
      const changed = rows.value.find(row => row.priceChanged)
      if (changed) highlightRow(changed.item.key)
    } else {
      const accepted = await api.instances.getPoolOrder(requestId).catch(() => null)
      if (!current()) return
      if (accepted) await acceptOrder(accepted, submitted, account, requestId)
      else error.value = translateError(err)
    }
  } finally {
    if (current()) {
      turnstileToken.value = ''; turnstileRef.value?.reset()
      paying.value = false
    }
  }
}

const payChoiceLabel = computed(() => {
  if (payChoice.value === 'balance') return t('cart.balance')
  return payProviders.value.find(provider => provider.id === payChoice.value)?.name ?? t('cart.balance')
})

function selectPayChoice(choice: 'balance' | number): void {
  payChoice.value = choice
  gatewayError.value = ''
  error.value = ''
}

function openGatewayPage(): void {
  if (!context()()) return
  if (gatewayOrder.value?.payUrl) window.open(gatewayOrder.value.payUrl, '_blank', 'noopener')
}

function scheduleGatewayPoll(delay = 5000): void {
  clearTimeout(gatewayPollTimer)
  if (!context()() || !gatewayOrder.value || gatewayCredited.value) return
  gatewayPollTimer = setTimeout(() => void refreshGatewayOrder(), delay)
}

/** 查充值单：到账即解锁结算；手动点刷新时再主动向网关查询一次（并非所有渠道都支持）。 */
async function refreshGatewayOrder(manual = false, silent = false): Promise<void> {
  const order = gatewayOrder.value
  const available = context(), sequence = ++gatewaySequence
  const current = () => available() && gatewayOrder.value?.orderNo === order?.orderNo && sequence === gatewaySequence
  if (!order || gatewayCredited.value || !current()) return
  if (!silent) gatewayBusy.value = true
  try {
    if (manual) await api.billing.verifyRechargeOrder(order.orderNo).catch(() => null)
    if (!current()) return
    const detail = await api.billing.getRechargeOrder(order.orderNo)
    if (!current() || detail.order.orderNo !== order.orderNo) return
    const status = detail.order.status
    if (status === 'completed') {
      if (detail.order.actualAmount !== null) order.actualAmountCents = Math.round(Number(detail.order.actualAmount) * 100)
      gatewayCredited.value = true
      gatewayError.value = ''
      payChoice.value = 'balance'
      return
    }
    if (status === 'failed' || status === 'cancelled' || status === 'expired' || status === 'refunded') {
      gatewayOrder.value = null
      saveGatewayOrder()
      gatewayError.value = t('cart.gatewayFailed')
      return
    }
    gatewayError.value = ''
  } catch (err) {
    if (!silent && current()) gatewayError.value = translateError(err)
  } finally {
    if (!silent && available() && sequence === gatewaySequence) gatewayBusy.value = false
  }
  if (current()) scheduleGatewayPoll()
}

function saveGatewayOrder() {
  try {
    const key = `payincus.checkout-payment.${authStore.user?.id}`
    if (gatewayOrder.value) sessionStorage.setItem(key, JSON.stringify(gatewayOrder.value))
    else sessionStorage.removeItem(key)
  } catch { /* The original order remains accessible in the user's order list. */ }
}
async function restoreGatewayOrder() {
  const current = context(), account = authStore.user?.id
  try {
    const saved = JSON.parse(sessionStorage.getItem(`payincus.checkout-payment.${authStore.user?.id}`) || 'null')
    if (!saved && account) {
      const intent = volatileGatewayIntents.get(account) ?? JSON.parse(sessionStorage.getItem(`payincus.checkout-payment-intent.${account}`) || 'null')
      if (!intent || typeof intent.requestId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(intent.requestId)) return
      const found = await api.billing.getRechargeCreation(intent.requestId)
      if (!current()) return
      if (!found.order) { payChoice.value = intent.providerId; return }
      gatewayOrder.value = { orderNo: found.order.orderNo, providerName: found.order.provider.name,
        payableCents: Math.round(found.order.payableAmount * 100), actualAmountCents: Math.round(Number(found.order.actualAmount) * 100),
        payUrl: null, manualInstructions: found.manualPayment?.instructions ?? null }
      saveGatewayOrder(); clearGatewayIntent(account)
      void refreshGatewayOrder()
      return
    }
    if (!saved || typeof saved.orderNo !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(saved.orderNo) || typeof saved.providerName !== 'string' ||
      ![saved.payableCents, saved.actualAmountCents].every(value => Number.isSafeInteger(value) && value >= 0) ||
      (saved.payUrl !== null && (typeof saved.payUrl !== 'string' || !/^https?:\/\//i.test(saved.payUrl))) ||
      (saved.manualInstructions !== null && typeof saved.manualInstructions !== 'string')) return
    gatewayOrder.value = saved
    void refreshGatewayOrder()
  } catch { if (current()) gatewayError.value = t('cart.statusFailed') }
}
async function resumeGatewayPayment() {
  const current = context(), order = gatewayOrder.value
  if (!current() || !order || gatewayBusy.value || gatewayCredited.value) return
  gatewayBusy.value = true; gatewayError.value = ''
  try {
    const result = await api.billing.repayRechargeOrder(order.orderNo)
    if (!current() || gatewayOrder.value?.orderNo !== order.orderNo || result.order.orderNo !== order.orderNo) return
    gatewayOrder.value = { ...order, payUrl: result.payUrl, manualInstructions: result.manualPayment?.instructions ?? null,
      payableCents: Math.round(result.order.payableAmount * 100), actualAmountCents: Math.round(Number(result.order.actualAmount) * 100) }
    saveGatewayOrder()
    openGatewayPage()
  } catch (err) { if (current()) gatewayError.value = translateError(err) }
  finally { if (current()) { gatewayBusy.value = false; void refreshGatewayOrder() } }
}

/** 选渠道时按整单金额创建充值单；到账后仍由余额完成扣款与开通。 */
async function startGatewayPayment(): Promise<void> {
  const current = context()
  const providerId = payChoice.value
  if (!current() || !canPay.value || providerId === 'balance' || gatewayBusy.value || rows.value.length === 0) return
  // 已有一张未完成的充值单时不再重复创建，直接回到支付页并刷新状态。
  if (gatewayOrder.value && !gatewayCredited.value) {
    openGatewayPage()
    void refreshGatewayOrder(true)
    return
  }
  if (tooMany.value) { error.value = t('cart.tooMany', { max: maxInstances.value }); return }
  const problem = problemRows.value[0]
  if (problem) { error.value = ''; highlightRow(problem.item.key); return }
  if (rows.value.some(row => row.priceChanged) && !acceptPrices.value) { error.value = t('cart.acceptPricesRequired'); return }
  gatewayBusy.value = true
  gatewayError.value = ''
  error.value = ''
  try {
    const targetYuan = totalCents.value / 100
    const account = authStore.user!.id, intent = gatewayIntent(account, providerId, targetYuan)
    const result = await api.billing.createRechargeOrder(intent.providerId, intent.amount, undefined, intent.amount, intent.requestId)
    if (!current()) return
    gatewayOrder.value = {
      orderNo: result.order.orderNo,
      providerName: result.provider.name,
      payableCents: Math.round(Number(result.order.payableAmount) * 100),
      actualAmountCents: Math.round(Number(result.order.actualAmount) * 100),
      payUrl: result.payUrl,
      manualInstructions: result.manualPayment?.instructions ?? null
    }
    saveGatewayOrder()
    clearGatewayIntent(account)
    if (result.payUrl && !result.recovered) window.open(result.payUrl, '_blank', 'noopener')
    if (result.recovered) void refreshGatewayOrder()
    else scheduleGatewayPoll(4000)
  } catch (err: any) {
    if (current()) {
      // This endpoint returns 400 only before persistence. Unknown outcomes
      // retain their identity; a definite input rejection can be corrected.
      if (err?.response?.status === 400) clearGatewayIntent(authStore.user!.id)
      gatewayError.value = translateError(err)
    }
  } finally {
    if (current()) gatewayBusy.value = false
  }
}

const primaryLabel = computed(() => {
  if (paying.value) return t('cart.paying')
  if (gatewayBusy.value) return t('cart.gatewayCreating')
  if (gatewayOrder.value && !gatewayCredited.value) return t('cart.gatewayWaiting')
  if (payChoice.value !== 'balance') return t('cart.gatewayPayButton', { amount: formatPublicPrice(totalCents.value) })
  return t('cart.pay')
})

function onPrimaryAction(): void {
  if (gatewayOrder.value && !gatewayCredited.value) return
  if (payChoice.value === 'balance') void pay()
  else void startGatewayPayment()
}
</script>

<template>
  <div class="checkout-page" :aria-busy="loading || paying">
    <header v-if="!orderResult" class="checkout-header">
      <h1>{{ t('cart.title') }}</h1>
      <router-link v-if="rows.length || orderResult" to="/purchase" class="checkout-back-link">
        <ArrowLeft :size="15" aria-hidden="true" />{{ t('cart.continueShopping') }}
      </router-link>
      <p v-if="!loading && !orderResult && rows.length" class="checkout-heading-meta">
        {{ t('cart.itemKinds', { count: rows.length }) }}<span aria-hidden="true">·</span>{{ t('cart.count', { count: totalQuantity }) }}
      </p>
    </header>

    <div v-if="error && (orderResult || loading || !rows.length)" class="checkout-alert checkout-alert-error" role="alert">{{ error }}</div>
    <CheckoutOrderResult v-if="orderResult" :order="orderResult" @refresh="pollOrder" />
    <div v-else-if="loading" class="checkout-panel checkout-loading" role="status">
      <Loader2 :size="22" class="animate-spin motion-reduce:animate-none" aria-hidden="true" />{{ t('common.loading') }}
    </div>

    <div v-else-if="rows.length === 0" class="checkout-panel checkout-empty">
      <span class="checkout-empty-icon"><ShoppingBag :size="32" :stroke-width="1.4" aria-hidden="true" /></span>
      <div class="checkout-empty-copy">
        <h2>{{ t('cart.empty') }}</h2>
        <p>{{ t('cart.emptyHint') }}</p>
      </div>
      <router-link to="/purchase" class="checkout-primary">
        {{ t('cart.goShopping') }}<ArrowRight :size="16" aria-hidden="true" />
      </router-link>
    </div>

    <fieldset v-else :disabled="paying" class="checkout-layout">
      <legend class="sr-only">{{ t('cart.title') }}</legend>
      <div class="checkout-main">
        <section class="checkout-items" aria-labelledby="checkout-items-title">
          <div class="checkout-section-heading">
            <h2 id="checkout-items-title">{{ t('cart.items') }}</h2>
          </div>
          <article
            v-for="row in rows"
            :id="`cart-row-${row.item.key}`"
            :key="row.item.key"
            :aria-labelledby="`cart-title-${row.item.key}`"
            class="checkout-panel checkout-item"
            :class="[
              row.offSale || row.stockShort || row.nameError ? 'checkout-item-invalid' : '',
              shakingKey === row.item.key ? 'cart-shake' : ''
            ]"
          >
            <div class="checkout-item-heading">
              <div class="min-w-0">
                <h3 :id="`cart-title-${row.item.key}`" class="checkout-region">
                  <FlagIcon v-if="row.region?.countryCode || row.item.snapshot.countryCode" :code="row.region?.countryCode || row.item.snapshot.countryCode!" size="sm" class="shrink-0" />
                  <span>{{ rowRegionLabel(row) }}</span>
                </h3>
                <div class="checkout-item-subtitle">
                  <span class="checkout-preset">{{ presetLabel(row.item.snapshot.resourcePreset) }}</span>
                  <span>{{ row.item.snapshot.imageLabel }}</span>
                </div>
              </div>
              <div class="checkout-item-cost">
                <div class="checkout-item-subtotal">
                  <span>{{ t('cart.line.subtotal') }}</span>
                  <strong>{{ row.live ? `¥${formatPublicPrice(row.subtotalCents)}` : '—' }}</strong>
                </div>
                <div class="checkout-unit-prices">
                  <p>{{ t('cart.line.monthly') }}<span>{{ row.live ? `¥${formatPublicPrice(row.live.monthlyPrice)}` : '—' }}</span></p>
                  <p v-if="row.live && row.live.setupFee > 0">{{ t('cart.line.setup') }}<span>¥{{ formatPublicPrice(row.live.setupFee) }}</span></p>
                </div>
              </div>
              <button type="button" class="checkout-remove" :aria-label="`${t('cart.line.remove')} ${rowRegionLabel(row)}`" :title="t('cart.line.remove')" @click="cartStore.remove(row.item.key)">
                <Trash2 :size="17" :stroke-width="1.7" aria-hidden="true" />
              </button>
            </div>

            <dl class="checkout-specs">
              <div><dt><Cpu :size="14" aria-hidden="true" />{{ t('cart.specs.cpu') }}</dt><dd>{{ t('cart.specs.cores', { count: row.item.snapshot.cpu / 100 }) }}</dd></div>
              <div><dt><MemoryStick :size="14" aria-hidden="true" />{{ t('cart.specs.memory') }}</dt><dd>{{ formatMemoryMiB(row.item.snapshot.memoryMiB) }}</dd></div>
              <div><dt><HardDrive :size="14" aria-hidden="true" />{{ t('cart.specs.disk') }}</dt><dd>{{ row.item.snapshot.diskGiB }} GiB</dd></div>
            </dl>

            <div class="checkout-item-fields">
              <div class="checkout-field">
                <label :for="`cart-name-${row.item.key}`">{{ row.item.quantity > 1 ? t('cart.line.namePrefix') : t('cart.line.name') }}</label>
                <input
                  :id="`cart-name-${row.item.key}`"
                  :value="row.item.namePrefix"
                  type="text" maxlength="60"
                  class="input checkout-input"
                  :aria-invalid="!!row.nameError"
                  :aria-describedby="row.nameError ? `cart-name-error-${row.item.key}` : row.item.quantity > 1 ? `cart-name-preview-${row.item.key}` : undefined"
                  @input="cartStore.setNamePrefix(row.item.key, ($event.target as HTMLInputElement).value)"
                />
                <span v-if="row.item.quantity > 1 && !row.nameError" :id="`cart-name-preview-${row.item.key}`" class="checkout-name-preview">{{ row.names.slice(0, 3).join(', ') }}{{ row.names.length > 3 ? ' …' : '' }}</span>
              </div>
              <div class="checkout-field">
                <label :for="`cart-quantity-${row.item.key}`">{{ t('cart.line.quantity') }}</label>
                <div class="checkout-quantity">
                  <button type="button" :aria-label="`${t('cart.line.decrease')} ${row.item.namePrefix}`" :disabled="row.offSale || row.item.quantity <= 1" @click="updateQuantity(row, row.item.quantity - 1)"><Minus :size="15" aria-hidden="true" /></button>
                  <input
                    :id="`cart-quantity-${row.item.key}`"
                    :value="row.item.quantity"
                    type="number" min="1" :max="Math.max(1, Math.min(row.available || 1, maxInstances))" step="1"
                    :disabled="row.offSale"
                    @change="updateQuantity(row, Number(($event.target as HTMLInputElement).value))"
                  />
                  <button type="button" :aria-label="`${t('cart.line.increase')} ${row.item.namePrefix}`" :disabled="row.offSale || row.item.quantity >= Math.max(1, Math.min(row.available || 1, maxInstances))" @click="updateQuantity(row, row.item.quantity + 1)"><Plus :size="15" aria-hidden="true" /></button>
                </div>
              </div>
            </div>

            <div v-if="row.offSale || row.stockShort || row.priceChanged || row.nameError" class="checkout-row-messages">
              <p v-if="row.offSale" class="text-red-600 dark:text-red-400">{{ t('cart.flags.offSale') }}</p>
              <p v-else-if="row.stockShort" class="text-red-600 dark:text-red-400">{{ row.available <= 0 ? t('cart.flags.stockEmpty') : t('cart.flags.stockShort', { available: row.available }) }}</p>
              <p v-if="row.priceChanged && row.live" class="text-amber-600 dark:text-amber-400">{{ t('cart.flags.priceChanged', { price: formatPublicPrice(row.live.monthlyPrice + row.live.setupFee) }) }}</p>
              <p v-if="row.nameError" :id="`cart-name-error-${row.item.key}`" class="text-red-600 dark:text-red-400">{{ row.nameError }}</p>
            </div>
          </article>
        </section>

        <section class="checkout-panel checkout-login" aria-labelledby="checkout-auth-title">
          <div class="checkout-login-heading">
            <h2 id="checkout-auth-title">{{ t('cart.loginMethod') }}</h2>
            <p>{{ t('cart.loginScope') }}</p>
          </div>
          <div class="checkout-auth-options" role="group" aria-labelledby="checkout-auth-title">
            <button
              type="button"
              class="checkout-auth-option"
              :class="{ 'is-selected': authMode === 'key' }"
              :aria-pressed="authMode === 'key'"
              @click="authMode = 'key'"
            >
              <KeyRound :size="18" aria-hidden="true" />
              <span>{{ t('publicSite.market.pool.authKey') }}</span>
              <span class="checkout-auth-check" aria-hidden="true"><Check v-if="authMode === 'key'" :size="12" :stroke-width="3" /></span>
            </button>
            <button
              type="button"
              class="checkout-auth-option"
              :class="{ 'is-selected': authMode === 'password' }"
              :aria-pressed="authMode === 'password'"
              @click="authMode = 'password'"
            >
              <LockKeyhole :size="18" aria-hidden="true" />
              <span>{{ t('cart.passwordLogin') }}</span>
              <span class="checkout-auth-check" aria-hidden="true"><Check v-if="authMode === 'password'" :size="12" :stroke-width="3" /></span>
            </button>
          </div>
          <label v-if="authMode === 'key'" class="checkout-field">
            {{ t('cart.sshKey') }}
            <select v-model="sshKeyId" class="input checkout-input" :disabled="sshKeys.length === 0">
              <option v-for="key in sshKeys" :key="key.id" :value="key.id">{{ key.name || `#${key.id}` }}</option>
            </select>
            <span v-if="sshKeys.length === 0" class="text-xs text-red-600 dark:text-red-400">{{ t('cart.noSshKey') }}</span>
          </label>
          <p v-else class="checkout-password-hint">{{ t('cart.passwordHint') }}</p>
        </section>
      </div>

      <aside class="checkout-panel checkout-summary" aria-labelledby="checkout-summary-title">
        <div class="checkout-summary-section">
          <h2 id="checkout-summary-title">{{ t('cart.summary') }}</h2>
          <dl class="checkout-totals">
            <div><dt>{{ t('cart.line.quantity') }}</dt><dd>{{ t('cart.count', { count: totalQuantity }) }}</dd></div>
            <div><dt>{{ t('cart.monthlyTotal') }}</dt><dd>¥{{ formatPublicPrice(monthlyTotalCents) }}</dd></div>
            <div v-if="setupTotalCents > 0"><dt>{{ t('cart.setupTotal') }}</dt><dd>¥{{ formatPublicPrice(setupTotalCents) }}</dd></div>
            <div><dt>{{ t('cart.paymentMethod') }}</dt><dd>{{ payChoiceLabel }}</dd></div>
          </dl>
          <div class="checkout-grand-total">
            <span>{{ t('cart.firstPayment') }}</span>
            <strong><span class="checkout-currency">¥</span>{{ formatPublicPrice(totalCents) }}</strong>
          </div>
        </div>

        <div class="checkout-summary-section checkout-payment">
          <p v-if="tooMany" class="text-xs text-red-600 dark:text-red-400">{{ t('cart.tooMany', { max: maxInstances }) }}</p>
          <div v-if="error" class="checkout-alert checkout-alert-error" role="alert">{{ error }}</div>
          <div v-if="payProviders.length > 0 && totalCents > 0" class="checkout-pay-choice" role="group" :aria-label="t('cart.paymentMethod')">
            <button type="button" class="checkout-pay-option" :class="{ 'is-selected': payChoice === 'balance' }" :aria-pressed="payChoice === 'balance'" @click="selectPayChoice('balance')">
              <Wallet :size="16" aria-hidden="true" />
              <span>{{ t('cart.balance') }}</span>
              <span class="checkout-pay-check" aria-hidden="true"><Check v-if="payChoice === 'balance'" :size="12" :stroke-width="3" /></span>
            </button>
            <button v-for="provider in payProviders" :key="provider.id" type="button" class="checkout-pay-option" :class="{ 'is-selected': payChoice === provider.id }" :aria-pressed="payChoice === provider.id" @click="selectPayChoice(provider.id)">
              <CreditCard :size="16" aria-hidden="true" />
              <span>{{ provider.name }}</span>
              <span class="checkout-pay-check" aria-hidden="true"><Check v-if="payChoice === provider.id" :size="12" :stroke-width="3" /></span>
            </button>
          </div>
          <p v-if="payChoice !== 'balance'" class="checkout-pay-hint">{{ t('cart.gatewayAmountHint') }}</p>
          <div v-if="gatewayOrder" class="checkout-gateway" role="status">
            <p v-if="gatewayCredited" class="checkout-gateway-credited">{{ t('cart.gatewayCredited', { amount: formatPublicPrice(gatewayOrder.actualAmountCents) }) }}</p>
            <template v-else>
              <p>{{ t('cart.gatewayPending', { name: gatewayOrder.providerName }) }}</p>
              <p class="checkout-gateway-meta">{{ t('cart.gatewayPayHint', { payable: formatPublicPrice(gatewayOrder.payableCents), actual: formatPublicPrice(gatewayOrder.actualAmountCents) }) }}</p>
              <pre v-if="gatewayOrder.manualInstructions" class="checkout-gateway-manual">{{ gatewayOrder.manualInstructions }}</pre>
            </template>
            <p v-if="gatewayError" class="text-xs text-red-600 dark:text-red-400">{{ gatewayError }}</p>
            <div v-if="!gatewayCredited" class="checkout-gateway-actions">
              <button v-if="gatewayOrder.payUrl" type="button" class="checkout-secondary" @click="openGatewayPage">{{ t('cart.gatewayOpen') }}</button>
              <button v-else-if="!gatewayOrder.manualInstructions" type="button" class="checkout-secondary" :disabled="gatewayBusy" @click="resumeGatewayPayment">{{ t('cart.gatewayResume') }}</button>
              <button type="button" class="checkout-secondary" :disabled="gatewayBusy" @click="refreshGatewayOrder(true)">{{ t('cart.gatewayRefresh') }}</button>
            </div>
            <p v-if="!gatewayCredited && !gatewayOrder.payUrl && !gatewayOrder.manualInstructions" class="checkout-gateway-meta">{{ t('cart.gatewayRecovered') }}</p>
          </div>
          <p v-if="gatewayError && !gatewayOrder" class="checkout-alert checkout-alert-error" role="alert">{{ gatewayError }}</p>
          <label v-if="rows.some(row => row.priceChanged)" class="checkout-price-consent"><input v-model="acceptPrices" type="checkbox" />{{ t('cart.acceptPrices') }}</label>
          <div v-if="turnstileRequired" class="checkout-verification">
            <TurnstileWidget ref="turnstileRef" v-model="turnstileToken" :site-key="configStore.turnstileSiteKey!" :theme="themeStore.isDark ? 'dark' : 'light'" size="compact" action="pool-checkout" />
          </div>
          <button type="button" class="checkout-primary checkout-pay" :disabled="!canPay || gatewayBusy || (!!gatewayOrder && !gatewayCredited)" @click="onPrimaryAction">
            <Loader2 v-if="paying || gatewayBusy" :size="17" class="animate-spin motion-reduce:animate-none" aria-hidden="true" />
            {{ primaryLabel }}
            <ArrowRight v-if="!paying && !gatewayBusy" :size="17" aria-hidden="true" />
          </button>
        </div>
      </aside>
    </fieldset>
  </div>
</template>

<style scoped>
.checkout-page { display: grid; gap: 24px; width: 100%; max-width: 1200px; margin-inline: auto; color: var(--text-primary); }
.checkout-header { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 4px 20px; padding: 4px 0 22px; border-bottom: 1px solid var(--border-color); }
.checkout-header h1 { font-size: 26px; font-weight: 650; letter-spacing: -0.03em; line-height: 1.3; }
.checkout-heading-meta { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 8px; color: var(--text-secondary); font-size: 13px; }
.checkout-back-link { display: inline-flex; align-items: center; gap: 7px; min-height: 44px; color: var(--text-secondary); font-size: 13px; flex-shrink: 0; text-underline-offset: 4px; }
.checkout-back-link:hover { color: var(--text-primary); text-decoration: underline; }
.checkout-panel { min-width: 0; border: 1px solid var(--border-color); border-radius: 14px; background: var(--bg-elevated); }
.checkout-layout { min-width: 0; display: grid; gap: 24px; align-items: start; }
.checkout-main { display: grid; gap: 24px; min-width: 0; container: checkout-main / inline-size; }
.checkout-items { min-width: 0; display: grid; gap: 12px; }
.checkout-section-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-bottom: 4px; }
.checkout-section-heading h2, .checkout-summary h2, .checkout-login h2 { font-size: 15px; font-weight: 600; line-height: 1.5; }
.checkout-item { padding: 20px; scroll-margin: 24px; }
.checkout-item-invalid { border-color: rgb(239 68 68 / 0.5); }
.checkout-item-heading { display: grid; grid-template-columns: minmax(0, 1fr) max-content 44px; align-items: start; gap: 12px; }
.checkout-region { display: flex; align-items: center; gap: 9px; font-size: 16px; font-weight: 600; line-height: 1.5; }
.checkout-region > span:last-child { min-width: 0; overflow-wrap: anywhere; }
.checkout-item-subtitle { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 8px; font-size: 12px; color: var(--text-secondary); }
.checkout-preset { padding-right: 8px; border-right: 1px solid var(--border-color); font-weight: 600; }
.checkout-remove { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 8px; color: var(--text-secondary); transition: color 150ms, background 150ms; }
.checkout-remove:hover:not(:disabled) { color: #dc2626; background: rgb(239 68 68 / 0.07); }
.checkout-specs { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 18px 0; padding: 14px 0; border-top: 1px solid var(--border-color); border-bottom: 1px solid var(--border-color); }
.checkout-specs > div { min-width: 0; }
.checkout-specs dt { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-secondary); }
.checkout-specs dd { margin-top: 5px; font-size: 15px; font-weight: 550; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.checkout-item-fields { display: grid; grid-template-columns: minmax(0, 1fr) 140px; gap: 16px; }
.checkout-field { display: flex; flex-direction: column; gap: 8px; min-width: 0; font-size: 12px; color: var(--text-secondary); }
/* Keep checkout fields neutral despite the app shell's input overrides. */
.checkout-page .checkout-input { width: 100%; min-width: 0; min-height: 44px; margin: 0; padding: 10px 12px; border: 1px solid var(--border-color); border-color: var(--border-color) !important; border-radius: 8px; background: var(--bg-elevated) !important; color: var(--text-primary); caret-color: var(--text-primary); box-shadow: none !important; font-size: 14px; }
.checkout-page .checkout-input:focus { border-color: var(--text-secondary) !important; outline: 2px solid var(--border-hover); outline-offset: 2px; box-shadow: none !important; }
.checkout-page .checkout-input[aria-invalid="true"] { border-color: rgb(239 68 68 / 0.65) !important; }
.checkout-name-preview { font-size: 12px; color: var(--text-secondary); overflow-wrap: anywhere; line-height: 1.5; }
.checkout-quantity { display: grid; grid-template-columns: 44px minmax(0, 1fr) 44px; height: 44px; border: 1px solid var(--border-color); border-radius: 8px; overflow: hidden; color: var(--text-primary); }
.checkout-quantity button { display: grid; place-items: center; transition: background 150ms; }
.checkout-quantity button:hover:not(:disabled) { background: var(--bg-tertiary); }
.checkout-quantity input { width: 100%; min-width: 0; border: 0; border-color: transparent !important; padding: 0; background: transparent !important; text-align: center; color: var(--text-primary); caret-color: var(--text-primary); font-size: 14px; font-variant-numeric: tabular-nums; appearance: textfield; box-shadow: none !important; }
.checkout-quantity input::-webkit-inner-spin-button, .checkout-quantity input::-webkit-outer-spin-button { appearance: none; margin: 0; }
.checkout-quantity input:focus { outline: none; box-shadow: inset 0 0 0 1px var(--text-secondary) !important; }
.checkout-item-cost { display: grid; gap: 6px; min-width: 0; }
.checkout-unit-prices { display: grid; gap: 4px; font-size: 12px; color: var(--text-secondary); }
.checkout-unit-prices p { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 6px; align-items: baseline; }
.checkout-unit-prices span { font-variant-numeric: tabular-nums; }
.checkout-item-subtotal { display: grid; gap: 2px; text-align: right; }
.checkout-item-subtotal > span { font-size: 12px; color: var(--text-secondary); }
.checkout-item-subtotal > strong { font-size: 22px; font-weight: 600; line-height: 1.3; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.checkout-row-messages { display: grid; gap: 5px; margin-top: 16px; padding-top: 13px; border-top: 1px solid var(--border-color); font-size: 12px; line-height: 1.6; }
.checkout-summary { min-width: 0; }
.checkout-summary-section { padding: 22px; }
.checkout-totals { display: grid; gap: 14px; margin-top: 22px; font-size: 13px; }
.checkout-totals > div { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; }
.checkout-totals dt { color: var(--text-secondary); }
.checkout-totals dd { text-align: right; font-variant-numeric: tabular-nums; }
.checkout-grand-total { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: 8px 12px; margin-top: 22px; padding-top: 20px; border-top: 1px solid var(--border-color); }
.checkout-grand-total > span { font-size: 13px; font-weight: 550; }
.checkout-grand-total strong { min-width: 0; margin-left: auto; font-size: 32px; line-height: 1.2; font-weight: 650; letter-spacing: -0.03em; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.checkout-currency { margin-right: 3px; font-size: 20px; font-weight: 500; }
.checkout-login { display: grid; gap: 16px; padding: 20px; }
.checkout-login-heading p { margin-top: 5px; color: var(--text-secondary); font-size: 12px; line-height: 1.6; }
.checkout-auth-options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.checkout-auth-option { display: flex; align-items: center; gap: 10px; min-height: 52px; padding: 12px; border: 1px solid var(--border-color); border-radius: 8px; text-align: left; font-size: 13px; color: var(--text-secondary); transition: background 150ms, border-color 150ms; }
.checkout-auth-option > svg { flex-shrink: 0; }
.checkout-auth-option:hover:not(:disabled) { background: var(--bg-secondary); border-color: var(--border-hover); }
.checkout-auth-option.is-selected { color: var(--text-primary); border-color: var(--text-primary); background: var(--bg-secondary); }
.checkout-auth-check { display: grid; place-items: center; width: 18px; height: 18px; margin-left: auto; flex-shrink: 0; border: 1px solid var(--border-hover); border-radius: 50%; }
.is-selected .checkout-auth-check { border-color: var(--text-primary); background: var(--text-primary); color: var(--bg-elevated); }
.checkout-password-hint { color: var(--text-secondary); font-size: 12px; line-height: 1.6; }
.checkout-payment { display: grid; gap: 14px; padding-top: 0; }
.checkout-primary, .checkout-secondary { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; padding: 11px 18px; border: 1px solid var(--text-primary); border-radius: 10px; font-size: 13px; font-weight: 550; line-height: 1.5; transition: opacity 150ms, background 150ms; }
.checkout-primary { background: var(--text-primary); color: var(--bg-elevated); }
.checkout-primary:hover:not(:disabled) { opacity: 0.85; }
.checkout-secondary { background: var(--bg-elevated); border-color: var(--border-color); color: var(--text-primary); }
.checkout-pay { width: 100%; min-height: 48px; font-size: 14px; }
.checkout-page button:disabled { cursor: not-allowed; opacity: 0.45; }
.checkout-page button:focus-visible, .checkout-back-link:focus-visible, .checkout-primary:focus-visible { outline: 2px solid var(--text-secondary); outline-offset: 3px; }
.checkout-quantity button:focus-visible { outline-offset: -3px; }
.checkout-price-consent { display: flex; align-items: flex-start; gap: 9px; font-size: 12px; line-height: 1.6; }
.checkout-price-consent input { margin-top: 2px; flex-shrink: 0; color: var(--text-primary) !important; border-color: var(--border-hover) !important; border-radius: 4px; }
.checkout-verification { min-width: 0; max-width: 100%; }
.checkout-alert { padding: 12px 14px; border: 1px solid rgb(239 68 68 / 0.25); border-radius: 10px; font-size: 12px; line-height: 1.65; }
.checkout-alert-error { color: #dc2626; background: rgb(239 68 68 / 0.045); }
:global(.dark) .checkout-alert-error { color: #f87171; }
.checkout-loading { display: flex; align-items: center; justify-content: center; gap: 10px; min-height: 240px; color: var(--text-secondary); font-size: 13px; }
.checkout-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 24px; min-height: 340px; padding: 40px 24px; text-align: center; }
.checkout-empty h2 { font-size: 20px; font-weight: 550; letter-spacing: -0.02em; }
.checkout-empty-copy p { max-width: 36ch; margin-top: 8px; font-size: 14px; line-height: 1.7; color: var(--text-secondary); }
.checkout-empty-icon { display: grid; place-items: center; width: 64px; height: 64px; border-radius: 16px; background: var(--bg-secondary); color: var(--text-secondary); }
.checkout-page ::selection { background: var(--text-primary); color: var(--bg-elevated); }
@media (min-width: 1100px) {
  .checkout-layout { grid-template-columns: minmax(0, 1fr) 320px; }
  .checkout-summary { position: sticky; top: 24px; margin-top: 38px; }
}
@container checkout-main (max-width: 560px) {
  .checkout-item-heading { grid-template-columns: minmax(0, 1fr) 44px; }
  .checkout-remove { grid-area: 1 / 2; }
  .checkout-item-cost { grid-column: 1 / -1; display: flex; justify-content: space-between; align-items: end; gap: 16px; }
  .checkout-item-subtotal { text-align: left; }
}
@media (max-width: 540px) {
  .checkout-page { gap: 20px; }
  .checkout-header { column-gap: 12px; row-gap: 6px; }
  .checkout-header h1 { font-size: 23px; }
  .checkout-back-link { font-size: 12px; }
  .checkout-layout, .checkout-main { gap: 20px; }
  .checkout-item, .checkout-login, .checkout-summary-section { padding: 16px; }
  .checkout-payment { padding-top: 0; }
  .checkout-region { font-size: 15px; }
  .checkout-item-fields { gap: 12px; }
  .checkout-auth-option { gap: 7px; padding: 10px; }
  .checkout-specs { gap: 8px; }
}
@media (max-width: 360px) {
  .checkout-auth-options { grid-template-columns: minmax(0, 1fr); }
  .checkout-item-fields { grid-template-columns: minmax(0, 1fr); }
  .checkout-item-fields > .checkout-field:last-child { flex-direction: row; align-items: center; justify-content: space-between; }
  .checkout-quantity { width: 140px; }
}
/* 缺货商品框左右抖动：付款被拦下时就地提醒用户处理这一行。 */
@keyframes cart-shake {
  0%, 100% { transform: translateX(0); }
  15% { transform: translateX(-8px); }
  30% { transform: translateX(7px); }
  45% { transform: translateX(-6px); }
  60% { transform: translateX(4px); }
  75% { transform: translateX(-2px); }
}
.cart-shake {
  animation: cart-shake 0.7s cubic-bezier(0.36, 0.07, 0.19, 0.97) both;
}
@media (prefers-reduced-motion: reduce) {
  .cart-shake { animation: none; }
  .checkout-page *, .checkout-page *::before, .checkout-page *::after { transition: none !important; }
}
.checkout-pay-choice { display: grid; gap: 8px; }
.checkout-pay-option { display: flex; align-items: center; gap: 9px; min-height: 44px; padding: 10px 12px; border: 1px solid var(--border-color); border-radius: 8px; text-align: left; font-size: 13px; color: var(--text-secondary); transition: background 150ms, border-color 150ms; }
.checkout-pay-option > svg { flex-shrink: 0; }
.checkout-pay-option:hover:not(:disabled) { background: var(--bg-secondary); border-color: var(--border-hover); }
.checkout-pay-option.is-selected { color: var(--text-primary); border-color: var(--text-primary); background: var(--bg-secondary); }
.checkout-pay-check { display: grid; place-items: center; width: 18px; height: 18px; margin-left: auto; flex-shrink: 0; border: 1px solid var(--border-hover); border-radius: 50%; }
.is-selected .checkout-pay-check { border-color: var(--text-primary); background: var(--text-primary); color: var(--bg-elevated); }
.checkout-pay-hint { font-size: 12px; line-height: 1.6; color: var(--text-secondary); }
.checkout-gateway { display: grid; gap: 8px; padding: 12px; border: 1px solid var(--border-color); border-radius: 10px; background: var(--bg-secondary); font-size: 12px; line-height: 1.6; }
.checkout-gateway p { overflow-wrap: anywhere; }
.checkout-gateway-meta { color: var(--text-secondary); }
.checkout-gateway-credited { color: var(--text-primary); font-weight: 550; }
.checkout-gateway-manual { margin: 0; padding: 8px; border-radius: 8px; background: var(--bg-elevated); white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; }
.checkout-gateway-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.checkout-gateway-actions .checkout-secondary { min-height: 40px; padding: 9px 14px; font-size: 12px; }
</style>
