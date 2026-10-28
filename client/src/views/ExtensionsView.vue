<script setup lang="ts">
/**
 * ExtensionsView - 扩展管理页面
 * 
 * TAB 结构：
 * - 初始化命令：用户自定义的实例初始化命令模板
 */
import { ref, computed, watch, onBeforeUnmount } from 'vue'

import { useI18n } from 'vue-i18n'

import api from '@/api'

import { useToast } from '@/stores/toast'
import { useAuthStore } from '@/stores/auth'

import InitCommandModal from '@/components/extensions/InitCommandModal.vue'

import InitCommandDetailModal from '@/components/extensions/InitCommandDetailModal.vue'

import DistroIcon from '@/components/icons/DistroIcon.vue'

const { t } = useI18n()
const toast = useToast()
const authStore = useAuthStore()
// Only a UI response boundary; write authorization remains enforced by the backend.
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
let disposed = false
let listSequence = 0
let listController: AbortController | undefined
const pendingCommands = ref(new Map<number, symbol>())

function invalidateList(): void {
  listSequence++
  listController?.abort()
}

// 命令列表
interface InitCommand {
  id: number
  name: string
  commandPreview: string
  commandLineCount: number
  distros: string[]
  description: string | null
  enabled: boolean
  createdAt: string
  updatedAt: string
}

const commands = ref<InitCommand[]>([])

const loading = ref(false)
const loadFailed = ref(false)

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

// 分页
const currentPage = ref(1)

const pageSize = 10

const totalPages = computed(() => Math.ceil(commands.value.length / pageSize))

const paginatedCommands = computed(() => {
  const start = (currentPage.value - 1) * pageSize
  return commands.value.slice(start, start + pageSize)
})

function goToPrevPage(): void {
  if (currentPage.value > 1) currentPage.value--
}

function goToNextPage(): void {
  if (currentPage.value < totalPages.value) currentPage.value++
}

// 加载命令列表
async function loadCommands(): Promise<void> {
  invalidateList()
  const sequence = listSequence, session = sessionKey.value
  if (!session || disposed) return
  const controller = new AbortController()
  listController = controller
  const current = () => !disposed && sequence === listSequence && session === sessionKey.value
  loading.value = true
  loadFailed.value = false
  try {
    const response = await api.initCommands.list(controller.signal)
    if (!current()) return
    commands.value = response.commands
    currentPage.value = Math.min(currentPage.value, Math.max(1, totalPages.value))
  } catch {
    if (!current()) return
    loadFailed.value = true
  } finally {
    if (current()) loading.value = false
  }
}

// 新增/编辑弹窗
const showCommandModal = ref(false)

const editingCommand = ref<InitCommand | null>(null)

function openAddModal(): void {
  if (!sessionKey.value || disposed) return
  editingCommand.value = null
  showCommandModal.value = true
}

function openEditModal(cmd: InitCommand): void {
  if (pendingCommands.value.has(cmd.id) || !commands.value.includes(cmd) || !sessionKey.value || disposed) return
  editingCommand.value = cmd
  showCommandModal.value = true
}

function onModalClose(): void {
  showCommandModal.value = false
  editingCommand.value = null
}

async function onModalSave(): Promise<void> {
  onModalClose()
  await loadCommands()
}

// 详情弹窗
const showDetailModal = ref(false)

const viewingCommand = ref<InitCommand | null>(null)

function openDetailModal(cmd: InitCommand): void {
  if (!commands.value.includes(cmd) || !sessionKey.value || disposed) return
  viewingCommand.value = cmd
  showDetailModal.value = true
}

function closeDetailModal(): void {
  showDetailModal.value = false
  viewingCommand.value = null
}

// 删除命令
async function deleteCommand(cmd: InitCommand): Promise<void> {
  if (pendingCommands.value.has(cmd.id) || !commands.value.includes(cmd) || !sessionKey.value || disposed) return
  if (!confirm(t('extensions.initCommands.confirmDelete', { name: cmd.name }))) return
  const session = sessionKey.value, operation = Symbol('delete'), id = cmd.id
  pendingCommands.value.set(id, operation)
  invalidateList()
  loading.value = false
  const current = () => !disposed && session === sessionKey.value && pendingCommands.value.get(id) === operation
  try {
    await api.initCommands.delete(id)
    if (!current()) return
    commands.value = commands.value.filter(command => command.id !== id)
    toast.success(t('extensions.initCommands.deleteSuccess'))
    await loadCommands()
  } catch (error: unknown) {
    if (current()) toast.error(t('extensions.initCommands.deleteFailed') + ': ' + (error instanceof Error ? error.message : String(error)))
  } finally {
    if (current()) pendingCommands.value.delete(id)
  }
}

// 切换启用状态
async function toggleEnabled(cmd: InitCommand): Promise<void> {
  if (pendingCommands.value.has(cmd.id) || !commands.value.includes(cmd) || !sessionKey.value || disposed) return
  const id = cmd.id, enabled = !cmd.enabled, session = sessionKey.value, operation = Symbol('toggle')
  pendingCommands.value.set(id, operation)
  invalidateList()
  loading.value = false
  const current = () => !disposed && session === sessionKey.value && pendingCommands.value.get(id) === operation
  try {
    await api.initCommands.update(id, { enabled })
    if (!current()) return
    const currentCommand = commands.value.find(command => command.id === id)
    if (currentCommand) currentCommand.enabled = enabled
    toast.success(enabled ? t('extensions.initCommands.enabled') : t('extensions.initCommands.disabled'))
    await loadCommands()
  } catch (error: unknown) {
    if (current()) toast.error(t('extensions.initCommands.toggleFailed') + ': ' + (error instanceof Error ? error.message : String(error)))
  } finally {
    if (current()) pendingCommands.value.delete(id)
  }
}

// 获取发行版显示名称（使用翻译键）
function getDistroName(distro: string): string {
  const key = `extensions.initCommands.distroNames.${distro}`
  const translated = t(key)
  return translated !== key ? translated : distro
}

watch(sessionKey, () => {
  invalidateList()
  pendingCommands.value.clear()
  commands.value = []
  loading.value = false
  loadFailed.value = false
  currentPage.value = 1
  onModalClose()
  closeDetailModal()
  void loadCommands()
}, { immediate: true, flush: 'sync' })
onBeforeUnmount(() => {
  disposed = true
  invalidateList()
  pendingCommands.value.clear()
})
</script>

<template>
  <div class="kawaii-page space-y-6 animate-fade-in">
    <header class="flex flex-col gap-4 border-b border-themed pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div class="min-w-0">
        <h1 class="text-2xl font-semibold tracking-tight text-themed">{{ $t('nav.extensions') }}</h1>
        <p class="mt-1.5 text-sm text-themed-muted">{{ $t('extensions.initCommands.description') }}</p>
      </div>
    </header>
    <div class="card p-5">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <p class="text-xs text-themed-faint">{{ $t('extensions.initCommands.description') }}</p>
        <button class="btn-primary btn-sm" @click="openAddModal">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
          </svg>
          {{ $t('extensions.initCommands.add') }}
        </button>
      </div>

      <div v-if="loadFailed" role="alert" class="mb-4 flex flex-wrap items-center justify-between gap-3 text-sm">
        <p>{{ $t('extensions.initCommands.loadFailed') }}</p>
        <button type="button" class="btn-ghost min-h-[44px]" @click="loadCommands">{{ $t('common.retry') }}</button>
      </div>

      <!-- 加载中 -->
      <div v-if="loading" class="text-center py-8">
        <div class="inline-flex items-center gap-2 text-themed-muted">
          <svg class="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span>{{ $t('common.loading') }}</span>
        </div>
      </div>

      <!-- 命令列表 -->
      <div v-else-if="commands.length" class="space-y-2.5">
        <div
          v-for="cmd in paginatedCommands"
          :key="cmd.id"
          class="nimbus-lift group flex items-center justify-between gap-3 rounded-xl border border-themed bg-themed-surface p-3.5"
          :class="{ 'opacity-50': !cmd.enabled }"
        >
          <div class="flex items-center gap-3 min-w-0 flex-1">
            <!-- 图标 -->
            <div class="w-9 h-9 rounded-xl bg-themed-secondary flex items-center justify-center flex-shrink-0">
              <svg class="w-5 h-5 icon-themed" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <!-- 信息 -->
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <span class="text-sm text-themed font-medium truncate">{{ cmd.name }}</span>
                <span v-if="!cmd.enabled" class="inline-flex items-center gap-1.5 rounded-full bg-themed-secondary px-2 py-0.5 text-xs font-medium text-themed-muted">
                  <span class="h-1.5 w-1.5 rounded-full bg-current opacity-80"></span>{{ $t('extensions.initCommands.statusDisabled') }}
                </span>
              </div>
              <div class="text-xs text-themed-faint truncate mt-0.5">
                {{ cmd.commandPreview || $t('extensions.initCommands.noContent') }}
              </div>
              <div class="flex flex-wrap items-center gap-1.5 mt-1.5">
                <span 
                  v-for="distro in cmd.distros" 
                  :key="distro"
                  class="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-md bg-themed-secondary/80 text-themed-muted"
                >
                  <DistroIcon :distro="distroIcons[distro] || 'linux'" :size="14" />
                  {{ getDistroName(distro) }}
                </span>
                <span class="text-xs text-themed-faint">
                  · {{ $t('extensions.initCommands.lineCount', { count: cmd.commandLineCount }) }}
                </span>
              </div>
            </div>
          </div>
          <!-- 操作按钮 -->
          <div class="flex items-center gap-2 flex-shrink-0">
            <button 
              class="text-themed-faint hover:text-themed-secondary transition-colors"
              :title="$t('extensions.initCommands.viewDetail')"
              @click="openDetailModal(cmd)"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            </button>
            <button 
              class="text-themed-faint hover:text-themed-secondary transition-colors disabled:opacity-50"
              :title="$t('common.edit')"
              :disabled="pendingCommands.has(cmd.id)"
              @click="openEditModal(cmd)"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
            <button 
              class="transition-colors disabled:opacity-50"
              :disabled="pendingCommands.has(cmd.id)"
              :aria-busy="pendingCommands.has(cmd.id)"
              :aria-label="cmd.enabled ? $t('extensions.initCommands.clickToDisable') : $t('extensions.initCommands.clickToEnable')"
              :class="cmd.enabled ? 'text-green-500 hover:text-green-600' : 'text-themed-faint hover:text-green-500'"
              :title="cmd.enabled ? $t('extensions.initCommands.clickToDisable') : $t('extensions.initCommands.clickToEnable')"
              @click="toggleEnabled(cmd)"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path v-if="cmd.enabled" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                <path v-else stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
            <button 
              class="text-themed-faint hover:text-red-400 transition-colors disabled:opacity-50"
              :title="$t('common.delete')"
              :disabled="pendingCommands.has(cmd.id)"
              @click="deleteCommand(cmd)"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <!-- 空状态 -->
      <div v-else-if="!loadFailed" class="text-center py-12 border border-dashed border-themed rounded-xl">
        <svg class="w-12 h-12 mx-auto mb-3 text-themed-faint opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <p class="text-sm text-themed-muted mb-3">{{ $t('extensions.initCommands.empty') }}</p>
        <button class="btn-primary btn-sm" @click="openAddModal">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
          </svg>
          {{ $t('extensions.initCommands.addFirst') }}
        </button>
      </div>

      <!-- 分页 -->
      <div v-if="totalPages > 1" class="flex items-center justify-between mt-4 pt-3 border-t border-themed">
        <span class="text-xs text-themed-muted">
          {{ $t('common.pageInfo', { current: currentPage, total: totalPages, count: commands.length }) }}
        </span>
        <div class="flex items-center gap-2">
          <button class="btn-ghost btn-sm" :disabled="currentPage <= 1" @click="goToPrevPage">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
            </svg>
            {{ $t('common.prevPage') }}
          </button>
          <button class="btn-ghost btn-sm" :disabled="currentPage >= totalPages" @click="goToNextPage">
            {{ $t('common.nextPage') }}
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>

    <InitCommandModal
      v-if="showCommandModal"
      :command="editingCommand"
      @close="onModalClose"
      @save="onModalSave"
    />

    <InitCommandDetailModal
      v-if="showDetailModal && viewingCommand"
      :command="viewingCommand"
      @close="closeDetailModal"
    />
  </div>
</template>
