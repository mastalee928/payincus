<script setup lang="ts">
/**
 * InitCommandDetailModal - 初始化命令详情弹窗
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

interface CommandDetail {
  id: number
  name: string
  command: string
  distros: string[]
  description: string | null
  enabled: boolean
  createdAt: string
  updatedAt: string
}

const props = defineProps<{
  command: InitCommand
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const { t } = useI18n()
const toast = useToast()
const authStore = useAuthStore()
// Stale-response identity only; access control remains on the server.
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

// 详情数据
const detail = ref<CommandDetail | null>(null)
const loading = ref(true)
const copied = ref(false)
const copying = ref(false)
const visible = ref(true)
let requestSequence = 0
let disposed = false
let requestController: AbortController | undefined
let copyTimer: ReturnType<typeof setTimeout> | undefined
let closeTimer: ReturnType<typeof setTimeout> | undefined

function invalidate(): void {
  requestSequence++
  requestController?.abort()
  clearTimeout(copyTimer)
  clearTimeout(closeTimer)
  copied.value = false
  copying.value = false
}

function isCurrent(sequence: number, id: number, session: string): boolean {
  return !disposed && visible.value && sequence === requestSequence
    && id === props.command.id && session === sessionKey.value
}

// 发行版图标映射
const distroIcons: Record<string, string> = {
  ubuntu: 'ubuntu',
  debian: 'debian',
  rhel: 'almalinux',
  alpine: 'alpine',
  arch: 'arch',
  suse: 'opensuse',
  all: 'linux'
}

// 获取发行版显示名称（使用翻译键）
function getDistroName(distro: string): string {
  const key = `extensions.initCommands.distroNames.${distro}`
  const translated = t(key)
  return translated !== key ? translated : distro
}

// 加载详情
async function loadDetail(): Promise<void> {
  invalidate()
  detail.value = null
  visible.value = true
  const sequence = requestSequence, id = props.command.id, session = sessionKey.value
  if (!session || disposed) { close(); return }
  const controller = new AbortController()
  requestController = controller
  const current = () => isCurrent(sequence, id, session)
  loading.value = true
  try {
    const response = await api.initCommands.get(id, controller.signal)
    if (!current()) return
    if (response.command.id !== id) throw new Error(t('extensions.initCommands.loadDetailFailed'))
    detail.value = response.command
  } catch (error: unknown) {
    if (!current()) return
    toast.error(t('extensions.initCommands.loadDetailFailed') + ': ' + (error instanceof Error ? error.message : String(error)))
    close()
  } finally {
    if (current()) loading.value = false
  }
}

// 复制命令内容
async function copyCommand(): Promise<void> {
  if (!detail.value?.command || loading.value || copying.value || !visible.value || disposed) return
  const sequence = requestSequence, id = detail.value.id, session = sessionKey.value
  const command = detail.value.command
  copying.value = true
  copied.value = false
  clearTimeout(copyTimer)
  try {
    await navigator.clipboard.writeText(command)
    if (!isCurrent(sequence, id, session)) return
    copied.value = true
    copyTimer = setTimeout(() => {
      if (isCurrent(sequence, id, session)) copied.value = false
    }, 2000)
  } catch {
    if (isCurrent(sequence, id, session)) toast.error(t('common.copyFailed'))
  } finally {
    if (isCurrent(sequence, id, session)) copying.value = false
  }
}

// 格式化日期
function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString()
}

// 关闭
function close(): void {
  if (!visible.value || disposed) return
  invalidate()
  visible.value = false
  detail.value = null
  const sequence = requestSequence
  closeTimer = setTimeout(() => {
    if (!disposed && sequence === requestSequence && !visible.value) emit('close')
  }, 200)
}

watch([() => props.command.id, () => props.command.updatedAt, sessionKey], () => {
  void loadDetail()
}, { immediate: true, flush: 'sync' })
onBeforeUnmount(() => {
  disposed = true
  invalidate()
})
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="visible" class="modal-overlay init-command-detail" @keydown.esc.stop="close">
        <div class="modal-backdrop" @click="close"></div>
        <div class="modal-content max-w-2xl" role="dialog" :aria-label="$t('extensions.initCommands.viewDetail')" :aria-busy="loading">
          <!-- 头部 -->
          <div class="modal-header">
            <div class="flex min-w-0 items-center gap-3">
              <div class="w-10 h-10 shrink-0 rounded-xl bg-primary-500/15 flex items-center justify-center">
                <svg class="w-5 h-5 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <div class="min-w-0">
                <h3 class="modal-title">{{ $t('extensions.initCommands.viewDetail') }}</h3>
                <p class="text-sm text-themed-muted mt-0.5 break-words">{{ detail?.name ?? command.name }}</p>
              </div>
            </div>
            <button type="button" :aria-label="$t('common.close')" class="shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center text-themed-muted hover:text-themed" @click="close">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <!-- 内容 -->
          <div class="modal-body space-y-4">
            <!-- 加载中 -->
            <div v-if="loading" role="status" class="text-center py-8">
              <div class="inline-flex items-center gap-2 text-themed-muted">
                <svg class="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span>{{ $t('common.loading') }}</span>
              </div>
            </div>

            <template v-else-if="detail">
              <!-- 基本信息 -->
              <div class="flex flex-wrap items-center gap-3 pb-3 border-b border-themed">
                <div class="flex items-center gap-2">
                  <span class="text-xs text-themed-muted">{{ $t('extensions.initCommands.status') }}:</span>
                  <span 
                    class="text-xs px-2 py-0.5 rounded"
                    :class="detail.enabled 
                      ? 'bg-green-500/15 text-green-600 dark:text-green-400' 
                      : 'bg-themed-secondary text-themed-muted'"
                  >
                    {{ detail.enabled ? $t('extensions.initCommands.statusEnabled') : $t('extensions.initCommands.statusDisabled') }}
                  </span>
                </div>
                <div class="flex items-center gap-2">
                  <span class="text-xs text-themed-muted">{{ $t('extensions.initCommands.createdAt') }}:</span>
                  <span class="text-xs text-themed-secondary">{{ formatDate(detail.createdAt) }}</span>
                </div>
              </div>

              <!-- 适配系统 -->
              <div>
                <label class="block text-xs text-themed-muted mb-2">{{ $t('extensions.initCommands.distros') }}</label>
                <div class="flex flex-wrap gap-2">
                  <span 
                    v-for="distro in detail.distros" 
                    :key="distro"
                    class="inline-flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-lg bg-themed-secondary text-themed-secondary"
                  >
                    <DistroIcon :distro="distroIcons[distro] || 'linux'" :size="16" />
                    {{ getDistroName(distro) }}
                  </span>
                </div>
              </div>

              <!-- 备注 -->
              <div v-if="detail.description">
                <label class="block text-xs text-themed-muted mb-2">{{ $t('extensions.initCommands.remark') }}</label>
                <p class="text-sm text-themed-secondary break-words">{{ detail.description }}</p>
              </div>

              <!-- 命令内容 -->
              <div>
                <div class="flex items-center justify-between mb-2">
                  <label class="text-xs text-themed-muted">{{ $t('extensions.initCommands.command') }}</label>
                  <button 
                    type="button"
                    class="btn-ghost btn-xs min-h-[44px]"
                    :disabled="copying"
                    aria-live="polite"
                    @click="copyCommand"
                  >
                    <svg v-if="copied" class="w-3.5 h-3.5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                    </svg>
                    <svg v-else class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    {{ copied ? $t('common.copied') : $t('common.copy') }}
                  </button>
                </div>
                <pre class="p-4 rounded-lg bg-themed-tertiary border border-themed font-mono text-xs text-themed-secondary overflow-x-auto whitespace-pre-wrap break-all max-h-[320px] overflow-y-auto">{{ detail.command }}</pre>
              </div>
            </template>
          </div>

          <!-- 底部 -->
          <div class="modal-footer">
            <button type="button" class="btn-ghost btn-sm min-h-[44px]" @click="close">
              {{ $t('common.close') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.init-command-detail .text-themed-muted { color: var(--kawaii-muted); }
@media (prefers-reduced-motion: reduce) {
  .init-command-detail, .init-command-detail .modal-content, .init-command-detail .animate-spin {
    animation: none !important;
    transition: none !important;
  }
}
</style>
