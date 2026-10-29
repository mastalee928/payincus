export const pending = []
const defer = (kind, id, days) => new Promise((resolve, reject) => pending.push({ kind, id, days, resolve, reject }))
export default { hosts: {
  get: id => defer('get', id), test: id => defer('test', id), verify: id => defer('verify', id),
  regenerateInstall: id => defer('regenerate', id), delete: id => defer('delete', id),
  batchExtendAll: (id, days) => defer('extend', id, days),
}, instances: { list: params => defer('instances', params.hostId) } }
