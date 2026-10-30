import { defineStore } from 'pinia'
import { ref, computed, type Ref } from 'vue'
import api from '@/api'
import type { AuthUser } from '@/types/store.js'

export const useAuthStore = defineStore('auth', () => {
  const user: Ref<AuthUser | null> = ref(null)
  const token: Ref<string | null> = ref(localStorage.getItem('token') || null)
  const quota = ref<any>(null)
  let generation = 0, identitySequence = 0
  let logoutGeneration: number | undefined
  function tokenIdentity(value: string | null): string {
    if (!value) return ''
    try {
      const payload = JSON.parse(atob(value.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
      if (typeof payload.sid === 'string' && payload.sid) return `${payload.id}:${payload.role || ''}:${payload.sid}`
    } catch { /* Legacy tokens retain their full identity. */ }
    return value
  }
  const identity = computed(() => tokenIdentity(token.value))
  function replaceToken(value: string | null) {
    if (tokenIdentity(value) !== identity.value) {
      generation++
      identitySequence++
      user.value = null
      quota.value = null
    }
    token.value = value
  }
  function expectedUserId(): number | undefined {
    try {
      const payload = JSON.parse(atob(token.value!.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
      if (Number.isSafeInteger(payload.id) && payload.id > 0) return payload.id
    } catch { /* A legacy token can use its current verified user. */ }
    return user.value?.id
  }
  function captureIdentity() {
    const target = identity.value, version = generation, sequence = ++identitySequence, userId = expectedUserId()
    return { userId, current: () => !!token.value && target === identity.value && target === tokenIdentity(localStorage.getItem('token')) &&
      version === generation && sequence === identitySequence && logoutGeneration !== generation }
  }
  function captureAuthentication() {
    const target = identity.value, storedTarget = tokenIdentity(localStorage.getItem('token')), version = generation
    return { aligned: target === storedTarget, current: () => target === identity.value && storedTarget === tokenIdentity(localStorage.getItem('token')) && version === generation }
  }
  function validUser(value: any, userId?: number): boolean {
    return !!value && Number.isSafeInteger(value.id) && value.id > 0 && (userId === undefined || value.id === userId) &&
      typeof value.username === 'string' && ['admin', 'user'].includes(value.role)
  }

  // 同步 token 的方法（用于 token 刷新后同步）
  function syncToken() {
    replaceToken(localStorage.getItem('token'))
  }

  // 监听 localStorage 变化（跨窗口同步）
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => {
      if (e.key === 'token' || e.key === null) {
        // Read the latest value: queued storage events can describe an older switch.
        if (e.key === null || tokenIdentity(e.oldValue) !== tokenIdentity(e.newValue)) {
          generation++
          identitySequence++
          user.value = null
          quota.value = null
        }
        syncToken()
      }
    })
  }

  const isAuthenticated = computed(() => !!token.value)
  const isAdmin = computed(() => user.value?.role === 'admin')

  function applyAuthUser(rawUser: any) {
    user.value = {
      id: rawUser.id,
      username: rawUser.username,
      email: rawUser.email || '',
      role: rawUser.role,
      avatarStyle: rawUser.avatarStyle || 'bigSmile',
      avatarBadgeId: rawUser.avatarBadgeId || null,
      hasCreatedHostBefore: rawUser.hasCreatedHostBefore || false,
      canAccessHostingFeature: rawUser.canAccessHostingFeature ?? true
    }
  }

  async function login(username: string, password: string, totpCode?: string, recoveryCode?: string, turnstileToken?: string) {
    const target = identity.value, storedTarget = tokenIdentity(localStorage.getItem('token')), version = ++generation
    identitySequence++
    const response = await api.auth.login(username, password, totpCode, recoveryCode, turnstileToken)
    if (version !== generation || target !== identity.value || storedTarget !== tokenIdentity(localStorage.getItem('token'))) {
      throw { code: 'AUTHENTICATION_STATE_CHANGED', message: 'Authentication state changed' }
    }
    if (!response || typeof response.token !== 'string' || !response.token.trim() || !validUser(response.user)) throw Error('Invalid login response')

    localStorage.setItem('token', response.token)
    replaceToken(response.token)
    applyAuthUser(response.user)
    return response
  }

  async function fetchCurrentUser(): Promise<AuthUser | null> {
    if (!token.value || logoutGeneration === generation) return null
    const context = captureIdentity()
    try {
      const response = await api.auth.me()
      if (!context.current()) return null
      if (!validUser(response?.user, context.userId)) throw Error('Invalid identity response')
      applyAuthUser(response.user)
      // 保存配额信息
      quota.value = (response.user as any).quota || null
      return user.value
    } catch (error: any) {
      if (!context.current()) return null
      if (error?.code === 'UNAUTHORIZED' || error?.response?.status === 401) {
        // 只清除本地状态，不调用后端logout（因为token可能已经无效）
        clearLocalAuth()
      }
      throw error
    }
  }

  // 清除本地认证状态（不调用后端API）
  function clearLocalAuth() {
    generation++; identitySequence++
    token.value = null
    user.value = null
    quota.value = null
    localStorage.removeItem('token')
  }

  // 仅清除当前标签页内存中的认证状态，保留共享的 localStorage.token。
  // 用于“管理员误入用户端 / 非管理员误入管理端”这类跨端驱离场景：
  // 不能清共享 token，否则会通过 storage 事件把另一端（合法会话）一起登出。
  function clearInMemoryAuth() {
    generation++; identitySequence++
    token.value = null
    user.value = null
    quota.value = null
  }

  async function logout() {
    const target = identity.value, storedTarget = tokenIdentity(localStorage.getItem('token')), version = ++generation
    identitySequence++; logoutGeneration = version
    user.value = null
    quota.value = null
    // 先调用后端登出 API（清除服务端会话和记录日志）
    // 必须在清除本地状态之前调用，否则请求拦截器无法获取 token
    if (token.value) {
      try {
        await api.auth.logout()
      } catch (error) {
        // 后端调用失败不影响本地登出
        console.warn('登出 API 调用失败:', error)
      }
    }

    // 最后清除本地状态
    if (target === identity.value && version === generation && storedTarget === tokenIdentity(localStorage.getItem('token'))) clearLocalAuth()
    if (logoutGeneration === version) logoutGeneration = undefined
  }

  // 初始化：如果存在 token 则获取用户信息
  // 使用 setTimeout 延迟执行，避免在 store 初始化时立即触发请求
  if (token.value && typeof window !== 'undefined') {
    setTimeout(() => {
      fetchCurrentUser().catch(() => {
        // 初始化时静默失败，如果 token 无效会自动清除
      })
    }, 0)
  }

  // 检查会话是否有效（用于页面可见性变化时检查）
  async function checkSession(): Promise<boolean> {
    if (!token.value) {
      return false
    }
    if (logoutGeneration === generation) return false
    const context = captureIdentity()
    try {
      const response = await api.auth.me()
      if (!context.current()) return !!token.value
      if (!validUser(response?.user, context.userId)) throw Error('Invalid identity response')
      applyAuthUser(response.user)
      quota.value = (response.user as any).quota || null
      return true
    } catch (error: any) {
      if (!context.current()) return !!token.value
      // 如果是401，说明会话已过期
      if (error?.code === 'UNAUTHORIZED' || error?.response?.status === 401) {
        clearLocalAuth()
        return false
      }
      // 其他错误（如网络错误），不清除状态
      return true
    }
  }

  return {
    user,
    token,
    quota,
    isAuthenticated,
    isAdmin,
    login,
    fetchCurrentUser,
    logout,
    syncToken,
    clearLocalAuth,
    clearInMemoryAuth,
    checkSession,
    captureAuthentication
  }
})
