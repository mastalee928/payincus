export const pending = []
const defer = (kind, data) => new Promise((resolve, reject) => pending.push({ kind, data, resolve, reject }))
export default { verification: {
  request: operation => defer('current-send', { operation }),
  verify: (operation, code) => defer('current-verify', { operation, code }),
}, users: {
  sendChangeEmailCode: (id, email) => defer('new-send', { id, email }),
  update: (id, data) => defer('update', { id, ...data }),
} }
