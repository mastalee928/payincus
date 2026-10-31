<script setup lang="ts">
import { computed, onActivated, onDeactivated, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ArrowRight, Check, ChevronRight, CircleAlert, Copy, Eye, EyeOff, Loader2, RefreshCw, Server, Terminal } from 'lucide-vue-next'
import PublicIpv6Addresses from '@/components/PublicIpv6Addresses.vue'
import { useToast } from '@/stores/toast'
import { useAuthStore } from '@/stores/auth'
import type { PoolCheckoutResult } from '@/types/host-pool'

const props = defineProps<{ order: PoolCheckoutResult }>()
defineEmits<{ refresh: [] }>()
const { t } = useI18n()
const toast = useToast()
const auth = useAuthStore(), route = useRoute()
const visiblePasswords = ref<Record<number, boolean>>({})
const copiedField = ref('')
let copyTimer: ReturnType<typeof setTimeout> | undefined
let active = true, disposed = false, copyGeneration = 0
function resetCopies() {
  copyGeneration++
  clearTimeout(copyTimer)
  copiedField.value = ''
  visiblePasswords.value = {}
}
watch(() => [props.order.batchId, route.fullPath, auth.user?.id, auth.token], resetCopies, { flush: 'sync' })
onActivated(() => { active = true })
onDeactivated(() => { active = false; resetCopies() })

type Instance = PoolCheckoutResult['instances'][number]
type State = 'ready' | 'creating' | 'updating' | 'unavailable' | 'failed' | 'refundPending' | 'refunded'
type Tone = 'ready' | 'pending' | 'failed' | 'neutral'

function instanceState(instance: Instance): State {
  if (instance.refunded) return 'refunded'
  if (instance.refundPending) return 'refundPending'
  if (instance.status === 'error') return 'failed'
  if (instance.status === 'creating') return 'creating'
  if (instance.publicIpUpdating) return 'updating'
  if (['running', 'stopped'].includes(instance.status) && instance.host && instance.sshPort) return 'ready'
  return 'unavailable'
}

const stateLabels: Record<State, string> = {
  ready: 'cart.ready', creating: 'cart.creating', updating: 'cart.result.addressUpdating',
  unavailable: 'cart.result.connectionUnavailable', failed: 'cart.failed',
  refundPending: 'cart.result.refunding', refunded: 'cart.refunded'
}
const stateHints: Record<State, string> = {
  ready: 'cart.connectionManual', creating: 'cart.connectionPending', updating: 'hostIpSync.customerUpdating',
  unavailable: 'cart.connectionManual', failed: 'cart.result.failedHint',
  refundPending: 'cart.refundPending', refunded: 'cart.result.refundedHint'
}
const stateTones: Record<State, Tone> = {
  ready: 'ready', creating: 'pending', updating: 'pending', unavailable: 'neutral',
  failed: 'failed', refundPending: 'pending', refunded: 'failed'
}

const entries = computed(() => props.order.instances.map(instance => {
  const state = instanceState(instance)
  return {
    instance, state, tone: stateTones[state],
    hasConnection: Boolean(instance.host && instance.sshPort),
    hasPassword: Boolean(instance.rootPassword && instance.status !== 'error'),
    hasIpv6: Boolean(instance.publicIpv6Addresses?.length || ['pending', 'failed'].includes(instance.publicIpv6Status || ''))
  }
}))
const readyCount = computed(() => entries.value.filter(entry => entry.state === 'ready').length)
const summary = computed<{ tone: Tone; title: string; hint: string }>(() => {
  if (entries.value.some(entry => entry.state === 'creating')) {
    return { tone: 'pending', title: 'cart.result.creatingTitle', hint: 'cart.result.creatingHint' }
  }
  if (entries.value.some(entry => ['failed', 'refundPending', 'refunded'].includes(entry.state))) {
    return { tone: 'failed', title: readyCount.value ? 'cart.result.partialTitle' : 'cart.result.failedTitle', hint: 'cart.result.reviewHint' }
  }
  if (entries.value.some(entry => entry.state === 'updating')) {
    return { tone: 'pending', title: 'cart.result.addressUpdating', hint: 'hostIpSync.customerUpdating' }
  }
  if (entries.value.length && readyCount.value === entries.value.length) {
    return { tone: 'ready', title: 'cart.result.readyTitle', hint: 'cart.result.readyHint' }
  }
  return { tone: 'neutral', title: 'cart.accepted', hint: entries.value.length ? 'cart.connectionManual' : 'cart.result.noInstances' }
})

function sshCommand(instance: Instance) {
  return `ssh -p ${instance.sshPort} root@${instance.host}`
}
async function copyValue(value: string, field: string) {
  clearTimeout(copyTimer)
  copiedField.value = ''
  const authentication = auth.captureAuthentication(), account = auth.user?.id, batch = props.order.batchId, path = route.fullPath
  const version = ++copyGeneration
  const current = () => active && !disposed && version === copyGeneration && !!auth.token && account === auth.user?.id &&
    batch === props.order.batchId && path === route.fullPath && authentication.aligned && authentication.current()
  if (!current()) return
  try {
    await navigator.clipboard.writeText(value)
    if (!current()) return
    copiedField.value = field
    clearTimeout(copyTimer)
    copyTimer = setTimeout(() => { if (current()) copiedField.value = '' }, 2000)
  } catch { if (current()) toast.error(t('common.copyFailed')) }
}
onUnmounted(() => { disposed = true; resetCopies() })
</script>

<template>
  <section class="order-result" aria-labelledby="order-result-title">
    <header class="order-result-header">
      <div class="order-result-summary" :data-tone="summary.tone">
        <span :key="summary.tone" class="order-result-symbol" aria-hidden="true">
          <Check v-if="summary.tone === 'ready'" :size="28" :stroke-width="1.8" class="order-result-check" />
          <Loader2 v-else-if="summary.tone === 'pending'" :size="27" :stroke-width="1.7" class="order-result-spinner" />
          <CircleAlert v-else-if="summary.tone === 'failed'" :size="27" :stroke-width="1.7" />
          <Server v-else :size="25" :stroke-width="1.6" />
        </span>
        <div class="order-result-intro" aria-live="polite" aria-atomic="true">
          <h1 id="order-result-title">{{ t(summary.title, { count: entries.length }) }}</h1>
          <p>{{ t(summary.hint) }}</p>
          <p v-if="entries.length > 1" class="order-result-count">{{ t('cart.result.completedCount', { ready: readyCount, total: entries.length }) }}</p>
        </div>
      </div>
      <RouterLink to="/purchase" class="order-result-shopping">{{ t('cart.continueShopping') }}<ArrowRight :size="15" aria-hidden="true" /></RouterLink>
    </header>

    <div class="order-result-instances">
      <article v-for="entry in entries" :key="entry.instance.id" class="order-instance" :aria-labelledby="`order-instance-${entry.instance.id}`">
        <header class="order-instance-header">
          <h2 :id="`order-instance-${entry.instance.id}`">
            <RouterLink :to="`/instances/${entry.instance.id}`" :aria-label="t('cart.result.manageInstance', { name: entry.instance.name })">
              <Server :size="19" :stroke-width="1.6" aria-hidden="true" /><span>{{ entry.instance.name }}</span><ChevronRight :size="16" aria-hidden="true" />
            </RouterLink>
          </h2>
          <span class="order-instance-state" :data-tone="entry.tone"><span aria-hidden="true" />{{ t(stateLabels[entry.state]) }}</span>
        </header>

        <div v-if="!entry.hasConnection" class="order-instance-notice" :data-tone="entry.tone">
          <CircleAlert v-if="entry.state === 'failed'" :size="20" aria-hidden="true" />
          <RefreshCw v-else-if="entry.state === 'refunded' || entry.state === 'refundPending'" :size="20" aria-hidden="true" />
          <Terminal v-else :size="20" aria-hidden="true" />
          <p>{{ t(stateHints[entry.state]) }}</p>
        </div>

        <div v-if="entry.hasConnection || entry.hasIpv6 || entry.hasPassword" class="order-connection-grid">
          <div v-if="entry.hasConnection || entry.hasIpv6" class="order-network">
            <div v-if="entry.hasConnection" class="order-address">
              <p class="order-field-label">{{ t('cart.result.ipv4') }}</p>
              <div class="order-address-value">
                <code>{{ entry.instance.host }}</code>
                <button type="button" class="order-icon-button" :aria-label="t('cart.result.copyIpv4', { name: entry.instance.name })" :title="t('common.copy')" @click="copyValue(entry.instance.host!, `ipv4-${entry.instance.id}`)">
                  <Check v-if="copiedField === `ipv4-${entry.instance.id}`" :size="16" class="order-copy-done" aria-hidden="true" /><Copy v-else :size="16" aria-hidden="true" />
                </button>
              </div>
            </div>
            <div v-if="entry.hasIpv6" class="order-ipv6">
              <p class="order-field-label">{{ t('ipv6Delivery.title') }}</p>
              <PublicIpv6Addresses :addresses="entry.instance.publicIpv6Addresses ?? []" :status="entry.instance.publicIpv6Status" />
            </div>
          </div>

          <div v-if="entry.hasConnection || entry.hasPassword" class="order-login">
            <div v-if="entry.hasConnection" class="order-ssh">
              <p class="order-field-label">{{ t('cart.result.sshCommand') }}</p>
              <div class="order-command">
                <Terminal :size="17" aria-hidden="true" />
                <code>{{ sshCommand(entry.instance) }}</code>
                <button type="button" class="order-icon-button" :aria-label="t('cart.result.copySsh', { name: entry.instance.name })" :title="t('hostInventory.sshCopy')" @click="copyValue(sshCommand(entry.instance), `ssh-${entry.instance.id}`)">
                  <Check v-if="copiedField === `ssh-${entry.instance.id}`" :size="16" class="order-copy-done" aria-hidden="true" /><Copy v-else :size="16" aria-hidden="true" />
                </button>
              </div>
              <p class="order-login-meta">{{ t('cart.result.username') }} <span>root</span><span aria-hidden="true">·</span>{{ t('cart.result.port') }} <span>{{ entry.instance.sshPort }}</span></p>
            </div>
            <div v-if="entry.hasPassword" class="order-password-field">
              <label :for="`order-password-${entry.instance.id}`" class="order-field-label">{{ t('publicSite.market.pool.credsPassword') }}</label>
              <div class="order-password">
                <input :id="`order-password-${entry.instance.id}`" :type="visiblePasswords[entry.instance.id] ? 'text' : 'password'" :value="entry.instance.rootPassword" readonly autocomplete="off" spellcheck="false" />
                <button type="button" class="order-icon-button" :aria-label="`${t(visiblePasswords[entry.instance.id] ? 'cart.hidePassword' : 'cart.showPassword')} · ${entry.instance.name}`" :aria-pressed="!!visiblePasswords[entry.instance.id]" :title="t(visiblePasswords[entry.instance.id] ? 'cart.hidePassword' : 'cart.showPassword')" @click="visiblePasswords[entry.instance.id] = !visiblePasswords[entry.instance.id]">
                  <EyeOff v-if="visiblePasswords[entry.instance.id]" :size="17" aria-hidden="true" /><Eye v-else :size="17" aria-hidden="true" />
                </button>
                <button type="button" class="order-icon-button" :aria-label="t('cart.result.copyPassword', { name: entry.instance.name })" :title="t('common.copy')" @click="copyValue(entry.instance.rootPassword!, `password-${entry.instance.id}`)">
                  <Check v-if="copiedField === `password-${entry.instance.id}`" :size="16" class="order-copy-done" aria-hidden="true" /><Copy v-else :size="16" aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </article>
    </div>

    <footer class="order-result-footer">
      <div class="order-result-actions">
        <RouterLink to="/instances" class="order-result-primary">{{ t('publicSite.market.pool.credsViewInstances') }}<ArrowRight :size="16" aria-hidden="true" /></RouterLink>
        <button type="button" class="order-result-refresh" @click="$emit('refresh')"><RefreshCw :size="15" aria-hidden="true" />{{ t('common.refresh') }}</button>
      </div>
      <div class="order-result-reference">
        <span>{{ t('cart.orderNumber') }}</span><code>{{ order.batchId }}</code>
        <button type="button" class="order-icon-button" :aria-label="t('cart.result.copyOrder')" :title="t('common.copy')" @click="copyValue(order.batchId, 'order')">
          <Check v-if="copiedField === 'order'" :size="14" class="order-copy-done" aria-hidden="true" /><Copy v-else :size="14" aria-hidden="true" />
        </button>
      </div>
    </footer>
    <span class="sr-only" role="status">{{ copiedField ? t('common.copied') : '' }}</span>
  </section>
</template>

<style scoped>
.order-result { --result-ready: #15803d; --result-pending: #92400e; --result-failed: #b91c1c; width: 100%; max-width: 980px; min-width: 0; margin-inline: auto; padding-top: 12px; color: var(--text-primary); container: order-result / inline-size; }
:global(.dark .order-result) { --result-ready: #4ade80; --result-pending: #fbbf24; --result-failed: #f87171; }
.order-result-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 28px; margin-bottom: 30px; }
.order-result-summary { display: flex; align-items: flex-start; gap: 18px; min-width: 0; }
.order-result-symbol { display: grid; place-items: center; width: 56px; height: 56px; flex-shrink: 0; border: 1px solid var(--border-color); border-radius: 50%; background: var(--bg-elevated); color: var(--text-secondary); }
[data-tone="ready"] { --state-color: var(--result-ready); }
[data-tone="pending"] { --state-color: var(--result-pending); }
[data-tone="failed"] { --state-color: var(--result-failed); }
[data-tone="neutral"] { --state-color: var(--text-secondary); }
.order-result-symbol { color: var(--state-color); }
.order-result-intro { min-width: 0; padding-top: 1px; }
.order-result-intro h1 { font-size: 28px; font-weight: 650; line-height: 1.35; letter-spacing: -0.03em; text-wrap: balance; }
.order-result-intro p { max-width: 56ch; margin-top: 7px; color: var(--text-secondary); font-size: 13px; line-height: 1.7; text-wrap: pretty; }
.order-result-intro .order-result-count { margin-top: 10px; font-size: 12px; font-weight: 550; font-variant-numeric: tabular-nums; color: var(--text-primary); }
.order-result-shopping { display: inline-flex; align-items: center; gap: 6px; min-height: 44px; flex-shrink: 0; color: var(--text-secondary); font-size: 12px; text-underline-offset: 4px; }
.order-result-shopping:hover { color: var(--text-primary); text-decoration: underline; }
.order-result-instances { display: grid; gap: 18px; }
.order-instance { min-width: 0; border: 1px solid var(--border-color); border-radius: 14px; background: var(--bg-elevated); }
.order-instance-header { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8px 16px; margin-inline: 24px; padding-block: 16px; border-bottom: 1px solid var(--border-color); }
.order-instance-header h2 { min-width: 0; flex: 1 1 200px; font-size: 16px; font-weight: 600; }
.order-instance-header h2 a { display: inline-flex; align-items: center; gap: 10px; max-width: 100%; min-height: 32px; border-radius: 4px; text-underline-offset: 4px; }
.order-instance-header h2 a:hover span { text-decoration: underline; }
.order-instance-header h2 span { min-width: 0; overflow-wrap: anywhere; }
.order-instance-header h2 svg { flex-shrink: 0; color: var(--text-secondary); }
.order-instance-header h2 svg:last-child { width: 14px; margin-left: 2px; }
.order-instance-state { display: inline-flex; align-items: center; gap: 7px; min-height: 28px; font-size: 12px; line-height: 1.6; color: var(--state-color); }
.order-instance-state > span { width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex-shrink: 0; }
.order-instance-notice { display: flex; align-items: center; gap: 12px; min-height: 114px; padding: 26px 24px; }
.order-instance-notice > svg { flex-shrink: 0; color: var(--state-color); }
.order-instance-notice p { max-width: 64ch; font-size: 13px; line-height: 1.75; color: var(--text-secondary); }
.order-connection-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.12fr); gap: 24px; padding: 24px; }
.order-network, .order-login { min-width: 0; display: flex; flex-direction: column; gap: 22px; }
.order-login { padding-left: 24px; border-left: 1px solid var(--border-color); }
.order-login:only-child { grid-column: 1 / -1; padding-left: 0; border-left: 0; }
.order-field-label { display: block; color: var(--text-secondary); font-size: 12px; line-height: 1.5; }
.order-address-value { display: flex; align-items: center; gap: 12px; margin-top: 3px; }
.order-address-value > code { min-width: 0; font-size: 21px; font-weight: 550; letter-spacing: -0.025em; line-height: 1.5; overflow-wrap: anywhere; }
.order-icon-button { display: inline-grid; place-items: center; width: 36px; height: 36px; flex-shrink: 0; border: 0; border-radius: 7px; color: var(--text-secondary); background: transparent; transition: background 150ms, color 150ms; }
.order-icon-button:hover { color: var(--text-primary); background: var(--bg-secondary); }
.order-copy-done { color: var(--result-ready); }
.order-ipv6 > .order-field-label { margin-bottom: 8px; }
.order-ipv6 :deep(li) { align-items: center; gap: 8px; }
.order-ipv6 :deep(li > div) { flex: 0 1 auto; }
.order-ipv6 :deep(code) { font-size: 12px; line-height: 1.75; }
.order-ipv6 :deep(button) { display: grid; place-items: center; width: 36px; height: 36px; padding: 0; border: 0; border-radius: 7px; color: var(--text-secondary); background: transparent; box-shadow: none; }
.order-ipv6 :deep(button:hover) { color: var(--text-primary); background: var(--bg-secondary); }
.order-command, .order-password { display: flex; align-items: center; gap: 8px; min-height: 46px; margin-top: 9px; padding: 4px 5px 4px 12px; border-radius: 8px; background: var(--bg-secondary); }
.order-command > svg { flex-shrink: 0; color: var(--text-secondary); }
.order-command code { flex: 1; min-width: 0; font-size: 12px; line-height: 1.7; overflow-wrap: anywhere; }
.order-login-meta { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; color: var(--text-secondary); font-size: 11px; font-variant-numeric: tabular-nums; }
.order-login-meta span[aria-hidden] { margin-inline: 3px; }
.order-login-meta span:not([aria-hidden]) { color: var(--text-primary); }
.order-result .order-password input { flex: 1; min-width: 0; width: 100%; margin: 0; padding: 4px 0; border: 0; border-radius: 2px; background: transparent !important; color: var(--text-primary); caret-color: var(--text-primary); box-shadow: none !important; font-family: var(--font-mono, 'JetBrains Mono Variable', monospace); font-size: 13px; line-height: 1.7; }
.order-result .order-password input:focus { outline: 1px solid var(--text-secondary); outline-offset: 2px; }
.order-password { gap: 2px; }
.order-result-footer { display: grid; gap: 22px; padding-top: 24px; }
.order-result-actions { display: flex; flex-wrap: wrap; gap: 12px; }
.order-result-primary, .order-result-refresh { display: inline-flex; justify-content: center; align-items: center; gap: 9px; min-height: 44px; padding: 11px 18px; border-radius: 10px; font-size: 13px; font-weight: 550; line-height: 1.5; transition: opacity 150ms, background 150ms; }
.order-result-primary { background: var(--text-primary); color: var(--bg-elevated); }
.order-result-primary:hover { opacity: 0.85; }
.order-result-refresh { color: var(--text-secondary); }
.order-result-refresh:hover { background: var(--bg-secondary); color: var(--text-primary); }
.order-result-reference { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 8px; padding-top: 14px; border-top: 1px solid var(--border-color); color: var(--text-secondary); font-size: 11px; }
.order-result-reference code { min-width: 0; font-size: 11px; overflow-wrap: anywhere; }
.order-result-reference .order-icon-button { width: 32px; height: 32px; }
.order-result button:focus-visible, .order-result a:focus-visible, .order-ipv6 :deep(button:focus-visible) { outline: 2px solid var(--text-secondary); outline-offset: 3px; }
.order-result ::selection { color: var(--bg-elevated); background: var(--text-primary); }
.order-result-spinner { animation: order-result-spin 1.2s linear infinite; }
.order-result-check { animation: order-result-confirm 280ms cubic-bezier(0.16, 1, 0.3, 1); }
@keyframes order-result-spin { to { transform: rotate(360deg); } }
@keyframes order-result-confirm { from { transform: scale(0.8); } to { transform: scale(1); } }
@container order-result (max-width: 680px) {
  .order-result-header { flex-direction: column; gap: 8px; margin-bottom: 20px; }
  .order-result-shopping { margin-left: 74px; }
  .order-connection-grid { grid-template-columns: minmax(0, 1fr); gap: 22px; }
  .order-login { padding: 22px 0 0; border-top: 1px solid var(--border-color); border-left: 0; }
}
@container order-result (max-width: 440px) {
  .order-result-summary { gap: 12px; }
  .order-result-symbol { width: 44px; height: 44px; }
  .order-result-intro h1 { font-size: 23px; }
  .order-result-shopping { margin-left: 56px; }
  .order-instance-header { margin-inline: 18px; padding-block: 12px; }
  .order-connection-grid { padding: 20px 18px; }
  .order-instance-notice { padding: 24px 18px; }
  .order-address-value > code { font-size: 20px; }
  .order-result-reference { column-gap: 6px; }
  .order-result-reference > span { flex-basis: 100%; }
  .order-result-reference code { flex: 1; }
}
@media (pointer: coarse) {
  .order-icon-button, .order-result-reference .order-icon-button, .order-ipv6 :deep(button) { width: 44px; height: 44px; }
}
@media (prefers-reduced-motion: reduce) {
  .order-result-spinner, .order-result-check { animation: none; }
  .order-result *, .order-result :deep(button) { transition: none !important; }
}
</style>
