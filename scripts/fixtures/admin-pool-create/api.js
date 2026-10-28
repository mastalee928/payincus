export const pending = []
const request = (kind, params) => new Promise((resolve, reject) => pending.push({ kind, params: JSON.parse(JSON.stringify(params ?? {})), resolve, reject }))
export default {
  packages: {
    list: () => new URLSearchParams(location.search).has('slow-packages') ? request('packages') : Promise.resolve({ packages: [] }),
    getPlans: id => request('plans', { id })
  },
  admin: { lookupUser: username => request('lookup', { username }), createInstance: data => request('legacy-create', data) },
  instances: { getAvailableHosts: data => request('hosts', data) },
  hostPools: { catalog: () => request('catalog'), createForUser: data => request('create', data) },
  images: { getSystemImages: (type, memory, hostId) => request('images', { type, memory, hostId }) }
}
