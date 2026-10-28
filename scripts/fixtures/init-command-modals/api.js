export const pending = []
const defer = (kind, id, signal, data) => new Promise((resolve, reject) => pending.push({ kind, id, signal, data, resolve, reject }))
export default {
  auth: { async me() { return { user: { id: 1, username: 'isolated-ui', role: 'user' } } } },
  initCommands: {
    // Deliberately resolve aborted reads too, to exercise the component's identity checks.
    get: (id, signal) => defer('get', id, signal),
    getDistros: signal => defer('distros', undefined, signal),
    create: data => defer('create', undefined, undefined, data),
    update: (id, data) => defer('update', id, undefined, data),
  },
}
