export const pending = []
const defer = (kind, id) => new Promise((resolve, reject) => pending.push({ kind, id, resolve, reject }))
export default { hosts: {
  get: id => defer('get', id), test: id => defer('test', id), verify: id => defer('verify', id),
  regenerateInstall: id => defer('regenerate', id), delete: id => defer('delete', id),
}, instances: { list: params => defer('instances', params.hostId) } }
