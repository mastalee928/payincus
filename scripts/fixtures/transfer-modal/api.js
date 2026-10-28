export const pending = []
const defer = (kind, data) => new Promise((resolve, reject) => pending.push({ kind, data, resolve, reject }))
export default {
  auth: { async me() { return { user: { id: 1, role: 'user', username: 'fixture' } } } },
  billing: { getUserBalance: () => defer('balance') },
  transfers: { searchUser: username => defer('search', { username }), create: (id, username, remark) => defer('create', { id, username, remark }) },
  verification: { request: (type, id) => defer('request-code', { type, id }), verify: (type, code, id) => defer('verify', { type, code, id }) },
}
