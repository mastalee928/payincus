export const pending = []
const defer = (kind, id, data) => new Promise((resolve, reject) => pending.push({ kind, id, data, resolve, reject }))
export default {
  systemConfig: { async getPublic() { return {} } },
  instances: {
    get: id => defer('detail', id), getConfig: id => defer('config', id),
    getStats: id => defer('stats', id), getActiveTask: id => defer('task', id),
    start: id => defer('start', id), stop: id => defer('stop', id), restart: id => defer('restart', id),
    syncStatus: id => defer('sync', id), suspend: (id, reason) => defer('suspend', id, reason),
    unsuspend: id => defer('unsuspend', id), delete: (id, reason) => defer('delete', id, reason),
  },
  terminalSavedCommands: { async list() { return { commands: [] } } },
}
