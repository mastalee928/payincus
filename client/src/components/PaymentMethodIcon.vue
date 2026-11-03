<script setup lang="ts">
import { computed, useId } from 'vue'

const props = defineProps<{ method?: string; providerType?: string }>()
const tetherMaskId = `payment-tether-${useId()}`
const symbol = computed(() => {
  const method = (props.method ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
  if (method === 'alipay') return 'alipay'
  if (method === 'wxpay' || method === 'wechatpay') return 'wechat'
  if (['bsc','bep20','usdtbsc','usdcbsc','usdtbep20','usdcbep20'].includes(method)) return 'bsc'
  if (['polygon','usdtpolygon','usdcpolygon'].includes(method)) return 'polygon'
  if (['usdt','trc20','usdttrc20'].includes(method)) return 'tether'
  if (['trx','tron'].includes(method)) return 'tron'
  if (['eth','ethereum','erc20','usdterc20','usdcerc20'].includes(method)) return 'ethereum'
  if (['arbitrum','arbitrumone','usdtarbitrumone','usdcarbitrumone'].includes(method)) return 'arbitrum'
  if (method === 'usdt' || props.providerType === 'upaypro' || props.providerType === 'heleket') return 'tether'
  return 'card'
})
</script>

<template>
  <svg class="payment-method-icon" :data-payment-symbol="symbol" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
    <rect v-if="symbol !== 'alipay'" x="1.6" y="1.6" width="28.8" height="28.8" rx="6.5" />
    <g v-if="symbol === 'alipay'" fill="currentColor" stroke="none">
      <!-- Silhouette traced from the owner-provided Alipay reference, including its joined border and sweep. -->
      <path fill-rule="evenodd" d="M5.889 2.147L4.357 2.564 3.097 3.387 2.183 4.511 1.860 5.226 1.600 6.244 1.574 25.447 1.804 26.573 2.213 27.449 2.621 28.045 3.408 28.817 4.051 29.232 5.037 29.634 5.991 29.788 26.009 29.788 27.269 29.532 28.255 29.028 28.664 28.720 29.379 27.979 29.991 26.943 30.311 25.855 30.348 25.038 30.347 6.451 30.220 5.634 30.014 5.021 29.685 4.415 29.072 3.599 28.457 3.081 27.745 2.632 26.928 2.329 26.009 2.136Z M5.787 3.475L4.868 3.765 3.951 4.409 3.493 4.919 3.262 5.328 2.886 6.451 2.878 25.345 2.985 25.957 3.181 26.468 3.847 27.474 4.562 28.038 5.277 28.377 5.991 28.554 7.013 28.571 25.702 28.563 26.826 28.330 27.234 28.140 27.949 27.613 28.488 26.979 28.817 26.366 29.046 25.549 29.047 25.038 27.444 24.528 24.374 23.313 18.655 20.752 18.451 20.803 16.397 22.689 14.672 23.828 13.378 24.426 12.323 24.759 10.689 24.999 9.362 24.962 8.238 24.746 6.604 24.028 5.787 23.334 5.277 22.636 4.966 21.872 4.851 20.953 4.951 20.238 5.162 19.626 5.889 18.474 6.597 17.787 7.192 17.379 7.956 16.970 8.773 16.664 10.681 16.357 12.217 16.460 14.237 16.868 17.021 17.709 17.532 17.741 18.576 15.745 19.004 14.621 19.051 14.213 18.451 14.127 9.872 14.126 9.706 13.906 9.718 13.294 9.872 13.128 14.366 13.052 14.404 11.251 14.060 11.152 8.851 11.147 8.585 11.047 8.540 10.843 8.560 10.230 8.749 10.114 14.264 10.113 14.424 9.923 14.421 7.779 14.581 7.370 14.979 7.215 17.328 7.210 17.537 7.370 17.539 9.923 17.634 10.095 23.149 10.113 23.391 10.230 23.377 11.047 23.149 11.147 17.736 11.150 17.553 11.251 17.539 12.885 17.634 13.079 21.923 13.100 22.149 13.191 22.134 13.600 21.719 15.047 21.209 16.421 20.137 18.502 20.187 18.694 27.336 20.902 28.766 21.214 29.072 21.168 29.101 6.757 29.003 6.145 28.705 5.328 28.153 4.556 27.745 4.161 27.030 3.733 25.906 3.430Z M9.566 17.878L8.443 18.164 7.523 18.644 6.665 19.421 6.251 20.238 6.165 21.055 6.338 21.668 6.526 21.974 7.217 22.619 8.136 23.054 9.055 23.236 10.281 23.231 11.609 22.915 12.323 22.623 13.957 21.634 14.979 20.785 16.039 19.728 16.000 19.549 15.183 19.174 13.345 18.457 12.017 18.048 10.791 17.837Z" />
    </g>
    <g v-else-if="symbol === 'wechat'" stroke="none" fill="currentColor" fill-rule="evenodd">
      <path d="M13 7c-4.4 0-7.7 2.9-7.7 6.4 0 2.1 1.2 3.9 3.1 5.1l-.7 2.7 3-1.5c.6.1 1.1.2 1.8.2a6.7 6.7 0 0 1-.3-2c0-3.9 3.6-7 8-7C19 8.5 16.3 7 13 7Zm-2.6 3.8a1 1 0 1 1 0 2 1 1 0 0 1 0-2Zm5.3 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z" />
      <path d="M20.3 12.2c-3.9 0-6.9 2.5-6.9 5.7s3 5.7 6.9 5.7c.6 0 1.2-.1 1.8-.2l2.6 1.4-.6-2.4c1.8-1 2.9-2.7 2.9-4.5 0-3.2-3-5.7-6.7-5.7Zm-2.5 3.3a.9.9 0 1 1 0 1.8.9.9 0 0 1 0-1.8Zm4.7 0a.9.9 0 1 1 0 1.8.9.9 0 0 1 0-1.8Z" />
    </g>
    <g v-else-if="symbol === 'polygon'" stroke-width="2">
      <path d="m15.3 12.4-4.1-2.5-4.1 2.5v5l4.1 2.5 9.6-5.8 4.1 2.5v5l-4.1 2.5-4.1-2.5v-3M15.3 12.4v3" />
    </g>
    <g v-else-if="symbol === 'bsc'" fill="currentColor" stroke="none">
      <path d="m16 6.3 5.3 5.3-2.5 2.5-2.8-2.8-2.8 2.8-2.5-2.5ZM6.3 16l2.5-2.5 2.5 2.5-2.5 2.5Zm19.4 0-2.5 2.5-2.5-2.5 2.5-2.5ZM16 13.3l2.7 2.7-2.7 2.7-2.7-2.7Zm0 12.4-5.3-5.3 2.5-2.5 2.8 2.8 2.8-2.8 2.5 2.5Z" />
    </g>
    <g v-else-if="symbol === 'tron'" stroke-width="1.5">
      <path d="m7.5 7.1 17 3.3-9.2 16.2ZM7.5 7.1l10 9.1 7-5.8M17.5 16.2l-2.2 10.4M7.5 7.1l7.8 19.5" />
    </g>
    <g v-else-if="symbol === 'ethereum'" stroke-width="1.25">
      <path d="m16 5.7-6.4 10.7L16 20l6.4-3.6ZM9.6 18.8 16 26.3l6.4-7.5L16 22.4Z" />
      <path d="M16 5.7V20M9.6 16.4 16 13l6.4 3.4" />
    </g>
    <g v-else-if="symbol === 'arbitrum'">
      <path d="m16 6.1 8.5 4.9v10L16 25.9 7.5 21V11Z" />
      <path d="m10.7 20 5.3-10m-1.5 12 4.2-8m-.5 7.9 2.3-4.4" stroke-width="2.8" />
    </g>
    <g v-else-if="symbol === 'tether'" stroke="none">
      <defs>
        <mask :id="tetherMaskId" maskUnits="userSpaceOnUse" x="3" y="5" width="26" height="24">
          <path d="M8 6h16l4 10-12 12L4 16Z" fill="white" />
          <path d="M9.5 9h13v3h-5V23h-3V12h-5Z" fill="black" />
          <ellipse cx="16" cy="15.5" rx="8" ry="1.8" fill="none" stroke="black" stroke-width="1" />
        </mask>
      </defs>
      <path d="M8 6h16l4 10-12 12L4 16Z" fill="currentColor" :mask="`url(#${tetherMaskId})`" />
    </g>
    <g v-else>
      <rect x="7" y="10" width="18" height="13" rx="2" /><path d="M7 14h18M10 19h4" />
    </g>
  </svg>
</template>

<style scoped>
.payment-method-icon{display:block;width:26px;height:26px;flex:0 0 26px;color:inherit}
</style>
