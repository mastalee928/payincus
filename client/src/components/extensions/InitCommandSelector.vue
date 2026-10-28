<script setup lang="ts">
/**
 * InitCommandSelector - 初始化命令选择器
 * 用于创建/重装实例时选择要应用的初始化命令
 */
import { ref, watch, computed, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api'
import { extensionsPath } from '@/utils/app-paths'
import { useAuthStore } from '@/stores/auth'

interface AvailableCommand {
  id: number
  name: string
  commandLineCount: number
  distros: string[]
  description: string | null
}

const props = defineProps<{
  distro: string  // 当前选择的发行版（镜像的 icon 字段）
  modelValue: number[]  // 选中的命令 ID 列表
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: number[]): void
}>()

const { t } = useI18n()
const manageExtensionsPath = extensionsPath()
const authStore = useAuthStore()

// 可用命令列表
const commands = ref<AvailableCommand[]>([])
const loading = ref(false)
const loaded = ref(false)
const loadFailed = ref(false)
let requestSequence = 0
let disposed = false
let requestController: AbortController | undefined
// This is only a stale-response boundary; server authorization remains authoritative.
const sessionKey = computed(() => {
  const token = authStore.token
  if (!token) return ''
  let identity = token
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    if (typeof payload.sid === 'string') identity = payload.sid
  } catch { /* Legacy/non-JWT sessions retain token identity. */ }
  return `${authStore.user?.id ?? ''}:${authStore.user?.role ?? ''}:${identity}`
})

// 展开状态
const expanded = ref(false)

// 选中的命令数量
const selectedCount = computed(() => props.modelValue.length)

// 收纳功能：默认显示前5条
const collapsedLimit = 5
const isCollapsed = ref(true)

// 显示的命令列表（确保选中的命令始终显示）
const displayedCommands = computed(() => {
  if (!isCollapsed.value || commands.value.length <= collapsedLimit) {
    return commands.value
  }
  // 收起状态：显示前5条 + 所有已选中的命令
  const topCommands = commands.value.slice(0, collapsedLimit)
  const selectedInHidden = commands.value.slice(collapsedLimit).filter(cmd => props.modelValue.includes(cmd.id))
  // 合并并去重
  const result = [...topCommands]
  for (const cmd of selectedInHidden) {
    if (!result.find(c => c.id === cmd.id)) {
      result.push(cmd)
    }
  }
  return result
})

// 是否有被隐藏的未选中命令
const hasHiddenUnselected = computed(() => {
  if (commands.value.length <= collapsedLimit) return false
  const hiddenCommands = commands.value.slice(collapsedLimit)
  return hiddenCommands.some(cmd => !props.modelValue.includes(cmd.id))
})

// 是否需要显示展开按钮（只有有未选中的被隐藏命令时才显示）
const showExpandButton = computed(() => isCollapsed.value && hasHiddenUnselected.value)

// 获取发行版显示名称（使用翻译键）
function getDistroName(distro: string): string {
  const key = `extensions.initCommands.distroNames.${distro}`
  const translated = t(key)
  // 如果翻译键存在则返回翻译值，否则返回原始值
  return translated !== key ? translated : distro
}

// 加载可用命令
async function loadCommands(): Promise<void> {
  const sequence = ++requestSequence, distro = props.distro, session = sessionKey.value
  requestController?.abort()
  commands.value = []
  loaded.value = false
  loadFailed.value = false
  loading.value = false
  if (!distro || !session || disposed) return
  const controller = new AbortController()
  requestController = controller
  const current = () => !disposed && sequence === requestSequence && distro === props.distro && session === sessionKey.value
  loading.value = true
  try {
    const response = await api.initCommands.getAvailable(distro, controller.signal)
    if (!current()) return
    commands.value = response.commands
    loaded.value = true
    
    // 如果之前有选中的命令，检查是否仍然可用
    if (props.modelValue.length > 0) {
      const availableIds = new Set(commands.value.map(c => c.id))
      const validIds = props.modelValue.filter(id => availableIds.has(id))
      if (validIds.length !== props.modelValue.length) {
        emit('update:modelValue', validIds)
      }
    }
  } catch {
    if (!current()) return
    commands.value = []
    loadFailed.value = true
    emit('update:modelValue', [])
  } finally {
    if (current()) loading.value = false
  }
}

// 切换命令选择
function toggleCommand(cmdId: number): void {
  if (loading.value || !loaded.value || loadFailed.value || !commands.value.some(cmd => cmd.id === cmdId)) return
  const newValue = [...props.modelValue]
  const idx = newValue.indexOf(cmdId)
  if (idx >= 0) {
    newValue.splice(idx, 1)
  } else {
    newValue.push(cmdId)
  }
  emit('update:modelValue', newValue)
}

// 监听发行版变化，重新加载命令
watch([() => props.distro, sessionKey], (_current, previous) => {
  // 重置收纳状态
  isCollapsed.value = true
  
  // Never submit selections from the previous distro/session while the next list loads.
  if (previous?.[0] !== undefined || !props.distro || !sessionKey.value) emit('update:modelValue', [])
  void loadCommands()
}, { immediate: true, flush: 'sync' })
onBeforeUnmount(() => { disposed = true; requestSequence++; requestController?.abort() })
</script>

<template>
  <div v-if="distro" class="init-command-selector space-y-2">
    <!-- 标题栏 -->
    <button
      type="button"
      :aria-expanded="expanded"
      class="w-full text-left flex items-center justify-between p-3 bg-themed-tertiary border border-themed rounded-lg cursor-pointer hover:border-themed-secondary transition-colors"
      @click="expanded = !expanded"
    >
      <span class="flex items-center gap-2">
        <svg class="w-4 h-4 icon-themed" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <span class="text-sm text-themed-secondary">{{ $t('extensions.initCommands.selectTitle') }}</span>
        <span v-if="selectedCount > 0" class="text-xs px-1.5 py-0.5 rounded bg-primary-500/15 text-primary-600 dark:text-primary-400">
          {{ selectedCount }}
        </span>
        <span class="text-xs text-themed-faint">{{ $t('extensions.initCommands.optional') }}</span>
      </span>
      <svg 
        class="w-4 h-4 text-themed-muted transition-transform" 
        :class="{ 'rotate-180': expanded }"
        fill="none" 
        stroke="currentColor" 
        viewBox="0 0 24 24"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
      </svg>
    </button>

    <!-- 命令列表 -->
    <Transition name="expand">
      <div v-if="expanded" class="space-y-2">
        <!-- 加载中 -->
        <div v-if="loading" class="text-center py-4">
          <div class="inline-flex items-center gap-2 text-themed-muted text-sm">
            <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span>{{ $t('common.loading') }}</span>
          </div>
        </div>

        <div v-else-if="loadFailed" class="text-center py-4" role="alert">
          <p class="text-sm text-themed-secondary">{{ $t('extensions.initCommands.availableLoadFailed') }}</p>
          <button type="button" class="px-3 min-h-11 text-sm underline underline-offset-4" @click="loadCommands">
            {{ $t('common.retry') }}
          </button>
        </div>

        <!-- 命令列表 -->
        <template v-else-if="commands.length > 0">
          <label 
            v-for="cmd in displayedCommands" 
            :key="cmd.id"
            class="flex items-start gap-3 p-3 bg-themed-tertiary border border-themed rounded-lg cursor-pointer hover:border-themed-secondary transition-colors"
            :class="{ 'border-primary-500/50 bg-primary-500/5': modelValue.includes(cmd.id) }"
          >
            <input 
              type="checkbox" 
              class="mt-0.5 rounded border-themed text-primary-500 focus:ring-primary-500"
              :checked="modelValue.includes(cmd.id)"
              @change="toggleCommand(cmd.id)"
            />
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-sm text-themed-secondary font-medium">{{ cmd.name }}</span>
                <span class="text-xs text-themed-faint">
                  {{ $t('extensions.initCommands.lineCount', { count: cmd.commandLineCount }) }}
                </span>
              </div>
              <div v-if="cmd.description" class="text-xs text-themed-muted mt-0.5 truncate">
                {{ cmd.description }}
              </div>
              <div class="flex flex-wrap items-center gap-1 mt-1">
                <span 
                  v-for="d in cmd.distros" 
                  :key="d"
                  class="text-xs px-1.5 py-0.5 rounded bg-themed-secondary text-themed-faint"
                >
                  {{ getDistroName(d) }}
                </span>
              </div>
            </div>
          </label>
          
          <!-- 展开/收起按钮 -->
          <button
            v-if="showExpandButton || (!isCollapsed && commands.length > collapsedLimit)"
            type="button"
            class="w-full min-h-11 py-2 text-xs text-themed-muted hover:text-themed-secondary transition-colors flex items-center justify-center gap-1"
            @click="isCollapsed = !isCollapsed"
          >
            <span v-if="isCollapsed">{{ $t('extensions.initCommands.showAll', { count: commands.length }) }}</span>
            <span v-else>{{ $t('extensions.initCommands.collapse') }}</span>
            <svg 
              class="w-3.5 h-3.5 transition-transform" 
              :class="{ 'rotate-180': !isCollapsed }"
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </template>

        <!-- 空状态 -->
        <div v-else-if="loaded" class="text-center py-4">
          <p class="text-sm text-themed-muted">{{ $t('extensions.initCommands.noAvailable') }}</p>
          <router-link 
            v-if="manageExtensionsPath"
            :to="manageExtensionsPath"
            class="text-xs text-primary-500 hover:text-primary-600 dark:hover:text-primary-400 mt-1 inline-block"
          >
            {{ $t('extensions.initCommands.goToManage') }} →
          </router-link>
        </div>

        <!-- 提示 -->
        <div v-if="commands.length > 0" class="flex items-start gap-2 px-3 py-2 text-xs text-themed-faint">
          <svg class="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>{{ $t('extensions.initCommands.selectHint') }}</span>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.init-command-selector :is(.text-themed-faint, .text-themed-muted) {
  color: var(--kawaii-muted) !important;
}

.expand-enter-active,
.expand-leave-active {
  transition: all 0.2s ease;
  overflow: hidden;
}

.expand-enter-from,
.expand-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

@media (prefers-reduced-motion: reduce) {
  .expand-enter-active,
  .expand-leave-active {
    transition: none;
  }
}
</style>
