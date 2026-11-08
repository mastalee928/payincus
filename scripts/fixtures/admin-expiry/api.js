export const pending = []
const request = (method, id, data) => new Promise((resolve, reject) => {
  if (new URLSearchParams(location.search).has('inspect')) return resolve({ instanceId: id, ownerId: 2, hostId: 3, incusId: 'vps-demo', expiresAt: '2030-02-02T04:00:00.000Z', revision: 'a'.repeat(64) })
  pending.push({ method, id, data, resolve, reject })
})
export default { admin: { getInstanceExpiry: id => request('get', id), setInstanceExpiry: (id, data) => request('put', id, data) } }
