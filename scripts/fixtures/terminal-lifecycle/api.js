export const pending = []
const defer = (kind, id) => new Promise((resolve, reject) => pending.push({ kind, id, resolve, reject }))
export default {
  instances: { list() { return location.search.includes('session-test') ? defer('instances') : Promise.resolve({ instances: [] }) },
    checkCloudInitStatus: id => defer('cloud', id), createTerminalTicket: id => defer('ticket', id) },
  terminalSavedCommands: { async list() { return { commands: [] } } },
}
