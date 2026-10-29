export const pending = []
const request = (kind, data) => new Promise((resolve, reject) => pending.push({ kind, data, resolve, reject }))
export default {
  instances: { list: data => request('instances', data) },
  traffic: { getHostTrafficHistory: id => request('traffic', { id }) },
  hosts: {
    getAgentStatus: id => request('agent', { id }),
    requestAgentUpgrade: id => request('upgrade', { id }),
    generateAgentInstallCommand: id => request('install', { id }),
    recalculateResources: id => request('recalculate', { id }),
    syncIpv6: id => request('ipv6', { id })
  }
}
