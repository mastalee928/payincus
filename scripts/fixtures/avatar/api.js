export const pending = []
const defer = (kind, id, data) => new Promise((resolve, reject) => pending.push({ kind, id, data, resolve, reject }))
export default { users: { get: id => defer('read', id), update: (id, data) => defer('update', id, data) },
  systemConfig: { getPublic: async () => ({ avatarApiBase: location.origin + '/avatar' }) },
}
