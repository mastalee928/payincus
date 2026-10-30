export const pending = []
const request = (kind, data) => new Promise((resolve, reject) => pending.push({ kind, data, resolve, reject }))
export default { auth: { me: () => request('me') }, notifications: { list: () => request('list'), getLogs: params => request('logs', { ...params }), getStats: () => request('stats'), create: data => request('create', data), delete: id => request('delete', id), toggle: id => request('toggle', id), test: id => request('test', id) } }
