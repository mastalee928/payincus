export const pending = []
const defer = (kind, data) => new Promise((resolve, reject) => pending.push({ kind, data, resolve, reject }))
export default { admin: {
  getBillingInstances: data => defer('list', data),
  getBillingOverview: () => defer('overview'),
  getExpiryEnforcementStatus: async () => ({ enabled: false, running: false, failureCount: 0 }),
  previewInstancePriceUpdate: (id, price, settle) => defer('single-preview', { id, price, settle }),
  previewBatchInstancePriceUpdate: (ids, price, settle) => defer('batch-preview', { ids: [...ids], price, settle }),
  updateInstancePrice: (id, price, settle, version) => defer('single-save', { id, price, settle, version }),
  updateBatchInstancePrice: (ids, price, settle, expectations) => defer('batch-save', { ids: [...ids], price, settle, expectations }),
} }
