<script setup lang="ts">
/**
 * 结算页（一机一卖购物车）
 *
 * 打开时重新拉商品目录，逐行比对：已下架、价格变动、库存不足都提前标出来；
 * 真正的裁决在付款事务里（整单全有或全无）。允许删行、改数量、改前缀，不允许改配置。
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ArrowLeft, ArrowRight, Cpu, HardDrive, KeyRound, Loader2, LockKeyhole, MemoryStick, Minus, Plus, ShoppingBag, Trash2 } from 'lucide-vue-next'
import api from '@/api'
import FlagIcon from '@/components/FlagIcon.vue'
import { useCartStore, type CartItem } from '@/stores/cart'
import { useConfigStore } from '@/stores/config'
import { useAuthStore } from '@/stores/auth'
import type { SshKey } from '@/types/api'
import type { PoolCheckoutResult } from '@/types/host-pool'
import TurnstileWidget from '@/components/TurnstileWidget.vue'
import { useThemeStore } from '@/stores/theme'
import { useToast } from '@/stores/toast'
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

defineOptions({ name: 'CheckoutView' })

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const { t } = useI18n()
const themeStore = useThemeStore()
const toast = useToast()
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
const showPasswords = ref(false)
const turnstileToken = ref('')
const turnstileRef = ref<InstanceType<typeof TurnstileWidget> | null>(null)
const turnstileRequired = computed(() => configStore.turnstileEnabled && !!configStore.turnstileSiteKey)
const acceptPrices = ref(false)
const maxInstances = ref(100)
let pollTimer: ReturnType<typeof setTimeout> | undefined
let disposed = false
async function pollOrder() {
  clearTimeout(pollTimer)
  if (!orderResult.value || disposed) return
  try {
    const result = await api.instances.getPoolOrder(orderResult.value.batchId)
    if (!disposed) { orderResult.value = result; error.value = '' }
  } catch { if (!disposed) error.value = t('cart.statusFailed') }
  if (!disposed && orderResult.value) {
    const pending = orderResult.value.instances.some(instance => instance.status === 'creating' || instance.refundPending || instance.publicIpUpdating)
    pollTimer = setTimeout(() => void pollOrder(), pending ? 4000 : 30000)
  }
}
async function acceptOrder(result: PoolCheckoutResult) {
  orderResult.value = result; cartStore.clear()
  await router.replace({ path: '/checkout', query: { order: result.batchId } })
  void authStore.fetchCurrentUser().catch(() => {})
  void pollOrder()
}
async function copyValue(value: string) {
  try { await navigator.clipboard.writeText(value); toast.success(t('hostInventory.sshCopied')) }
  catch { toast.error(t('hostInventory.sshCopyFailed')) }
}
onUnmounted(() => { disposed = true; clearTimeout(pollTimer) })

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
const canPay = computed(() => rows.value.length > 0 && (authMode.value === 'password' || sshKeyId.value !== null) && !paying.value && !loading.value)

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
  const response = await api.packages.getPublicCatalog()
  regions.value = response.regions || []
  maxInstances.value = response.maxInstances ?? 100
  serverAvailable.value = {}
}

onMounted(async () => {
  loading.value = true
  try {
    if (typeof route.query.order === 'string') {
      orderResult.value = await api.instances.getPoolOrder(route.query.order)
      void pollOrder()
      return
    }
    await Promise.all([configStore.loadPublicConfig(), api.sshKeys.list().then(result => { sshKeys.value = result.keys }), loadCatalog()])
    if (sshKeys.value.length > 0) sshKeyId.value = sshKeys.value[0].id
    else authMode.value = 'password'
  } catch (err) {
    error.value = translateError(err)
  } finally {
    loading.value = false
  }
})

function updateQuantity(row: CheckoutRow, value: number): void {
  const upper = Math.max(1, Math.min(row.available || 1, maxInstances.value))
  cartStore.setQuantity(row.item.key, Math.min(Math.max(1, Math.floor(value || 1)), upper))
}

watch(() => rows.value.map(row => row.live ? `${row.live.id}:${row.live.monthlyPrice}:${row.live.setupFee}` : '').join('|'), () => { acceptPrices.value = false })

let volatileIntent: { id: string; fingerprint: string } | null = null
function checkoutRequestId(payload: unknown): string {
  const key = `payincus.checkout.${authStore.user?.id}`
  const fingerprint = JSON.stringify(payload)
  if (volatileIntent?.fingerprint === fingerprint) return volatileIntent.id
  try {
    const previous = JSON.parse(sessionStorage.getItem(key) || 'null')
    if (previous?.fingerprint === fingerprint && typeof previous.id === 'string') { volatileIntent = previous; return previous.id }
    const id = crypto.randomUUID()
    volatileIntent = { id, fingerprint }
    sessionStorage.setItem(key, JSON.stringify(volatileIntent))
    return id
  } catch { volatileIntent = { id: crypto.randomUUID(), fingerprint }; return volatileIntent.id }
}

async function pay(): Promise<void> {
  if (!canPay.value) return

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
  const requestId = checkoutRequestId(payload)
  try {
    const result = await api.instances.poolOrder({ ...payload, requestId, turnstileToken: verificationToken || undefined })
    await acceptOrder(result)
  } catch (err: any) {
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
      const firstShort = rows.value.find(row => row.stockShort)
      if (firstShort) highlightRow(firstShort.item.key)
    } else if (code === 'POOL_PRICE_CHANGED') {
      await loadCatalog().catch(() => {})
      error.value = t('cart.priceChangedError')
      // 滚到第一行价格变动的商品并抖动，告诉用户是哪里变了。
      await nextTick()
      const changed = rows.value.find(row => row.priceChanged)
      if (changed) highlightRow(changed.item.key)
    } else {
      const accepted = await api.instances.getPoolOrder(requestId).catch(() => null)
      if (accepted) await acceptOrder(accepted)
      else error.value = translateError(err)
    }
  } finally {
    turnstileToken.value = ''; turnstileRef.value?.reset()
    paying.value = false
  }
}
</script>

<template>
  <div class="checkout-page animate-fade-in" :aria-busy="loading || paying">
    <header class="checkout-header">
      <div class="flex items-center gap-3 min-w-0">
        <span class="checkout-heading-icon"><ShoppingBag :size="22" :stroke-width="1.6" aria-hidden="true" /></span>
        <div class="min-w-0">
          <h1>{{ t(orderResult ? 'cart.accepted' : 'cart.title') }}</h1>
          <p v-if="!loading && !orderResult && rows.length" class="checkout-heading-meta">
            {{ t('cart.itemKinds', { count: rows.length }) }}<span aria-hidden="true">·</span>{{ t('cart.count', { count: totalQuantity }) }}
          </p>
        </div>
      </div>
      <router-link v-if="rows.length || orderResult" to="/purchase" class="checkout-back-link">
        <ArrowLeft :size="15" aria-hidden="true" />{{ t('cart.continueShopping') }}
      </router-link>
    </header>

    <div v-if="error && (orderResult || loading || !rows.length)" class="checkout-alert checkout-alert-error" role="alert">{{ error }}</div>
    <section v-if="orderResult" class="space-y-4" aria-live="polite">
      <div class="checkout-panel p-5"><p class="text-xs text-themed-muted">{{ t('cart.orderNumber') }}</p><p class="font-mono text-xs text-themed mt-2 break-all">{{ orderResult.batchId }}</p></div>
      <article v-for="instance in orderResult.instances" :key="instance.id" class="checkout-panel p-5 space-y-3">
        <div class="flex items-center justify-between gap-3"><RouterLink :to="`/instances/${instance.id}`" class="font-semibold text-themed break-all">{{ instance.name }}</RouterLink><span class="text-sm" :class="instance.status === 'error' ? 'text-red-600 dark:text-red-400' : instance.status === 'creating' ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400'">{{ instance.refunded ? t('cart.refunded') : instance.status === 'creating' ? t('cart.creating') : instance.status === 'error' ? t('cart.failed') : t('cart.ready') }}</span></div>
        <div v-if="instance.host && instance.sshPort" class="flex flex-wrap items-center gap-2"><code class="text-xs text-themed break-all">ssh -p {{ instance.sshPort }} root@{{ instance.host }}</code><button class="btn-secondary text-xs" @click="copyValue(`ssh -p ${instance.sshPort} root@${instance.host}`)">{{ t('hostInventory.sshCopy') }}</button></div>
        <p v-else class="text-xs text-themed-muted">{{ t(instance.publicIpUpdating ? 'hostIpSync.customerUpdating' : instance.status === 'creating' ? 'cart.connectionPending' : instance.refunded ? 'cart.refunded' : instance.refundPending ? 'cart.refundPending' : instance.status === 'error' ? 'cart.failed' : 'cart.connectionManual') }}</p>
        <div v-if="instance.rootPassword && instance.status !== 'error'" class="flex flex-wrap items-center gap-2"><label class="text-xs text-themed-muted">{{ t('publicSite.market.pool.credsPassword') }} <input :type="showPasswords ? 'text' : 'password'" :value="instance.rootPassword" readonly class="input font-mono text-xs" /></label><button class="btn-secondary text-xs" @click="showPasswords = !showPasswords">{{ t(showPasswords ? 'cart.hidePassword' : 'cart.showPassword') }}</button><button class="btn-secondary text-xs" @click="copyValue(instance.rootPassword)">{{ t('publicSite.market.pool.credsCopy') }}</button></div>
      </article>
      <div class="flex flex-wrap gap-3"><RouterLink to="/instances" class="checkout-primary">{{ t('publicSite.market.pool.credsViewInstances') }}</RouterLink><button class="checkout-secondary" @click="pollOrder">{{ t('common.refresh') }}</button></div>
    </section>
    <div v-else-if="loading" class="checkout-panel checkout-loading" role="status">
      <Loader2 :size="22" class="animate-spin motion-reduce:animate-none" aria-hidden="true" />{{ t('common.loading') }}
    </div>

    <div v-else-if="rows.length === 0" class="checkout-panel checkout-empty">
      <span class="checkout-empty-icon"><ShoppingBag :size="32" :stroke-width="1.4" aria-hidden="true" /></span>
      <h2>{{ t('cart.empty') }}</h2>
      <router-link to="/purchase" class="checkout-primary">
        {{ t('cart.goShopping') }}<ArrowRight :size="16" aria-hidden="true" />
      </router-link>
    </div>

    <fieldset v-else :disabled="paying" class="checkout-layout">
      <legend class="sr-only">{{ t('cart.title') }}</legend>
      <section class="checkout-items" aria-labelledby="checkout-items-title">
        <div class="checkout-section-heading">
          <h2 id="checkout-items-title">{{ t('cart.items') }}</h2>
          <span>{{ t('cart.count', { count: totalQuantity }) }}</span>
        </div>
        <article
          v-for="row in rows"
          :id="`cart-row-${row.item.key}`"
          :key="row.item.key"
          class="checkout-panel checkout-item"
          :class="[
            row.offSale || row.stockShort || row.nameError ? 'checkout-item-invalid' : '',
            shakingKey === row.item.key ? 'cart-shake' : ''
          ]"
        >
          <div class="checkout-item-heading">
            <div class="min-w-0">
              <h3 class="checkout-region">
                <FlagIcon v-if="row.region?.countryCode || row.item.snapshot.countryCode" :code="row.region?.countryCode || row.item.snapshot.countryCode!" size="sm" class="shrink-0" />
                <span>{{ row.region?.name || row.item.snapshot.regionName }}</span>
              </h3>
              <div class="checkout-item-subtitle">
                <span class="checkout-preset">{{ presetLabel(row.item.snapshot.resourcePreset) }}</span>
                <span>{{ row.item.snapshot.imageLabel }}</span>
              </div>
            </div>
            <button type="button" class="checkout-remove" :aria-label="`${t('cart.line.remove')} ${row.region?.name || row.item.snapshot.regionName}`" :title="t('cart.line.remove')" @click="cartStore.remove(row.item.key)">
              <Trash2 :size="17" :stroke-width="1.7" aria-hidden="true" />
            </button>
          </div>

          <dl class="checkout-specs">
            <div><dt><Cpu :size="14" aria-hidden="true" />{{ t('cart.specs.cpu') }}</dt><dd>{{ t('cart.specs.cores', { count: row.item.snapshot.cpu / 100 }) }}</dd></div>
            <div><dt><MemoryStick :size="14" aria-hidden="true" />{{ t('cart.specs.memory') }}</dt><dd>{{ formatMemoryMiB(row.item.snapshot.memoryMiB) }}</dd></div>
            <div><dt><HardDrive :size="14" aria-hidden="true" />{{ t('cart.specs.disk') }}</dt><dd>{{ row.item.snapshot.diskGiB }} GiB</dd></div>
          </dl>

          <div class="checkout-item-fields">
            <label class="checkout-field">
              {{ row.item.quantity > 1 ? t('cart.line.namePrefix') : t('cart.line.name') }}
              <input
                :value="row.item.namePrefix"
                type="text" maxlength="60"
                class="input checkout-input"
                :aria-invalid="!!row.nameError"
                :aria-describedby="row.nameError ? `cart-name-error-${row.item.key}` : undefined"
                @input="cartStore.setNamePrefix(row.item.key, ($event.target as HTMLInputElement).value)"
              />
              <span v-if="row.item.quantity > 1 && !row.nameError" class="checkout-name-preview">{{ row.names.slice(0, 3).join(', ') }}{{ row.names.length > 3 ? ' …' : '' }}</span>
            </label>
            <div class="checkout-field">
              <label :for="`cart-quantity-${row.item.key}`">{{ t('cart.line.quantity') }}</label>
              <div class="checkout-quantity">
                <button type="button" :aria-label="t('cart.line.decrease')" :disabled="row.offSale || row.item.quantity <= 1" @click="updateQuantity(row, row.item.quantity - 1)"><Minus :size="15" aria-hidden="true" /></button>
                <input
                  :id="`cart-quantity-${row.item.key}`"
                  :value="row.item.quantity"
                  type="number" min="1" :max="Math.max(1, Math.min(row.available || 1, maxInstances))" step="1"
                  :disabled="row.offSale"
                  @change="updateQuantity(row, Number(($event.target as HTMLInputElement).value))"
                />
                <button type="button" :aria-label="t('cart.line.increase')" :disabled="row.offSale || row.item.quantity >= Math.max(1, Math.min(row.available || 1, maxInstances))" @click="updateQuantity(row, row.item.quantity + 1)"><Plus :size="15" aria-hidden="true" /></button>
              </div>
            </div>
          </div>

          <div class="checkout-item-pricing">
            <div class="checkout-unit-prices">
              <p>{{ t('cart.line.monthly') }}<span>{{ row.live ? `¥${formatPublicPrice(row.live.monthlyPrice)}` : '—' }}</span></p>
              <p v-if="row.live && row.live.setupFee > 0">{{ t('cart.line.setup') }}<span>¥{{ formatPublicPrice(row.live.setupFee) }}</span></p>
            </div>
            <div class="checkout-item-subtotal">
              <span>{{ t('cart.line.subtotal') }}</span>
              <strong>{{ row.live ? `¥${formatPublicPrice(row.subtotalCents)}` : '—' }}</strong>
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

      <aside class="checkout-panel checkout-summary" aria-labelledby="checkout-summary-title">
        <div class="checkout-summary-section">
          <h2 id="checkout-summary-title">{{ t('cart.summary') }}</h2>
          <dl class="checkout-totals">
            <div><dt>{{ t('cart.line.quantity') }}</dt><dd>{{ t('cart.count', { count: totalQuantity }) }}</dd></div>
            <div><dt>{{ t('cart.monthlyTotal') }}</dt><dd>¥{{ formatPublicPrice(monthlyTotalCents) }}</dd></div>
            <div v-if="setupTotalCents > 0"><dt>{{ t('cart.setupTotal') }}</dt><dd>¥{{ formatPublicPrice(setupTotalCents) }}</dd></div>
            <div><dt>{{ t('cart.paymentMethod') }}</dt><dd>{{ t('cart.balance') }}</dd></div>
          </dl>
          <div class="checkout-grand-total">
            <span>{{ t('cart.firstPayment') }}</span>
            <strong><span class="checkout-currency">¥</span>{{ formatPublicPrice(totalCents) }}</strong>
          </div>
        </div>

        <div class="checkout-summary-section checkout-login">
          <h3 id="checkout-auth-title">{{ t('cart.loginMethod') }}</h3>
          <div class="checkout-auth-options" role="group" aria-labelledby="checkout-auth-title">
              <button
                type="button"
                class="checkout-auth-option"
                :class="{ 'is-selected': authMode === 'key' }"
                :aria-pressed="authMode === 'key'"
                @click="authMode = 'key'"
              >
                <KeyRound :size="16" aria-hidden="true" />{{ t('publicSite.market.pool.authKey') }}
              </button>
              <button
                type="button"
                class="checkout-auth-option"
                :class="{ 'is-selected': authMode === 'password' }"
                :aria-pressed="authMode === 'password'"
                @click="authMode = 'password'"
              >
                <LockKeyhole :size="16" aria-hidden="true" />{{ t('cart.passwordLogin') }}
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
        </div>

        <div class="checkout-summary-section checkout-payment">
          <p v-if="tooMany" class="text-xs text-red-600 dark:text-red-400">{{ t('cart.tooMany', { max: maxInstances }) }}</p>
          <div v-if="error" class="checkout-alert checkout-alert-error" role="alert">{{ error }}</div>
          <label v-if="rows.some(row => row.priceChanged)" class="checkout-price-consent"><input v-model="acceptPrices" type="checkbox" />{{ t('cart.acceptPrices') }}</label>
          <div v-if="turnstileRequired" class="checkout-verification">
            <TurnstileWidget ref="turnstileRef" v-model="turnstileToken" :site-key="configStore.turnstileSiteKey!" :theme="themeStore.isDark ? 'dark' : 'light'" size="compact" action="pool-checkout" />
          </div>
          <button type="button" class="checkout-primary checkout-pay" :disabled="!canPay" @click="pay">
            <Loader2 v-if="paying" :size="17" class="animate-spin motion-reduce:animate-none" aria-hidden="true" />
            {{ paying ? t('cart.paying') : t('cart.pay') }}
          </button>
        </div>
      </aside>
    </fieldset>
  </div>
</template>

<style scoped>
.checkout-page { display: grid; gap: 24px; color: var(--text-primary); }
.checkout-header { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 4px 0 8px; }
.checkout-header h1 { font-size: 24px; font-weight: 650; letter-spacing: -0.035em; line-height: 1.3; }
.checkout-heading-icon { display: grid; place-items: center; width: 46px; height: 46px; border: 1px solid var(--border-color); border-radius: 14px; background: var(--bg-secondary); flex-shrink: 0; }
.checkout-heading-meta { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 5px; color: var(--text-secondary); font-size: 12px; }
.checkout-back-link { display: inline-flex; align-items: center; gap: 7px; color: var(--text-secondary); font-size: 13px; flex-shrink: 0; }
.checkout-back-link:hover { color: var(--text-primary); }
.checkout-panel { min-width: 0; border: 1px solid var(--border-color); border-radius: 18px; background: var(--bg-secondary); box-shadow: 0 2px 6px rgb(0 0 0 / 0.025); }
.checkout-layout { min-width: 0; display: grid; gap: 24px; align-items: start; }
.checkout-items { min-width: 0; display: grid; gap: 14px; }
.checkout-section-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 2px 2px; }
.checkout-section-heading h2, .checkout-summary h2 { font-size: 15px; font-weight: 600; }
.checkout-section-heading > span { font-size: 12px; color: var(--text-tertiary); }
.checkout-item { padding: 22px; scroll-margin: 24px; }
.checkout-item-invalid { border-color: rgb(239 68 68 / 0.5); }
.checkout-item-heading { display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; }
.checkout-region { display: flex; align-items: center; gap: 9px; font-size: 15px; font-weight: 600; line-height: 1.5; }
.checkout-region > span:last-child { min-width: 0; overflow-wrap: anywhere; }
.checkout-item-subtitle { display: flex; flex-wrap: wrap; align-items: center; gap: 9px; margin-top: 7px; font-size: 12px; color: var(--text-secondary); }
.checkout-preset { padding: 2px 7px; border-radius: 5px; background: var(--bg-tertiary); font-size: 10px; font-weight: 600; letter-spacing: 0.025em; }
.checkout-remove { display: grid; place-items: center; flex-shrink: 0; width: 34px; height: 34px; border-radius: 9px; color: var(--text-tertiary); transition: color 150ms, background 150ms; }
.checkout-remove:hover:not(:disabled) { color: #dc2626; background: rgb(239 68 68 / 0.07); }
.checkout-specs { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 20px 0; padding: 15px 0; border-top: 1px solid var(--border-color); border-bottom: 1px solid var(--border-color); }
.checkout-specs > div { min-width: 0; }
.checkout-specs dt { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--text-tertiary); }
.checkout-specs dd { margin-top: 6px; font-size: 14px; font-weight: 550; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.checkout-item-fields { display: grid; grid-template-columns: minmax(0, 1fr) 130px; gap: 20px; }
.checkout-field { display: flex; flex-direction: column; gap: 7px; min-width: 0; font-size: 12px; color: var(--text-secondary); }
.checkout-page .checkout-input { width: 100%; min-width: 0; min-height: 42px; margin: 0; padding: 10px 12px; border: 1px solid var(--border-color); border-radius: 9px; background: var(--bg-secondary); color: var(--text-primary); box-shadow: none; font-size: 13px; }
.checkout-page .checkout-input:focus { border-color: var(--text-secondary); outline: 2px solid var(--border-hover); outline-offset: 2px; box-shadow: none; }
.checkout-page .checkout-input[aria-invalid="true"] { border-color: rgb(239 68 68 / 0.65); }
.checkout-name-preview { font-size: 11px; color: var(--text-tertiary); overflow-wrap: anywhere; line-height: 1.5; }
.checkout-quantity { display: grid; grid-template-columns: 36px minmax(0, 1fr) 36px; height: 42px; border: 1px solid var(--border-color); border-radius: 9px; overflow: hidden; color: var(--text-primary); }
.checkout-quantity button { display: grid; place-items: center; transition: background 150ms; }
.checkout-quantity button:hover:not(:disabled) { background: var(--bg-tertiary); }
.checkout-quantity input { width: 100%; min-width: 0; border: 0; padding: 0; background: transparent; text-align: center; color: var(--text-primary); font-size: 13px; font-variant-numeric: tabular-nums; appearance: textfield; box-shadow: none; }
.checkout-quantity input::-webkit-inner-spin-button, .checkout-quantity input::-webkit-outer-spin-button { appearance: none; margin: 0; }
.checkout-quantity input:focus { outline: none; box-shadow: inset 0 0 0 1px var(--text-secondary); }
.checkout-item-pricing { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: end; gap: 12px; margin-top: 22px; }
.checkout-unit-prices { display: grid; gap: 5px; font-size: 11px; color: var(--text-tertiary); }
.checkout-unit-prices p { display: flex; gap: 10px; align-items: baseline; }
.checkout-unit-prices span { color: var(--text-secondary); font-variant-numeric: tabular-nums; }
.checkout-item-subtotal { display: grid; gap: 3px; text-align: right; }
.checkout-item-subtotal > span { font-size: 11px; color: var(--text-tertiary); }
.checkout-item-subtotal > strong { font-size: 20px; font-weight: 600; letter-spacing: -0.03em; font-variant-numeric: tabular-nums; }
.checkout-row-messages { display: grid; gap: 5px; margin-top: 16px; padding-top: 13px; border-top: 1px solid var(--border-color); font-size: 12px; line-height: 1.6; }
.checkout-summary { overflow: hidden; }
.checkout-summary-section { padding: 22px; }
.checkout-summary-section + .checkout-summary-section { border-top: 1px solid var(--border-color); }
.checkout-totals { display: grid; gap: 13px; margin-top: 22px; font-size: 12px; }
.checkout-totals > div { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; }
.checkout-totals dt { color: var(--text-secondary); }
.checkout-totals dd { text-align: right; font-variant-numeric: tabular-nums; }
.checkout-grand-total { display: grid; gap: 7px; margin-top: 22px; padding-top: 19px; border-top: 1px solid var(--border-color); }
.checkout-grand-total > span { font-size: 12px; color: var(--text-secondary); }
.checkout-grand-total strong { font-size: 36px; line-height: 1.2; font-weight: 650; letter-spacing: -0.045em; font-variant-numeric: tabular-nums; }
.checkout-currency { margin-right: 4px; font-size: 23px; font-weight: 500; }
.checkout-login { display: grid; gap: 14px; }
.checkout-login h3 { font-size: 13px; font-weight: 600; }
.checkout-auth-options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.checkout-auth-option { display: flex; align-items: center; justify-content: center; gap: 7px; min-height: 43px; padding: 8px; border: 1px solid var(--border-color); border-radius: 9px; font-size: 12px; color: var(--text-secondary); transition: background 150ms, border-color 150ms; }
.checkout-auth-option > svg { flex-shrink: 0; }
.checkout-auth-option.is-selected { color: var(--text-primary); border-color: var(--text-primary); background: var(--bg-tertiary); box-shadow: inset 0 0 0 1px var(--text-primary); }
.checkout-password-hint { color: var(--text-tertiary); font-size: 11px; line-height: 1.6; }
.checkout-payment { display: grid; gap: 14px; }
.checkout-primary, .checkout-secondary { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; padding: 11px 18px; border: 1px solid var(--text-primary); border-radius: 10px; font-size: 13px; font-weight: 550; line-height: 1.5; transition: opacity 150ms, background 150ms; }
.checkout-primary { background: var(--text-primary); color: var(--bg-secondary); }
.checkout-primary:hover:not(:disabled) { opacity: 0.85; }
.checkout-secondary { background: var(--bg-secondary); border-color: var(--border-color); color: var(--text-primary); }
.checkout-pay { width: 100%; min-height: 46px; }
.checkout-page button:disabled { cursor: not-allowed; opacity: 0.45; }
.checkout-page button:focus-visible, .checkout-back-link:focus-visible, .checkout-primary:focus-visible { outline: 2px solid var(--text-secondary); outline-offset: 3px; }
.checkout-quantity button:focus-visible { outline-offset: -3px; }
.checkout-price-consent { display: flex; align-items: flex-start; gap: 9px; font-size: 12px; line-height: 1.6; }
.checkout-price-consent input { margin-top: 2px; flex-shrink: 0; color: var(--text-primary); border-color: var(--border-hover); border-radius: 4px; }
.checkout-verification { min-width: 0; max-width: 100%; }
.checkout-alert { padding: 12px 14px; border: 1px solid rgb(239 68 68 / 0.25); border-radius: 10px; font-size: 12px; line-height: 1.65; }
.checkout-alert-error { color: #dc2626; background: rgb(239 68 68 / 0.045); }
:global(.dark) .checkout-alert-error { color: #f87171; }
.checkout-loading { display: flex; align-items: center; justify-content: center; gap: 10px; min-height: 240px; color: var(--text-secondary); font-size: 13px; }
.checkout-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 24px; min-height: 350px; padding: 40px 24px; text-align: center; }
.checkout-empty h2 { font-size: 17px; font-weight: 550; letter-spacing: -0.025em; }
.checkout-empty-icon { display: grid; place-items: center; width: 72px; height: 72px; border: 1px solid var(--border-color); border-radius: 22px; background: var(--bg-tertiary); color: var(--text-secondary); }
@media (min-width: 1100px) {
  .checkout-layout { grid-template-columns: minmax(0, 1fr) 320px; }
  .checkout-summary { position: sticky; top: 24px; }
}
@media (max-width: 540px) {
  .checkout-page { gap: 20px; }
  .checkout-header { align-items: flex-start; gap: 12px; }
  .checkout-header h1 { font-size: 21px; }
  .checkout-heading-icon { display: none; }
  .checkout-back-link { margin-top: 6px; font-size: 12px; }
  .checkout-layout { gap: 20px; }
  .checkout-item, .checkout-summary-section { padding: 18px; }
  .checkout-region { font-size: 14px; }
  .checkout-item-fields { grid-template-columns: minmax(0, 1fr) 112px; gap: 12px; }
  .checkout-quantity { grid-template-columns: 32px minmax(0, 1fr) 32px; }
  .checkout-specs { gap: 8px; }
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
</style>
