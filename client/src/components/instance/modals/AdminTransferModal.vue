<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api/admin'
import { useToast } from '@/stores/toast'
import { translateError } from '@/utils/errorHandler'
import SensitiveVerificationModal from '@/components/SensitiveVerificationModal.vue'
import type { AdminInstancePushPreview, AdminInstancePushTarget } from '@/types/instance-push'

const props = defineProps<{ show: boolean; instance: { id: number; name: string } }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'success'): void }>()
const { t } = useI18n()
const toast = useToast()
const report = ref<AdminInstancePushPreview | null>(null)
const loading = ref(false)
const error = ref('')
const targetUsername = ref('')
const target = ref<AdminInstancePushTarget | null>(null)
const searching = ref(false)
const submitting = ref(false)
const acknowledge = ref(false)
const remark = ref('')
const showVerification = ref(false)
let revision = 0

const canSubmit = computed(() => Boolean(report.value?.canCreate && target.value && acknowledge.value &&
  target.value.username === targetUsername.value.trim() && !loading.value && !searching.value && !submitting.value))

async function load() {
  const current = ++revision
  report.value = null
  target.value = null
  targetUsername.value = ''
  acknowledge.value = false
  remark.value = ''
  error.value = ''
  showVerification.value = false
  searching.value = false
  loading.value = false
  if (!props.show) return
  loading.value = true
  try {
    const result = await api.adminInstancePush.preview(props.instance.id)
    if (current === revision) report.value = result
  } catch (err) {
    if (current === revision) error.value = translateError(err)
  } finally { if (current === revision) loading.value = false }
}
watch(() => [props.show, props.instance.id], load, { immediate: true })
watch(targetUsername, () => { target.value = null; acknowledge.value = false; error.value = '' })

async function searchTarget() {
  const username = targetUsername.value.trim()
  if (username.length < 2 || searching.value || submitting.value || !report.value?.canCreate) return
  const current = revision
  searching.value = true
  error.value = ''
  target.value = null
  try {
    const result = await api.adminInstancePush.target(props.instance.id, username)
    if (current === revision && targetUsername.value.trim() === username) target.value = result.user
  } catch (err) {
    if (current === revision && targetUsername.value.trim() === username) error.value = translateError(err)
  } finally { if (current === revision) searching.value = false }
}

async function submit() {
  if (!canSubmit.value || !report.value || !target.value) return
  submitting.value = true
  error.value = ''
  try {
    await api.adminInstancePush.create(props.instance.id, {
      targetUsername: target.value.username, expectedOwnerId: report.value.owner.id, expectedFee: report.value.fee,
      acknowledge: acknowledge.value, remark: remark.value.trim() || undefined
    })
    toast.success(t('admin.instancePush.created'))
    emit('success')
    emit('close')
  } catch (err: any) {
    if (err?.code === 'VERIFICATION_REQUIRED') showVerification.value = true
    else error.value = translateError(err)
  } finally { submitting.value = false }
}
function verified() { showVerification.value = false; void submit() }
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="modal-overlay" @click.self="!submitting && emit('close')">
      <div class="modal-backdrop" aria-hidden="true" @click="!submitting && emit('close')" />
      <section class="modal-content admin-push-content" role="dialog" aria-modal="true" aria-labelledby="admin-push-title">
        <header class="modal-header shrink-0">
          <h3 id="admin-push-title" class="modal-title">{{ t('admin.instancePush.title') }} · {{ instance.name }}</h3>
        </header>
        <div class="modal-body min-h-0 overflow-y-auto space-y-4">
          <p class="text-sm text-themed-muted">{{ t('admin.instancePush.description') }}</p>
          <p v-if="loading" class="text-sm text-themed-muted">{{ t('common.loading') }}</p>
          <template v-if="report">
            <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-lg border border-themed p-3 text-sm">
              <dt class="text-themed-muted">{{ t('admin.instancePush.source') }}</dt>
              <dd class="min-w-0 break-words font-medium text-themed">{{ report.owner.username }} (#{{ report.owner.id }})</dd>
              <dt class="text-themed-muted">{{ t('admin.instancePush.address') }}</dt><dd class="break-all font-mono">{{ report.instance.ip || '—' }}</dd>
              <dt class="text-themed-muted">{{ t('admin.instancePush.fee') }}</dt><dd class="font-mono">¥{{ report.fee.toFixed(2) }}</dd>
              <dt class="text-themed-muted">{{ t('admin.instancePush.balance') }}</dt><dd class="font-mono">¥{{ report.owner.balance.toFixed(2) }}</dd>
            </dl>
            <div v-if="report.pending" class="rounded-lg border border-amber-500/30 p-3 text-sm text-amber-600 dark:text-amber-400">
              {{ t('admin.instancePush.pending', { username: report.pending.toUser.username, id: report.pending.id }) }}
            </div>
            <p v-else-if="!report.canCreate" class="text-sm text-amber-600 dark:text-amber-400">{{ report.reason }}</p>
            <form v-else class="space-y-4" @submit.prevent="submit">
              <div>
                <label for="admin-push-target" class="mb-1 block text-sm font-medium">{{ t('admin.instancePush.target') }}</label>
                <div class="flex gap-2">
                  <input
                    id="admin-push-target" v-model="targetUsername" class="input min-w-0 flex-1" maxlength="64" autocomplete="off"
                    :disabled="submitting" :placeholder="t('admin.instancePush.targetPlaceholder')" @keydown.enter.prevent="searchTarget"
                  />
                  <button type="button" class="btn-secondary shrink-0" :disabled="searching || submitting || targetUsername.trim().length < 2" @click="searchTarget">
                    {{ searching ? t('common.loading') : t('admin.instancePush.search') }}
                  </button>
                </div>
                <p v-if="target" class="mt-2 text-sm text-green-600 dark:text-green-400">{{ t('admin.instancePush.selected', { username: target.username, id: target.id }) }}</p>
              </div>
              <label class="block text-sm font-medium">{{ t('admin.instancePush.remark') }}
                <textarea v-model="remark" class="input mt-1 w-full" maxlength="200" rows="2" :disabled="submitting" />
              </label>
              <div class="space-y-2 rounded-lg border border-themed p-3 text-xs leading-relaxed text-themed-muted">
                <p>{{ t(report.instance.dedicatedIpv4 ? 'admin.instancePush.dedicatedHint' : 'admin.instancePush.sharedHint') }}</p>
                <p>{{ t('admin.instancePush.cleanupHint') }}</p>
                <p>{{ t('admin.instancePush.renewHint') }}</p>
              </div>
              <label class="flex items-start gap-2 text-sm">
                <input v-model="acknowledge" type="checkbox" class="mt-1" :disabled="submitting || !target" />
                <span>{{ t('admin.instancePush.confirm', { amount: report.fee.toFixed(2) }) }}</span>
              </label>
            </form>
          </template>
          <p v-if="error" role="alert" class="text-sm text-red-600 dark:text-red-400">{{ error }}</p>
        </div>
        <footer class="modal-footer shrink-0 flex justify-end gap-2">
          <button type="button" class="btn-secondary" :disabled="submitting" @click="emit('close')">{{ t('common.close') }}</button>
          <button v-if="report?.canCreate" type="button" class="btn-primary" :disabled="!canSubmit" @click="submit">
            {{ submitting ? t('common.loading') : t('admin.instancePush.submit') }}
          </button>
          <button v-else-if="!loading" type="button" class="btn-secondary" @click="load">{{ t('common.refresh') }}</button>
        </footer>
      </section>
    </div>
  </Teleport>
  <SensitiveVerificationModal
    :show="showVerification" operation-type="transfer_instance" :resource-id="instance.id"
    @close="showVerification = false" @verified="verified"
  />
</template>

<style scoped>
.admin-push-content {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 36rem;
  overflow: hidden;
}
</style>
