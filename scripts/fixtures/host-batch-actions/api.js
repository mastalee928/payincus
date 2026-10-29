export const pending = []
const request = (kind, params) => new Promise((resolve, reject) => pending.push({ kind, params, resolve, reject }))
export default {
  instances: { list: params => request('list', params) },
  traffic: { getInstanceTraffic: async () => ({ monthlyUsed: '0', monthlyUsedFormatted: '0 B', monthlyLimit: null, monthlyLimitFormatted: null, percentage: 0 }) },
  hosts: {
    batchSuspendInstances: (hostId, ids, reason) => request('suspend', { hostId, ids: [...ids], reason }),
    batchUnsuspendInstances: (hostId, ids) => request('unsuspend', { hostId, ids: [...ids] }),
    batchSyncInstanceStatus: (hostId, ids) => request('sync', { hostId, ids: [...ids] }),
  },
}
