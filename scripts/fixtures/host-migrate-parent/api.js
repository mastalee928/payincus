export const pending = []
const defer = (kind, hostId, params) => new Promise((resolve, reject) => pending.push({ kind, hostId, params, resolve, reject }))
export default {
  instances: { list: params => defer('list', params.hostId, params) },
  traffic: { getInstanceTraffic: async () => ({ monthlyUsed: '0', monthlyUsedFormatted: '0 B', monthlyLimit: null, monthlyLimitFormatted: null, percentage: 0 }) },
  hosts: {
    list: params => defer('hosts', null, params),
    getHostPlans: hostId => defer('plans', hostId),
    migrateInstances: (hostId, ids, targetHostId, targetImage, targetPlanId) => defer('migrate', hostId, { ids, targetHostId, targetImage, targetPlanId }),
  },
  images: { getSystemImages: (type, architecture, hostId) => defer('images', hostId, { type, architecture }) },
}
