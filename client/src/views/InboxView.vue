<script setup lang="ts">
import { ref, computed, onMounted, onActivated, onDeactivated, onBeforeUnmount, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { useThemeStore } from '@/stores/theme'
import { useInboxStore } from '@/stores/inbox'
import { useToast } from '@/stores/toast'
import { useAuthStore } from '@/stores/auth'
import { formatRelativeTime } from '@/utils/formatters'
import {
  getMessageCategory,
  getCategoryColorClass,
  getMessageRoute,
  canNavigate,
  getAllCategories,
  type MessageCategory
} from '@/utils/inboxHelper'
import type { InboxMessage } from '@/types/api'
import api from '@/api'
import { useReveal } from '@/composables/useReveal'

const revealRoot = ref<HTMLElement | null>(null)
useReveal(revealRoot)

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const themeStore = useThemeStore()
const inboxStore = useInboxStore()
const toast = useToast()
const authStore = useAuthStore()

// 消息列表
const messages = ref<InboxMessage[]>([])
const loading = ref(false)
const loaded = ref(false)
const readError = ref(false), actionError = ref(false), mutating = ref(false), active = ref(false)
let alive = true, generation = 0, viewGeneration = 0, readSequence = 0
let currentMutation: (() => boolean) | undefined

// 分页
const currentPage = ref(1)
const pageSize = ref(20)
const total = ref(0)
const totalPages = computed(() => Math.ceil(total.value / pageSize.value))

// 筛选
const filter = ref<'all' | 'unread'>('all')
const categoryFilter = ref<MessageCategory | 'all'>('all')
const session = computed(() => {
  if (!authStore.user || !authStore.token || !Number.isSafeInteger(authStore.user.id) || authStore.user.id < 1) return ''
  let identity = authStore.token
  try {
    const payload = JSON.parse(atob(identity.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    if (typeof payload.sid === 'string' && payload.sid) identity = payload.sid
  } catch { /* Legacy tokens keep their full identity. */ }
  return `${authStore.user.id}:${authStore.user.role}:${identity}`
})
const available = computed(() => alive && active.value && !!session.value && ['/inbox', '/admin/inbox'].includes(route.path))
const actionsDisabled = computed(() => !available.value || !loaded.value || loading.value || readError.value || mutating.value)
function context() {
  const identity = session.value, version = generation, revision = viewGeneration, path = route.path
  const page = currentPage.value, selectedFilter = filter.value, userId = authStore.user!.id
  return { userId, page, selectedFilter, sessionCurrent: () => available.value && identity === session.value && version === generation,
    current: () => available.value && identity === session.value && version === generation &&
    revision === viewGeneration && path === route.path && page === currentPage.value && selectedFilter === filter.value }
}
function invalidateView() {
  viewGeneration++; readSequence++; messages.value = []; total.value = 0
  loaded.value = false; loading.value = false; readError.value = false; actionError.value = false
}
function invalidateContext() { generation++; invalidateView(); currentPage.value = 1; filter.value = 'all'; categoryFilter.value = 'all' }
watch([session, () => route.path], () => { invalidateContext(); if (available.value) void loadMessages() }, { flush: 'sync' })
watch([currentPage, filter], invalidateView, { flush: 'sync' })
function activate() { if (!alive || active.value) return; active.value = true; if (available.value) void loadMessages() }
onMounted(activate)
onActivated(activate)
onDeactivated(() => { active.value = false; invalidateContext() })
onBeforeUnmount(() => { alive = false; active.value = false; invalidateContext() })

// 所有类别（根据用户配额过滤）
const allCategories = getAllCategories()

// 根据用户配额过滤显示的类别
const categories = computed(() => {
  const quota = authStore.quota
  return allCategories.filter(cat => {
    // 好友功能已禁用，隐藏好友分类
    if (cat.key === 'social') {
      return false
    }
    // 如果套餐配额为0，隐藏套餐分类
    if (cat.key === 'package' && quota?.packageLimit === 0) {
      return false
    }
    // 如果套餐配额和节点配额都为0，隐藏配额分类（没有配额警告的意义）
    if (cat.key === 'quota' && quota?.packageLimit === 0 && quota?.hostLimit === 0) {
      return false
    }
    return true
  })
})

// 根据类别筛选后的消息
const filteredMessages = computed(() => {
  if (categoryFilter.value === 'all') return messages.value
  return messages.value.filter(m => getMessageCategory(m.eventType) === categoryFilter.value)
})

// 加载消息列表
async function loadMessages() {
  if (!available.value || currentMutation?.() || !Number.isSafeInteger(currentPage.value) || currentPage.value < 1 ||
    !Number.isSafeInteger(pageSize.value) || pageSize.value < 1 || pageSize.value > 100) return
  const target = context(), size = pageSize.value, sequence = ++readSequence
  const current = () => target.current() && sequence === readSequence && size === pageSize.value
  loading.value = true
  readError.value = false
  try {
    const res = await api.inbox.list({
      page: target.page,
      pageSize: size,
      isRead: target.selectedFilter === 'unread' ? false : undefined
    })
    if (!current()) return
    if (!res || res.page !== target.page || res.pageSize !== size || !Number.isSafeInteger(res.total) || res.total < 0 ||
      res.totalPages !== Math.ceil(res.total / size) || !Array.isArray(res.messages) || res.messages.length > size ||
      !res.messages.every(message => validMessage(message, target.userId) && (target.selectedFilter !== 'unread' || !message.isRead)) ||
      new Set(res.messages.map(message => message.id)).size !== res.messages.length || (res.total === 0 && res.messages.length > 0)) throw Error('Invalid inbox response')
    if (target.page > Math.max(1, res.totalPages)) {
      currentPage.value = Math.max(1, res.totalPages)
      await loadMessages()
      return
    }
    messages.value = res.messages.map(message => ({ ...message }))
    total.value = res.total
    loaded.value = true
  } catch {
    if (current()) readError.value = true
  } finally {
    if (current()) loading.value = false
  }
}
function validMessage(value: unknown, userId: number): value is InboxMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const message = value as InboxMessage
  return Number.isSafeInteger(message.id) && message.id > 0 && message.userId === userId && typeof message.isRead === 'boolean' &&
    typeof message.eventType === 'string' && typeof message.title === 'string' && typeof message.content === 'string' &&
    typeof message.createdAt === 'string' && Number.isFinite(Date.parse(message.createdAt)) &&
    (message.data === null || typeof message.data === 'object' && !Array.isArray(message.data))
}
async function mutate(operation: () => Promise<{ success: boolean; count?: number }>, apply: () => void, counted = false) {
  if (actionsDisabled.value) return false
  const target = context()
  mutating.value = true; currentMutation = target.current; actionError.value = false
  readSequence++; loading.value = false
  try {
    const response = await operation()
    if (!target.current()) return false
    if (!response || response.success !== true || counted && (!Number.isSafeInteger(response.count) || response.count! < 0)) throw Error('Invalid inbox mutation response')
    apply()
    loaded.value = false
    return true
  } catch {
    if (target.current()) actionError.value = true
    return false
  } finally {
    mutating.value = false; currentMutation = undefined
    if (available.value && !loading.value && (!loaded.value || target.sessionCurrent())) void loadMessages()
  }
}

// 标记单条已读
async function markAsRead(message: InboxMessage) {
  if (actionsDisabled.value || !messages.value.some(item => item.id === message.id)) return false
  if (message.isRead) return true
  const id = message.id
  return mutate(() => api.inbox.markAsRead(id), () => {
    messages.value.forEach(item => { if (item.id === id) item.isRead = true })
    if (filter.value === 'unread') {
      messages.value = messages.value.filter(item => item.id !== id)
      total.value = Math.max(0, total.value - 1)
      const page = Math.min(currentPage.value, Math.max(1, totalPages.value))
      if (page !== currentPage.value) currentPage.value = page
    }
    inboxStore.decrementUnread()
  })
}

// 全部标记已读
async function markAllAsRead() {
  await mutate(() => api.inbox.markAllAsRead(), () => {
    messages.value.forEach(m => m.isRead = true)
    if (filter.value === 'unread') { messages.value = []; total.value = 0; currentPage.value = 1 }
    inboxStore.clearUnread()
    toast.success(t('inbox.markedAllRead'))
  }, true)
}

// 删除单条消息
async function deleteMessage(message: InboxMessage) {
  if (actionsDisabled.value || !messages.value.some(item => item.id === message.id)) return
  const target = context(), id = message.id, wasUnread = !message.isRead
  if (!confirm(t('inbox.deleteConfirm'))) return
  if (!target.current()) return
  await mutate(() => api.inbox.delete(id), () => {
    messages.value = messages.value.filter(m => m.id !== id)
    total.value = Math.max(0, total.value - 1)
    const page = Math.min(currentPage.value, Math.max(1, totalPages.value))
    if (page !== currentPage.value) currentPage.value = page
    if (wasUnread) inboxStore.decrementUnread()
    toast.success(t('inbox.deleted'))
  })
}

// 清空已读
async function deleteReadMessages() {
  if (actionsDisabled.value) return
  const target = context()
  if (!confirm(t('inbox.clearConfirm'))) return
  if (!target.current()) return
  await mutate(() => api.inbox.deleteRead(), () => {
    toast.success(t('inbox.cleared'))
  }, true)
}

// 切换筛选
function setFilter(newFilter: 'all' | 'unread') {
  if (!available.value || !['all', 'unread'].includes(newFilter) || newFilter === filter.value) return
  filter.value = newFilter
  currentPage.value = 1
  loadMessages()
}

// 切换类别筛选
function setCategoryFilter(category: MessageCategory | 'all') {
  categoryFilter.value = category
}

// 点击消息 - 标记已读并跳转
async function handleMessageClick(message: InboxMessage) {
  if (actionsDisabled.value) return
  const target = context()
  const marked = await markAsRead(message)
  if (!target.sessionCurrent() || !marked && !target.current()) return
  const targetRoute = getMessageRoute(message)
  if (targetRoute) {
    router.push(targetRoute)
  }
}

// 获取消息的类别标签颜色
function getTagColorClass(message: InboxMessage): string {
  const category = getMessageCategory(message.eventType)
  return getCategoryColorClass(category, themeStore.isDark)
}

// 获取消息类别标签文本
function getCategoryLabel(message: InboxMessage): string {
  const category = getMessageCategory(message.eventType)
  return t(`inbox.categories.${category}`)
}

// 分页
function goToPage(page: number) {
  if (!available.value || !Number.isSafeInteger(page) || page < 1 || page > totalPages.value || page === currentPage.value) return
  currentPage.value = page
  loadMessages()
}

// 格式化时间
function formatTime(dateStr: string): string {
  return formatRelativeTime(dateStr, t)
}

</script>

<template>
  <div ref="revealRoot" class="kawaii-page inbox-page animate-fade-in">
    <!-- Header -->
    <div data-reveal class="page-header">
      <div class="min-w-0">
        <h1 class="page-title">{{ t('inbox.title') }}</h1>
        <p class="page-description">{{ t('inbox.description') }}</p>
      </div>
      <div class="flex items-center gap-2">
        <!-- 清空已读 -->
        <button
          class="btn btn-secondary btn-sm"
          :disabled="actionsDisabled"
          @click="deleteReadMessages"
        >
          {{ t('inbox.clearRead') }}
        </button>
        <!-- 全部已读 -->
        <button
          class="btn btn-primary btn-sm"
          :disabled="actionsDisabled"
          @click="markAllAsRead"
        >
          {{ t('inbox.markAllRead') }}
        </button>
      </div>
    </div>

    <!-- 筛选标签 -->
    <div data-reveal class="mb-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
      <!-- 已读/未读筛选：分段控件 -->
      <div class="inline-flex items-center gap-1 self-start rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
        <button
          class="rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
          :class="filter === 'all'
            ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white'
            : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'"
          @click="setFilter('all')"
        >
          {{ t('inbox.all') }}
        </button>
        <button
          class="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
          :class="filter === 'unread'
            ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white'
            : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'"
          @click="setFilter('unread')"
        >
          {{ t('inbox.unread') }}
          <span
            v-if="inboxStore.unreadCount > 0"
            class="inline-flex min-w-[18px] items-center justify-center rounded-full bg-primary-500 px-1.5 font-mono text-[10px] font-semibold text-white"
          >
            {{ inboxStore.unreadCount }}
          </span>
        </button>
      </div>

      <!-- 分隔线 - 仅桌面端显示 -->
      <div class="hidden h-5 w-px bg-gray-200 dark:bg-gray-700 sm:block"></div>

      <!-- 类别筛选 -->
      <div class="flex flex-wrap items-center gap-1.5">
        <button
          class="rounded-full px-2.5 py-1 text-xs font-medium transition-colors"
          :class="categoryFilter === 'all'
            ? 'bg-themed-hover text-themed'
            : 'text-themed-muted hover:text-themed'"
          @click="setCategoryFilter('all')"
        >
          {{ t('inbox.allCategories') }}
        </button>
        <button
          v-for="cat in categories"
          :key="cat.key"
          class="rounded-full px-2.5 py-1 text-xs font-medium transition-colors"
          :class="categoryFilter === cat.key
            ? getCategoryColorClass(cat.key, themeStore.isDark)
            : 'text-themed-muted hover:text-themed'"
          @click="setCategoryFilter(cat.key)"
        >
          {{ t(cat.config.label) }}
        </button>
      </div>
    </div>

    <div v-if="actionError" role="alert" data-inbox-action-error class="mb-4 text-sm text-red-600 dark:text-red-400">
      {{ t('common.error') }}
    </div>

    <!-- 消息列表 -->
    <div class="card">
      <!-- 加载中 -->
      <div v-if="readError" role="alert" data-inbox-read-error class="px-8 py-8 text-center">
        <p class="text-sm text-red-600 dark:text-red-400">{{ t('common.error') }}</p>
        <button class="btn btn-secondary mt-3" :disabled="loading" @click="loadMessages">{{ t('common.retry') }}</button>
      </div>
      <div v-else-if="loading && !loaded" class="px-8 py-14 text-center">
        <svg class="mx-auto h-6 w-6 animate-spin text-themed-muted" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <p class="mt-3 text-sm text-themed-muted">{{ t('common.loading') }}</p>
      </div>

      <!-- 无消息 -->
      <div v-else-if="messages.length === 0" class="px-8 py-14 text-center">
        <div class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-themed-secondary">
          <svg class="h-7 w-7 text-themed-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
          </svg>
        </div>
        <p class="text-sm text-themed-muted">
          {{ filter === 'unread' ? t('inbox.noUnread') : t('inbox.noMessages') }}
        </p>
      </div>

      <!-- 消息列表 -->
      <div v-else class="divide-y divide-themed">
        <!-- 无筛选结果提示 -->
        <div v-if="filteredMessages.length === 0" class="p-6 text-center">
          <p class="text-sm text-themed-muted">{{ t('inbox.noCategoryMessages') }}</p>
        </div>

        <div
          v-for="message in filteredMessages"
          :key="message.id"
          class="group relative flex items-start gap-3 px-4 py-3 transition-colors hover:bg-themed-hover"
          :class="[
            !message.isRead ? 'bg-themed-tertiary' : '',
            canNavigate(message) ? 'cursor-pointer' : ''
          ]"
        >
          <!-- 未读标记 -->
          <div class="flex-shrink-0 pt-1.5">
            <span
              v-if="!message.isRead"
              class="nimbus-unread block h-2 w-2 rounded-full bg-primary-500"
            ></span>
            <span
              v-else
              class="block h-2 w-2"
            ></span>
          </div>

          <!-- 内容 -->
          <div
            class="min-w-0 flex-1 break-words" role="button" tabindex="0" :aria-disabled="actionsDisabled"
            @click="handleMessageClick(message)"
            @keydown.enter.prevent="handleMessageClick(message)"
            @keydown.space.prevent="handleMessageClick(message)"
          >
            <div class="flex flex-wrap items-center gap-2">
              <!-- 类别标签 -->
              <span
                class="nimbus-tag font-mono"
                :class="getTagColorClass(message)"
              >
                {{ getCategoryLabel(message) }}
              </span>
              <h3 class="text-sm font-medium text-themed">
                {{ message.title }}
              </h3>
              <span class="font-mono text-xs text-themed-faint">
                {{ formatTime(message.createdAt) }}
              </span>
              <!-- 可跳转图标 -->
              <svg
                v-if="canNavigate(message)"
                class="h-3 w-3 flex-shrink-0 text-themed-faint transition-transform group-hover:translate-x-0.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
              </svg>
            </div>
            <p class="mt-1 whitespace-pre-line text-sm leading-relaxed text-themed-secondary">
              {{ message.content }}
            </p>
          </div>

          <!-- 操作按钮 -->
          <div class="flex flex-shrink-0 items-center gap-1">
            <button
              v-if="!message.isRead"
              class="rounded-md p-1.5 text-themed-faint transition-colors hover:bg-themed-hover hover:text-themed"
              :title="t('inbox.markRead')"
              :aria-label="t('inbox.markRead')"
              :disabled="actionsDisabled"
              @click.stop="markAsRead(message)"
            >
              <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
              </svg>
            </button>
            <button
              class="rounded-md p-1.5 text-themed-faint transition-colors hover:bg-themed-hover hover:text-red-500"
              :title="t('common.delete')"
              :aria-label="t('common.delete')"
              :disabled="actionsDisabled"
              @click.stop="deleteMessage(message)"
            >
              <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <!-- 分页 -->
      <div v-if="totalPages > 1 && categoryFilter === 'all'" class="flex items-center justify-between border-t border-themed px-4 py-3">
        <div class="font-mono text-xs text-themed-muted">
          {{ t('common.total') }} {{ total }} {{ t('common.items') }}
        </div>
        <div class="flex items-center gap-1">
          <button
            class="btn btn-ghost btn-sm"
            :disabled="currentPage === 1"
            @click="goToPage(currentPage - 1)"
          >
            {{ t('common.previous') }}
          </button>
          <span class="px-2 font-mono text-xs text-themed-muted">
            {{ currentPage }} / {{ totalPages }}
          </span>
          <button
            class="btn btn-ghost btn-sm"
            :disabled="currentPage === totalPages"
            @click="goToPage(currentPage + 1)"
          >
            {{ t('common.next') }}
          </button>
        </div>
      </div>
      <!-- 类别筛选时显示当前页筛选结果数量 -->
      <div v-else-if="categoryFilter !== 'all'" class="border-t border-themed px-4 py-3">
        <div class="text-sm text-themed-muted">
          {{ t('inbox.currentPageFiltered', { count: filteredMessages.length }) }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 收件箱的类别标签与未读标记沿用单色界面。 */
.nimbus-tag {
  display: inline-flex;
  align-items: center;
  padding: 0.0625rem 0.375rem;
  border-radius: 0.3125rem;
  font-size: 0.625rem;
  font-weight: 600;
  line-height: 1rem;
  letter-spacing: 0.02em;
}

.nimbus-unread {
  background: var(--text-primary);
  box-shadow: none;
}

.inbox-page .card { background: var(--bg-primary) !important; background-image: none !important; box-shadow: none !important; backdrop-filter: none; }
.inbox-page button { box-shadow: none !important; transform: none !important; }
.inbox-page .btn-primary { background: var(--text-primary) !important; background-image: none !important; color: var(--bg-primary) !important; border-color: var(--text-primary) !important; }
.inbox-page .btn-primary::before { display: none !important; }
.inbox-page .btn-secondary { background: var(--bg-secondary); background-image: none; color: var(--text-primary); }
.inbox-page button:disabled { opacity: .5; }
.inbox-page [role='button']:focus-visible, .inbox-page button:focus-visible { outline: 2px solid var(--text-primary); outline-offset: 2px; }
.inbox-page .nimbus-tag, .inbox-page .font-mono { font-family: inherit; }
.inbox-page .nimbus-tag { font-size: 12px; color: var(--text-secondary); background: var(--bg-secondary); }
.inbox-page .text-themed-faint { color: var(--text-secondary); }
.inbox-page .page-description { color: var(--text-secondary); }

@media (max-width: 639px) {
  button { min-width: 44px; min-height: 44px; transform: none !important; }
}

@media (prefers-reduced-motion: reduce) {
  * {
    transition: none !important;
    animation: none !important;
  }
}
</style>
