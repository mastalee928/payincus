<script setup lang="ts">
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import api from '@/api/admin'
import { useToast } from '@/stores/toast'
import { useAuthStore } from '@/stores/auth'
import { architectureOfPreset, type PoolCatalogRegion } from '@/utils/poolCatalog'
import { localizePoolRegionName } from '@/utils/poolRegionCatalog'
import { translateError } from '@/utils/errorHandler'
import { validateName } from '@/utils/validation'
import type { SystemImage } from '@/types/api'
const props = defineProps<{ username: string | null; balance: number }>()
const { t, locale } = useI18n(), toast = useToast(), router = useRouter()
const auth = useAuthStore(), route = useRoute(), active = ref(true), mounted = ref(false)
let disposed = false, contextSequence = 0, readSequence = 0
const sessionKey = computed(() => {
  if (!auth.token || !auth.user || auth.user.role !== 'admin') return ''
  let identity = auth.token
  try {
    const payload = JSON.parse(atob(identity.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    if (typeof payload.sid === 'string') identity = payload.sid
  } catch { /* Legacy tokens retain their full identity. */ }
  return `${auth.user.id}:${identity}`
})
const writable = computed(() => active.value && !!sessionKey.value)
const readActive = computed(() => mounted.value && writable.value)
const regions = ref<PoolCatalogRegion[]>([]), allImages = ref<SystemImage[]>([])
const selectedId = ref<number | null>(null), image = ref(''), name = ref('')
const billing = ref<'free' | 'paid'>('free'), chargeFirstMonth = ref(true)
const loading = ref(true), submitting = ref(false), error = ref('')
const ready = ref(false), readError = ref('')
const requestId = ref(crypto.randomUUID())
const products = computed(() => regions.value.flatMap(region => region.products.map(product => ({ ...product, region }))))
const selected = computed(() => products.value.find(product => product.id === selectedId.value))
const images = computed(() => selected.value ? allImages.value.filter(item =>
  item.architecture === architectureOfPreset(selected.value!.resourcePreset) && item.instanceType !== 'vm') : [])
const total = computed(() => selected.value ? selected.value.monthlyPrice + selected.value.setupFee : 0)
const charge = computed(() => billing.value === 'paid' && chargeFirstMonth.value ? total.value / 100 : 0)
const canSubmit = computed(() => writable.value && !!props.username && !!selected.value?.idle && !!image.value && !!name.value.trim() &&
  props.balance >= charge.value && ready.value && !loading.value && !submitting.value &&
  images.value.some(item => item.remoteAlias === image.value))
watch([selectedId, images], () => { if (!images.value.some(item => item.remoteAlias === image.value)) image.value = images.value[0]?.remoteAlias || '' })
watch([() => props.username, selectedId, image, name, billing, chargeFirstMonth, sessionKey], () => { requestId.value = crypto.randomUUID() }, { flush: 'sync' })
watch([() => props.username, sessionKey, active, () => route.fullPath], () => {
  contextSequence++
  error.value = ''
}, { flush: 'sync' })
onActivated(() => { active.value = true })
onDeactivated(() => { active.value = false })
onUnmounted(() => { disposed = true; contextSequence++; readSequence++ })
async function refresh() {
  if (disposed || !readActive.value || loading.value || submitting.value) return
  const sequence = ++readSequence
  const current = () => !disposed && readActive.value && sequence === readSequence
  ready.value = false; readError.value = ''
  loading.value = true; error.value = ''
  try {
    const [catalog, availableImages] = await Promise.all([api.hostPools.catalog(), api.images.getSystemImages('container')])
    if (!current()) return
    if (!Array.isArray(catalog.regions) || !Array.isArray(availableImages.images)) throw new Error(t('common.loadFailed'))
    regions.value = catalog.regions; allImages.value = availableImages.images
    if (!products.value.some(product => product.id === selectedId.value && product.idle > 0)) selectedId.value = products.value.find(product => product.idle > 0)?.id ?? null
    ready.value = true
  } catch (failure) { if (current()) readError.value = translateError(failure) }
  finally { if (current()) loading.value = false }
}
watch([readActive, sessionKey], () => {
  readSequence++
  ready.value = false; loading.value = false; readError.value = ''
  if (readActive.value && !submitting.value) void refresh()
}, { flush: 'sync' })
async function submit() {
  if (disposed || !canSubmit.value || !selected.value || !props.username) return
  const validation = validateName(name.value)
  if (!validation.valid) { error.value = validation.message || t('admin.instanceCreate.createFailed'); return }
  submitting.value = true; error.value = ''
  const context = contextSequence
  const payload = { requestId: requestId.value, username: props.username, name: name.value.trim(),
    poolPriceId: selected.value.id, image: image.value, expectedTotal: total.value, billing: billing.value, chargeFirstMonth: chargeFirstMonth.value }
  const current = () => !disposed && writable.value && context === contextSequence && requestId.value === payload.requestId
  try {
    const result = await api.hostPools.createForUser(payload)
    if (!current()) return
    const instance = result.instances[0]
    if (!instance || instance.status === 'error') {
      if (instance && !instance.refundPending) requestId.value = crypto.randomUUID()
      error.value = t('admin.instanceCreate.createFailed')
      return
    }
    toast.success(t('admin.instanceCreate.createSuccess', { username: payload.username }))
    await router.push(`/admin/instances/${instance.id}`)
  } catch (failure) { if (current()) error.value = translateError(failure) }
  finally {
    submitting.value = false
    if (!disposed && readActive.value && !ready.value) void refresh()
  }
}
onMounted(() => { mounted.value = true })
</script>
<template>
  <form class="card p-5 sm:p-6 space-y-5" :aria-busy="loading || submitting" @submit.prevent="submit">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-base font-semibold text-themed">{{ t('admin.instanceCreate.poolSource') }}</h2>
      <button type="button" class="btn-secondary" :disabled="!readActive || loading || submitting" @click="refresh">{{ t('common.refresh') }}</button>
    </div>
    <p v-if="loading" role="status" class="text-sm text-themed-muted">{{ t('common.loading') }}</p>
    <p v-else-if="readError" role="alert" class="text-sm text-error break-words">{{ readError }}</p>
    <p v-else-if="ready && !products.some(product => product.idle > 0)" role="status" class="text-sm text-themed-muted">{{ t('admin.instanceCreate.noPoolStock') }}</p>
    <fieldset class="space-y-5" :disabled="!ready || loading || submitting">
      <label class="block text-sm text-themed">{{ t('admin.instanceCreate.poolProduct') }}
        <select v-model="selectedId" class="input w-full mt-2" required>
          <option :value="null" disabled>{{ t('admin.instanceCreate.selectPlan') }}</option>
          <option v-for="product in products" :key="product.id" :value="product.id" :disabled="product.idle === 0">
            {{ localizePoolRegionName(product.region.name, product.region.countryCode, locale) }} · {{ product.resourcePreset }} · {{ product.diskGiB }} GiB · {{ t('admin.instanceCreate.poolStock', { count: product.idle }) }}
          </option>
        </select>
      </label>
      <dl v-if="selected" class="grid grid-cols-3 gap-3 text-sm text-themed border-y border-themed py-3">
        <div><dt class="text-themed-muted">CPU</dt><dd class="mt-1 tabular-nums">{{ selected.cpu }}%</dd></div>
        <div><dt class="text-themed-muted">{{ t('instance.createPage.memory') }}</dt><dd class="mt-1 tabular-nums">{{ selected.memoryMiB }} MiB</dd></div>
        <div><dt class="text-themed-muted">{{ t('instance.createPage.disk') }}</dt><dd class="mt-1 tabular-nums">{{ selected.diskGiB }} GiB</dd></div>
      </dl>
      <fieldset class="space-y-2">
        <legend class="text-sm text-themed mb-2">{{ t('admin.instanceCreate.instanceType') }}</legend>
        <div class="flex flex-wrap gap-x-6 gap-y-2">
          <label class="flex items-center gap-2 min-h-11 text-sm text-themed"><input v-model="billing" type="radio" value="free" name="pool-billing" />{{ t('admin.instanceCreate.freeInstance') }}</label>
          <label class="flex items-center gap-2 min-h-11 text-sm text-themed"><input v-model="billing" type="radio" value="paid" name="pool-billing" />{{ t('admin.instanceCreate.paidInstance') }}</label>
        </div>
        <label v-if="billing === 'paid'" class="flex items-center gap-2 min-h-11 text-sm text-themed"><input v-model="chargeFirstMonth" type="checkbox" />{{ t('admin.instanceCreate.chargeFirstMonth') }}</label>
      </fieldset>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label class="block text-sm text-themed">{{ t('instance.createPage.instanceName') }}<input v-model="name" required minlength="2" maxlength="60" class="input w-full mt-2" autocomplete="off" /></label>
        <label class="block text-sm text-themed">{{ t('instance.selector.selectSystem') }}<select v-model="image" required class="input w-full mt-2"><option value="" disabled>{{ t('instance.selector.selectSystem') }}</option><option v-for="item in images" :key="item.id" :value="item.remoteAlias">{{ item.name }}</option></select></label>
      </div>
      <dl class="space-y-2 text-sm text-themed">
        <div class="flex justify-between gap-3"><dt>{{ t('admin.instanceCreate.userBalance') }}</dt><dd class="tabular-nums">¥{{ balance.toFixed(2) }}</dd></div>
        <div v-if="selected && billing === 'paid'" class="flex justify-between gap-3"><dt>{{ t('admin.instanceCreate.planPrice') }}</dt><dd class="tabular-nums">¥{{ (selected.monthlyPrice / 100).toFixed(2) }}</dd></div>
        <div v-if="selected && billing === 'paid' && chargeFirstMonth" class="flex justify-between gap-3"><dt>{{ t('admin.instanceCreate.setupFee') }}</dt><dd class="tabular-nums">¥{{ (selected.setupFee / 100).toFixed(2) }}</dd></div>
        <div class="flex justify-between gap-3 font-medium"><dt>{{ t('admin.instanceCreate.totalCharge') }}</dt><dd class="tabular-nums">¥{{ charge.toFixed(2) }}</dd></div>
      </dl>
      <p v-if="balance < charge" role="alert" class="text-sm text-error">{{ t('admin.instanceCreate.insufficientBalance') }}</p>
      <p v-if="error" role="alert" class="text-sm text-error break-words">{{ error }}</p>
      <button type="submit" class="btn-primary w-full" :disabled="!canSubmit">{{ t(submitting ? 'admin.instanceCreate.creating' : 'admin.instanceCreate.submit') }}</button>
    </fieldset>
  </form>
</template>
<style scoped>
input:focus-visible, select:focus-visible, button:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }
button, input, select { min-height: 44px; }
</style>
