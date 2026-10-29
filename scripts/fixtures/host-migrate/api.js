export const pending = []
const defer = (kind, hostId, params) => new Promise((resolve, reject) => pending.push({ kind, hostId, params, resolve, reject }))
export default {
  hosts: {
    list: params => defer('hosts', null, params),
    getHostPlans: hostId => defer('plans', hostId),
    migrateInstances: (hostId, ids, targetHostId, targetImage, targetPlanId) => defer('migrate', hostId, { ids, targetHostId, targetImage, targetPlanId }),
  },
  images: { getSystemImages: (type, architecture, hostId) => defer('images', hostId, { type, architecture }) },
}
