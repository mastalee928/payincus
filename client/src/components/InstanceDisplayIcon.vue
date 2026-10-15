<script setup lang="ts">
import { isAdminEntry } from '@/utils/app-paths'
import BadgeImage from '@/components/BadgeImage.vue'

withDefaults(defineProps<{
  badgeId?: string | null
  fallbackIcon?: 'pro' | 'prime' | 'peer' | null
  size?: number
  alt?: string
}>(), {
  badgeId: null,
  fallbackIcon: null,
  size: 32,
  alt: ''
})
</script>

<template>
  <BadgeImage
    v-if="badgeId"
    :badge-id="badgeId"
    :alt="alt || badgeId"
    :size="size"
    variant="icon"
  />
  <svg v-else-if="!isAdminEntry" :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" class="shrink-0 text-themed-muted" aria-hidden="true"><rect x="4" y="3" width="16" height="7" rx="2" /><rect x="4" y="14" width="16" height="7" rx="2" /><path d="M7 6.5h.01M7 17.5h.01M11 6.5h6M11 17.5h6" stroke-linecap="round" /></svg>
  <img
    v-else-if="fallbackIcon"
    :src="`/icons/${fallbackIcon}.svg`"
    :alt="alt || fallbackIcon"
    class="rounded-xl shrink-0"
    :style="{ width: `${size}px`, height: `${size}px` }"
  />
</template>
