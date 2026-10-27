<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import ManagementGatewayPanel from '@/components/host/ManagementGatewayPanel.vue'

const { t } = useI18n()
</script>

<template>
  <div class="space-y-6">
    <header class="page-header">
      <h1 class="page-title">{{ t('nav.gateways') }}</h1>
    </header>
    <ManagementGatewayPanel />
  </div>
</template>
