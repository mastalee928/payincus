<script setup lang="ts">
/**
 * InitCommandModal - 初始化命令新增/编辑弹窗
 */
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api'
import { useToast } from '@/stores/toast'
import { useAuthStore } from '@/stores/auth'
import DistroIcon from '@/components/icons/DistroIcon.vue'

interface InitCommand {
  id: number
  name: string
  command?: string
  commandPreview?: string
  commandLineCount?: number
  distros: string[]
  description: string | null
  enabled: boolean
  createdAt: string
  updatedAt: string
}

interface Distro {
  id: string
  icon: string
}

const props = defineProps<{
  command: InitCommand | null  // null 表示新增模式
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'save'): void
}>()

const { t } = useI18n()
const toast = useToast()
const authStore = useAuthStore()
// Stale-response identity only; the server rechecks authorization on writes.
const sessionKey = computed(() => {
  const token = authStore.token
  if (!token) return ''
  let identity = token
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    if (typeof payload.sid === 'string') identity = payload.sid
  } catch { /* Legacy tokens retain their full identity. */ }
  return `${authStore.user?.id ?? ''}:${authStore.user?.role ?? ''}:${identity}`
})

// 表单数据
const form = ref({
  name: '',
  command: '',
  distros: [] as string[],
  description: ''
})

// 发行版选项
const distros = ref<Distro[]>([])
const distroOptions = computed(() => distros.value.map(d => ({ ...d, name: t(`extensions.initCommands.distroNames.${d.id}`) })))
const loadingDistros = ref(false)

// 表单状态
const saving = ref(false)
const loadingDetail = ref(false)
const saved = ref(false)
const visible = ref(true)
let requestSequence = 0
let disposed = false
let requestController: AbortController | undefined
let closeTimer: ReturnType<typeof setTimeout> | undefined

function isCurrent(sequence: number, id: number | null, session: string): boolean {
  return !disposed && visible.value && sequence === requestSequence
    && id === (props.command?.id ?? null) && session === sessionKey.value
}

function invalidate(): void {
  requestSequence++
  requestController?.abort()
  clearTimeout(closeTimer)
}

// 是否为编辑模式
const isEdit = computed(() => props.command !== null)

// 表单验证
const isValid = computed(() => {
  return form.value.name.trim().length > 0 
    && form.value.command.trim().length > 0 
    && form.value.distros.length > 0
})

// 加载发行版选项
async function loadDistros(current: () => boolean, signal: AbortSignal): Promise<void> {
  loadingDistros.value = true
  try {
    const response = await api.initCommands.getDistros(signal)
    if (!current()) return
    distros.value = response.distros
  } catch {
    if (!current()) return
    distros.value = [
      { id: 'ubuntu', icon: 'ubuntu' },
      { id: 'debian', icon: 'debian' },
      { id: 'rhel', icon: 'almalinux' },
      { id: 'alpine', icon: 'alpine' },
      { id: 'arch', icon: 'arch' },
      { id: 'suse', icon: 'opensuse' },
      { id: 'all', icon: 'linux' }
    ]
  } finally {
    if (current()) loadingDistros.value = false
  }
}

// 加载命令详情（编辑模式）
async function loadCommandDetail(id: number, current: () => boolean, signal: AbortSignal): Promise<void> {
  loadingDetail.value = true
  try {
    const response = await api.initCommands.get(id, signal)
    if (!current()) return
    const cmd = response.command
    if (cmd.id !== id) throw new Error(t('extensions.initCommands.loadDetailFailed'))
    form.value.name = cmd.name
    form.value.command = cmd.command
    form.value.distros = [...cmd.distros]
    form.value.description = cmd.description || ''
  } catch (error: unknown) {
    if (!current()) return
    toast.error(t('extensions.initCommands.loadDetailFailed') + ': ' + (error instanceof Error ? error.message : String(error)))
    close()
  } finally {
    if (current()) loadingDetail.value = false
  }
}

// 切换发行版选择
function toggleDistro(distroId: string): void {
  if (saving.value || saved.value || loadingDetail.value || loadingDistros.value || !visible.value || disposed) return
  const idx = form.value.distros.indexOf(distroId)
  if (idx >= 0) {
    form.value.distros.splice(idx, 1)
  } else {
    // 如果选择了"通用"，则取消其他所有选择
    if (distroId === 'all') {
      form.value.distros = ['all']
    } else {
      // 如果选择了具体发行版，则取消"通用"
      const allIdx = form.value.distros.indexOf('all')
      if (allIdx >= 0) {
        form.value.distros.splice(allIdx, 1)
      }
      form.value.distros.push(distroId)
    }
  }
}

// 保存
async function save(): Promise<void> {
  if (!isValid.value || saving.value || saved.value || loadingDetail.value || loadingDistros.value || !visible.value || disposed || !sessionKey.value) return
  const sequence = requestSequence, id = props.command?.id ?? null, session = sessionKey.value
  const current = () => isCurrent(sequence, id, session)
  const data = {
    name: form.value.name.trim(),
    command: form.value.command,
    distros: [...form.value.distros],
    description: form.value.description.trim()
  }
  saving.value = true
  try {
    if (id !== null) {
      await api.initCommands.update(id, { ...data, description: data.description || null })
    } else {
      await api.initCommands.create({ ...data, description: data.description || undefined })
    }
    if (!current()) return
    saved.value = true
    toast.success(t(id !== null ? 'extensions.initCommands.updateSuccess' : 'extensions.initCommands.createSuccess'))
    emit('save')
  } catch (error: unknown) {
    if (!current()) return
    const msg = id !== null
      ? t('extensions.initCommands.updateFailed') 
      : t('extensions.initCommands.createFailed')
    toast.error(msg + ': ' + (error instanceof Error ? error.message : String(error)))
  } finally {
    if (current()) saving.value = false
  }
}

// 关闭
function close(): void {
  if (saving.value || !visible.value || disposed) return
  invalidate()
  visible.value = false
  const sequence = requestSequence
  closeTimer = setTimeout(() => {
    if (!disposed && sequence === requestSequence && !visible.value) emit('close')
  }, 200)
}

watch([() => props.command?.id ?? null, sessionKey], () => {
  invalidate()
  saving.value = false
  saved.value = false
  loadingDetail.value = false
  loadingDistros.value = false
  form.value = { name: '', command: '', distros: [], description: '' }
  distros.value = []
  visible.value = true
  const sequence = requestSequence, id = props.command?.id ?? null, session = sessionKey.value
  if (!session || disposed) { close(); return }
  const controller = new AbortController()
  requestController = controller
  const current = () => isCurrent(sequence, id, session)
  void loadDistros(current, controller.signal)
  if (id !== null) void loadCommandDetail(id, current, controller.signal)
}, { immediate: true, flush: 'sync' })
onBeforeUnmount(() => {
  disposed = true
  invalidate()
})
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="visible" class="modal-overlay init-command-editor" @keydown.esc.stop="close">
        <div class="modal-backdrop" @click="close"></div>
        <div class="modal-content max-w-2xl" role="dialog" :aria-label="isEdit ? $t('extensions.initCommands.editTitle') : $t('extensions.initCommands.addTitle')" :aria-busy="saving || loadingDetail">
          <!-- 头部 -->
          <div class="modal-header">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-primary-500/15 flex items-center justify-center">
                <svg class="w-5 h-5 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <div>
                <h3 class="modal-title">
                  {{ isEdit ? $t('extensions.initCommands.editTitle') : $t('extensions.initCommands.addTitle') }}
                </h3>
                <p class="text-xs text-themed-muted mt-0.5">
                  {{ $t('extensions.initCommands.modalDesc') }}
                </p>
              </div>
            </div>
            <button type="button" :aria-label="$t('common.close')" :disabled="saving" class="shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center text-themed-muted hover:text-themed disabled:opacity-50" @click="close">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <!-- 内容 -->
          <div class="modal-body space-y-4">
            <!-- 加载中 -->
            <div v-if="loadingDetail" role="status" class="text-center py-8">
              <div class="inline-flex items-center gap-2 text-themed-muted">
                <svg class="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span>{{ $t('common.loading') }}</span>
              </div>
            </div>

            <fieldset v-else :disabled="saving || saved" class="space-y-4 min-w-0">
              <!-- 名称 -->
              <div>
                <label class="block text-xs text-themed-muted mb-1.5">
                  {{ $t('extensions.initCommands.name') }} <span class="text-red-500">*</span>
                </label>
                <input 
                  v-model="form.name" 
                  :aria-label="$t('extensions.initCommands.name')"
                  type="text" 
                  class="input" 
                  maxlength="100"
                  :placeholder="$t('extensions.initCommands.namePlaceholder')" 
                />
              </div>

              <!-- 命令内容 -->
              <div>
                <label class="block text-xs text-themed-muted mb-1.5">
                  {{ $t('extensions.initCommands.command') }} <span class="text-red-500">*</span>
                </label>
                <textarea 
                  v-model="form.command" 
                  :aria-label="$t('extensions.initCommands.command')"
                  class="input font-mono text-xs min-h-[200px] resize-y"
                  :placeholder="$t('extensions.initCommands.commandPlaceholder')"
                ></textarea>
                <p class="text-xs text-themed-faint mt-1">
                  {{ $t('extensions.initCommands.commandHint') }}
                </p>
              </div>

              <!-- 适配系统 -->
              <div>
                <label class="block text-xs text-themed-muted mb-1.5">
                  {{ $t('extensions.initCommands.distros') }} <span class="text-red-500">*</span>
                </label>
                <div class="flex flex-wrap gap-2">
                  <button
                    v-for="distro in distroOptions"
                    :key="distro.id"
                    type="button"
                    class="inline-flex min-h-[44px] items-center gap-2 px-3 py-2 text-xs rounded-lg border-2 transition-colors font-medium"
                    :disabled="loadingDistros"
                    :aria-pressed="form.distros.includes(distro.id)"
                    :class="form.distros.includes(distro.id) 
                      ? 'bg-gray-900 dark:bg-primary-500/20 border-gray-900 dark:border-primary-500 text-white dark:text-primary-300 shadow-md' 
                      : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-400 dark:hover:border-gray-500'"
                    @click="toggleDistro(distro.id)"
                  >
                    <DistroIcon :distro="distro.icon" :size="16" />
                    {{ distro.name }}
                  </button>
                </div>
                <p class="text-xs text-themed-faint mt-1">
                  {{ $t('extensions.initCommands.distrosHint') }}
                </p>
              </div>

              <!-- 备注 -->
              <div>
                <label class="block text-xs text-themed-muted mb-1.5">
                  {{ $t('extensions.initCommands.remark') }}
                </label>
                <input 
                  v-model="form.description" 
                  :aria-label="$t('extensions.initCommands.remark')"
                  type="text" 
                  class="input" 
                  maxlength="500"
                  :placeholder="$t('extensions.initCommands.remarkPlaceholder')" 
                />
              </div>
            </fieldset>
          </div>

          <!-- 底部 -->
          <div class="modal-footer">
            <button type="button" class="btn-ghost btn-sm min-h-[44px]" :disabled="saving" @click="close">
              {{ $t('common.cancel') }}
            </button>
            <button 
              type="button"
              class="btn-primary btn-sm min-h-[44px]"
              :disabled="!isValid || saving || saved || loadingDetail || loadingDistros"
              @click="save"
            >
              <svg v-if="saving" class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              {{ saving ? $t('common.saving') : (isEdit ? $t('common.save') : $t('common.create')) }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.init-command-editor :is(.text-themed-muted, .text-themed-faint) { color: var(--kawaii-muted); }
.init-command-editor .input { font-size: 1rem; }
@media (prefers-reduced-motion: reduce) {
  .init-command-editor, .init-command-editor .modal-content, .init-command-editor .animate-spin {
    animation: none !important;
    transition: none !important;
  }
}
</style>
