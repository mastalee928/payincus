export const pending = []
const request = (kind, id, data) => new Promise((resolve, reject) => pending.push({ kind, id, data, resolve, reject }))
export default { hosts: { getCaddy: id => request('status', id), getCaddySites: (id, data) => request('sites', id, data),
  generateCaddyCommand: id => request('generate', id), resetCaddyCredentials: id => request('reset', id),
  confirmCaddyInstalled: id => request('confirm', id), testCaddyConnection: id => request('test', id) } }
