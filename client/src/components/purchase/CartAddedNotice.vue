<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check } from 'lucide-vue-next'

const props = defineProps<{ total: number; selection: number | null }>()
const { t } = useI18n()
const added = ref(0)
watch(() => props.total, (current, previous) => {
  added.value = current > previous ? current - previous : 0
})
watch(() => props.selection, () => { added.value = 0 })
</script>

<template>
  <div class="cart-added-slot" role="status" aria-live="polite" aria-atomic="true">
    <Transition name="cart-added">
      <div v-if="added" class="cart-added-notice">
        <span class="cart-added-check"><Check :size="13" :stroke-width="2.5" aria-hidden="true" /></span>
        <span>{{ t('poolPurchase.addedCount', { count: added }) }}</span>
        <RouterLink to="/checkout">{{ t('poolPurchase.viewCart') }}</RouterLink>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.cart-added-slot:empty { display: none; }
.cart-added-notice { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding-top: 7px; font-size: 12px; line-height: 1.6; }
.cart-added-check { display: grid; place-items: center; width: 20px; height: 20px; border-radius: 50%; background: var(--text-primary); color: var(--bg-elevated); }
.cart-added-notice a { margin-left: auto; text-decoration: underline; text-underline-offset: 3px; }
.cart-added-notice a:focus-visible { outline: 2px solid var(--text-secondary); outline-offset: 3px; }
.cart-added-enter-active { transition: transform 180ms ease-out, opacity 180ms ease-out; }
.cart-added-leave-active { transition: opacity 100ms; }
.cart-added-enter-from { opacity: 0; transform: translateY(5px); }
.cart-added-leave-to { opacity: 0; }
@media (prefers-reduced-motion: reduce) {
  .cart-added-enter-active, .cart-added-leave-active { transition: none; }
  .cart-added-enter-from { transform: none; }
}
</style>
