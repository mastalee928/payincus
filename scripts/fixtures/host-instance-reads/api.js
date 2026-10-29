export const pending = []
const request = (kind, params) => new Promise((resolve, reject) => pending.push({ kind, params, resolve, reject }))
export default {
  instances: { list: params => request('list', params), getConfig: id => request('config', { id }), get: id => request('detail', { id }) },
  traffic: { getInstanceTraffic: id => request('traffic', { id }) },
  hosts: { batchDeleteInstancesPreview: (hostId, ids) => request('delete-preview', { hostId, ids }) },
}
