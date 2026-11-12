import type { AxiosInstance } from 'axios'
import { assertRenewalReceipt } from './renewal-receipt'

const pending = new Map<string, Promise<unknown>>()
/** Keep one intent across errors, page reloads and modal reopenings; clear only on an acknowledged success. */
export function postRenewal<T>(http: AxiosInstance, url: string, body: Record<string, unknown>, timeout?: number): Promise<T> {
  let account: number
  try {
    const token = localStorage.getItem('token') || ''
    account = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).id
    if (!Number.isSafeInteger(account) || account <= 0) throw Error('Invalid account')
  } catch { return Promise.reject(new Error('请重新登录后续费')) }
  // A quote is a precondition, not a second purchase intent. A lost response
  // followed by a price refresh must still recover the original renewal.
  const intent = { ...body }
  delete intent.expectedAmount
  delete intent.expectedAmounts
  const identity = JSON.stringify({ account, url, body: intent })
  const legacyStorageKey = 'payincus:renewal:' + JSON.stringify({ account, url, body })
  const active = pending.get(identity)
  if (active) return active as Promise<T>
  let key: string
  const storageKey = 'payincus:renewal:' + identity
  try {
    key = sessionStorage.getItem(storageKey) || sessionStorage.getItem(legacyStorageKey) || crypto.randomUUID()
    sessionStorage.setItem(storageKey, key)
  } catch { return Promise.reject(new Error('浏览器无法保存续费请求，请允许本站使用存储后重试')) }
  const operation = http.post(url, body, { headers: { 'Idempotency-Key': key }, ...(timeout ? { timeout } : {}) }).then(response => {
    assertRenewalReceipt(url, body, response)
    try {
      if (sessionStorage.getItem(storageKey) === key) sessionStorage.removeItem(storageKey)
      if (sessionStorage.getItem(legacyStorageKey) === key) sessionStorage.removeItem(legacyStorageKey)
    } catch { /* Blocked storage cannot turn a committed renewal into an error. */ }
    return response as T
  }).catch(error => {
    // This specific server response occurs before financial writes. Other
    // errors keep the key because their financial outcome may be unknown.
    if (error?.code === 'RENEWAL_PRICE_CHANGED') {
      try {
        if (sessionStorage.getItem(storageKey) === key) sessionStorage.removeItem(storageKey)
        if (sessionStorage.getItem(legacyStorageKey) === key) sessionStorage.removeItem(legacyStorageKey)
      } catch { /* Leave the safe old key if storage is unavailable. */ }
    }
    throw error
  }).finally(() => { if (pending.get(identity) === operation) pending.delete(identity) })
  pending.set(identity, operation)
  return operation
}
