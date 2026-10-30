/**
 * 站内信状态管理
 */

import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import api from '@/api'
import { useAuthStore } from './auth'

export const useInboxStore = defineStore('inbox', () => {
  // 未读消息数量
  const unreadCount = ref(0)
  
  // 轮询定时器
  let pollTimer: number | null = null
  
  // 是否已初始化
  const initialized = ref(false)
  const auth = useAuthStore()
  let generation = 0, sequence = 0
  let pending: { generation: number } | undefined
  const session = computed(() => {
    if (!auth.user || !auth.token || !Number.isSafeInteger(auth.user.id) || auth.user.id < 1) return ''
    let identity = auth.token
    try {
      const payload = JSON.parse(atob(identity.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
      if (typeof payload.sid === 'string' && payload.sid) identity = payload.sid
    } catch { /* Legacy tokens keep their full identity. */ }
    return `${auth.user.id}:${auth.user.role}:${identity}`
  })
  function invalidate() { generation++; sequence++ }
  watch(session, () => {
    invalidate(); unreadCount.value = 0
    const version = generation
    // Auth updates its token and user separately; read only their settled identity.
    queueMicrotask(() => { if (version === generation && initialized.value && session.value) void fetchUnreadCount() })
  }, { flush: 'sync' })

  /**
   * 获取未读消息数量
   */
  async function fetchUnreadCount(): Promise<void> {
    if (!initialized.value || !session.value || pending?.generation === generation) return
    const identity = session.value, version = generation, requestSequence = ++sequence
    const request = { generation: version }; pending = request
    try {
      const res = await api.inbox.getUnreadCount()
      if (initialized.value && identity === session.value && version === generation && requestSequence === sequence &&
        res && Number.isSafeInteger(res.count) && res.count >= 0) unreadCount.value = res.count
    } catch {
      // 静默失败，不影响用户体验
    } finally {
      if (pending === request) pending = undefined
    }
  }

  /**
   * 启动轮询（登录后调用）
   */
  function startPolling(): void {
    if (initialized.value) return
    
    initialized.value = true
    fetchUnreadCount() // 立即获取一次
    
    // 每 15 秒轮询一次
    pollTimer = window.setInterval(fetchUnreadCount, 15000)
    
    // 监听页面可见性变化
    document.addEventListener('visibilitychange', handleVisibilityChange)
  }

  /**
   * 停止轮询（登出时调用）
   */
  function stopPolling(): void {
    invalidate()
    if (pollTimer !== null) {
      clearInterval(pollTimer)
      pollTimer = null
    }
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    initialized.value = false
    unreadCount.value = 0
  }

  /**
   * 主动刷新（用户操作后调用）
   */
  function refresh(): void {
    fetchUnreadCount()
  }

  /**
   * 页面可见性变化时刷新
   */
  function handleVisibilityChange(): void {
    if (initialized.value && document.visibilityState === 'visible') {
      refresh()
    }
  }

  /**
   * 减少未读数量（标记已读后调用）
   */
  function decrementUnread(count: number = 1): void {
    if (!Number.isSafeInteger(count) || count < 1) return
    invalidate()
    unreadCount.value = Math.max(0, unreadCount.value - count)
  }

  /**
   * 清零未读数量（全部标记已读后调用）
   */
  function clearUnread(): void {
    invalidate()
    unreadCount.value = 0
  }

  return {
    unreadCount,
    initialized,
    fetchUnreadCount,
    startPolling,
    stopPolling,
    refresh,
    decrementUnread,
    clearUnread
  }
})
