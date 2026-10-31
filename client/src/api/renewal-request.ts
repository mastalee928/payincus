import type { AxiosInstance } from 'axios'

const pending = new Map<string, Promise<unknown>>()
/** Keep one intent across errors, page reloads and modal reopenings; clear only on an acknowledged success. */
export function postRenewal<T>(http: AxiosInstance, url: string, body: Record<string, unknown>, timeout?: number): Promise<T> {
  let account: number
  try {
    const token = localStorage.getItem('token') || ''
    account = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).id
    if (!Number.isSafeInteger(account) || account <= 0) throw Error('Invalid account')
  } catch { return Promise.reject(new Error('请重新登录后续费')) }
  const identity = JSON.stringify({ account, url, body })
  const active = pending.get(identity)
  if (active) return active as Promise<T>
  let key: string
  const storageKey = 'payincus:renewal:' + identity
  try {
    key = sessionStorage.getItem(storageKey) || crypto.randomUUID()
    sessionStorage.setItem(storageKey, key)
  } catch { return Promise.reject(new Error('浏览器无法保存续费请求，请允许本站使用存储后重试')) }
  const operation = http.post(url, body, { headers: { 'Idempotency-Key': key }, ...(timeout ? { timeout } : {}) }).then(response => {
    try { if (sessionStorage.getItem(storageKey) === key) sessionStorage.removeItem(storageKey) } catch { /* Keep the acknowledged result; blocked storage must never turn a committed renewal into an error. */ }
    return response as T
  }).finally(() => { if (pending.get(identity) === operation) pending.delete(identity) })
  pending.set(identity, operation)
  return operation
}
