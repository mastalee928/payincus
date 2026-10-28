export const pending = []
const defer = (kind, id, signal, data) => new Promise((resolve, reject) => pending.push({ kind, id, signal, data, resolve, reject }))
export default {
  auth: { async me() { return { user: { id: 1, username: 'isolated-ui', role: 'admin' } } } },
  hosts: {
    list: data => defer('hosts', undefined, undefined, data),
    getStoragePools: id => defer('pools', id),
  },
  packages: {
    list: data => defer('list', undefined, undefined, data),
    get: (id, signal) => defer('get', id, signal),
    create: data => defer('create', undefined, undefined, data),
    update: (id, data) => defer('update', id, undefined, data),
  },
}
