/**
 * 购物车（一机一卖）
 *
 * 一行 = 一种配置 + 数量。只存在浏览器里，按账号隔离；不占库存，也不锁价。
 * 行里的 snapshot 只用于展示与比对，付款时以服务端当前价与库存为准。
 */
import { defineStore } from 'pinia'
import { computed, onScopeDispose, ref, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'

export interface CartItemSnapshot {
  regionId: number
  regionName: string
  countryCode: string | null
  resourcePreset: string
  diskGiB: number
  cpu: number
  memoryMiB: number
  /** 分 */
  monthlyPrice: number
  /** 分 */
  setupFee: number
  imageLabel: string
}

export interface CartItem {
  key: string
  poolPriceId: number
  quantity: number
  namePrefix: string
  image: string
  customInitCommandIds: number[]
  snapshot: CartItemSnapshot
  addedAt: string
}

const STORAGE_PREFIX = 'incudal.cart.'
const ENTRY_PREFIX = 'incudal.cart.v2.'
const validId = (value: unknown) => Number.isInteger(value) && Number(value) > 0 && Number(value) <= 2147483647
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max
function isCartItem(value: unknown): value is CartItem {
  if (!value || typeof value !== 'object') return false
  const item = value as CartItem, snapshot = item.snapshot
  return text(item.key, 100) && /^[a-zA-Z0-9_-]+$/.test(item.key) && validId(item.poolPriceId)
    && Number.isInteger(item.quantity) && item.quantity >= 1 && item.quantity <= 100
    && text(item.namePrefix, 60) && text(item.image, 200) && !!item.image
    && Array.isArray(item.customInitCommandIds) && item.customInitCommandIds.length <= 50 && item.customInitCommandIds.every(validId)
    && text(item.addedAt, 40) && Number.isFinite(Date.parse(item.addedAt))
    && !!snapshot && typeof snapshot === 'object' && validId(snapshot.regionId)
    && text(snapshot.regionName, 200) && (snapshot.countryCode === null || text(snapshot.countryCode, 8))
    && text(snapshot.resourcePreset, 50) && text(snapshot.imageLabel, 200)
    && [snapshot.diskGiB, snapshot.cpu, snapshot.memoryMiB, snapshot.monthlyPrice, snapshot.setupFee]
      .every(value => Number.isSafeInteger(value) && value >= 0 && value <= 1e12)
}
function parse(raw: string | null): unknown { try { return raw ? JSON.parse(raw) : null } catch { return null } }

export const useCartStore = defineStore('cart', () => {
  const authStore = useAuthStore(), items = ref<CartItem[]>([])
  const storageKey = computed(() => authStore.user?.id ? `${ENTRY_PREFIX}${authStore.user.id}.` : null)
  let volatile = false
  function load(): void {
    const prefix = storageKey.value
    if (!prefix) { items.value = []; return }
    if (volatile) return
    try {
      // Upgrade the old array once. Each line has its own key so independent
      // tabs never overwrite an entire, potentially stale, cart snapshot.
      const legacyKey = `${STORAGE_PREFIX}${authStore.user!.id}`
      const legacy = parse(localStorage.getItem(legacyKey))
      if (Array.isArray(legacy)) {
        for (const item of legacy.filter(isCartItem).slice(0, 100)) {
          if (localStorage.getItem(prefix + item.key) === null) localStorage.setItem(prefix + item.key, JSON.stringify(item))
        }
        localStorage.removeItem(legacyKey)
      }
      const loaded: CartItem[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (!key?.startsWith(prefix)) continue
        const item = parse(localStorage.getItem(key))
        if (isCartItem(item) && key === prefix + item.key) loaded.push(item)
      }
      items.value = loaded.sort((a, b) => a.addedAt.localeCompare(b.addedAt) || a.key.localeCompare(b.key)).slice(0, 200)
    } catch { volatile = true }
  }
  function writable(): boolean {
    if (!storageKey.value || !authStore.token) return false
    try {
      if (!authStore.captureAuthentication().aligned) return false
      const payload = JSON.parse(atob(authStore.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
      if (payload.id !== authStore.user?.id) return false
    } catch { return false }
    load()
    return true
  }
  function save(item: CartItem | null, key: string): void {
    const prefix = storageKey.value
    if (!prefix) return
    try {
      if (item) localStorage.setItem(prefix + key, JSON.stringify(item))
      else localStorage.removeItem(prefix + key)
    } catch { volatile = true }
    items.value = items.value.filter(row => row.key !== key)
    if (item) items.value.push(item)
  }
  watch(storageKey, () => { volatile = false; items.value = []; load() }, { immediate: true, flush: 'sync' })
  const onStorage = (event: StorageEvent) => {
    if (event.storageArea === localStorage && (event.key === null || (storageKey.value && event.key.startsWith(storageKey.value)))) load()
  }
  window.addEventListener('storage', onStorage)
  onScopeDispose(() => window.removeEventListener('storage', onStorage))
  const totalQuantity = computed(() => items.value.reduce((sum, item) => sum + item.quantity, 0))
  const totalCents = computed(() => items.value.reduce((sum, item) => sum + item.quantity * (item.snapshot.monthlyPrice + item.snapshot.setupFee), 0))
  function add(input: Omit<CartItem, 'key' | 'addedAt'>): CartItem | null {
    if (!writable()) return null
    const item: CartItem = { ...input, key: crypto.randomUUID(), addedAt: new Date().toISOString() }
    if (!isCartItem(item) || totalQuantity.value + item.quantity > 100) return null
    save(item, item.key)
    return item
  }
  function remove(key: string, expected?: CartItem): void {
    if (!writable()) return
    const current = items.value.find(row => row.key === key)
    if (!current || (expected && JSON.stringify(current) !== JSON.stringify(expected))) return
    save(null, key)
  }
  function setQuantity(key: string, quantity: number): void {
    if (!Number.isFinite(quantity) || !writable()) return
    const item = items.value.find(row => row.key === key)
    if (!item) return
    const next = Math.max(1, Math.min(100, 100 - totalQuantity.value + item.quantity, Math.floor(quantity)))
    save({ ...item, quantity: next }, key)
  }
  function setNamePrefix(key: string, namePrefix: string): void {
    if (!text(namePrefix, 60) || !writable()) return
    const item = items.value.find(row => row.key === key)
    if (item) save({ ...item, namePrefix }, key)
  }
  function clear(): void {
    if (!writable()) return
    for (const item of [...items.value]) save(null, item.key)
  }
  return { items, totalQuantity, totalCents, add, remove, setQuantity, setNamePrefix, clear, reload: load }
})
