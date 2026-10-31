export const pending = []
const request = (kind, params) => new Promise((resolve, reject) => pending.push({ kind, params, resolve, reject }))
export default { hosts: { list: async () => ({ hosts: [], total: 0, page: 1, pageSize: 100, totalPages: 0 }) }, packages: {
  list: params => request('list', params), listHosted: params => request('list', params), delete: id => request('delete', { id })
} }
