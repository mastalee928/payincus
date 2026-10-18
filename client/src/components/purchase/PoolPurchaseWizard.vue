<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ArrowRight, Check, Cpu, Globe2, HardDrive, Loader2, MemoryStick, Minus, Plus, Search, Server, ShoppingBag } from 'lucide-vue-next'
import api from '@/api'
import FlagIcon from '@/components/FlagIcon.vue'
import ImageSelector from '@/components/instance/ImageSelector.vue'
import SelectionTabs from '@/components/ui/SelectionTabs.vue'
import CartAddedNotice from '@/components/purchase/CartAddedNotice.vue'
import { useAuthStore } from '@/stores/auth'
import { useCartStore } from '@/stores/cart'
import { useToast } from '@/stores/toast'
import { translateError } from '@/utils/errorHandler'
import { validateName } from '@/utils/validation'
import { continentOf, groupByContinent, type ContinentCode } from '@/utils/countryContinent'
import { buildPoolPurchaseRegions, poolPurchaseRegionStock, type PoolPurchaseRegion } from '@/utils/poolRegionCatalog'
import { architectureOfPreset, buildPoolInstanceNames, formatMemoryMiB, formatPublicPrice, presetLabel, type PoolCatalogRegion } from '@/utils/poolCatalog'

const { t } = useI18n()
const route = useRoute(), router = useRouter(), auth = useAuthStore(), cart = useCartStore(), toast = useToast()
const regions = ref<PoolCatalogRegion[]>([])
const regionId = ref<number | null>(null), productId = ref<number | null>(null)
const image = ref(''), name = ref(''), quantity = ref(1), maxInstances = ref(100)
const loading = ref(true), error = ref(''), imagesLoading = ref(false)
const images = ref<Array<{ value: string; label: string; icon: string | null }>>([])
const region = computed(() => regions.value.find(value => value.id === regionId.value))
const product = computed(() => region.value?.products.find(value => value.id === productId.value))
const queuedQuantity = computed(() => cart.items.filter(item => item.poolPriceId === productId.value).reduce((sum, item) => sum + item.quantity, 0))
const maxQuantity = computed(() => Math.max(0, Math.min((product.value?.idle ?? 0) - queuedQuantity.value, maxInstances.value - cart.totalQuantity)))
const names = computed(() => buildPoolInstanceNames(name.value.trim(), Math.min(quantity.value || 1, maxInstances.value)))
const nameValid = computed(() => !!name.value.trim() && names.value.every(value => validateName(value).valid))
const subtotal = computed(() => product.value ? quantity.value * (product.value.monthlyPrice + product.value.setupFee) : 0)
const canAdd = computed(() => !!product.value && !!image.value && nameValid.value && Number.isInteger(quantity.value) && quantity.value > 0 && quantity.value <= maxQuantity.value && !imagesLoading.value)
const regionStock = (value: PoolCatalogRegion) => value.products.reduce((sum, item) => sum + item.idle, 0)

const continentFilter = ref<ContinentCode | 'all' | null>(null)
const regionSearch = ref('')
const purchaseRegions = computed(() => buildPoolPurchaseRegions(regions.value))
const selectedPurchaseRegion = computed(() => purchaseRegions.value.find(value => value.regions.some(group => group.id === regionId.value)))
const configurations = computed(() => selectedPurchaseRegion.value?.regions.flatMap(group => group.products.map(value => ({ ...value, regionId: group.id }))) ?? [])
const continents = computed(() => groupByContinent(purchaseRegions.value))
const continentOptions = computed(() => [
  { value: 'all', label: t('poolPurchase.allRegions') },
  ...continents.value.map(group => ({ value: group.code, label: t('poolPurchase.continents.' + group.code) }))
])
const currentContinent = computed(() => continentFilter.value ?? continentOf((selectedPurchaseRegion.value
  ?? purchaseRegions.value.find(value => value.regions.length)
  ?? purchaseRegions.value[0])?.countryCode))
const visibleRegions = computed(() => {
  const query = regionSearch.value.trim().toLocaleLowerCase()
  return purchaseRegions.value.filter(value => (!query && currentContinent.value !== 'all'
    ? continentOf(value.countryCode) === currentContinent.value
    : true) && (!query || value.name.toLocaleLowerCase().includes(query)))
})
const hasStock = computed(() => regions.value.some(value => regionStock(value) > 0))
const selectedImageLabel = computed(() => images.value.find(value => value.value === image.value)?.label ?? '')

function selectPurchaseRegion(value: PoolPurchaseRegion) {
  const available = value.regions.find(group => regionStock(group) > 0)
  if (available) selectRegion(available.id)
}

function selectContinent(value: string) {
  continentFilter.value = value as ContinentCode | 'all'
  regionSearch.value = ''
}

async function load() {
  loading.value = true; error.value = ''
  try {
    const catalog = await api.packages.getPublicCatalog()
    regions.value = catalog.regions; maxInstances.value = catalog.maxInstances ?? 100
    regionId.value = regions.value.find(value => value.id === Number(route.query.region))?.id ?? regions.value.find(value => regionStock(value) > 0)?.id ?? null
    productId.value = region.value?.products.find(value => value.id === Number(route.query.product))?.id ?? region.value?.products.find(value => value.idle > 0)?.id ?? null
  } catch (err) { error.value = translateError(err) }
  finally { loading.value = false }
}
function selectRegion(id: number) {
  regionId.value = id; productId.value = region.value?.products.find(value => value.idle > 0)?.id ?? null
}
let imageSequence = 0
async function loadImages() {
  const current = ++imageSequence
  image.value = ''; images.value = []
  if (!product.value || !auth.isAuthenticated) { imagesLoading.value = false; return }
  const chosen = product.value
  imagesLoading.value = true
  try {
    const response = await api.images.getSystemImages('container', chosen.memoryMiB)
    if (current !== imageSequence) return
    images.value = response.images.filter(value => value.architecture === architectureOfPreset(chosen.resourcePreset))
      .map(value => ({ value: value.remoteAlias, label: value.name, icon: value.icon ?? null }))
    image.value = images.value[0]?.value ?? ''
  } catch (err) { if (current === imageSequence) error.value = translateError(err) }
  finally { if (current === imageSequence) imagesLoading.value = false }
}
watch([product, () => auth.isAuthenticated], () => { quantity.value = 1; void loadImages() })
function login() {
  void router.push({ path: '/login', query: { redirect: `/purchase?region=${regionId.value ?? ''}&product=${productId.value ?? ''}` } })
}
function add(checkout = false) {
  if (!canAdd.value || !product.value || !region.value) return
  const chosen = product.value
  cart.add({ poolPriceId: chosen.id, quantity: quantity.value, namePrefix: name.value.trim(), image: image.value, customInitCommandIds: [],
    snapshot: { regionId: region.value.id, regionName: region.value.name, countryCode: region.value.countryCode,
      resourcePreset: chosen.resourcePreset, diskGiB: chosen.diskGiB, cpu: chosen.cpu, memoryMiB: chosen.memoryMiB,
      monthlyPrice: chosen.monthlyPrice, setupFee: chosen.setupFee, imageLabel: images.value.find(value => value.value === image.value)?.label ?? image.value }
  })
  toast.success(t('poolPurchase.added')); name.value = ''
  if (checkout) void router.push('/checkout')
}
onMounted(load)
</script>

<template>
  <div class="purchase-page" :class="{ 'purchase-public': !auth.isAuthenticated }" :aria-busy="loading">
    <header class="purchase-header">
      <div class="purchase-heading">
        <span class="purchase-heading-icon"><Server :size="22" :stroke-width="1.6" aria-hidden="true" /></span>
        <h1>{{ t('poolPurchase.title') }}</h1>
      </div>
      <RouterLink to="/checkout" class="purchase-cart-link">
        <ShoppingBag :size="17" aria-hidden="true" />{{ t('cart.title') }}<span class="purchase-cart-count"><Transition name="purchase-number" mode="out-in"><span :key="cart.totalQuantity">{{ cart.totalQuantity }}</span></Transition></span>
      </RouterLink>
    </header>

    <div v-if="error" class="purchase-alert" role="alert">
      <span>{{ error }}</span><button type="button" @click="load">{{ t('common.retry') }}</button>
    </div>
    <div v-if="loading" class="purchase-panel purchase-empty" role="status"><Loader2 :size="24" class="animate-spin motion-reduce:animate-none" aria-hidden="true" />{{ t('common.loading') }}</div>
    <div v-else-if="!error || regions.length" class="purchase-layout">
      <div class="purchase-steps">
        <section class="purchase-panel purchase-section" aria-labelledby="purchase-region-title">
          <div class="purchase-section-heading">
            <span class="purchase-step" aria-hidden="true">01</span><h2 id="purchase-region-title">{{ t('poolPurchase.chooseRegion') }}</h2>
          </div>
          <SelectionTabs
            v-if="continents.length > 1" class="purchase-continents"
            :model-value="regionSearch.trim() ? 'all' : currentContinent"
            :options="continentOptions" :label="t('poolPurchase.continentFilter')"
            @update:model-value="selectContinent"
          />
          <label v-if="purchaseRegions.length > 6" class="purchase-region-search">
            <Search :size="16" aria-hidden="true" /><span class="sr-only">{{ t('poolPurchase.searchRegions') }}</span>
            <input v-model="regionSearch" type="search" :placeholder="t('poolPurchase.searchRegions')" />
          </label>
          <TransitionGroup v-if="visibleRegions.length" name="purchase-options" tag="div" class="purchase-region-grid">
            <button v-for="value in visibleRegions" :key="value.key" type="button" class="purchase-region-option" :class="{ 'is-selected': value.key === selectedPurchaseRegion?.key }" :aria-pressed="value.key === selectedPurchaseRegion?.key" :disabled="poolPurchaseRegionStock(value) === 0" @click="selectPurchaseRegion(value)">
              <span class="purchase-region-top"><FlagIcon v-if="value.countryCode" :code="value.countryCode" size="sm" /><Globe2 v-else :size="19" aria-hidden="true" /><span class="purchase-choice-indicator"><Check v-if="value.key === selectedPurchaseRegion?.key" :size="12" :stroke-width="2.5" aria-hidden="true" /></span></span>
              <span class="purchase-region-name">{{ value.name }}</span>
            </button>
          </TransitionGroup>
          <p v-else class="purchase-filter-empty">{{ t('poolPurchase.noMatchingRegions') }}</p>
        </section>

        <section v-if="region" class="purchase-panel purchase-section" aria-labelledby="purchase-config-title">
          <div class="purchase-section-heading">
            <span class="purchase-step" aria-hidden="true">02</span><h2 id="purchase-config-title">{{ t('poolPurchase.chooseConfiguration') }}</h2>
          </div>
          <TransitionGroup name="purchase-options" tag="div" class="purchase-config-grid">
            <button v-for="value in configurations" :key="value.id" type="button" class="purchase-config-option" :class="{ 'is-selected': value.id === productId }" :aria-pressed="value.id === productId" :disabled="value.idle === 0" @click="regionId = value.regionId; productId = value.id">
              <span class="purchase-config-top"><span class="purchase-preset">{{ presetLabel(value.resourcePreset) }}</span><span class="purchase-choice-indicator"><Check v-if="value.id === productId" :size="12" :stroke-width="2.5" aria-hidden="true" /></span></span>
              <span class="purchase-config-specs">
                <span><Cpu :size="14" aria-hidden="true" /><span>{{ t('cart.specs.cores', { count: value.cpu / 100 }) }}</span></span>
                <span><MemoryStick :size="14" aria-hidden="true" /><span>{{ formatMemoryMiB(value.memoryMiB) }}</span></span>
                <span><HardDrive :size="14" aria-hidden="true" /><span>{{ value.diskGiB }} GiB</span></span>
              </span>
              <span class="purchase-config-price"><span><strong><span>¥</span>{{ formatPublicPrice(value.monthlyPrice) }}</strong><span class="purchase-price-period"> / {{ t('poolPurchase.month') }}</span></span><span class="purchase-stock" :class="{ 'is-available': value.idle > 0 }"><span aria-hidden="true"></span>{{ value.idle ? t('poolPurchase.stock', { count: value.idle }) : t('poolPurchase.soldOut') }}</span></span>
              <span v-if="value.setupFee > 0" class="purchase-setup-fee">{{ t('poolPurchase.setupFee') }} ¥{{ formatPublicPrice(value.setupFee) }}</span>
            </button>
          </TransitionGroup>
        </section>

        <section v-if="product" class="purchase-panel purchase-section" aria-labelledby="purchase-system-title">
          <div class="purchase-section-heading">
            <span class="purchase-step" aria-hidden="true">03</span><h2 id="purchase-system-title">{{ t('poolPurchase.instance') }}</h2>
          </div>
          <div v-if="!auth.isAuthenticated" class="purchase-sign-in"><p>{{ t('poolPurchase.signInHint') }}</p><button type="button" class="purchase-primary" @click="login">{{ t('poolPurchase.login') }}<ArrowRight :size="16" aria-hidden="true" /></button></div>
          <div v-else class="purchase-instance-fields">
            <div class="purchase-field">
              <span>{{ t('poolPurchase.system') }}</span>
              <div v-if="imagesLoading" class="purchase-images-loading" role="status"><Loader2 :size="17" class="animate-spin motion-reduce:animate-none" aria-hidden="true" />{{ t('common.loading') }}</div>
              <ImageSelector v-else-if="images.length" v-model:selected-image="image" :available-images="images" :images-loading="imagesLoading" :title="t('poolPurchase.system')" embedded />
              <p v-else class="purchase-field-notice text-amber-600 dark:text-amber-400">{{ t('poolPurchase.noImages') }}</p>
            </div>
            <div class="purchase-name-quantity">
              <label class="purchase-field">
                {{ t(quantity > 1 ? 'poolPurchase.namePrefix' : 'cart.line.name') }}
                <input v-model="name" class="input purchase-input" maxlength="60" placeholder="my-server" :aria-invalid="!!name && !nameValid" :aria-describedby="name && !nameValid ? 'purchase-name-error' : undefined" />
              </label>
              <div class="purchase-field">
                <label for="purchase-quantity">{{ t('poolPurchase.quantity') }}</label>
                <div class="purchase-quantity">
                  <button type="button" :aria-label="t('cart.line.decrease')" :disabled="quantity <= 1" @click="quantity = Math.max(1, (quantity || 1) - 1)"><Minus :size="15" aria-hidden="true" /></button>
                  <input id="purchase-quantity" v-model.number="quantity" type="number" min="1" :max="maxQuantity" step="1" />
                  <button type="button" :aria-label="t('cart.line.increase')" :disabled="quantity >= maxQuantity" @click="quantity = Math.min(maxQuantity, (quantity || 0) + 1)"><Plus :size="15" aria-hidden="true" /></button>
                </div>
              </div>
            </div>
            <p v-if="name && !nameValid" id="purchase-name-error" class="purchase-field-notice text-red-600 dark:text-red-400">{{ t('cart.nameInvalid') }}</p>
            <p v-else-if="name && quantity > 1" class="purchase-name-preview">{{ names.slice(0, 3).join(', ') }}{{ names.length > 3 ? ' …' : '' }}</p>
            <p v-if="queuedQuantity" class="purchase-queued"><ShoppingBag :size="14" aria-hidden="true" />{{ t('poolPurchase.inCart', { count: queuedQuantity }) }}</p>
          </div>
        </section>
      </div>

      <aside class="purchase-panel purchase-summary" aria-labelledby="purchase-summary-title">
        <div class="purchase-summary-section">
          <h2 id="purchase-summary-title">{{ t('poolPurchase.summary') }}</h2>
          <template v-if="product">
            <div class="purchase-selected-region"><FlagIcon v-if="region?.countryCode" :code="region.countryCode" size="sm" class="shrink-0" /><span>{{ selectedPurchaseRegion?.name }}</span></div>
            <span class="purchase-selected-preset">{{ presetLabel(product.resourcePreset) }}</span>
            <dl class="purchase-summary-specs">
              <div><dt>{{ t('cart.specs.cpu') }}</dt><dd>{{ t('cart.specs.cores', { count: product.cpu / 100 }) }}</dd></div>
              <div><dt>{{ t('cart.specs.memory') }}</dt><dd>{{ formatMemoryMiB(product.memoryMiB) }}</dd></div>
              <div><dt>{{ t('cart.specs.disk') }}</dt><dd>{{ product.diskGiB }} GiB</dd></div>
              <div v-if="selectedImageLabel"><dt>{{ t('poolPurchase.system') }}</dt><dd>{{ selectedImageLabel }}</dd></div>
              <div><dt>{{ t('poolPurchase.quantity') }}</dt><dd>{{ t('cart.count', { count: quantity }) }}</dd></div>
            </dl>
          </template>
          <div v-else class="purchase-summary-empty"><Globe2 :size="30" :stroke-width="1.3" aria-hidden="true" /><p>{{ t(hasStock ? 'poolPurchase.selectToStart' : regions.length ? 'poolPurchase.allSoldOut' : 'poolPurchase.empty') }}</p></div>
        </div>
        <template v-if="product">
          <div class="purchase-summary-section">
            <dl class="purchase-fees"><div><dt>{{ t('poolPurchase.monthly') }}</dt><dd>¥{{ formatPublicPrice(product.monthlyPrice * quantity) }}</dd></div><div v-if="product.setupFee > 0"><dt>{{ t('poolPurchase.setup') }}</dt><dd>¥{{ formatPublicPrice(product.setupFee * quantity) }}</dd></div></dl>
            <div class="purchase-grand-total"><span>{{ t('poolPurchase.firstPayment') }}</span><Transition name="purchase-number" mode="out-in"><strong :key="subtotal"><span>¥</span>{{ formatPublicPrice(subtotal) }}</strong></Transition></div>
          </div>
          <div class="purchase-summary-section purchase-actions">
            <button v-if="!auth.isAuthenticated" type="button" class="purchase-primary" @click="login">{{ t('poolPurchase.login') }}<ArrowRight :size="16" aria-hidden="true" /></button>
            <template v-else>
              <CartAddedNotice :total="cart.totalQuantity" :selection="productId" />
              <button type="button" class="purchase-primary" :disabled="!canAdd" @click="add()"><ShoppingBag :size="16" aria-hidden="true" />{{ t('poolPurchase.add') }}</button>
              <button type="button" class="purchase-secondary" :disabled="!canAdd" @click="add(true)">{{ t('poolPurchase.checkout') }}<ArrowRight :size="15" aria-hidden="true" /></button>
              <p v-if="!name.trim()" class="purchase-action-hint">{{ t('poolPurchase.nameRequired') }}</p>
            </template>
          </div>
        </template>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.purchase-page { display: grid; gap: 24px; color: var(--text-primary); }
.purchase-public { width: 100%; max-width: 1280px; margin: 0 auto; padding: 32px 24px; }
.purchase-header, .purchase-heading { display: flex; align-items: center; gap: 13px; }
.purchase-header { justify-content: space-between; gap: 20px; padding: 4px 0 8px; }
.purchase-header h1 { font-size: 24px; font-weight: 650; letter-spacing: -0.035em; line-height: 1.3; }
.purchase-heading-icon { display: grid; place-items: center; width: 46px; height: 46px; border: 1px solid var(--border-color); border-radius: 14px; background: var(--bg-elevated); flex-shrink: 0; }
.purchase-cart-link { display: flex; align-items: center; gap: 8px; padding: 9px 12px; border: 1px solid var(--border-color); border-radius: 10px; background: var(--bg-elevated); font-size: 12px; white-space: nowrap; }
.purchase-cart-link:hover { border-color: var(--text-secondary); }
.purchase-cart-count { display: grid; place-items: center; min-width: 23px; height: 23px; padding: 0 5px; border-radius: 6px; background: var(--bg-tertiary); font-variant-numeric: tabular-nums; }
.purchase-panel { min-width: 0; border: 1px solid var(--border-color); border-radius: 18px; background: var(--bg-elevated); box-shadow: 0 2px 6px rgb(0 0 0 / 0.025); }
.purchase-layout { display: grid; align-items: start; gap: 24px; min-width: 0; }
.purchase-steps { display: grid; gap: 18px; min-width: 0; }
.purchase-section { padding: 22px; }
.purchase-section-heading { display: flex; align-items: center; gap: 10px; margin-bottom: 20px; }
.purchase-section-heading h2, .purchase-summary h2 { font-size: 15px; font-weight: 600; }
.purchase-step { display: grid; place-items: center; width: 28px; height: 28px; border: 1px solid var(--border-color); border-radius: 8px; font-size: 11px; font-weight: 550; font-variant-numeric: tabular-nums; color: var(--text-secondary); }
.purchase-continents { margin-bottom: 16px; }
.purchase-region-search { display: flex; align-items: center; gap: 8px; padding: 0 12px; margin-bottom: 16px; border: 1px solid var(--border-color); border-radius: 9px; color: var(--text-tertiary); }
.purchase-region-search svg { flex-shrink: 0; }
.purchase-page .purchase-region-search input { width: 100%; min-width: 0; height: 40px; padding: 8px 0; border: 0 !important; border-radius: 0; background: transparent !important; color: var(--text-primary); font-size: 12px; box-shadow: none !important; outline: none; }
.purchase-region-search:focus-within { outline: 2px solid var(--border-hover); outline-offset: 2px; border-color: var(--text-secondary); }
.purchase-region-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 175px), 1fr)); gap: 10px; }
.purchase-region-option { display: flex; flex-direction: column; gap: 10px; padding: 12px; border: 1px solid var(--border-color); border-radius: 12px; text-align: left; background: var(--bg-elevated); transition: border-color 150ms, background 150ms; }
.purchase-region-top, .purchase-config-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.purchase-region-name { flex: 1; font-size: 13px; font-weight: 550; line-height: 1.6; overflow-wrap: anywhere; }
.purchase-region-option:hover:not(:disabled), .purchase-config-option:hover:not(:disabled) { border-color: var(--text-secondary); }
.purchase-region-option.is-selected, .purchase-config-option.is-selected { border-color: var(--text-primary); box-shadow: inset 0 0 0 1px var(--text-primary); background: var(--bg-tertiary); }
.purchase-region-option:disabled, .purchase-config-option:disabled { opacity: 0.5; cursor: not-allowed; }
.purchase-choice-indicator { display: grid; place-items: center; width: 18px; height: 18px; border: 1px solid var(--border-hover); border-radius: 50%; flex-shrink: 0; }
.is-selected > .purchase-region-top > .purchase-choice-indicator, .is-selected > .purchase-config-top > .purchase-choice-indicator { background: var(--text-primary); border-color: var(--text-primary); color: var(--bg-elevated); }
.purchase-stock { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 400; color: var(--text-secondary); white-space: nowrap; }
.purchase-stock > span { width: 5px; height: 5px; border-radius: 50%; background: var(--text-tertiary); }
.purchase-stock.is-available > span { background: #16a34a; }
.purchase-filter-empty { padding: 28px 0; text-align: center; font-size: 13px; color: var(--text-secondary); }
.purchase-config-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 220px), 1fr)); gap: 12px; }
.purchase-config-option { display: flex; flex-direction: column; padding: 18px; border: 1px solid var(--border-color); border-radius: 12px; text-align: left; background: var(--bg-elevated); transition: border-color 150ms, background 150ms; }
.purchase-preset { font-size: 15px; font-weight: 600; }
.purchase-config-specs { display: grid; gap: 10px; margin: 20px 0; font-size: 13px; }
.purchase-config-specs > span { display: flex; align-items: center; gap: 9px; }
.purchase-config-specs svg { color: var(--text-tertiary); }
.purchase-config-price { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 8px; margin-top: auto; padding-top: 15px; border-top: 1px solid var(--border-color); }
.purchase-config-price strong { font-size: 23px; font-weight: 600; letter-spacing: -0.035em; font-variant-numeric: tabular-nums; }
.purchase-config-price strong > span { font-size: 15px; margin-right: 2px; }
.purchase-price-period { font-size: 11px; color: var(--text-secondary); }
.purchase-setup-fee { margin-top: 5px; font-size: 11px; color: var(--text-secondary); }
.purchase-instance-fields { display: grid; gap: 18px; }
.purchase-field { display: flex; flex-direction: column; gap: 8px; min-width: 0; color: var(--text-secondary); font-size: 12px; }
.purchase-name-quantity { display: grid; grid-template-columns: minmax(0, 1fr) 130px; gap: 20px; }
.purchase-page .purchase-input { width: 100%; min-width: 0; min-height: 42px; margin: 0; padding: 10px 12px; border: 1px solid var(--border-color); border-color: var(--border-color) !important; border-radius: 9px; background: var(--bg-elevated) !important; color: var(--text-primary); box-shadow: none !important; font-size: 13px; }
.purchase-page .purchase-input:focus { border-color: var(--text-secondary) !important; outline: 2px solid var(--border-hover); outline-offset: 2px; box-shadow: none !important; }
.purchase-page .purchase-input[aria-invalid="true"] { border-color: rgb(239 68 68 / 0.65) !important; }
.purchase-quantity { display: grid; grid-template-columns: 36px minmax(0, 1fr) 36px; height: 42px; border: 1px solid var(--border-color); border-radius: 9px; overflow: hidden; color: var(--text-primary); }
.purchase-quantity button { display: grid; place-items: center; }
.purchase-quantity button:hover:not(:disabled) { background: var(--bg-tertiary); }
.purchase-quantity input { width: 100%; min-width: 0; border: 0; border-color: transparent !important; padding: 0; background: transparent !important; text-align: center; color: var(--text-primary); font-size: 13px; font-variant-numeric: tabular-nums; appearance: textfield; box-shadow: none !important; }
.purchase-quantity input::-webkit-inner-spin-button, .purchase-quantity input::-webkit-outer-spin-button { appearance: none; margin: 0; }
.purchase-quantity input:focus { outline: none; box-shadow: inset 0 0 0 1px var(--text-secondary) !important; }
.purchase-quantity button:focus-visible { outline-offset: -3px; }
.purchase-field-notice { font-size: 12px; line-height: 1.6; }
.purchase-name-preview { margin-top: -10px; color: var(--text-tertiary); font-size: 11px; line-height: 1.5; overflow-wrap: anywhere; }
.purchase-queued { display: flex; align-items: center; gap: 7px; padding-top: 12px; border-top: 1px solid var(--border-color); color: var(--text-secondary); font-size: 12px; }
.purchase-images-loading { display: flex; align-items: center; gap: 8px; min-height: 46px; font-size: 12px; }
.purchase-sign-in { display: grid; justify-items: start; gap: 15px; }
.purchase-sign-in p { color: var(--text-secondary); font-size: 13px; }
.purchase-summary { overflow: hidden; }
.purchase-summary-section { padding: 22px; }
.purchase-summary-section + .purchase-summary-section { border-top: 1px solid var(--border-color); }
.purchase-selected-region { display: flex; align-items: center; gap: 8px; margin-top: 23px; font-size: 14px; font-weight: 550; line-height: 1.6; overflow-wrap: anywhere; }
.purchase-selected-preset { display: inline-block; margin-top: 9px; padding: 3px 7px; border-radius: 5px; background: var(--bg-tertiary); font-size: 10px; font-weight: 550; }
.purchase-summary-specs, .purchase-fees { display: grid; gap: 12px; font-size: 12px; }
.purchase-summary-specs { margin-top: 20px; }
.purchase-summary-specs > div, .purchase-fees > div { display: flex; justify-content: space-between; align-items: baseline; gap: 15px; }
.purchase-summary dt { flex-shrink: 0; color: var(--text-secondary); }
.purchase-summary dd { min-width: 0; text-align: right; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.purchase-grand-total { display: grid; gap: 8px; margin-top: 20px; padding-top: 18px; border-top: 1px solid var(--border-color); }
.purchase-grand-total > span { font-size: 12px; color: var(--text-secondary); }
.purchase-grand-total strong { font-size: 36px; font-weight: 650; letter-spacing: -0.045em; line-height: 1.2; font-variant-numeric: tabular-nums; }
.purchase-grand-total strong > span { margin-right: 4px; font-size: 23px; font-weight: 500; }
.purchase-actions { display: grid; gap: 10px; }
.purchase-primary, .purchase-secondary { display: inline-flex; justify-content: center; align-items: center; gap: 8px; min-height: 44px; padding: 11px 16px; border: 1px solid var(--text-primary); border-radius: 10px; font-size: 13px; font-weight: 550; line-height: 1.5; transition: opacity 150ms, background 150ms; }
.purchase-primary { background: var(--text-primary); color: var(--bg-elevated); }
.purchase-secondary { border-color: var(--border-color); background: var(--bg-elevated); color: var(--text-primary); }
.purchase-primary:hover:not(:disabled) { opacity: 0.85; }
.purchase-secondary:hover:not(:disabled) { background: var(--bg-tertiary); }
.purchase-actions button:disabled, .purchase-quantity button:disabled { opacity: 0.45; cursor: not-allowed; }
.purchase-action-hint { color: var(--text-tertiary); font-size: 11px; line-height: 1.6; text-align: center; }
.purchase-summary-empty { display: grid; justify-items: center; gap: 18px; padding: 35px 5px 20px; color: var(--text-secondary); text-align: center; font-size: 13px; line-height: 1.7; }
.purchase-empty { display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 20px; min-height: 270px; padding: 32px 22px; color: var(--text-secondary); font-size: 14px; text-align: center; }
.purchase-alert { display: flex; align-items: center; justify-content: space-between; gap: 15px; padding: 14px 18px; border: 1px solid rgb(239 68 68 / 0.25); border-radius: 12px; background: rgb(239 68 68 / 0.045); color: #dc2626; font-size: 13px; line-height: 1.65; }
.purchase-alert button { font-weight: 600; text-decoration: underline; flex-shrink: 0; }
:global(.dark) .purchase-alert { color: #f87171; }
.purchase-options-move, .purchase-options-enter-active { transition: transform 180ms ease-out, opacity 180ms ease-out; }
.purchase-options-enter-from { opacity: 0; transform: translateY(5px); }
.purchase-number-enter-active { transition: transform 180ms ease-out, opacity 180ms ease-out; }
.purchase-number-leave-active { transition: opacity 80ms; }
.purchase-number-enter-from { opacity: 0; transform: translateY(5px); }
.purchase-number-leave-to { opacity: 0; }
.purchase-choice-indicator svg { animation: purchase-check-in 180ms ease-out; }
@keyframes purchase-check-in {
  from { opacity: 0; transform: scale(0.65); }
  to { opacity: 1; transform: scale(1); }
}
.purchase-page button:focus-visible, .purchase-cart-link:focus-visible { outline: 2px solid var(--text-secondary); outline-offset: 3px; }
@media (min-width: 1100px) {
  .purchase-layout { grid-template-columns: minmax(0, 1fr) 320px; }
  .purchase-summary { position: sticky; top: 24px; }
}
@media (max-width: 540px) {
  .purchase-page, .purchase-layout { gap: 20px; }
  .purchase-public { padding: 24px 16px; }
  .purchase-header h1 { font-size: 21px; }
  .purchase-heading-icon { display: none; }
  .purchase-section, .purchase-summary-section { padding: 18px; }
  .purchase-region-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .purchase-region-option { padding: 13px; }
  .purchase-config-specs { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin: 16px 0; }
  .purchase-config-specs > span { flex-direction: column; align-items: flex-start; gap: 6px; }
  .purchase-name-quantity { grid-template-columns: minmax(0, 1fr) 112px; gap: 12px; }
  .purchase-quantity { grid-template-columns: 32px minmax(0, 1fr) 32px; }
}
@media (prefers-reduced-motion: reduce) {
  .purchase-page *, .purchase-page *::before, .purchase-page *::after { animation: none !important; transition: none !important; }
  .purchase-options-enter-from, .purchase-number-enter-from { transform: none; }
}
</style>
