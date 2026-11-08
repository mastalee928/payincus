export const pending = []
export const users = [
  { id: 1, username: 'isolated-admin', email: 'admin@example.test', role: 'admin', status: 'active', balance: 0, points: 0, host_count: 0, instance_count: 0 },
  { id: 42, username: 'seoul-customer', email: 'seoul.customer@example.test', role: 'user', status: 'active', balance: 27.43, points: 0, host_count: 0, instance_count: 0 }
]
const request = (method, id, data) => new Promise((resolve, reject) => {
  if (new URLSearchParams(location.search).has('inspect')) return resolve({ userId: id, username: 'seoul-customer', email: users[1].email, revision: 'a'.repeat(64) })
  pending.push({ method, id, data, resolve, reject })
})
export default { users: {
  list: async () => ({ users: users.map(u => ({ ...u })), total: users.length, totalPages: 1 }),
  getEmail: id => request('get', id), setEmail: (id, data) => request('put', id, data)
} }
