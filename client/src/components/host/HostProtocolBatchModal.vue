<script setup lang="ts">
import { computed, nextTick, onActivated, onDeactivated, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useDialogFocus } from '@/composables/useDialogFocus'
import api from '@/api/admin'
import type { ManagedHost } from '@/types/api'

const props = defineProps<{ hosts: ManagedHost[] }>()
const emit = defineEmits<{ close: []; submitted: [ids: number[], protocol: 'tcp' | 'tcp_udp'] }>()
const { t, te } = useI18n(), auth = useAuthStore(), route = useRoute()
const dialog = ref<HTMLDialogElement | null>(null), opened = ref(false), mode = ref<'tcp' | 'tcp_udp'>('tcp'), busy = ref(false)
useDialogFocus(dialog, () => opened.value, close)
const items = ref(props.hosts.map(host => ({ id: host.id, name: host.name, region: host.regionGroup || '',
  applied: host.portProtocol?.applied, state: 'ready' as 'ready' | 'saving' | 'submitted' | 'failed', error: '' })))
const retrying = computed(() => items.value.some(item => item.state === 'failed'))
const pending = computed(() => items.value.filter(item => item.state === 'ready' || item.state === 'failed'))
const submitted = computed(() => items.value.filter(item => item.state === 'submitted').length)
let active = true, generation = 0
const originalRoute = route.fullPath
const session = auth.captureAuthentication()
const userId = auth.user?.id
const current = () => active && route.fullPath === originalRoute && session.aligned && session.current() &&
  !!auth.token && auth.user?.id === userId && auth.user?.role === 'admin'
function invalidate() { active = false; generation++; opened.value = false; dialog.value?.close(); emit('close') }
function storageChanged(event: StorageEvent) { if ((event.key === null || event.key === 'token') && !current()) invalidate() }
watch([() => auth.token, () => auth.user?.id, () => auth.user?.role, () => route.fullPath], () => { if (!current()) invalidate() }, { flush: 'sync' })
watch(mode, () => { generation++; for (const item of items.value) { item.state = 'ready'; item.error = '' } }, { flush: 'sync' })
function close() { if (!busy.value) { opened.value = false; dialog.value?.close(); emit('close') } }
function errorText(code?: string) {
  const key = `hostPoolOps.batchProtocol.errors.${code}`
  return te(key) ? t(key) : t('hostPoolOps.batchProtocol.errors.unknown')
}
async function save() {
  if (busy.value || !current() || !pending.value.length || !['tcp', 'tcp_udp'].includes(mode.value)) return
  const targets = [...pending.value], ids = targets.map(item => item.id), protocol = mode.value, revision = generation
  if (ids.length > 100 || ids.some(id => !Number.isInteger(id) || id < 1 || id > 2147483647) || new Set(ids).size !== ids.length) return
  const valid = () => current() && revision === generation
  busy.value = true
  for (const item of targets) { item.state = 'saving'; item.error = '' }
  try {
    const response = await api.hostOnboarding.setProtocols(ids, protocol)
    if (!valid()) return
    if (!Array.isArray(response?.results) || response.results.length !== ids.length ||
      new Set(response.results.map(result => result.id)).size !== ids.length ||
      response.results.some(result => !ids.includes(result.id) || typeof result.success !== 'boolean' ||
        result.success && (result.protocol?.requested !== protocol || !['pending', 'applied', 'failed'].includes(result.protocol.status)))) {
      throw new Error('Unconfirmed protocol response')
    }
    for (const item of targets) {
      const result = response.results.find(result => result.id === item.id)!
      item.state = result.success ? 'submitted' : 'failed'
      item.error = result.success ? '' : errorText(result.code)
    }
    emit('submitted', targets.filter(item => item.state === 'submitted').map(item => item.id), protocol)
  } catch {
    if (valid()) for (const item of targets) { item.state = 'failed'; item.error = errorText() }
  } finally { if (valid()) busy.value = false }
}
onMounted(async () => { window.addEventListener('storage', storageChanged); await nextTick(); if (current()) { dialog.value?.showModal(); opened.value = true } })
onDeactivated(invalidate)
onActivated(() => { if (!active) emit('close') })
onBeforeUnmount(() => { window.removeEventListener('storage', storageChanged); active = false; generation++; dialog.value?.close() })
</script>

<template>
  <Teleport to="body">
    <dialog ref="dialog" class="protocol-batch" aria-labelledby="protocol-batch-title" @cancel="busy ? $event.preventDefault() : close()">
      <form @submit.prevent="save">
        <header>
          <h2 id="protocol-batch-title">{{ t('hostPoolOps.batchProtocol.title', { count: items.length }) }}</h2>
          <p>{{ t('hostPoolOps.batchProtocol.hint') }}</p>
          <label for="batch-port-protocol">{{ t('hostInventory.protocol') }}</label>
          <select id="batch-port-protocol" v-model="mode" :disabled="busy"><option value="tcp">TCP</option><option value="tcp_udp">TCP+UDP</option></select>
          <p role="status">{{ t('hostPoolOps.batchProtocol.summary', { count: submitted, total: items.length }) }}</p>
        </header>
        <ul :aria-busy="busy">
          <li v-for="item in items" :key="item.id" :data-protocol-host="item.id">
            <div class="protocol-row"><strong>{{ item.name }}</strong><span :class="item.state === 'failed' ? 'failure' : ''">{{ t('hostPoolOps.batchProtocol.states.' + item.state) }}</span></div>
            <p>{{ t('hostPoolOps.batchProtocol.current') }}: {{ item.applied === 'tcp_udp' ? 'TCP+UDP' : item.applied === 'tcp' ? 'TCP' : '—' }}<template v-if="item.region"> · {{ item.region }}</template></p>
            <p v-if="item.error" class="failure" role="alert">{{ item.error }}</p>
          </li>
        </ul>
        <footer>
          <button type="button" :disabled="busy" @click="close">{{ t('common.close') }}</button>
          <button type="submit" class="primary" :disabled="busy || !pending.length">{{ t(busy ? 'common.submitting' : retrying ? 'hostPoolOps.batchProtocol.retry' : 'common.save') }}</button>
        </footer>
      </form>
    </dialog>
  </Teleport>
</template>

<style scoped>
.protocol-batch { width: min(640px, calc(100% - 32px)); max-height: calc(100dvh - 32px); margin: auto; padding: 24px; border: 1px solid #d4d4d4; border-radius: 12px; color: #171717; background: #fff; overflow-y: auto; }
.protocol-batch::backdrop { background: rgb(0 0 0 / .55); }
h2 { margin: 0 0 12px; font-size: 20px; font-weight: 600; }
p, li, label { font-size: 14px; line-height: 1.6; overflow-wrap: anywhere; }
p { margin: 8px 0; color: #525252; }
label { display: block; margin-top: 16px; }
select, button { min-height: 44px; border: 1px solid #a3a3a3; border-radius: 8px; padding: 8px 12px; color: inherit; background: transparent; font: inherit; font-size: 14px; }
select { width: 100%; margin-top: 6px; }
ul { margin: 16px 0; padding: 0; list-style: none; }
li { padding: 12px 0; border-top: 1px solid #e5e5e5; }
.protocol-row { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px 16px; }
strong { min-width: 0; overflow-wrap: anywhere; }
footer { display: flex; flex-wrap: wrap; justify-content: end; gap: 10px; }
.primary { background: #171717; color: #fff; border-color: #171717; }
.failure { color: #b91c1c; }
button:disabled, select:disabled { opacity: .6; cursor: default; }
button:focus-visible, select:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }
.dark .protocol-batch { color: #f5f5f5; background: #171717; border-color: #525252; }
.dark p { color: #bdbdbd; }
.dark li { border-color: #404040; }
.dark select { color-scheme: dark; }
.dark .primary { color: #171717; background: #f5f5f5; border-color: #f5f5f5; }
.dark .failure { color: #fca5a5; }
</style>
