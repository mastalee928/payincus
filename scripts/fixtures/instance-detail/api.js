export const pending = [], calls = []
const defer = (kind, id) => new Promise((resolve, reject) => pending.push({ kind, id, resolve, reject }))
export default {
  auth: { async me() { calls.push('me'); return { user: { id: 1, username: 'fixture', role: 'user' } } } },
  systemConfig: { async getPublic() { return {} } },
  instances: {
    get: id => defer('instance', id),
    getStats: id => defer('stats', id),
    getSnapshots: id => defer('snapshots', id),
    getActiveTask: id => defer('task', id),
    checkCloudInitStatus: id => defer('cloud-init', id),
  },
  packages: { get: id => defer('package', id) },
  logs: { async list() { return { logs: [], total: 0 } } },
  terminalSavedCommands: { async list() { return { commands: [] } } },
  traffic: { getInstanceTraffic: id => defer('traffic', id) },
  transfers: { async list(direction) { calls.push(`transfer:${direction}`); return { transfers: [] } } },
}
