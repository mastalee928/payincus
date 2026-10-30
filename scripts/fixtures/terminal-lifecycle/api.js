export const pending = []
const defer = (kind, id, data) => new Promise((resolve, reject) => pending.push({ kind, id, data, resolve, reject }))
export default {
  instances: { list(params) { return location.search.includes('session-test') ? defer('instances', null, params) : Promise.resolve({ instances: [], total: 0, page: 1, pageSize: 100, totalPages: 0 }) },
    checkCloudInitStatus: id => defer('cloud', id), createTerminalTicket: id => defer('ticket', id) },
  terminalSavedCommands: { async list() { return { commands: [] } } },
}
