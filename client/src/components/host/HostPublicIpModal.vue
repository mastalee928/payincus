<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api/admin'
import type { HostPublicIpSettings, HostPublicIpSync } from '@/types/host-pool'

const props = defineProps<{ hostId: number; hostName: string }>()
const emit = defineEmits<{ close: []; changed: [] }>()
const { t, te, locale } = useI18n()
const report = ref<HostPublicIpSync | null>(null)
const form = ref<HostPublicIpSettings>({ mode: 'auto', publicIp: null, bindIp: null, sshPort: 22 })
const busy = ref(false)
const error = ref('')
const date = (value: string | null) => value ? new Date(value).toLocaleString(locale.value) : '—'
function errorText(code: string) { return te('hostIpSync.errors.' + code) ? t('hostIpSync.errors.' + code) : t('hostIpSync.errors.IP_CHECK_FAILED') }
async function load() {
  busy.value = true
  try { report.value = await api.hostOnboarding.getPublicIp(props.hostId); form.value = { ...report.value.settings } }
  catch { error.value = t('hostIpSync.loadFailed') }
  finally { busy.value = false }
}
async function sync() {
  if (busy.value) return
  busy.value = true; error.value = ''
  try {
    report.value = await api.hostOnboarding.syncPublicIp(props.hostId, {
      ...form.value, publicIp: form.value.publicIp?.trim() || null, bindIp: form.value.bindIp?.trim() || null
    })
    emit('changed')
  } catch (value) {
    const data = (value as { response?: { data?: { code?: string } } })?.response?.data
    error.value = errorText(data?.code || 'IP_CHECK_FAILED')
  } finally { busy.value = false }
}
function close() { if (!busy.value) emit('close') }
onMounted(() => void load())
</script>

<template>
  <Teleport to="body">
    <div class="modal-overlay" @keydown.esc="close">
      <div class="modal-backdrop" @click="close"></div>
      <form class="modal-content max-w-xl max-h-[90dvh] flex flex-col overflow-hidden" role="dialog" aria-modal="true" aria-labelledby="host-public-ip-title" @submit.prevent="sync">
        <div class="modal-header"><h2 id="host-public-ip-title" class="modal-title">{{ t('hostIpSync.title') }} · {{ hostName }}</h2></div>
        <div class="modal-body min-h-0 overflow-y-auto space-y-4">
          <p class="text-sm text-themed-muted">{{ t('hostIpSync.description') }}</p>
          <dl v-if="report" class="text-sm space-y-2">
            <div class="flex flex-wrap justify-between gap-2"><dt class="text-themed-muted">{{ t('hostIpSync.current') }}</dt><dd class="font-mono text-themed">{{ report.currentIp || '—' }}</dd></div>
            <div v-if="report.candidateIp && report.candidateIp !== report.currentIp" class="flex flex-wrap justify-between gap-2"><dt class="text-themed-muted">{{ t('hostIpSync.detected') }}</dt><dd class="font-mono text-themed">{{ report.candidateIp }}</dd></div>
            <div class="flex flex-wrap justify-between gap-2"><dt class="text-themed-muted">{{ t('hostIpSync.checked') }}</dt><dd class="text-themed">{{ date(report.checkedAt) }}</dd></div>
          </dl>
          <p v-if="report && !busy" class="text-sm font-medium" :class="report.status === 'synced' ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'" role="status">{{ t('hostIpSync.status.' + report.status) }}</p>
          <p v-if="report?.blocked" class="text-sm text-amber-600 dark:text-amber-400">{{ t('hostIpSync.blocked') }}</p>
          <p v-if="report?.error" class="text-sm text-themed">{{ errorText(report.error) }}</p>
          <label class="block text-sm text-themed">{{ t('hostIpSync.mode') }}
            <select v-model="form.mode" class="input mt-1 w-full" :disabled="busy"><option value="auto">{{ t('hostIpSync.auto') }}</option><option value="manual">{{ t('hostIpSync.manual') }}</option></select>
          </label>
          <label v-if="form.mode === 'manual'" class="block text-sm text-themed">{{ t('hostIpSync.newIp') }}
            <input v-model="form.publicIp" class="input mt-1 w-full font-mono" required maxlength="15" :disabled="busy" placeholder="IPv4" />
          </label>
          <details class="text-sm text-themed-muted">
            <summary class="cursor-pointer">{{ t('hostIpSync.advanced') }}</summary>
            <div class="mt-3 space-y-3">
              <label class="block">{{ t('hostIpSync.bindIp') }}<input v-model="form.bindIp" class="input mt-1 w-full font-mono" maxlength="15" :disabled="busy" :placeholder="report?.candidateBindIp || report?.currentBindIp || t('hostIpSync.auto')" /></label>
              <p v-if="report?.bindAddresses.length" class="break-all">{{ t('hostIpSync.localAddresses') }}: {{ report.bindAddresses.join(', ') }}</p>
              <label class="block">{{ t('hostIpSync.sshPort') }}<input v-model.number="form.sshPort" class="input mt-1 w-full" type="number" required min="1" max="65535" :disabled="busy" /></label>
              <p>{{ t('hostIpSync.sshHint') }}</p>
            </div>
          </details>
          <p v-if="busy" class="text-sm text-themed" role="status">{{ t('hostIpSync.checking') }}</p>
          <p v-if="error" class="text-sm text-red-600 dark:text-red-400" role="alert">{{ error }}</p>
        </div>
        <div class="modal-footer flex-wrap gap-2">
          <button type="button" class="btn-secondary" :disabled="busy" @click="close">{{ t('common.close') }}</button>
          <button type="submit" class="btn-primary" :disabled="busy || !report?.supported">{{ t('hostIpSync.sync') }}</button>
        </div>
      </form>
    </div>
  </Teleport>
</template>
