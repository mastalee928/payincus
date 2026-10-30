import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from 'axios'
import { useAuthStore } from '@/stores/auth'
import { buildApiUrl } from '@/utils/api-url'

type Session = { aligned: boolean; current: () => boolean }
type SessionRequest = InternalAxiosRequestConfig & { authSession?: Session; authRetried?: boolean }
let refresh: { session: Session; promise: Promise<string> } | undefined
let lastAttempt: { session: Session; time: number } | undefined

function stateChanged() {
  return { code: 'AUTHENTICATION_STATE_CHANGED', message: 'Authentication state changed' }
}
function current(session: Session) {
  if (!session.current()) throw stateChanged()
}
function claims(token: string | null): { id?: number; role?: string; sid?: string; exp?: number } | null {
  if (!token) return null
  try { return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) } catch { return null }
}
function clearSession(session: Session, redirect: () => void) {
  current(session)
  useAuthStore().clearLocalAuth()
  redirect()
}

function refreshToken(session: Session, redirect: () => void): Promise<string> {
  current(session)
  if (refresh?.session.current()) return refresh.promise
  const original = claims(localStorage.getItem('token'))
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)
  lastAttempt = { session, time: Date.now() }
  const pending = { session, promise: Promise.resolve('') }
  pending.promise = (async () => {
    try {
      const response = await fetch(buildApiUrl('/auth/refresh'), {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, signal: controller.signal
      })
      current(session)
      if (response.status === 401 || response.status === 400) {
        clearSession(session, redirect)
        throw { code: 'UNAUTHORIZED', message: 'Session expired' }
      }
      if (!response.ok) throw Error(`Refresh token failed: ${response.status}`)
      const data = await response.json()
      current(session)
      const next = typeof data?.token === 'string' ? claims(data.token) : null
      if (!original || !next || !Number.isSafeInteger(next.id) || !next.id || next.id < 1 ||
        next.id !== original.id || !next.sid || next.sid !== original.sid || !['user', 'admin'].includes(next.role || '') ||
        !Number.isFinite(next.exp) || next.exp! * 1000 <= Date.now()) throw Error('Invalid refresh response')
      localStorage.setItem('token', data.token)
      useAuthStore().syncToken()
      // A changed role invalidates operations prepared with the former role.
      current(session)
      return data.token as string
    } finally {
      clearTimeout(timer)
      if (refresh === pending) refresh = undefined
    }
  })()
  refresh = pending
  return pending.promise
}

// Both wrappers share refresh state; their routes and login destinations stay local.
export function bindAuthSession(http: AxiosInstance, redirect: () => void) {
  const transport = axios.getAdapter(http.defaults.adapter)
  // Synchronous capture precedes any await, including proactive refresh.
  http.interceptors.request.use(config => {
    const request = config as SessionRequest
    request.authSession ??= useAuthStore().captureAuthentication()
    current(request.authSession)
    if (!request.authSession.aligned && !/^\/auth\/(?:login|register|refresh|check-2fa|logout)(?:[/?]|$)/.test(request.url || '')) throw stateChanged()
    return config
  }, error => { throw error }, { synchronous: true })
  http.defaults.adapter = async config => {
    const request = config as SessionRequest, session = request.authSession!
    current(session)
    let token = localStorage.getItem('token')
    const expires = claims(token)?.exp
    const authEndpoint = /^\/auth\/(?:login|register|refresh|check-2fa|logout)(?:[/?]|$)/.test(request.url || '')
    if (token && !authEndpoint && !request.authRetried && expires && expires * 1000 - Date.now() < 86400_000 &&
      (refresh?.session.current() || !lastAttempt?.session.current() || Date.now() - lastAttempt.time >= 5000)) {
      try { token = await refreshToken(session, redirect) } catch (error) {
        current(session)
        // Temporary refresh failures preserve the original request's session.
        if ((error as { code?: string }).code === 'UNAUTHORIZED') throw error
      }
    }
    current(session)
    if (token) request.headers.set('Authorization', `Bearer ${token}`)
    else request.headers.delete('Authorization')
    return transport(request)
  }
  http.interceptors.response.use(response => {
    current((response.config as SessionRequest).authSession!)
    return response.data
  }, async error => {
    const request = error.config as SessionRequest | undefined
    if (!request?.authSession) return Promise.reject(error)
    const session = request.authSession
    current(session)
    const data = error.response?.data
    const isAuthEndpoint = /^\/auth\/(?:login|register|refresh|check-2fa|logout)(?:[/?]|$)/.test(request.url || '')
    if (error.response?.status === 401 && !isAuthEndpoint && localStorage.getItem('token')) {
      if (request.authRetried) {
        clearSession(session, redirect)
        return Promise.reject({ ...data, code: data?.code || 'UNAUTHORIZED', message: data?.error || 'Unauthorized' })
      }
      // Every queued request gets the same single retry limit.
      request.authRetried = true
      if (request.headers.get('Authorization') !== `Bearer ${localStorage.getItem('token')}`) {
        return http(request)
      }
      if (!refresh?.session.current() && lastAttempt?.session.current() && Date.now() - lastAttempt.time < 5000) {
        return Promise.reject({ ...data, code: data?.code || 'UNAUTHORIZED', message: data?.error || 'Unauthorized' })
      }
      await refreshToken(session, redirect)
      current(session)
      return http(request)
    }
    return Promise.reject({ message: data?.error || data?.message || error.message || 'Request failed',
      code: data?.code || null, details: data?.details || null, ...data })
  })
}
