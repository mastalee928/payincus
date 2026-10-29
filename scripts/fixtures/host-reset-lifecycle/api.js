export const pending = []
const request = (kind, params) => new Promise((resolve, reject) => pending.push({ kind, params, resolve, reject }))
export default {
  instances: { list: params => request('list', params) },
  traffic: {
    getInstanceTraffic: instanceId => request('traffic', { instanceId }),
    resetInstanceTraffic: instanceId => request('reset', { instanceId }),
  },
}
