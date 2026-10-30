const PAGE_SIZE = 100
// Bound sequential work and memory; oversized collections fail instead of being truncated.
const MAX_ITEMS = 100000

export async function loadCompletePages<T extends { id: number }>(options: {
  fetchPage: (params: { page: number; pageSize: number }) => Promise<unknown>
  itemsKey: string
  isItem: (value: unknown) => value is T
  current: () => boolean
  errorMessage: string
}): Promise<T[]> {
  const items: T[] = [], ids = new Set<number>()
  let total: number | undefined, totalPages: number | undefined
  const fail = () => new Error(options.errorMessage)
  for (let page = 1; ; page++) {
    if (!options.current()) throw fail()
    const value = await options.fetchPage({ page, pageSize: PAGE_SIZE })
    if (!options.current()) throw fail()
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail()
    const response = value as Record<string, unknown>, rows = response[options.itemsKey]
    if (response.page !== page || response.pageSize !== PAGE_SIZE ||
      typeof response.total !== 'number' || !Number.isSafeInteger(response.total) || response.total < 0 || response.total > MAX_ITEMS ||
      typeof response.totalPages !== 'number' || !Number.isSafeInteger(response.totalPages) ||
      response.totalPages !== Math.ceil(response.total / PAGE_SIZE) || !Array.isArray(rows)) throw fail()
    if (total === undefined) { total = response.total; totalPages = response.totalPages }
    if (response.total !== total || response.totalPages !== totalPages ||
      rows.length !== Math.min(PAGE_SIZE, Math.max(0, total - (page - 1) * PAGE_SIZE))) throw fail()
    for (const row of rows) {
      if (!options.isItem(row) || !Number.isSafeInteger(row.id) || row.id < 1 || ids.has(row.id)) throw fail()
      ids.add(row.id); items.push(row)
    }
    if (page >= totalPages!) {
      if (items.length !== total) throw fail()
      return items
    }
  }
}
