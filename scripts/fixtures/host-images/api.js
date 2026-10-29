export const pending = []
const request = (kind, id, data) => new Promise((resolve, reject) => pending.push({ kind, id, data, resolve, reject }))
export default { hosts: { getImagePolicy: id => request('read', id), updateImagePolicy: (id, data) => request('write', id, data) } }
