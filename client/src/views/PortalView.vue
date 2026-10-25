<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import HomepageMapDemo from '@/components/public/HomepageMapDemo.vue'
import { useBrand } from '@/composables/useBrand'
import { usePageSeo } from '@/composables/usePageSeo'

defineOptions({ name: 'PortalView' })
const { t } = useI18n()
const brand = useBrand()
usePageSeo(() => ({
  title: brand.brandName + ' - ' + t('publicSite.seo.homeTitle'),
  description: t('publicSite.seo.homeDescription'),
  canonical: window.location.origin + '/',
  keywords: t('publicSite.seo.keywords')
}))
</script>

<template>
  <HomepageMapDemo :preview="false" />
</template>
