export const pending = []
const request = (kind, params) => new Promise((resolve, reject) => pending.push({ kind, params, resolve, reject }))
export default {
  instances: { list: params => request('list', params) },
  traffic: { getInstanceTraffic: async () => ({ monthlyUsed: '0', monthlyUsedFormatted: '0 B', monthlyLimit: null, monthlyLimitFormatted: null, percentage: 0 }) },
  inbox: { notifyHostUsers: (hostId, data) => request('notify', { hostId, ...data, instanceIds: [...data.instanceIds] }) },
}
