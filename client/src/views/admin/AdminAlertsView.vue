<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import api from '@/api/admin'
import { useToast } from '@/stores/toast'
import { systemSettingsNavigationItems } from '@/constants/adminSettings'

const route = useRoute()
const toast = useToast()
const { t } = useI18n()

interface AlertChannel {
  id: number
  name: string
  type: string
  enabled: boolean
  alertCategory?: string | null
  boundPackages: number
  configPreview: string
  createdAt: string
}

type AlertCategoryKey = 'ticket' | 'host' | 'payment' | 'instance'

const categories: Array<{ key: AlertCategoryKey; labelKey: string; descKey: string }> = [
  { key: 'ticket', labelKey: 'adminAlerts.ticket', descKey: 'adminAlerts.ticketDesc' },
  { key: 'host', labelKey: 'adminAlerts.host', descKey: 'adminAlerts.hostDesc' },
  { key: 'payment', labelKey: 'adminAlerts.payment', descKey: 'adminAlerts.paymentDesc' },
  { key: 'instance', labelKey: 'adminAlerts.instance', descKey: 'adminAlerts.instanceDesc' }
]

const loading = ref(true)
const alertChannels = ref<AlertChannel[]>([])
const showForm = ref(false)
const saving = ref(false)
const testingId = ref<number | null>(null)
const deletingId = ref<number | null>(null)
const editingId = ref<number | null>(null)
const formError = ref('')
const form = ref<{ category: AlertCategoryKey; name: string; botToken: string; chatId: string; enabled: boolean }>({
  category: 'ticket',
  name: '',
  botToken: '',
  chatId: '',
  enabled: true
})

function channelOf(key: AlertCategoryKey): AlertChannel | undefined {
  return alertChannels.value.find(channel => channel.alertCategory === key)
}

function labelKeyOf(key: AlertCategoryKey): string {
  return categories.find(item => item.key === key)?.labelKey || 'adminAlerts.ticket'
}

function statusText(channel: AlertChannel | undefined): string {
  if (!channel) return t('adminAlerts.notConfigured')
  return channel.enabled ? t('adminAlerts.enabled') : t('adminAlerts.disabled')
}

function statusClass(channel: AlertChannel | undefined): string {
  if (!channel) return 'bg-gray-500/20 text-gray-400'
  return channel.enabled ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400'
}

async function loadAlertChannels() {
  loading.value = true
  try {
    const response = await api.adminNotificationChannels.list('alert')
    alertChannels.value = response.channels || []
  } catch {
    toast.error(t('adminAlerts.loadFailed'))
  } finally {
    loading.value = false
  }
}

async function openAlertForm(key: AlertCategoryKey) {
  formError.value = ''
  const existing = channelOf(key)
  editingId.value = existing?.id ?? null
  form.value = {
    category: key,
    name: existing?.name || t(labelKeyOf(key)),
    botToken: '',
    chatId: '',
    enabled: existing?.enabled ?? true
  }
  if (existing) {
    try {
      const response = await api.adminNotificationChannels.get(existing.id)
      const channel = response.channel as { name: string; enabled: boolean; config?: Record<string, unknown> }
      const config = channel.config || {}
      form.value.name = channel.name
      form.value.enabled = channel.enabled
      form.value.chatId = typeof config.chatId === 'string' ? config.chatId : ''
      form.value.botToken = typeof config.botToken === 'string' ? config.botToken : ''
    } catch {
      toast.error(t('adminAlerts.loadFailed'))
      return
    }
  }
  showForm.value = true
}

async function saveAlertChannel() {
  formError.value = ''
  if (!form.value.name.trim() || !form.value.chatId.trim()) {
    formError.value = t('adminAlerts.fieldsRequired')
    return
  }
  if (!editingId.value && !form.value.botToken.trim()) {
    formError.value = t('adminAlerts.tokenRequired')
    return
  }

  saving.value = true
  try {
    if (editingId.value) {
      await api.adminNotificationChannels.update(editingId.value, {
        name: form.value.name,
        chatId: form.value.chatId,
        enabled: form.value.enabled,
        ...(form.value.botToken && !form.value.botToken.includes('...') ? { botToken: form.value.botToken } : {})
      })
    } else {
      await api.adminNotificationChannels.create({
        name: form.value.name,
        botToken: form.value.botToken,
        chatId: form.value.chatId,
        enabled: form.value.enabled,
        alertCategory: form.value.category
      })
    }
    toast.success(t('adminAlerts.saveSuccess'))
    showForm.value = false
    await loadAlertChannels()
  } catch (err: any) {
    formError.value = err?.message || t('adminAlerts.saveFailed')
  } finally {
    saving.value = false
  }
}

async function testAlertChannel(id: number | undefined) {
  if (!id) return
  testingId.value = id
  try {
    await api.adminNotificationChannels.test(id)
    toast.success(t('adminAlerts.testSuccess'))
  } catch (err: any) {
    toast.error(t('adminAlerts.testFailed') + (err?.message ? ': ' + err.message : ''))
  } finally {
    testingId.value = null
  }
}

async function deleteAlertChannel(id: number | undefined) {
  if (!id) return
  if (!confirm(t('adminAlerts.deleteConfirm'))) return
  deletingId.value = id
  try {
    await api.adminNotificationChannels.delete(id)
    toast.success(t('adminAlerts.deleteSuccess'))
    await loadAlertChannels()
  } catch (err: any) {
    toast.error(t('adminAlerts.deleteFailed') + (err?.message ? ': ' + err.message : ''))
  } finally {
    deletingId.value = null
  }
}

onMounted(loadAlertChannels)
</script>

<template>
  <div class="kawaii-page space-y-6 animate-fade-in">
    <div class="page-header">
      <div>
        <h1 class="page-title">{{ t('adminAlerts.title') }}</h1>
        <p class="page-description">{{ t('adminAlerts.description') }}</p>
      </div>
    </div>

    <div class="flex gap-1 overflow-x-auto border-b border-themed-border">
      <router-link
        v-for="item in systemSettingsNavigationItems"
        :key="item.path"
        :to="item.path"
        class="shrink-0 border-b-2 px-4 py-3 text-sm font-medium transition-colors duration-150"
        :class="route.path === item.path
          ? 'border-primary-500 text-primary-600 dark:text-primary-400'
          : 'border-transparent text-themed-muted hover:text-themed'"
      >
        {{ t(item.labelKey) }}
      </router-link>
    </div>

    <div class="card p-6">
      <div class="mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-themed-border pb-4">
        <div>
          <h3 class="text-sm font-semibold text-themed">{{ t('adminAlerts.cardTitle') }}</h3>
          <p class="mt-1 text-sm text-themed-muted">{{ t('adminAlerts.description') }}</p>
        </div>
      </div>

      <div v-if="loading" class="text-sm text-themed-muted">{{ t('common.loading') }}</div>

      <template v-else>
        <div class="space-y-3">
          <div
            v-for="cat in categories"
            :key="cat.key"
            class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between p-3 rounded-lg bg-themed-secondary/30 border border-themed-border"
          >
            <div class="flex-1 min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <span class="font-medium text-sm text-themed">{{ t(cat.labelKey) }}</span>
                <span class="text-xs px-1.5 py-0.5 rounded-full" :class="statusClass(channelOf(cat.key))">
                  {{ statusText(channelOf(cat.key)) }}
                </span>
              </div>
              <p class="text-xs text-themed-muted mt-0.5">{{ t(cat.descKey) }}</p>
              <p v-if="channelOf(cat.key)" class="text-xs text-themed-muted mt-0.5 font-mono">{{ channelOf(cat.key)?.configPreview }}</p>
            </div>
            <div class="flex items-center gap-2 md:ml-4">
              <template v-if="channelOf(cat.key)">
                <button
                  type="button"
                  class="text-xs text-themed-muted hover:text-themed"
                  :disabled="testingId === channelOf(cat.key)?.id"
                  @click="testAlertChannel(channelOf(cat.key)?.id)"
                >
                  {{ testingId === channelOf(cat.key)?.id ? t('common.sending') : t('adminAlerts.test') }}
                </button>
                <button type="button" class="text-xs text-themed-muted hover:text-themed" @click="openAlertForm(cat.key)">{{ t('common.edit') }}</button>
                <button
                  type="button"
                  class="text-xs text-rose-600 hover:text-rose-700 dark:text-rose-400 dark:hover:text-rose-300"
                  :disabled="deletingId === channelOf(cat.key)?.id"
                  @click="deleteAlertChannel(channelOf(cat.key)?.id)"
                >
                  {{ deletingId === channelOf(cat.key)?.id ? t('common.deleting') : t('common.delete') }}
                </button>
              </template>
              <button v-else type="button" class="btn-primary btn-sm shrink-0" @click="openAlertForm(cat.key)">{{ t('adminAlerts.configure') }}</button>
            </div>
          </div>
        </div>

        <div v-if="showForm" class="mt-4 p-4 rounded-lg border border-themed-border bg-themed-secondary/20 space-y-3">
          <h4 class="font-medium text-sm text-themed">{{ t('adminAlerts.configure') }} · {{ t(labelKeyOf(form.category)) }}</h4>
          <div v-if="formError" class="text-xs text-rose-600 dark:text-rose-400">{{ formError }}</div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div class="space-y-1">
              <label class="block text-xs text-themed-muted">{{ t('adminAlerts.formName') }} *</label>
              <input v-model="form.name" type="text" class="input" :placeholder="t('adminAlerts.formNamePlaceholder')" />
            </div>
            <div class="space-y-1">
              <label class="block text-xs text-themed-muted">Chat ID *</label>
              <input v-model="form.chatId" type="text" class="input font-mono" placeholder="-1001234567890" />
            </div>
            <div class="md:col-span-2 space-y-1">
              <label class="block text-xs text-themed-muted">Bot Token {{ editingId ? t('adminAlerts.keepToken') : '*' }}</label>
              <input v-model="form.botToken" type="password" class="input font-mono" />
            </div>
            <div class="md:col-span-2 flex items-center gap-2">
              <input :id="'alertChannelEnabled-' + form.category" v-model="form.enabled" type="checkbox" class="w-4 h-4 rounded" />
              <label :for="'alertChannelEnabled-' + form.category" class="text-sm text-themed-secondary">{{ t('adminAlerts.enable') }}</label>
            </div>
          </div>
          <div class="flex gap-2 justify-end">
            <button type="button" class="btn-secondary text-sm" @click="showForm = false">{{ t('common.cancel') }}</button>
            <button type="button" class="btn-primary text-sm" :disabled="saving" @click="saveAlertChannel">
              {{ saving ? t('common.saving') : t('common.save') }}
            </button>
          </div>
        </div>

        <div class="mt-4 p-3 rounded-lg bg-themed-secondary/30 border border-themed-border">
          <p class="text-sm text-themed-muted">{{ t('adminAlerts.botFatherHint') }}</p>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.card {
  transition: border-color 0.15s ease-out, box-shadow 0.15s ease-out;
}

@media (prefers-reduced-motion: reduce) {
  .card {
    transition: none;
  }
}
</style>
