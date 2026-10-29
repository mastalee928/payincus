export const pending = []
const defer = (kind, data) => new Promise((resolve, reject) => pending.push({ kind, data, resolve, reject }))
export default { users: { update: (id, data) => defer('update', { id, ...data }) }, verification: {
  request: operation => defer('request', { operation }), verify: (operation, code) => defer('verify', { operation, code }),
} }
