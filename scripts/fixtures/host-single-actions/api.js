export const pending = []
const request = (kind, params) => new Promise((resolve, reject) => pending.push({ kind, params, resolve, reject }))
export default {
  instances: {
    list: params => request('list', params), getConfig: id => request('config', { id }), get: id => request('detail', { id }),
    syncStatus: id => request('sync', { id }), enableSwap: id => request('swap-enable', { id }), disableSwap: id => request('swap-disable', { id }),
  },
  traffic: { getInstanceTraffic: async () => ({ monthlyUsed: '0', monthlyUsedFormatted: '0 B', monthlyLimit: null, monthlyLimitFormatted: null, percentage: 0 }) },
}
