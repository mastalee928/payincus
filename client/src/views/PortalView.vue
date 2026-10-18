<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ArrowDown, ArrowRight, Globe2, RotateCw, ShoppingBag } from 'lucide-vue-next'
import api from '@/api'
import AnimatedContent from '@/components/motion/AnimatedContent.vue'
import SelectionTabs from '@/components/ui/SelectionTabs.vue'
import PublicHostOffer from '@/components/public/PublicHostOffer.vue'
import { usePageSeo } from '@/composables/usePageSeo'
import { useAuthStore } from '@/stores/auth'
import { useBrand } from '@/composables/useBrand'
import { buildPoolPurchaseRegions, poolRegionLocalizedName, type PoolPurchaseRegion } from '@/utils/poolRegionCatalog'
import { continentOf, groupByContinent } from '@/utils/countryContinent'
import type { PoolCatalogRegion } from '@/utils/poolCatalog'
import { dashboardPath, helpPath, loginPath } from '@/utils/app-paths'

defineOptions({ name: 'PortalView' })

const router = useRouter()
const { t, locale } = useI18n()
const authStore = useAuthStore()
const brand = useBrand()
const regions = ref<PoolCatalogRegion[]>([])
const loading = ref(true)
const loadFailed = ref(false)
const continent = ref('all')
const visibleCount = ref(6)

const locations = computed(() => buildPoolPurchaseRegions(regions.value))
const locationLabel = (value: PoolPurchaseRegion) => poolRegionLocalizedName(value, locale.value)
const offers = computed(() => locations.value.flatMap(location =>
  location.regions.flatMap(region => region.products.map(product => ({
    location, regionId: region.id, product
  })))
).sort((left, right) =>
  Number(right.product.idle > 0) - Number(left.product.idle > 0)
  || left.product.monthlyPrice - right.product.monthlyPrice
  || left.product.id - right.product.id
))
const filterOptions = computed(() => [
  { value: 'all', label: t('poolPurchase.allRegions') },
  ...groupByContinent(locations.value.filter(location => location.regions.some(region => region.products.length)))
    .map(group => ({ value: group.code, label: t('poolPurchase.continents.' + group.code) }))
])
const filteredOffers = computed(() => offers.value.filter(offer =>
  continent.value === 'all' || continentOf(offer.location.countryCode) === continent.value
))
const visibleOffers = computed(() => filteredOffers.value.slice(0, visibleCount.value))
const consoleActionLabel = computed(() => authStore.isAuthenticated
  ? t('publicSite.actions.console') : t('publicSite.actions.signIn'))

watch(continent, () => { visibleCount.value = 6 })

usePageSeo(() => ({
  title: brand.brandName + ' - ' + t('publicSite.seo.homeTitle'),
  description: t('publicSite.seo.homeDescription'),
  canonical: window.location.origin + '/',
  keywords: t('publicSite.seo.keywords')
}))

function goToConsole(): void {
  if (authStore.isAuthenticated) {
    void router.push(dashboardPath())
    return
  }
  void router.push(loginPath())
}

async function loadCatalog(): Promise<void> {
  loading.value = true
  loadFailed.value = false
  try {
    const catalog = await api.packages.getPublicCatalog()
    regions.value = catalog.regions
  } catch {
    loadFailed.value = true
  } finally {
    loading.value = false
  }
}

onMounted(loadCatalog)
</script>

<template>
  <div class="storefront">
    <div class="storefront-container">
      <section class="storefront-intro" aria-labelledby="storefront-title">
        <AnimatedContent direction="horizontal" :distance="-22" :duration="0.6">
          <h1 id="storefront-title">
            <span>{{ t('publicSite.storefront.titleFirst') }}</span>
            <span>{{ t('publicSite.storefront.titleSecond') }}</span>
          </h1>
        </AnimatedContent>
        <div class="storefront-intro-aside">
          <p>{{ t('publicSite.storefront.description') }}</p>
          <div class="storefront-intro-actions">
            <a href="#storefront-products" class="storefront-primary">{{ t('publicSite.storefront.browse') }}<ArrowDown :size="16" aria-hidden="true" /></a>
            <button type="button" class="storefront-text-link" @click="goToConsole">{{ consoleActionLabel }}<ArrowRight :size="16" aria-hidden="true" /></button>
          </div>
        </div>
      </section>

      <section id="storefront-products" class="storefront-catalog" aria-labelledby="storefront-products-title" :aria-busy="loading">
        <div class="storefront-catalog-heading">
          <div>
            <h2 id="storefront-products-title">{{ t('publicSite.storefront.products') }}</h2>
            <p>{{ t('publicSite.storefront.productsHint') }}</p>
          </div>
          <RouterLink to="/purchase" class="storefront-text-link storefront-regions-link">
            <Globe2 :size="16" aria-hidden="true" />{{ t('publicSite.storefront.allRegions', { count: locations.length }) }}<ArrowRight :size="15" aria-hidden="true" />
          </RouterLink>
        </div>

        <SelectionTabs
          v-if="!loading && !loadFailed && filterOptions.length > 2"
          v-model="continent" :options="filterOptions" :label="t('poolPurchase.continentFilter')"
          class="storefront-filters"
        />

        <div v-if="loading" class="storefront-list storefront-loading" role="status">
          <span class="sr-only">{{ t('common.loading') }}</span>
          <div v-for="index in 3" :key="index" class="storefront-skeleton" aria-hidden="true">
            <span></span><span></span><span></span>
          </div>
        </div>
        <div v-else-if="loadFailed" class="storefront-state" role="alert">
          <Globe2 :size="28" :stroke-width="1.4" aria-hidden="true" />
          <h3>{{ t('publicSite.storefront.loadFailed') }}</h3>
          <button type="button" class="storefront-primary" @click="loadCatalog"><RotateCw :size="15" aria-hidden="true" />{{ t('common.retry') }}</button>
        </div>
        <template v-else-if="visibleOffers.length">
          <TransitionGroup name="storefront-offers" tag="ul" class="storefront-list">
            <li v-for="offer in visibleOffers" :key="offer.product.id">
              <PublicHostOffer
                :product="offer.product" :region-id="offer.regionId"
                :name="locationLabel(offer.location)" :country-code="offer.location.countryCode"
              />
            </li>
          </TransitionGroup>
          <div class="storefront-list-footer">
            <p>{{ t('publicSite.storefront.showing', { count: visibleOffers.length, total: filteredOffers.length }) }}</p>
            <button v-if="visibleOffers.length < filteredOffers.length" type="button" class="storefront-text-link" @click="visibleCount += 6">
              {{ t('publicSite.storefront.showMore') }}<ArrowDown :size="15" aria-hidden="true" />
            </button>
            <RouterLink v-else to="/purchase" class="storefront-text-link">{{ t('publicSite.storefront.viewRegions') }}<ArrowRight :size="15" aria-hidden="true" /></RouterLink>
          </div>
        </template>
        <div v-else class="storefront-state">
          <Globe2 :size="28" :stroke-width="1.4" aria-hidden="true" />
          <h3>{{ t('poolPurchase.empty') }}</h3>
          <RouterLink to="/purchase" class="storefront-primary">{{ t('publicSite.storefront.viewRegions') }}<ArrowRight :size="15" aria-hidden="true" /></RouterLink>
        </div>
      </section>

      <section class="storefront-guide" aria-labelledby="storefront-guide-title">
        <div class="storefront-guide-heading">
          <ShoppingBag :size="23" :stroke-width="1.5" aria-hidden="true" />
          <h2 id="storefront-guide-title">{{ t('publicSite.storefront.guideTitle') }}</h2>
        </div>
        <ol>
          <li><span aria-hidden="true">01</span><div><h3>{{ t('publicSite.storefront.stepChoose') }}</h3><p>{{ t('publicSite.storefront.stepChooseHint') }}</p></div></li>
          <li><span aria-hidden="true">02</span><div><h3>{{ t('publicSite.storefront.stepConfigure') }}</h3><p>{{ t('publicSite.storefront.stepConfigureHint') }}</p></div></li>
          <li><span aria-hidden="true">03</span><div><h3>{{ t('publicSite.storefront.stepCheckout') }}</h3><p>{{ t('publicSite.storefront.stepCheckoutHint') }}</p></div></li>
        </ol>
        <RouterLink :to="helpPath()" class="storefront-text-link">{{ t('publicSite.storefront.needHelp') }}<ArrowRight :size="15" aria-hidden="true" /></RouterLink>
      </section>
    </div>
  </div>
</template>

<style scoped>
.storefront { flex: 1; color: var(--text-primary); background: var(--bg-primary); }
.storefront-container { max-width: 1280px; margin: 0 auto; padding: 0 32px; }
.storefront h1, .storefront h2, .storefront h3 { text-wrap: balance; }
.storefront p { text-wrap: pretty; }
.storefront-intro { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr); align-items: center; gap: 70px; padding: 64px 0 58px; }
.storefront-intro h1 { font-size: clamp(36px, 4vw, 56px); font-weight: 650; line-height: 1.28; }
.storefront-intro h1 span { display: block; }
.storefront-intro-aside { max-width: 440px; justify-self: end; }
.storefront-intro-aside p { color: var(--text-secondary); font-size: 15px; line-height: 1.9; }
.storefront-intro-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 22px; margin-top: 23px; }
.storefront-primary, .storefront-text-link { display: inline-flex; align-items: center; justify-content: center; gap: 9px; font-size: 13px; line-height: 1.5; font-weight: 550; }
.storefront-primary { min-height: 44px; padding: 11px 18px; border: 1px solid var(--text-primary); border-radius: 9px; color: var(--bg-elevated); background: var(--text-primary); transition: opacity 150ms; }
.storefront-primary:hover { opacity: 0.85; }
.storefront-primary svg, .storefront-text-link svg:last-child { flex-shrink: 0; transition: transform 180ms ease-out; }
.storefront-primary:hover svg { transform: translateY(2px); }
.storefront-text-link { min-height: 40px; color: var(--text-primary); text-underline-offset: 4px; }
.storefront-text-link:hover { text-decoration: underline; }
.storefront-text-link:hover svg:last-child { transform: translateX(3px); }
.storefront :is(a, button):focus-visible { outline: 2px solid var(--text-secondary); outline-offset: 4px; border-radius: 5px; }
.storefront-catalog { scroll-margin-top: 100px; }
.storefront-catalog-heading { display: flex; align-items: center; justify-content: space-between; gap: 24px; margin-bottom: 24px; }
.storefront-catalog-heading h2 { font-size: 23px; font-weight: 600; line-height: 1.4; }
.storefront-catalog-heading p { margin-top: 8px; color: var(--text-secondary); font-size: 13px; }
.storefront-regions-link { flex-shrink: 0; }
.storefront-filters { margin-bottom: 20px; }
.storefront-list { position: relative; border: 1px solid var(--border-color); border-radius: 16px; overflow: hidden; background: var(--bg-elevated); }
.storefront-list > li + li { border-top: 1px solid var(--border-color); }
.storefront-list-footer { display: flex; justify-content: space-between; align-items: center; gap: 20px; padding: 17px 0; }
.storefront-list-footer p { color: var(--text-secondary); font-size: 12px; font-variant-numeric: tabular-nums; }
.storefront-state { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; min-height: 235px; padding: 32px 24px; border: 1px solid var(--border-color); border-radius: 16px; background: var(--bg-elevated); text-align: center; }
.storefront-state > svg { color: var(--text-secondary); }
.storefront-state h3 { font-size: 15px; font-weight: 500; line-height: 1.6; }
.storefront-skeleton { display: grid; grid-template-columns: 1fr 1.5fr 0.5fr; align-items: center; gap: 60px; padding: 36px 28px; }
.storefront-skeleton + .storefront-skeleton { border-top: 1px solid var(--border-color); }
.storefront-skeleton span { height: 28px; border-radius: 5px; background: var(--bg-secondary); }
.storefront-guide { margin: 62px 0 56px; padding-top: 32px; border-top: 1px solid var(--border-color); }
.storefront-guide-heading { display: flex; align-items: center; gap: 12px; margin-bottom: 28px; }
.storefront-guide h2 { font-size: 19px; font-weight: 600; }
.storefront-guide ol { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 40px; }
.storefront-guide li { display: flex; align-items: baseline; gap: 16px; }
.storefront-guide li > span { color: var(--text-secondary); font-size: 12px; font-variant-numeric: tabular-nums; }
.storefront-guide h3 { font-size: 14px; font-weight: 550; }
.storefront-guide p { max-width: 33ch; margin-top: 8px; color: var(--text-secondary); font-size: 12px; line-height: 1.8; }
.storefront-guide > a { margin: 22px 0 0 32px; font-size: 12px; }
.storefront-offers-enter-active, .storefront-offers-move { transition: transform 180ms ease-out, opacity 180ms ease-out; }
.storefront-offers-enter-from { opacity: 0; transform: translateY(6px); }
@media (max-width: 800px) {
  .storefront-container { padding: 0 24px; }
  .storefront-intro { gap: 32px; padding: 48px 0; }
  .storefront-intro h1 { font-size: 38px; }
  .storefront-intro-aside p { font-size: 13px; }
  .storefront-intro-actions { gap: 15px; }
  .storefront-guide ol { gap: 24px; }
}
@media (max-width: 580px) {
  .storefront-container { padding: 0 16px; }
  .storefront-intro { grid-template-columns: minmax(0, 1fr); gap: 22px; padding: 35px 4px 36px; }
  .storefront-intro h1 { font-size: 37px; }
  .storefront-intro-aside { max-width: none; justify-self: start; }
  .storefront-intro-aside p { max-width: 38ch; font-size: 13px; line-height: 1.8; }
  .storefront-intro-actions { margin-top: 20px; }
  .storefront-catalog-heading { align-items: flex-start; flex-direction: column; gap: 10px; margin-bottom: 16px; padding: 0 4px; }
  .storefront-catalog-heading h2 { font-size: 21px; }
  .storefront-catalog-heading p { font-size: 12px; }
  .storefront-regions-link { min-height: 32px; font-size: 12px; }
  .storefront-skeleton { grid-template-columns: 1fr 1fr; gap: 20px; padding: 26px 20px; }
  .storefront-skeleton span:last-child { display: none; }
  .storefront-guide { margin: 40px 4px; padding-top: 26px; }
  .storefront-guide h2 { font-size: 17px; }
  .storefront-guide ol { grid-template-columns: minmax(0, 1fr); gap: 24px; }
  .storefront-guide p { max-width: none; }
  .storefront-guide-heading { gap: 9px; }
}
@media (prefers-reduced-motion: reduce) {
  .storefront *, .storefront *::before, .storefront *::after { transition: none !important; }
  .storefront-offers-enter-from, .storefront-primary:hover svg, .storefront-text-link:hover svg:last-child { transform: none; }
}
</style>
