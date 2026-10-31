export const pending = []
const request = (kind, params) => new Promise((resolve, reject) => pending.push({ kind, params, resolve, reject }))
export default { orders: { list: params => request('list', params), detail: (sourceType, sourceId) => request('detail', { sourceType, sourceId }) } }
