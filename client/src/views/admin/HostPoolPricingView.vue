<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import HostPoolPricingPanel from '@/components/host/HostPoolPricingPanel.vue'

const { t } = useI18n()
</script>

<template>
  <div class="space-y-6">
    <h1 class="text-2xl font-semibold text-themed">{{ t('nav.poolPricing') }}</h1>
    <HostPoolPricingPanel />
  </div>
</template>
