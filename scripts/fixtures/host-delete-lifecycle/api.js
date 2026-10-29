export const pending = []
const request = (kind, params) => new Promise((resolve, reject) => pending.push({ kind, params, resolve, reject }))
export default {
  instances: { list: params => request('list', params) },
  traffic: { getInstanceTraffic: async () => ({ monthlyUsed: '0', monthlyUsedFormatted: '0 B', monthlyLimit: null, monthlyLimitFormatted: null, percentage: 0 }) },
  hosts: {
    batchDeleteInstancesPreview: (hostId, ids) => request('preview', { hostId, ids: [...ids] }),
    batchDeleteInstances: (hostId, ids, reason, databaseOnly, refund) => request('delete', { hostId, ids: [...ids], reason, databaseOnly, refund }),
  },
}
