<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import api from '@/api'
import FlagIcon from '@/components/FlagIcon.vue'
import CartButton from '@/components/CartButton.vue'
import ImageSelector from '@/components/instance/ImageSelector.vue'
import { useAuthStore } from '@/stores/auth'
import { useCartStore } from '@/stores/cart'
import { useToast } from '@/stores/toast'
import { translateError } from '@/utils/errorHandler'
import { validateName } from '@/utils/validation'
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
  <div class="space-y-5 animate-fade-in" :class="!auth.isAuthenticated ? 'mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8' : ''">
    <div class="page-header gap-3">
      <div><h1 class="page-title">{{ t('poolPurchase.title') }}</h1><p class="page-description">{{ t('poolPurchase.description') }}</p></div>
      <div class="flex items-center gap-2"><CartButton /><RouterLink to="/checkout" class="btn-secondary whitespace-nowrap">{{ t('cart.title') }} ({{ cart.totalQuantity }})</RouterLink></div>
    </div>
    <div v-if="error" class="card p-4 text-sm text-red-600 dark:text-red-400" role="alert">{{ error }} <button class="btn-secondary ml-3" @click="load">{{ t('common.retry') }}</button></div>
    <div v-if="loading" class="card p-8 text-center text-themed-muted">{{ t('common.loading') }}</div>
    <div v-else-if="!regions.length" class="card p-8 text-center text-themed-muted">{{ t('poolPurchase.empty') }}</div>
    <div v-else class="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem] items-start">
      <div class="space-y-4 min-w-0">
        <section class="card p-5 space-y-3">
          <h2 class="font-semibold text-themed">1. {{ t('poolPurchase.region') }}</h2>
          <div class="grid sm:grid-cols-2 gap-2">
            <button v-for="value in regions" :key="value.id" type="button" class="selection-tile" :class="value.id === regionId ? 'selected' : ''" :disabled="regionStock(value) === 0" @click="selectRegion(value.id)">
              <span class="flex items-center gap-2 min-w-0"><FlagIcon v-if="value.countryCode" :code="value.countryCode" size="sm" class="shrink-0" /><span class="break-words">{{ value.name }}</span></span>
              <span class="text-xs text-themed-muted whitespace-nowrap">{{ regionStock(value) ? t('poolPurchase.stock', { count: regionStock(value) }) : t('poolPurchase.soldOut') }}</span>
            </button>
          </div>
        </section>
        <section v-if="region" class="card p-5 space-y-3">
          <h2 class="font-semibold text-themed">2. {{ t('poolPurchase.configuration') }}</h2>
          <div class="grid sm:grid-cols-2 gap-2">
            <button v-for="value in region.products" :key="value.id" type="button" class="selection-tile flex-col items-stretch" :class="value.id === productId ? 'selected' : ''" :disabled="value.idle === 0" @click="productId = value.id">
              <span class="font-medium">{{ presetLabel(value.resourcePreset) }} · {{ value.diskGiB }} GiB</span>
              <span class="text-xs text-themed-muted">{{ value.cpu / 100 }} CPU · {{ formatMemoryMiB(value.memoryMiB) }}</span>
              <span class="flex justify-between gap-2"><span>¥{{ formatPublicPrice(value.monthlyPrice) }} / {{ t('poolPurchase.month') }}</span><span class="text-xs text-themed-muted">{{ value.idle ? t('poolPurchase.stock', { count: value.idle }) : t('poolPurchase.soldOut') }}</span></span>
            </button>
          </div>
        </section>
        <section v-if="product" class="card p-5 space-y-4">
          <h2 class="font-semibold text-themed">3. {{ t('poolPurchase.instance') }}</h2>
          <button v-if="!auth.isAuthenticated" class="btn-primary" @click="login">{{ t('poolPurchase.login') }}</button>
          <template v-else>
            <div v-if="imagesLoading" class="text-sm text-themed-muted">{{ t('common.loading') }}</div>
            <ImageSelector v-else-if="images.length" v-model:selected-image="image" :available-images="images" :images-loading="imagesLoading" />
            <p v-else class="text-sm text-amber-600 dark:text-amber-400">{{ t('poolPurchase.noImages') }}</p>
            <div class="grid sm:grid-cols-[1fr_8rem] gap-3">
              <label class="text-sm text-themed">{{ t(quantity > 1 ? 'poolPurchase.namePrefix' : 'common.name') }}<input v-model="name" class="input w-full mt-1" maxlength="60" placeholder="my-server" /></label>
              <label class="text-sm text-themed">{{ t('poolPurchase.quantity') }}<input v-model.number="quantity" class="input w-full mt-1" type="number" min="1" :max="maxQuantity" step="1" /></label>
            </div>
            <p v-if="name && !nameValid" class="text-xs text-red-600 dark:text-red-400">{{ t('cart.nameInvalid') }}</p>
            <p v-else-if="name && quantity > 1" class="text-xs text-themed-muted break-all">{{ names.slice(0, 3).join(', ') }}{{ names.length > 3 ? ' …' : '' }}</p>
            <p v-if="queuedQuantity" class="text-xs text-themed-muted">{{ t('poolPurchase.inCart', { count: queuedQuantity }) }}</p>
          </template>
        </section>
      </div>
      <aside class="card p-5 space-y-4 lg:sticky lg:top-5">
        <h2 class="font-semibold text-themed">{{ t('poolPurchase.summary') }}</h2>
        <template v-if="product">
          <div class="space-y-1 text-sm text-themed">
            <p class="flex items-center gap-2 min-w-0"><FlagIcon v-if="region?.countryCode" :code="region.countryCode" size="sm" class="shrink-0" /><span class="break-words">{{ region?.name }}</span></p>
            <p>{{ presetLabel(product.resourcePreset) }} · {{ product.diskGiB }} GiB × {{ quantity }}</p>
          </div>
          <dl class="space-y-2 text-sm"><div class="flex justify-between text-themed-secondary"><dt>{{ t('poolPurchase.monthly') }}</dt><dd>¥{{ formatPublicPrice(product.monthlyPrice * quantity) }}</dd></div><div class="flex justify-between text-themed-secondary"><dt>{{ t('poolPurchase.setup') }}</dt><dd>¥{{ formatPublicPrice(product.setupFee * quantity) }}</dd></div></dl>
          <div class="border-t border-themed pt-3"><p class="text-xs text-themed-muted">{{ t('poolPurchase.firstPayment') }}</p><p class="text-2xl font-semibold text-themed">¥{{ formatPublicPrice(subtotal) }}</p></div>
          <p class="text-xs text-themed-muted">{{ t('poolPurchase.cartHint') }}</p>
          <button v-if="!auth.isAuthenticated" class="btn-primary w-full" @click="login">{{ t('poolPurchase.login') }}</button>
          <template v-else><button class="btn-primary w-full" :disabled="!canAdd" @click="add()">{{ t('poolPurchase.add') }}</button><button class="btn-secondary w-full" :disabled="!canAdd" @click="add(true)">{{ t('poolPurchase.checkout') }}</button></template>
        </template>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.selection-tile { @apply flex items-center justify-between gap-2 rounded-lg border border-themed p-3 text-left text-sm text-themed transition-colors; }
.selection-tile:hover:not(:disabled), .selection-tile.selected { border-color: currentColor; }
.selection-tile.selected { @apply bg-themed-secondary; box-shadow: inset 0 0 0 1px currentColor; }
.selection-tile:disabled { @apply opacity-50 cursor-not-allowed; }
</style>
