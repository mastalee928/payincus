<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowUpRight, Globe2 } from 'lucide-vue-next'
import FlagIcon from '@/components/FlagIcon.vue'
import { formatMemoryMiB, formatPublicPrice, presetLabel, type PoolCatalogProduct } from '@/utils/poolCatalog'

const props = defineProps<{
  product: PoolCatalogProduct
  regionId: number
  name: string
  countryCode: string | null
}>()
const { t } = useI18n()
const purchaseTarget = computed(() => ({
  path: '/purchase',
  query: { region: String(props.regionId), product: String(props.product.id) }
}))
</script>

<template>
  <article class="host-offer" :class="{ 'is-sold-out': product.idle === 0 }">
    <div class="host-offer-location">
      <span class="host-offer-flag">
        <FlagIcon v-if="countryCode" :code="countryCode" size="md" />
        <Globe2 v-else :size="24" aria-hidden="true" />
      </span>
      <div class="host-offer-name">
        <h3>{{ name }}</h3>
        <div class="host-offer-meta">
          <span>{{ presetLabel(product.resourcePreset) }}</span>
          <span class="host-offer-stock" :class="{ 'is-available': product.idle > 0 }">
            <span aria-hidden="true"></span>
            {{ product.idle > 0 ? t('poolPurchase.stock', { count: product.idle }) : t('poolPurchase.soldOut') }}
          </span>
        </div>
      </div>
    </div>
    <dl class="host-offer-specs">
      <div><dt>{{ t('cart.specs.cpu') }}</dt><dd>{{ t('cart.specs.cores', { count: product.cpu / 100 }) }}</dd></div>
      <div><dt>{{ t('cart.specs.memory') }}</dt><dd>{{ formatMemoryMiB(product.memoryMiB) }}</dd></div>
      <div><dt>{{ t('cart.specs.disk') }}</dt><dd>{{ product.diskGiB }} GiB</dd></div>
      <div><dt>{{ t('publicSite.storefront.traffic') }}</dt><dd>{{ t('publicSite.storefront.unlimited') }}</dd></div>
    </dl>
    <div class="host-offer-price">
      <div><span class="host-offer-currency">¥</span><strong>{{ formatPublicPrice(product.monthlyPrice) }}</strong><span> / {{ t('poolPurchase.month') }}</span></div>
      <span v-if="product.setupFee > 0" class="host-offer-setup">{{ t('poolPurchase.setupFee') }} ¥{{ formatPublicPrice(product.setupFee) }}</span>
    </div>
    <RouterLink
      v-if="product.idle > 0" :to="purchaseTarget" class="host-offer-action"
      :aria-label="t('publicSite.storefront.chooseProduct', { region: name, model: presetLabel(product.resourcePreset), disk: product.diskGiB })"
    >
      {{ t('publicSite.storefront.choose') }}<ArrowUpRight :size="16" aria-hidden="true" />
    </RouterLink>
    <button v-else type="button" class="host-offer-action" disabled>{{ t('poolPurchase.soldOut') }}</button>
  </article>
</template>

<style scoped>
.host-offer { display: grid; grid-template-columns: minmax(180px, 1.15fr) minmax(285px, 1.4fr) minmax(130px, 0.65fr) 126px; align-items: center; gap: 24px; padding: 27px 28px; background: var(--bg-elevated); }
.host-offer-location { display: flex; align-items: center; gap: 16px; min-width: 0; }
.host-offer-flag { display: grid; place-items: center; width: 42px; height: 42px; flex-shrink: 0; }
.host-offer-name { min-width: 0; }
.host-offer-name h3 { font-size: 15px; font-weight: 600; line-height: 1.65; overflow-wrap: anywhere; text-wrap: balance; }
.host-offer-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-top: 6px; color: var(--text-secondary); font-size: 11px; }
.host-offer-stock { display: inline-flex; align-items: center; gap: 5px; }
.host-offer-stock > span { width: 5px; height: 5px; border-radius: 50%; background: var(--text-secondary); }
.host-offer-stock.is-available > span { background: var(--kawaii-mint); }
.host-offer-specs { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; font-size: 13px; }
.host-offer-specs dt { margin-bottom: 7px; color: var(--text-secondary); font-size: 11px; }
.host-offer-specs dd { font-weight: 550; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.host-offer-price { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.host-offer-price strong { margin-left: 2px; font-size: 28px; line-height: 1.25; font-weight: 650; }
.host-offer-currency { font-size: 15px; }
.host-offer-price strong + span, .host-offer-setup { color: var(--text-secondary); font-size: 11px; font-weight: 400; }
.host-offer-setup { display: block; margin-top: 6px; }
.host-offer-action { display: inline-flex; align-items: center; justify-content: center; gap: 10px; min-height: 42px; padding: 10px 15px; border: 1px solid var(--text-primary); border-radius: 9px; color: var(--bg-elevated); background: var(--text-primary); font-size: 12px; font-weight: 550; white-space: nowrap; transition: opacity 150ms; }
.host-offer-action svg { transition: transform 180ms ease-out; }
.host-offer-action:hover { opacity: 0.85; }
.host-offer-action:hover svg, .host-offer-action:focus-visible svg { transform: translate(2px, -2px); }
.host-offer-action:focus-visible { outline: 2px solid var(--text-secondary); outline-offset: 4px; }
.host-offer-action:disabled { color: var(--text-secondary); background: var(--bg-secondary); border-color: var(--border-color); cursor: not-allowed; opacity: 1; }
.is-sold-out .host-offer-meta { color: var(--text-secondary); }
@media (max-width: 1050px) {
  .host-offer { grid-template-columns: minmax(0, 1fr) 148px; gap: 22px; }
  .host-offer-location { grid-column: 1; grid-row: 1; }
  .host-offer-price { grid-column: 2; grid-row: 1; }
  .host-offer-specs { grid-column: 1; grid-row: 2; max-width: 440px; }
  .host-offer-action { grid-column: 2; grid-row: 2; }
}
@media (max-width: 580px) {
  .host-offer { grid-template-columns: minmax(0, 1fr) auto; gap: 22px 16px; padding: 24px 20px; }
  .host-offer-location { grid-column: 1 / -1; gap: 12px; }
  .host-offer-specs { grid-column: 1 / -1; }
  .host-offer-price { grid-column: 1; grid-row: 3; text-align: left; }
  .host-offer-action { grid-column: 2; grid-row: 3; min-width: 115px; }
  .host-offer-specs dd { font-size: 12px; }
}
@media (prefers-reduced-motion: reduce) {
  .host-offer-action, .host-offer-action svg { transition: none; }
  .host-offer-action:hover svg, .host-offer-action:focus-visible svg { transform: none; }
}
</style>
