<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Instance, InstanceWithDetails, Snapshot } from '@/types/api'

const { t } = useI18n()

interface RemainingQuota {
  port: number
  snapshot: number
}

interface Props {
  instance: Instance
  portMappingsCount: number
  snapshots: Snapshot[]
  quotaForm: {
    portLimit: number | null
    snapshotLimit: number | null
  }
  quotaSaving: boolean
  quotaError: string
  remainingQuota: RemainingQuota // 用户账户剩余额度
}

interface Emits {
  (e: 'update:quota-form', form: { portLimit: number | null; snapshotLimit: number | null }): void
  (e: 'save'): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const localForm = ref({ ...props.quotaForm })
const snapshotCount = computed(() => (props.instance as InstanceWithDetails).quota_usage?.snapshot ?? props.snapshots.length)
watch(() => props.quotaForm, value => {
  if (localForm.value.portLimit !== value.portLimit || localForm.value.snapshotLimit !== value.snapshotLimit) localForm.value = { ...value }
}, { deep: true, flush: 'sync' })

// 监听表单变化，同步到父组件
watch(localForm, (newVal) => {
  if (newVal.portLimit !== props.quotaForm.portLimit || newVal.snapshotLimit !== props.quotaForm.snapshotLimit) emit('update:quota-form', { ...newVal })
}, { deep: true, flush: 'sync' })
</script>

<template>
  <div class="space-y-4">
    <div class="card shadow-pop p-5">
      <h2 class="text-sm text-themed font-semibold mb-4">
        {{ t('instance.detail.quotaTab.title') }}
      </h2>

      <div class="space-y-4">
        <!-- NAT 端口配额 -->
        <div>
          <label class="block text-sm text-themed-muted mb-2">
            {{ t('instance.detail.quotaTab.portLimit') }}
          </label>
          <div class="flex items-center gap-2">
            <input
              v-model.number="localForm.portLimit"
              type="number"
              class="input flex-1"
              :min="Math.max(1, portMappingsCount)"
              :max="1000"
              :placeholder="t('instance.detail.quotaTab.placeholder')"
            />
          </div>
          <div class="mt-2 text-xs text-themed-muted">
            <div>{{ t('instance.detail.quotaTab.currentUsage') }}: {{ portMappingsCount }} {{ t('instance.detail.quotaTab.portMappings') }}</div>
            <div v-if="instance.port_limit !== null && instance.port_limit !== undefined">
              {{ t('instance.detail.quotaTab.quotaLimit') }}: {{ instance.port_limit }} {{ t('instance.detail.quotaTab.unit') }}
              <span :class="portMappingsCount >= instance.port_limit ? 'text-red-500' : 'text-green-500'">
                ({{ portMappingsCount >= instance.port_limit ? t('instance.detail.quotaTab.full') : `${t('instance.detail.quotaTab.remaining')} ${instance.port_limit - portMappingsCount}` }})
              </span>
            </div>
          </div>
        </div>

        <!-- 快照配额 -->
        <div>
          <label class="block text-sm text-themed-muted mb-2">
            {{ t('instance.detail.quotaTab.snapshotLimit') }}
          </label>
          <div class="flex items-center gap-2">
            <input
              v-model.number="localForm.snapshotLimit"
              type="number"
              class="input flex-1"
              :min="Math.max(0, snapshotCount)"
              :max="1000"
              :placeholder="t('instance.detail.quotaTab.placeholder')"
            />
          </div>
          <div class="mt-2 text-xs text-themed-muted">
            <div>{{ t('instance.detail.quotaTab.currentUsage') }}: {{ snapshotCount }} {{ t('instance.detail.quotaTab.snapshots') }}</div>
            <div v-if="instance.snapshot_limit !== null && instance.snapshot_limit !== undefined">
              {{ t('instance.detail.quotaTab.quotaLimit') }}: {{ instance.snapshot_limit }} {{ t('instance.detail.quotaTab.unit') }}
              <span :class="snapshotCount >= instance.snapshot_limit ? 'text-red-500' : 'text-green-500'">
                ({{ snapshotCount >= instance.snapshot_limit ? t('instance.detail.quotaTab.full') : `${t('instance.detail.quotaTab.remaining')} ${instance.snapshot_limit - snapshotCount}` }})
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- 统一保存按钮 -->
      <div class="mt-6 flex justify-end">
        <button
          :disabled="quotaSaving"
          class="btn-primary"
          @click="emit('save')"
        >
          {{ quotaSaving ? t('instance.detail.quotaTab.saving') : t('instance.detail.quotaTab.save') }}
        </button>
      </div>

      <div v-if="quotaError" class="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-500">
        {{ quotaError }}
      </div>
    </div>
  </div>
</template>

