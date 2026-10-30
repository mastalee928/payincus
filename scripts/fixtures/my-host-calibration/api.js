export const pending = []
const defer = (kind, data, id) => new Promise((resolve, reject) => pending.push({ kind, data, id, resolve, reject }))
export default {
  auth: { async me() { return { user: { id: 1, username: 'isolated-ui', role: 'admin' } } } },
  hosts: { list: data => defer('list', data), listHosted: data => defer('hosted', data),
    recalculateResources: id => defer('write', undefined, id) },
}
