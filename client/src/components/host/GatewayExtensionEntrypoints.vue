<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
const { t } = useI18n()
const selected = ref<'independent' | 'backup' | null>(null)
const roles = ['independent', 'backup'] as const
</script>
<template>
  <details class="gateway-extensions card p-5" data-ui>
    <summary class="cursor-pointer text-sm font-semibold text-themed">{{ t('gatewayEndpoint.extensions.title') }}</summary>
    <p class="mt-2 text-sm text-themed-muted">{{ t('gatewayEndpoint.extensions.description') }}</p>
    <div class="mt-4 space-y-3">
      <div v-for="role in roles" :key="role">
        <button type="button" class="btn-secondary w-full flex items-center justify-between gap-3 text-left" :aria-expanded="selected === role" :aria-controls="`gateway-extension-${role}`" @click="selected = selected === role ? null : role">
          <span>{{ t(`gatewayEndpoint.extensions.${role}.title`) }}</span><span class="text-xs text-themed-muted">{{ t('gatewayEndpoint.extensions.reserved') }}</span>
        </button>
        <div v-show="selected === role" :id="`gateway-extension-${role}`" class="pt-3 space-y-2" role="region" :aria-label="t(`gatewayEndpoint.extensions.${role}.title`)">
          <p class="text-sm text-themed">{{ t(`gatewayEndpoint.extensions.${role}.description`) }}</p>
          <p class="text-sm text-themed-muted">{{ t('gatewayEndpoint.extensions.pending') }}</p>
        </div>
      </div>
    </div>
  </details>
</template>
<style scoped>
summary:focus-visible, button:focus-visible { outline: 2px solid var(--text-primary); outline-offset: 3px; }
summary { min-height: 32px; }
@media (max-width: 640px) { summary, button { min-height: 44px; } }
</style>
