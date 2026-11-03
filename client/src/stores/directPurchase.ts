import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { isCartItem, type CartItem } from './cart'

/** A direct purchase is a tab-local, account-scoped draft, never a cart entry. */
export const useDirectPurchaseStore = defineStore('direct-purchase', () => {
  const auth = useAuthStore(), items = ref<CartItem[]>([]), draftId = ref('')
  const key = (id: string) => `incudal.direct-purchase.${auth.user?.id}.${id}`
  function save(item: CartItem | null) {
    items.value = item ? [item] : []
    try {
      if (item) sessionStorage.setItem(key(draftId.value), JSON.stringify(item))
      else sessionStorage.removeItem(key(draftId.value))
    } catch { /* Same-tab draft remains usable when storage is unavailable. */ }
  }
  function load(id: string) {
    if (draftId.value === id) return
    draftId.value = id; items.value = []
    if (!auth.captureAuthentication().aligned || !/^[a-f0-9-]{36}$/i.test(id)) return
    try {
      const item = JSON.parse(sessionStorage.getItem(key(id)) || 'null')
      if (isCartItem(item) && item.key === id) items.value = [item]
    } catch { /* Invalid drafts are empty; the server still validates every purchase. */ }
  }
  function create(input: Omit<CartItem, 'key' | 'addedAt'>): string | null {
    if (!auth.user || !auth.captureAuthentication().aligned) return null
    const item = { ...input, key: crypto.randomUUID(), addedAt: new Date().toISOString() }
    if (!isCartItem(item)) return null
    draftId.value = item.key; save(item)
    return item.key
  }
  function remove(id: string, expected?: CartItem) {
    const item = items.value[0]
    if (auth.captureAuthentication().aligned && item?.key === id && (!expected || JSON.stringify(item) === JSON.stringify(expected))) save(null)
  }
  function setQuantity(id: string, quantity: number) {
    const item = items.value[0]
    if (auth.captureAuthentication().aligned && item?.key === id && Number.isInteger(quantity) && quantity >= 1 && quantity <= 100) save({ ...item, quantity })
  }
  function setNamePrefix(id: string, namePrefix: string) {
    const item = items.value[0]
    if (auth.captureAuthentication().aligned && item?.key === id && namePrefix.length <= 60) save({ ...item, namePrefix })
  }
  watch(() => auth.user?.id, () => { draftId.value = ''; items.value = [] }, { flush: 'sync' })
  return { items, load, create, remove, setQuantity, setNamePrefix }
})
